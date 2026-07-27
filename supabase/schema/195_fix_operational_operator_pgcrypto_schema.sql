-- Forward fix: qualify pgcrypto calls in OS2 operator RPCs (193 already applied remotely).
-- Apply after 194_station_cash_operator_wrappers.sql. No data/flag/PIN changes.

begin;

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
    extensions.crypt(v_pin, extensions.gen_salt('bf')),
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

  return jsonb_build_object('ok', true);
end;
$$;

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
    or extensions.crypt(p_pin, v_cred.pin_hash) <> v_cred.pin_hash then
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

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

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
  v_hash text := encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex');
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
  v_hash text := encode(extensions.digest(trim(p_session_token), 'sha256'), 'hex');
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

revoke all on function public.admin_set_operational_pin(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_operational_pin(uuid, text) to authenticated;

revoke all on function public.verify_operational_pin_for_device(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_operational_pin_for_device(text, text, text) to authenticated;

revoke all on function public.touch_operational_operator_session(text) from public, anon, authenticated, service_role;
grant execute on function public.touch_operational_operator_session(text) to authenticated;

revoke all on function public.lock_operational_operator_session(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.lock_operational_operator_session(text, text, text) to authenticated;

commit;
