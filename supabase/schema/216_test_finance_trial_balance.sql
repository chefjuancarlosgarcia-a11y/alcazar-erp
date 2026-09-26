-- Balanza de Comprobación — SQL verification.
-- Run manually AFTER supabase/schema/216_finance_trial_balance.sql.
-- Uses BEGIN … ROLLBACK. Does not persist journal rows.

begin;

create or replace function public.tb_lab_post(
  p_date date,
  p_description text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  v_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', to_char(p_date, 'YYYY-MM-DD'),
    'description', p_description,
    'reference', left(p_description, 40)
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_id, p_lines);
  perform public.submit_finance_journal_entry(v_id);
  perform public.approve_finance_journal_entry(v_id);
  perform public.post_finance_journal_entry(v_id);
  return v_id;
end;
$$;

create or replace function public.test_finance_trial_balance()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_mesero uuid := '22222222-2222-2222-2222-222222222222';
  v_fn oid;
  v_branch uuid;
  v_cc uuid;
  v_period uuid;
  v_debit uuid;
  v_credit uuid;
  v_equity uuid;
  v_zero uuid;
  v_open uuid;
  v_contra uuid;
  v_sink uuid;
  v_scope uuid;
  v_header uuid;
  v_old uuid;
  v_page_a uuid;
  v_page_b uuid;
  v_page_c uuid;
  v_rev uuid;
  v_snap uuid;
  v_draft uuid;
  v_report jsonb;
  v_row jsonb;
  v_entry uuid;
  v_posted_at timestamptz;
begin
  select p.oid into v_fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_finance_trial_balance';

  return query select '01_compiles'::text, v_fn is not null, coalesce(v_fn::text, 'missing');

  return query select '02_signature'::text,
    pg_get_function_identity_arguments(v_fn) = 'p_from_date date, p_to_date date, p_period_id uuid, p_branch_id uuid, p_cost_center_id uuid, p_search text, p_include_zero_accounts boolean, p_page integer, p_page_size integer, p_snapshot_at timestamp with time zone',
    pg_get_function_identity_arguments(v_fn);

  return query select '03_security'::text,
    (select p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and coalesce(p.proconfig::text, '') not like '%search_path=public%'
     from pg_proc p where p.oid = v_fn),
    (select coalesce(p.proconfig::text, 'null') from pg_proc p where p.oid = v_fn);

  return query select '04_no_public_anon'::text,
    not has_function_privilege('public', v_fn, 'EXECUTE')
    and not has_function_privilege('anon', v_fn, 'EXECUTE'),
    'public=' || has_function_privilege('public', v_fn, 'EXECUTE')::text
      || ' anon=' || has_function_privilege('anon', v_fn, 'EXECUTE')::text;

  return query select '05_authenticated_execute'::text,
    has_function_privilege('authenticated', v_fn, 'EXECUTE'),
    has_function_privilege('authenticated', v_fn, 'EXECUTE')::text;

  return query select '05b_no_service_role'::text,
    not has_function_privilege('service_role', v_fn, 'EXECUTE'),
    has_function_privilege('service_role', v_fn, 'EXECUTE')::text;

  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin Balanza', 'admin_balanza', 'admin', 'active'),
    (v_mesero, 'Mesero Balanza', 'mesero_balanza', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_finance_trial_balance();
    return query select '06_rejects_without_permission'::text, false, 'unauthenticated succeeded'::text;
  exception when others then
    return query select '06_rejects_without_permission'::text, sqlerrm like '%autenticado%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_finance_trial_balance();
    return query select '06b_operational_role'::text, false, 'mesero succeeded'::text;
  exception when others then
    return query select '06b_operational_role'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select id into v_branch from public.branches where code = 'PRINCIPAL';
  perform public.create_finance_accounting_period(2099, 11);
  v_period := (public.create_finance_accounting_period(2099, 12) ->> 'id')::uuid;

  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-EQUITY', 'name', 'Capital balanza', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_debit := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-DEBIT', 'name', 'Caja deudora', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_credit := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-CREDIT', 'name', 'Pasivo acreedor', 'financial_type', 'liability',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_zero := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-ZERO', 'name', 'Cuenta en cero', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  perform public.tb_lab_post('2099-12-15', 'Par cuadrado', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_debit::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_credit::text, 'debit', 0, 'credit', 100)
  ));

  v_report := public.get_finance_trial_balance('2099-12-01', '2099-12-31', null, null, null, null, false, 1, 50, null);
  return query select '26_global_square'::text,
    (v_report ->> 'is_square')::boolean
    and (v_report ->> 'period_debit_total')::numeric = 100
    and (v_report ->> 'period_credit_total')::numeric = 100
    and (v_report ->> 'period_difference')::numeric = 0
    and (v_report ->> 'closing_difference')::numeric = 0,
    coalesce(v_report ->> 'period_difference', 'null') || ' square=' || coalesce(v_report ->> 'is_square', 'null');

  v_row := v_report -> 'rows' -> 0;
  -- find debit row
  select value into v_row
  from jsonb_array_elements(v_report -> 'rows') value
  where value ->> 'code' = 'TB-DEBIT';
  return query select '09_debit_nature'::text,
    (v_row ->> 'closing_debit')::numeric = 100
    and (v_row ->> 'closing_credit')::numeric = 0
    and (v_row ->> 'period_debit')::numeric = 100
    and (v_row ->> 'period_credit')::numeric = 0
    and (v_row ->> 'closing_contrary')::boolean = false,
    coalesce(v_row ->> 'closing_debit', 'null');

  select value into v_row
  from jsonb_array_elements(v_report -> 'rows') value
  where value ->> 'code' = 'TB-CREDIT';
  return query select '10_credit_nature'::text,
    (v_row ->> 'closing_credit')::numeric = 100
    and (v_row ->> 'closing_debit')::numeric = 0
    and (v_row ->> 'natural_balance') = 'credit',
    coalesce(v_row ->> 'closing_credit', 'null');

  return query select '24_zero_hidden'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') value
      where value ->> 'code' = 'TB-ZERO'
    ),
    'hidden';

  v_report := public.get_finance_trial_balance('2099-12-01', '2099-12-31', null, null, null, null, true, 1, 50, null);
  return query select '25_zero_included'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') value
      where value ->> 'code' = 'TB-ZERO'
        and (value ->> 'opening_debit')::numeric = 0
        and (value ->> 'closing_debit')::numeric = 0
        and (value ->> 'movement_count')::int = 0
    ),
    'shown';

  v_report := public.get_finance_trial_balance('2099-12-01', '2099-12-31', null, null, null, 'TB-DEBIT', false, 1, 50, null);
  return query select '18_search_keeps_control_totals'::text,
    (v_report ->> 'search_applied')::boolean
    and (v_report ->> 'match_count')::int = 1
    and (v_report ->> 'account_count')::int = 2
    and (v_report ->> 'period_debit_total')::numeric = 100
    and (v_report ->> 'period_credit_total')::numeric = 100
    and (v_report -> 'rows' -> 0 ->> 'code') = 'TB-DEBIT',
    coalesce(v_report ->> 'match_count', 'null') || '/' || coalesce(v_report ->> 'account_count', 'null')
      || ' debit=' || coalesce(v_report ->> 'period_debit_total', 'null');

  v_open := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-OPEN', 'name', 'Caja apertura', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.tb_lab_post('2099-11-20', 'Apertura', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_open::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 30)
  ));
  v_report := public.get_finance_trial_balance('2099-12-10', '2100-01-05', v_period, null, null, 'TB-OPEN', false, 1, 50, null);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-OPEN';
  return query select '14_opening_before_effective_start'::text,
    v_report ->> 'effective_from' = '2099-12-10'
    and v_report ->> 'effective_to' = '2099-12-31'
    and (v_row ->> 'opening_debit')::numeric = 30
    and (v_row ->> 'opening_credit')::numeric = 0
    and (v_row ->> 'period_debit')::numeric = 0
    and (v_row ->> 'closing_debit')::numeric = 30
    and (v_row ->> 'movement_count')::int = 0,
    coalesce(v_row ->> 'opening_debit', 'null') || ' ' || coalesce(v_report ->> 'effective_from', 'null');

  return query select '15_period_date_intersection'::text,
    v_report ->> 'effective_from' = '2099-12-10' and v_report ->> 'effective_to' = '2099-12-31',
    coalesce(v_report ->> 'effective_from', '') || ' ' || coalesce(v_report ->> 'effective_to', '');

  begin
    perform public.get_finance_trial_balance('2100-01-01', '2100-01-15', v_period, null, null, null, false, 1, 50, null);
    return query select '16_empty_intersection'::text, false, 'intersection succeeded'::text;
  exception when others then
    return query select '16_empty_intersection'::text,
      sqlerrm = 'El periodo contable y el rango de fechas no se intersectan.', sqlerrm;
  end;

  begin
    perform public.get_finance_trial_balance('2099-12-31', '2099-12-01', null, null, null, null, false, 1, 50, null);
    return query select '16b_date_order'::text, false, 'inverted dates succeeded'::text;
  exception when others then
    return query select '16b_date_order'::text,
      sqlerrm = 'La fecha desde no puede ser posterior a la fecha hasta.', sqlerrm;
  end;

  v_contra := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-CONTRA', 'name', 'Caja contraria', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_sink := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-SINK', 'name', 'Contrapartida', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.tb_lab_post('2099-12-18', 'Saldo contrario', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_sink::text, 'debit', 15, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_contra::text, 'debit', 0, 'credit', 15)
  ));
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-CONTRA', false, 1, 50, null);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-CONTRA';
  return query select '11_contrary_balance'::text,
    (v_row ->> 'closing_debit')::numeric = 0
    and (v_row ->> 'closing_credit')::numeric = 15
    and (v_row ->> 'closing_contrary')::boolean = true
    and (v_row ->> 'period_debit')::numeric = 0
    and (v_row ->> 'period_credit')::numeric = 15,
    coalesce(v_row ->> 'closing_credit', 'null') || ' contrary=' || coalesce(v_row ->> 'closing_contrary', 'null');

  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'TB-CC', 'name', 'Centro balanza', 'branch_id', v_branch::text
  )) ->> 'id')::uuid;
  v_scope := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-SCOPE', 'name', 'Caja alcance', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.tb_lab_post('2099-12-20', 'Alcance sucursal', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_scope::text, 'branch_id', v_branch::text, 'cost_center_id', v_cc::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 40)
  ));
  v_report := public.get_finance_trial_balance('2099-12-01', '2099-12-31', null, v_branch, v_cc, null, false, 1, 50, null);
  return query select '17_dimensions_can_unbalance'::text,
    v_report ->> 'scope' = 'branch_and_cost_center'
    and (v_report ->> 'is_square')::boolean = false
    and (v_report ->> 'period_debit_total')::numeric = 40
    and (v_report ->> 'period_credit_total')::numeric = 0
    and (v_report ->> 'period_difference')::numeric = 40,
    coalesce(v_report ->> 'period_difference', 'null') || ' square=' || coalesce(v_report ->> 'is_square', 'null');

  v_old := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-OLD', 'name', 'Caja historica', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.tb_lab_post('2099-12-05', 'Historica', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_old::text, 'debit', 9, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 9)
  ));
  perform public.set_finance_chart_account_active(v_old, false);
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-OLD', false, 1, 50, null);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-OLD';
  return query select '12_inactive_detail'::text,
    (v_row ->> 'is_active')::boolean = false
    and (v_row ->> 'closing_debit')::numeric = 9
    and (v_row ->> 'movement_count')::int = 1,
    coalesce(v_row ->> 'is_active', 'null');

  v_header := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-HEAD', 'name', 'Encabezado', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'header', 'accepts_entries', false
  )) ->> 'id')::uuid;
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-HEAD', true, 1, 50, null);
  return query select '13_header_excluded'::text,
    (v_report ->> 'match_count')::int = 0,
    coalesce(v_report ->> 'match_count', 'null');

  v_page_a := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-P1', 'name', 'Pagina uno', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_page_b := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-P2', 'name', 'Pagina dos', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_page_c := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-P3', 'name', 'Pagina tres', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.tb_lab_post('2099-12-21', 'Pagina', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page_a::text, 'debit', 1, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 1)
  ));
  perform public.tb_lab_post('2099-12-21', 'Pagina b', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page_b::text, 'debit', 1, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 1)
  ));
  perform public.tb_lab_post('2099-12-21', 'Pagina c', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page_c::text, 'debit', 1, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 1)
  ));
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-P', false, 2, 1, null);
  return query select '19_pagination'::text,
    (v_report ->> 'page')::int = 2
    and (v_report ->> 'match_count')::int = 3
    and (v_report ->> 'total_pages')::int = 3
    and (v_report -> 'rows' -> 0 ->> 'code') = 'TB-P2'
    and (v_report ->> 'account_count')::int > 3,
    coalesce(v_report -> 'rows' -> 0 ->> 'code', 'null');

  v_rev := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-REV', 'name', 'Caja reversion', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_entry := public.tb_lab_post('2099-12-22', 'Reversion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_rev::text, 'debit', 80, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 80)
  ));
  perform public.reverse_finance_journal_entry(v_entry, 'Reversion de laboratorio', '2099-12-22');
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-REV', false, 1, 50, null);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-REV';
  return query select '21_reversal_separate'::text,
    (v_row ->> 'movement_count')::int = 2
    and (v_row ->> 'period_debit')::numeric = 80
    and (v_row ->> 'period_credit')::numeric = 80
    and (v_row ->> 'closing_debit')::numeric = 0
    and (v_row ->> 'closing_credit')::numeric = 0,
    coalesce(v_row ->> 'movement_count', 'null') || ' d=' || coalesce(v_row ->> 'period_debit', 'null');

  v_snap := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-SNAP', 'name', 'Caja snapshot', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_entry := public.tb_lab_post('2099-12-23', 'Snapshot', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_snap::text, 'debit', 11, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 11)
  ));
  select posted_at into v_posted_at from public.finance_journal_entries where id = v_entry;
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-SNAP', false, 1, 50, v_posted_at - interval '1 second');
  return query select '08_snapshot_excludes_later_post'::text,
    (v_report ->> 'match_count')::int = 0,
    coalesce(v_report ->> 'match_count', 'null');
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-SNAP', false, 1, 50, v_posted_at);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-SNAP';
  return query select '08b_snapshot_includes_exact_post'::text,
    (v_row ->> 'closing_debit')::numeric = 11,
    coalesce(v_row ->> 'closing_debit', 'null');

  v_draft := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'TB-DRAFT', 'name', 'Caja borrador', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_entry := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2099-12-24',
    'description', 'Solo borrador',
    'reference', 'BORRADOR'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_draft::text, 'debit', 7, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 7)
  ));
  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-DRAFT', true, 1, 50, null);
  select value into v_row from jsonb_array_elements(v_report -> 'rows') value where value ->> 'code' = 'TB-DRAFT';
  return query select '07_posted_only'::text,
    (v_row ->> 'movement_count')::int = 0
    and (v_row ->> 'closing_debit')::numeric = 0,
    coalesce(v_row ->> 'movement_count', 'null');

  v_report := public.get_finance_trial_balance(null, null, null, null, null, 'TB-DEBIT', false, 1, 50, null);
  return query select '22_json_contract'::text,
    v_report ? 'opening_debit_total'
    and v_report ? 'is_square'
    and v_report ? 'snapshot_at'
    and v_report -> 'rows' -> 0 ? 'parent_id'
    and v_report -> 'rows' -> 0 ? 'opening_contrary'
    and v_report -> 'rows' -> 0 ? 'movement_count',
    'keys-ok';

  begin
    perform public.get_finance_trial_balance(null, null, null, null, null, 'TB-DEBIT', false, 9, 1, null);
    return query select '23_page_out_of_range'::text, false, 'page 9 succeeded'::text;
  exception when others then
    return query select '23_page_out_of_range'::text, sqlerrm = 'La página solicitada está fuera de rango.', sqlerrm;
  end;

  begin
    perform public.get_finance_trial_balance(null, null, null, null, null, null, false, 0, 50, null);
    return query select '23b_invalid_page'::text, false, 'page 0 succeeded'::text;
  exception when others then
    return query select '23b_invalid_page'::text, sqlerrm like '%página%', sqlerrm;
  end;

  begin
    perform public.get_finance_trial_balance(null, null, null, null, null, null, false, 1, 0, null);
    return query select '23c_invalid_page_size'::text, false, 'page size 0 succeeded'::text;
  exception when others then
    return query select '23c_invalid_page_size'::text, sqlerrm like '%tamaño de página%', sqlerrm;
  end;

  return query select '29_journal_and_ledger_remain'::text,
    to_regprocedure('public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null,
    'present';

exception when others then
  return query select 'unhandled'::text, false, sqlerrm;
end;
$$;

select scenario, passed, detail from public.test_finance_trial_balance();

rollback;
