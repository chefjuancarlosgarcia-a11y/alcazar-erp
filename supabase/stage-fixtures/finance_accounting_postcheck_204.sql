-- Post-apply validation after 204_finance_accounting_journal_engine.sql (READ-ONLY).
-- Expected result: finance_accounting_postcheck_204 = PASS
\set ON_ERROR_STOP on

drop table if exists pg_temp.finance_postcheck_204_gates;

create temp table finance_postcheck_204_gates as
select * from (
  select 'table_finance_journal_entries'::text as gate_code,
    to_regclass('public.finance_journal_entries') is not null as gate_passed,
    'finance_journal_entries'::text as detail
  union all select 'table_finance_journal_lines', to_regclass('public.finance_journal_lines') is not null, 'finance_journal_lines'
  union all select 'table_finance_journal_entry_counters', to_regclass('public.finance_journal_entry_counters') is not null, 'finance_journal_entry_counters'
  union all select 'rpc_create_finance_journal_draft', to_regprocedure('public.create_finance_journal_draft(jsonb)') is not null, 'create_finance_journal_draft'
  union all select 'rpc_post_finance_journal_entry', to_regprocedure('public.post_finance_journal_entry(uuid)') is not null, 'post_finance_journal_entry'
  union all select 'rpc_reverse_finance_journal_entry', to_regprocedure('public.reverse_finance_journal_entry(uuid, text, date)') is not null, 'reverse_finance_journal_entry'
  union all select 'trigger_posted_immutability',
    exists (
      select 1 from pg_trigger
      where tgname = 'finance_journal_entries_block_posted'
        and tgrelid = 'public.finance_journal_entries'::regclass
    ), 'finance_journal_entries_block_posted'
  union all select 'authenticated_no_insert_entries',
    not has_table_privilege('authenticated', 'public.finance_journal_entries', 'INSERT'), 'INSERT denied on entries'
  union all select 'authenticated_no_update_entries',
    not has_table_privilege('authenticated', 'public.finance_journal_entries', 'UPDATE'), 'UPDATE denied on entries'
  union all select 'authenticated_no_delete_entries',
    not has_table_privilege('authenticated', 'public.finance_journal_entries', 'DELETE'), 'DELETE denied on entries'
  union all select 'authenticated_select_entries',
    has_table_privilege('authenticated', 'public.finance_journal_entries', 'SELECT'), 'SELECT on entries'
  union all select 'internal_guard_not_public',
    not has_function_privilege('public', 'public.finance_journal_entry_guard_transitions()', 'EXECUTE'), 'guard not public'
) g;

select gate_code, gate_passed, detail from pg_temp.finance_postcheck_204_gates order by gate_code;

select case when exists (
  select 1 from pg_temp.finance_postcheck_204_gates where not gate_passed
) then 'FAIL' else 'PASS' end as finance_accounting_postcheck_204,
  (select count(*)::text from pg_temp.finance_postcheck_204_gates where not gate_passed) as failed_gates,
  coalesce((
    select string_agg(gate_code, ', ') from pg_temp.finance_postcheck_204_gates where not gate_passed
  ), '') as failed_detail;
