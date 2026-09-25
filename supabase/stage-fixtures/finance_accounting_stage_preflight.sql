-- Finance accounting Stage preflight (pure read-only queries).
-- Run inside: SET default_transaction_read_only=on; BEGIN READ ONLY; ... ROLLBACK;
--
-- BEFORE running, set session project ref (session-only, not persistent):
--   SELECT set_config('alcazar.finance_stage_project_ref', '<project-ref-from-vault>', true);
--
-- Requires app_settings.deployment_environment:
--   name = 'stage'
--   project_ref = same value as alcazar.finance_stage_project_ref
--
-- Fail-closed: psql exits non-zero when result is NOT_READY.
-- No DDL/DML/temp objects in this file.

\set ON_ERROR_STOP on

WITH env AS (
  SELECT
    lower(coalesce(
      (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )) AS deployment_name,
    nullif(trim(coalesce(
      (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )), '') AS deployment_project_ref,
    nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '')
      AS session_project_ref
),
gates AS (
  SELECT * FROM (
    SELECT
      'environment_is_stage'::text AS gate_code,
      (SELECT deployment_name FROM env) = 'stage' AS gate_passed,
      CASE
        WHEN (SELECT deployment_name FROM env) IN ('production', 'prod') THEN 'BLOCKED: production detected'
        WHEN (SELECT deployment_name FROM env) = 'stage' THEN 'ok'
        ELSE 'deployment_environment.name must be stage'
      END AS detail

    UNION ALL SELECT 'not_production',
      (SELECT deployment_name FROM env) NOT IN ('production', 'prod'),
      coalesce((SELECT deployment_name FROM env), 'unknown')

    UNION ALL SELECT 'session_project_ref_provided',
      (SELECT session_project_ref FROM env) IS NOT NULL,
      CASE
        WHEN (SELECT session_project_ref FROM env) IS NULL
          THEN 'Set alcazar.finance_stage_project_ref before preflight'
        ELSE 'session project ref present'
      END

    UNION ALL SELECT 'deployment_project_ref_present',
      (SELECT deployment_project_ref FROM env) IS NOT NULL,
      CASE
        WHEN (SELECT deployment_project_ref FROM env) IS NULL
          THEN 'deployment_environment.project_ref missing in app_settings'
        ELSE 'stored project ref present'
      END

    UNION ALL SELECT 'project_ref_matches',
      (SELECT session_project_ref FROM env) IS NOT NULL
        AND (SELECT deployment_project_ref FROM env) IS NOT NULL
        AND (SELECT session_project_ref FROM env) = (SELECT deployment_project_ref FROM env),
      CASE
        WHEN (SELECT session_project_ref FROM env) IS NULL
          OR (SELECT deployment_project_ref FROM env) IS NULL THEN 'missing ref(s)'
        WHEN (SELECT session_project_ref FROM env) <> (SELECT deployment_project_ref FROM env)
          THEN 'session ref does not match deployment_environment.project_ref'
        ELSE 'project ref match ok'
      END

    UNION ALL SELECT 'postgres_version',
      current_setting('server_version_num')::int >= 150000,
      current_setting('server_version')

    UNION ALL SELECT 'timezone_configured',
      current_setting('TimeZone') IS NOT NULL AND current_setting('TimeZone') <> '',
      current_setting('TimeZone')

    UNION ALL SELECT 'extension_pgcrypto',
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'),
      'pgcrypto'

    UNION ALL SELECT 'table_profiles',
      to_regclass('public.profiles') IS NOT NULL, 'profiles'

    UNION ALL SELECT 'table_user_roles',
      to_regclass('public.user_roles') IS NOT NULL, 'user_roles'

    UNION ALL SELECT 'table_areas',
      to_regclass('public.areas') IS NOT NULL, 'areas'

    UNION ALL SELECT 'table_finance_bank_accounts',
      to_regclass('public.finance_bank_accounts') IS NOT NULL, 'finance_bank_accounts'

    UNION ALL SELECT 'table_finance_payables',
      to_regclass('public.finance_payables') IS NOT NULL, 'finance_payables'

    UNION ALL SELECT 'table_finance_receivables',
      to_regclass('public.finance_receivables') IS NOT NULL, 'finance_receivables'

    UNION ALL SELECT 'legacy_can_view_finance',
      to_regprocedure('public.can_view_finance()') IS NOT NULL, 'can_view_finance()'

    UNION ALL SELECT 'legacy_can_manage_finance',
      to_regprocedure('public.can_manage_finance()') IS NOT NULL, 'can_manage_finance()'

    UNION ALL SELECT 'migration_200_present',
      to_regprocedure('public.audit_pos_order_change()') IS NOT NULL
        OR to_regclass('public.operational_stations') IS NOT NULL,
      'operational baseline through 200'

    UNION ALL SELECT 'finance_202_absent',
      to_regclass('public.finance_chart_accounts') IS NULL,
      coalesce(to_regclass('public.finance_chart_accounts')::text, 'absent')

    UNION ALL SELECT 'finance_203_absent',
      to_regclass('public.branches') IS NULL
        AND to_regclass('public.finance_cost_centers') IS NULL
        AND to_regclass('public.finance_accounting_periods') IS NULL,
      'branches/cc/periods absent'

    UNION ALL SELECT 'finance_204_absent',
      to_regclass('public.finance_journal_entries') IS NULL
        AND to_regclass('public.finance_journal_lines') IS NULL
        AND to_regclass('public.finance_journal_entry_counters') IS NULL,
      'journal absent'

    UNION ALL SELECT 'no_partial_journal',
      (
        (to_regclass('public.finance_journal_entries') IS NOT NULL)::int +
        (to_regclass('public.finance_journal_lines') IS NOT NULL)::int +
        (to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL)::int
      ) IN (0, 3),
      'all journal objects absent or complete (pre-apply expect 0)'

    UNION ALL SELECT 'role_contador_catalog',
      true,
      coalesce((SELECT role_name FROM public.user_roles WHERE role_key = 'contador'), 'optional_pre_202_added_by_migration_202')

    UNION ALL SELECT 'baseline_finance_bank_count',
      true, (SELECT count(*)::text FROM public.finance_bank_accounts)

    UNION ALL SELECT 'baseline_finance_payables_count',
      true, (SELECT count(*)::text FROM public.finance_payables)

    UNION ALL SELECT 'baseline_finance_receivables_count',
      true, (SELECT count(*)::text FROM public.finance_receivables)
  ) g
)
SELECT gate_code, gate_passed, detail
FROM gates
ORDER BY gate_code;

WITH env AS (
  SELECT
    lower(coalesce(
      (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )) AS deployment_name,
    nullif(trim(coalesce(
      (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )), '') AS deployment_project_ref,
    nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '')
      AS session_project_ref
),
gates AS (
  SELECT * FROM (
    SELECT
      'environment_is_stage'::text AS gate_code,
      (SELECT deployment_name FROM env) = 'stage' AS gate_passed,
      CASE
        WHEN (SELECT deployment_name FROM env) IN ('production', 'prod') THEN 'BLOCKED: production detected'
        WHEN (SELECT deployment_name FROM env) = 'stage' THEN 'ok'
        ELSE 'deployment_environment.name must be stage'
      END AS detail

    UNION ALL SELECT 'not_production',
      (SELECT deployment_name FROM env) NOT IN ('production', 'prod'),
      coalesce((SELECT deployment_name FROM env), 'unknown')

    UNION ALL SELECT 'session_project_ref_provided',
      (SELECT session_project_ref FROM env) IS NOT NULL,
      CASE
        WHEN (SELECT session_project_ref FROM env) IS NULL
          THEN 'Set alcazar.finance_stage_project_ref before preflight'
        ELSE 'session project ref present'
      END

    UNION ALL SELECT 'deployment_project_ref_present',
      (SELECT deployment_project_ref FROM env) IS NOT NULL,
      CASE
        WHEN (SELECT deployment_project_ref FROM env) IS NULL
          THEN 'deployment_environment.project_ref missing in app_settings'
        ELSE 'stored project ref present'
      END

    UNION ALL SELECT 'project_ref_matches',
      (SELECT session_project_ref FROM env) IS NOT NULL
        AND (SELECT deployment_project_ref FROM env) IS NOT NULL
        AND (SELECT session_project_ref FROM env) = (SELECT deployment_project_ref FROM env),
      CASE
        WHEN (SELECT session_project_ref FROM env) IS NULL
          OR (SELECT deployment_project_ref FROM env) IS NULL THEN 'missing ref(s)'
        WHEN (SELECT session_project_ref FROM env) <> (SELECT deployment_project_ref FROM env)
          THEN 'session ref does not match deployment_environment.project_ref'
        ELSE 'project ref match ok'
      END

    UNION ALL SELECT 'postgres_version',
      current_setting('server_version_num')::int >= 150000,
      current_setting('server_version')

    UNION ALL SELECT 'timezone_configured',
      current_setting('TimeZone') IS NOT NULL AND current_setting('TimeZone') <> '',
      current_setting('TimeZone')

    UNION ALL SELECT 'extension_pgcrypto',
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'),
      'pgcrypto'

    UNION ALL SELECT 'table_profiles',
      to_regclass('public.profiles') IS NOT NULL, 'profiles'

    UNION ALL SELECT 'table_user_roles',
      to_regclass('public.user_roles') IS NOT NULL, 'user_roles'

    UNION ALL SELECT 'table_areas',
      to_regclass('public.areas') IS NOT NULL, 'areas'

    UNION ALL SELECT 'table_finance_bank_accounts',
      to_regclass('public.finance_bank_accounts') IS NOT NULL, 'finance_bank_accounts'

    UNION ALL SELECT 'table_finance_payables',
      to_regclass('public.finance_payables') IS NOT NULL, 'finance_payables'

    UNION ALL SELECT 'table_finance_receivables',
      to_regclass('public.finance_receivables') IS NOT NULL, 'finance_receivables'

    UNION ALL SELECT 'legacy_can_view_finance',
      to_regprocedure('public.can_view_finance()') IS NOT NULL, 'can_view_finance()'

    UNION ALL SELECT 'legacy_can_manage_finance',
      to_regprocedure('public.can_manage_finance()') IS NOT NULL, 'can_manage_finance()'

    UNION ALL SELECT 'migration_200_present',
      to_regprocedure('public.audit_pos_order_change()') IS NOT NULL
        OR to_regclass('public.operational_stations') IS NOT NULL,
      'operational baseline through 200'

    UNION ALL SELECT 'finance_202_absent',
      to_regclass('public.finance_chart_accounts') IS NULL,
      coalesce(to_regclass('public.finance_chart_accounts')::text, 'absent')

    UNION ALL SELECT 'finance_203_absent',
      to_regclass('public.branches') IS NULL
        AND to_regclass('public.finance_cost_centers') IS NULL
        AND to_regclass('public.finance_accounting_periods') IS NULL,
      'branches/cc/periods absent'

    UNION ALL SELECT 'finance_204_absent',
      to_regclass('public.finance_journal_entries') IS NULL
        AND to_regclass('public.finance_journal_lines') IS NULL
        AND to_regclass('public.finance_journal_entry_counters') IS NULL,
      'journal absent'

    UNION ALL SELECT 'no_partial_journal',
      (
        (to_regclass('public.finance_journal_entries') IS NOT NULL)::int +
        (to_regclass('public.finance_journal_lines') IS NOT NULL)::int +
        (to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL)::int
      ) IN (0, 3),
      'all journal objects absent or complete (pre-apply expect 0)'

    UNION ALL SELECT 'role_contador_catalog',
      true,
      coalesce((SELECT role_name FROM public.user_roles WHERE role_key = 'contador'), 'optional_pre_202_added_by_migration_202')

    UNION ALL SELECT 'baseline_finance_bank_count',
      true, (SELECT count(*)::text FROM public.finance_bank_accounts)

    UNION ALL SELECT 'baseline_finance_payables_count',
      true, (SELECT count(*)::text FROM public.finance_payables)

    UNION ALL SELECT 'baseline_finance_receivables_count',
      true, (SELECT count(*)::text FROM public.finance_receivables)
  ) g
),
blocking AS (
  SELECT gate_code, gate_passed, detail
  FROM gates
  WHERE gate_code NOT IN (
    'baseline_finance_bank_count',
    'baseline_finance_payables_count',
    'baseline_finance_receivables_count',
    'role_contador_catalog'
  )
    AND NOT gate_passed
)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM blocking) THEN 'NOT_READY' ELSE 'READY' END
    AS finance_accounting_preflight_result,
  (SELECT count(*)::text FROM blocking) AS blocking_gates,
  coalesce((SELECT string_agg(gate_code, ', ' ORDER BY gate_code) FROM blocking), '')
    AS blocking_detail;

WITH env AS (
  SELECT
    lower(coalesce(
      (SELECT value ->> 'name' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )) AS deployment_name,
    nullif(trim(coalesce(
      (SELECT value ->> 'project_ref' FROM public.app_settings WHERE key = 'deployment_environment'),
      ''
    )), '') AS deployment_project_ref,
    nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '')
      AS session_project_ref
),
gates AS (
  SELECT * FROM (
    SELECT 'environment_is_stage'::text AS gate_code,
      (SELECT deployment_name FROM env) = 'stage' AS gate_passed
    UNION ALL SELECT 'not_production',
      (SELECT deployment_name FROM env) NOT IN ('production', 'prod')
    UNION ALL SELECT 'session_project_ref_provided',
      (SELECT session_project_ref FROM env) IS NOT NULL
    UNION ALL SELECT 'deployment_project_ref_present',
      (SELECT deployment_project_ref FROM env) IS NOT NULL
    UNION ALL SELECT 'project_ref_matches',
      (SELECT session_project_ref FROM env) IS NOT NULL
        AND (SELECT deployment_project_ref FROM env) IS NOT NULL
        AND (SELECT session_project_ref FROM env) = (SELECT deployment_project_ref FROM env)
    UNION ALL SELECT 'postgres_version',
      current_setting('server_version_num')::int >= 150000
    UNION ALL SELECT 'timezone_configured',
      current_setting('TimeZone') IS NOT NULL AND current_setting('TimeZone') <> ''
    UNION ALL SELECT 'extension_pgcrypto',
      EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto')
    UNION ALL SELECT 'table_profiles', to_regclass('public.profiles') IS NOT NULL
    UNION ALL SELECT 'table_user_roles', to_regclass('public.user_roles') IS NOT NULL
    UNION ALL SELECT 'table_areas', to_regclass('public.areas') IS NOT NULL
    UNION ALL SELECT 'table_finance_bank_accounts', to_regclass('public.finance_bank_accounts') IS NOT NULL
    UNION ALL SELECT 'table_finance_payables', to_regclass('public.finance_payables') IS NOT NULL
    UNION ALL SELECT 'table_finance_receivables', to_regclass('public.finance_receivables') IS NOT NULL
    UNION ALL SELECT 'legacy_can_view_finance', to_regprocedure('public.can_view_finance()') IS NOT NULL
    UNION ALL SELECT 'legacy_can_manage_finance', to_regprocedure('public.can_manage_finance()') IS NOT NULL
    UNION ALL SELECT 'migration_200_present',
      to_regprocedure('public.audit_pos_order_change()') IS NOT NULL
        OR to_regclass('public.operational_stations') IS NOT NULL
    UNION ALL SELECT 'finance_202_absent', to_regclass('public.finance_chart_accounts') IS NULL
    UNION ALL SELECT 'finance_203_absent',
      to_regclass('public.branches') IS NULL
        AND to_regclass('public.finance_cost_centers') IS NULL
        AND to_regclass('public.finance_accounting_periods') IS NULL
    UNION ALL SELECT 'finance_204_absent',
      to_regclass('public.finance_journal_entries') IS NULL
        AND to_regclass('public.finance_journal_lines') IS NULL
        AND to_regclass('public.finance_journal_entry_counters') IS NULL
    UNION ALL SELECT 'no_partial_journal',
      (
        (to_regclass('public.finance_journal_entries') IS NOT NULL)::int +
        (to_regclass('public.finance_journal_lines') IS NOT NULL)::int +
        (to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL)::int
      ) IN (0, 3)
  ) g
),
blocking AS (
  SELECT gate_code
  FROM gates
  WHERE gate_code NOT IN (
    'baseline_finance_bank_count',
    'baseline_finance_payables_count',
    'baseline_finance_receivables_count',
    'role_contador_catalog'
  )
    AND NOT gate_passed
)
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM blocking) THEN 0 ELSE 1 END) AS fail_closed_ready_guard;
