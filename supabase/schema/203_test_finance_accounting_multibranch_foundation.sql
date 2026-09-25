-- Multibranch accounting foundation — SQL verification (NOT a migration).
-- Do NOT apply in Stage/Production deploy pipelines.
-- Run manually in Supabase SQL Editor AFTER 203_finance_accounting_multibranch_foundation.sql.
-- Uses BEGIN … ROLLBACK; safe on environments with finance Phase 2A-1 applied.

begin;

create or replace function public.test_finance_accounting_multibranch_foundation()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_contador uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_gerente uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_inactive uuid := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  v_main uuid;
  v_branch uuid;
  v_branch_b uuid;
  v_cc_root uuid;
  v_cc_child uuid;
  v_cc_bad uuid;
  v_period uuid;
  v_period_feb uuid;
  v_bounds record;
  v_main_count int;
  v_row jsonb;
  v_import jsonb;
  v_account uuid;
begin
  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin', 'admin_audit', 'admin', 'active'),
    (v_contador, 'Contador', 'contador_audit', 'contador', 'active'),
    (v_gerente, 'Gerente', 'gerente_audit', 'gerente_general', 'active'),
    (v_mesero, 'Mesero', 'mesero_audit', 'mesero', 'active'),
    (v_inactive, 'Inactivo', 'inactive_audit', 'contador', 'inactive')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  select count(*) into v_main_count from public.branches where is_main = true and is_active = true;
  return query select 'seed_single_active_main_branch'::text, v_main_count = 1, v_main_count::text;

  select id into v_main from public.branches where code = 'PRINCIPAL';
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform public.update_branch(v_main, jsonb_build_object('name', 'Principal — La Floresta Renovada'));
  return query select 'seed_principal_rename_preserves_identity'::text,
    exists(select 1 from public.branches where id = v_main and code = 'PRINCIPAL'),
    'code preserved'::text;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    perform public.create_branch(jsonb_build_object('code', 'PRINCIPAL', 'name', 'Dup'));
    return query select 'branch_duplicate_code'::text, false, 'should fail'::text;
  exception when others then
    return query select 'branch_duplicate_code'::text, sqlerrm like '%ya existe%', sqlerrm;
  end;

  begin
    perform public.create_branch(jsonb_build_object('code', 'principal', 'name', 'Case dup'));
    return query select 'branch_duplicate_code_case_insensitive'::text, false, 'should fail'::text;
  exception when others then
    return query select 'branch_duplicate_code_case_insensitive'::text, sqlerrm like '%ya existe%', sqlerrm;
  end;

  begin
    v_row := public.create_branch(jsonb_build_object('code', 'SUR-AUDIT', 'name', 'Sur audit'));
    v_branch := (v_row ->> 'id')::uuid;
    return query select 'admin_create_branch'::text, v_branch is not null, 'create ok'::text;
  exception when others then
    return query select 'admin_create_branch'::text, false, sqlerrm;
  end;

  begin
    perform public.set_branch_main(v_branch);
    select count(*) into v_main_count from public.branches where is_main = true and is_active = true;
    return query select 'set_branch_main_atomic'::text, v_main_count = 1, v_main_count::text;
  exception when others then
    return query select 'set_branch_main_atomic'::text, false, sqlerrm;
  end;

  perform public.set_branch_main(v_main);
  begin
    perform public.set_branch_active(v_main, false);
    return query select 'main_branch_cannot_deactivate'::text, false, 'should fail'::text;
  exception when others then
    return query select 'main_branch_cannot_deactivate'::text, sqlerrm like '%principal%', sqlerrm;
  end;

  begin
    perform public.update_branch(v_main, jsonb_build_object('is_main', false));
    return query select 'main_change_requires_set_branch_main'::text, false, 'should fail'::text;
  exception when others then
    return query select 'main_change_requires_set_branch_main'::text, sqlerrm like '%set_branch_main%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.create_branch(jsonb_build_object('code', 'X', 'name', 'Fail'));
    return query select 'inactive_profile_denied'::text, false, 'should fail'::text;
  exception when others then
    return query select 'inactive_profile_denied'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  begin
    v_row := public.create_finance_cost_center(jsonb_build_object(
      'code', 'CC-ROOT-AUDIT', 'name', 'Root audit', 'account_kind', 'header'
    ));
    v_cc_root := (v_row ->> 'id')::uuid;
    v_row := public.create_finance_cost_center(jsonb_build_object(
      'code', 'CC-CHILD-AUDIT', 'name', 'Child audit', 'parent_id', v_cc_root::text,
      'account_kind', 'detail', 'maps_to_area_id', 'cocina'
    ));
    v_cc_child := (v_row ->> 'id')::uuid;
    return query select 'cost_center_hierarchy_and_area_map'::text, v_cc_child is not null, 'ok'::text;
  exception when others then
    return query select 'cost_center_hierarchy_and_area_map'::text, false, sqlerrm;
  end;

  begin
    perform public.create_finance_cost_center(jsonb_build_object(
      'code', 'CC-BAD-PARENT', 'name', 'Bad', 'parent_id', gen_random_uuid()::text, 'account_kind', 'detail'
    ));
    return query select 'cost_center_missing_parent'::text, false, 'should fail'::text;
  exception when others then
    return query select 'cost_center_missing_parent'::text, true, sqlerrm;
  end;

  begin
    perform public.update_finance_cost_center(v_cc_root, jsonb_build_object('parent_id', v_cc_child::text));
    return query select 'cost_center_cycle_blocked'::text, false, 'should fail'::text;
  exception when others then
    return query select 'cost_center_cycle_blocked'::text, sqlerrm like '%ciclo%', sqlerrm;
  end;

  v_row := public.create_branch(jsonb_build_object('code', 'NORTE-AUDIT', 'name', 'Norte audit'));
  v_branch_b := (v_row ->> 'id')::uuid;

  v_row := public.create_finance_cost_center(jsonb_build_object(
    'code', 'CC-SUR-ROOT', 'name', 'Sur root', 'branch_id', v_branch::text, 'account_kind', 'header'
  ));
  v_cc_bad := (v_row ->> 'id')::uuid;
  begin
    perform public.create_finance_cost_center(jsonb_build_object(
      'code', 'CC-NORTE', 'name', 'Norte', 'parent_id', v_cc_bad::text,
      'branch_id', v_branch_b::text, 'account_kind', 'detail'
    ));
    return query select 'cost_center_branch_mismatch_blocked'::text, false, 'should fail'::text;
  exception when others then
    return query select 'cost_center_branch_mismatch_blocked'::text, sqlerrm like '%sucursal%', sqlerrm;
  end;

  select * into v_bounds from public.finance_accounting_period_bounds(2024, 2);
  return query select 'period_bounds_feb_2024_leap'::text,
    v_bounds.p_start = date '2024-02-01' and v_bounds.p_end = date '2024-02-29',
    v_bounds.p_start::text || '..' || v_bounds.p_end::text;

  select * into v_bounds from public.finance_accounting_period_bounds(2026, 2);
  return query select 'period_bounds_feb_2026'::text,
    v_bounds.p_start = date '2026-02-01' and v_bounds.p_end = date '2026-02-28',
    v_bounds.p_start::text || '..' || v_bounds.p_end::text;

  v_row := public.create_finance_accounting_period(2026, 8);
  v_period := (v_row ->> 'id')::uuid;
  begin
    perform public.create_finance_accounting_period(2026, 8);
    return query select 'period_duplicate_month'::text, false, 'should fail'::text;
  exception when others then
    return query select 'period_duplicate_month'::text, sqlerrm like '%Ya existe%', sqlerrm;
  end;

  perform public.set_finance_accounting_period_status(v_period, 'soft_closed');
  perform public.set_finance_accounting_period_status(v_period, 'closed');
  begin
    perform public.set_finance_accounting_period_status(v_period, 'open');
    return query select 'closed_requires_reopen_rpc'::text, false, 'should fail'::text;
  exception when others then
    return query select 'closed_requires_reopen_rpc'::text, sqlerrm like '%reopen_finance_accounting_period%', sqlerrm;
  end;

  begin
    perform public.reopen_finance_accounting_period(v_period, '   ');
    return query select 'reopen_requires_non_empty_reason'::text, false, 'should fail'::text;
  exception when others then
    return query select 'reopen_requires_non_empty_reason'::text, sqlerrm like '%motivo%', sqlerrm;
  end;

  perform public.reopen_finance_accounting_period(v_period, 'Ajuste autorizado por auditoría');
  return query select 'reopen_records_reason'::text,
    exists(select 1 from public.finance_accounting_periods where id = v_period and reopen_reason <> ''),
    'reason stored'::text;

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    perform public.create_branch(jsonb_build_object('code', 'GERENTE-FAIL', 'name', 'Fail'));
    return query select 'gerente_cannot_manage_structure'::text, false, 'should fail'::text;
  exception when others then
    return query select 'gerente_cannot_manage_structure'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  begin
    perform public.create_finance_accounting_period(2026, 9);
    return query select 'gerente_cannot_manage_periods'::text, false, 'should fail'::text;
  exception when others then
    return query select 'gerente_cannot_manage_periods'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_row := public.create_finance_accounting_period(2026, 9);
  v_period := (v_row ->> 'id')::uuid;
  perform public.set_finance_accounting_period_status(v_period, 'closed');

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    perform public.reopen_finance_accounting_period(v_period, 'Autorización gerencia');
    return query select 'gerente_can_reopen_period'::text, true, 'reopen ok'::text;
  exception when others then
    return query select 'gerente_can_reopen_period'::text, false, sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.list_branches();
    return query select 'mesero_denied'::text, false, 'should fail'::text;
  exception when others then
    return query select 'mesero_denied'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_row := public.create_finance_chart_account(jsonb_build_object(
    'code', '4.01-AUDIT', 'name', 'Ventas audit', 'financial_type', 'income',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  ));
  return query select 'dimension_defaults_income'::text,
    (v_row ->> 'branch_dimension_rule') = 'required'
    and (v_row ->> 'cost_center_dimension_rule') = 'optional',
    coalesce(v_row ->> 'branch_dimension_rule', '') || '/' || coalesce(v_row ->> 'cost_center_dimension_rule', '');

  v_import := public.import_finance_chart_accounts(jsonb_build_array(
    jsonb_build_object(
      'codigo', '5-AUDIT', 'nombre', 'Gastos', 'codigo_padre', '', 'tipo_financiero', 'expense',
      'naturaleza', 'debit', 'tipo_cuenta', 'header', 'acepta_movimientos', 'false', 'descripcion', ''
    ),
    jsonb_build_object(
      'codigo', '5.01-AUDIT', 'nombre', 'Servicios', 'codigo_padre', '5-AUDIT', 'tipo_financiero', 'expense',
      'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true', 'descripcion', ''
    )
  ));
  return query select 'import_without_dimensions_uses_defaults'::text,
    exists(
      select 1 from public.finance_chart_accounts
      where code = '5.01-AUDIT'
        and branch_dimension_rule = 'required'
        and cost_center_dimension_rule = 'optional'
    ),
    coalesce(v_import ->> 'imported', '0');

  begin
    perform public.update_finance_chart_account(
      (select id from public.finance_chart_accounts where code = '4.01-AUDIT'),
      jsonb_build_object('branch_dimension_rule', 'invalid')
    );
    return query select 'dimension_rule_validation'::text, false, 'should fail'::text;
  exception when others then
    return query select 'dimension_rule_validation'::text, sqlerrm like '%inválida%', sqlerrm;
  end;

  return query select 'branches_no_delete_policy'::text,
    not exists(
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'branches' and cmd = 'DELETE'
    ),
    'no delete policy'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_finance_accounting_multibranch_foundation()
)
select
  r.scenario,
  r.passed,
  r.detail,
  count(*) over () as total,
  count(*) filter (where r.passed) over () as passed_total,
  count(*) filter (where not r.passed) over () as failed_total
from results r
order by r.passed asc, r.scenario;

drop function if exists public.test_finance_accounting_multibranch_foundation();

rollback;
