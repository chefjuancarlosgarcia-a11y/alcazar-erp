-- Tests 194_station_cash_operator_wrappers.sql

begin;

create or replace function public.test_station_cash_wrappers_194()
returns table(scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolve_oid oid;
begin
  return query select 'wrapper_functions_exist'::text,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_station_cash_context')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_station_cash_session')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_station_cash_movement')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'close_station_cash_session')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_station_cash_sale'),
    'station cash rpcs'::text;

  select p.oid into v_resolve_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'resolve_station_cash_operator_context'
  limit 1;

  return query select 'resolve_not_granted_to_authenticated'::text,
    v_resolve_oid is not null and not has_function_privilege('authenticated', v_resolve_oid, 'EXECUTE'),
    'internal resolver'::text;

  return query select 'idempotency_table'::text,
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'
    ),
    'idempotency table'::text;

  return query select 'idempotency_fingerprint_column'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'operational_station_cash_idempotency'
        and column_name = 'request_fingerprint'
    ),
    'fingerprint'::text;

  return query select 'idempotency_helpers'::text,
    exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_idempotency_begin')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_request_fingerprint')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'station_cash_idempotency_replay_if_completed'),
    'idempotency rpc helpers'::text;
end;
$$;

with results as materialized (
  select * from public.test_station_cash_wrappers_194()
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

drop function if exists public.test_station_cash_wrappers_194();

rollback;
