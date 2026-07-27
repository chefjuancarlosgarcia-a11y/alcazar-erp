-- OS1 corrective function ACL (forward-only). Apply after 190_operational_stations_foundation.sql.
-- No data changes, no flag, no DROP tables, no Auth users.

begin;

-- ---------------------------------------------------------------------------
-- A. Edge / service_role only (device enrollment pipeline)
-- ---------------------------------------------------------------------------

revoke all on function public.claim_station_enrollment(text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.verify_operational_device_claim_secret(uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function public.record_operational_enrollment_secret_attempt(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.get_device_enrollment_status(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.finalize_station_device_enrollment(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.fail_station_device_enrollment(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.claim_station_enrollment(text, text, text, text, text)
  to service_role;
grant execute on function public.verify_operational_device_claim_secret(uuid, uuid, text, boolean)
  to service_role;
grant execute on function public.record_operational_enrollment_secret_attempt(uuid, boolean)
  to service_role;
grant execute on function public.get_device_enrollment_status(uuid, uuid, text)
  to service_role;
grant execute on function public.finalize_station_device_enrollment(uuid, uuid, uuid, text, text)
  to service_role;
grant execute on function public.fail_station_device_enrollment(uuid, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- B. Internal event helper (callable only by owner / other definer RPCs)
-- ---------------------------------------------------------------------------

revoke all on function public.log_operational_station_event(uuid, uuid, text, uuid, jsonb, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C. Authenticated admin / device RPCs
-- ---------------------------------------------------------------------------

revoke all on function public.operational_stations_enabled()
  from public, anon, authenticated;
revoke all on function public.is_operational_stations_admin()
  from public, anon, authenticated;

revoke all on function public.provision_operational_station(text, text, text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.update_operational_station(uuid, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_station_enrollment_token(uuid, text)
  from public, anon, authenticated;
revoke all on function public.authorize_station_device_enrollment(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.reject_and_block_station_device(uuid, text)
  from public, anon, authenticated;
revoke all on function public.revoke_station_device(uuid, text)
  from public, anon, authenticated;
revoke all on function public.replace_station_device(uuid, text)
  from public, anon, authenticated;
revoke all on function public.list_operational_stations_admin()
  from public, anon, authenticated;
revoke all on function public.list_operational_station_devices_admin(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_operational_station_device_context()
  from public, anon, authenticated;
revoke all on function public.touch_operational_station_device_seen(text)
  from public, anon, authenticated;

grant execute on function public.operational_stations_enabled() to authenticated;
grant execute on function public.is_operational_stations_admin() to authenticated;
grant execute on function public.provision_operational_station(text, text, text, text, uuid, text)
  to authenticated;
grant execute on function public.update_operational_station(uuid, text, text, text, text)
  to authenticated;
grant execute on function public.create_station_enrollment_token(uuid, text) to authenticated;
grant execute on function public.authorize_station_device_enrollment(uuid, text, text, text)
  to authenticated;
grant execute on function public.reject_and_block_station_device(uuid, text) to authenticated;
grant execute on function public.revoke_station_device(uuid, text) to authenticated;
grant execute on function public.replace_station_device(uuid, text) to authenticated;
grant execute on function public.list_operational_stations_admin() to authenticated;
grant execute on function public.list_operational_station_devices_admin(uuid, text) to authenticated;
grant execute on function public.get_operational_station_device_context() to authenticated;
grant execute on function public.touch_operational_station_device_seen(text) to authenticated;

revoke execute on function public.get_operational_station_device_context()
  from service_role;
revoke execute on function public.touch_operational_station_device_seen(text)
  from service_role;

commit;
