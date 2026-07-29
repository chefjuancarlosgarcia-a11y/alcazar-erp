-- Forward-fix: bind operational PIN module to station_type (ignore client-declared module mismatch).
-- Apply remotely after 196. Does not revoke existing sessions or mutate credentials.

begin;

alter table public.operational_operator_sessions
  add column if not exists absolute_expires_at timestamptz;

comment on column public.operational_operator_sessions.absolute_expires_at is
  'Optional hard cap for operator session (POS default 15 minutes at issuance).';

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
  v_required_module text;
  v_lookup text;
  v_cred public.operational_credentials;
  v_profile public.profiles;
  v_token text;
  v_token_hash text;
  v_idle_seconds int;
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
  if v_station.id is null or v_station.status <> 'active' or v_device.status <> 'active' then
    raise exception '%', v_generic;
  end if;

  v_required_module := case v_station.station_type
    when 'cash' then 'cash'
    when 'pos' then 'pos'
    when 'kds' then 'kds'
    when 'production' then 'production'
    else null
  end;

  if v_required_module is null then
    raise exception '%', v_generic;
  end if;

  if nullif(trim(coalesce(p_module, '')), '') is distinct from v_required_module then
    raise exception '%', v_generic;
  end if;

  if v_required_module = 'cash' and v_station.cash_register_id is null then
    raise exception '%', v_generic;
  end if;

  v_idle_seconds := case v_required_module
    when 'pos' then 120
    when 'cash' then 90
    else 90
  end;

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
    idle_expires_at,
    absolute_expires_at
  )
  values (
    v_device.id,
    v_station.id,
    v_cred.profile_id,
    v_required_module,
    v_token_hash,
    nullif(trim(p_idempotency_key), ''),
    now() + make_interval(secs => v_idle_seconds),
    case
      when v_required_module = 'pos' then now() + interval '15 minutes'
      else null
    end
  )
  returning * into v_session;

  perform public.clear_operational_pin_attempt(v_bucket);

  return jsonb_build_object(
    'ok', true,
    'session_token', v_token,
    'operator_profile_id', v_cred.profile_id,
    'operator_name', coalesce(v_profile.full_name, v_profile.username, 'Operador'),
    'idle_expires_at', v_session.idle_expires_at,
    'absolute_expires_at', v_session.absolute_expires_at,
    'module', v_required_module,
    'idempotent', false
  );
end;
$$;

revoke all on function public.verify_operational_pin_for_device(text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.verify_operational_pin_for_device(text, text, text) to authenticated;

commit;
