-- Postflight read-only AFTER applying 193 (before 194). No DDL/DML. No secrets/PII rows.

with gates as (
  select 'os2_four_tables_exist' as gate_code,
    not (
      exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_credentials')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_assignments')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
      and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_pin_attempt_buckets')
    ) as is_blocker,
    jsonb_build_object(
      'operational_credentials', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_credentials'),
      'operational_operator_sessions', exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
    ) as detail

  union all
  select 'os2_rls_enabled',
    exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in (
          'operational_credentials',
          'operational_station_assignments',
          'operational_operator_sessions',
          'operational_pin_attempt_buckets'
        )
        and not c.relrowsecurity
    ),
    jsonb_build_object(
      'all_rls', (
        select bool_and(c.relrowsecurity)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname in (
            'operational_credentials',
            'operational_station_assignments',
            'operational_operator_sessions',
            'operational_pin_attempt_buckets'
          )
      )
    )

  union all
  select 'pin_no_plaintext_column',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_credentials'
        and column_name in ('pin', 'pin_plain', 'plain_pin')
    ),
    jsonb_build_object(
      'has_pin_hash', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'operational_credentials' and column_name = 'pin_hash'
      ),
      'has_pin_lookup', exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'operational_credentials' and column_name = 'pin_lookup'
      )
    )

  union all
  select 'operator_session_token_hash_only',
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_operator_sessions'
        and column_name = 'session_token_hash'
    )
    or exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'operational_operator_sessions'
        and column_name in ('session_token', 'operator_token')
    ),
    jsonb_build_object('session_token_hash_only', true)

  union all
  select 'core_rpc_grants_authenticated',
    not (
      has_function_privilege('authenticated', 'public.verify_operational_pin_for_device(text, text, text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.touch_operational_operator_session(text)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.lock_operational_operator_session(text, text, text)', 'EXECUTE')
    ),
    jsonb_build_object(
      'verify_pin', has_function_privilege('authenticated', 'public.verify_operational_pin_for_device(text, text, text)', 'EXECUTE'),
      'touch', has_function_privilege('authenticated', 'public.touch_operational_operator_session(text)', 'EXECUTE')
    )

  union all
  select 'secret_storage_table_exists',
    not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'operational_security_secrets'
    ),
    jsonb_build_object('present', true)

  union all
  select 'secret_storage_rls_enabled',
    not coalesce((
      select c.relrowsecurity from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'operational_security_secrets'
    ), false),
    jsonb_build_object('rls', true)

  union all
  select 'secret_storage_clients_denied',
    has_table_privilege('authenticated', 'public.operational_security_secrets', 'SELECT')
    or has_table_privilege('anon', 'public.operational_security_secrets', 'SELECT'),
    jsonb_build_object(
      'authenticated_select', has_table_privilege('authenticated', 'public.operational_security_secrets', 'SELECT'),
      'anon_select', has_table_privilege('anon', 'public.operational_security_secrets', 'SELECT')
    )

  union all
  select 'pepper_row_exists_not_exposed',
    not exists (
      select 1 from public.operational_security_secrets
      where secret_name = 'operational_pin_lookup_pepper'
    ),
    jsonb_build_object('row_present', true)

  union all
  select 'app_settings_no_operational_pin_pepper',
    exists (select 1 from public.app_settings where key = 'operational_pin_pepper'),
    jsonb_build_object('key_absent', true)

  union all
  select 'internal_helpers_not_client',
    has_function_privilege('authenticated', 'public.operational_pin_pepper_value()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.operational_pin_lookup(text)', 'EXECUTE'),
    jsonb_build_object(
      'pepper_value_denied', not has_function_privilege('authenticated', 'public.operational_pin_pepper_value()', 'EXECUTE'),
      'pin_lookup_denied', not has_function_privilege('authenticated', 'public.operational_pin_lookup(text)', 'EXECUTE')
    )

  union all
  select 'device_context_includes_cash_register_id',
    not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'get_operational_station_device_context'
    ),
    jsonb_build_object('function_present', true)

  union all
  select 'flag_still_disabled',
    coalesce(public.operational_stations_enabled(), false),
    jsonb_build_object('enabled', coalesce(public.operational_stations_enabled(), false))

  union all
  select 'attendance_credentials_untouched',
    not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'attendance_credentials'
    ),
    jsonb_build_object(
      'attendance_credentials_exists', exists (
        select 1 from information_schema.tables where table_schema = 'public' and table_name = 'attendance_credentials'
      ),
      'note', '193 must not drop attendance table'
    )

  union all
  select 'os2_row_counts',
    false,
    jsonb_build_object(
      'operational_credentials', (select count(*) from public.operational_credentials),
      'operational_station_assignments', (select count(*) from public.operational_station_assignments),
      'operational_operator_sessions', (select count(*) from public.operational_operator_sessions),
      'operational_pin_attempt_buckets', (select count(*) from public.operational_pin_attempt_buckets)
    )

  union all
  select 'ready_for_194',
    not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_operator_sessions')
    or exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'),
    jsonb_build_object(
      '194_idempotency_absent', not exists (
        select 1 from information_schema.tables where table_schema = 'public' and table_name = 'operational_station_cash_idempotency'
      )
    )
)
select gate_code, is_blocker, detail::text as detail
from gates
order by is_blocker desc, gate_code;
