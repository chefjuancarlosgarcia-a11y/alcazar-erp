-- Catering request notifications for commercial team.
-- Apply after 083_catering_pipeline_phase_1_5.sql.

-- Dedup: one notification per user per catering request (idempotent on RPC retry).
create unique index if not exists notifications_catering_request_user_unique
  on public.notifications (user_id, type, entity_type, entity_id)
  where user_id is not null
    and type = 'catering_request'
    and entity_type = 'catering_request';

create or replace function public.catering_request_notification_roles()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'admin',
    'gerente_general',
    'gerente',
    'gerente_operaciones',
    'supervisor',
    'ventas'
  ]::text[];
$$;

create or replace function public.build_catering_request_notification_message(
  p_customer_name text,
  p_guest_count integer
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_guest_count is not null and p_guest_count > 0 then
      coalesce(nullif(trim(p_customer_name), ''), 'Cliente')
      || ' solicitó cotización para '
      || p_guest_count::text
      || ' invitados.'
    else
      coalesce(nullif(trim(p_customer_name), ''), 'Cliente')
      || ' solicitó cotización de catering.'
  end;
$$;

create or replace function public.notify_new_catering_request(p_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.catering_requests;
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

  v_message := public.build_catering_request_notification_message(
    v_request.customer_name,
    v_request.guest_count
  );
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
      'Nueva solicitud de catering',
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

revoke all on function public.catering_request_notification_roles() from public;
revoke all on function public.build_catering_request_notification_message(text, integer) from public;
revoke all on function public.notify_new_catering_request(uuid) from public;

-- ---------------------------------------------------------------------------
-- RPC: create_catering_request (notify commercial team; lead always persists)
-- ---------------------------------------------------------------------------

create or replace function public.create_catering_request(p_data jsonb)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_source text := coalesce(nullif(trim(coalesce(p_data ->> 'source', '')), ''), 'wix_form');
  v_row public.catering_requests;
begin
  if auth.uid() is not null and not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para crear solicitudes de catering.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
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
    conversion_status,
    created_by,
    updated_by
  )
  values (
    v_customer_name,
    nullif(trim(coalesce(p_data ->> 'customer_phone', '')), ''),
    nullif(trim(coalesce(p_data ->> 'customer_email', '')), ''),
    nullif(p_data ->> 'event_date', '')::date,
    nullif(p_data ->> 'event_time', '')::time,
    nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    nullif(p_data ->> 'guest_count', '')::integer,
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
    'website',
    nullif(p_data ->> 'assigned_to', '')::uuid,
    nullif(p_data ->> 'follow_up_date', '')::date,
    nullif(p_data ->> 'estimated_value', '')::numeric(12, 2),
    'lead',
    auth.uid(),
    auth.uid()
  )
  returning * into v_row;

  perform public.notify_new_catering_request(v_row.id);

  return v_row;
end;
$$;

revoke all on function public.create_catering_request(jsonb) from public;
grant execute on function public.create_catering_request(jsonb) to authenticated, service_role;
