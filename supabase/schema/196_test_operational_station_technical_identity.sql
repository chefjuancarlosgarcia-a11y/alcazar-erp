-- Regression tests for 196_fix_operational_station_technical_identity.sql
-- Run in SQL Editor AFTER applying 196. Entire file uses BEGIN … ROLLBACK (no COMMIT).

begin;

create or replace function public.test_operational_station_technical_identity_196()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
begin
  return query select 'schema_operational_station_devices_present'::text,
    to_regclass('public.operational_station_devices') is not null,
    'devices table required'::text;

  return query select 'schema_profiles_present'::text,
    to_regclass('public.profiles') is not null,
    'profiles table required'::text;

  return query select 'device_context_rpc_present'::text,
    to_regprocedure('public.get_operational_station_device_context()') is not null,
    'device context RPC unchanged'::text;

  return query select 'post_196_no_accidental_device_profiles'::text,
    (
      select count(*)
      from public.profiles p
      inner join public.operational_station_devices d on d.auth_user_id = p.id
      where d.auth_user_id is not null
        and exists (
          select 1
          from auth.users u
          where u.id = p.id
            and (
              coalesce(u.raw_app_meta_data ->> 'operational_station_device', 'false') = 'true'
              or coalesce(u.raw_user_meta_data ->> 'operational_station_device', 'false') = 'true'
            )
        )
    ) = 0,
    'no technical auth users should retain profiles after 196'::text;
end;
$$;

revoke all on function public.test_operational_station_technical_identity_196() from public;
revoke all on function public.test_operational_station_technical_identity_196() from anon;
revoke all on function public.test_operational_station_technical_identity_196() from authenticated;
grant execute on function public.test_operational_station_technical_identity_196() to service_role;

select scenario, passed, detail
from public.test_operational_station_technical_identity_196()
order by scenario;

select count(*) as total,
  count(*) filter (where passed) as passed,
  count(*) filter (where not passed) as failed
from public.test_operational_station_technical_identity_196();

drop function if exists public.test_operational_station_technical_identity_196();

rollback;
