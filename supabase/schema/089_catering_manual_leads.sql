-- Catering manual leads (Sprint 2.1)
-- Apply after 088_catering_quotes_operations.sql

-- ---------------------------------------------------------------------------
-- Activity log: manual lead type
-- ---------------------------------------------------------------------------

alter table public.catering_activity_log
  drop constraint if exists catering_activity_log_activity_type_check;

alter table public.catering_activity_log
  add constraint catering_activity_log_activity_type_check
  check (
    activity_type in (
      'lead_received',
      'lead_assigned',
      'status_changed',
      'followup_recorded',
      'contact_made',
      'quote_created',
      'quote_sent',
      'quote_approved',
      'quote_rejected',
      'quote_expired',
      'lead_created_manual'
    )
  );

-- ---------------------------------------------------------------------------
-- Lead source helpers
-- ---------------------------------------------------------------------------

create or replace function public.catering_lead_source_values()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'website',
    'whatsapp',
    'facebook',
    'instagram',
    'phone_call',
    'in_person',
    'referral',
    'hotel_partner',
    'past_event',
    'other'
  ]::text[];
$$;

create or replace function public.is_valid_catering_lead_source(p_lead_source text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(trim(coalesce(p_lead_source, '')), '') = any(public.catering_lead_source_values());
$$;

create or replace function public.normalize_catering_lead_source(
  p_lead_source text,
  p_source text default null
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when public.is_valid_catering_lead_source(p_lead_source) then lower(trim(p_lead_source))
    when coalesce(nullif(trim(coalesce(p_source, '')), ''), '') in ('wix_form', 'wix_webhook', 'wix_automation') then 'website'
    when coalesce(nullif(trim(coalesce(p_source, '')), ''), '') = 'manual' then 'other'
    else 'website'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Notifications (manual vs inbound)
-- ---------------------------------------------------------------------------

create or replace function public.notify_new_catering_request(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
  v_title text;
  v_message text;
  v_action_url text;
  v_inserted integer := 0;
begin
  if p_request_id is null then
    return 0;
  end if;

  select *
  into v_request
  from public.catering_requests
  where id = p_request_id;

  if not found then
    return 0;
  end if;

  if v_request.source = 'manual' then
    v_title := 'Nuevo lead manual de catering';
    v_message := coalesce(nullif(trim(v_request.customer_name), ''), 'Cliente')
      || ' — lead manual ('
      || v_request.lead_source
      || ').';
  else
    v_title := 'Nueva solicitud de catering';
    v_message := public.build_catering_request_notification_message(
      v_request.customer_name,
      v_request.guest_count
    );
  end if;

  v_action_url := '/catering?id=' || v_request.id::text;

  with recipients as (
    select distinct p.id as profile_id
    from public.profiles p
    where p.status = 'active'
      and public.normalize_profile_role(p.role) = any(public.catering_request_notification_roles())
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
      'catering_request',
      v_title,
      v_message,
      'catering_request',
      v_request.id::text,
      v_action_url
    from recipients
    where not exists (
      select 1
      from public.notifications n
      where n.user_id = recipients.profile_id
        and n.type = 'catering_request'
        and n.entity_type = 'catering_request'
        and n.entity_id = v_request.id::text
    )
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
exception
  when others then
    raise warning 'notify_new_catering_request failed for %: %', p_request_id, sqlerrm;
    return 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: create_catering_request (manual + inbound)
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_request(p_data jsonb)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_phone text := nullif(trim(coalesce(p_data ->> 'customer_phone', '')), '');
  v_email text := nullif(trim(coalesce(p_data ->> 'customer_email', '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_data ->> 'source', '')), ''), 'wix_form');
  v_lead_source text;
  v_guest_count integer;
  v_is_manual boolean := v_source = 'manual';
  v_row public.catering_requests;
  v_activity_type text;
  v_activity_description text;
begin
  if auth.uid() is not null and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear solicitudes de catering.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
  end if;

  v_lead_source := public.normalize_catering_lead_source(
    coalesce(p_data ->> 'lead_source', ''),
    v_source
  );

  if v_is_manual then
    if v_phone is null and v_email is null then
      raise exception 'Debes indicar telefono o correo del cliente.';
    end if;

    if nullif(p_data ->> 'guest_count', '') is not null then
      v_guest_count := nullif(p_data ->> 'guest_count', '')::integer;
      if v_guest_count is not null and v_guest_count <= 0 then
        raise exception 'guest_count debe ser mayor a 0.';
      end if;
    end if;
  end if;

  insert into public.catering_requests (
    customer_name,
    customer_phone,
    customer_email,
    event_date,
    event_time,
    event_location,
    event_type,
    guest_count,
    products_requested,
    notes,
    status,
    source,
    lead_source,
    assigned_to,
    follow_up_date,
    estimated_value,
    win_probability,
    conversion_status,
    created_by,
    updated_by
  )
  values (
    v_customer_name,
    v_phone,
    v_email,
    nullif(p_data ->> 'event_date', '')::date,
    nullif(p_data ->> 'event_time', '')::time,
    nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    coalesce(
      v_guest_count,
      nullif(p_data ->> 'guest_count', '')::integer
    ),
    coalesce(
      (
        select array_agg(value)
        from jsonb_array_elements_text(
          case
            when jsonb_typeof(p_data -> 'products_requested') = 'array' then p_data -> 'products_requested'
            else '[]'::jsonb
          end
        ) as value
        where nullif(trim(value), '') is not null
      ),
      '{}'::text[]
    ),
    nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    'new',
    v_source,
    v_lead_source,
    nullif(p_data ->> 'assigned_to', '')::uuid,
    nullif(p_data ->> 'follow_up_date', '')::date,
    nullif(p_data ->> 'estimated_value', '')::numeric(12, 2),
    nullif(p_data ->> 'win_probability', '')::integer,
    'lead',
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  if v_is_manual then
    v_activity_type := 'lead_created_manual';
    v_activity_description := 'Lead creado manualmente';
  else
    v_activity_type := 'lead_received';
    v_activity_description := 'Lead recibido';
  end if;

  perform public.log_catering_activity(
    v_row.id,
    v_activity_type,
    v_activity_description,
    jsonb_build_object(
      'source', v_row.source,
      'lead_source', v_row.lead_source,
      'manual', v_is_manual
    ),
    v_row.created_by,
    v_row.created_at
  );
  perform public.notify_new_catering_request(v_row.id);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: get_catering_requests (+ lead_source filter)
-- ---------------------------------------------------------------------------

drop function if exists public.get_catering_requests(text, text, uuid, integer, integer);

create or replace function public.get_catering_requests(
  p_status text default null,
  p_conversion_status text default null,
  p_assigned_to uuid default null,
  p_lead_source text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns setof public.catering_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_conversion_status text := nullif(trim(coalesce(p_conversion_status, '')), '');
  v_lead_source text := nullif(trim(coalesce(p_lead_source, '')), '');
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar solicitudes de catering.';
  end if;

  return query
  select request.*
  from public.catering_requests request
  where (v_status is null or request.status = v_status)
    and (v_conversion_status is null or request.conversion_status = v_conversion_status)
    and (p_assigned_to is null or request.assigned_to = p_assigned_to)
    and (v_lead_source is null or request.lead_source = v_lead_source)
  order by request.created_at desc
  limit v_limit
  offset v_offset;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: leads by source KPIs
-- ---------------------------------------------------------------------------

create or replace function public.get_catering_leads_by_source(
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
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para consultar el pipeline de catering.';
  end if;

  if v_to < v_from then
    raise exception 'p_date_to no puede ser menor que p_date_from.';
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'lead_source', src.lead_source,
          'lead_count', coalesce(stats.lead_count, 0),
          'potential_value', coalesce(stats.potential_value, 0),
          'approved_count', coalesce(stats.approved_count, 0),
          'approved_value', coalesce(stats.approved_value, 0)
        )
        order by src.lead_source
      )
      from (
        select unnest(public.catering_lead_source_values()) as lead_source
      ) src
      left join (
        select
          request.lead_source,
          count(*) as lead_count,
          coalesce(sum(
            coalesce(request.estimated_value, 0)
            * public.catering_effective_win_probability(request.win_probability, request.conversion_status)::numeric
            / 100
          ) filter (
            where request.conversion_status in ('lead', 'contacted', 'quoted', 'negotiating')
          ), 0) as potential_value,
          count(*) filter (where request.conversion_status = 'approved') as approved_count,
          coalesce(sum(request.estimated_value) filter (
            where request.conversion_status = 'approved'
          ), 0) as approved_value
        from public.catering_requests request
        where request.created_at::date between v_from and v_to
        group by request.lead_source
      ) stats on stats.lead_source = src.lead_source
    ),
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.catering_lead_source_values() from public;
revoke all on function public.is_valid_catering_lead_source(text) from public;
revoke all on function public.normalize_catering_lead_source(text, text) from public;
revoke all on function public.get_catering_leads_by_source(date, date) from public;
revoke all on function public.get_catering_requests(text, text, uuid, text, integer, integer) from public;

grant execute on function public.catering_lead_source_values() to authenticated;
grant execute on function public.is_valid_catering_lead_source(text) to authenticated;
grant execute on function public.normalize_catering_lead_source(text, text) to authenticated;
grant execute on function public.get_catering_leads_by_source(date, date) to authenticated;
grant execute on function public.get_catering_requests(text, text, uuid, text, integer, integer) to authenticated;
grant execute on function public.create_catering_request(jsonb) to authenticated, service_role;
grant execute on function public.notify_new_catering_request(uuid) to authenticated, service_role;
