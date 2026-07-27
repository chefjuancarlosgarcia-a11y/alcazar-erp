-- Behavioral / ACL tests: terminal-session idempotent replay (194).
-- Full concurrent replay requires post-apply runbook (two connections).
-- See docs/os2-station-cash-replay-terminal-runbook.md

begin;

create or replace function public.test_station_cash_replay_terminal_194()
returns table(scenario text, ok boolean, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def text;
begin
  scenario := 'replay_helper_exists';
  ok := exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'station_cash_idempotency_replay_if_completed'
  );
  detail := 'replay_if_completed';
  return next;

  scenario := 'bind_helper_not_client_executable';
  ok := not has_function_privilege(
    'authenticated',
    'public.station_cash_bind_operator_session_by_token(text)',
    'EXECUTE'
  );
  detail := 'bind internal';
  return next;

  scenario := 'replay_not_client_executable';
  ok := not has_function_privilege(
    'authenticated',
    'public.station_cash_idempotency_replay_if_completed(text, text, text, text)',
    'EXECUTE'
  );
  detail := 'replay internal';
  return next;

  scenario := 'movement_impl_not_client_executable';
  ok := not has_function_privilege(
    'authenticated',
    'public.station_cash_create_movement_impl(text, text, numeric, text, text, uuid, text, boolean, boolean)',
    'EXECUTE'
  );
  detail := 'skip-idempotency impl ACL';
  return next;

  scenario := 'movement_public_7arg_granted';
  ok := has_function_privilege(
    'authenticated',
    'public.create_station_cash_movement(text, text, numeric, text, text, uuid, text)',
    'EXECUTE'
  );
  detail := 'client movement wrapper';
  return next;

  scenario := 'record_sale_replay_before_active_resolve';
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'record_station_cash_sale'
  limit 1;
  ok := v_def is not null
    and position('station_cash_idempotency_replay_if_completed' in v_def)
      < position('resolve_station_cash_operator_context' in v_def);
  detail := 'replay-first order in record_station_cash_sale';
  return next;

  scenario := 'close_replay_before_active_resolve';
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'close_station_cash_session'
  limit 1;
  ok := v_def is not null
    and position('station_cash_idempotency_replay_if_completed' in v_def)
      < position('resolve_station_cash_operator_context' in v_def);
  detail := 'replay-first order in close';
  return next;
end;
$$;

select scenario, ok, detail from public.test_station_cash_replay_terminal_194();

rollback;
