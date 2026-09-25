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
    UNION ALL SELECT 'journal_entries_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_entries', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_entries_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT'), 'SELECT granted'
    UNION ALL SELECT 'journal_entries_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'TRIGGER'), 'TRIGGER denied'
    UNION ALL SELECT 'journal_lines_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_lines', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_lines_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_lines', 'SELECT'), 'SELECT granted'
    UNION ALL SELECT 'journal_lines_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'TRIGGER'), 'TRIGGER denied'
    UNION ALL SELECT 'journal_counters_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_entry_counters', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_select',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'SELECT'), 'authenticated SELECT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'TRIGGER'), 'TRIGGER denied'
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
    UNION ALL SELECT 'journal_entries_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_entries', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_entries_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT'), 'SELECT granted'
    UNION ALL SELECT 'journal_entries_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_entries_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'TRIGGER'), 'TRIGGER denied'
    UNION ALL SELECT 'journal_lines_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_lines', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_lines_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_lines', 'SELECT'), 'SELECT granted'
    UNION ALL SELECT 'journal_lines_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_lines_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_lines', 'TRIGGER'), 'TRIGGER denied'
    UNION ALL SELECT 'journal_counters_anon_no_select',
      NOT has_table_privilege('anon', 'public.finance_journal_entry_counters', 'SELECT'), 'anon SELECT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_select',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'SELECT'), 'authenticated SELECT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_insert',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'INSERT'), 'INSERT denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_update',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'UPDATE'), 'UPDATE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'DELETE'), 'DELETE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_truncate',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'TRUNCATE'), 'TRUNCATE denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_references',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'REFERENCES'), 'REFERENCES denied'
    UNION ALL SELECT 'journal_counters_authenticated_no_trigger',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'TRIGGER'), 'TRIGGER denied'
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
    UNION ALL SELECT 'journal_entries_authenticated_no_delete',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE')
    UNION ALL SELECT 'journal_entries_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT')
    UNION ALL SELECT 'journal_lines_authenticated_select',
      has_table_privilege('authenticated', 'public.finance_journal_lines', 'SELECT')
    UNION ALL SELECT 'journal_counters_authenticated_no_select',
      NOT has_table_privilege('authenticated', 'public.finance_journal_entry_counters', 'SELECT')
    UNION ALL SELECT 'internal_guard_not_public',
      NOT has_function_privilege('public', 'public.finance_journal_entry_guard_transitions()', 'EXECUTE')
  ) g
),
failed AS (
  SELECT gate_code FROM gates WHERE NOT gate_passed
)
SELECT 1 / (CASE WHEN EXISTS (SELECT 1 FROM failed) THEN 0 ELSE 1 END) AS fail_closed_pass_guard;
