-- OS2: Operational station POS shared foundation (feature flag, idempotency, operator context, open table).
-- Apply after 197_fix_operational_pin_module_station_type.sql.

begin;

-- ---------------------------------------------------------------------------
-- Feature flag (default off)
-- ---------------------------------------------------------------------------

insert into public.app_settings (key, value)
values (
  'operational_station_pos_enabled',
  jsonb_build_object('enabled', false, 'updated_at', now())
)
on conflict (key) do nothing;

create or replace function public.operational_station_pos_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(value ->> 'enabled', '')::boolean
     from public.app_settings
     where key = 'operational_station_pos_enabled'),
    false
  );
$$;

create or replace function public.is_operational_station_pos_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.operational_station_pos_enabled();
$$;

revoke all on function public.operational_station_pos_enabled(), public.is_operational_station_pos_enabled()
  from public, anon, authenticated;
grant execute on function public.operational_station_pos_enabled(), public.is_operational_station_pos_enabled()
  to authenticated;

-- ---------------------------------------------------------------------------
-- Idempotency + audit tables
-- ---------------------------------------------------------------------------

create table if not exists public.operational_station_pos_idempotency (
  device_id uuid not null references public.operational_station_devices(id) on delete cascade,
  idempotency_key text not null,
  operation text not null,
  request_fingerprint text not null,
  operator_session_id uuid not null references public.operational_operator_sessions(id) on delete cascade,
  station_id uuid not null references public.operational_stations(id) on delete cascade,
  result jsonb not null default jsonb_build_object('idempotency_status', 'pending'),
  created_at timestamptz not null default now(),
  primary key (device_id, idempotency_key)
);

comment on table public.operational_station_pos_idempotency is
  'Idempotencia transaccional estación POS. Retención operativa: limpieza periódica recomendada. Sin PIN ni token operador.';

create index if not exists operational_station_pos_idempotency_station_created_idx
  on public.operational_station_pos_idempotency (station_id, created_at desc);

alter table public.operational_station_pos_idempotency enable row level security;
grant select on public.operational_station_pos_idempotency to authenticated;
grant all on public.operational_station_pos_idempotency to service_role;

create table if not exists public.operational_station_pos_action_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.pos_orders(id) on delete set null,
  operator_profile_id uuid not null references public.profiles(id) on delete restrict,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  operational_station_id uuid not null references public.operational_stations(id) on delete restrict,
  operational_station_device_id uuid not null references public.operational_station_devices(id) on delete restrict,
  operator_session_id uuid not null references public.operational_operator_sessions(id) on delete restrict,
  action text not null,
  payload_fingerprint text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists operational_station_pos_action_audit_order_idx
  on public.operational_station_pos_action_audit (order_id, created_at desc);

create index if not exists operational_station_pos_action_audit_operator_idx
  on public.operational_station_pos_action_audit (operator_profile_id, created_at desc);

create index if not exists operational_station_pos_action_audit_station_idx
  on public.operational_station_pos_action_audit (operational_station_id, created_at desc);

create index if not exists operational_station_pos_action_audit_created_idx
  on public.operational_station_pos_action_audit (created_at desc);

alter table public.operational_station_pos_action_audit enable row level security;

-- ---------------------------------------------------------------------------
-- Internal helpers
-- ---------------------------------------------------------------------------

create or replace function public.station_pos_can_operate_orders(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.status = 'active'
      and public.normalize_profile_role(p.role) in (
        'admin', 'gerente_general', 'cajero', 'caja', 'mesero', 'servicio', 'supervisor'
      )
  );
$$;

revoke all on function public.station_pos_can_operate_orders(uuid) from public, anon, authenticated, service_role;

create or replace function public.station_pos_request_fingerprint(
  p_operation text,
  p_payload jsonb
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

revoke all on function public.station_pos_request_fingerprint(text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.station_pos_resolve_idempotency_key(
  p_key text,
  p_fingerprint text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := nullif(trim(coalesce(p_key, '')), '');
begin
  if v_key is null then
    raise exception 'Se requiere clave de idempotencia.';
  end if;

  if v_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return lower(v_key);
  end if;

  return 'fp:' || coalesce(p_fingerprint, '');
end;
$$;

revoke all on function public.station_pos_resolve_idempotency_key(text, text) from public, anon, authenticated, service_role;

create or replace function public.station_pos_extend_operator_idle(p_operator_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_operator_sessions
  set last_activity_at = now(),
      idle_expires_at = now() + interval '120 seconds'
  where id = p_operator_session_id
    and revoked_at is null
    and idle_expires_at > now()
    and (absolute_expires_at is null or absolute_expires_at > now());
end;
$$;

revoke all on function public.station_pos_extend_operator_idle(uuid) from public, anon, authenticated, service_role;

create or replace function public.station_pos_idempotency_begin(
  p_device_id uuid,
  p_station_id uuid,
  p_operator_session_id uuid,
  p_key text,
  p_operation text,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.operational_station_pos_idempotency;
  v_key text := nullif(trim(coalesce(p_key, '')), '');
begin
  if v_key is null then
    raise exception 'Se requiere clave de idempotencia.';
  end if;

  insert into public.operational_station_pos_idempotency (
    device_id, idempotency_key, operation, request_fingerprint,
    operator_session_id, station_id, result
  ) values (
    p_device_id, v_key, p_operation, p_fingerprint,
    p_operator_session_id, p_station_id,
    jsonb_build_object('idempotency_status', 'pending')
  )
  on conflict (device_id, idempotency_key) do nothing;

  select * into v_row
  from public.operational_station_pos_idempotency
  where device_id = p_device_id and idempotency_key = v_key
  for update;

  if not found then
    raise exception 'No se pudo reservar idempotencia.';
  end if;

  if v_row.request_fingerprint is distinct from p_fingerprint then
    raise exception 'Conflicto de idempotencia: la clave ya se usó con otra operación.';
  end if;

  if v_row.operation is distinct from p_operation then
    raise exception 'Conflicto de idempotencia: tipo de operación distinto.';
  end if;

  if v_row.operator_session_id is distinct from p_operator_session_id then
    raise exception 'Operacion no permitida.';
  end if;

  if coalesce(v_row.result ->> 'idempotency_status', '') = 'completed' then
    return v_row.result;
  end if;

  return null;
end;
$$;

revoke all on function public.station_pos_idempotency_begin(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_idempotency_complete(
  p_device_id uuid,
  p_key text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_station_pos_idempotency
  set result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object('idempotency_status', 'completed')
  where device_id = p_device_id
    and idempotency_key = nullif(trim(coalesce(p_key, '')), '');
end;
$$;

revoke all on function public.station_pos_idempotency_complete(uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_bind_operator_session_by_token(
  p_operator_session_token text,
  out p_device_id uuid,
  out p_station_id uuid,
  out p_operator_session_id uuid,
  out p_operator_profile_id uuid,
  out p_session_revoked boolean,
  out p_revoke_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
  v_hash text;
  v_op public.operational_operator_sessions;
  v_generic constant text := 'Operacion no permitida.';
begin
  if nullif(trim(coalesce(p_operator_session_token, '')), '') is null then
    raise exception '%', v_generic;
  end if;

  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null then
    raise exception '%', v_generic;
  end if;

  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.id is null
    or v_station.status <> 'active'
    or v_station.station_type <> 'pos' then
    raise exception '%', v_generic;
  end if;

  v_hash := encode(extensions.digest(trim(p_operator_session_token), 'sha256'), 'hex');
  select * into v_op
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
  order by created_at desc
  limit 1;

  if v_op.id is null
    or v_op.module <> 'pos'
    or v_op.operational_station_id <> v_station.id then
    raise exception '%', v_generic;
  end if;

  p_device_id := v_device.id;
  p_station_id := v_station.id;
  p_operator_session_id := v_op.id;
  p_operator_profile_id := v_op.operator_profile_id;
  p_session_revoked := v_op.revoked_at is not null;
  p_revoke_reason := v_op.revoke_reason;
end;
$$;

revoke all on function public.station_pos_bind_operator_session_by_token(text)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_idempotency_replay_if_completed(
  p_operator_session_token text,
  p_operation text,
  p_key text,
  p_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device_id uuid;
  v_station_id uuid;
  v_op_session_id uuid;
  v_operator_profile_id uuid;
  v_revoked boolean;
  v_revoke_reason text;
  v_row public.operational_station_pos_idempotency;
  v_key text := nullif(trim(coalesce(p_key, '')), '');
begin
  if v_key is null then
    raise exception 'Se requiere clave de idempotencia.';
  end if;

  select
    b.p_device_id, b.p_station_id, b.p_operator_session_id, b.p_operator_profile_id,
    b.p_session_revoked, b.p_revoke_reason
  into
    v_device_id, v_station_id, v_op_session_id, v_operator_profile_id, v_revoked, v_revoke_reason
  from public.station_pos_bind_operator_session_by_token(p_operator_session_token) b;

  select * into v_row
  from public.operational_station_pos_idempotency
  where device_id = v_device_id
    and idempotency_key = v_key;

  if not found then
    return null;
  end if;

  if v_row.operator_session_id is distinct from v_op_session_id then
    raise exception 'Operacion no permitida.';
  end if;

  if v_row.station_id is distinct from v_station_id then
    raise exception 'Operacion no permitida.';
  end if;

  if v_row.operation is distinct from p_operation then
    raise exception 'Conflicto de idempotencia: tipo de operación distinto.';
  end if;

  if v_row.request_fingerprint is distinct from p_fingerprint then
    raise exception 'Conflicto de idempotencia: la clave ya se usó con otra operación.';
  end if;

  if coalesce(v_row.result ->> 'idempotency_status', '') = 'completed' then
    return v_row.result;
  end if;

  return null;
end;
$$;

revoke all on function public.station_pos_idempotency_replay_if_completed(text, text, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.resolve_station_pos_operator_context(
  p_operator_session_token text,
  p_extend_idle boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
  v_hash text;
  v_op_session public.operational_operator_sessions;
  v_operator public.profiles;
  v_idle_expires timestamptz;
  v_absolute_expires timestamptz;
  v_generic constant text := 'Operacion no permitida.';
  v_pin_generic constant text := 'PIN o acceso no valido.';
begin
  if not public.operational_stations_enabled() or not public.operational_station_pos_enabled() then
    raise exception '%', v_generic;
  end if;

  if nullif(trim(coalesce(p_operator_session_token, '')), '') is null then
    raise exception '%', v_pin_generic;
  end if;

  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null or v_device.status <> 'active' then
    raise exception '%', v_generic;
  end if;

  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.id is null
    or v_station.status <> 'active'
    or v_station.station_type <> 'pos' then
    raise exception '%', v_generic;
  end if;

  v_hash := encode(extensions.digest(trim(p_operator_session_token), 'sha256'), 'hex');
  select * into v_op_session
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
    and revoked_at is null
  for update;

  if v_op_session.id is null
    or v_op_session.idle_expires_at <= now()
    or (v_op_session.absolute_expires_at is not null and v_op_session.absolute_expires_at <= now()) then
    if v_op_session.id is not null then
      update public.operational_operator_sessions
      set revoked_at = now(), revoke_reason = 'expired'
      where id = v_op_session.id;
    end if;
    raise exception '%', v_pin_generic;
  end if;

  if v_op_session.module <> 'pos'
    or v_op_session.operational_station_id <> v_station.id then
    raise exception '%', v_generic;
  end if;

  select * into v_operator from public.profiles where id = v_op_session.operator_profile_id;
  if v_operator.id is null or v_operator.status <> 'active' then
    raise exception '%', v_generic;
  end if;

  if not exists (
    select 1 from public.operational_station_assignments a
    where a.profile_id = v_operator.id
      and a.station_id = v_station.id
      and a.active
  ) then
    raise exception '%', v_generic;
  end if;

  if not public.station_pos_can_operate_orders(v_operator.id) then
    raise exception '%', v_generic;
  end if;

  v_absolute_expires := v_op_session.absolute_expires_at;

  if coalesce(p_extend_idle, true) then
    perform public.station_pos_extend_operator_idle(v_op_session.id);
    select idle_expires_at into v_idle_expires
    from public.operational_operator_sessions
    where id = v_op_session.id;
  else
    v_idle_expires := v_op_session.idle_expires_at;
  end if;

  return jsonb_build_object(
    'device_id', v_device.id,
    'station_id', v_station.id,
    'station_name', v_station.name,
    'station_code', v_station.station_code,
    'pos_floor_zone', v_station.pos_floor_zone,
    'operator_profile_id', v_operator.id,
    'operator_name', coalesce(v_operator.full_name, v_operator.username),
    'operator_session_id', v_op_session.id,
    'idle_expires_at', v_idle_expires,
    'absolute_expires_at', v_absolute_expires
  );
end;
$$;

revoke all on function public.resolve_station_pos_operator_context(text, boolean)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_record_audit(
  p_order_id uuid,
  p_operator_profile_id uuid,
  p_actor_profile_id uuid,
  p_operational_station_id uuid,
  p_operational_station_device_id uuid,
  p_operator_session_id uuid,
  p_action text,
  p_payload_fingerprint text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.operational_station_pos_action_audit (
    order_id,
    operator_profile_id,
    actor_profile_id,
    operational_station_id,
    operational_station_device_id,
    operator_session_id,
    action,
    payload_fingerprint,
    metadata
  ) values (
    p_order_id,
    p_operator_profile_id,
    p_actor_profile_id,
    p_operational_station_id,
    p_operational_station_device_id,
    p_operator_session_id,
    p_action,
    p_payload_fingerprint,
    coalesce(p_metadata, '{}'::jsonb)
  );
$$;

revoke all on function public.station_pos_record_audit(
  uuid, uuid, uuid, uuid, uuid, uuid, text, text, jsonb
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Public RPCs (security definer)
-- ---------------------------------------------------------------------------

create or replace function public.station_pos_lock_operator_session(
  p_operator_session_token text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_device public.operational_station_devices;
  v_station public.operational_stations;
  v_hash text;
  v_session public.operational_operator_sessions;
  v_generic constant text := 'Operacion no permitida.';
begin
  v_device := public.resolve_operational_device_for_auth_user();
  if v_device.id is null then
    return jsonb_build_object('ok', true);
  end if;

  select * into v_station from public.operational_stations where id = v_device.station_id;
  if v_station.id is null or v_station.station_type <> 'pos' then
    raise exception '%', v_generic;
  end if;

  if nullif(trim(coalesce(p_operator_session_token, '')), '') is null then
    return jsonb_build_object('ok', true);
  end if;

  v_hash := encode(extensions.digest(trim(p_operator_session_token), 'sha256'), 'hex');
  select * into v_session
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
    and module = 'pos'
    and operational_station_id = v_station.id
    and revoked_at is null
  for update;

  if v_session.id is null then
    return jsonb_build_object('ok', true);
  end if;

  update public.operational_operator_sessions
  set revoked_at = now(),
      revoke_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'manual_lock')
  where id = v_session.id;

  perform public.log_operational_station_event(
    v_station.id,
    v_device.id,
    'operator_session_locked',
    v_session.operator_profile_id,
    jsonb_build_object('reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'manual_lock')),
    null
  );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_station_pos_context(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
begin
  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);

  return jsonb_build_object(
    'station_name', v_ctx ->> 'station_name',
    'pos_floor_zone', v_ctx ->> 'pos_floor_zone',
    'operator_name', v_ctx ->> 'operator_name',
    'idle_expires_at', v_ctx -> 'idle_expires_at',
    'absolute_expires_at', v_ctx -> 'absolute_expires_at',
    'pos_enabled', public.operational_station_pos_enabled()
  );
end;
$$;

create or replace function public.open_station_pos_table_service(
  p_operator_session_token text,
  p_table_id text,
  p_table_name text,
  p_area_id text,
  p_area_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_table_id text;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_reuse_id uuid;
  v_order public.pos_orders;
  v_waiter_name text;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_table_id := nullif(trim(p_table_id), '');
  if v_table_id is null then
    raise exception 'Table id is required.';
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'open_table_service',
    jsonb_build_object(
      'table_id', v_table_id,
      'table_name', coalesce(nullif(trim(p_table_name), ''), 'Mesa'),
      'area_id', coalesce(nullif(trim(p_area_id), ''), ''),
      'area_name', coalesce(nullif(trim(p_area_name), ''), ''),
      'sales_channel', 'dine_in'
    )
  );

  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'open_table_service', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'open_table_service', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);

  if not public.station_pos_can_operate_orders(v_operator_id) then
    raise exception '%', v_generic;
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_table_service:' || v_table_id));

  v_reuse_id := public.pos_table_has_reusable_active_order(v_table_id);
  if v_reuse_id is not null then
    select * into v_order from public.pos_orders where id = v_reuse_id;
    v_result := jsonb_build_object(
      'created', false,
      'reused', true,
      'order_id', v_order.id,
      'owner_profile_id', v_order.owner_profile_id,
      'status', v_order.status,
      'table_id', v_order.table_id
    );
    perform public.station_pos_record_audit(
      v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
      'open_table_service', v_fingerprint, v_result
    );
    perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
    return v_result;
  end if;

  if public.pos_table_is_zombie_open(v_table_id) then
    raise exception 'POS_TABLE_PENDING_RELEASE'
      using hint = 'Release the pending service before opening a new one.';
  end if;

  if public.pos_table_has_billing_block(v_table_id) then
    raise exception 'POS_TABLE_IN_BILLING'
      using hint = 'Table has an order in billing flow.';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), nullif(trim(p.username), ''), 'POS')
    into v_waiter_name
  from public.profiles p
  where p.id = v_operator_id;

  begin
    insert into public.pos_orders (
      table_id, table_name, area_id, area_name,
      sales_channel,
      waiter_id, waiter_name, owner_profile_id, status
    ) values (
      v_table_id,
      coalesce(nullif(trim(p_table_name), ''), 'Mesa'),
      nullif(trim(p_area_id), ''),
      nullif(trim(p_area_name), ''),
      'dine_in',
      v_operator_id,
      v_waiter_name,
      v_operator_id,
      'open'
    )
    returning * into v_order;
  exception
    when unique_violation then
      v_reuse_id := public.pos_table_has_reusable_active_order(v_table_id);
      if v_reuse_id is null then
        raise;
      end if;
      select * into v_order from public.pos_orders where id = v_reuse_id;
      v_result := jsonb_build_object(
        'created', false,
        'reused', true,
        'order_id', v_order.id,
        'owner_profile_id', v_order.owner_profile_id,
        'status', v_order.status,
        'table_id', v_order.table_id
      );
      perform public.station_pos_record_audit(
        v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
        'open_table_service', v_fingerprint, v_result
      );
      perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
      return v_result;
  end;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    v_order.id,
    'service_opened',
    'Servicio abierto en ' || coalesce(v_order.table_name, v_table_id) || '.',
    v_operator_id
  );

  v_result := jsonb_build_object(
    'created', true,
    'reused', false,
    'order_id', v_order.id,
    'owner_profile_id', v_order.owner_profile_id,
    'status', v_order.status,
    'table_id', v_order.table_id
  );

  perform public.station_pos_record_audit(
    v_order.id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'open_table_service', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm in ('POS_TABLE_PENDING_RELEASE', 'POS_TABLE_IN_BILLING', 'Table id is required.') then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

-- Extension block for 198 (appended before grants + commit).

-- ---------------------------------------------------------------------------
-- Internal helpers (no public execute)
-- ---------------------------------------------------------------------------

create or replace function public.station_pos_is_order_owner(p_order_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.pos_orders o
    where o.id = p_order_id
      and o.owner_profile_id is not null
      and o.owner_profile_id = p_profile_id
  );
$$;

revoke all on function public.station_pos_is_order_owner(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_assert_release_authorized(
  p_order_id uuid,
  p_scenario text,
  p_operator_id uuid
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_scenario = 'L5_payments' then
    raise exception 'POS_RELEASE_BLOCKED_PAYMENTS'
      using hint = 'Orders with payments require flow 189.';
  end if;

  if p_scenario in ('L1_empty', 'L2_drafts_only') then
    if not public.station_pos_is_order_owner(p_order_id, p_operator_id) then
      raise exception 'POS_RELEASE_NOT_OWNER'
        using hint = 'Only the order owner can release this service scenario.';
    end if;
    return;
  end if;

  if p_scenario in ('L3_kds_history', 'L4_billing') then
    raise exception 'POS_RELEASE_REQUIRES_SUPERVISOR'
      using hint = 'Supervisor release not available on station POS yet.';
  end if;
end;
$$;

revoke all on function public.station_pos_assert_release_authorized(uuid, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_assert_order_open_for_drafts(
  p_order_id uuid,
  p_operator_id uuid
)
returns public.pos_orders
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
  v_generic constant text := 'Operacion no permitida.';
begin
  select * into v_order
  from public.pos_orders
  where id = p_order_id;

  if v_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  if v_order.status <> 'open' then
    raise exception '%', v_generic;
  end if;

  if not public.station_pos_is_order_owner(p_order_id, p_operator_id) then
    raise exception '%', v_generic;
  end if;

  return v_order;
end;
$$;

revoke all on function public.station_pos_assert_order_open_for_drafts(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_revoke_operator_session(
  p_session_id uuid,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.operational_operator_sessions;
begin
  if p_session_id is null then
    return;
  end if;

  select * into v_session
  from public.operational_operator_sessions
  where id = p_session_id
  for update;

  if v_session.id is null or v_session.revoked_at is not null then
    return;
  end if;

  update public.operational_operator_sessions
  set revoked_at = now(),
      revoke_reason = coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'terminal_op')
  where id = p_session_id;

  perform public.log_operational_station_event(
    v_session.operational_station_id,
    v_session.operational_station_device_id,
    'operator_session_revoked',
    v_session.operator_profile_id,
    jsonb_build_object('reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'terminal_op')),
    null
  );
end;
$$;

revoke all on function public.station_pos_revoke_operator_session(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_clear_draft_items_impl(
  p_order_id uuid,
  p_operator_profile_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  delete from public.pos_order_items
  where order_id = p_order_id
    and status = 'draft';

  get diagnostics v_removed = row_count;

  if v_removed > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      p_order_id,
      'draft_cleared',
      'Se limpiaron los productos nuevos de la orden.',
      p_operator_profile_id
    );
  end if;

  return v_removed;
end;
$$;

revoke all on function public.station_pos_clear_draft_items_impl(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.station_pos_compute_line_item_pricing(
  p_product_id uuid,
  p_variant_id uuid,
  p_modifier_ids jsonb,
  p_option_selections jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_product public.pos_products;
  v_variant public.pos_product_variants;
  v_mod_ids jsonb := coalesce(p_modifier_ids, '[]'::jsonb);
  v_opt_sel jsonb := coalesce(p_option_selections, '{}'::jsonb);
  v_group record;
  v_choice record;
  v_mod record;
  v_mod_id uuid;
  v_group_key text;
  v_raw jsonb;
  v_selected_ids text[];
  v_sel_id text;
  v_selected_count integer;
  v_min_sel integer;
  v_max_sel integer;
  v_absolute_total numeric := 0;
  v_delta_total numeric := 0;
  v_has_absolute boolean := false;
  v_base_price numeric := 0;
  v_unit_price numeric := 0;
  v_modifiers jsonb := '[]'::jsonb;
  v_selected_options jsonb := '[]'::jsonb;
  v_choice_labels text[] := '{}';
  v_recipe_ids uuid[] := '{}';
  v_recipe_id uuid;
  v_production_area_id text;
  v_product_name text;
begin
  select * into v_product
  from public.pos_products
  where id = p_product_id
    and active = true;

  if v_product.id is null then
    raise exception 'Producto no disponible.';
  end if;

  if p_variant_id is not null then
    select * into v_variant
    from public.pos_product_variants
    where id = p_variant_id
      and product_id = p_product_id
      and is_active = true;

    if v_variant.id is null then
      raise exception 'Variante no disponible.';
    end if;

    v_base_price := coalesce(v_variant.price, 0);
    v_recipe_id := v_variant.recipe_id;
    v_production_area_id := v_variant.production_area_id;
  else
    v_base_price := coalesce(v_product.price, 0);
    v_recipe_id := v_product.recipe_id;
    v_production_area_id := v_product.production_area_id;
  end if;

  if v_product.product_type = 'pizza' and p_variant_id is null then
    raise exception 'STATION_POS_PRICING_GAP';
  end if;

  if jsonb_typeof(v_mod_ids) <> 'array' then
    raise exception 'Modificadores invalidos.';
  end if;

  for v_mod_id in
    select (jsonb_array_elements_text(v_mod_ids))::uuid
  loop
    select * into v_mod
    from public.pos_product_modifiers m
    where m.id = v_mod_id
      and m.product_id = p_product_id
      and m.is_active = true;

    if v_mod.id is null then
      raise exception 'Modificador invalido.';
    end if;

    v_delta_total := v_delta_total + coalesce(v_mod.price_delta, 0);
    v_modifiers := v_modifiers || jsonb_build_array(
      jsonb_build_object(
        'id', v_mod.id,
        'name', v_mod.name,
        'modifier_type', v_mod.modifier_type,
        'price_delta', v_mod.price_delta
      )
    );
  end loop;

  for v_group in
    select *
    from public.pos_option_groups g
    where g.product_id = p_product_id
      and g.is_active = true
    order by g.sort_order, g.name
  loop
    v_group_key := coalesce(nullif(trim(v_group.id::text), ''), nullif(trim(v_group.name), ''));
    v_raw := coalesce(
      v_opt_sel -> v_group_key,
      v_opt_sel -> v_group.name,
      v_opt_sel -> v_group.id::text
    );

    v_selected_ids := '{}';
    if v_raw is null or v_raw = 'null'::jsonb then
      v_selected_count := 0;
    elsif jsonb_typeof(v_raw) = 'array' then
      select coalesce(array_agg(distinct trim(both from elem)), '{}')
        into v_selected_ids
      from jsonb_array_elements_text(v_raw) elem
      where nullif(trim(elem), '') is not null;
      v_selected_count := coalesce(array_length(v_selected_ids, 1), 0);
    else
      v_selected_ids := array[trim(both from v_raw #>> '{}')];
      v_selected_count := case when v_selected_ids[1] is null or v_selected_ids[1] = '' then 0 else 1 end;
    end if;

    v_min_sel := coalesce(
      v_group.min_selections,
      case when v_group.required and v_group.selection_mode = 'single' then 1 else 0 end
    );
    v_max_sel := coalesce(
      v_group.max_selections,
      case when v_group.selection_mode = 'single' then 1 end
    );

    if v_group.required and v_selected_count = 0 then
      raise exception 'Seleccion de opciones incompleta.';
    end if;

    if v_selected_count > 0 and v_selected_count < v_min_sel then
      raise exception 'Seleccion de opciones incompleta.';
    end if;

    if v_max_sel is not null and v_selected_count > v_max_sel then
      raise exception 'Seleccion de opciones invalida.';
    end if;

    foreach v_sel_id in array v_selected_ids
    loop
      select c.* into v_choice
      from public.pos_option_choices c
      where c.group_id = v_group.id
        and c.is_active = true
        and trim(c.name) <> ''
        and (c.id::text = v_sel_id or c.name = v_sel_id)
      order by c.sort_order, c.name
      limit 1;

      if v_choice.id is null then
        raise exception 'Opcion invalida.';
      end if;

      if v_choice.price_mode = 'absolute' and coalesce(v_choice.price, 0) > 0 then
        v_absolute_total := v_absolute_total + v_choice.price;
        v_has_absolute := true;
      elsif v_choice.price_mode = 'delta' then
        v_delta_total := v_delta_total + coalesce(v_choice.price, 0);
      end if;

      if v_choice.recipe_id is not null then
        v_recipe_ids := array_append(v_recipe_ids, v_choice.recipe_id);
      end if;

      v_choice_labels := array_append(v_choice_labels, v_choice.name);
      v_selected_options := v_selected_options || jsonb_build_array(
        jsonb_build_object(
          'group_id', v_group.id,
          'group_name', v_group.name,
          'choice_id', v_choice.id,
          'choice_name', v_choice.name,
          'price_mode', v_choice.price_mode,
          'price', coalesce(v_choice.price, 0),
          'recipe_id', v_choice.recipe_id
        )
      );
    end loop;
  end loop;

  if coalesce(array_length(v_recipe_ids, 1), 0) > 0 then
    -- Mitades / configurables: misma regla que FE (primera receta de opción seleccionada).
    v_recipe_id := v_recipe_ids[1];
  end if;

  if v_has_absolute then
    v_unit_price := v_absolute_total + v_delta_total;
  else
    v_unit_price := v_base_price + v_delta_total;
  end if;

  v_product_name := v_product.name;
  if v_variant.id is not null then
    v_product_name := v_product.name || ' - ' || coalesce(nullif(trim(v_variant.name), ''), nullif(trim(v_variant.size), ''), 'Tamaño');
  end if;
  if coalesce(array_length(v_choice_labels, 1), 0) > 0 then
    v_product_name := v_product_name || ' (' || array_to_string(v_choice_labels, ', ') || ')';
  end if;

  return jsonb_build_object(
    'unit_price', v_unit_price,
    'total', v_unit_price,
    'product_name', v_product_name,
    'recipe_id', v_recipe_id,
    'production_area_id', v_production_area_id,
    'production_ready', coalesce(v_product.production_ready, false),
    'selected_options', v_selected_options,
    'modifiers', v_modifiers,
    'product_variant_name', coalesce(v_variant.name, null),
    'selected_size', coalesce(v_variant.size, null),
    'is_test_item', coalesce(v_product.is_test_item, false)
  );
end;
$$;

revoke all on function public.station_pos_compute_line_item_pricing(uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.release_pos_table_service_for_operator(
  p_order_id uuid,
  p_reason text,
  p_operator_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pos_orders;
  v_scenario text;
  v_result jsonb;
  v_removed integer;
begin
  if not public.station_pos_can_operate_orders(p_operator_profile_id) then
    raise exception 'No tienes permiso para liberar servicio POS.';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'POS_RELEASE_REASON_REQUIRED';
  end if;

  select * into v_order
  from public.pos_orders
  where id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  perform pg_advisory_xact_lock(hashtext('pos_table_service:' || coalesce(v_order.table_id, p_order_id::text)));

  if v_order.status = 'cancelled' then
    return jsonb_build_object(
      'released', true,
      'already', true,
      'order_id', v_order.id,
      'status', v_order.status
    );
  end if;

  if v_order.status = 'paid' then
    return jsonb_build_object(
      'released', false,
      'reason', 'already_paid',
      'order_id', v_order.id,
      'status', v_order.status
    );
  end if;

  v_scenario := public.pos_classify_release_scenario(p_order_id);
  perform public.station_pos_assert_release_authorized(p_order_id, v_scenario, p_operator_profile_id);

  if v_scenario = 'L2_drafts_only' then
    v_removed := public.station_pos_clear_draft_items_impl(p_order_id, p_operator_profile_id);
  end if;

  update public.pos_orders
  set status = 'cancelled',
      updated_at = now()
  where id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    p_order_id,
    'table_released',
    'Mesa liberada. Motivo: ' || left(trim(p_reason), 500),
    p_operator_profile_id
  );

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    p_order_id,
    'service_cancelled',
    'Servicio cancelado (' || v_scenario || ').',
    p_operator_profile_id
  );

  return jsonb_build_object(
    'released', true,
    'order_id', p_order_id,
    'previous_status', v_order.status,
    'scenario', v_scenario,
    'owner_profile_id', v_order.owner_profile_id,
    'drafts_cleared', coalesce(v_removed, 0)
  );
end;
$$;

revoke all on function public.release_pos_table_service_for_operator(uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- send_pos_order_to_production_for_operator appended from _gen_send_for_operator.sql


create or replace function public.send_pos_order_to_production_for_operator(p_order_id uuid, p_operator_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$declare
  v_pos_order public.pos_orders;
  v_item public.pos_order_items;
  v_product public.pos_products;
  v_recipe public.standard_recipes;
  v_variant public.pos_product_variants;
  v_required record;
  v_area_row record;
  v_ticket public.production_tickets;
  v_stock_before numeric;
  v_ticket_ids uuid[] := '{}'::uuid[];
  v_draft_count integer;
  v_mode text := public.get_inventory_deduction_mode();
  v_strict boolean := v_mode = 'strict';
  v_eval jsonb;
  v_skip_reason text;
  v_skipped_count integer := 0;
  v_deducted_count integer := 0;
begin
  if not public.station_pos_can_operate_orders(p_operator_profile_id) then
    raise exception 'No tienes permiso para enviar ordenes POS.';
  end if;

  select po.*
  into v_pos_order
  from public.pos_orders po
  where po.id = p_order_id
  for update;

  if v_pos_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  if v_pos_order.status <> 'open' then
    raise exception 'Solo una orden abierta puede enviarse a produccion.';
  end if;

  select count(*)
  into v_draft_count
  from public.pos_order_items poi
  where poi.order_id = p_order_id
    and poi.status = 'draft';

  if v_draft_count = 0 then
    raise exception 'No hay productos nuevos para enviar.';
  end if;

  for v_item in
    select poi.*
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
  loop
    if v_strict then
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id
        and pop.active = true
        and pop.production_ready = true;

      if v_product.id is null then
        raise exception 'Producto % no esta listo para produccion.', v_item.product_name;
      end if;

      if v_product.is_test_item then
        continue;
      end if;

      if v_item.recipe_id is null
        or v_item.production_area_id is null
        or not v_item.production_ready then
        raise exception 'Producto % no esta listo para produccion.', v_item.product_name;
      end if;

      if v_item.product_variant_id is not null then
        select ppv.*
        into v_variant
        from public.pos_product_variants ppv
        where ppv.id = v_item.product_variant_id
          and ppv.product_id = v_item.product_id
          and ppv.is_active = true;

        if v_variant.id is null then
          raise exception 'La variante seleccionada para % no esta activa.', v_item.product_name;
        end if;

        select sr.*
        into v_recipe
        from public.standard_recipes sr
        where sr.id = v_variant.recipe_id
          and sr.active = true
          and sr.recipe_type = 'final_product';

        if v_recipe.id is null
          or v_variant.recipe_id is distinct from v_item.recipe_id
          or v_variant.production_area_id is distinct from v_item.production_area_id
          or v_recipe.production_area_id is distinct from v_item.production_area_id then
          raise exception 'Producto % tiene variante, receta o area de produccion invalida.', v_item.product_name;
        end if;
      else
        select sr.*
        into v_recipe
        from public.standard_recipes sr
        where sr.id = v_item.recipe_id
          and sr.active = true
          and sr.recipe_type = 'final_product';

        if v_recipe.id is null
          or v_product.recipe_id is distinct from v_item.recipe_id
          or v_product.production_area_id is distinct from v_item.production_area_id
          or v_recipe.production_area_id is distinct from v_item.production_area_id then
          raise exception 'Producto % tiene receta o area de produccion invalida.', v_item.product_name;
        end if;
      end if;
    else
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id
        and pop.active = true;

      if v_product.id is null then
        raise exception 'Producto % no esta activo.', v_item.product_name;
      end if;

      if v_item.production_area_id is null then
        raise exception 'Producto % no tiene area KDS configurada.', v_item.product_name;
      end if;

      if not exists (
        select 1
        from public.areas ar
        where ar.id = v_item.production_area_id
          and ar.active = true
          and ar.is_production_area = true
      ) then
        raise exception 'El area KDS de % no esta activa.', v_item.product_name;
      end if;
    end if;
  end loop;

  for v_required in
    select
      ri.inventory_item_id as item_id,
      max(ri.ingredient_name) as ingredient_name,
      max(ri.unit) as unit,
      poi.production_area_id as area_id,
      max(ar.name) as area_name,
      sum(ri.quantity * poi.quantity) as quantity
    from public.pos_order_items poi
    join public.pos_products pop on pop.id = poi.product_id
    join public.standard_recipes sr on sr.id = poi.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = sr.id
    join public.areas ar on ar.id = poi.production_area_id
    where poi.order_id = p_order_id
      and poi.status = 'draft'
      and not poi.is_test_item
      and poi.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(pop, poi) ->> 'deduct')::boolean = true
    group by ri.inventory_item_id, poi.production_area_id
  loop
    select ai.quantity
    into v_stock_before
    from public.area_inventory ai
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id
    for update;

    v_stock_before := coalesce(v_stock_before, 0);

    if v_stock_before < v_required.quantity then
      raise exception 'No hay suficiente % en %. Disponible %, requerido %.',
        v_required.ingredient_name, v_required.area_name, v_stock_before, v_required.quantity;
    end if;
  end loop;

  for v_area_row in
    select distinct poi.production_area_id as area_id
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
  loop
    insert into public.production_tickets (
      order_id, table_id, table_name, area_id, area_name, waiter_id, waiter_name, status, priority, notes
    )
    select
      v_pos_order.id::text,
      v_pos_order.table_id,
      coalesce(v_pos_order.table_name, 'Orden POS'),
      ar.id,
      ar.name,
      v_pos_order.waiter_id,
      v_pos_order.waiter_name,
      'pending',
      'normal',
      v_pos_order.notes
    from public.areas ar
    where ar.id = v_area_row.area_id
      and ar.active = true
      and ar.is_production_area = true
    returning * into v_ticket;

    if v_ticket.id is null then
      raise exception 'El area de produccion % no esta activa.', v_area_row.area_id;
    end if;

    v_ticket_ids := array_append(v_ticket_ids, v_ticket.id);

    insert into public.production_ticket_items (
      ticket_id, order_item_id, product_id, product_name, quantity, notes, modifiers, status
    )
    select
      v_ticket.id,
      poi.id::text,
      poi.product_id,
      poi.product_name,
      poi.quantity,
      poi.notes,
      poi.modifiers,
      'pending'
    from public.pos_order_items poi
    where poi.order_id = p_order_id
      and poi.status = 'draft'
      and poi.production_area_id = v_area_row.area_id;

    for v_item in
      select poi.*
      from public.pos_order_items poi
      where poi.order_id = p_order_id
        and poi.status = 'draft'
        and poi.production_area_id = v_area_row.area_id
    loop
      select pop.*
      into v_product
      from public.pos_products pop
      where pop.id = v_item.product_id;

      v_eval := public.evaluate_pos_inventory_deduction(v_product, v_item);
      v_skip_reason := nullif(v_eval ->> 'reason', '');

      update public.pos_order_items poi
      set status = 'sent_to_production',
          inventory_consumed = coalesce((v_eval ->> 'deduct')::boolean, false),
          production_ticket_id = v_ticket.id
      where poi.id = v_item.id;

      if coalesce((v_eval ->> 'deduct')::boolean, false) then
        v_deducted_count := v_deducted_count + 1;
      else
        v_skipped_count := v_skipped_count + 1;
        if v_skip_reason is not null and v_skip_reason <> 'test_item' then
          perform public.log_pos_inventory_deduction_skip(
            v_pos_order.id,
            v_item.id,
            v_item.product_id,
            v_item.product_name,
            v_skip_reason
          );
        end if;
      end if;
    end loop;

    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      v_pos_order.id,
      'ticket_created',
      'Ticket creado en KDS para ' || v_ticket.area_name || '.',
      p_operator_profile_id
    );
  end loop;

  for v_required in
    select
      ri.inventory_item_id as item_id,
      max(ri.ingredient_name) as ingredient_name,
      max(ri.unit) as unit,
      poi.production_area_id as area_id,
      sum(ri.quantity * poi.quantity) as quantity
    from public.pos_order_items poi
    join public.pos_products pop on pop.id = poi.product_id
    join public.standard_recipes sr on sr.id = poi.recipe_id
    join public.recipe_ingredients ri on ri.recipe_id = sr.id
    where poi.order_id = p_order_id
      and poi.production_ticket_id = any(v_ticket_ids)
      and not poi.is_test_item
      and poi.recipe_id is not null
      and (public.evaluate_pos_inventory_deduction(pop, poi) ->> 'deduct')::boolean = true
    group by ri.inventory_item_id, poi.production_area_id
  loop
    select ai.quantity
    into v_stock_before
    from public.area_inventory ai
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id
    for update;

    update public.area_inventory ai
    set quantity = v_stock_before - v_required.quantity
    where ai.item_id = v_required.item_id
      and ai.area_id = v_required.area_id;

    insert into public.inventory_movements (
      item_id, movement_type, from_area_id, quantity, unit, previous_quantity,
      new_quantity, source_type, source_id, notes, performed_by
    ) values (
      v_required.item_id,
      'consumption',
      v_required.area_id,
      v_required.quantity,
      v_required.unit,
      v_stock_before,
      v_stock_before - v_required.quantity,
      'pos_order',
      v_pos_order.id::text,
      'Consumo por comanda POS',
      p_operator_profile_id
    );
  end loop;

  if v_skipped_count > 0 then
    insert into public.pos_order_events (order_id, event_type, description, created_by)
    values (
      v_pos_order.id,
      'inventory_deduction_skipped',
      v_skipped_count::text || ' linea(s) omitieron descarga de inventario (modo implementacion).',
      p_operator_profile_id
    );
  end if;

  update public.pos_orders po
  set sent_at = now()
  where po.id = p_order_id;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (
    v_pos_order.id,
    'sent_to_production',
    v_draft_count::text || ' producto(s) enviado(s) a produccion.'
      || case
        when v_deducted_count > 0 and v_skipped_count > 0 then
          ' Inventario descontado en ' || v_deducted_count::text || ' linea(s); omitido en ' || v_skipped_count::text || '.'
        when v_deducted_count > 0 then ' Inventario descontado.'
        else ' Sin descarga de inventario (modo implementacion).'
      end,
    p_operator_profile_id
  );

  return jsonb_build_object(
    'order_id', v_pos_order.id,
    'ticket_ids', to_jsonb(v_ticket_ids),
    'items_sent', v_draft_count,
    'inventory_deducted_count', v_deducted_count,
    'inventory_skipped_count', v_skipped_count,
    'deduction_mode', v_mode,
    'inventory_consumed', v_deducted_count > 0
  );
end;
$$;

revoke all on function public.send_pos_order_to_production_for_operator(uuid, uuid) from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- Section G — Floor layout (read-only, mirrors human get_pos_floor_layout shape)
-- ---------------------------------------------------------------------------

create or replace function public.station_pos_floor_layout_payload(p_floor_zone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_floor_zone text := nullif(trim(p_floor_zone), '');
  v_areas jsonb;
  v_tables jsonb;
  v_orders jsonb;
  v_settings jsonb;
begin
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', z.id,
      'name', z.name,
      'nombre', z.name,
      'description', coalesce(z.description, ''),
      'sortOrder', z.sort_order,
      'active', z.active,
      'width', z.width,
      'height', z.height,
      'mesasTotales', (
        select count(*)
        from public.pos_floor_tables t
        where t.zone_id = z.id and t.active = true
      )
    )
    order by z.sort_order, z.name
  ), '[]'::jsonb)
  into v_areas
  from public.pos_floor_zones z
  where z.active = true
    and (v_floor_zone is null or z.id = v_floor_zone);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'areaId', t.zone_id,
      'zone_id', t.zone_id,
      'name', t.name,
      'numero', regexp_replace(t.name, '^[Mm]', ''),
      'capacity', t.capacity,
      'capacidad', t.capacity,
      'shape', t.shape,
      'x', t.x,
      'y', t.y,
      'status', t.manual_status,
      'estado', t.manual_status,
      'manual_status', t.manual_status,
      'sortOrder', t.sort_order,
      'active', t.active
    )
    order by t.zone_id, t.sort_order, t.name
  ), '[]'::jsonb)
  into v_tables
  from public.pos_floor_tables t
  join public.pos_floor_zones z on z.id = t.zone_id
  where t.active = true
    and z.active = true
    and (v_floor_zone is null or t.zone_id = v_floor_zone);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'order_id', o.id,
      'table_id', o.table_id,
      'status', o.status,
      'owner_profile_id', o.owner_profile_id,
      'waiter_name', o.waiter_name,
      'subtotal', o.subtotal,
      'total', o.total,
      'created_at', o.created_at
    )
    order by o.created_at desc
  ), '[]'::jsonb)
  into v_orders
  from public.pos_orders o
  where o.sales_channel = 'dine_in'
    and o.status = any(public.pos_table_service_active_statuses())
    and o.table_id in (
      select t.id
      from public.pos_floor_tables t
      join public.pos_floor_zones z on z.id = t.zone_id
      where t.active = true
        and z.active = true
        and (v_floor_zone is null or t.zone_id = v_floor_zone)
    );

  select coalesce(
    (
      select jsonb_build_object(
        'snapToGrid', s.snap_to_grid,
        'gridSize', s.grid_size,
        'zoom', s.zoom
      )
      from public.pos_floor_settings s
      where s.id = 'default'
    ),
    jsonb_build_object('snapToGrid', true, 'gridSize', 24, 'zoom', 1)
  ) into v_settings;

  return jsonb_build_object(
    'pos_floor_zone', v_floor_zone,
    'areas', v_areas,
    'tables', v_tables,
    'settings', v_settings,
    'active_orders', v_orders
  );
end;
$$;

revoke all on function public.station_pos_floor_layout_payload(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Section H — Public read wrappers (no idle extend on context resolve)
-- ---------------------------------------------------------------------------

create or replace function public.get_station_pos_floor_layout(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_floor_zone text;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_floor_zone := nullif(trim(v_ctx ->> 'pos_floor_zone'), '');

  return public.station_pos_floor_layout_payload(v_floor_zone);
end;
$$;

create or replace function public.list_station_pos_tables(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.get_station_pos_floor_layout(p_operator_session_token);
end;
$$;

create or replace function public.get_station_pos_table_events(
  p_operator_session_token text,
  p_table_id text,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id text;
  v_events jsonb;
  v_lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  perform public.resolve_station_pos_operator_context(p_operator_session_token, false);

  v_table_id := nullif(trim(p_table_id), '');
  if v_table_id is null then
    raise exception 'Table id is required.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'order_id', e.order_id,
      'event_type', e.event_type,
      'description', e.description,
      'created_at', e.created_at,
      'created_by', e.created_by
    )
    order by e.created_at desc
  ), '[]'::jsonb)
  into v_events
  from (
    select e.*
    from public.pos_order_events e
    join public.pos_orders o on o.id = e.order_id
    where o.table_id = v_table_id
    order by e.created_at desc
    limit v_lim
  ) e;

  return jsonb_build_object('table_id', v_table_id, 'events', v_events);
end;
$$;

create or replace function public.get_station_pos_order_events(
  p_operator_session_token text,
  p_order_id uuid,
  p_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  v_events jsonb;
  v_order public.pos_orders;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  perform public.resolve_station_pos_operator_context(p_operator_session_token, false);

  select * into v_order from public.pos_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'La orden POS no existe.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'order_id', e.order_id,
      'event_type', e.event_type,
      'description', e.description,
      'created_at', e.created_at,
      'created_by', e.created_by
    )
    order by e.created_at desc
  ), '[]'::jsonb)
  into v_events
  from (
    select e.*
    from public.pos_order_events e
    where e.order_id = p_order_id
    order by e.created_at desc
    limit v_lim
  ) e;

  return jsonb_build_object('order_id', p_order_id, 'events', v_events);
end;
$$;

create or replace function public.get_station_pos_order(
  p_operator_session_token text,
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_order jsonb;
  v_items jsonb;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);

  select to_jsonb(o.*) into v_order
  from public.pos_orders o
  where o.id = p_order_id;

  if v_order is null then
    raise exception 'La orden POS no existe.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(i.*) order by i.created_at), '[]'::jsonb)
  into v_items
  from public.pos_order_items i
  where i.order_id = p_order_id
    and i.status <> 'cancelled';

  return jsonb_build_object(
    'order', v_order,
    'items', v_items,
    'operator_profile_id', v_ctx ->> 'operator_profile_id'
  );
end;
$$;

create or replace function public.get_station_pos_table_history(
  p_operator_session_token text,
  p_table_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_table_id text;
  v_orders jsonb;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  perform public.resolve_station_pos_operator_context(p_operator_session_token, false);

  v_table_id := nullif(trim(p_table_id), '');
  if v_table_id is null then
    raise exception 'Table id is required.';
  end if;

  select coalesce(jsonb_agg(to_jsonb(o.*) order by o.created_at desc), '[]'::jsonb)
  into v_orders
  from (
    select *
    from public.pos_orders
    where table_id = v_table_id
    order by created_at desc
    limit 30
  ) o;

  return jsonb_build_object('table_id', v_table_id, 'orders', v_orders);
end;
$$;

create or replace function public.get_station_pos_catalog(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_products jsonb;
begin
  if auth.uid() is null then
    raise exception 'Operacion no permitida.';
  end if;

  perform public.resolve_station_pos_operator_context(p_operator_session_token, false);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'price', p.price,
      'category_id', p.category_id,
      'category_name', p.category_name,
      'recipe_id', p.recipe_id,
      'production_area_id', p.production_area_id,
      'production_ready', p.production_ready,
      'product_type', p.product_type,
      'is_test_item', p.is_test_item,
      'allow_kitchen_notes', p.allow_kitchen_notes,
      'sort_order', p.sort_order,
      'variants', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', v.id,
            'name', v.name,
            'size', v.size,
            'price', v.price,
            'recipe_id', v.recipe_id,
            'production_area_id', v.production_area_id,
            'is_active', v.is_active,
            'sort_order', v.sort_order
          )
          order by v.sort_order, v.name
        ), '[]'::jsonb)
        from public.pos_product_variants v
        where v.product_id = p.id and v.is_active = true
      ),
      'modifiers', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'modifier_type', m.modifier_type,
            'price_delta', m.price_delta,
            'sort_order', m.sort_order
          )
          order by m.sort_order, m.name
        ), '[]'::jsonb)
        from public.pos_product_modifiers m
        where m.product_id = p.id and m.is_active = true
      ),
      'option_groups', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', g.id,
            'name', g.name,
            'required', g.required,
            'selection_mode', g.selection_mode,
            'min_selections', g.min_selections,
            'max_selections', g.max_selections,
            'sort_order', g.sort_order,
            'choices', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', c.id,
                  'name', c.name,
                  'price_mode', c.price_mode,
                  'price', c.price,
                  'recipe_id', c.recipe_id,
                  'sort_order', c.sort_order
                )
                order by c.sort_order, c.name
              ), '[]'::jsonb)
              from public.pos_option_choices c
              where c.group_id = g.id and c.is_active = true and trim(c.name) <> ''
            )
          )
          order by g.sort_order, g.name
        ), '[]'::jsonb)
        from public.pos_option_groups g
        where g.product_id = p.id and g.is_active = true
      )
    )
    order by p.sort_order, p.name
  ), '[]'::jsonb)
  into v_products
  from public.pos_products p
  where p.active = true;

  return jsonb_build_object('products', v_products);
end;
$$;

-- ---------------------------------------------------------------------------
-- Mutation wrappers
-- ---------------------------------------------------------------------------

create or replace function public.add_station_pos_order_item(
  p_operator_session_token text,
  p_order_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_notes text,
  p_variant_id uuid,
  p_modifier_ids jsonb,
  p_option_selections jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_order public.pos_orders;
  v_qty numeric;
  v_pricing jsonb;
  v_item public.pos_order_items;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_qty := coalesce(p_quantity, 1);
  if v_qty <= 0 then
    raise exception 'Cantidad invalida.';
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'add_order_item',
    jsonb_build_object(
      'order_id', p_order_id,
      'product_id', p_product_id,
      'quantity', v_qty,
      'notes', coalesce(p_notes, ''),
      'variant_id', p_variant_id,
      'modifier_ids', coalesce(p_modifier_ids, '[]'::jsonb),
      'option_selections', coalesce(p_option_selections, '{}'::jsonb)
    )
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'add_order_item', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'add_order_item', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  v_order := public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  v_pricing := public.station_pos_compute_line_item_pricing(
    p_product_id, p_variant_id, p_modifier_ids, p_option_selections
  );

  insert into public.pos_order_items (
    order_id, product_id, product_name, quantity, unit_price, total_price,
    recipe_id, production_area_id, production_ready, is_test_item,
    notes, modifiers, selected_options,
    product_variant_id, product_variant_name, selected_size, status
  ) values (
    p_order_id,
    p_product_id,
    v_pricing ->> 'product_name',
    v_qty,
    (v_pricing ->> 'unit_price')::numeric,
    (v_pricing ->> 'unit_price')::numeric * v_qty,
    nullif(v_pricing ->> 'recipe_id', '')::uuid,
    nullif(v_pricing ->> 'production_area_id', ''),
    coalesce((v_pricing ->> 'production_ready')::boolean, false),
    coalesce((v_pricing ->> 'is_test_item')::boolean, false),
    nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(v_pricing -> 'modifiers', '[]'::jsonb),
    coalesce(v_pricing -> 'selected_options', '[]'::jsonb),
    p_variant_id,
    v_pricing ->> 'product_variant_name',
    v_pricing ->> 'selected_size',
    'draft'
  )
  returning * into v_item;

  v_result := jsonb_build_object(
    'item_id', v_item.id,
    'order_id', p_order_id,
    'quantity', v_item.quantity,
    'unit_price', v_item.unit_price,
    'total_price', v_item.total_price
  );

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'add_order_item', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm in ('STATION_POS_PRICING_GAP', 'Producto no disponible.', 'Variante no disponible.',
      'Modificador invalido.', 'Opcion invalida.', 'Seleccion de opciones incompleta.',
      'Seleccion de opciones invalida.', 'Modificadores invalidos.', 'Cantidad invalida.',
      'La orden POS no existe.') then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.update_station_pos_order_item(
  p_operator_session_token text,
  p_order_id uuid,
  p_item_id uuid,
  p_quantity numeric,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_item public.pos_order_items;
  v_qty numeric;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_qty := coalesce(p_quantity, 0);
  if v_qty <= 0 then
    raise exception 'Cantidad invalida.';
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'update_order_item',
    jsonb_build_object('order_id', p_order_id, 'item_id', p_item_id, 'quantity', v_qty)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'update_order_item', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'update_order_item', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  perform public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  update public.pos_order_items i
  set quantity = v_qty,
      total_price = v_qty * i.unit_price
  where i.id = p_item_id
    and i.order_id = p_order_id
    and i.status = 'draft'
  returning * into v_item;

  if v_item.id is null then
    raise exception '%', v_generic;
  end if;

  v_result := jsonb_build_object(
    'item_id', v_item.id,
    'order_id', p_order_id,
    'quantity', v_item.quantity,
    'total_price', v_item.total_price
  );

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'update_order_item', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm in ('Cantidad invalida.', 'La orden POS no existe.') then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.remove_station_pos_draft_item(
  p_operator_session_token text,
  p_order_id uuid,
  p_item_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_item public.pos_order_items;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'remove_draft_item',
    jsonb_build_object('order_id', p_order_id, 'item_id', p_item_id)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'remove_draft_item', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'remove_draft_item', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  perform public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  delete from public.pos_order_items i
  where i.id = p_item_id
    and i.order_id = p_order_id
    and i.status = 'draft'
  returning * into v_item;

  if v_item.id is null then
    raise exception '%', v_generic;
  end if;

  v_result := jsonb_build_object('removed', true, 'item_id', p_item_id, 'order_id', p_order_id);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'remove_draft_item', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.clear_station_pos_draft_items(
  p_operator_session_token text,
  p_order_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_removed integer;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'clear_draft_items',
    jsonb_build_object('order_id', p_order_id)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'clear_draft_items', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'clear_draft_items', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  perform public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  v_removed := public.station_pos_clear_draft_items_impl(p_order_id, v_operator_id);
  v_result := jsonb_build_object('removed', v_removed, 'order_id', p_order_id);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'clear_draft_items', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.update_station_pos_order(
  p_operator_session_token text,
  p_order_id uuid,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_order public.pos_orders;
  v_result jsonb;
  v_notes text;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_notes := nullif(left(trim(coalesce(p_notes, '')), 2000), '');

  v_fingerprint := public.station_pos_request_fingerprint(
    'update_order',
    jsonb_build_object('order_id', p_order_id, 'notes', coalesce(v_notes, ''))
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'update_order', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'update_order', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  v_order := public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  update public.pos_orders
  set notes = v_notes,
      updated_at = now()
  where id = p_order_id
  returning * into v_order;

  v_result := jsonb_build_object('order_id', p_order_id, 'notes', v_order.notes);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'update_order', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.send_station_pos_order_to_production(
  p_operator_session_token text,
  p_order_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'send_to_production',
    jsonb_build_object('order_id', p_order_id)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'send_to_production', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'send_to_production', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  perform public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  v_payload := public.send_pos_order_to_production_for_operator(p_order_id, v_operator_id);
  v_result := v_payload;

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'send_to_production', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  perform public.station_pos_revoke_operator_session(v_op_session_id, 'send_to_production');
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    if sqlerrm like 'No hay productos%' or sqlerrm like 'Solo una orden%' or sqlerrm like 'No tienes permiso%' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.request_station_pos_order_bill(
  p_operator_session_token text,
  p_order_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_order public.pos_orders;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'request_bill',
    jsonb_build_object('order_id', p_order_id)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'request_bill', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'request_bill', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);

  if not public.station_pos_is_order_owner(p_order_id, v_operator_id) then
    raise exception '%', v_generic;
  end if;

  if exists (
    select 1 from public.pos_order_items
    where order_id = p_order_id and status = 'draft'
  ) then
    raise exception 'Envía o quita los productos nuevos antes de solicitar cuenta.';
  end if;

  update public.pos_orders
  set status = 'awaiting_bill'
  where id = p_order_id
    and status = 'open'
    and exists (
      select 1 from public.pos_order_items
      where order_id = p_order_id and status <> 'cancelled'
    )
  returning * into v_order;

  if v_order.id is null then
    raise exception 'La orden no está disponible para solicitar cuenta.';
  end if;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (p_order_id, 'bill_requested', 'Cuenta solicitada por el mesero.', v_operator_id);

  v_result := jsonb_build_object('order_id', p_order_id, 'status', v_order.status);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'request_bill', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    if sqlerrm like 'Envía o quita%' or sqlerrm like 'La orden no%' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.send_station_pos_order_to_cashier(
  p_operator_session_token text,
  p_order_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_order public.pos_orders;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'send_to_cashier',
    jsonb_build_object('order_id', p_order_id)
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'send_to_cashier', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'send_to_cashier', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);

  if not public.station_pos_is_order_owner(p_order_id, v_operator_id) then
    raise exception '%', v_generic;
  end if;

  update public.pos_orders
  set status = 'sent_to_cashier'
  where id = p_order_id
    and status = 'awaiting_bill'
  returning * into v_order;

  if v_order.id is null then
    raise exception 'Solicita la cuenta antes de enviarla a caja.';
  end if;

  insert into public.pos_order_events (order_id, event_type, description, created_by)
  values (p_order_id, 'sent_to_cashier', 'Cuenta enviada a caja.', v_operator_id);

  v_result := jsonb_build_object('order_id', p_order_id, 'status', v_order.status);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'send_to_cashier', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  perform public.station_pos_revoke_operator_session(v_op_session_id, 'send_to_cashier');
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    if sqlerrm like 'Solicita la cuenta%' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.release_station_pos_table_service(
  p_operator_session_token text,
  p_order_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_fingerprint := public.station_pos_request_fingerprint(
    'release_table_service',
    jsonb_build_object('order_id', p_order_id, 'reason', trim(coalesce(p_reason, '')))
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'release_table_service', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'release_table_service', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);

  v_result := public.release_pos_table_service_for_operator(p_order_id, p_reason, v_operator_id);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'release_table_service', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  perform public.station_pos_revoke_operator_session(v_op_session_id, 'release_table_service');
  return v_result;
exception
  when others then
    if sqlerrm in (
      'POS_RELEASE_REASON_REQUIRED', 'POS_RELEASE_NOT_OWNER', 'POS_RELEASE_BLOCKED_PAYMENTS',
      'POS_RELEASE_REQUIRES_SUPERVISOR', 'La orden POS no existe.'
    ) or sqlerrm like 'POS_RELEASE%' then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.update_station_pos_order_item_notes(
  p_operator_session_token text,
  p_order_id uuid,
  p_item_id uuid,
  p_notes text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_device_id uuid;
  v_station_id uuid;
  v_operator_id uuid;
  v_op_session_id uuid;
  v_actor_id uuid;
  v_fingerprint text;
  v_idem_key text;
  v_cached jsonb;
  v_item public.pos_order_items;
  v_notes text;
  v_result jsonb;
  v_generic constant text := 'Operacion no permitida.';
begin
  if auth.uid() is null then
    raise exception '%', v_generic;
  end if;

  v_notes := nullif(left(trim(coalesce(p_notes, '')), 2000), '');

  v_fingerprint := public.station_pos_request_fingerprint(
    'update_item_notes',
    jsonb_build_object('order_id', p_order_id, 'item_id', p_item_id, 'notes', coalesce(v_notes, ''))
  );
  v_idem_key := public.station_pos_resolve_idempotency_key(p_idempotency_key, v_fingerprint);

  v_cached := public.station_pos_idempotency_replay_if_completed(
    p_operator_session_token, 'update_item_notes', v_idem_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_pos_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_actor_id := v_operator_id;

  v_cached := public.station_pos_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, v_idem_key, 'update_item_notes', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_pos_extend_operator_idle(v_op_session_id);
  perform public.station_pos_assert_order_open_for_drafts(p_order_id, v_operator_id);

  update public.pos_order_items i
  set notes = v_notes
  where i.id = p_item_id
    and i.order_id = p_order_id
    and i.status = 'draft'
  returning * into v_item;

  if v_item.id is null then
    raise exception '%', v_generic;
  end if;

  v_result := jsonb_build_object('item_id', v_item.id, 'order_id', p_order_id, 'notes', v_item.notes);

  perform public.station_pos_record_audit(
    p_order_id, v_operator_id, v_actor_id, v_station_id, v_device_id, v_op_session_id,
    'update_item_notes', v_fingerprint, v_result
  );
  perform public.station_pos_idempotency_complete(v_device_id, v_idem_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;


-- ---------------------------------------------------------------------------
-- Grants: public wrappers → authenticated only; internals → none
-- ---------------------------------------------------------------------------

revoke all on function public.get_station_pos_context(text) from public, anon;
grant execute on function public.get_station_pos_context(text) to authenticated;

revoke all on function public.open_station_pos_table_service(text, text, text, text, text, text) from public, anon;
grant execute on function public.open_station_pos_table_service(text, text, text, text, text, text) to authenticated;

revoke all on function public.station_pos_lock_operator_session(text, text) from public, anon;
grant execute on function public.station_pos_lock_operator_session(text, text) to authenticated;

revoke all on function public.get_station_pos_floor_layout(text) from public, anon;
grant execute on function public.get_station_pos_floor_layout(text) to authenticated;

revoke all on function public.list_station_pos_tables(text) from public, anon;
grant execute on function public.list_station_pos_tables(text) to authenticated;

revoke all on function public.get_station_pos_order(text, uuid) from public, anon;
grant execute on function public.get_station_pos_order(text, uuid) to authenticated;

revoke all on function public.get_station_pos_table_history(text, text) from public, anon;
grant execute on function public.get_station_pos_table_history(text, text) to authenticated;

revoke all on function public.get_station_pos_table_events(text, text, integer) from public, anon;
grant execute on function public.get_station_pos_table_events(text, text, integer) to authenticated;

revoke all on function public.get_station_pos_order_events(text, uuid, integer) from public, anon;
grant execute on function public.get_station_pos_order_events(text, uuid, integer) to authenticated;

revoke all on function public.get_station_pos_catalog(text) from public, anon;
grant execute on function public.get_station_pos_catalog(text) to authenticated;

revoke all on function public.add_station_pos_order_item(text, uuid, uuid, numeric, text, uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.add_station_pos_order_item(text, uuid, uuid, numeric, text, uuid, jsonb, jsonb, text) to authenticated;

revoke all on function public.update_station_pos_order_item(text, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.update_station_pos_order_item(text, uuid, uuid, numeric, text) to authenticated;

revoke all on function public.remove_station_pos_draft_item(text, uuid, uuid, text) from public, anon;
grant execute on function public.remove_station_pos_draft_item(text, uuid, uuid, text) to authenticated;

revoke all on function public.clear_station_pos_draft_items(text, uuid, text) from public, anon;
grant execute on function public.clear_station_pos_draft_items(text, uuid, text) to authenticated;

revoke all on function public.update_station_pos_order(text, uuid, text, text) from public, anon;
grant execute on function public.update_station_pos_order(text, uuid, text, text) to authenticated;

revoke all on function public.update_station_pos_order_item_notes(text, uuid, uuid, text, text) from public, anon;
grant execute on function public.update_station_pos_order_item_notes(text, uuid, uuid, text, text) to authenticated;

revoke all on function public.send_station_pos_order_to_production(text, uuid, text) from public, anon;
grant execute on function public.send_station_pos_order_to_production(text, uuid, text) to authenticated;

revoke all on function public.request_station_pos_order_bill(text, uuid, text) from public, anon;
grant execute on function public.request_station_pos_order_bill(text, uuid, text) to authenticated;

revoke all on function public.send_station_pos_order_to_cashier(text, uuid, text) from public, anon;
grant execute on function public.send_station_pos_order_to_cashier(text, uuid, text) to authenticated;

revoke all on function public.release_station_pos_table_service(text, uuid, text, text) from public, anon;
grant execute on function public.release_station_pos_table_service(text, uuid, text, text) to authenticated;

commit;
