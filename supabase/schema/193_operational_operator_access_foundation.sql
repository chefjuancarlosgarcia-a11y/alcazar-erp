-- OS2: Operational PIN + operator sessions (Caja vertical slice foundation).
-- Apply after 192_operational_station_device_function_permissions.sql.
-- Does NOT alter cash_sessions logic; adds parallel operator session layer.

begin;

create extension if not exists pgcrypto;

-- Pepper for PIN lookup (rotate via app_settings update in controlled window).
insert into public.app_settings (key, value)
values (
  'operational_pin_pepper',
  jsonb_build_object(
    'version', 1,
    'pepper', encode(gen_random_bytes(32), 'hex'),
    'updated_at', now()
  )
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.operational_credentials (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  pin_hash text not null,
  pin_lookup text not null,
  status text not null default 'active'
    check (status in ('active', 'disabled')),
  failed_attempt_count int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint operational_credentials_pin_lookup_unique unique (pin_lookup)
);

create table if not exists public.operational_station_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  station_id uuid not null references public.operational_stations(id) on delete cascade,
  access_level text not null default 'operator'
    check (access_level in ('operator', 'supervisor')),
  active boolean not null default true,
  assigned_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_station_assignments_unique unique (profile_id, station_id)
);

create index if not exists operational_station_assignments_station_idx
  on public.operational_station_assignments (station_id, active);

create table if not exists public.operational_operator_sessions (
  id uuid primary key default gen_random_uuid(),
  operational_station_device_id uuid not null
    references public.operational_station_devices(id) on delete cascade,
  operational_station_id uuid not null
    references public.operational_stations(id) on delete cascade,
  operator_profile_id uuid not null references public.profiles(id) on delete restrict,
  module text not null check (module in ('cash', 'pos', 'kds', 'production')),
  session_token_hash text not null,
  idempotency_key text,
  issued_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  idle_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoke_reason text,
  created_at timestamptz not null default now(),
  constraint operational_operator_sessions_token_hash_unique unique (session_token_hash)
);

create unique index if not exists operational_operator_sessions_one_active_per_device_idx
  on public.operational_operator_sessions (operational_station_device_id)
  where revoked_at is null;

create unique index if not exists operational_operator_sessions_idempotency_idx
  on public.operational_operator_sessions (idempotency_key)
  where idempotency_key is not null and revoked_at is null;

create table if not exists public.operational_pin_attempt_buckets (
  bucket_key text primary key,
  attempt_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.operational_credentials enable row level security;
alter table public.operational_station_assignments enable row level security;
alter table public.operational_operator_sessions enable row level security;
alter table public.operational_pin_attempt_buckets enable row level security;

grant select on public.operational_credentials,
  public.operational_station_assignments,
  public.operational_operator_sessions,
  public.operational_pin_attempt_buckets
  to authenticated;
grant all on public.operational_credentials,
  public.operational_station_assignments,
  public.operational_operator_sessions,
  public.operational_pin_attempt_buckets
  to service_role;

-- default deny (no policies on sensitive tables)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.is_operational_access_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'rrhh', 'recursos_humanos'
      )
  );
$$;

create or replace function public.operational_pin_pepper_value()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(value ->> 'pepper', '')
  from public.app_settings
  where key = 'operational_pin_pepper';
$$;

create or replace function public.operational_pin_lookup(p_pin text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    public.digest(
      coalesce(public.operational_pin_pepper_value(), '') || ':' || trim(p_pin),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function public.operational_pin_pepper_value(), public.operational_pin_lookup(text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_operational_device_for_auth_user()
returns public.operational_station_devices
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
begin
  select * into v_device
  from public.operational_station_devices
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
  if v_device.id is null then
    return null;
  end if;
  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.id is null
    or v_station.status <> 'active'
    or v_device.status <> 'active' then
    return null;
  end if;
  return v_device;
end;
$$;

revoke all on function public.resolve_operational_device_for_auth_user()
  from public, anon, authenticated, service_role;

create or replace function public.record_operational_pin_attempt(p_bucket_key text, p_max int, p_lock_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.operational_pin_attempt_buckets;
  v_now timestamptz := now();
begin
  insert into public.operational_pin_attempt_buckets (bucket_key, attempt_count, locked_until)
  values (p_bucket_key, 0, null)
  on conflict (bucket_key) do nothing;

  select * into v_row
  from public.operational_pin_attempt_buckets
  where bucket_key = p_bucket_key
  for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return false;
  end if;

  update public.operational_pin_attempt_buckets
  set attempt_count = case
        when locked_until is not null and locked_until <= v_now then 1
        else attempt_count + 1
      end,
      locked_until = case
        when (case when locked_until is not null and locked_until <= v_now then 1 else attempt_count + 1 end) >= p_max
          then v_now + make_interval(secs => p_lock_seconds)
        else null
      end,
      updated_at = v_now
  where bucket_key = p_bucket_key;

  select * into v_row from public.operational_pin_attempt_buckets where bucket_key = p_bucket_key;
  return v_row.locked_until is null or v_row.locked_until <= v_now;
end;
$$;

create or replace function public.clear_operational_pin_attempt(p_bucket_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_pin_attempt_buckets
  set attempt_count = 0, locked_until = null, updated_at = now()
  where bucket_key = p_bucket_key;
end;
$$;

revoke all on function public.record_operational_pin_attempt(text, int, int), public.clear_operational_pin_attempt(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin: PIN + assignment
-- ---------------------------------------------------------------------------

create or replace function public.admin_set_operational_pin(
  p_profile_id uuid,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pin text := trim(p_pin);
  v_lookup text;
begin
  if not public.is_operational_access_admin() then
    raise exception 'No autorizado.';
  end if;
  if v_pin !~ '^\d{4}$' then
    raise exception 'El PIN operativo debe ser exactamente 4 digitos.';
  end if;
  v_lookup := public.operational_pin_lookup(v_pin);
  if exists (
    select 1 from public.operational_credentials c
    where c.pin_lookup = v_lookup and c.profile_id <> p_profile_id
  ) then
    raise exception 'PIN operativo no disponible.';
  end if;

  insert into public.operational_credentials (
    profile_id, pin_hash, pin_lookup, status, failed_attempt_count, locked_until, updated_by
  )
  values (
    p_profile_id,
    crypt(v_pin, gen_salt('bf')),
    v_lookup,
    'active',
    0,
    null,
    auth.uid()
  )
  on conflict (profile_id) do update
  set pin_hash = excluded.pin_hash,
      pin_lookup = excluded.pin_lookup,
      status = 'active',
      failed_attempt_count = 0,
      locked_until = null,
      updated_by = auth.uid(),
      updated_at = now();

  perform public.log_operational_station_event(
    null, null, 'operational_pin_reset', auth.uid(),
    jsonb_build_object('profile_id', p_profile_id), null
  );

  return jsonb_build_object('ok', true, 'pin', v_pin);
end;
$$;

create or replace function public.admin_assign_operational_station(
  p_profile_id uuid,
  p_station_id uuid,
  p_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_access_admin() then
    raise exception 'No autorizado.';
  end if;
  insert into public.operational_station_assignments (
    profile_id, station_id, active, assigned_by
  )
  values (p_profile_id, p_station_id, coalesce(p_active, true), auth.uid())
  on conflict (profile_id, station_id) do update
  set active = excluded.active,
      assigned_by = auth.uid(),
      updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_get_operational_access_summary(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cred public.operational_credentials;
  v_assignments jsonb;
begin
  if not public.is_operational_access_admin() then
    raise exception 'No autorizado.';
  end if;
  select * into v_cred from public.operational_credentials where profile_id = p_profile_id;
  select coalesce(jsonb_agg(jsonb_build_object(
    'station_id', a.station_id,
    'station_name', s.name,
    'station_type', s.station_type,
    'active', a.active
  )), '[]'::jsonb)
  into v_assignments
  from public.operational_station_assignments a
  join public.operational_stations s on s.id = a.station_id
  where a.profile_id = p_profile_id;

  return jsonb_build_object(
    'has_pin', v_cred.profile_id is not null and v_cred.status = 'active',
    'pin_status', coalesce(v_cred.status, 'none'),
    'assignments', v_assignments
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Device: verify PIN + operator session (auth.uid() = device user only)
-- ---------------------------------------------------------------------------

create or replace function public.verify_operational_pin_for_device(
  p_pin text,
  p_module text,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
  v_lookup text;
  v_cred public.operational_credentials;
  v_profile public.profiles;
  v_token text;
  v_token_hash text;
  v_idle_seconds int := 90;
  v_bucket text;
  v_existing public.operational_operator_sessions;
  v_session public.operational_operator_sessions;
  v_generic constant text := 'PIN o acceso no valido.';
begin
  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null then
    raise exception '%', v_generic;
  end if;

  select * into v_station from public.operational_stations where id = v_device.station_id;
  if p_module = 'cash' then
    if v_station.station_type <> 'cash' or v_station.cash_register_id is null then
      raise exception '%', v_generic;
    end if;
  end if;

  v_bucket := 'device:' || v_device.id::text;
  if not public.record_operational_pin_attempt(v_bucket, 8, 300) then
    raise exception '%', v_generic;
  end if;

  if trim(coalesce(p_pin, '')) !~ '^\d{4}$' then
    raise exception '%', v_generic;
  end if;

  v_lookup := public.operational_pin_lookup(p_pin);
  select c.* into v_cred
  from public.operational_credentials c
  where c.pin_lookup = v_lookup and c.status = 'active'
  limit 1;

  if v_cred.profile_id is null
    or crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash then
    raise exception '%', v_generic;
  end if;

  select * into v_profile from public.profiles where id = v_cred.profile_id and status = 'active';
  if v_profile.id is null then
    raise exception '%', v_generic;
  end if;

  if not exists (
    select 1 from public.operational_station_assignments a
    where a.profile_id = v_cred.profile_id
      and a.station_id = v_station.id
      and a.active
  ) then
    raise exception '%', v_generic;
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select * into v_existing
    from public.operational_operator_sessions
    where idempotency_key = trim(p_idempotency_key)
      and revoked_at is null
      and idle_expires_at > now()
    limit 1;
    if v_existing.id is not null then
      return jsonb_build_object(
        'ok', true,
        'session_token', null,
        'operator_profile_id', v_existing.operator_profile_id,
        'operator_name', v_profile.full_name,
        'idle_expires_at', v_existing.idle_expires_at,
        'idempotent', true
      );
    end if;
  end if;

  update public.operational_operator_sessions
  set revoked_at = now(), revoke_reason = 'superseded'
  where operational_station_device_id = v_device.id and revoked_at is null;

  v_token := encode(gen_random_bytes(32), 'hex');
  v_token_hash := encode(public.digest(v_token, 'sha256'), 'hex');

  insert into public.operational_operator_sessions (
    operational_station_device_id,
    operational_station_id,
    operator_profile_id,
    module,
    session_token_hash,
    idempotency_key,
    idle_expires_at
  )
  values (
    v_device.id,
    v_station.id,
    v_cred.profile_id,
    p_module,
    v_token_hash,
    nullif(trim(p_idempotency_key), ''),
    now() + make_interval(secs => v_idle_seconds)
  )
  returning * into v_session;

  perform public.clear_operational_pin_attempt(v_bucket);

  perform public.log_operational_station_event(
    v_station.id, v_device.id, 'operator_session_started', v_cred.profile_id,
    jsonb_build_object('module', p_module), nullif(trim(p_idempotency_key), '')
  );

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'operator_profile_id', v_cred.profile_id,
    'operator_name', v_profile.full_name,
    'idle_expires_at', v_session.idle_expires_at,
    'idempotent', false
  );
exception
  when others then
    raise exception '%', v_generic;
end;
$$;

create or replace function public.touch_operational_operator_session(p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_hash text := encode(public.digest(trim(p_session_token), 'sha256'), 'hex');
  v_session public.operational_operator_sessions;
  v_idle_seconds int := 90;
begin
  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_session
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
    and revoked_at is null
  for update;

  if v_session.id is null or v_session.idle_expires_at <= now() then
    if v_session.id is not null then
      update public.operational_operator_sessions
      set revoked_at = now(), revoke_reason = 'expired'
      where id = v_session.id;
      perform public.log_operational_station_event(
        v_session.operational_station_id, v_device.id, 'operator_session_expired',
        v_session.operator_profile_id, '{}'::jsonb, null
      );
    end if;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  update public.operational_operator_sessions
  set last_activity_at = now(),
      idle_expires_at = now() + make_interval(secs => v_idle_seconds)
  where id = v_session.id;

  return jsonb_build_object(
    'ok', true,
    'idle_expires_at', now() + make_interval(secs => v_idle_seconds)
  );
end;
$$;

create or replace function public.lock_operational_operator_session(
  p_session_token text,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_hash text := encode(public.digest(trim(p_session_token), 'sha256'), 'hex');
  v_session public.operational_operator_sessions;
begin
  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null then
    return jsonb_build_object('ok', true);
  end if;

  select * into v_session
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
    and revoked_at is null
  for update;

  if v_session.id is null then
    return jsonb_build_object('ok', true);
  end if;

  update public.operational_operator_sessions
  set revoked_at = now(), revoke_reason = coalesce(nullif(trim(p_reason), ''), 'locked')
  where id = v_session.id;

  perform public.log_operational_station_event(
    v_session.operational_station_id, v_device.id, 'operator_session_locked',
    v_session.operator_profile_id,
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'locked')),
    nullif(trim(p_idempotency_key), '')
  );

  return jsonb_build_object('ok', true);
end;
$$;

-- Extend device context for cash shell
create or replace function public.get_operational_station_device_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
begin
  select * into v_device
  from public.operational_station_devices
  where auth_user_id = auth.uid() and status = 'active'
  limit 1;
  if v_device.id is null then
    return jsonb_build_object('active', false);
  end if;
  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.status <> 'active' or v_device.status <> 'active' then
    return jsonb_build_object('active', false, 'reason', 'station_or_device_inactive');
  end if;
  return jsonb_build_object(
    'active', true,
    'device_id', v_device.id,
    'station_id', v_station.id,
    'station_name', v_station.name,
    'station_code', v_station.station_code,
    'station_type', v_station.station_type,
    'area_id', v_station.area_id,
    'cash_register_id', v_station.cash_register_id,
    'pos_floor_zone', v_station.pos_floor_zone
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants (explicit ACL)
-- ---------------------------------------------------------------------------

revoke all on function public.is_operational_access_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_operational_access_admin() to authenticated;

revoke all on function public.admin_set_operational_pin(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_operational_pin(uuid, text) to authenticated;

revoke all on function public.admin_assign_operational_station(uuid, uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.admin_assign_operational_station(uuid, uuid, boolean) to authenticated;

revoke all on function public.admin_get_operational_access_summary(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_get_operational_access_summary(uuid) to authenticated;

revoke all on function public.verify_operational_pin_for_device(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_operational_pin_for_device(text, text, text) to authenticated;

revoke all on function public.touch_operational_operator_session(text) from public, anon, authenticated, service_role;
grant execute on function public.touch_operational_operator_session(text) to authenticated;

revoke all on function public.lock_operational_operator_session(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.lock_operational_operator_session(text, text, text) to authenticated;

commit;
