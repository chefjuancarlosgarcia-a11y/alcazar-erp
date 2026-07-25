-- ACL regression for 191_operational_stations_function_permissions.sql
-- Run AFTER applying 191 (190 must already be applied). BEGIN … ROLLBACK.

begin;

create or replace function public.test_operational_stations_function_permissions_191()
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
  return query
  select 'acl_public_claim_via_aclexplode'::text,
    not exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'claim_station_enrollment'
        and exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
    ),
    'grantee OID 0 has no EXECUTE on claim'::text;

  return query
  select 'acl_service_role_edge_bundle'::text,
    (
      select bool_and(has_function_privilege('service_role', sig, 'EXECUTE'))
      from unnest(array[
        'public.claim_station_enrollment(text,text,text,text,text)'::regprocedure,
        'public.get_device_enrollment_status(uuid,uuid,text)'::regprocedure,
        'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)'::regprocedure
      ]) as sig
    )
    and (
      select bool_and(not has_function_privilege('authenticated', sig, 'EXECUTE'))
      from unnest(array[
        'public.claim_station_enrollment(text,text,text,text,text)'::regprocedure,
        'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)'::regprocedure
      ]) as sig
    ),
    'Edge RPC service_role only'::text;

  return query
  select 'acl_anon_no_direct_os1_rpc'::text,
    (
      select bool_and(not has_function_privilege('anon', sig, 'EXECUTE'))
      from unnest(array[
        'public.claim_station_enrollment(text,text,text,text,text)'::regprocedure,
        'public.provision_operational_station(text,text,text,text,uuid,text)'::regprocedure,
        'public.create_station_enrollment_token(uuid,text)'::regprocedure
      ]) as sig
    ),
    'anon denied direct OS1 RPC'::text;

  return query
  select 'acl_authenticated_admin_bundle'::text,
    (
      select bool_and(has_function_privilege('authenticated', sig, 'EXECUTE'))
      from unnest(array[
        'public.provision_operational_station(text,text,text,text,uuid,text)'::regprocedure,
        'public.authorize_station_device_enrollment(uuid,text,text,text)'::regprocedure,
        'public.is_operational_stations_admin()'::regprocedure
      ]) as sig
    ),
    'admin RPC authenticated'::text;

  return query
  select 'acl_log_not_world_executable'::text,
    not has_function_privilege('anon', 'public.log_operational_station_event(uuid,uuid,text,uuid,jsonb,text)', 'EXECUTE')
    and not has_function_privilege(
      'authenticated',
      'public.log_operational_station_event(uuid,uuid,text,uuid,jsonb,text)',
      'EXECUTE'
    ),
    'log_operational_station_event internal'::text;

  return query
  select 'acl_matrix_twenty_functions'::text,
    (
      select count(*) = 20
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'operational_stations_enabled', 'is_operational_stations_admin',
          'log_operational_station_event', 'provision_operational_station',
          'update_operational_station', 'create_station_enrollment_token',
          'record_operational_enrollment_secret_attempt',
          'verify_operational_device_claim_secret', 'claim_station_enrollment',
          'authorize_station_device_enrollment', 'reject_and_block_station_device',
          'get_device_enrollment_status', 'finalize_station_device_enrollment',
          'fail_station_device_enrollment', 'revoke_station_device',
          'replace_station_device', 'list_operational_stations_admin',
          'list_operational_station_devices_admin',
          'get_operational_station_device_context', 'touch_operational_station_device_seen'
        )
    ),
    'inventory count'::text;

  return query
  select 'acl_all_rows_match_expected'::text,
    (
      select count(*) = 0
      from (
        select
          case f.expected_access
            when 'service_role_only' then
              not f.public_execute and not f.anon_execute and not f.authenticated_execute
              and f.service_role_execute
            when 'internal_only' then
              not f.public_execute and not f.anon_execute and not f.authenticated_execute
            when 'authenticated_device' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
            when 'authenticated_read' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
            when 'authenticated_admin' then
              not f.public_execute and not f.anon_execute and f.authenticated_execute
          end as ok
        from (
          select
            p.proname,
            case p.proname
              when 'claim_station_enrollment' then 'service_role_only'
              when 'verify_operational_device_claim_secret' then 'service_role_only'
              when 'record_operational_enrollment_secret_attempt' then 'service_role_only'
              when 'get_device_enrollment_status' then 'service_role_only'
              when 'finalize_station_device_enrollment' then 'service_role_only'
              when 'fail_station_device_enrollment' then 'service_role_only'
              when 'log_operational_station_event' then 'internal_only'
              when 'get_operational_station_device_context' then 'authenticated_device'
              when 'touch_operational_station_device_seen' then 'authenticated_device'
              when 'operational_stations_enabled' then 'authenticated_read'
              else 'authenticated_admin'
            end as expected_access,
            exists (
              select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where a.grantee = 0 and a.privilege_type = 'EXECUTE'
            ) as public_execute,
            has_function_privilege(
              'anon',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as anon_execute,
            has_function_privilege(
              'authenticated',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as authenticated_execute,
            has_function_privilege(
              'service_role',
              format('public.%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid))::regprocedure,
              'EXECUTE'
            ) as service_role_execute
          from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.proname in (
              'operational_stations_enabled', 'is_operational_stations_admin',
              'log_operational_station_event', 'provision_operational_station',
              'update_operational_station', 'create_station_enrollment_token',
              'record_operational_enrollment_secret_attempt',
              'verify_operational_device_claim_secret', 'claim_station_enrollment',
              'authorize_station_device_enrollment', 'reject_and_block_station_device',
              'get_device_enrollment_status', 'finalize_station_device_enrollment',
              'fail_station_device_enrollment', 'revoke_station_device',
              'replace_station_device', 'list_operational_stations_admin',
              'list_operational_station_devices_admin',
              'get_operational_station_device_context', 'touch_operational_station_device_seen'
            )
        ) f
      ) checks
      where not ok
    ),
    'diagnose-equivalent matrix'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_operational_stations_function_permissions_191()
),
summary as (
  select
    count(*)::int as total,
    count(*) filter (where passed)::int as passed_total,
    count(*) filter (where not passed)::int as failed_total
  from results
)
select
  r.scenario,
  r.passed,
  r.detail,
  s.total,
  s.passed_total,
  s.failed_total
from results r
cross join summary s
order by r.passed asc, r.scenario;

drop function if exists public.test_operational_stations_function_permissions_191();

rollback;
