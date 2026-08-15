-- Post-apply validation after 203_finance_accounting_multibranch_foundation.sql (READ-ONLY).
-- Expected result: finance_accounting_postcheck_203 = PASS
\set ON_ERROR_STOP on

drop table if exists pg_temp.finance_postcheck_203_gates;

create temp table finance_postcheck_203_gates as
select * from (
  select 'table_branches'::text as gate_code,
    to_regclass('public.branches') is not null as gate_passed,
    'branches'::text as detail
  union all select 'table_finance_cost_centers', to_regclass('public.finance_cost_centers') is not null, 'finance_cost_centers'
  union all select 'table_finance_accounting_periods', to_regclass('public.finance_accounting_periods') is not null, 'finance_accounting_periods'
  union all select 'seed_principal_branch',
    exists (select 1 from public.branches where code = 'PRINCIPAL' and is_main and is_active),
    coalesce((select name from public.branches where code = 'PRINCIPAL'), 'missing')
  union all select 'single_active_main_branch',
    (select count(*) from public.branches where is_main and is_active) = 1,
    (select count(*)::text from public.branches where is_main and is_active)
  union all select 'dimension_columns_on_chart',
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_chart_accounts'
        and column_name = 'branch_dimension_rule'
    ), 'branch_dimension_rule'
  union all select 'rpc_create_branch', to_regprocedure('public.create_branch(jsonb)') is not null, 'create_branch'
  union all select 'rpc_create_finance_cost_center', to_regprocedure('public.create_finance_cost_center(jsonb)') is not null, 'create_finance_cost_center'
  union all select 'rpc_create_finance_accounting_period', to_regprocedure('public.create_finance_accounting_period(integer, integer)') is not null, 'create_finance_accounting_period'
  union all select 'branches_no_delete_policy',
    not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'branches' and cmd = 'DELETE'),
    'no DELETE policy on branches'
  union all select 'finance_204_still_absent',
    to_regclass('public.finance_journal_entries') is null, 'journal not yet applied'
) g;

select gate_code, gate_passed, detail from pg_temp.finance_postcheck_203_gates order by gate_code;

select case when exists (
  select 1 from pg_temp.finance_postcheck_203_gates where not gate_passed
) then 'FAIL' else 'PASS' end as finance_accounting_postcheck_203,
  (select count(*)::text from pg_temp.finance_postcheck_203_gates where not gate_passed) as failed_gates,
  coalesce((
    select string_agg(gate_code, ', ') from pg_temp.finance_postcheck_203_gates where not gate_passed
  ), '') as failed_detail;
