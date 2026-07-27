-- Tests for 193_operational_operator_access_foundation.sql (BEGIN…ROLLBACK).

begin;

create or replace function public.test_operational_operator_access_193()
returns table(scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pepper_oid oid;
  v_pepper_fn oid;
  v_lookup_fn oid;
begin
  return query select 'tables_exist'::text,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_credentials')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_assignments')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_pin_attempt_buckets'),
    'os2 credential tables'::text;

  return query select 'secret_storage_table'::text,
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_security_secrets'),
    'operational_security_secrets'::text;

  return query select 'pepper_not_in_app_settings'::text,
    not exists (select 1 from public.app_settings where key = 'operational_pin_pepper'),
    'no operational_pin_pepper key'::text;

  select c.oid into v_pepper_oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'operational_security_secrets';

  return query select 'secret_table_rls_enabled'::text,
    coalesce((
      select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'operational_security_secrets'
    ), false),
    'RLS on secrets'::text;

  return query select 'secret_table_authenticated_select_denied'::text,
    v_pepper_oid is not null and not has_table_privilege('authenticated', v_pepper_oid, 'SELECT'),
    'authenticated no SELECT'::text;

  return query select 'secret_table_public_acl_denied'::text,
    v_pepper_oid is not null and not exists (
      select 1 from aclexplode(coalesce((select relacl from pg_class where oid = v_pepper_oid), acldefault('r', (select relowner from pg_class where oid = v_pepper_oid)))) a
      where a.grantee = 0 and a.privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
    ),
    'PUBLIC table ACL'::text;

  return query select 'secret_row_exists'::text,
    exists (
      select 1 from public.operational_security_secrets
      where secret_name = 'operational_pin_lookup_pepper'
    ),
    'pepper row present'::text;

  select p.oid into v_pepper_fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operational_pin_pepper_value';

  select p.oid into v_lookup_fn
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operational_pin_lookup';

  return query select 'pepper_helper_not_client'::text,
    v_pepper_fn is not null
      and not has_function_privilege('authenticated', v_pepper_fn, 'EXECUTE')
      and not has_function_privilege('anon', v_pepper_fn, 'EXECUTE'),
    'operational_pin_pepper_value internal'::text;

  return query select 'pin_lookup_helper_not_client'::text,
    v_lookup_fn is not null
      and not has_function_privilege('authenticated', v_lookup_fn, 'EXECUTE'),
    'operational_pin_lookup internal'::text;

  return query select 'admin_set_pin_no_plaintext_return'::text,
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'admin_set_operational_pin'
        and pg_get_functiondef(p.oid) ~ '''pin'',\s*v_pin'
    ),
    'admin JSON omits pin'::text;

  return query select 'verify_pin_rpc_exists'::text,
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device'
    ),
    'verify_operational_pin_for_device'::text;

  return query select 'device_context_includes_cash_register_id'::text,
    position('cash_register_id' in pg_get_functiondef(p.oid)) > 0
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_operational_station_device_context'
    limit 1,
    'cash_register_id in context'::text;
end;
$$;

with results as materialized (
  select * from public.test_operational_operator_access_193()
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

drop function if exists public.test_operational_operator_access_193();

rollback;
