-- OS1 function ACL read-only (post-190 / pre or post-191).
-- Single SELECT; no DDL/DML. Run in Supabase SQL Editor.

with os1_functions as (
  select
    p.oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as function_signature,
    p.prosecdef as security_definer,
    coalesce(array_to_string(p.proconfig, ', '), '') as function_config,
    p.proacl::text as proacl,
    r.rolname as owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where n.nspname = 'public'
    and p.proname in (
      'operational_stations_enabled',
      'is_operational_stations_admin',
      'log_operational_station_event',
      'provision_operational_station',
      'update_operational_station',
      'create_station_enrollment_token',
      'record_operational_enrollment_secret_attempt',
      'verify_operational_device_claim_secret',
      'claim_station_enrollment',
      'authorize_station_device_enrollment',
      'reject_and_block_station_device',
      'get_device_enrollment_status',
      'finalize_station_device_enrollment',
      'fail_station_device_enrollment',
      'revoke_station_device',
      'replace_station_device',
      'list_operational_stations_admin',
      'list_operational_station_devices_admin',
      'get_operational_station_device_context',
      'touch_operational_station_device_seen'
    )
),
acl_flags as (
  select
    f.*,
    exists (
      select 1
      from aclexplode(coalesce(f.proacl, acldefault('f', (select proowner from pg_proc where oid = f.oid)))) a
      where a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) as public_execute,
    has_function_privilege(
      'anon',
      format('%I.%I(%s)', f.schema_name, f.function_name, f.function_signature)::regprocedure,
      'EXECUTE'
    ) as anon_execute,
    has_function_privilege(
      'authenticated',
      format('%I.%I(%s)', f.schema_name, f.function_name, f.function_signature)::regprocedure,
      'EXECUTE'
    ) as authenticated_execute,
    has_function_privilege(
      'service_role',
      format('%I.%I(%s)', f.schema_name, f.function_name, f.function_signature)::regprocedure,
      'EXECUTE'
    ) as service_role_execute,
    case f.function_name
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
    end as expected_access
  from os1_functions f
)
select
  schema_name,
  function_name,
  function_signature,
  security_definer,
  function_config,
  proacl,
  public_execute,
  anon_execute,
  authenticated_execute,
  service_role_execute,
  owner,
  expected_access,
  case expected_access
    when 'service_role_only' then
      not public_execute
      and not anon_execute
      and not authenticated_execute
      and service_role_execute
    when 'internal_only' then
      not public_execute
      and not anon_execute
      and not authenticated_execute
      and not service_role_execute
    when 'authenticated_device' then
      not public_execute
      and not anon_execute
      and authenticated_execute
      and not service_role_execute
    when 'authenticated_read' then
      not public_execute
      and not anon_execute
      and authenticated_execute
    when 'authenticated_admin' then
      not public_execute
      and not anon_execute
      and authenticated_execute
  end as acl_matches_expected
from acl_flags
order by function_name, function_signature;
