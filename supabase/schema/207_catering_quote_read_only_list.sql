-- Catering: read-only quote listing (no hidden UPDATE in STABLE RPCs).
-- Apply after 206_fix_lifecycle_revoke_sessions_uuid_text.sql
--
-- Root cause: get_catering_request_quotes and get_catering_pipeline_summary called
-- sync_catering_quote_expired(), which UPDATEs catering_quotes inside STABLE functions.
-- PostgREST/Supabase may execute STABLE RPCs in a read-only transaction → failure.

-- ---------------------------------------------------------------------------
-- Helper: effective display status without mutating rows
-- ---------------------------------------------------------------------------

create or replace function public.catering_quote_effective_status(
  p_status text,
  p_valid_until date
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(p_status, '') = 'sent'
      and p_valid_until is not null
      and p_valid_until < current_date
    then 'expired'
    else coalesce(nullif(trim(coalesce(p_status, '')), ''), 'draft')
  end;
$$;

revoke all on function public.catering_quote_effective_status(text, date) from public;
grant execute on function public.catering_quote_effective_status(text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_request_quotes (read-only)
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_request_quotes(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quotes jsonb := '[]'::jsonb;
  v_latest jsonb := null;
  v_count integer := 0;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar cotizaciones de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  select count(*)
  into v_count
  from public.catering_quotes quote
  where quote.request_id = p_request_id;

  select coalesce(
    (
      select jsonb_build_object(
        'id', latest.id,
        'quote_number', latest.quote_number,
        'status', public.catering_quote_effective_status(latest.status, latest.valid_until),
        'status_label', public.catering_quote_status_label(
          public.catering_quote_effective_status(latest.status, latest.valid_until)
        ),
        'subtotal', latest.subtotal,
        'discount_amount', latest.discount_amount,
        'tax_amount', latest.tax_amount,
        'total', latest.total,
        'valid_until', latest.valid_until,
        'notes', latest.notes,
        'created_at', latest.created_at,
        'updated_at', latest.updated_at
      )
      from public.catering_quotes latest
      where latest.request_id = p_request_id
      order by latest.created_at desc
      limit 1
    ),
    null
  )
  into v_latest;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_quotes
  from (
    select jsonb_build_object(
      'id', quote.id,
      'quote_number', quote.quote_number,
      'status', public.catering_quote_effective_status(quote.status, quote.valid_until),
      'status_label', public.catering_quote_status_label(
        public.catering_quote_effective_status(quote.status, quote.valid_until)
      ),
      'subtotal', quote.subtotal,
      'discount_amount', quote.discount_amount,
      'tax_amount', quote.tax_amount,
      'total', quote.total,
      'valid_until', quote.valid_until,
      'notes', quote.notes,
      'created_at', quote.created_at,
      'updated_at', quote.updated_at
    ) as row_data,
    quote.created_at
    from public.catering_quotes quote
    where quote.request_id = p_request_id
  ) rows;

  return jsonb_build_object(
    'count', coalesce(v_count, 0),
    'latest', v_latest,
    'quotes', coalesce(v_quotes, '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_pipeline_summary (read-only quote KPI slice)
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_pipeline_summary(
  p_date_from date default null,
  p_date_to date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce(p_date_from, date_trunc('month', current_date)::date);
  v_to date := coalesce(p_date_to, current_date);
  v_total_leads bigint := 0;
  v_new_leads bigint := 0;
  v_new_leads_today bigint := 0;
  v_uncontacted_leads bigint := 0;
  v_contacted_leads bigint := 0;
  v_quoted_leads bigint := 0;
  v_negotiating_leads bigint := 0;
  v_approved_leads bigint := 0;
  v_lost_leads bigint := 0;
  v_converted_leads bigint := 0;
  v_gross_pipeline_value numeric(12, 2) := 0;
  v_weighted_pipeline_value numeric(12, 2) := 0;
  v_approved_total_value numeric(12, 2) := 0;
  v_conversion_rate numeric(10, 2) := 0;
  v_avg_response_time_minutes numeric(10, 2) := 0;
  v_quotes_created bigint := 0;
  v_quotes_sent bigint := 0;
  v_quotes_approved bigint := 0;
  v_quoted_amount numeric(12, 2) := 0;
  v_approved_quote_amount numeric(12, 2) := 0;
begin
  if auth.uid() is null then
    raise exception 'Debes iniciar sesion para consultar el pipeline de catering.';
  end if;

  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar el pipeline de catering.';
  end if;

  if v_to < v_from then
    raise exception 'p_date_to no puede ser menor que p_date_from.';
  end if;

  select
    count(*),
    count(*) filter (where conversion_status = 'lead'),
    count(*) filter (where created_at::date = current_date),
    count(*) filter (where conversion_status = 'lead' and last_contact_at is null),
    count(*) filter (where conversion_status = 'contacted'),
    count(*) filter (where conversion_status = 'quoted'),
    count(*) filter (where conversion_status = 'negotiating'),
    count(*) filter (where conversion_status = 'approved'),
    count(*) filter (where conversion_status = 'lost'),
    count(*) filter (where conversion_status = 'converted'),
    coalesce(sum(estimated_value) filter (
      where conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ), 0),
    coalesce(sum(
      coalesce(estimated_value, 0)
      * public.catering_effective_win_probability(win_probability, conversion_status)::numeric
      / 100
    ) filter (
      where conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
    ), 0),
    coalesce(sum(estimated_value) filter (where conversion_status = 'approved'), 0),
    coalesce(avg(extract(epoch from (last_contact_at - created_at)) / 60.0) filter (
      where last_contact_at is not null
    ), 0)
  into
    v_total_leads,
    v_new_leads,
    v_new_leads_today,
    v_uncontacted_leads,
    v_contacted_leads,
    v_quoted_leads,
    v_negotiating_leads,
    v_approved_leads,
    v_lost_leads,
    v_converted_leads,
    v_gross_pipeline_value,
    v_weighted_pipeline_value,
    v_approved_total_value,
    v_avg_response_time_minutes
  from public.catering_requests
  where created_at::date between v_from and v_to;

  select
    count(*),
    count(*) filter (
      where public.catering_quote_effective_status(quote.status, quote.valid_until)
        in ('sent', 'approved', 'rejected', 'expired')
    ),
    count(*) filter (
      where public.catering_quote_effective_status(quote.status, quote.valid_until) = 'approved'
    ),
    coalesce(sum(quote.total) filter (
      where public.catering_quote_effective_status(quote.status, quote.valid_until)
        in ('sent', 'approved', 'rejected', 'expired')
    ), 0),
    coalesce(sum(quote.total) filter (
      where public.catering_quote_effective_status(quote.status, quote.valid_until) = 'approved'
    ), 0)
  into
    v_quotes_created,
    v_quotes_sent,
    v_quotes_approved,
    v_quoted_amount,
    v_approved_quote_amount
  from public.catering_quotes quote
  where quote.created_at::date between v_from and v_to;

  if v_total_leads > 0 then
    v_conversion_rate := round((v_approved_leads::numeric / v_total_leads::numeric) * 100, 2);
  end if;

  return jsonb_build_object(
    'date_from', v_from,
    'date_to', v_to,
    'total_leads', v_total_leads,
    'new_leads', v_new_leads,
    'new_leads_today', v_new_leads_today,
    'uncontacted_leads', v_uncontacted_leads,
    'contacted_leads', v_contacted_leads,
    'quoted_leads', v_quoted_leads,
    'negotiating_leads', v_negotiating_leads,
    'approved_leads', v_approved_leads,
    'lost_leads', v_lost_leads,
    'converted_leads', v_converted_leads,
    'total_potential_value', v_gross_pipeline_value,
    'gross_pipeline_value', v_gross_pipeline_value,
    'weighted_pipeline_value', round(v_weighted_pipeline_value, 2),
    'approved_total_value', v_approved_total_value,
    'conversion_rate', v_conversion_rate,
    'avg_response_time_minutes', round(coalesce(v_avg_response_time_minutes, 0), 1),
    'quotes_created', v_quotes_created,
    'quotes_sent', v_quotes_sent,
    'quotes_approved', v_quotes_approved,
    'quoted_amount', round(v_quoted_amount, 2),
    'approved_quote_amount', round(v_approved_quote_amount, 2)
  );
end;
$$;

revoke all on function public.get_catering_request_quotes(uuid) from public;
grant execute on function public.get_catering_request_quotes(uuid) to authenticated;

revoke all on function public.get_catering_pipeline_summary(date, date) from public;
grant execute on function public.get_catering_pipeline_summary(date, date) to authenticated;

comment on function public.get_catering_request_quotes(uuid) is
  'Read-only quote list for a catering lead. Does not mutate expired quotes; use sync_catering_quote_expired() explicitly.';
