-- OS1 postflight — read-only after applying 190 (and before smoke).
-- Run in Supabase SQL Editor. No DDL/DML.

select 'postflight_os1' as snapshot,
  jsonb_build_object(
    'four_tables_exist', (
      select count(*) = 4 from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'operational_stations',
          'operational_station_devices',
          'operational_station_enrollment_tokens',
          'operational_station_events'
        )
    ),
    'rls_all_true', (
      select bool_and(c.relrowsecurity)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'operational_stations',
          'operational_station_devices',
          'operational_station_enrollment_tokens',
          'operational_station_events'
        )
    ),
    'flag_enabled', public.operational_stations_enabled(),
    'initial_os1_counts', jsonb_build_object(
      'stations', (select count(*) from public.operational_stations),
      'devices', (select count(*) from public.operational_station_devices),
      'enrollments', (select count(*) from public.operational_station_enrollment_tokens),
      'events', (select count(*) from public.operational_station_events)
    ),
    'one_active_index', exists (
      select 1 from pg_indexes
      where schemaname = 'public'
        and indexname = 'operational_station_devices_one_active_per_station_idx'
    ),
    'core_functions_present', jsonb_build_object(
      'operational_stations_enabled', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'operational_stations_enabled'
      ),
      'claim_station_enrollment', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'claim_station_enrollment'
      ),
      'finalize_station_device_enrollment', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'finalize_station_device_enrollment'
      ),
      'is_operational_stations_admin', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'is_operational_stations_admin'
      )
    ),
    'claim_rpc_anon_denied', not has_function_privilege(
      'anon',
      'public.claim_station_enrollment(text,text,text,text,text)',
      'EXECUTE'
    ),
    'finalize_authenticated_denied', not has_function_privilege(
      'authenticated',
      'public.finalize_station_device_enrollment(uuid,uuid,uuid,text,text)',
      'EXECUTE'
    ),
    'provision_authenticated_allowed', has_function_privilege(
      'authenticated',
      'public.provision_operational_station(text,text,text,text,uuid,text)',
      'EXECUTE'
    ),
    'legacy_counts_unchanged_hint', jsonb_build_object(
      'pos_orders', (select count(*) from public.pos_orders),
      'cash_registers', (select count(*) from public.cash_registers),
      'profiles_active', (select count(*) from public.profiles where status = 'active')
    ),
    'no_take_secret_rpc', not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'take_enrollment_sign_in_secret'
    )
  ) as detail;
