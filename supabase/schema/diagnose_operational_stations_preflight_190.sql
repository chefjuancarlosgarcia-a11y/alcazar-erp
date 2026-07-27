-- OS1 Gate A — read-only preflight before applying 190.
-- Run in Supabase SQL Editor. No DDL/DML. No PII rows.

select 'preflight_os1' as snapshot,
  jsonb_build_object(
    'os1_tables_missing', jsonb_build_object(
      'operational_stations', not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'operational_stations'
      ),
      'operational_station_devices', not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'operational_station_devices'
      ),
      'operational_station_enrollment_tokens', not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'operational_station_enrollment_tokens'
      ),
      'operational_station_events', not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'operational_station_events'
      )
    ),
    'os1_functions_missing', jsonb_build_object(
      'operational_stations_enabled', not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'operational_stations_enabled'
      ),
      'claim_station_enrollment', not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'claim_station_enrollment'
      ),
      'finalize_station_device_enrollment', not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'finalize_station_device_enrollment'
      )
    ),
    'os1_index_missing', not exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'operational_station_devices_one_active_per_station_idx'
    ),
    'os1_any_partial_object', (
      exists (
        select 1 from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'operational_stations',
            'operational_station_devices',
            'operational_station_enrollment_tokens',
            'operational_station_events'
          )
      )
      or exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'operational_stations_enabled',
            'claim_station_enrollment',
            'finalize_station_device_enrollment'
          )
      )
      or exists (
        select 1 from pg_indexes
        where schemaname = 'public'
          and indexname = 'operational_station_devices_one_active_per_station_idx'
      )
    ),
    'flag_row', (
      select jsonb_build_object(
        'exists', exists (select 1 from public.app_settings where key = 'operational_stations_enabled'),
        'enabled', coalesce(
          (select nullif(value ->> 'enabled', '')::boolean
           from public.app_settings where key = 'operational_stations_enabled'),
          false
        )
      )
    ),
    'baseline_counts', jsonb_build_object(
      'profiles_active', (select count(*) from public.profiles where status = 'active'),
      'areas', (select count(*) from public.areas),
      'cash_registers', (select count(*) from public.cash_registers),
      'pos_orders', (select count(*) from public.pos_orders)
    ),
    'ready_to_apply_190',
      not exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'operational_stations'
      )
      and not exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'claim_station_enrollment'
      )
      and coalesce(
        (select nullif(value ->> 'enabled', '')::boolean
         from public.app_settings where key = 'operational_stations_enabled'),
        false
      ) = false
  ) as detail;
