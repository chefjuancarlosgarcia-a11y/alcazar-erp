-- Post-apply validation after 202_finance_accounting_chart_of_accounts.sql (pure read-only).
-- Expected: finance_accounting_postcheck_202 = PASS; psql exits non-zero on FAIL.
\set ON_ERROR_STOP on

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_chart_accounts'::text AS gate_code,
      to_regclass('public.finance_chart_accounts') IS NOT NULL AS gate_passed,
      coalesce(to_regclass('public.finance_chart_accounts')::text, 'missing') AS detail
    UNION ALL SELECT 'rpc_list_finance_chart_accounts',
      to_regprocedure('public.list_finance_chart_accounts(text, text, text, text, boolean, boolean)') IS NOT NULL,
      'list_finance_chart_accounts'
    UNION ALL SELECT 'rpc_create_finance_chart_account',
      to_regprocedure('public.create_finance_chart_account(jsonb)') IS NOT NULL,
      'create_finance_chart_account'
    UNION ALL SELECT 'role_contador_active',
      EXISTS (SELECT 1 FROM public.user_roles WHERE role_key = 'contador' AND is_active),
      coalesce((SELECT role_name FROM public.user_roles WHERE role_key = 'contador'), 'missing')
    UNION ALL SELECT 'rls_enabled',
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.finance_chart_accounts'::regclass),
      'finance_chart_accounts RLS'
    UNION ALL SELECT 'chart_accounts_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_chart_accounts', 'SELECT'),
      'anon SELECT denied'
    UNION ALL SELECT 'chart_accounts_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'SELECT'),
      'SELECT granted'
    UNION ALL SELECT 'chart_accounts_authenticated_insert',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'INSERT'),
      'INSERT granted'
    UNION ALL SELECT 'chart_accounts_authenticated_update',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'UPDATE'),
      'UPDATE granted'
    UNION ALL SELECT 'chart_accounts_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'DELETE'),
      'DELETE denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'TRUNCATE'),
      'TRUNCATE denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'REFERENCES'),
      'REFERENCES denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'TRIGGER'),
      'TRIGGER denied'
    UNION ALL SELECT 'rpc_execute_authenticated',
      has_function_privilege('authenticated', 'public.create_finance_chart_account(jsonb)', 'EXECUTE'),
      'create execute'
    UNION ALL SELECT 'finance_203_still_absent',
      to_regclass('public.branches') IS NULL, 'branches not yet applied'
    UNION ALL SELECT 'finance_204_still_absent',
      to_regclass('public.finance_journal_entries') IS NULL, 'journal not yet applied'
  ) g
)
SELECT gate_code, gate_passed, detail FROM gates ORDER BY gate_code;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_chart_accounts'::text AS gate_code,
      to_regclass('public.finance_chart_accounts') IS NOT NULL AS gate_passed,
      coalesce(to_regclass('public.finance_chart_accounts')::text, 'missing') AS detail
    UNION ALL SELECT 'rpc_list_finance_chart_accounts',
      to_regprocedure('public.list_finance_chart_accounts(text, text, text, text, boolean, boolean)') IS NOT NULL,
      'list_finance_chart_accounts'
    UNION ALL SELECT 'rpc_create_finance_chart_account',
      to_regprocedure('public.create_finance_chart_account(jsonb)') IS NOT NULL,
      'create_finance_chart_account'
    UNION ALL SELECT 'role_contador_active',
      EXISTS (SELECT 1 FROM public.user_roles WHERE role_key = 'contador' AND is_active),
      coalesce((SELECT role_name FROM public.user_roles WHERE role_key = 'contador'), 'missing')
    UNION ALL SELECT 'rls_enabled',
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.finance_chart_accounts'::regclass),
      'finance_chart_accounts RLS'
    UNION ALL SELECT 'chart_accounts_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_chart_accounts', 'SELECT'),
      'anon SELECT denied'
    UNION ALL SELECT 'chart_accounts_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'SELECT'),
      'SELECT granted'
    UNION ALL SELECT 'chart_accounts_authenticated_insert',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'INSERT'),
      'INSERT granted'
    UNION ALL SELECT 'chart_accounts_authenticated_update',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'UPDATE'),
      'UPDATE granted'
    UNION ALL SELECT 'chart_accounts_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'DELETE'),
      'DELETE denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'TRUNCATE'),
      'TRUNCATE denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'REFERENCES'),
      'REFERENCES denied'
    UNION ALL SELECT 'chart_accounts_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'TRIGGER'),
      'TRIGGER denied'
    UNION ALL SELECT 'rpc_execute_authenticated',
      has_function_privilege('authenticated', 'public.create_finance_chart_account(jsonb)', 'EXECUTE'),
      'create execute'
    UNION ALL SELECT 'finance_203_still_absent',
      to_regclass('public.branches') IS NULL, 'branches not yet applied'
    UNION ALL SELECT 'finance_204_still_absent',
      to_regclass('public.finance_journal_entries') IS NULL, 'journal not yet applied'
  ) g
),
failed AS (
  SELECT gate_code, detail FROM gates WHERE NOT gate_passed
)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 'FAIL' ELSE 'PASS' END AS finance_accounting_postcheck_202,
  (SELECT count(*)::text FROM failed) AS failed_gates,
  coalesce((SELECT string_agg(gate_code, ', ' ORDER BY gate_code) FROM failed), '') AS failed_detail;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_chart_accounts'::text AS gate_code,
      to_regclass('public.finance_chart_accounts') IS NOT NULL AS gate_passed
    UNION ALL SELECT 'rpc_list_finance_chart_accounts',
      to_regprocedure('public.list_finance_chart_accounts(text, text, text, text, boolean, boolean)') IS NOT NULL
    UNION ALL SELECT 'rpc_create_finance_chart_account',
      to_regprocedure('public.create_finance_chart_account(jsonb)') IS NOT NULL
    UNION ALL SELECT 'role_contador_active',
      EXISTS (SELECT 1 FROM public.user_roles WHERE role_key = 'contador' AND is_active)
    UNION ALL SELECT 'rls_enabled',
      (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.finance_chart_accounts'::regclass)
    UNION ALL SELECT 'chart_accounts_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_chart_accounts', 'DELETE')
    UNION ALL SELECT 'chart_accounts_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_chart_accounts', 'SELECT')
    UNION ALL SELECT 'rpc_execute_authenticated',
      has_function_privilege('authenticated', 'public.create_finance_chart_account(jsonb)', 'EXECUTE')
    UNION ALL SELECT 'finance_203_still_absent', to_regclass('public.branches') IS NULL
    UNION ALL SELECT 'finance_204_still_absent', to_regclass('public.finance_journal_entries') IS NULL
  ) g
),
failed AS (
  SELECT gate_code FROM gates WHERE NOT gate_passed
)
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 0 ELSE 1 END) AS fail_closed_pass_guard;
