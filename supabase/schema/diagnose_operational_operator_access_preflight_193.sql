-- Gate A / preflight OS2 — read-only BEFORE applying 193_operational_operator_access_foundation.sql
-- Single result set: gate_code, is_blocker, detail (json text). No DDL/DML. No PII/secrets.

with
cash_station as (
  select s.id, s.name, s.cash_register_id, s.status
  from public.operational_stations s
  where s.station_type = 'cash' and s.status = 'active'
),
active_devices as (
  select d.*
  from public.operational_station_devices d
  join cash_station cs on cs.id = d.station_id
  where d.status = 'active'
),
inventory_193 as (
  select
    (
      select count(*)
      from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'operational_credentials',
          'operational_station_assignments',
          'operational_operator_sessions',
          'operational_pin_attempt_buckets',
          'operational_security_secrets'
        )
    )::int as tables_present,
    (
      select count(distinct p.proname)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'verify_operational_pin_for_device',
          'admin_set_operational_pin',
          'touch_operational_operator_session',
          'lock_operational_operator_session',
          'resolve_operational_device_for_auth_user',
          'operational_pin_pepper_value',
          'operational_pin_lookup'
        )
    )::int as functions_present
),
gates as (
  select 'os1_four_tables_present' as gate_code,
    not (
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_stations')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_devices')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_enrollment_tokens')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_events')
    ) as is_blocker,
    jsonb_build_object(
      'operational_stations', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_stations'),
      'operational_station_devices', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_devices'),
      'operational_station_enrollment_tokens', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_enrollment_tokens'),
      'operational_station_events', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_events')
    ) as detail

  union all
  select 'os1_cash_station_active_singleton',
    (select count(*) from cash_station) <> 1,
    jsonb_build_object('active_cash_stations', (select count(*) from cash_station))

  union all
  select 'os1_cash_station_has_register',
    not exists (select 1 from cash_station cs where cs.cash_register_id is not null),
    jsonb_build_object(
      'stations_missing_register', (select count(*) from cash_station where cash_register_id is null)
    )

  union all
  select 'os1_cash_register_active',
    exists (
      select 1 from cash_station cs
      left join public.cash_registers cr on cr.id = cs.cash_register_id
      where cs.cash_register_id is null or cr.id is null or cr.status <> 'active'
    ),
    jsonb_build_object(
      'invalid_register_links', (
        select count(*) from cash_station cs
        left join public.cash_registers cr on cr.id = cs.cash_register_id
        where cs.cash_register_id is null or cr.id is null or cr.status <> 'active'
      )
    )

  union all
  select 'os1_one_active_device_on_cash_station',
    (select count(*) from active_devices) <> 1,
    jsonb_build_object('active_devices_on_cash_station', (select count(*) from active_devices))

  union all
  select 'os1_active_device_has_auth_user',
    exists (select 1 from active_devices where auth_user_id is null),
    jsonb_build_object(
      'devices_without_auth_user', (select count(*) from active_devices where auth_user_id is null)
    )

  union all
  select 'flag_operational_stations_disabled',
    coalesce(public.operational_stations_enabled(), false),
    jsonb_build_object('enabled', coalesce(public.operational_stations_enabled(), false))

  union all
  select 'os1_core_functions_present',
    not (
      exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_operational_station_device_context')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_station_enrollment')
    ),
    jsonb_build_object(
      'get_operational_station_device_context', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_operational_station_device_context'),
      'claim_station_enrollment', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'claim_station_enrollment')
    )

  union all
  select 'functions_193_missing',
    false,
    (
      select jsonb_build_object(
        'functions_193_missing', i.functions_present = 0,
        'functions_present', i.functions_present,
        'functions_expected', 7
      )
      from inventory_193 i
    )

  union all
  select 'objects_193_partial',
    (
      select (i.tables_present > 0 and i.tables_present < 5)
        or (i.functions_present > 0 and i.functions_present < 7)
      from inventory_193 i
    ),
    (
      select jsonb_build_object(
        'objects_193_partial', (i.tables_present > 0 and i.tables_present < 5)
          or (i.functions_present > 0 and i.functions_present < 7),
        'tables_present', i.tables_present,
        'functions_present', i.functions_present
      )
      from inventory_193 i
    )

  union all
  select 'ready_to_apply_193',
    (
      select (i.tables_present > 0 and i.tables_present < 5)
        or (i.functions_present > 0 and i.functions_present < 7)
        or exists (select 1 from public.app_settings where key = 'operational_pin_pepper')
      from inventory_193 i
    ),
    (
      select jsonb_build_object(
        'ready_to_apply_193',
          i.tables_present = 0
          and i.functions_present = 0
          and not exists (select 1 from public.app_settings where key = 'operational_pin_pepper'),
        'functions_193_missing', i.functions_present = 0,
        'objects_193_partial', (i.tables_present > 0 and i.tables_present < 5)
          or (i.functions_present > 0 and i.functions_present < 7)
      )
      from inventory_193 i
    )

  union all
  select 'os2_secret_storage_table_absent',
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'operational_security_secrets'
    ),
    jsonb_build_object('operational_security_secrets', false)

  union all
  select 'app_settings_no_operational_pin_pepper',
    exists (select 1 from public.app_settings where key = 'operational_pin_pepper'),
    jsonb_build_object(
      'key_present', exists (select 1 from public.app_settings where key = 'operational_pin_pepper')
    )

  union all
  select 'app_settings_authenticated_select_policy',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'app_settings'
        and cmd = 'SELECT' and 'authenticated' = any(roles)
    ),
    jsonb_build_object(
      'authenticated_read_policy', exists (
        select 1 from pg_policies
        where schemaname = 'public' and tablename = 'app_settings'
          and policyname = 'app_settings_read_authenticated'
      ),
      'note', 'any authenticated active profile can SELECT all app_settings rows'
    )

  union all
  select 'operational_stations_enabled_via_rpc_only',
    false,
    jsonb_build_object(
      'frontend_direct_table_read', false,
      'frontend_uses_rpc', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'operational_stations_enabled'
      )
    )

  union all
  select 'os2_193_tables_absent',
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public'
        and table_name in (
          'operational_credentials',
          'operational_station_assignments',
          'operational_operator_sessions',
          'operational_pin_attempt_buckets'
        )
    ),
    jsonb_build_object(
      'any_os2_table_present', exists (
        select 1 from information_schema.tables
        where table_schema = 'public'
          and table_name in (
            'operational_credentials',
            'operational_station_assignments',
            'operational_operator_sessions',
            'operational_pin_attempt_buckets'
          )
      )
    )

  union all
  select 'os2_193_functions_absent',
    exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'verify_operational_pin_for_device',
          'admin_set_operational_pin',
          'touch_operational_operator_session',
          'lock_operational_operator_session'
        )
    ),
    jsonb_build_object(
      'any_os2_function_present', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in (
            'verify_operational_pin_for_device',
            'admin_set_operational_pin',
            'touch_operational_operator_session'
          )
      )
    )

  union all
  select 'os2_194_objects_absent',
    exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'
    )
    or exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('get_station_cash_context', 'open_station_cash_session', 'record_station_cash_sale')
    ),
    jsonb_build_object(
      'idempotency_table', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'),
      'wrapper_rpc', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_station_cash_context')
    )

  union all
  select 'no_prior_operator_sessions',
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions'),
    jsonb_build_object('note', 'table must not exist pre-193')

  union all
  select 'no_prior_operational_credentials',
    exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_credentials'),
    jsonb_build_object('note', 'table must not exist pre-193')

  union all
  select 'extension_pgcrypto',
    not exists (select 1 from pg_extension where extname = 'pgcrypto'),
    jsonb_build_object('installed', exists (select 1 from pg_extension where extname = 'pgcrypto'))

  union all
  select 'crypto_digest_or_crypt_available',
    not exists (select 1 from pg_extension where extname = 'pgcrypto')
    and not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where p.proname in ('digest', 'crypt', 'gen_random_bytes')
        and n.nspname in ('extensions', 'public')
    ),
    jsonb_build_object(
      'pgcrypto_ext', exists (select 1 from pg_extension where extname = 'pgcrypto'),
      'digest_fn', exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = 'digest' and n.nspname in ('extensions', 'public')
      )
    )

  union all
  select 'os1_192_device_context_authenticated',
    to_regprocedure('public.get_operational_station_device_context()') is null
    or not coalesce(
      has_function_privilege(
        'authenticated',
        to_regprocedure('public.get_operational_station_device_context()'),
        'EXECUTE'
      ),
      false
    ),
    jsonb_build_object(
      'device_context_execute', case
        when to_regprocedure('public.get_operational_station_device_context()') is null then null
        else has_function_privilege(
          'authenticated',
          to_regprocedure('public.get_operational_station_device_context()'),
          'EXECUTE'
        )
      end
    )

  union all
  select 'os2_193_resolve_device_must_be_absent',
    to_regprocedure('public.resolve_operational_device_for_auth_user()') is not null,
    jsonb_build_object(
      'resolve_exists_pre_193', to_regprocedure('public.resolve_operational_device_for_auth_user()') is not null,
      'functions_193_missing', to_regprocedure('public.resolve_operational_device_for_auth_user()') is null
    )

  union all
  select 'human_cash_rpc_045_present',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('open_cash_session', 'create_cash_movement', 'close_cash_session', 'record_cash_sale')
    ),
    jsonb_build_object(
      'open_cash_session', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'open_cash_session'),
      'create_cash_movement', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'create_cash_movement')
    )

  union all
  select 'cash_schema_columns_for_194',
    not (
      exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cash_sessions' and column_name = 'opened_by')
      and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cash_movements' and column_name = 'metadata')
      and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'calculate_cash_expected')
    ),
    jsonb_build_object('calculate_cash_expected', exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'calculate_cash_expected'
    ))

  union all
  select 'baseline_counts_non_sensitive',
    false,
    jsonb_build_object(
      'profiles_active', (select count(*) from public.profiles where status = 'active'),
      'cash_registers', (select count(*) from public.cash_registers),
      'cash_sessions', (select count(*) from public.cash_sessions),
      'cash_movements', (select count(*) from public.cash_movements),
      'operational_stations', (select count(*) from public.operational_stations),
      'operational_station_devices', (select count(*) from public.operational_station_devices)
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
