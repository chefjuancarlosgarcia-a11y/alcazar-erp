-- OS1: Operational stations foundation (stations, devices, enrollment, events).
-- Apply after 187_pos_table_service_lifecycle.sql.
-- 188/189 reserved. Do not apply remotely without approval.

begin;

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Feature flag (default off)
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value)
values (
  'operational_stations_enabled',
  jsonb_build_object('enabled', false, 'updated_at', now())
)
on conflict (key) do nothing;

create or replace function public.operational_stations_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(value ->> 'enabled', '')::boolean
     from public.app_settings
     where key = 'operational_stations_enabled'),
    false
  );
$$;

create or replace function public.is_operational_stations_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in ('admin', 'gerente_general')
  );
$$;

revoke all on function public.operational_stations_enabled(), public.is_operational_stations_admin() from public;
grant execute on function public.operational_stations_enabled(), public.is_operational_stations_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.operational_stations (
  id uuid primary key default gen_random_uuid(),
  station_code text not null,
  name text not null,
  station_type text not null
    check (station_type in ('pos', 'kds', 'cash', 'production')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'inactive', 'revoked')),
  area_id text references public.areas(id) on delete restrict,
  cash_register_id uuid references public.cash_registers(id) on delete restrict,
  pos_floor_zone text,
  identity_mode text not null default 'individual'
    check (identity_mode in ('individual', 'team')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  disabled_at timestamptz,
  disabled_by uuid references public.profiles(id) on delete set null,
  constraint operational_stations_code_unique unique (station_code),
  constraint operational_stations_kds_area_chk check (
    station_type not in ('kds', 'production') or area_id is not null
  ),
  constraint operational_stations_cash_register_chk check (
    station_type <> 'cash' or cash_register_id is not null
  ),
  constraint operational_stations_team_mode_chk check (
    (station_type in ('kds', 'production') and identity_mode = 'team')
    or (station_type in ('pos', 'cash') and identity_mode = 'individual')
  )
);

create index if not exists operational_stations_type_status_idx
  on public.operational_stations (station_type, status);

create table if not exists public.operational_station_devices (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.operational_stations(id) on delete restrict,
  device_label text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'blocked', 'revoked', 'replaced')),
  auth_user_id uuid unique,
  enrollment_id uuid,
  user_agent_summary text,
  client_fingerprint text,
  confirmation_code text,
  claim_secret_hash text,
  claim_secret_expires_at timestamptz,
  claim_secret_consumed_at timestamptz,
  blocked_reason text,
  blocked_by uuid references public.profiles(id) on delete set null,
  blocked_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  replaced_by_device_id uuid references public.operational_station_devices(id) on delete set null,
  last_seen_at timestamptz,
  last_ip text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists operational_station_devices_one_active_per_station_idx
  on public.operational_station_devices (station_id)
  where status = 'active';

create unique index if not exists operational_station_devices_one_active_auth_user_idx
  on public.operational_station_devices (auth_user_id)
  where status = 'active' and auth_user_id is not null;

create index if not exists operational_station_devices_station_status_idx
  on public.operational_station_devices (station_id, status);

create table if not exists public.operational_station_enrollment_tokens (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.operational_stations(id) on delete restrict,
  token_hash text not null unique,
  status text not null default 'pending'
    check (status in (
      'pending', 'claimed', 'authorized', 'completed',
      'failed', 'revoked', 'expired', 'blocked'
    )),
  authorized_at timestamptz,
  authorized_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null,
  confirmation_code text not null,
  claimed_at timestamptz,
  claimed_fingerprint text,
  claimed_user_agent text,
  completed_device_id uuid references public.operational_station_devices(id) on delete set null,
  idempotency_key text,
  complete_idempotency_key text,
  device_claim_attempt_count int not null default 0,
  device_claim_locked_until timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists operational_station_enrollment_idempotency_idx
  on public.operational_station_enrollment_tokens (idempotency_key)
  where idempotency_key is not null;

create table if not exists public.operational_station_events (
  id uuid primary key default gen_random_uuid(),
  station_id uuid references public.operational_stations(id) on delete set null,
  station_device_id uuid references public.operational_station_devices(id) on delete set null,
  event_type text not null,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now()
);

create unique index if not exists operational_station_events_idempotency_idx
  on public.operational_station_events (idempotency_key)
  where idempotency_key is not null;

alter table public.operational_station_devices
  add constraint operational_station_devices_enrollment_fk
  foreign key (enrollment_id) references public.operational_station_enrollment_tokens(id) on delete set null;

alter table public.operational_stations enable row level security;
alter table public.operational_station_devices enable row level security;
alter table public.operational_station_enrollment_tokens enable row level security;
alter table public.operational_station_events enable row level security;

grant select on public.operational_stations, public.operational_station_devices,
  public.operational_station_enrollment_tokens, public.operational_station_events
  to authenticated;
grant all on public.operational_stations, public.operational_station_devices,
  public.operational_station_enrollment_tokens, public.operational_station_events
  to service_role;

-- ---------------------------------------------------------------------------
-- Event helper
-- ---------------------------------------------------------------------------

create or replace function public.log_operational_station_event(
  p_station_id uuid,
  p_station_device_id uuid,
  p_event_type text,
  p_actor_profile_id uuid,
  p_payload jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.operational_station_events (
    station_id, station_device_id, event_type, actor_profile_id, payload, idempotency_key
  )
  values (
    p_station_id, p_station_device_id, p_event_type, p_actor_profile_id,
    coalesce(p_payload, '{}'::jsonb), nullif(trim(p_idempotency_key), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.log_operational_station_event(uuid, uuid, text, uuid, jsonb, text) from public;

-- ---------------------------------------------------------------------------
-- Admin: provision / update station
-- ---------------------------------------------------------------------------

create or replace function public.provision_operational_station(
  p_station_code text,
  p_name text,
  p_station_type text,
  p_area_id text default null,
  p_cash_register_id uuid default null,
  p_pos_floor_zone text default null
)
returns public.operational_stations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.operational_stations;
  v_mode text := case when p_station_type in ('kds', 'production') then 'team' else 'individual' end;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  insert into public.operational_stations (
    station_code, name, station_type, status, area_id, cash_register_id,
    pos_floor_zone, identity_mode, created_by
  )
  values (
    lower(trim(p_station_code)),
    trim(p_name),
    lower(trim(p_station_type)),
    'draft',
    nullif(trim(p_area_id), ''),
    p_cash_register_id,
    nullif(trim(p_pos_floor_zone), ''),
    v_mode,
    auth.uid()
  )
  returning * into v_row;
  perform public.log_operational_station_event(
    v_row.id, null, 'station_created', auth.uid(),
    jsonb_build_object('station_code', v_row.station_code), null
  );
  return v_row;
end;
$$;

create or replace function public.update_operational_station(
  p_station_id uuid,
  p_name text default null,
  p_status text default null,
  p_area_id text default null,
  p_pos_floor_zone text default null
)
returns public.operational_stations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.operational_stations;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  update public.operational_stations
  set
    name = coalesce(nullif(trim(p_name), ''), name),
    status = coalesce(nullif(trim(p_status), ''), status),
    area_id = coalesce(nullif(trim(p_area_id), ''), area_id),
    pos_floor_zone = coalesce(nullif(trim(p_pos_floor_zone), ''), pos_floor_zone),
    updated_at = now(),
    disabled_at = case when coalesce(p_status, status) in ('inactive', 'revoked') then now() else disabled_at end,
    disabled_by = case when coalesce(p_status, status) in ('inactive', 'revoked') then auth.uid() else disabled_by end
  where id = p_station_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Estacion no encontrada.';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enrollment token (admin) — plain token returned once in JSON only to caller
-- ---------------------------------------------------------------------------

create or replace function public.create_station_enrollment_token(
  p_station_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = '', extensions
as $$
declare
  v_station public.operational_stations;
  v_token text;
  v_hash text;
  v_row public.operational_station_enrollment_tokens;
  v_code text;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  select * into v_station from public.operational_stations where id = p_station_id;
  if v_station.id is null then
    raise exception 'Estacion no encontrada.';
  end if;
  if v_station.status not in ('active', 'draft') then
    raise exception 'Estacion no disponible para enrollment.';
  end if;
  if nullif(trim(p_idempotency_key), '') is not null then
    select * into v_row
    from public.operational_station_enrollment_tokens
    where idempotency_key = trim(p_idempotency_key);
    if v_row.id is not null then
      return jsonb_build_object(
        'enrollment_id', v_row.id,
        'expires_at', v_row.expires_at,
        'status', v_row.status,
        'idempotent', true
      );
    end if;
  end if;
  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_code := lpad((floor(random() * 1000000)::int)::text, 6, '0');
  insert into public.operational_station_enrollment_tokens (
    station_id, token_hash, status, expires_at, confirmation_code,
    idempotency_key, created_by
  )
  values (
    p_station_id, v_hash, 'pending', now() + interval '15 minutes', v_code,
    nullif(trim(p_idempotency_key), ''), auth.uid()
  )
  returning * into v_row;
  perform public.log_operational_station_event(
    p_station_id, null, 'enrollment_created', auth.uid(),
    jsonb_build_object('enrollment_id', v_row.id), p_idempotency_key
  );
  return jsonb_build_object(
    'enrollment_id', v_row.id,
    'enrollment_token', v_token,
    'confirmation_code', v_code,
    'expires_at', v_row.expires_at,
    'station_id', p_station_id,
    'station_name', v_station.name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim secret verification (SHA-256 hex, constant length)
-- ---------------------------------------------------------------------------

create or replace function public.record_operational_enrollment_secret_attempt(
  p_enrollment_id uuid,
  p_success boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_success then
    update public.operational_station_enrollment_tokens
    set device_claim_attempt_count = 0, device_claim_locked_until = null, updated_at = now()
    where id = p_enrollment_id;
    return;
  end if;
  update public.operational_station_enrollment_tokens
  set device_claim_attempt_count = device_claim_attempt_count + 1,
      device_claim_locked_until = case
        when device_claim_attempt_count + 1 >= 10 then now() + interval '15 minutes'
        else device_claim_locked_until
      end,
      updated_at = now()
  where id = p_enrollment_id
  returning device_claim_attempt_count into v_count;
end;
$$;

create or replace function public.verify_operational_device_claim_secret(
  p_device_id uuid,
  p_enrollment_id uuid,
  p_claim_secret_hash text,
  p_require_unconsumed boolean default true
)
returns public.operational_station_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_tok public.operational_station_enrollment_tokens;
  v_hash text;
begin
  v_hash := lower(trim(p_claim_secret_hash));
  if v_hash is null or length(v_hash) <> 64 or v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Solicitud invalida.';
  end if;
  select * into v_tok from public.operational_station_enrollment_tokens where id = p_enrollment_id;
  if v_tok.id is null then
    raise exception 'Solicitud invalida.';
  end if;
  if v_tok.device_claim_locked_until is not null and v_tok.device_claim_locked_until > now() then
    raise exception 'Solicitud invalida.';
  end if;
  select * into v_device from public.operational_station_devices
  where id = p_device_id and enrollment_id = p_enrollment_id
  for update;
  if v_device.id is null then
    perform public.record_operational_enrollment_secret_attempt(p_enrollment_id, false);
    raise exception 'Solicitud invalida.';
  end if;
  if v_device.claim_secret_hash is distinct from v_hash then
    perform public.record_operational_enrollment_secret_attempt(p_enrollment_id, false);
    raise exception 'Solicitud invalida.';
  end if;
  if v_device.claim_secret_expires_at is not null and v_device.claim_secret_expires_at < now() then
    raise exception 'Solicitud invalida.';
  end if;
  if p_require_unconsumed and v_device.claim_secret_consumed_at is not null then
    raise exception 'Solicitud invalida.';
  end if;
  perform public.record_operational_enrollment_secret_attempt(p_enrollment_id, true);
  return v_device;
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim (device) — stores claim_secret_hash only; plain secret returned once by Edge
-- ---------------------------------------------------------------------------

create or replace function public.claim_station_enrollment(
  p_token text,
  p_claim_secret_hash text,
  p_client_fingerprint text,
  p_user_agent text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = '', extensions
as $$
declare
  v_hash text;
  v_secret_hash text;
  v_tok public.operational_station_enrollment_tokens;
  v_device public.operational_station_devices;
  v_blocked boolean;
begin
  v_secret_hash := lower(trim(p_claim_secret_hash));
  if nullif(trim(p_token), '') is null
    or v_secret_hash is null
    or length(v_secret_hash) <> 64
    or v_secret_hash !~ '^[0-9a-f]{64}$'
    or nullif(trim(p_client_fingerprint), '') is null then
    raise exception 'Solicitud invalida.';
  end if;
  v_hash := encode(extensions.digest(trim(p_token), 'sha256'), 'hex');
  select * into v_tok
  from public.operational_station_enrollment_tokens
  where token_hash = v_hash
  for update;
  if v_tok.id is null or v_tok.status in ('revoked', 'expired', 'failed', 'blocked') then
    raise exception 'Solicitud invalida.';
  end if;
  if v_tok.device_claim_locked_until is not null and v_tok.device_claim_locked_until > now() then
    raise exception 'Solicitud invalida.';
  end if;
  if v_tok.expires_at < now() then
    update public.operational_station_enrollment_tokens set status = 'expired', updated_at = now()
    where id = v_tok.id;
    raise exception 'Solicitud invalida.';
  end if;
  select exists (
    select 1 from public.operational_station_devices d
    where d.client_fingerprint = trim(p_client_fingerprint)
      and d.status = 'blocked'
  ) into v_blocked;
  if v_blocked then
    raise exception 'Solicitud invalida.';
  end if;
  if v_tok.status = 'claimed' and v_tok.claimed_fingerprint = trim(p_client_fingerprint) then
    select * into v_device from public.operational_station_devices
    where enrollment_id = v_tok.id limit 1;
    return jsonb_build_object(
      'enrollment_id', v_tok.id,
      'device_id', v_device.id,
      'confirmation_code', v_tok.confirmation_code,
      'status', 'claimed',
      'idempotent', true,
      'claim_secret_issued', false
    );
  end if;
  if v_tok.status <> 'pending' then
    raise exception 'Solicitud invalida.';
  end if;
  insert into public.operational_station_devices (
    station_id, status, enrollment_id, client_fingerprint, user_agent_summary, confirmation_code,
    claim_secret_hash, claim_secret_expires_at
  )
  values (
    v_tok.station_id, 'pending', v_tok.id, trim(p_client_fingerprint),
    left(coalesce(trim(p_user_agent), ''), 200), v_tok.confirmation_code,
    v_secret_hash, v_tok.expires_at
  )
  returning * into v_device;
  update public.operational_station_enrollment_tokens
  set status = 'claimed', claimed_at = now(), claimed_fingerprint = trim(p_client_fingerprint),
      claimed_user_agent = left(coalesce(trim(p_user_agent), ''), 500),
      device_claim_attempt_count = 0, device_claim_locked_until = null, updated_at = now()
  where id = v_tok.id;
  perform public.log_operational_station_event(
    v_tok.station_id, v_device.id, 'enrollment_claimed', null,
    jsonb_build_object('fingerprint', left(trim(p_client_fingerprint), 8)), p_idempotency_key
  );
  return jsonb_build_object(
    'enrollment_id', v_tok.id,
    'device_id', v_device.id,
    'confirmation_code', v_tok.confirmation_code,
    'status', 'claimed',
    'claim_secret_issued', true
  );
exception
  when others then
    raise exception 'Solicitud invalida.';
end;
$$;

-- ---------------------------------------------------------------------------
-- Authorize / reject (admin) — no Auth user; device stays pending until complete
-- ---------------------------------------------------------------------------

create or replace function public.authorize_station_device_enrollment(
  p_device_id uuid,
  p_confirmation_code text,
  p_device_label text default null,
  p_reason text default null
)
returns public.operational_station_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_tok public.operational_station_enrollment_tokens;
  v_station public.operational_stations;
  v_active_count int;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  select * into v_device from public.operational_station_devices where id = p_device_id for update;
  if v_device.id is null or v_device.status <> 'pending' then
    raise exception 'Dispositivo no pendiente.';
  end if;
  select * into v_tok from public.operational_station_enrollment_tokens where id = v_device.enrollment_id for update;
  if v_tok.id is null or v_tok.status <> 'claimed' then
    raise exception 'Enrollment no disponible.';
  end if;
  if v_tok.expires_at < now() then
    update public.operational_station_enrollment_tokens set status = 'expired', updated_at = now()
    where id = v_tok.id;
    raise exception 'Enrollment vencido.';
  end if;
  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.status in ('inactive', 'revoked') then
    raise exception 'Estacion no disponible.';
  end if;
  if v_tok.confirmation_code <> trim(p_confirmation_code) then
    raise exception 'Codigo de confirmacion invalido.';
  end if;
  select count(*) into v_active_count from public.operational_station_devices
  where station_id = v_device.station_id and status = 'active';
  if v_active_count > 0 then
    raise exception 'La estacion ya tiene un dispositivo activo.';
  end if;
  update public.operational_station_devices
  set device_label = coalesce(nullif(trim(p_device_label), ''), device_label),
      updated_at = now()
  where id = p_device_id
  returning * into v_device;
  update public.operational_station_enrollment_tokens
  set status = 'authorized', authorized_at = now(), authorized_by = auth.uid(), updated_at = now()
  where id = v_tok.id;
  perform public.log_operational_station_event(
    v_device.station_id, v_device.id, 'device_enrollment_authorized', auth.uid(),
    jsonb_build_object('reason', nullif(trim(p_reason), '')), null
  );
  return v_device;
end;
$$;

create or replace function public.reject_and_block_station_device(
  p_device_id uuid,
  p_reason text default null
)
returns public.operational_station_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  select * into v_device from public.operational_station_devices where id = p_device_id for update;
  if v_device.id is null then
    raise exception 'Dispositivo no encontrado.';
  end if;
  update public.operational_station_devices
  set status = 'blocked', blocked_reason = nullif(trim(p_reason), ''),
      blocked_by = auth.uid(), blocked_at = now(), updated_at = now()
  where id = p_device_id
  returning * into v_device;
  update public.operational_station_enrollment_tokens
  set status = 'blocked', updated_at = now()
  where id = v_device.enrollment_id;
  perform public.log_operational_station_event(
    v_device.station_id, v_device.id, 'device_rejected', auth.uid(),
    jsonb_build_object('reason', v_device.blocked_reason), null
  );
  return v_device;
end;
$$;

create or replace function public.get_device_enrollment_status(
  p_device_id uuid,
  p_enrollment_id uuid,
  p_claim_secret_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_tok public.operational_station_enrollment_tokens;
  v_public_status text;
begin
  begin
    v_device := public.verify_operational_device_claim_secret(
      p_device_id, p_enrollment_id, p_claim_secret_hash, true
    );
  exception
    when others then
      return jsonb_build_object('status', 'invalid');
  end;
  select * into v_tok from public.operational_station_enrollment_tokens where id = p_enrollment_id;
  if v_tok.expires_at < now() and v_tok.status not in ('completed', 'failed') then
    return jsonb_build_object('status', 'expired');
  end if;
  v_public_status := case v_tok.status
    when 'claimed' then 'waiting_authorization'
    when 'authorized' then 'authorized'
    when 'blocked' then 'blocked'
    when 'expired' then 'expired'
    when 'completed' then 'completed'
    when 'failed' then 'failed'
    else 'invalid'
  end;
  if v_device.status = 'blocked' then
    v_public_status := 'blocked';
  end if;
  return jsonb_build_object('status', v_public_status);
end;
$$;

create or replace function public.finalize_station_device_enrollment(
  p_device_id uuid,
  p_enrollment_id uuid,
  p_auth_user_id uuid,
  p_claim_secret_hash text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_tok public.operational_station_enrollment_tokens;
  v_station public.operational_stations;
  v_active_count int;
begin
  if nullif(trim(p_idempotency_key), '') is null or p_auth_user_id is null then
    raise exception 'Solicitud invalida.';
  end if;
  v_device := public.verify_operational_device_claim_secret(
    p_device_id, p_enrollment_id, p_claim_secret_hash, true
  );
  select * into v_tok from public.operational_station_enrollment_tokens where id = p_enrollment_id for update;
  if v_tok.status = 'completed' then
    raise exception 'Solicitud invalida.';
  end if;
  if v_tok.status <> 'authorized' or v_tok.expires_at < now() then
    raise exception 'Solicitud invalida.';
  end if;
  if v_device.status <> 'pending' then
    raise exception 'Solicitud invalida.';
  end if;
  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.status not in ('active', 'draft') then
    raise exception 'Solicitud invalida.';
  end if;
  select count(*) into v_active_count from public.operational_station_devices
  where station_id = v_device.station_id and status = 'active';
  if v_active_count > 0 then
    raise exception 'Solicitud invalida.';
  end if;
  update public.operational_station_devices
  set status = 'active', auth_user_id = p_auth_user_id, activated_at = now(),
      claim_secret_consumed_at = now(), claim_secret_hash = null, updated_at = now()
  where id = p_device_id
  returning * into v_device;
  update public.operational_station_enrollment_tokens
  set status = 'completed', completed_device_id = v_device.id,
      complete_idempotency_key = trim(p_idempotency_key), updated_at = now()
  where id = v_tok.id;
  update public.operational_stations set status = 'active', updated_at = now()
  where id = v_device.station_id and status = 'draft';
  perform public.log_operational_station_event(
    v_device.station_id, v_device.id, 'device_enrollment_completed', null,
    '{}'::jsonb, trim(p_idempotency_key)
  );
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fail_station_device_enrollment(
  p_device_id uuid,
  p_enrollment_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
begin
  select * into v_device from public.operational_station_devices
  where id = p_device_id and enrollment_id = p_enrollment_id for update;
  if v_device.id is null then
    return;
  end if;
  update public.operational_station_devices
  set status = 'blocked', blocked_reason = coalesce(nullif(trim(p_reason), ''), 'enrollment_failed'),
      blocked_at = now(), updated_at = now()
  where id = p_device_id;
  update public.operational_station_enrollment_tokens
  set status = 'failed', updated_at = now()
  where id = p_enrollment_id and status <> 'completed';
  perform public.log_operational_station_event(
    v_device.station_id, v_device.id, 'device_enrollment_failed', null,
    jsonb_build_object('reason', nullif(trim(p_reason), '')), null
  );
end;
$$;

create or replace function public.revoke_station_device(
  p_device_id uuid,
  p_reason text default null
)
returns public.operational_station_devices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  update public.operational_station_devices
  set status = 'revoked', revoked_at = now(), updated_at = now(),
      metadata = metadata || jsonb_build_object('revoke_reason', nullif(trim(p_reason), ''))
  where id = p_device_id and status = 'active'
  returning * into v_device;
  if v_device.id is null then
    raise exception 'Dispositivo activo no encontrado.';
  end if;
  perform public.log_operational_station_event(
    v_device.station_id, v_device.id, 'device_revoked', auth.uid(), '{}'::jsonb, null
  );
  return v_device;
end;
$$;

create or replace function public.replace_station_device(
  p_device_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.operational_station_devices;
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  select * into v_old from public.operational_station_devices where id = p_device_id for update;
  if v_old.status <> 'active' then
    raise exception 'Solo se reemplaza un dispositivo activo.';
  end if;
  update public.operational_station_devices
  set status = 'replaced', updated_at = now(),
      metadata = metadata || jsonb_build_object('replace_reason', nullif(trim(p_reason), ''))
  where id = p_device_id;
  perform public.log_operational_station_event(
    v_old.station_id, v_old.id, 'device_replaced', auth.uid(), '{}'::jsonb, null
  );
  return jsonb_build_object('station_id', v_old.station_id, 'replaced_device_id', v_old.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists (admin)
-- ---------------------------------------------------------------------------

create or replace function public.list_operational_stations_admin()
returns setof public.operational_stations
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  return query select * from public.operational_stations order by name;
end;
$$;

create or replace function public.list_operational_station_devices_admin(
  p_station_id uuid default null,
  p_status text default null
)
returns setof public.operational_station_devices
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_operational_stations_admin() then
    raise exception 'No autorizado.';
  end if;
  return query
  select d.*
  from public.operational_station_devices d
  where (p_station_id is null or d.station_id = p_station_id)
    and (p_status is null or d.status = p_status)
  order by d.created_at desc;
end;
$$;

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
    'station_type', v_station.station_type,
    'area_id', v_station.area_id
  );
end;
$$;

create or replace function public.touch_operational_station_device_seen(p_ip text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_station_devices
  set last_seen_at = now(), last_ip = nullif(trim(p_ip), ''), updated_at = now()
  where auth_user_id = auth.uid() and status = 'active';
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS policies (default deny; read via RPC mostly)
-- ---------------------------------------------------------------------------

drop policy if exists operational_stations_admin_all on public.operational_stations;
create policy operational_stations_admin_all on public.operational_stations
  for all to authenticated
  using (public.is_operational_stations_admin())
  with check (public.is_operational_stations_admin());

drop policy if exists operational_station_devices_admin_all on public.operational_station_devices;
create policy operational_station_devices_admin_all on public.operational_station_devices
  for all to authenticated
  using (public.is_operational_stations_admin())
  with check (public.is_operational_stations_admin());

drop policy if exists operational_station_devices_self_read on public.operational_station_devices;
create policy operational_station_devices_self_read on public.operational_station_devices
  for select to authenticated
  using (auth_user_id = auth.uid());

drop policy if exists operational_station_events_admin_read on public.operational_station_events;
create policy operational_station_events_admin_read on public.operational_station_events
  for select to authenticated
  using (public.is_operational_stations_admin());

-- ---------------------------------------------------------------------------
-- Grants (no anon on admin; claim via service role / edge)
-- ---------------------------------------------------------------------------

revoke all on function
  public.log_operational_station_event(uuid, uuid, text, uuid, jsonb, text),
  public.verify_operational_device_claim_secret(uuid, uuid, text, boolean),
  public.record_operational_enrollment_secret_attempt(uuid, boolean),
  public.get_device_enrollment_status(uuid, uuid, text),
  public.finalize_station_device_enrollment(uuid, uuid, uuid, text, text),
  public.fail_station_device_enrollment(uuid, uuid, text)
from public;

grant execute on function
  public.provision_operational_station(text, text, text, text, uuid, text),
  public.update_operational_station(uuid, text, text, text, text),
  public.create_station_enrollment_token(uuid, text),
  public.authorize_station_device_enrollment(uuid, text, text, text),
  public.reject_and_block_station_device(uuid, text),
  public.revoke_station_device(uuid, text),
  public.replace_station_device(uuid, text),
  public.list_operational_stations_admin(),
  public.list_operational_station_devices_admin(uuid, text),
  public.get_operational_station_device_context(),
  public.touch_operational_station_device_seen(text),
  public.is_operational_stations_admin()
to authenticated;

grant execute on function
  public.claim_station_enrollment(text, text, text, text, text),
  public.verify_operational_device_claim_secret(uuid, uuid, text, boolean),
  public.record_operational_enrollment_secret_attempt(uuid, boolean),
  public.get_device_enrollment_status(uuid, uuid, text),
  public.finalize_station_device_enrollment(uuid, uuid, uuid, text, text),
  public.fail_station_device_enrollment(uuid, uuid, text)
to service_role;

commit;
