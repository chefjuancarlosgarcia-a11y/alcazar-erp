-- ROLLBACK 202 — chart of accounts (Stage-only, fail-closed).
-- Run AFTER 203 rollback. Does NOT remove contador from user_roles if assigned to profiles.
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
    raise exception '202 rollback blocked: production environment';
  end if;
  if v_env <> 'stage' then
    raise exception '202 rollback blocked: deployment_environment.name must be stage';
  end if;
  if v_session_ref is null then
    raise exception '202 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
  end if;
  if v_stored_ref is null then
    raise exception '202 rollback blocked: deployment_environment.project_ref missing';
  end if;
  if v_session_ref <> v_stored_ref then
    raise exception '202 rollback blocked: session project ref does not match stored value';
  end if;
end $guard$;

do $check$
begin
  if to_regclass('public.branches') is not null then
    raise exception '202 rollback rejected: apply 203 rollback first';
  end if;
  if exists (
    select 1 from public.finance_chart_accounts
    where code not like 'STAGE_FINANCE_SMOKE%' and code not like '%audit%'
  ) then
    raise exception '202 rollback rejected: real chart accounts exist';
  end if;
end $check$;

drop trigger if exists finance_chart_accounts_updated_at on public.finance_chart_accounts;

drop policy if exists finance_chart_accounts_update on public.finance_chart_accounts;
drop policy if exists finance_chart_accounts_insert on public.finance_chart_accounts;
drop policy if exists finance_chart_accounts_select on public.finance_chart_accounts;

drop function if exists public.import_finance_chart_accounts(jsonb);
drop function if exists public.preview_finance_chart_accounts_import(jsonb);
drop function if exists public.set_finance_chart_account_active(uuid, boolean);
drop function if exists public.update_finance_chart_account(uuid, jsonb);
drop function if exists public.create_finance_chart_account(jsonb);
drop function if exists public.list_finance_chart_accounts(text, text, text, text, boolean, boolean);
drop function if exists public.finance_chart_import_sort_rows(jsonb);
drop function if exists public.finance_chart_import_would_cycle(text, text, jsonb);
drop function if exists public.finance_chart_account_row_to_json(public.finance_chart_accounts);
drop function if exists public.finance_chart_account_assert_no_cycle(uuid, uuid);
drop function if exists public.finance_chart_account_parent_level(uuid);
drop function if exists public.finance_chart_account_normalize_code(text);
drop function if exists public.can_manage_accounting_catalog();

drop table if exists public.finance_chart_accounts;

do $validate$
begin
  if to_regclass('public.finance_chart_accounts') is not null then
    raise exception '202 rollback validation failed: finance_chart_accounts still exists';
  end if;
  if to_regprocedure('public.create_finance_chart_account(jsonb)') is not null then
    raise exception '202 rollback validation failed: chart RPCs still exist';
  end if;
  if not exists (select 1 from public.user_roles where role_key = 'contador') then
    raise exception '202 rollback validation failed: contador role missing unexpectedly';
  end if;
end $validate$;

select 'PASS' as rollback_202_finance_accounting_chart_of_accounts;

commit;
