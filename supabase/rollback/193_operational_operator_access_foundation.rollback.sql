-- Rollback 193_operational_operator_access_foundation.sql (forward-only companion).

begin;

drop function if exists public.lock_operational_operator_session(text, text, text);
drop function if exists public.touch_operational_operator_session(text);
drop function if exists public.verify_operational_pin_for_device(text, text, text);
drop function if exists public.admin_get_operational_access_summary(uuid);
drop function if exists public.admin_assign_operational_station(uuid, uuid, boolean);
drop function if exists public.admin_set_operational_pin(uuid, text);
drop function if exists public.clear_operational_pin_attempt(text);
drop function if exists public.record_operational_pin_attempt(text, int, int);
drop function if exists public.resolve_operational_device_for_auth_user();
drop function if exists public.operational_pin_lookup(text);
drop function if exists public.operational_pin_pepper_value();
drop function if exists public.is_operational_access_admin();

drop table if exists public.operational_pin_attempt_buckets;
drop table if exists public.operational_operator_sessions;
drop table if exists public.operational_station_assignments;
drop table if exists public.operational_credentials;

drop table if exists public.operational_security_secrets;

delete from public.app_settings where key = 'operational_pin_pepper';

-- Restore get_operational_station_device_context without cash_register_id (190 shape)
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

commit;
