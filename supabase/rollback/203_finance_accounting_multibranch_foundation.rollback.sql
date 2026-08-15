-- ROLLBACK 203 — multibranch accounting foundation (Stage-only, fail-closed).
-- Run AFTER 204 rollback. Restores 202 chart RPCs via idempotent re-apply of migration 202.
\set ON_ERROR_STOP on

begin;

do $guard$
declare
  v_env text := lower(coalesce(
    (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
    ''
  ));
  v_stored_ref text := nullif(trim(coalesce(
    (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
    ''
  )), '');
  v_session_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
begin
  if v_env in ('production', 'prod') then
    raise exception '203 rollback blocked: production environment';
  end if;
  if v_env <> 'stage' then
    raise exception '203 rollback blocked: deployment_environment.name must be stage';
  end if;
  if v_session_ref is null then
    raise exception '203 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
  end if;
  if v_stored_ref is null then
    raise exception '203 rollback blocked: deployment_environment.project_ref missing';
  end if;
  if v_session_ref <> v_stored_ref then
    raise exception '203 rollback blocked: session project ref does not match stored value';
  end if;
end $guard$;

do $check$
begin
  if to_regclass('public.finance_journal_entries') is not null then
    raise exception '203 rollback rejected: apply 204 rollback first';
  end if;
  if exists (select 1 from public.branches where code <> 'PRINCIPAL') then
    raise exception '203 rollback rejected: additional branches exist beyond PRINCIPAL seed';
  end if;
  if exists (select 1 from public.finance_cost_centers) then
    raise exception '203 rollback rejected: finance_cost_centers rows exist';
  end if;
  if exists (
    select 1 from public.finance_accounting_periods
    where period_year <> 2099 or period_month <> 1
  ) then
    raise exception '203 rollback rejected: real accounting periods exist';
  end if;
end $check$;

drop trigger if exists finance_accounting_periods_updated_at on public.finance_accounting_periods;
drop trigger if exists finance_cost_centers_updated_at on public.finance_cost_centers;
drop trigger if exists branches_updated_at on public.branches;

drop policy if exists finance_accounting_periods_select on public.finance_accounting_periods;
drop policy if exists finance_accounting_periods_insert on public.finance_accounting_periods;
drop policy if exists finance_accounting_periods_update on public.finance_accounting_periods;
drop policy if exists finance_cost_centers_select on public.finance_cost_centers;
drop policy if exists finance_cost_centers_insert on public.finance_cost_centers;
drop policy if exists finance_cost_centers_update on public.finance_cost_centers;
drop policy if exists branches_select on public.branches;
drop policy if exists branches_insert on public.branches;
drop policy if exists branches_update on public.branches;

drop function if exists public.import_finance_chart_accounts(jsonb);
drop function if exists public.update_finance_chart_account(uuid, jsonb);
drop function if exists public.create_finance_chart_account(jsonb);
drop function if exists public.finance_chart_account_validate_dimension_rule(text);
drop function if exists public.finance_chart_account_default_cost_center_dimension_rule(text);
drop function if exists public.finance_chart_account_default_branch_dimension_rule(text);
drop function if exists public.finance_accounting_period_row_to_json(public.finance_accounting_periods);
drop function if exists public.finance_cost_center_row_to_json(public.finance_cost_centers);
drop function if exists public.branch_row_to_json(public.branches);
drop function if exists public.reopen_finance_accounting_period(uuid, text);
drop function if exists public.set_finance_accounting_period_status(uuid, text);
drop function if exists public.create_finance_accounting_period(integer, integer);
drop function if exists public.list_finance_accounting_periods(integer, text);
drop function if exists public.set_finance_cost_center_active(uuid, boolean);
drop function if exists public.update_finance_cost_center(uuid, jsonb);
drop function if exists public.create_finance_cost_center(jsonb);
drop function if exists public.list_finance_cost_centers(text, uuid, boolean, boolean);
drop function if exists public.set_branch_main(uuid);
drop function if exists public.set_branch_active(uuid, boolean);
drop function if exists public.update_branch(uuid, jsonb);
drop function if exists public.create_branch(jsonb);
drop function if exists public.list_branches(text, boolean, boolean);
drop function if exists public.can_reopen_accounting_period();
drop function if exists public.can_close_accounting_period();
drop function if exists public.can_manage_accounting_periods();
drop function if exists public.can_manage_accounting_structure();
drop function if exists public.finance_cost_center_assert_branch_hierarchy(uuid, uuid);
drop function if exists public.finance_cost_center_assert_no_cycle(uuid, uuid);
drop function if exists public.finance_cost_center_parent_level(uuid);
drop function if exists public.finance_cost_center_normalize_code(text);
drop function if exists public.branch_normalize_code(text);
drop function if exists public.finance_accounting_period_bounds(integer, integer);

drop table if exists public.finance_accounting_periods;
drop table if exists public.finance_cost_centers;
drop table if exists public.branches;

alter table if exists public.finance_chart_accounts
  drop constraint if exists finance_chart_accounts_branch_dimension_rule_check,
  drop constraint if exists finance_chart_accounts_cost_center_dimension_rule_check;

alter table if exists public.finance_chart_accounts
  drop column if exists branch_dimension_rule,
  drop column if exists cost_center_dimension_rule;

-- Stage operator: re-apply supabase/schema/202_finance_accounting_chart_of_accounts.sql (idempotent) before closing.

do $validate$
begin
  if to_regclass('public.branches') is not null then
    raise exception '203 rollback validation failed: branches still exists';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'finance_chart_accounts'
      and column_name = 'branch_dimension_rule'
  ) then
    raise exception '203 rollback validation failed: dimension columns remain';
  end if;
end $validate$;

select 'PASS' as rollback_203_finance_accounting_multibranch_foundation;

commit;
