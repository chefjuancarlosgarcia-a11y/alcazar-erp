-- OS1 device RPC ACL tighten (forward-only). Apply after 191 on shared Supabase.
-- Revokes service_role EXECUTE on device-session RPCs only.

begin;

revoke execute on function public.get_operational_station_device_context()
  from service_role;
revoke execute on function public.touch_operational_station_device_seen(text)
  from service_role;

commit;
