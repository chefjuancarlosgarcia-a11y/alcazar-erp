-- Postflight read-only AFTER applying 194. No DDL/DML. No operator tokens / idempotency payloads.

with gates as (
  select 'idempotency_table_rls' as gate_code,
    not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency')
    or not (
      select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'operational_station_cash_idempotency'
    ),
    jsonb_build_object('table_present', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency')) as detail

  union all
  select 'client_wrappers_granted',
    not (
      has_function_privilege('authenticated', 'public.get_station_cash_context(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.open_station_cash_session(text, numeric, text, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.create_station_cash_movement(text, text, numeric, text, text, uuid, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.close_station_cash_session(text, numeric, text, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.record_station_cash_sale(text, uuid, numeric, text)', 'EXECUTE')
    ),
    jsonb_build_object(
      'get_station_cash_context', has_function_privilege('authenticated', 'public.get_station_cash_context(text)', 'EXECUTE'),
      'record_station_cash_sale', has_function_privilege('authenticated', 'public.record_station_cash_sale(text, uuid, numeric, text)', 'EXECUTE')
    )

  union all
  select 'internal_resolver_denied',
    has_function_privilege('authenticated', 'public.resolve_station_cash_operator_context(text, boolean)', 'EXECUTE'),
    jsonb_build_object(
      'resolve_denied', not has_function_privilege('authenticated', 'public.resolve_station_cash_operator_context(text, boolean)', 'EXECUTE')
    )

  union all
  select 'movement_impl_denied',
    has_function_privilege(
      'authenticated',
      'public.station_cash_create_movement_impl(text, text, numeric, text, text, uuid, text, boolean, boolean)',
      'EXECUTE'
    ),
    jsonb_build_object('impl_denied', true)

  union all
  select 'bind_and_replay_denied',
    has_function_privilege('authenticated', 'public.station_cash_bind_operator_session_by_token(text)', 'EXECUTE')
    or has_function_privilege(
      'authenticated',
      'public.station_cash_idempotency_replay_if_completed(text, text, text, text)',
      'EXECUTE'
    ),
    jsonb_build_object(
      'bind_denied', not has_function_privilege('authenticated', 'public.station_cash_bind_operator_session_by_token(text)', 'EXECUTE'),
      'replay_denied', not has_function_privilege('authenticated', 'public.station_cash_idempotency_replay_if_completed(text, text, text, text)', 'EXECUTE')
    )

  union all
  select 'idempotency_helpers_internal',
    has_function_privilege('authenticated', 'public.station_cash_idempotency_begin(uuid, uuid, uuid, text, text, text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.station_cash_idempotency_complete(uuid, text, jsonb)', 'EXECUTE'),
    jsonb_build_object(
      'begin_denied', not has_function_privilege('authenticated', 'public.station_cash_idempotency_begin(uuid, uuid, uuid, text, text, text)', 'EXECUTE')
    )

  union all
  select 'human_045_rpc_still_present',
    not (
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_cash_session')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_cash_movement')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'close_cash_session')
    ),
    jsonb_build_object('human_rpcs_intact', true)

  union all
  select 'flag_still_disabled',
    coalesce(public.operational_stations_enabled(), false),
    jsonb_build_object('enabled', coalesce(public.operational_stations_enabled(), false))

  union all
  select 'idempotency_row_count',
    false,
    jsonb_build_object(
      'operational_station_cash_idempotency', (select count(*) from public.operational_station_cash_idempotency)
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
