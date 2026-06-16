-- Catering Sprint 2: quotes, line items, numbering, PDF-ready totals, CRM integration.
-- Apply after 086_catering_crm_sprint_1.sql.
--
-- TAX_RATE = 0.12 (IVA Guatemala). Centralized in catering_tax_rate() for future app_settings.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.catering_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.catering_requests(id) on delete cascade,
  quote_number text not null,
  status text not null default 'draft' check (status in (
    'draft',
    'sent',
    'approved',
    'rejected',
    'expired'
  )),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  discount_amount numeric(12, 2) not null default 0 check (discount_amount >= 0),
  tax_amount numeric(12, 2) not null default 0 check (tax_amount >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  valid_until date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_number)
);

create index if not exists catering_quotes_request_idx
  on public.catering_quotes (request_id, created_at desc);

create index if not exists catering_quotes_status_idx
  on public.catering_quotes (status, created_at desc);

create table if not exists public.catering_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.catering_quotes(id) on delete cascade,
  item_type text not null default 'other' check (item_type in (
    'food',
    'beverage',
    'staff',
    'equipment',
    'transport',
    'other'
  )),
  description text not null,
  quantity numeric(12, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  total_price numeric(12, 2) not null default 0 check (total_price >= 0),
  sort_order integer not null default 0
);

create index if not exists catering_quote_items_quote_idx
  on public.catering_quote_items (quote_id, sort_order asc, id asc);

create table if not exists public.catering_quote_counters (
  quote_year integer primary key,
  last_number integer not null default 0 check (last_number >= 0)
);

alter table public.catering_quotes enable row level security;
alter table public.catering_quote_items enable row level security;
alter table public.catering_quote_counters enable row level security;

grant select, insert, update, delete on public.catering_quotes to authenticated;
grant select, insert, update, delete on public.catering_quote_items to authenticated;
grant all on public.catering_quotes to service_role;
grant all on public.catering_quote_items to service_role;
grant all on public.catering_quote_counters to service_role;

drop policy if exists "catering_quotes_select" on public.catering_quotes;
create policy "catering_quotes_select"
  on public.catering_quotes
  for select
  to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quotes_insert" on public.catering_quotes;
create policy "catering_quotes_insert"
  on public.catering_quotes
  for insert
  to authenticated
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quotes_update" on public.catering_quotes;
create policy "catering_quotes_update"
  on public.catering_quotes
  for update
  to authenticated
  using (public.can_manage_catering_requests())
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quotes_delete" on public.catering_quotes;
create policy "catering_quotes_delete"
  on public.catering_quotes
  for delete
  to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quote_items_select" on public.catering_quote_items;
create policy "catering_quote_items_select"
  on public.catering_quote_items
  for select
  to authenticated
  using (public.can_manage_catering_requests());

drop policy if exists "catering_quote_items_insert" on public.catering_quote_items;
create policy "catering_quote_items_insert"
  on public.catering_quote_items
  for insert
  to authenticated
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_items_update" on public.catering_quote_items;
create policy "catering_quote_items_update"
  on public.catering_quote_items
  for update
  to authenticated
  using (public.can_manage_catering_requests())
  with check (public.can_manage_catering_requests());

drop policy if exists "catering_quote_items_delete" on public.catering_quote_items;
create policy "catering_quote_items_delete"
  on public.catering_quote_items
  for delete
  to authenticated
  using (public.can_manage_catering_requests());

-- catering_quote_counters: RLS enabled, no authenticated policies.
-- Direct access denied; only security definer RPCs (service_role owner) may write counters.

-- ---------------------------------------------------------------------------
-- Activity log: quote events
-- ---------------------------------------------------------------------------

alter table public.catering_activity_log
  drop constraint if exists catering_activity_log_activity_type_check;

alter table public.catering_activity_log
  add constraint catering_activity_log_activity_type_check
  check (activity_type in (
    'lead_received',
    'lead_assigned',
    'status_changed',
    'followup_recorded',
    'contact_made',
    'quote_created',
    'quote_sent',
    'quote_approved',
    'quote_rejected',
    'quote_expired'
  ));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.catering_tax_rate()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 0.12::numeric;
$$;

comment on function public.catering_tax_rate() is
  'Default catering quote tax rate (TAX_RATE = 0.12). Future: read from app_settings.';

create or replace function public.next_catering_quote_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year integer := extract(year from current_date)::integer;
  v_next integer;
begin
  insert into public.catering_quote_counters as counters (quote_year, last_number)
  values (v_year, 1)
  on conflict (quote_year) do update
    set last_number = counters.last_number + 1
  returning last_number into v_next;

  return format('CAT-%s-%s', v_year, lpad(v_next::text, 4, '0'));
end;
$$;

create or replace function public.catering_quote_totals(
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_tax_rate numeric default null
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := coalesce(p_discount_amount, 0);
  v_taxable numeric(12, 2) := 0;
  v_tax numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_item jsonb;
  v_qty numeric(12, 2);
  v_unit numeric(12, 2);
  v_rate numeric := coalesce(p_tax_rate, public.catering_tax_rate());
begin
  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select value from jsonb_array_elements(p_items) as value loop
      v_qty := coalesce(nullif(v_item ->> 'quantity', '')::numeric, 0);
      v_unit := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0);
      v_subtotal := v_subtotal + round(v_qty * v_unit, 2);
    end loop;
  end if;

  v_discount := greatest(coalesce(v_discount, 0), 0);
  v_taxable := greatest(v_subtotal - v_discount, 0);
  v_tax := round(v_taxable * greatest(coalesce(v_rate, public.catering_tax_rate()), 0), 2);
  v_total := round(v_taxable + v_tax, 2);

  return jsonb_build_object(
    'subtotal', v_subtotal,
    'discount_amount', v_discount,
    'tax_amount', v_tax,
    'total', v_total
  );
end;
$$;

create or replace function public.catering_quote_status_label(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case nullif(trim(coalesce(p_status, '')), '')
    when 'draft' then 'Borrador'
    when 'sent' then 'Enviada'
    when 'approved' then 'Aprobada'
    when 'rejected' then 'Rechazada'
    when 'expired' then 'Vencida'
    else coalesce(p_status, '—')
  end;
$$;

create or replace function public.sync_catering_quote_expired()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_count integer := 0;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para sincronizar cotizaciones vencidas.';
  end if;

  for v_quote in
    select quote.*
    from public.catering_quotes quote
    where quote.status = 'sent'
      and quote.valid_until is not null
      and quote.valid_until < current_date
  loop
    update public.catering_quotes
    set status = 'expired', updated_at = now()
    where id = v_quote.id;

    perform public.log_catering_activity(
      v_quote.request_id,
      'quote_expired',
      'Cotizacion ' || v_quote.quote_number || ' vencida',
      jsonb_build_object('quote_id', v_quote.id, 'quote_number', v_quote.quote_number)
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.notify_catering_quote_status(
  p_quote_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_request public.catering_requests;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_title text;
  v_message text;
  v_action_url text;
  v_inserted integer := 0;
begin
  if p_quote_id is null then
    return 0;
  end if;

  if v_status not in ('sent', 'approved', 'rejected') then
    return 0;
  end if;

  select quote.*
  into v_quote
  from public.catering_quotes quote
  where quote.id = p_quote_id;

  if not found then
    return 0;
  end if;

  select *
  into v_request
  from public.catering_requests
  where id = v_quote.request_id;

  v_action_url := '/catering?id=' || v_quote.request_id::text;

  v_title := case v_status
    when 'sent' then 'Cotizacion enviada'
    when 'approved' then 'Cotizacion aprobada'
    when 'rejected' then 'Cotizacion rechazada'
    else 'Cotizacion actualizada'
  end;

  v_message := case v_status
    when 'sent' then
      'Cotizacion enviada: '
      || v_quote.quote_number
      || ' para '
      || coalesce(nullif(trim(v_request.customer_name), ''), 'Cliente')
    when 'approved' then
      'Cotizacion aprobada: '
      || v_quote.quote_number
      || ' por Q'
      || to_char(v_quote.total, 'FM999999990.00')
    when 'rejected' then
      'Cotizacion rechazada: ' || v_quote.quote_number
    else v_quote.quote_number
  end;

  with recipients as (
    select distinct profile.id as profile_id
    from public.profiles profile
    where profile.status = 'active'
      and public.normalize_profile_role(profile.role) = any(public.catering_request_notification_roles())
  ),
  inserted as (
    insert into public.notifications (
      user_id,
      target_role,
      type,
      title,
      message,
      entity_type,
      entity_id,
      action_url
    )
    select
      recipients.profile_id,
      null,
      'catering_quote',
      v_title,
      v_message,
      'catering_request',
      v_quote.request_id::text,
      v_action_url
    from recipients
    where not exists (
      select 1
      from public.notifications notification
      where notification.user_id = recipients.profile_id
        and notification.type = 'catering_quote'
        and notification.entity_type = 'catering_request'
        and notification.entity_id = v_quote.request_id::text
        and notification.title = v_title
        and notification.message = v_message
    )
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
exception
  when others then
    raise warning 'notify_catering_quote_status failed for quote % status %: %',
      p_quote_id, p_status, sqlerrm;
    return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_catering_quote
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_quote(
  p_request_id uuid,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_valid_until date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_quote public.catering_quotes;
  v_totals jsonb;
  v_item jsonb;
  v_sort integer := 0;
  v_quote_number text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear cotizaciones de catering.';
  end if;

  if p_request_id is null then
    raise exception 'p_request_id es obligatorio.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes incluir al menos una linea en la cotizacion.';
  end if;

  select * into v_request from public.catering_requests where id = p_request_id;
  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  v_totals := public.catering_quote_totals(p_items, p_discount_amount, public.catering_tax_rate());
  v_quote_number := public.next_catering_quote_number();

  insert into public.catering_quotes (
    request_id,
    quote_number,
    status,
    subtotal,
    discount_amount,
    tax_amount,
    total,
    valid_until,
    notes,
    created_by
  )
  values (
    p_request_id,
    v_quote_number,
    'draft',
    (v_totals ->> 'subtotal')::numeric,
    (v_totals ->> 'discount_amount')::numeric,
    (v_totals ->> 'tax_amount')::numeric,
    (v_totals ->> 'total')::numeric,
    p_valid_until,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_quote;

  for v_item in select value from jsonb_array_elements(p_items) as value loop
    v_sort := v_sort + 1;
    insert into public.catering_quote_items (
      quote_id,
      item_type,
      description,
      quantity,
      unit_price,
      total_price,
      sort_order
    )
    values (
      v_quote.id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(
        coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1)
        * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
        2
      ),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort)
    );
  end loop;

  perform public.log_catering_activity(
    v_quote.request_id,
    'quote_created',
    'Cotizacion ' || v_quote.quote_number || ' creada',
    jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'total', v_quote.total
    )
  );

  return public.get_catering_quote_detail(v_quote.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_quote (draft only)
-- ---------------------------------------------------------------------------

create or replace function public.update_catering_quote(
  p_quote_id uuid,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_valid_until date default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_totals jsonb;
  v_item jsonb;
  v_sort integer := 0;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar cotizaciones de catering.';
  end if;

  if p_quote_id is null then
    raise exception 'p_quote_id es obligatorio.';
  end if;

  select * into v_quote from public.catering_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotizacion no encontrada.';
  end if;

  if v_quote.status <> 'draft' then
    raise exception 'Solo se pueden editar cotizaciones en borrador.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Debes incluir al menos una linea en la cotizacion.';
  end if;

  v_totals := public.catering_quote_totals(p_items, p_discount_amount, public.catering_tax_rate());

  update public.catering_quotes
  set
    subtotal = (v_totals ->> 'subtotal')::numeric,
    discount_amount = (v_totals ->> 'discount_amount')::numeric,
    tax_amount = (v_totals ->> 'tax_amount')::numeric,
    total = (v_totals ->> 'total')::numeric,
    valid_until = p_valid_until,
    notes = nullif(trim(coalesce(p_notes, '')), ''),
    updated_at = now()
  where id = p_quote_id;

  delete from public.catering_quote_items where quote_id = p_quote_id;

  for v_item in select value from jsonb_array_elements(p_items) as value loop
    v_sort := v_sort + 1;
    insert into public.catering_quote_items (
      quote_id,
      item_type,
      description,
      quantity,
      unit_price,
      total_price,
      sort_order
    )
    values (
      p_quote_id,
      coalesce(nullif(trim(v_item ->> 'item_type'), ''), 'other'),
      trim(v_item ->> 'description'),
      coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1),
      coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
      round(
        coalesce(nullif(v_item ->> 'quantity', '')::numeric, 1)
        * coalesce(nullif(v_item ->> 'unit_price', '')::numeric, 0),
        2
      ),
      coalesce(nullif(v_item ->> 'sort_order', '')::integer, v_sort)
    );
  end loop;

  return public.get_catering_quote_detail(p_quote_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: update_catering_quote_status
-- ---------------------------------------------------------------------------

create or replace function public.update_catering_quote_status(
  p_quote_id uuid,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_request public.catering_requests;
  v_status text := lower(trim(coalesce(p_status, '')));
  v_activity_type text;
  v_activity_description text;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para actualizar cotizaciones de catering.';
  end if;

  if p_quote_id is null then
    raise exception 'p_quote_id es obligatorio.';
  end if;

  if v_status not in ('draft', 'sent', 'approved', 'rejected', 'expired') then
    raise exception 'Estado de cotizacion invalido: %.', v_status;
  end if;

  select * into v_quote from public.catering_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotizacion no encontrada.';
  end if;

  if v_quote.status = v_status then
    return public.get_catering_quote_detail(p_quote_id);
  end if;

  if v_status = 'draft' then
    raise exception 'No se puede regresar una cotizacion a borrador.';
  end if;

  if v_status = 'sent' and v_quote.status not in ('draft') then
    raise exception 'Solo borradores pueden marcarse como enviados.';
  end if;

  if v_status in ('approved', 'rejected') and v_quote.status not in ('sent') then
    raise exception 'Solo cotizaciones enviadas pueden aprobarse o rechazarse.';
  end if;

  if v_status = 'expired' and v_quote.status not in ('sent') then
    raise exception 'Solo cotizaciones enviadas pueden vencer.';
  end if;

  update public.catering_quotes
  set status = v_status, updated_at = now()
  where id = p_quote_id
  returning * into v_quote;

  v_activity_type := case v_status
    when 'sent' then 'quote_sent'
    when 'approved' then 'quote_approved'
    when 'rejected' then 'quote_rejected'
    when 'expired' then 'quote_expired'
    else 'status_changed'
  end;

  v_activity_description := case v_status
    when 'sent' then 'Cotizacion ' || v_quote.quote_number || ' enviada al cliente'
    when 'approved' then 'Cotizacion ' || v_quote.quote_number || ' aprobada'
    when 'rejected' then 'Cotizacion ' || v_quote.quote_number || ' rechazada'
    when 'expired' then 'Cotizacion ' || v_quote.quote_number || ' vencida'
    else 'Estado de cotizacion actualizado'
  end;

  perform public.log_catering_activity(
    v_quote.request_id,
    v_activity_type,
    v_activity_description,
    jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_number', v_quote.quote_number,
      'status', v_quote.status,
      'total', v_quote.total
    )
  );

  select * into v_request from public.catering_requests where id = v_quote.request_id for update;

  if v_status = 'sent' then
    update public.catering_requests
    set
      conversion_status = case
        when conversion_status in ('lead', 'contacted') then 'quoted'
        else conversion_status
      end,
      status = case when status = 'new' then 'quoted' else status end,
      estimated_value = coalesce(estimated_value, v_quote.total),
      updated_by = auth.uid()
    where id = v_quote.request_id;
  elsif v_status = 'approved' then
    update public.catering_requests
    set
      conversion_status = 'approved',
      status = 'approved',
      estimated_value = v_quote.total,
      win_probability = 100,
      updated_by = auth.uid()
    where id = v_quote.request_id;
  end if;

  perform public.notify_catering_quote_status(p_quote_id, v_status);

  return public.get_catering_quote_detail(p_quote_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_quote_detail
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_quote_detail(p_quote_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_quote public.catering_quotes;
  v_items jsonb := '[]'::jsonb;
  v_request public.catering_requests;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar cotizaciones de catering.';
  end if;

  if p_quote_id is null then
    raise exception 'p_quote_id es obligatorio.';
  end if;

  select * into v_quote from public.catering_quotes where id = p_quote_id;
  if not found then
    raise exception 'Cotizacion no encontrada.';
  end if;

  select * into v_request from public.catering_requests where id = v_quote.request_id;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order asc, item.id asc), '[]'::jsonb)
  into v_items
  from public.catering_quote_items item
  where item.quote_id = p_quote_id;

  return jsonb_build_object(
    'quote', to_jsonb(v_quote),
    'items', v_items,
    'request', to_jsonb(v_request)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_request_quotes
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

  perform public.sync_catering_quote_expired();

  select
    count(*),
    coalesce(
      (
        select to_jsonb(latest)
        from public.catering_quotes latest
        where latest.request_id = p_request_id
        order by latest.created_at desc
        limit 1
      ),
      null
    )
  into v_count, v_latest
  from public.catering_quotes quote
  where quote.request_id = p_request_id;

  select coalesce(jsonb_agg(row_data order by created_at desc), '[]'::jsonb)
  into v_quotes
  from (
    select jsonb_build_object(
      'id', quote.id,
      'quote_number', quote.quote_number,
      'status', quote.status,
      'status_label', public.catering_quote_status_label(quote.status),
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
    'count', v_count,
    'latest', v_latest,
    'quotes', v_quotes
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_pipeline_summary (quote KPIs)
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

  perform public.sync_catering_quote_expired();

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
    count(*) filter (where status in ('sent', 'approved', 'rejected', 'expired')),
    count(*) filter (where status = 'approved'),
    coalesce(sum(total) filter (where status in ('sent', 'approved', 'rejected', 'expired')), 0),
    coalesce(sum(total) filter (where status = 'approved'), 0)
  into
    v_quotes_created,
    v_quotes_sent,
    v_quotes_approved,
    v_quoted_amount,
    v_approved_quote_amount
  from public.catering_quotes
  where created_at::date between v_from and v_to;

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

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on function public.catering_tax_rate() from public;
revoke all on function public.next_catering_quote_number() from public;
revoke all on function public.catering_quote_totals(jsonb, numeric, numeric) from public;
revoke all on function public.catering_quote_status_label(text) from public;
revoke all on function public.sync_catering_quote_expired() from public;
revoke all on function public.notify_catering_quote_status(uuid, text) from public;
revoke all on function public.create_catering_quote(uuid, jsonb, numeric, date, text) from public;
revoke all on function public.update_catering_quote(uuid, jsonb, numeric, date, text) from public;
revoke all on function public.update_catering_quote_status(uuid, text) from public;
revoke all on function public.get_catering_quote_detail(uuid) from public;
revoke all on function public.get_catering_request_quotes(uuid) from public;

grant execute on function public.catering_tax_rate() to authenticated;
grant execute on function public.next_catering_quote_number() to authenticated, service_role;
grant execute on function public.catering_quote_totals(jsonb, numeric, numeric) to authenticated;
grant execute on function public.catering_quote_status_label(text) to authenticated;
grant execute on function public.sync_catering_quote_expired() to authenticated;
grant execute on function public.notify_catering_quote_status(uuid, text) to authenticated, service_role;
grant execute on function public.create_catering_quote(uuid, jsonb, numeric, date, text) to authenticated;
grant execute on function public.update_catering_quote(uuid, jsonb, numeric, date, text) to authenticated;
grant execute on function public.update_catering_quote_status(uuid, text) to authenticated;
grant execute on function public.get_catering_quote_detail(uuid) to authenticated;
grant execute on function public.get_catering_request_quotes(uuid) to authenticated;

grant execute on function public.get_catering_pipeline_summary(date, date) to authenticated;
