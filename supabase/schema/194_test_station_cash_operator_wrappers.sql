-- Tests 194_station_cash_operator_wrappers.sql

begin;

create or replace function public.test_station_cash_wrappers_194()
returns table(scenario text, ok boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  scenario := 'wrapper_functions_exist';
  ok := exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_station_cash_context')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_station_cash_session')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_station_cash_movement')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'close_station_cash_session')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_station_cash_sale');
  detail := 'station cash rpcs';
  return next;

  scenario := 'resolve_not_granted_to_authenticated';
  ok := not has_function_privilege('authenticated', 'public.resolve_station_cash_operator_context(text, boolean)', 'EXECUTE');
  detail := 'internal resolver';
  return next;

  scenario := 'idempotency_table';
  ok := exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'
  );
  detail := 'idempotency table';
  return next;

  scenario := 'idempotency_fingerprint_column';
  ok := exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operational_station_cash_idempotency'
      and column_name = 'request_fingerprint'
  );
  detail := 'fingerprint';
  return next;

  scenario := 'idempotency_helpers';
  ok := exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_idempotency_begin')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_request_fingerprint')
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_idempotency_replay_if_completed');
  detail := 'idempotency rpc helpers';
  return next;
end;
$$;

select scenario, ok, detail from public.test_station_cash_wrappers_194();

rollback;
