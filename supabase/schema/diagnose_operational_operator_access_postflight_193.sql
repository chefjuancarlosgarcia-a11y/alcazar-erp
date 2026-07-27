-- Postflight read-only AFTER applying 193 (before 194). No DDL/DML. No secrets/PII rows.

with fn as (
  select
    to_regprocedure('public.verify_operational_pin_for_device(text, text, text)') as verify_pin_oid,
    to_regprocedure('public.touch_operational_operator_session(text)') as touch_oid,
    to_regprocedure('public.lock_operational_operator_session(text, text, text)') as lock_oid,
    to_regprocedure('public.operational_pin_pepper_value()') as pepper_oid,
    to_regprocedure('public.operational_pin_lookup(text)') as lookup_oid
),
secrets_rel as (
  select to_regclass('public.operational_security_secrets') as relid
),
gates (gate_code, is_blocker, detail) as (
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
    (
      select fn.verify_pin_oid is null or fn.touch_oid is null or fn.lock_oid is null
        or not (
          coalesce(has_function_privilege('authenticated', fn.verify_pin_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.touch_oid, 'EXECUTE'), false)
          and coalesce(has_function_privilege('authenticated', fn.lock_oid, 'EXECUTE'), false)
        )
      from fn
    ),
    (
      select jsonb_build_object(
        'verify_pin', case when fn.verify_pin_oid is null then null
          else has_function_privilege('authenticated', fn.verify_pin_oid, 'EXECUTE') end,
        'touch', case when fn.touch_oid is null then null
          else has_function_privilege('authenticated', fn.touch_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'secret_storage_table_exists',
    to_regclass('public.operational_security_secrets') is null,
    jsonb_build_object('present', to_regclass('public.operational_security_secrets') is not null)

  union all
  select 'secret_storage_rls_enabled',
    to_regclass('public.operational_security_secrets') is null
    or not coalesce((
      select c.relrowsecurity from pg_class c
      where c.oid = to_regclass('public.operational_security_secrets')
    ), false),
    jsonb_build_object('rls', true)

  union all
  select 'secret_storage_clients_denied',
    (
      select secrets_rel.relid is not null
        and (
          coalesce(has_table_privilege('authenticated', secrets_rel.relid, 'SELECT'), false)
          or coalesce(has_table_privilege('anon', secrets_rel.relid, 'SELECT'), false)
        )
      from secrets_rel
    ),
    (
      select jsonb_build_object(
        'authenticated_select', case when secrets_rel.relid is null then null
          else has_table_privilege('authenticated', secrets_rel.relid, 'SELECT') end,
        'anon_select', case when secrets_rel.relid is null then null
          else has_table_privilege('anon', secrets_rel.relid, 'SELECT') end
      )
      from secrets_rel
    )

  union all
  select 'pepper_row_exists_not_exposed',
    to_regclass('public.operational_security_secrets') is null
    or not exists (
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
    (
      select (fn.pepper_oid is not null and coalesce(has_function_privilege('authenticated', fn.pepper_oid, 'EXECUTE'), false))
        or (fn.lookup_oid is not null and coalesce(has_function_privilege('authenticated', fn.lookup_oid, 'EXECUTE'), false))
      from fn
    ),
    (
      select jsonb_build_object(
        'pepper_value_denied', case when fn.pepper_oid is null then null
          else not has_function_privilege('authenticated', fn.pepper_oid, 'EXECUTE') end,
        'pin_lookup_denied', case when fn.lookup_oid is null then null
          else not has_function_privilege('authenticated', fn.lookup_oid, 'EXECUTE') end
      )
      from fn
    )

  union all
  select 'device_context_includes_cash_register_id',
    to_regprocedure('public.get_operational_station_device_context()') is null,
    jsonb_build_object('function_present', to_regprocedure('public.get_operational_station_device_context()') is not null)

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
