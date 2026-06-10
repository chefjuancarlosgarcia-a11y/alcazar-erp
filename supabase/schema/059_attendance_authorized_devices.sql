-- Authorized attendance devices and security settings.
-- Apply after 058_employee_supervisor_and_task_assign.sql.

create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  device_id text not null unique,
  device_name text not null,
  device_type text,
  user_agent text,
  status text not null default 'pending'
    check (status in ('pending', 'authorized', 'blocked')),
  authorized_by uuid references public.profiles(id) on delete set null,
  authorized_at timestamptz,
  last_seen_at timestamptz,
  last_ip text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists attendance_devices_status_idx
  on public.attendance_devices (status, last_seen_at desc);

create table if not exists public.attendance_security_events (
  id uuid primary key default gen_random_uuid(),
  device_id text,
  profile_id uuid references public.profiles(id) on delete set null,
  event_type text not null
    check (event_type in (
      'device_pending',
      'device_blocked',
      'unauthorized_device_attempt',
      'unauthorized_network_attempt',
      'authorized_mark_attempt'
    )),
  ip_address text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_security_events_created_idx
  on public.attendance_security_events (created_at desc);

create table if not exists public.attendance_security_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.attendance_security_settings (key, value)
values (
  'attendance_security',
  jsonb_build_object(
    'require_authorized_device', true,
    'require_authorized_network', false,
    'allowed_ips', '[]'::jsonb,
    'allow_hr_manual_override', false
  )
)
on conflict (key) do nothing;

alter table public.attendance_devices enable row level security;
alter table public.attendance_security_events enable row level security;
alter table public.attendance_security_settings enable row level security;

grant select on public.attendance_devices, public.attendance_security_events, public.attendance_security_settings to authenticated;
grant all on public.attendance_devices, public.attendance_security_events, public.attendance_security_settings to service_role;

create or replace function public.is_attendance_security_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in ('admin', 'gerente_general')
  );
$$;

create or replace function public.can_view_attendance_security()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_attendance_security_admin()
    or public.is_profile_hr()
    or exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and status = 'active'
        and public.normalize_profile_role(role) in ('recursos_humanos', 'rrhh')
    );
$$;

revoke all on function public.is_attendance_security_admin(), public.can_view_attendance_security() from public;
grant execute on function public.is_attendance_security_admin(), public.can_view_attendance_security() to authenticated;

drop policy if exists "attendance_devices_admin_manage" on public.attendance_devices;
create policy "attendance_devices_admin_manage"
  on public.attendance_devices
  for all
  to authenticated
  using (public.is_attendance_security_admin())
  with check (public.is_attendance_security_admin());

drop policy if exists "attendance_devices_hr_read" on public.attendance_devices;
create policy "attendance_devices_hr_read"
  on public.attendance_devices
  for select
  to authenticated
  using (public.can_view_attendance_security());

drop policy if exists "attendance_security_events_hr_read" on public.attendance_security_events;
create policy "attendance_security_events_hr_read"
  on public.attendance_security_events
  for select
  to authenticated
  using (public.can_view_attendance_security());

drop policy if exists "attendance_security_settings_admin_manage" on public.attendance_security_settings;
create policy "attendance_security_settings_admin_manage"
  on public.attendance_security_settings
  for all
  to authenticated
  using (public.is_attendance_security_admin())
  with check (public.is_attendance_security_admin());

drop policy if exists "attendance_security_settings_hr_read" on public.attendance_security_settings;
create policy "attendance_security_settings_hr_read"
  on public.attendance_security_settings
  for select
  to authenticated
  using (public.can_view_attendance_security());

create or replace function public.get_attendance_security_settings_value()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select value
      from public.attendance_security_settings
      where key = 'attendance_security'
      limit 1
    ),
    jsonb_build_object(
      'require_authorized_device', true,
      'require_authorized_network', false,
      'allowed_ips', '[]'::jsonb,
      'allow_hr_manual_override', false
    )
  );
$$;

create or replace function public.log_attendance_security_event(
  p_device_id text,
  p_profile_id uuid,
  p_event_type text,
  p_ip_address text default null,
  p_user_agent text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attendance_security_events (
    device_id, profile_id, event_type, ip_address, user_agent, metadata
  )
  values (
    nullif(trim(p_device_id), ''),
    p_profile_id,
    p_event_type,
    nullif(trim(p_ip_address), ''),
    nullif(trim(p_user_agent), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

create or replace function public.is_attendance_network_allowed(
  p_client_ip text,
  p_settings jsonb default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings jsonb := coalesce(p_settings, public.get_attendance_security_settings_value());
  require_network boolean := coalesce((settings->>'require_authorized_network')::boolean, false);
  allowed_ips jsonb := coalesce(settings->'allowed_ips', '[]'::jsonb);
  normalized_ip text := nullif(trim(p_client_ip), '');
begin
  if not require_network then
    return true;
  end if;

  if normalized_ip is null then
    return false;
  end if;

  return exists (
    select 1
    from jsonb_array_elements_text(allowed_ips) as allowed(ip)
    where trim(allowed.ip) = normalized_ip
  );
end;
$$;

create or replace function public.get_or_register_attendance_device(
  p_device_id text,
  p_device_name text default null,
  p_user_agent text default null,
  p_device_type text default null,
  p_client_ip text default null
)
returns public.attendance_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.attendance_devices;
  normalized_id text := nullif(trim(p_device_id), '');
begin
  if normalized_id is null then
    raise exception 'device_id es obligatorio.';
  end if;

  select * into device_row
  from public.attendance_devices
  where device_id = normalized_id;

  if device_row.id is null then
    insert into public.attendance_devices (
      device_id, device_name, device_type, user_agent, status, last_seen_at, last_ip
    )
    values (
      normalized_id,
      coalesce(nullif(trim(p_device_name), ''), 'Terminal pendiente'),
      nullif(trim(p_device_type), ''),
      nullif(trim(p_user_agent), ''),
      'pending',
      now(),
      nullif(trim(p_client_ip), '')
    )
    returning * into device_row;

    perform public.log_attendance_security_event(
      normalized_id,
      null,
      'device_pending',
      p_client_ip,
      p_user_agent,
      jsonb_build_object('device_name', device_row.device_name)
    );
  else
    update public.attendance_devices
    set
      device_name = coalesce(nullif(trim(p_device_name), ''), device_name),
      device_type = coalesce(nullif(trim(p_device_type), ''), device_type),
      user_agent = coalesce(nullif(trim(p_user_agent), ''), user_agent),
      last_seen_at = now(),
      last_ip = coalesce(nullif(trim(p_client_ip), ''), last_ip),
      updated_at = now()
    where id = device_row.id
    returning * into device_row;
  end if;

  return device_row;
end;
$$;

create or replace function public.get_attendance_security_status(
  p_device_id text,
  p_client_ip text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  settings jsonb := public.get_attendance_security_settings_value();
  require_device boolean := coalesce((settings->>'require_authorized_device')::boolean, false);
  require_network boolean := coalesce((settings->>'require_authorized_network')::boolean, false);
  device_row public.attendance_devices;
  normalized_id text := nullif(trim(p_device_id), '');
  network_allowed boolean;
  can_mark boolean := true;
  message text := 'Dispositivo autorizado para marcaje.';
  device_status text := 'unknown';
begin
  if normalized_id is not null then
    select * into device_row
    from public.attendance_devices
    where device_id = normalized_id;
  end if;

  device_status := coalesce(device_row.status, 'unknown');
  network_allowed := public.is_attendance_network_allowed(p_client_ip, settings);

  if not require_device then
    can_mark := true;
    message := 'Marcaje permitido sin restriccion de dispositivo.';
  elsif normalized_id is null then
    can_mark := false;
    message := 'Este dispositivo no esta registrado para marcaje.';
  elsif device_row.id is null then
    can_mark := false;
    message := 'Este dispositivo aun no esta autorizado para registrar asistencia.';
    device_status := 'pending';
  elsif device_row.status = 'blocked' then
    can_mark := false;
    message := 'Este dispositivo esta bloqueado para marcaje.';
  elsif device_row.status <> 'authorized' then
    can_mark := false;
    message := 'Este dispositivo aun no esta autorizado para registrar asistencia.';
  end if;

  if can_mark and require_network and not network_allowed then
    can_mark := false;
    message := 'Esta red no esta autorizada para marcaje de asistencia.';
    perform public.log_attendance_security_event(
      normalized_id,
      null,
      'unauthorized_network_attempt',
      p_client_ip,
      p_user_agent,
      jsonb_build_object('allowed_ips', settings->'allowed_ips')
    );
  end if;

  return jsonb_build_object(
    'device_status', device_status,
    'require_authorized_device', require_device,
    'require_authorized_network', require_network,
    'network_allowed', network_allowed,
    'can_mark', can_mark,
    'message', message,
    'device_name', coalesce(device_row.device_name, null),
    'device_id', normalized_id
  );
end;
$$;

create or replace function public.assert_attendance_device_can_mark(
  p_device_id text,
  p_employee_id uuid default null,
  p_client_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  status jsonb;
begin
  status := public.get_attendance_security_status(p_device_id, p_client_ip, p_user_agent);

  if coalesce((status->>'can_mark')::boolean, false) then
    return;
  end if;

  perform public.log_attendance_security_event(
    p_device_id,
    p_employee_id,
    case
      when coalesce((status->>'require_authorized_network')::boolean, false)
        and coalesce((status->>'network_allowed')::boolean, false) = false
      then 'unauthorized_network_attempt'
      else 'unauthorized_device_attempt'
    end,
    p_client_ip,
    p_user_agent,
    status
  );

  raise exception '%', coalesce(status->>'message', 'Este dispositivo no esta autorizado para registrar asistencia.');
end;
$$;

create or replace function public.get_attendance_devices()
returns setof public.attendance_devices
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_attendance_security() then
    raise exception 'No tienes permiso para ver dispositivos de marcaje.';
  end if;

  return query
  select *
  from public.attendance_devices
  order by last_seen_at desc nulls last, created_at desc;
end;
$$;

create or replace function public.authorize_attendance_device(
  p_device_id text,
  p_device_name text default null,
  p_notes text default null
)
returns public.attendance_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.attendance_devices;
begin
  if not public.is_attendance_security_admin() then
    raise exception 'Solo Administracion puede autorizar dispositivos de marcaje.';
  end if;

  update public.attendance_devices
  set
    status = 'authorized',
    device_name = coalesce(nullif(trim(p_device_name), ''), device_name),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    authorized_by = auth.uid(),
    authorized_at = now(),
    updated_at = now()
  where device_id = nullif(trim(p_device_id), '')
  returning * into device_row;

  if device_row.id is null then
    raise exception 'Dispositivo no encontrado.';
  end if;

  return device_row;
end;
$$;

create or replace function public.block_attendance_device(
  p_device_id text,
  p_notes text default null
)
returns public.attendance_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.attendance_devices;
begin
  if not public.is_attendance_security_admin() then
    raise exception 'Solo Administracion puede bloquear dispositivos de marcaje.';
  end if;

  update public.attendance_devices
  set
    status = 'blocked',
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where device_id = nullif(trim(p_device_id), '')
  returning * into device_row;

  if device_row.id is null then
    raise exception 'Dispositivo no encontrado.';
  end if;

  perform public.log_attendance_security_event(
    device_row.device_id,
    null,
    'device_blocked',
    device_row.last_ip,
    device_row.user_agent,
    jsonb_build_object('notes', device_row.notes)
  );

  return device_row;
end;
$$;

create or replace function public.update_attendance_device(
  p_device_id text,
  p_device_name text default null,
  p_notes text default null
)
returns public.attendance_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  device_row public.attendance_devices;
begin
  if not public.is_attendance_security_admin() then
    raise exception 'Solo Administracion puede editar dispositivos de marcaje.';
  end if;

  update public.attendance_devices
  set
    device_name = coalesce(nullif(trim(p_device_name), ''), device_name),
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where device_id = nullif(trim(p_device_id), '')
  returning * into device_row;

  if device_row.id is null then
    raise exception 'Dispositivo no encontrado.';
  end if;

  return device_row;
end;
$$;

create or replace function public.update_attendance_security_settings(
  p_value jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved jsonb;
begin
  if not public.is_attendance_security_admin() then
    raise exception 'Solo Administracion puede cambiar la seguridad de marcaje.';
  end if;

  update public.attendance_security_settings
  set
    value = coalesce(p_value, '{}'::jsonb),
    updated_by = auth.uid(),
    updated_at = now()
  where key = 'attendance_security'
  returning value into saved;

  if saved is null then
    insert into public.attendance_security_settings (key, value, updated_by)
    values ('attendance_security', coalesce(p_value, '{}'::jsonb), auth.uid())
    returning value into saved;
  end if;

  return saved;
end;
$$;

create or replace function public.get_attendance_security_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_attendance_security() then
    raise exception 'No tienes permiso para ver la configuracion de marcaje.';
  end if;

  return public.get_attendance_security_settings_value();
end;
$$;

drop function if exists public.register_attendance_mark(uuid,text,text,text,text,text,text);

create or replace function public.register_attendance_mark(
  p_employee_id uuid,
  p_pin text,
  p_mark_type text,
  p_photo_path text,
  p_device_id text,
  p_device_name text,
  p_observation text default null,
  p_client_ip text default null
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = '', extensions, public
as $$
declare
  employee public.profiles;
  credential public.attendance_credentials;
  mark public.attendance_marks;
  open_entry public.attendance_marks;
  open_meal public.attendance_marks;
  meal_minutes integer;
  unrecognized_device boolean;
  observation_text text := nullif(trim(p_observation), '');
  user_agent text;
begin
  perform public.assert_attendance_device_can_mark(
    p_device_id,
    p_employee_id,
    p_client_ip,
    null
  );

  if nullif(trim(p_photo_path), '') is null then
    raise exception 'Se requiere foto para registrar asistencia.';
  end if;
  if p_mark_type = 'salida' then p_mark_type := 'salida_final'; end if;
  if p_mark_type = 'bano_inicio' then p_mark_type := 'salida_comida'; end if;
  if p_mark_type = 'bano_regreso' then p_mark_type := 'regreso_comida'; end if;
  if p_mark_type not in ('entrada', 'salida_comida', 'regreso_comida', 'salida_final') then
    raise exception 'Tipo de marcaje no valido.';
  end if;

  select * into employee from public.profiles where id = p_employee_id and status = 'active';
  select * into credential from public.attendance_credentials where employee_id = p_employee_id;
  if employee.id is null or credential.employee_id is null
    or crypt(p_pin, credential.pin_hash) <> credential.pin_hash then
    raise exception 'PIN incorrecto o colaborador sin PIN configurado.';
  end if;

  select m.* into open_entry
  from public.attendance_marks m
  where m.employee_id = employee.id
    and m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = (now() at time zone 'America/Guatemala')::date
    and not exists (
      select 1 from public.attendance_marks out_mark
      where out_mark.employee_id = employee.id
        and out_mark.mark_type in ('salida_final', 'salida')
        and out_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

  select m.* into open_meal
  from public.attendance_marks m
  where m.employee_id = employee.id
    and m.mark_type in ('salida_comida', 'bano_inicio')
    and (m.marked_at at time zone 'America/Guatemala')::date = (now() at time zone 'America/Guatemala')::date
    and not exists (
      select 1 from public.attendance_marks back_mark
      where back_mark.employee_id = employee.id
        and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
        and back_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

  if p_mark_type = 'entrada' and open_entry.id is not null then
    raise exception 'Ya existe una entrada activa para este colaborador.';
  elsif p_mark_type = 'salida_comida' and open_entry.id is null then
    raise exception 'No existe entrada activa para registrar salida a comida.';
  elsif p_mark_type = 'salida_comida' and open_meal.id is not null then
    raise exception 'Ya existe una salida a comida pendiente de regreso.';
  elsif p_mark_type = 'regreso_comida' and open_meal.id is null then
    raise exception 'No existe salida a comida pendiente.';
  elsif p_mark_type = 'salida_final' and open_entry.id is null then
    raise exception 'No existe entrada activa para registrar salida final.';
  elsif p_mark_type = 'salida_final' and open_meal.id is not null then
    raise exception 'Registra el regreso de comida antes de la salida final.';
  end if;

  if p_mark_type = 'regreso_comida' then
    meal_minutes := greatest(0, floor(extract(epoch from (now() - open_meal.marked_at)) / 60)::integer);
  end if;

  unrecognized_device := employee.authorized_attendance_device is not null
    and employee.authorized_attendance_device <> p_device_id;

  insert into public.attendance_marks (
    employee_id, employee_name, mark_type, photo_path, device_id, device_name, device_alert,
    related_mark_id, duration_minutes, observation
  )
  values (
    employee.id, coalesce(employee.full_name, employee.username, 'Colaborador'),
    p_mark_type, trim(p_photo_path), trim(p_device_id), trim(p_device_name), unrecognized_device,
    case when p_mark_type = 'regreso_comida' then open_meal.id else open_entry.id end,
    meal_minutes,
    observation_text
  )
  returning * into mark;

  perform public.log_attendance_security_event(
    trim(p_device_id),
    employee.id,
    'authorized_mark_attempt',
    p_client_ip,
    user_agent,
    jsonb_build_object('mark_type', p_mark_type, 'mark_id', mark.id)
  );

  return mark;
end;
$$;

revoke all on function
  public.get_attendance_security_settings_value(),
  public.log_attendance_security_event(text, uuid, text, text, text, jsonb),
  public.is_attendance_network_allowed(text, jsonb),
  public.assert_attendance_device_can_mark(text, uuid, text, text)
from public;

grant execute on function
  public.get_or_register_attendance_device(text, text, text, text, text),
  public.get_attendance_security_status(text, text, text),
  public.get_attendance_devices(),
  public.authorize_attendance_device(text, text, text),
  public.block_attendance_device(text, text),
  public.update_attendance_device(text, text, text),
  public.update_attendance_security_settings(jsonb),
  public.get_attendance_security_settings(),
  public.register_attendance_mark(uuid, text, text, text, text, text, text, text)
to authenticated, anon;

grant execute on function
  public.get_attendance_devices(),
  public.authorize_attendance_device(text, text, text),
  public.block_attendance_device(text, text),
  public.update_attendance_device(text, text, text),
  public.update_attendance_security_settings(jsonb),
  public.get_attendance_security_settings()
to authenticated;
