-- Post-apply validation after 202_finance_accounting_chart_of_accounts.sql (READ-ONLY).
-- Expected result: finance_accounting_postcheck_202 = PASS
\set ON_ERROR_STOP on

drop table if exists pg_temp.finance_postcheck_202_gates;

create temp table finance_postcheck_202_gates as
select * from (
  select 'table_finance_chart_accounts'::text as gate_code,
    to_regclass('public.finance_chart_accounts') is not null as gate_passed,
    coalesce(to_regclass('public.finance_chart_accounts')::text, 'missing') as detail
  union all select 'rpc_list_finance_chart_accounts',
    to_regprocedure('public.list_finance_chart_accounts(text, text, text, text, boolean, boolean)') is not null,
    'list_finance_chart_accounts'
  union all select 'rpc_create_finance_chart_account',
    to_regprocedure('public.create_finance_chart_account(jsonb)') is not null,
    'create_finance_chart_account'
  union all select 'role_contador_active',
    exists (select 1 from public.user_roles where role_key = 'contador' and is_active),
    coalesce((select role_name from public.user_roles where role_key = 'contador'), 'missing')
  union all select 'rls_enabled',
    (select relrowsecurity from pg_class where oid = 'public.finance_chart_accounts'::regclass),
    'finance_chart_accounts RLS'
  union all select 'authenticated_no_delete',
    not has_table_privilege('authenticated', 'public.finance_chart_accounts', 'DELETE'),
    'DELETE denied'
  union all select 'authenticated_select',
    has_table_privilege('authenticated', 'public.finance_chart_accounts', 'SELECT'),
    'SELECT granted'
  union all select 'rpc_execute_authenticated',
    has_function_privilege('authenticated', 'public.create_finance_chart_account(jsonb)', 'EXECUTE'),
    'create execute'
  union all select 'finance_203_still_absent',
    to_regclass('public.branches') is null, 'branches not yet applied'
  union all select 'finance_204_still_absent',
    to_regclass('public.finance_journal_entries') is null, 'journal not yet applied'
) g;

select gate_code, gate_passed, detail from pg_temp.finance_postcheck_202_gates order by gate_code;

select case when exists (
  select 1 from pg_temp.finance_postcheck_202_gates where not gate_passed
) then 'FAIL' else 'PASS' end as finance_accounting_postcheck_202,
  (select count(*)::text from pg_temp.finance_postcheck_202_gates where not gate_passed) as failed_gates,
  coalesce((
    select string_agg(gate_code, ', ') from pg_temp.finance_postcheck_202_gates where not gate_passed
  ), '') as failed_detail;
