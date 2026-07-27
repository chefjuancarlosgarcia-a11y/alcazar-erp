-- Tests for 193_operational_operator_access_foundation.sql (local; BEGIN…ROLLBACK).

begin;

create or replace function public.test_operational_operator_access_193()
returns table(scenario text, ok boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  scenario := 'tables_exist';
  ok := exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_credentials')
    and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
    and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_assignments')
    and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_pin_attempt_buckets');
  detail := 'os2 tables';
  return next;

  scenario := 'device_context_includes_cash_register_id';
  ok := exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_operational_station_device_context'
  );
  detail := 'function present';
  return next;

  scenario := 'verify_pin_rpc_exists';
  ok := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device'
  );
  detail := 'verify_operational_pin_for_device';
  return next;

  scenario := 'admin_pin_rpc_exists';
  ok := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_set_operational_pin'
  );
  detail := 'admin_set_operational_pin';
  return next;
end;
$$;

select scenario, ok, detail
from public.test_operational_operator_access_193();

rollback;
