-- Finance accounting Stage preflight (READ-ONLY).
-- Do NOT apply as migration. Run in Supabase SQL Editor on Stage before 202-204.
--
-- BEFORE running, the operator MUST set the expected project reference for this session:
--   select set_config('alcazar.finance_stage_project_ref', '<project-ref-from-vault>', false);
--
-- Requires in app_settings.deployment_environment JSON:
--   name = 'stage'
--   project_ref = same value as alcazar.finance_stage_project_ref
--
-- Fail-closed: returns NOT_READY. Does NOT accept manual bypass flags.
-- Never prints URLs, passwords, JWTs or connection strings.

\set ON_ERROR_STOP on

drop table if exists pg_temp.finance_preflight_gates;

create temp table finance_preflight_gates as
with env as (
  select
    lower(coalesce(
      (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
      ''
    )) as deployment_name,
    nullif(trim(coalesce(
      (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
      ''
    )), '') as deployment_project_ref,
    nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '')
      as session_project_ref
)
select * from (
  select
    'environment_is_stage'::text as gate_code,
    (select deployment_name from env) = 'stage' as gate_passed,
    case
      when (select deployment_name from env) in ('production', 'prod') then 'BLOCKED: production detected'
      when (select deployment_name from env) = 'stage' then 'ok'
      else 'deployment_environment.name must be stage'
    end as detail

  union all select 'not_production',
    (select deployment_name from env) not in ('production', 'prod'),
    coalesce((select deployment_name from env), 'unknown')

  union all select 'session_project_ref_provided',
    (select session_project_ref from env) is not null,
    case
      when (select session_project_ref from env) is null
        then 'Set alcazar.finance_stage_project_ref before preflight'
      else 'session project ref present'
    end

  union all select 'deployment_project_ref_present',
    (select deployment_project_ref from env) is not null,
    case
      when (select deployment_project_ref from env) is null
        then 'deployment_environment.project_ref missing in app_settings'
      else 'stored project ref present'
    end

  union all select 'project_ref_matches',
    (select session_project_ref from env) is not null
      and (select deployment_project_ref from env) is not null
      and (select session_project_ref from env) = (select deployment_project_ref from env),
    case
      when (select session_project_ref from env) is null
        or (select deployment_project_ref from env) is null then 'missing ref(s)'
      when (select session_project_ref from env) <> (select deployment_project_ref from env)
        then 'session ref does not match deployment_environment.project_ref'
      else 'project ref match ok'
    end

  union all select 'postgres_version',
    current_setting('server_version_num')::int >= 150000,
    current_setting('server_version')

  union all select 'timezone_configured',
    current_setting('TimeZone') is not null and current_setting('TimeZone') <> '',
    current_setting('TimeZone')

  union all select 'extension_pgcrypto',
    exists (select 1 from pg_extension where extname = 'pgcrypto'),
    'pgcrypto'

  union all select 'table_profiles',
    to_regclass('public.profiles') is not null, 'profiles'

  union all select 'table_user_roles',
    to_regclass('public.user_roles') is not null, 'user_roles'

  union all select 'table_areas',
    to_regclass('public.areas') is not null, 'areas'

  union all select 'table_finance_bank_accounts',
    to_regclass('public.finance_bank_accounts') is not null, 'finance_bank_accounts'

  union all select 'table_finance_payables',
    to_regclass('public.finance_payables') is not null, 'finance_payables'

  union all select 'table_finance_receivables',
    to_regclass('public.finance_receivables') is not null, 'finance_receivables'

  union all select 'legacy_can_view_finance',
    to_regprocedure('public.can_view_finance()') is not null, 'can_view_finance()'

  union all select 'legacy_can_manage_finance',
    to_regprocedure('public.can_manage_finance()') is not null, 'can_manage_finance()'

  union all select 'migration_200_present',
    to_regprocedure('public.audit_pos_order_change()') is not null
      or to_regclass('public.operational_stations') is not null,
    'operational baseline through 200'

  union all select 'finance_202_absent',
    to_regclass('public.finance_chart_accounts') is null,
    coalesce(to_regclass('public.finance_chart_accounts')::text, 'absent')

  union all select 'finance_203_absent',
    to_regclass('public.branches') is null
      and to_regclass('public.finance_cost_centers') is null
      and to_regclass('public.finance_accounting_periods') is null,
    'branches/cc/periods absent'

  union all select 'finance_204_absent',
    to_regclass('public.finance_journal_entries') is null
      and to_regclass('public.finance_journal_lines') is null
      and to_regclass('public.finance_journal_entry_counters') is null,
    'journal absent'

  union all select 'no_partial_journal',
    (
      (to_regclass('public.finance_journal_entries') is not null)::int +
      (to_regclass('public.finance_journal_lines') is not null)::int +
      (to_regprocedure('public.create_finance_journal_draft(jsonb)') is not null)::int
    ) in (0, 3),
    'all journal objects absent or complete (pre-apply expect 0)'

  union all select 'role_contador_catalog',
    true,
    coalesce((select role_name from public.user_roles where role_key = 'contador'), 'optional_pre_202_added_by_migration_202')

  union all select 'baseline_finance_bank_count',
    true, (select count(*)::text from public.finance_bank_accounts)

  union all select 'baseline_finance_payables_count',
    true, (select count(*)::text from public.finance_payables)

  union all select 'baseline_finance_receivables_count',
    true, (select count(*)::text from public.finance_receivables)
) gates;

select gate_code, gate_passed, detail
from pg_temp.finance_preflight_gates
order by gate_code;

select
  case when exists (
    select 1 from pg_temp.finance_preflight_gates
    where gate_code not in (
      'baseline_finance_bank_count',
      'baseline_finance_payables_count',
      'baseline_finance_receivables_count',
      'role_contador_catalog'
    )
      and gate_passed = false
  ) then 'NOT_READY' else 'READY' end as finance_accounting_preflight_result,
  (
    select count(*)::text from pg_temp.finance_preflight_gates
    where gate_code not in (
      'baseline_finance_bank_count',
      'baseline_finance_payables_count',
      'baseline_finance_receivables_count',
      'role_contador_catalog'
    )
      and gate_passed = false
  ) as blocking_gates,
  coalesce((
    select string_agg(gate_code, ', ' order by gate_code)
    from pg_temp.finance_preflight_gates
    where gate_code not in (
      'baseline_finance_bank_count',
      'baseline_finance_payables_count',
      'baseline_finance_receivables_count',
      'role_contador_catalog'
    )
      and gate_passed = false
  ), '') as blocking_detail;
