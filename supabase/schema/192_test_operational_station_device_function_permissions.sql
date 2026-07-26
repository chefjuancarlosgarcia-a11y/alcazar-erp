-- Regression for 192_operational_station_device_function_permissions.sql
-- Run AFTER applying 192 (190+191 already applied). BEGIN … ROLLBACK.

begin;

create or replace function public.test_operational_station_device_permissions_192()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_ctx_oid oid;
  v_touch_oid oid;
  v_claim_oid oid;
begin
  select p.oid into v_ctx_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_operational_station_device_context';

  select p.oid into v_touch_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'touch_operational_station_device_seen';

  select p.oid into v_claim_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'claim_station_enrollment';

  return query select 'device_context_service_role_denied'::text,
    not has_function_privilege('service_role', v_ctx_oid, 'EXECUTE'),
    'get_operational_station_device_context'::text;

  return query select 'touch_seen_service_role_denied'::text,
    not has_function_privilege('service_role', v_touch_oid, 'EXECUTE'),
    'touch_operational_station_device_seen'::text;

  return query select 'device_context_authenticated_allowed'::text,
    has_function_privilege('authenticated', v_ctx_oid, 'EXECUTE'),
    'authenticated device session'::text;

  return query select 'touch_seen_authenticated_allowed'::text,
    has_function_privilege('authenticated', v_touch_oid, 'EXECUTE'),
    'authenticated device session'::text;

  return query select 'device_context_public_aclexplode_denied'::text,
    not exists (
      select 1 from pg_proc p
      where p.oid = v_ctx_oid
        and exists (
          select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
    ),
    'PUBLIC EXECUTE absent'::text;

  return query select 'edge_claim_service_role_still_allowed'::text,
    has_function_privilege('service_role', v_claim_oid, 'EXECUTE'),
    'unchanged Edge RPC'::text;

  return query select 'inventory_twenty_os1_functions'::text,
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
    'count=20'::text;

  return query select 'acl_diagnostic_matrix_all_match'::text,
    (
      select coalesce(bool_and(
        case f.expected_access
          when 'service_role_only' then
            not f.public_execute and not f.anon_execute and not f.authenticated_execute
            and f.service_role_execute
          when 'internal_only' then
            not f.public_execute and not f.anon_execute and not f.authenticated_execute
            and not f.service_role_execute
          when 'authenticated_device' then
            not f.public_execute and not f.anon_execute and f.authenticated_execute
            and not f.service_role_execute
          when 'authenticated_read' then
            not f.public_execute and not f.anon_execute and f.authenticated_execute
          when 'authenticated_admin' then
            not f.public_execute and not f.anon_execute and f.authenticated_execute
        end
      ), false)
      from (
        select
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
          has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
          has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
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
    ),
    'matches diagnose_operational_stations_function_acl_190'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_operational_station_device_permissions_192()
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

drop function if exists public.test_operational_station_device_permissions_192();

rollback;
