-- OS2 phase 2: station cash wrappers (device JWT + operator session token).
-- Apply after 193_operational_operator_access_foundation.sql.
-- Human RPCs in 045 remain unchanged.

begin;

create table if not exists public.operational_station_cash_idempotency (
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

comment on table public.operational_station_cash_idempotency is
  'Idempotencia transaccional estación caja. Retención operativa: limpieza periódica recomendada (p.ej. 90 días). Sin PIN ni token operador.';

create index if not exists operational_station_cash_idempotency_station_created_idx
  on public.operational_station_cash_idempotency (station_id, created_at desc);

alter table public.operational_station_cash_idempotency enable row level security;
grant select on public.operational_station_cash_idempotency to authenticated;
grant all on public.operational_station_cash_idempotency to service_role;

create or replace function public.station_cash_operator_role(p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_profile_role(p.role)
  from public.profiles p
  where p.id = p_profile_id and p.status = 'active';
$$;

revoke all on function public.station_cash_operator_role(uuid) from public, anon, authenticated, service_role;

create or replace function public.station_cash_is_supervisor(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.station_cash_operator_role(p_profile_id) in ('admin', 'gerente_general', 'supervisor'),
    false
  );
$$;

revoke all on function public.station_cash_is_supervisor(uuid) from public, anon, authenticated, service_role;

create or replace function public.station_cash_is_operator_role(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.station_cash_operator_role(p_profile_id) in (
      'admin', 'gerente_general', 'supervisor', 'cajero', 'caja'
    ),
    false
  );
$$;

revoke all on function public.station_cash_is_operator_role(uuid) from public, anon, authenticated, service_role;

create or replace function public.station_cash_request_fingerprint(
  p_operation text,
  p_payload jsonb
)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(public.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex');
$$;

revoke all on function public.station_cash_request_fingerprint(text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.station_cash_extend_operator_idle(p_operator_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.operational_operator_sessions
  set last_activity_at = now(),
      idle_expires_at = now() + interval '90 seconds'
  where id = p_operator_session_id
    and revoked_at is null
    and idle_expires_at > now();
end;
$$;

revoke all on function public.station_cash_extend_operator_idle(uuid) from public, anon, authenticated, service_role;

-- Returns completed JSON result, or NULL when caller must execute the mutation.
-- Raises on fingerprint / operation conflict for the same key.
create or replace function public.station_cash_idempotency_begin(
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
  v_row public.operational_station_cash_idempotency;
  v_key text := nullif(trim(coalesce(p_key, '')), '');
begin
  if v_key is null then
    raise exception 'Se requiere clave de idempotencia.';
  end if;

  insert into public.operational_station_cash_idempotency (
    device_id, idempotency_key, operation, request_fingerprint,
    operator_session_id, station_id, result
  ) values (
    p_device_id, v_key, p_operation, p_fingerprint,
    p_operator_session_id, p_station_id,
    jsonb_build_object('idempotency_status', 'pending')
  )
  on conflict (device_id, idempotency_key) do nothing;

  select * into v_row
  from public.operational_station_cash_idempotency
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

revoke all on function public.station_cash_idempotency_begin(uuid, uuid, uuid, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.station_cash_idempotency_complete(
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
  update public.operational_station_cash_idempotency
  set result = coalesce(p_result, '{}'::jsonb) || jsonb_build_object('idempotency_status', 'completed')
  where device_id = p_device_id
    and idempotency_key = nullif(trim(coalesce(p_key, '')), '');
end;
$$;

revoke all on function public.station_cash_idempotency_complete(uuid, text, jsonb) from public, anon, authenticated, service_role;

-- Device (auth.uid) + operator session bound to token hash, including terminal sessions (replay lookup only).
create or replace function public.station_cash_bind_operator_session_by_token(
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
    or v_station.station_type <> 'cash'
    or v_station.cash_register_id is null then
    raise exception '%', v_generic;
  end if;

  v_hash := encode(public.digest(trim(p_operator_session_token), 'sha256'), 'hex');
  select * into v_op
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
  order by created_at desc
  limit 1;

  if v_op.id is null
    or v_op.module <> 'cash'
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

revoke all on function public.station_cash_bind_operator_session_by_token(text) from public, anon, authenticated, service_role;

comment on function public.station_cash_bind_operator_session_by_token(text) is
  'Replay terminal: sale_complete, shift_close, manual_lock, expired. Solo lectura de filas idempotency completed; nunca muta ni extiende idle.';

-- Replay-first: devuelve result completed si token+device+session+key+operation+fingerprint coinciden.
create or replace function public.station_cash_idempotency_replay_if_completed(
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
  v_row public.operational_station_cash_idempotency;
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
  from public.station_cash_bind_operator_session_by_token(p_operator_session_token) b;

  select * into v_row
  from public.operational_station_cash_idempotency
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

revoke all on function public.station_cash_idempotency_replay_if_completed(text, text, text, text) from public, anon, authenticated, service_role;

create or replace function public.resolve_station_cash_operator_context(
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
  v_role text;
  v_idle_expires timestamptz;
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
    or v_station.station_type <> 'cash'
    or v_station.cash_register_id is null then
    raise exception '%', v_generic;
  end if;

  v_hash := encode(public.digest(trim(p_operator_session_token), 'sha256'), 'hex');
  select * into v_op_session
  from public.operational_operator_sessions
  where session_token_hash = v_hash
    and operational_station_device_id = v_device.id
    and revoked_at is null
  for update;

  if v_op_session.id is null or v_op_session.idle_expires_at <= now() then
    if v_op_session.id is not null then
      update public.operational_operator_sessions
      set revoked_at = now(), revoke_reason = 'expired'
      where id = v_op_session.id;
    end if;
    raise exception '%', v_generic;
  end if;

  if v_op_session.module <> 'cash'
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

  v_role := public.station_cash_operator_role(v_operator.id);
  if not public.station_cash_is_operator_role(v_operator.id) then
    raise exception '%', v_generic;
  end if;

  if coalesce(p_extend_idle, true) then
    update public.operational_operator_sessions
    set last_activity_at = now(),
        idle_expires_at = now() + interval '90 seconds'
    where id = v_op_session.id;
    v_idle_expires := now() + interval '90 seconds';
  else
    v_idle_expires := v_op_session.idle_expires_at;
  end if;

  return jsonb_build_object(
    'device_id', v_device.id,
    'station_id', v_station.id,
    'station_name', v_station.name,
    'station_code', v_station.station_code,
    'cash_register_id', v_station.cash_register_id,
    'operator_profile_id', v_operator.id,
    'operator_name', coalesce(v_operator.full_name, v_operator.username),
    'operator_role', v_role,
    'operator_session_id', v_op_session.id,
    'can_supervise', public.station_cash_is_supervisor(v_operator.id),
    'idle_expires_at', v_idle_expires
  );
end;
$$;

revoke all on function public.resolve_station_cash_operator_context(text, boolean) from public, anon, authenticated, service_role;

create or replace function public.get_station_cash_context(p_operator_session_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ctx jsonb;
  v_register public.cash_registers;
  v_session public.cash_sessions;
  v_movements jsonb := '[]'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_cash_register_id uuid;
  v_operator_id uuid;
begin
  v_ctx := public.resolve_station_cash_operator_context(p_operator_session_token, false);
  v_cash_register_id := (v_ctx ->> 'cash_register_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;

  select * into v_register from public.cash_registers where id = v_cash_register_id;

  select * into v_session
  from public.cash_sessions
  where cash_register_id = v_cash_register_id and status = 'open'
  order by opened_at desc
  limit 1;

  if v_session.id is not null then
    select coalesce(jsonb_agg(row_to_json(m)::jsonb order by m.created_at desc), '[]'::jsonb)
    into v_movements
    from (
      select cm.*,
        jsonb_build_object(
          'full_name', pr.full_name,
          'username', pr.username
        ) as creator
      from public.cash_movements cm
      left join public.profiles pr on pr.id = cm.created_by
      where cm.cash_session_id = v_session.id
      order by cm.created_at desc
      limit 200
    ) m;
  end if;

  select coalesce(jsonb_agg(row_to_json(s)::jsonb order by s.opened_at desc), '[]'::jsonb)
  into v_recent
  from (
    select cs.*,
      jsonb_build_object('name', cr.name) as register,
      jsonb_build_object('full_name', op.full_name, 'username', op.username) as opener
    from public.cash_sessions cs
    join public.cash_registers cr on cr.id = cs.cash_register_id
    left join public.profiles op on op.id = cs.opened_by
    where cs.cash_register_id = v_cash_register_id and cs.status <> 'open'
    order by cs.opened_at desc
    limit 6
  ) s;

  return v_ctx || jsonb_build_object(
    'register', jsonb_build_object('id', v_register.id, 'name', v_register.name, 'location', v_register.location),
    'open_session', case
      when v_session.id is null then null
      else to_jsonb(v_session) || jsonb_build_object(
        'opener', (
          select jsonb_build_object('full_name', p.full_name, 'username', p.username)
          from public.profiles p where p.id = v_session.opened_by
        )
      )
    end,
    'can_close_session', case
      when v_session.id is null then false
      when public.station_cash_is_supervisor(v_operator_id) then true
      else v_session.opened_by = v_operator_id
    end,
    'movements', v_movements,
    'recent_closed_sessions', v_recent
  );
end;
$$;

create or replace function public.open_station_cash_session(
  p_operator_session_token text,
  p_opening_amount numeric,
  p_notes text default null,
  p_idempotency_key text default null
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
  v_register_id uuid;
  v_saved public.cash_sessions;
  v_cached jsonb;
  v_fingerprint text;
  v_generic constant text := 'No se pudo abrir caja.';
begin
  v_fingerprint := public.station_cash_request_fingerprint(
    'open',
    jsonb_build_object(
      'opening_amount', round(greatest(0, coalesce(p_opening_amount, 0))::numeric, 2),
      'notes', coalesce(nullif(trim(coalesce(p_notes, '')), ''), '')
    )
  );

  v_cached := public.station_cash_idempotency_replay_if_completed(
    p_operator_session_token, 'open', p_idempotency_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_cash_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_register_id := (v_ctx ->> 'cash_register_id')::uuid;

  v_cached := public.station_cash_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, p_idempotency_key, 'open', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_cash_extend_operator_idle(v_op_session_id);

  if exists (
    select 1 from public.cash_sessions
    where cash_register_id = v_register_id and status = 'open'
  ) then
    raise exception 'Ya existe una caja abierta.';
  end if;

  insert into public.cash_sessions (
    cash_register_id, opened_by, opening_amount, expected_cash, notes
  ) values (
    v_register_id,
    v_operator_id,
    greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2),
    greatest(0, coalesce(p_opening_amount, 0))::numeric(12,2),
    nullif(trim(coalesce(p_notes, '')), '')
  ) returning * into v_saved;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason, metadata
  ) values (
    v_saved.id, v_saved.cash_register_id, v_operator_id, 'shift_open', 0, 'Apertura de caja',
    jsonb_build_object(
      'operational_station_id', v_station_id,
      'operational_station_device_id', v_device_id,
      'operator_profile_id', v_operator_id
    )
  );

  perform public.log_operational_station_event(
    v_station_id, v_device_id, 'station_cash_session_opened', v_operator_id,
    jsonb_build_object('cash_session_id', v_saved.id), nullif(trim(p_idempotency_key), '')
  );

  v_cached := jsonb_build_object('ok', true, 'session', to_jsonb(v_saved));
  perform public.station_cash_idempotency_complete(v_device_id, p_idempotency_key, v_cached);
  return v_cached;
exception
  when others then
    if sqlerrm = 'Ya existe una caja abierta.' then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.station_cash_create_movement_impl(
  p_operator_session_token text,
  p_movement_type text,
  p_amount numeric,
  p_reason text,
  p_reference text default null,
  p_order_id uuid default null,
  p_idempotency_key text default null,
  p_skip_idempotency boolean default false,
  p_skip_idle_extend boolean default false
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
  v_register_id uuid;
  v_role text;
  v_session_row public.cash_sessions;
  v_saved public.cash_movements;
  v_cached jsonb;
  v_fingerprint text;
  v_allowed_cashier text[] := array['deposit', 'sale_cash', 'refund'];
  v_generic constant text := 'No se pudo registrar el movimiento.';
begin
  v_fingerprint := public.station_cash_request_fingerprint(
    'movement',
    jsonb_build_object(
      'movement_type', coalesce(p_movement_type, ''),
      'amount', round(coalesce(p_amount, 0)::numeric, 2),
      'reason', coalesce(nullif(trim(coalesce(p_reason, '')), ''), ''),
      'reference', coalesce(nullif(trim(coalesce(p_reference, '')), ''), ''),
      'order_id', p_order_id
    )
  );

  if not coalesce(p_skip_idempotency, false) then
    v_cached := public.station_cash_idempotency_replay_if_completed(
      p_operator_session_token, 'movement', p_idempotency_key, v_fingerprint
    );
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  v_ctx := public.resolve_station_cash_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_register_id := (v_ctx ->> 'cash_register_id')::uuid;
  v_role := v_ctx ->> 'operator_role';

  if not coalesce(p_skip_idempotency, false) then
    v_cached := public.station_cash_idempotency_begin(
      v_device_id, v_station_id, v_op_session_id, p_idempotency_key, 'movement', v_fingerprint
    );
    if v_cached is not null then
      return v_cached;
    end if;
  end if;

  if not coalesce(p_skip_idle_extend, false) then
    perform public.station_cash_extend_operator_idle(v_op_session_id);
  end if;

  select * into v_session_row
  from public.cash_sessions
  where cash_register_id = v_register_id and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if v_session_row.id is null then
    raise exception 'No hay caja abierta.';
  end if;

  if p_movement_type not in ('sale_cash', 'withdrawal', 'deposit', 'refund', 'adjustment', 'manual_open') then
    raise exception 'Tipo de movimiento invalido.';
  end if;

  if v_role in ('cajero', 'caja') and not (p_movement_type = any(v_allowed_cashier)) then
    raise exception 'Este movimiento requiere supervisor, Admin o Gerente General.';
  end if;
  if p_movement_type in ('withdrawal', 'manual_open', 'adjustment')
    and not public.station_cash_is_supervisor(v_operator_id) then
    raise exception 'Este movimiento requiere supervisor, Admin o Gerente General.';
  end if;
  if p_movement_type in ('withdrawal', 'deposit', 'refund', 'adjustment', 'manual_open')
    and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'El motivo es obligatorio.';
  end if;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, authorized_by, movement_type,
    amount, reason, reference, order_id, metadata
  ) values (
    v_session_row.id, v_session_row.cash_register_id, v_operator_id,
    case when public.station_cash_is_supervisor(v_operator_id) then v_operator_id else null end,
    p_movement_type,
    coalesce(p_amount, 0)::numeric(12,2),
    nullif(trim(coalesce(p_reason, '')), ''),
    nullif(trim(coalesce(p_reference, '')), ''),
    p_order_id,
    jsonb_build_object(
      'operational_station_id', v_station_id,
      'operational_station_device_id', v_device_id,
      'operator_profile_id', v_operator_id
    )
  ) returning * into v_saved;

  update public.cash_sessions
  set expected_cash = public.calculate_cash_expected(v_session_row.id),
      updated_at = now()
  where id = v_session_row.id;

  v_cached := jsonb_build_object('ok', true, 'movement', to_jsonb(v_saved));

  if p_movement_type = 'sale_cash' then
    update public.operational_operator_sessions
    set revoked_at = now(), revoke_reason = 'sale_complete'
    where id = v_op_session_id and revoked_at is null;
    perform public.log_operational_station_event(
      v_station_id, v_device_id, 'operator_session_locked', v_operator_id,
      jsonb_build_object('reason', 'sale_complete'), null
    );
    v_cached := v_cached || jsonb_build_object('operator_locked', true);
  end if;

  if not coalesce(p_skip_idempotency, false) then
    perform public.station_cash_idempotency_complete(v_device_id, p_idempotency_key, v_cached);
  end if;
  return v_cached;
exception
  when others then
    if sqlerrm in (
      'No hay caja abierta.', 'Tipo de movimiento invalido.',
      'Este movimiento requiere supervisor, Admin o Gerente General.',
      'El motivo es obligatorio.'
    ) then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.close_station_cash_session(
  p_operator_session_token text,
  p_counted_cash numeric,
  p_notes text default null,
  p_idempotency_key text default null
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
  v_register_id uuid;
  v_op_session_id uuid;
  v_session_row public.cash_sessions;
  v_expected numeric(12,2);
  v_saved public.cash_sessions;
  v_cached jsonb;
  v_fingerprint text;
  v_generic constant text := 'No se pudo cerrar caja.';
begin
  v_fingerprint := public.station_cash_request_fingerprint(
    'close',
    jsonb_build_object(
      'counted_cash', round(coalesce(p_counted_cash, 0)::numeric, 2),
      'notes', coalesce(nullif(trim(coalesce(p_notes, '')), ''), '')
    )
  );

  v_cached := public.station_cash_idempotency_replay_if_completed(
    p_operator_session_token, 'close', p_idempotency_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_cash_operator_context(p_operator_session_token, false);
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;
  v_register_id := (v_ctx ->> 'cash_register_id')::uuid;
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;

  v_cached := public.station_cash_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, p_idempotency_key, 'close', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_cash_extend_operator_idle(v_op_session_id);

  select * into v_session_row
  from public.cash_sessions
  where cash_register_id = v_register_id and status = 'open'
  order by opened_at desc
  limit 1
  for update;

  if v_session_row.id is null then
    raise exception 'No hay caja abierta.';
  end if;

  if not public.station_cash_is_supervisor(v_operator_id)
    and v_session_row.opened_by <> v_operator_id then
    raise exception 'Solo puedes cerrar tu propia caja.';
  end if;

  v_expected := public.calculate_cash_expected(v_session_row.id);

  update public.cash_sessions
  set expected_cash = v_expected,
      counted_cash = coalesce(p_counted_cash, 0)::numeric(12,2),
      difference = (coalesce(p_counted_cash, 0)::numeric(12,2) - v_expected)::numeric(12,2),
      status = 'closed',
      closed_by = v_operator_id,
      closed_at = now(),
      notes = nullif(trim(coalesce(p_notes, v_session_row.notes, '')), ''),
      updated_at = now()
  where id = v_session_row.id
  returning * into v_saved;

  insert into public.cash_movements (
    cash_session_id, cash_register_id, created_by, movement_type, amount, reason, metadata
  ) values (
    v_saved.id, v_saved.cash_register_id, v_operator_id, 'shift_close', 0, 'Cierre de caja',
    jsonb_build_object(
      'operational_station_id', v_station_id,
      'operational_station_device_id', v_device_id,
      'operator_profile_id', v_operator_id
    )
  );

  update public.operational_operator_sessions
  set revoked_at = now(), revoke_reason = 'shift_close'
  where id = v_op_session_id and revoked_at is null;

  perform public.log_operational_station_event(
    v_station_id, v_device_id, 'operator_session_locked', v_operator_id,
    jsonb_build_object('reason', 'shift_close', 'cash_session_id', v_saved.id),
    nullif(trim(p_idempotency_key), '')
  );

  v_cached := jsonb_build_object('ok', true, 'session', to_jsonb(v_saved), 'operator_locked', true);
  perform public.station_cash_idempotency_complete(v_device_id, p_idempotency_key, v_cached);
  return v_cached;
exception
  when others then
    if sqlerrm in ('No hay caja abierta.', 'Solo puedes cerrar tu propia caja.') then
      raise;
    end if;
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception '%', v_generic;
end;
$$;

create or replace function public.record_station_cash_sale(
  p_operator_session_token text,
  p_order_id uuid,
  p_amount numeric,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_ctx jsonb;
  v_op_session_id uuid;
  v_station_id uuid;
  v_device_id uuid;
  v_operator_id uuid;
  v_cached jsonb;
  v_fingerprint text;
begin
  v_fingerprint := public.station_cash_request_fingerprint(
    'sale',
    jsonb_build_object(
      'order_id', p_order_id,
      'amount', round(coalesce(p_amount, 0)::numeric, 2)
    )
  );

  v_cached := public.station_cash_idempotency_replay_if_completed(
    p_operator_session_token, 'sale', p_idempotency_key, v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  v_ctx := public.resolve_station_cash_operator_context(p_operator_session_token, false);
  v_op_session_id := (v_ctx ->> 'operator_session_id')::uuid;
  v_station_id := (v_ctx ->> 'station_id')::uuid;
  v_device_id := (v_ctx ->> 'device_id')::uuid;
  v_operator_id := (v_ctx ->> 'operator_profile_id')::uuid;

  v_cached := public.station_cash_idempotency_begin(
    v_device_id, v_station_id, v_op_session_id, p_idempotency_key, 'sale', v_fingerprint
  );
  if v_cached is not null then
    return v_cached;
  end if;

  perform public.station_cash_extend_operator_idle(v_op_session_id);

  v_result := public.station_cash_create_movement_impl(
    p_operator_session_token,
    'sale_cash',
    p_amount,
    'Venta en efectivo estacion',
    coalesce(p_order_id::text, ''),
    p_order_id,
    null,
    true,
    true
  );

  update public.operational_operator_sessions
  set revoked_at = now(), revoke_reason = 'sale_complete'
  where id = v_op_session_id and revoked_at is null;

  perform public.log_operational_station_event(
    v_station_id, v_device_id, 'operator_session_locked', v_operator_id,
    jsonb_build_object('reason', 'sale_complete', 'order_id', p_order_id),
    nullif(trim(p_idempotency_key), '')
  );

  v_result := v_result || jsonb_build_object('operator_locked', true);
  perform public.station_cash_idempotency_complete(v_device_id, p_idempotency_key, v_result);
  return v_result;
exception
  when others then
    if sqlerrm like 'Conflicto de idempotencia:%' or sqlerrm = 'Se requiere clave de idempotencia.' then
      raise;
    end if;
    raise exception 'No se pudo registrar la venta en efectivo.';
end;
$$;

create or replace function public.create_station_cash_movement(
  p_operator_session_token text,
  p_movement_type text,
  p_amount numeric,
  p_reason text,
  p_reference text default null,
  p_order_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.station_cash_create_movement_impl(
    p_operator_session_token,
    p_movement_type,
    p_amount,
    p_reason,
    p_reference,
    p_order_id,
    p_idempotency_key,
    false,
    false
  );
$$;

revoke all on function public.get_station_cash_context(text) from public, anon;
grant execute on function public.get_station_cash_context(text) to authenticated;

revoke all on function public.open_station_cash_session(text, numeric, text, text) from public, anon;
grant execute on function public.open_station_cash_session(text, numeric, text, text) to authenticated;

revoke all on function public.station_cash_create_movement_impl(text, text, numeric, text, text, uuid, text, boolean, boolean) from public, anon, authenticated, service_role;

revoke all on function public.create_station_cash_movement(text, text, numeric, text, text, uuid, text) from public, anon;
grant execute on function public.create_station_cash_movement(text, text, numeric, text, text, uuid, text) to authenticated;

revoke all on function public.close_station_cash_session(text, numeric, text, text) from public, anon;
grant execute on function public.close_station_cash_session(text, numeric, text, text) to authenticated;

revoke all on function public.record_station_cash_sale(text, uuid, numeric, text) from public, anon;
grant execute on function public.record_station_cash_sale(text, uuid, numeric, text) to authenticated;

revoke all on function public.station_cash_bind_operator_session_by_token(text) from public, anon, authenticated, service_role;
revoke all on function public.station_cash_idempotency_replay_if_completed(text, text, text, text) from public, anon, authenticated, service_role;

commit;
