-- Post-apply validation after 204_finance_accounting_journal_engine.sql (pure read-only).
-- Expected: finance_accounting_postcheck_204 = PASS; psql exits non-zero on FAIL.
\set ON_ERROR_STOP on

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_journal_entries'::text AS gate_code,
      to_regclass('public.finance_journal_entries') IS NOT NULL AS gate_passed,
      'finance_journal_entries'::text AS detail
    UNION ALL SELECT 'table_finance_journal_lines', to_regclass('public.finance_journal_lines') IS NOT NULL, 'finance_journal_lines'
    UNION ALL SELECT 'table_finance_journal_entry_counters', to_regclass('public.finance_journal_entry_counters') IS NOT NULL, 'finance_journal_entry_counters'
    UNION ALL SELECT 'rpc_create_finance_journal_draft', to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL, 'create_finance_journal_draft'
    UNION ALL SELECT 'rpc_post_finance_journal_entry', to_regprocedure('public.post_finance_journal_entry(uuid)') IS NOT NULL, 'post_finance_journal_entry'
    UNION ALL SELECT 'rpc_reverse_finance_journal_entry', to_regprocedure('public.reverse_finance_journal_entry(uuid, text, date)') IS NOT NULL, 'reverse_finance_journal_entry'
    UNION ALL SELECT 'trigger_posted_immutability',
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'finance_journal_entries_block_posted'
          AND tgrelid = 'public.finance_journal_entries'::regclass
      ), 'finance_journal_entries_block_posted'
    UNION ALL SELECT 'authenticated_no_insert_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT'), 'INSERT denied on entries'
    UNION ALL SELECT 'authenticated_no_update_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE'), 'UPDATE denied on entries'
    UNION ALL SELECT 'authenticated_no_delete_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE'), 'DELETE denied on entries'
    UNION ALL SELECT 'authenticated_select_entries',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT'), 'SELECT on entries'
    UNION ALL SELECT 'internal_guard_not_public',
      NOT has_function_privilege('public', 'public.finance_journal_entry_guard_transitions()', 'EXECUTE'), 'guard not public'
  ) g
)
SELECT gate_code, gate_passed, detail FROM gates ORDER BY gate_code;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_journal_entries'::text AS gate_code,
      to_regclass('public.finance_journal_entries') IS NOT NULL AS gate_passed,
      'finance_journal_entries'::text AS detail
    UNION ALL SELECT 'table_finance_journal_lines', to_regclass('public.finance_journal_lines') IS NOT NULL, 'finance_journal_lines'
    UNION ALL SELECT 'table_finance_journal_entry_counters', to_regclass('public.finance_journal_entry_counters') IS NOT NULL, 'finance_journal_entry_counters'
    UNION ALL SELECT 'rpc_create_finance_journal_draft', to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL, 'create_finance_journal_draft'
    UNION ALL SELECT 'rpc_post_finance_journal_entry', to_regprocedure('public.post_finance_journal_entry(uuid)') IS NOT NULL, 'post_finance_journal_entry'
    UNION ALL SELECT 'rpc_reverse_finance_journal_entry', to_regprocedure('public.reverse_finance_journal_entry(uuid, text, date)') IS NOT NULL, 'reverse_finance_journal_entry'
    UNION ALL SELECT 'trigger_posted_immutability',
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'finance_journal_entries_block_posted'
          AND tgrelid = 'public.finance_journal_entries'::regclass
      ), 'finance_journal_entries_block_posted'
    UNION ALL SELECT 'authenticated_no_insert_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT'), 'INSERT denied on entries'
    UNION ALL SELECT 'authenticated_no_update_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE'), 'UPDATE denied on entries'
    UNION ALL SELECT 'authenticated_no_delete_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE'), 'DELETE denied on entries'
    UNION ALL SELECT 'authenticated_select_entries',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT'), 'SELECT on entries'
    UNION ALL SELECT 'internal_guard_not_public',
      NOT has_function_privilege('public', 'public.finance_journal_entry_guard_transitions()', 'EXECUTE'), 'guard not public'
  ) g
),
failed AS (
  SELECT gate_code, detail FROM gates WHERE NOT gate_passed
)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 'FAIL' ELSE 'PASS' END AS finance_accounting_postcheck_204,
  (SELECT count(*)::text FROM failed) AS failed_gates,
  coalesce((SELECT string_agg(gate_code, ', ' ORDER BY gate_code) FROM failed), '') AS failed_detail;

WITH gates AS (
  SELECT * FROM (
    SELECT 'table_finance_journal_entries'::text AS gate_code,
      to_regclass('public.finance_journal_entries') IS NOT NULL AS gate_passed
    UNION ALL SELECT 'table_finance_journal_lines', to_regclass('public.finance_journal_lines') IS NOT NULL
    UNION ALL SELECT 'table_finance_journal_entry_counters', to_regclass('public.finance_journal_entry_counters') IS NOT NULL
    UNION ALL SELECT 'rpc_create_finance_journal_draft', to_regprocedure('public.create_finance_journal_draft(jsonb)') IS NOT NULL
    UNION ALL SELECT 'rpc_post_finance_journal_entry', to_regprocedure('public.post_finance_journal_entry(uuid)') IS NOT NULL
    UNION ALL SELECT 'rpc_reverse_finance_journal_entry', to_regprocedure('public.reverse_finance_journal_entry(uuid, text, date)') IS NOT NULL
    UNION ALL SELECT 'trigger_posted_immutability',
      EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'finance_journal_entries_block_posted'
          AND tgrelid = 'public.finance_journal_entries'::regclass
      )
    UNION ALL SELECT 'authenticated_no_insert_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT')
    UNION ALL SELECT 'authenticated_no_update_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE')
    UNION ALL SELECT 'authenticated_no_delete_entries',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE')
    UNION ALL SELECT 'authenticated_select_entries',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT')
    UNION ALL SELECT 'internal_guard_not_public',
      NOT has_function_privilege('public', 'public.finance_journal_entry_guard_transitions()', 'EXECUTE')
  ) g
),
failed AS (
  SELECT gate_code FROM gates WHERE NOT gate_passed
)
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 0 ELSE 1 END) AS fail_closed_pass_guard;
