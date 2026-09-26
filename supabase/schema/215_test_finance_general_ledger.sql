-- Libro Mayor — SQL verification (NOT applied as a migration by the schema runner).
-- Run manually AFTER supabase/schema/215_finance_general_ledger.sql.
-- Uses BEGIN … ROLLBACK. Does not persist journal rows.

begin;

create or replace function public.gl_lab_post(
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

create or replace function public.test_finance_general_ledger_proposal()
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
  v_branch_b uuid;
  v_cc uuid;
  v_period uuid;
  v_debit uuid;
  v_credit uuid;
  v_contra uuid;
  v_sink uuid;
  v_scope uuid;
  v_equity uuid;
  v_old uuid;
  v_header uuid;
  v_search uuid;
  v_page uuid;
  v_order uuid;
  v_rev uuid;
  v_snap uuid;
  v_draft uuid;
  v_report jsonb;
  v_err text;
  v_posted_at timestamptz;
  v_entry uuid;
  v_draft_entry uuid;
begin
  select p.oid into v_fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_finance_general_ledger';

  return query select '01_compiles'::text, v_fn is not null, coalesce(v_fn::text, 'missing');

  return query select '02_signature'::text,
    pg_get_function_identity_arguments(v_fn) = 'p_account_id uuid, p_from_date date, p_to_date date, p_period_id uuid, p_branch_id uuid, p_cost_center_id uuid, p_search text, p_page integer, p_page_size integer, p_snapshot_at timestamp with time zone',
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
    (v_admin, 'Admin Mayor', 'admin_mayor', 'admin', 'active'),
    (v_mesero, 'Mesero Mayor', 'mesero_mayor', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_finance_general_ledger(null);
    return query select '06_rejects_without_permission'::text, false, 'unauthenticated succeeded'::text;
  exception when others then
    return query select '06_rejects_without_permission'::text, sqlerrm like '%autenticado%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_finance_general_ledger('00000000-0000-0000-0000-000000000001'::uuid);
    return query select '06b_operational_role'::text, false, 'mesero succeeded'::text;
  exception when others then
    return query select '06b_operational_role'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select id into v_branch from public.branches where code = 'PRINCIPAL';
  v_branch_b := (public.create_branch(jsonb_build_object('code', 'GL-SUC', 'name', 'Sucursal Mayor')) ->> 'id')::uuid;
  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'GL-CC', 'name', 'Centro Mayor', 'branch_id', v_branch::text
  )) ->> 'id')::uuid;
  v_period := (public.create_finance_accounting_period(2099, 12) ->> 'id')::uuid;
  perform public.create_finance_accounting_period(2099, 11);

  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-EQUITY', 'name', 'Capital laboratorio', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_debit := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-DEBIT', 'name', 'Caja deudora', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_credit := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-CREDIT', 'name', 'Pasivo acreedor', 'financial_type', 'liability',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_contra := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-CONTRA', 'name', 'Caja contraria', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_sink := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-SINK', 'name', 'Contrapartida', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_scope := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-SCOPE', 'name', 'Caja alcance', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_old := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-OLD', 'name', 'Caja historica', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_header := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-HEAD', 'name', 'Encabezado', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'header', 'accepts_entries', false
  )) ->> 'id')::uuid;
  v_search := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-SEARCH', 'name', 'Caja busqueda', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_page := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-PAGE', 'name', 'Caja paginas', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_order := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-ORDER', 'name', 'Caja orden', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_rev := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-REV', 'name', 'Caja reversion', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_snap := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-SNAP', 'name', 'Caja snapshot', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_draft := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'GL-DRAFT', 'name', 'Caja borrador', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  perform public.gl_lab_post('2099-12-15', 'Debe cien', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_debit::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)
  ));
  perform public.gl_lab_post('2099-12-16', 'Haber cuarenta', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_equity::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_debit::text, 'debit', 0, 'credit', 40)
  ));
  v_report := public.get_finance_general_ledger(v_debit, '2099-12-01', '2099-12-31', null, null, null, null, 1, 50, null);
  return query select '09_debit_nature'::text,
    (v_report ->> 'closing_balance')::numeric = 60
    and v_report ->> 'closing_balance_side' = 'debit'
    and (v_report ->> 'closing_contrary')::boolean = false
    and (v_report ->> 'period_debit')::numeric = 100
    and (v_report ->> 'period_credit')::numeric = 40,
    v_report ->> 'closing_balance';

  perform public.gl_lab_post('2099-12-17', 'Acreedor ochenta', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_sink::text, 'debit', 80, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_credit::text, 'debit', 0, 'credit', 80)
  ));
  v_report := public.get_finance_general_ledger(v_credit, null, null, null, null, null, null, 1, 50, null);
  return query select '10_credit_nature'::text,
    (v_report ->> 'closing_balance')::numeric = 80
    and v_report ->> 'closing_balance_side' = 'credit'
    and (v_report ->> 'closing_contrary')::boolean = false,
    (v_report ->> 'closing_balance') || ' ' || (v_report ->> 'closing_balance_side');

  perform public.gl_lab_post('2099-12-18', 'Saldo contrario', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_sink::text, 'debit', 15, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_contra::text, 'debit', 0, 'credit', 15)
  ));
  v_report := public.get_finance_general_ledger(v_contra, null, null, null, null, null, null, 1, 50, null);
  return query select '11_contrary_balance'::text,
    (v_report ->> 'closing_balance')::numeric = -15
    and v_report ->> 'closing_balance_side' = 'credit'
    and (v_report ->> 'closing_contrary')::boolean = true,
    (v_report ->> 'closing_balance') || ' ' || (v_report ->> 'closing_balance_side');

  perform public.gl_lab_post('2099-12-05', 'Historica', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_old::text, 'debit', 9, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 9)
  ));
  perform public.set_finance_chart_account_active(v_old, false);
  perform public.update_finance_chart_account(v_old, jsonb_build_object('accepts_entries', false));
  v_report := public.get_finance_general_ledger(v_old, null, null, null, null, null, null, 1, 50, null);
  return query select '12_inactive_detail'::text,
    (v_report -> 'account' ->> 'is_active')::boolean = false
    and (v_report -> 'account' ->> 'accepts_entries')::boolean = false
    and (v_report ->> 'movement_count')::int = 1
    and (v_report ->> 'closing_balance')::numeric = 9,
    v_report -> 'account' ->> 'is_active';

  begin
    perform public.get_finance_general_ledger(v_header, null, null, null, null, null, null, 1, 50, null);
    return query select '13_header_rejected'::text, false, 'header succeeded'::text;
  exception when others then
    return query select '13_header_rejected'::text, sqlerrm like '%cuentas de detalle%', sqlerrm;
  end;

  perform public.gl_lab_post('2099-11-20', 'Alcance previo A', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_scope::text, 'branch_id', v_branch::text, 'cost_center_id', v_cc::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 30)
  ));
  perform public.gl_lab_post('2099-11-21', 'Alcance previo B', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_scope::text, 'branch_id', v_branch_b::text, 'debit', 70, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 70)
  ));
  perform public.gl_lab_post('2099-12-20', 'Alcance rango A', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_scope::text, 'branch_id', v_branch::text, 'cost_center_id', v_cc::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 20)
  ));
  perform public.gl_lab_post('2099-12-21', 'Alcance rango B', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_scope::text, 'branch_id', v_branch_b::text, 'debit', 5, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 5)
  ));

  v_report := public.get_finance_general_ledger(
    v_scope, '2099-12-10', '2100-01-05', v_period, v_branch, v_cc, null, 1, 50, null
  );
  return query select '14_opening_before_effective_start'::text,
    v_report ->> 'effective_from' = '2099-12-10'
    and v_report ->> 'effective_to' = '2099-12-31'
    and (v_report ->> 'opening_balance')::numeric = 30,
    coalesce(v_report ->> 'opening_balance', 'null') || ' ' || coalesce(v_report ->> 'effective_from', 'null');

  return query select '15_period_date_intersection'::text,
    v_report ->> 'effective_from' = '2099-12-10' and v_report ->> 'effective_to' = '2099-12-31',
    coalesce(v_report ->> 'effective_from', '') || ' ' || coalesce(v_report ->> 'effective_to', '');

  begin
    perform public.get_finance_general_ledger(
      v_scope, '2100-01-01', '2100-01-15', v_period, null, null, null, 1, 50, null
    );
    return query select '16_empty_intersection'::text, false, 'empty intersection succeeded'::text;
  exception when others then
    return query select '16_empty_intersection'::text,
      sqlerrm = 'El periodo contable y el rango de fechas no se intersectan.',
      sqlerrm;
  end;

  return query select '17_dimensions_affect_opening_and_closing'::text,
    (v_report ->> 'opening_balance')::numeric = 30
    and (v_report ->> 'period_debit')::numeric = 20
    and (v_report ->> 'period_credit')::numeric = 0
    and (v_report ->> 'closing_balance')::numeric = 50
    and (v_report ->> 'movement_count')::int = 1
    and v_report ->> 'scope' = 'branch_and_cost_center',
    (v_report ->> 'opening_balance') || '/' || (v_report ->> 'period_debit') || '/' || (v_report ->> 'closing_balance');

  perform public.gl_lab_post('2099-12-11', 'Aporte visible', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_search::text, 'debit', 80, 'credit', 0, 'description', 'Visible unico'),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 80)
  ));
  perform public.gl_lab_post('2099-12-12', 'Gasto oculta', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_equity::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_search::text, 'debit', 0, 'credit', 30, 'description', 'Oculta libro')
  ));
  v_report := public.get_finance_general_ledger(v_search, null, null, null, null, null, 'oculta', 1, 50, null);
  return query select '18_search_keeps_real_balance'::text,
    (v_report ->> 'match_count')::int = 1
    and (v_report ->> 'movement_count')::int = 2
    and (v_report ->> 'period_debit')::numeric = 80
    and (v_report ->> 'period_credit')::numeric = 30
    and (v_report ->> 'closing_balance')::numeric = 50
    and (v_report -> 'rows' -> 0 ->> 'running_balance')::numeric = 50
    and (v_report ->> 'search_applied')::boolean = true,
    'match=' || (v_report ->> 'match_count') || ' move=' || (v_report ->> 'movement_count')
      || ' close=' || (v_report ->> 'closing_balance')
      || ' run=' || (v_report -> 'rows' -> 0 ->> 'running_balance');

  perform public.gl_lab_post('2099-12-01', 'Pagina uno', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  perform public.gl_lab_post('2099-12-02', 'Pagina dos', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  perform public.gl_lab_post('2099-12-03', 'Pagina tres', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_page::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  v_report := public.get_finance_general_ledger(v_page, null, null, null, null, null, null, 2, 1, null);
  return query select '19_page_running_balance'::text,
    (v_report -> 'rows' -> 0 ->> 'running_balance')::numeric = 20
    and (v_report ->> 'closing_balance')::numeric = 30
    and (v_report ->> 'page')::int = 2,
    coalesce(v_report -> 'rows' -> 0 ->> 'running_balance', 'null');

  perform public.gl_lab_post('2099-12-08', 'Orden', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_order::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_order::text, 'debit', 7, 'credit', 0),
    jsonb_build_object('line_number', 3, 'account_id', v_equity::text, 'debit', 0, 'credit', 17)
  ));
  v_report := public.get_finance_general_ledger(v_order, null, null, null, null, null, null, 1, 50, null);
  return query select '20_deterministic_order'::text,
    (v_report -> 'rows' -> 0 ->> 'line_number')::int = 1
    and (v_report -> 'rows' -> 1 ->> 'line_number')::int = 2
    and (v_report -> 'rows' -> 0 ->> 'running_balance')::numeric = 10
    and (v_report -> 'rows' -> 1 ->> 'running_balance')::numeric = 17
    and pg_get_functiondef(v_fn) like '%line_id asc%',
    coalesce(v_report -> 'rows' -> 0 ->> 'line_number', '0') || ' ' || coalesce(v_report -> 'rows' -> 1 ->> 'line_number', '0');

  v_entry := public.gl_lab_post('2099-12-09', 'Original reversible', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_rev::text, 'debit', 80, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 80)
  ));
  perform public.reverse_finance_journal_entry(v_entry, 'Reversion de laboratorio', '2099-12-10');
  v_report := public.get_finance_general_ledger(v_rev, null, null, null, null, null, null, 1, 50, null);
  return query select '21_reversal_separate'::text,
    (v_report ->> 'movement_count')::int = 2
    and (v_report -> 'rows' -> 1 ->> 'is_reversal')::boolean = true
    and (v_report ->> 'closing_balance')::numeric = 0
    and (v_report ->> 'period_debit')::numeric = 80
    and (v_report ->> 'period_credit')::numeric = 80,
    'moves=' || (v_report ->> 'movement_count') || ' close=' || (v_report ->> 'closing_balance');

  return query select '22_json_contract'::text,
    v_report ?& array[
      'account','scope','effective_from','effective_to','opening_balance','opening_balance_side','opening_contrary',
      'period_debit','period_credit','closing_balance','closing_balance_side','closing_contrary',
      'movement_count','match_count','search_applied','rows','page','page_size','total_pages','snapshot_at'
    ]
    and (v_report -> 'rows' -> 0) ?& array[
      'line_id','entry_id','entry_date','entry_number','debit','credit','running_balance',
      'balance_side','balance_side_label','contrary_to_nature','is_reversal'
    ],
    'keys-ok';

  v_entry := public.gl_lab_post('2099-12-22', 'Snapshot', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_snap::text, 'debit', 11, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 11)
  ));
  select posted_at into v_posted_at from public.finance_journal_entries where id = v_entry;
  v_report := public.get_finance_general_ledger(v_snap, null, null, null, null, null, null, 1, 50, v_posted_at - interval '1 second');
  return query select '08_snapshot_excludes_later_post'::text,
    (v_report ->> 'movement_count')::int = 0 and (v_report ->> 'closing_balance')::numeric = 0,
    coalesce(v_report ->> 'movement_count', 'null');
  v_report := public.get_finance_general_ledger(v_snap, null, null, null, null, null, null, 1, 50, v_posted_at);
  return query select '08b_snapshot_includes_exact_post'::text,
    (v_report ->> 'movement_count')::int = 1 and (v_report ->> 'closing_balance')::numeric = 11,
    coalesce(v_report ->> 'closing_balance', 'null');

  v_draft_entry := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2099-12-23', 'description', 'Solo borrador', 'reference', 'DRAFT'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_draft_entry, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_draft::text, 'debit', 4, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 4)
  ));
  v_report := public.get_finance_general_ledger(
    v_draft, null, null, null, null, null, null, 1, 50, null
  );
  return query select '07_posted_only'::text,
    (v_report ->> 'movement_count')::int = 0 and (v_report ->> 'closing_balance')::numeric = 0,
    coalesce(v_report ->> 'movement_count', 'null');

  begin
    perform public.get_finance_general_ledger(v_page, null, null, null, null, null, null, 9, 1, null);
    return query select '23_page_out_of_range'::text, false, 'page 9 succeeded'::text;
  exception when others then
    return query select '23_page_out_of_range'::text, sqlerrm = 'La página solicitada está fuera de rango.', sqlerrm;
  end;

  begin
    perform public.get_finance_general_ledger(v_page, null, null, null, null, null, null, 0, 50, null);
    return query select '23b_invalid_page'::text, false, 'page 0 succeeded'::text;
  exception when others then
    return query select '23b_invalid_page'::text, sqlerrm like '%página%', sqlerrm;
  end;

  begin
    perform public.get_finance_general_ledger(v_page, null, null, null, null, null, null, 1, 0, null);
    return query select '23c_invalid_page_size'::text, false, 'page size 0 succeeded'::text;
  exception when others then
    return query select '23c_invalid_page_size'::text, sqlerrm like '%tamaño de página%', sqlerrm;
  end;

  v_err := null;
exception when others then
  return query select 'unhandled'::text, false, sqlerrm;
end;
$$;

select scenario, passed, detail from public.test_finance_general_ledger_proposal();

rollback;
