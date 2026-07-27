-- OS1 rollback (forward-only): disable flag, revoke access; no DROP.
-- Apply manually if OS1 must be neutralized.

begin;

update public.app_settings
set value = jsonb_set(coalesce(value, '{}'::jsonb), '{enabled}', 'false'::jsonb, true),
    updated_at = now()
where key = 'operational_stations_enabled';

update public.operational_station_devices
set status = 'revoked', revoked_at = coalesce(revoked_at, now()), updated_at = now()
where status = 'active';

update public.operational_station_enrollment_tokens
set status = 'revoked', updated_at = now()
where status in ('pending', 'claimed', 'authorized');

revoke execute on function
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
  public.touch_operational_station_device_seen(text)
from authenticated;

-- Manual: ban Auth technical users via Supabase dashboard / Edge admin API.
-- Do not DELETE operational_station_* rows (audit retention).

commit;
