-- Behavioral / ACL tests: terminal-session idempotent replay (194).

begin;

create or replace function public.test_station_cash_replay_terminal_194()
returns table(scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text;
  v_bind_oid oid;
  v_replay_oid oid;
  v_impl_oid oid;
  v_move_oid oid;
begin
  return query select 'replay_helper_exists'::text,
    exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'station_cash_idempotency_replay_if_completed'
    ),
    'replay_if_completed'::text;

  select p.oid into v_bind_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'station_cash_bind_operator_session_by_token'
  limit 1;

  select p.oid into v_replay_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'station_cash_idempotency_replay_if_completed'
  limit 1;

  return query select 'bind_helper_not_client_executable'::text,
    v_bind_oid is not null and not has_function_privilege('authenticated', v_bind_oid, 'EXECUTE'),
    'bind internal'::text;

  return query select 'replay_not_client_executable'::text,
    v_replay_oid is not null and not has_function_privilege('authenticated', v_replay_oid, 'EXECUTE'),
    'replay internal'::text;

  select p.oid into v_impl_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'station_cash_create_movement_impl'
  limit 1;

  return query select 'movement_impl_not_client_executable'::text,
    v_impl_oid is not null and not has_function_privilege('authenticated', v_impl_oid, 'EXECUTE'),
    'skip-idempotency impl ACL'::text;

  select p.oid into v_move_oid
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_station_cash_movement'
  limit 1;

  return query select 'movement_public_7arg_granted'::text,
    v_move_oid is not null and has_function_privilege('authenticated', v_move_oid, 'EXECUTE'),
    'client movement wrapper'::text;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_station_cash_sale'
  limit 1;

  return query select 'record_sale_replay_before_active_resolve'::text,
    v_def is not null
      and position('station_cash_idempotency_replay_if_completed' in v_def)
        < position('resolve_station_cash_operator_context' in v_def),
    'replay-first order in record_station_cash_sale'::text;

  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'close_station_cash_session'
  limit 1;

  return query select 'close_replay_before_active_resolve'::text,
    v_def is not null
      and position('station_cash_idempotency_replay_if_completed' in v_def)
        < position('resolve_station_cash_operator_context' in v_def),
    'replay-first order in close'::text;
end;
$$;

with results as materialized (
  select * from public.test_station_cash_replay_terminal_194()
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

drop function if exists public.test_station_cash_replay_terminal_194();

rollback;
