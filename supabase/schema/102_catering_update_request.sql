-- Catering: edit lead / request data after creation
-- Apply after 101_fix_get_pending_print_jobs_auth_role.sql

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
      'lead_created_manual',
      'lead_updated'
    )
  );

create or replace function public.update_catering_request(
  p_request_id uuid,
  p_data jsonb
)
returns public.catering_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.catering_requests;
  v_customer_name text := nullif(trim(coalesce(p_data ->> 'customer_name', '')), '');
  v_phone text := nullif(trim(coalesce(p_data ->> 'customer_phone', '')), '');
  v_email text := nullif(trim(coalesce(p_data ->> 'customer_email', '')), '');
  v_lead_source text;
  v_guest_count integer;
begin
  if not public.can_manage_catering_requests() then
    raise exception 'No tienes permiso para editar solicitudes de catering.';
  end if;

  select * into v_row
  from public.catering_requests
  where id = p_request_id;

  if not found then
    raise exception 'Solicitud de catering no encontrada.';
  end if;

  if v_customer_name is null then
    raise exception 'customer_name es obligatorio.';
  end if;

  if v_phone is null and v_email is null then
    raise exception 'Debes indicar telefono o correo del cliente.';
  end if;

  v_lead_source := public.normalize_catering_lead_source(
    coalesce(p_data ->> 'lead_source', v_row.lead_source),
    v_row.source
  );

  if nullif(p_data ->> 'guest_count', '') is not null then
    v_guest_count := nullif(p_data ->> 'guest_count', '')::integer;
    if v_guest_count is not null and v_guest_count <= 0 then
      raise exception 'guest_count debe ser mayor a 0.';
    end if;
  end if;

  update public.catering_requests request
  set
    customer_name = v_customer_name,
    customer_phone = v_phone,
    customer_email = v_email,
    event_date = nullif(p_data ->> 'event_date', '')::date,
    event_time = nullif(p_data ->> 'event_time', '')::time,
    event_location = nullif(trim(coalesce(p_data ->> 'event_location', '')), ''),
    event_type = nullif(trim(coalesce(p_data ->> 'event_type', '')), ''),
    guest_count = coalesce(
      v_guest_count,
      nullif(p_data ->> 'guest_count', '')::integer
    ),
    products_requested = coalesce(
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
    notes = nullif(trim(coalesce(p_data ->> 'notes', '')), ''),
    lead_source = v_lead_source,
    assigned_to = case
      when p_data ? 'assigned_to' then nullif(p_data ->> 'assigned_to', '')::uuid
      else request.assigned_to
    end,
    follow_up_date = case
      when p_data ? 'follow_up_date' then nullif(p_data ->> 'follow_up_date', '')::date
      else request.follow_up_date
    end,
    estimated_value = case
      when p_data ? 'estimated_value' then nullif(p_data ->> 'estimated_value', '')::numeric(12, 2)
      else request.estimated_value
    end,
    updated_at = now(),
    updated_by = auth.uid()
  where request.id = p_request_id
  returning * into v_row;

  perform public.log_catering_activity(
    p_request_id,
    'lead_updated',
    'Datos del lead actualizados',
    jsonb_build_object(
      'customer_name', v_row.customer_name,
      'event_type', v_row.event_type,
      'event_date', v_row.event_date
    ),
    auth.uid(),
    now()
  );

  return v_row;
end;
$$;

revoke all on function public.update_catering_request(uuid, jsonb) from public;
grant execute on function public.update_catering_request(uuid, jsonb) to authenticated;
