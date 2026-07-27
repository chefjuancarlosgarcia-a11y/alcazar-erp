-- Gate D preflight — read-only BEFORE applying 194_station_cash_operator_wrappers.sql
-- Requires 193 fully applied. Single SELECT; gate_code, is_blocker, detail. No secrets.

with gates as (
  select 'os2_193_foundation_present' as gate_code,
    not (
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device')
    ) as is_blocker,
    jsonb_build_object(
      'operational_operator_sessions', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions'),
      'verify_operational_pin_for_device', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'verify_operational_pin_for_device')
    ) as detail

  union all
  select 'os2_194_idempotency_table_absent',
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'),
    jsonb_build_object('present', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'))

  union all
  select 'os2_194_wrappers_absent',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'get_station_cash_context',
          'open_station_cash_session',
          'create_station_cash_movement',
          'close_station_cash_session',
          'record_station_cash_sale',
          'resolve_station_cash_operator_context'
        )
    ),
    jsonb_build_object(
      'get_station_cash_context', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_station_cash_context')
    )

  union all
  select 'os2_194_helpers_absent',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'station_cash_idempotency_begin',
          'station_cash_idempotency_complete',
          'station_cash_create_movement_impl',
          'station_cash_bind_operator_session_by_token'
        )
    ),
    jsonb_build_object('any_helper', exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'station_cash_idempotency_begin'
    ))

  union all
  select 'flag_still_disabled',
    coalesce(public.operational_stations_enabled(), false),
    jsonb_build_object('enabled', coalesce(public.operational_stations_enabled(), false))

  union all
  select 'human_open_cash_session_unchanged',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'open_cash_session'
    ),
    jsonb_build_object(
      'present', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_cash_session')
    )

  union all
  select 'human_create_cash_movement_unchanged',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'create_cash_movement'
    ),
    jsonb_build_object(
      'present', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_cash_movement')
    )

  union all
  select 'cash_station_register_link',
    not exists (
      select 1 from public.operational_stations s
      where s.station_type = 'cash' and s.status = 'active' and s.cash_register_id is not null
    ),
    jsonb_build_object(
      'active_cash_with_register', (
        select count(*) from public.operational_stations s
        where s.station_type = 'cash' and s.status = 'active' and s.cash_register_id is not null
      )
    )

  union all
  select 'no_open_station_cash_sessions_required',
    false,
    jsonb_build_object(
      'open_cash_sessions', (select count(*) from public.cash_sessions where status = 'open'),
      'note', 'informational; close human sessions on Caja Principal before smoke if policy requires'
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
