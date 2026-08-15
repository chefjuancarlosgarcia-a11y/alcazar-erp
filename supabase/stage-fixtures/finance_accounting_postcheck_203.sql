-- Post-apply validation after 203_finance_accounting_multibranch_foundation.sql (pure read-only).
-- Expected: finance_accounting_postcheck_203 = PASS; psql exits non-zero on FAIL.
\set ON_ERROR_STOP on

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_branches'::text AS gate_code,
      to_regclass('public.branches') IS NOT NULL AS gate_passed,
      'branches'::text AS detail
    UNION ALL SELECT 'table_finance_cost_centers', to_regclass('public.finance_cost_centers') IS NOT NULL, 'finance_cost_centers'
    UNION ALL SELECT 'table_finance_accounting_periods', to_regclass('public.finance_accounting_periods') IS NOT NULL, 'finance_accounting_periods'
    UNION ALL SELECT 'seed_principal_branch',
      EXISTS (SELECT 1 FROM public.branches WHERE code = 'PRINCIPAL' AND is_main AND is_active),
      coalesce((SELECT name FROM public.branches WHERE code = 'PRINCIPAL'), 'missing')
    UNION ALL SELECT 'single_active_main_branch',
      (SELECT count(*) FROM public.branches WHERE is_main AND is_active) = 1,
      (SELECT count(*)::text FROM public.branches WHERE is_main AND is_active)
    UNION ALL SELECT 'dimension_columns_on_chart',
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'finance_chart_accounts'
          AND column_name = 'branch_dimension_rule'
      ), 'branch_dimension_rule'
    UNION ALL SELECT 'rpc_create_branch', to_regprocedure('public.create_branch(jsonb)') IS NOT NULL, 'create_branch'
    UNION ALL SELECT 'rpc_create_finance_cost_center', to_regprocedure('public.create_finance_cost_center(jsonb)') IS NOT NULL, 'create_finance_cost_center'
    UNION ALL SELECT 'rpc_create_finance_accounting_period', to_regprocedure('public.create_finance_accounting_period(integer, integer)') IS NOT NULL, 'create_finance_accounting_period'
    UNION ALL SELECT 'branches_no_delete_policy',
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND cmd = 'DELETE'),
      'no DELETE policy on branches'
    UNION ALL SELECT 'finance_204_still_absent',
      to_regclass('public.finance_journal_entries') IS NULL, 'journal not yet applied'
  ) g
)
SELECT gate_code, gate_passed, detail FROM gates ORDER BY gate_code;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_branches'::text AS gate_code,
      to_regclass('public.branches') IS NOT NULL AS gate_passed,
      'branches'::text AS detail
    UNION ALL SELECT 'table_finance_cost_centers', to_regclass('public.finance_cost_centers') IS NOT NULL, 'finance_cost_centers'
    UNION ALL SELECT 'table_finance_accounting_periods', to_regclass('public.finance_accounting_periods') IS NOT NULL, 'finance_accounting_periods'
    UNION ALL SELECT 'seed_principal_branch',
      EXISTS (SELECT 1 FROM public.branches WHERE code = 'PRINCIPAL' AND is_main AND is_active),
      coalesce((SELECT name FROM public.branches WHERE code = 'PRINCIPAL'), 'missing')
    UNION ALL SELECT 'single_active_main_branch',
      (SELECT count(*) FROM public.branches WHERE is_main AND is_active) = 1,
      (SELECT count(*)::text FROM public.branches WHERE is_main AND is_active)
    UNION ALL SELECT 'dimension_columns_on_chart',
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'finance_chart_accounts'
          AND column_name = 'branch_dimension_rule'
      ), 'branch_dimension_rule'
    UNION ALL SELECT 'rpc_create_branch', to_regprocedure('public.create_branch(jsonb)') IS NOT NULL, 'create_branch'
    UNION ALL SELECT 'rpc_create_finance_cost_center', to_regprocedure('public.create_finance_cost_center(jsonb)') IS NOT NULL, 'create_finance_cost_center'
    UNION ALL SELECT 'rpc_create_finance_accounting_period', to_regprocedure('public.create_finance_accounting_period(integer, integer)') IS NOT NULL, 'create_finance_accounting_period'
    UNION ALL SELECT 'branches_no_delete_policy',
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND cmd = 'DELETE'),
      'no DELETE policy on branches'
    UNION ALL SELECT 'finance_204_still_absent',
      to_regclass('public.finance_journal_entries') IS NULL, 'journal not yet applied'
  ) g
),
failed AS (
  SELECT gate_code, detail FROM gates WHERE NOT gate_passed
)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 'FAIL' ELSE 'PASS' END AS finance_accounting_postcheck_203,
  (SELECT count(*)::text FROM failed) AS failed_gates,
  coalesce((SELECT string_agg(gate_code, ', ' ORDER BY gate_code) FROM failed), '') AS failed_detail;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_branches'::text AS gate_code, to_regclass('public.branches') IS NOT NULL AS gate_passed
    UNION ALL SELECT 'table_finance_cost_centers', to_regclass('public.finance_cost_centers') IS NOT NULL
    UNION ALL SELECT 'table_finance_accounting_periods', to_regclass('public.finance_accounting_periods') IS NOT NULL
    UNION ALL SELECT 'seed_principal_branch',
      EXISTS (SELECT 1 FROM public.branches WHERE code = 'PRINCIPAL' AND is_main AND is_active)
    UNION ALL SELECT 'single_active_main_branch',
      (SELECT count(*) FROM public.branches WHERE is_main AND is_active) = 1
    UNION ALL SELECT 'dimension_columns_on_chart',
      EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'finance_chart_accounts'
          AND column_name = 'branch_dimension_rule'
      )
    UNION ALL SELECT 'rpc_create_branch', to_regprocedure('public.create_branch(jsonb)') IS NOT NULL
    UNION ALL SELECT 'rpc_create_finance_cost_center', to_regprocedure('public.create_finance_cost_center(jsonb)') IS NOT NULL
    UNION ALL SELECT 'rpc_create_finance_accounting_period', to_regprocedure('public.create_finance_accounting_period(integer, integer)') IS NOT NULL
    UNION ALL SELECT 'branches_no_delete_policy',
      NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'branches' AND cmd = 'DELETE')
    UNION ALL SELECT 'finance_204_still_absent', to_regclass('public.finance_journal_entries') IS NULL
  ) g
),
failed AS (
  SELECT gate_code FROM gates WHERE NOT gate_passed
)
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 0 ELSE 1 END) AS fail_closed_pass_guard;
