-- Postflight for 196: device-linked profiles should be zero after cleanup.
-- Run after 196_fix_operational_station_technical_identity.sql.

select
  count(*) as remaining_device_linked_profiles
from public.profiles p
inner join public.operational_station_devices d on d.auth_user_id = p.id
where d.auth_user_id is not null;

select
  count(*) as active_devices_missing_auth_user
from public.operational_station_devices d
where d.status = 'active'
  and d.auth_user_id is null;
