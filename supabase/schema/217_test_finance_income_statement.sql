-- Estado de Resultados — SQL verification. BEGIN … ROLLBACK. Does not persist rows.

begin;

create or replace function public.is_lab_post(p_date date, p_description text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.finance_chart_accounts
  set branch_dimension_rule = 'optional',
      cost_center_dimension_rule = 'optional'
  where financial_type in ('income', 'cost', 'expense');

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

create or replace function public.test_finance_income_statement()
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
  v_cash uuid;
  v_equity uuid;
  v_income uuid;
  v_contra uuid;
  v_cogs uuid;
  v_sell uuid;
  v_admin_exp uuid;
  v_ooe uuid;
  v_oti uuid;
  v_ote uuid;
  v_tax uuid;
  v_zero uuid;
  v_old uuid;
  v_rev uuid;
  v_snap uuid;
  v_unc uuid;
  v_dim uuid;
  v_neg uuid;
  v_entry uuid;
  v_posted_at timestamptz;
  v_report jsonb;
  v_row jsonb;
  v_preview jsonb;
  v_created jsonb;
begin
  select p.oid into v_fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_finance_income_statement';

  return query select '01_compiles'::text, v_fn is not null, coalesce(v_fn::text, 'missing');
  return query select '02_signature'::text,
    pg_get_function_identity_arguments(v_fn) = 'p_from_date date, p_to_date date, p_period_id uuid, p_branch_id uuid, p_cost_center_id uuid, p_include_zero_accounts boolean, p_snapshot_at timestamp with time zone',
    pg_get_function_identity_arguments(v_fn);
  return query select '03_security'::text,
    (select p.prosecdef and coalesce(p.proconfig::text, '') like '%search_path=%' and coalesce(p.proconfig::text, '') not like '%search_path=public%'
     from pg_proc p where p.oid = v_fn),
    (select coalesce(p.proconfig::text, 'null') from pg_proc p where p.oid = v_fn);
  return query select '04_acl'::text,
    has_function_privilege('authenticated', v_fn, 'EXECUTE')
    and not has_function_privilege('public', v_fn, 'EXECUTE')
    and not has_function_privilege('anon', v_fn, 'EXECUTE')
    and not has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'auth=' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text;

  return query select '05_column'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_chart_accounts'
        and column_name = 'income_statement_section' and is_nullable = 'YES'
    ),
    'present';

  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin Resultados', 'admin_resultados', 'admin', 'active'),
    (v_mesero, 'Mesero Resultados', 'mesero_resultados', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_finance_income_statement();
    return query select '06_rejects_without_permission'::text, false, 'unauthenticated succeeded'::text;
  exception when others then
    return query select '06_rejects_without_permission'::text, sqlerrm like '%autenticado%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_finance_income_statement();
    return query select '06b_operational_role'::text, false, 'mesero succeeded'::text;
  exception when others then
    return query select '06b_operational_role'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_created := public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-PLAIN', 'name', 'Ingreso sin seccion', 'financial_type', 'income',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  ));
  return query select '07_create_without_section'::text,
    v_created ->> 'income_statement_section' is null
    and v_created ->> 'code' = 'IS-PLAIN',
    coalesce(v_created ->> 'income_statement_section', 'null');

  v_created := public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OI-TMP', 'name', 'Ingreso clasificado', 'financial_type', 'income',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true,
    'income_statement_section', 'Ingresos operativos'
  ));
  return query select '08_create_spanish_label'::text,
    v_created ->> 'income_statement_section' = 'operating_income',
    coalesce(v_created ->> 'income_statement_section', 'null');

  v_created := public.update_finance_chart_account((v_created ->> 'id')::uuid, jsonb_build_object(
    'name', 'Ingreso editado',
    'income_statement_section', 'other_income'
  ));
  return query select '09_update_section'::text,
    v_created ->> 'income_statement_section' = 'other_income'
    and v_created ->> 'name' = 'Ingreso editado',
    coalesce(v_created ->> 'income_statement_section', 'null');

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'IS-BAD', 'name', 'Combinacion invalida', 'financial_type', 'income',
      'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true,
      'income_statement_section', 'cost_of_sales'
    ));
    return query select '10_invalid_combination'::text, false, 'invalid combination succeeded'::text;
  exception when others then
    return query select '10_invalid_combination'::text, sqlerrm like '%no corresponde%', sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'IS-HEAD', 'name', 'Encabezado', 'financial_type', 'income',
      'natural_balance', 'credit', 'account_kind', 'header', 'accepts_entries', false,
      'income_statement_section', 'operating_income'
    ));
    return query select '11_header_rejects_section'::text, false, 'header section succeeded'::text;
  exception when others then
    return query select '11_header_rejects_section'::text, sqlerrm like '%acumuladoras%', sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'IS-ASSET', 'name', 'Activo con seccion', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
      'income_statement_section', 'operating_income'
    ));
    return query select '12_balance_rejects_section'::text, false, 'balance section succeeded'::text;
  exception when others then
    return query select '12_balance_rejects_section'::text, sqlerrm like '%balance%', sqlerrm;
  end;

  v_preview := public.preview_finance_chart_accounts_import(jsonb_build_array(
    jsonb_build_object('codigo', 'IS-IMP-A', 'nombre', 'Activo importado', 'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true'),
    jsonb_build_object('codigo', 'IS-IMP-B', 'nombre', 'Gasto sin seccion', 'tipo_financiero', 'expense', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true'),
    jsonb_build_object('codigo', 'IS-IMP-C', 'nombre', 'Costo etiquetado', 'tipo_financiero', 'cost', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true', 'seccion_resultados', 'Costo de ventas')
  ));
  return query select '13_import_warning_without_section'::text,
    (v_preview ->> 'blocking_errors')::boolean = false
    and (v_preview ->> 'warning_rows')::int = 1
    and (v_preview -> 'warnings' -> 0 ->> 'message') like '%incompleto%',
    coalesce(v_preview ->> 'warning_rows', 'null');

  v_preview := public.preview_finance_chart_accounts_import(jsonb_build_array(
    jsonb_build_object('codigo', 'IS-IMP-D', 'nombre', 'Seccion mala', 'tipo_financiero', 'expense', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true', 'seccion_resultados', 'no-existe')
  ));
  return query select '14_import_rejects_unknown'::text,
    (v_preview ->> 'blocking_errors')::boolean = true
    and (v_preview -> 'errors' -> 0 ->> 'message') like '%desconocida%',
    coalesce(v_preview -> 'errors' -> 0 ->> 'message', 'null');

  perform public.import_finance_chart_accounts(jsonb_build_array(
    jsonb_build_object('codigo', 'IS-IMP-A', 'nombre', 'Activo importado', 'tipo_financiero', 'asset', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true'),
    jsonb_build_object('codigo', 'IS-IMP-B', 'nombre', 'Gasto sin seccion', 'tipo_financiero', 'expense', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true'),
    jsonb_build_object('codigo', 'IS-IMP-C', 'nombre', 'Costo etiquetado', 'tipo_financiero', 'cost', 'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true', 'seccion_resultados', 'Costo de ventas')
  ));
  return query select '14b_import_stores_label'::text,
    (select income_statement_section from public.finance_chart_accounts where code = 'IS-IMP-C') = 'cost_of_sales'
    and (select income_statement_section from public.finance_chart_accounts where code = 'IS-IMP-B') is null
    and (select income_statement_section from public.finance_chart_accounts where code = 'IS-IMP-A') is null,
    coalesce((select income_statement_section from public.finance_chart_accounts where code = 'IS-IMP-C'), 'null');

  v_period := (public.create_finance_accounting_period(2099, 12) ->> 'id')::uuid;
  select id into v_branch from public.branches where code = 'PRINCIPAL';
  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'IS-CC', 'name', 'Centro resultados', 'branch_id', v_branch::text
  )) ->> 'id')::uuid;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-CASH', 'name', 'Caja resultados', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-EQ', 'name', 'Capital resultados', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_income := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OI', 'name', 'Ventas', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;
  v_contra := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-SC', 'name', 'Devoluciones', 'financial_type', 'income', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'sales_contra'
  )) ->> 'id')::uuid;
  v_cogs := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-COS', 'name', 'Costo', 'financial_type', 'cost', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'cost_of_sales'
  )) ->> 'id')::uuid;
  v_sell := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-SELL', 'name', 'Ventas gasto', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_selling'
  )) ->> 'id')::uuid;
  v_admin_exp := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-ADM', 'name', 'Administracion', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_admin'
  )) ->> 'id')::uuid;
  v_ooe := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OOE', 'name', 'Otros operativos', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_other'
  )) ->> 'id')::uuid;
  v_oti := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OTI', 'name', 'Otros ingresos', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'other_income'
  )) ->> 'id')::uuid;
  v_ote := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OTE', 'name', 'Otros gastos', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'other_expense'
  )) ->> 'id')::uuid;
  v_zero := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-ZERO', 'name', 'Ingreso en cero', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;

  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, null, null, false, null);
  return query select '15_tax_absent_is_complete'::text,
    (v_report ->> 'report_complete')::boolean
    and (v_report ->> 'income_tax_classified')::boolean = false
    and (v_report ->> 'income_tax_total')::numeric = 0
    and (v_report ->> 'net_income') is not null
    and v_report ->> 'warnings' like '%Sin cuentas de impuesto clasificadas%',
    coalesce(v_report ->> 'income_tax_total', 'null');

  v_tax := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-TAX', 'name', 'ISR', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'income_tax'
  )) ->> 'id')::uuid;

  perform public.is_lab_post('2099-12-10', 'Ventas', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_income::text, 'debit', 0, 'credit', 100)
  ));
  perform public.is_lab_post('2099-12-11', 'Devolucion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_contra::text, 'debit', 15, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 15)
  ));
  perform public.is_lab_post('2099-12-12', 'Costo', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cogs::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 40)
  ));
  perform public.is_lab_post('2099-12-13', 'Gasto venta', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_sell::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 10)
  ));
  perform public.is_lab_post('2099-12-13', 'Gasto admin', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_admin_exp::text, 'debit', 8, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 8)
  ));
  perform public.is_lab_post('2099-12-13', 'Gasto otro op', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_ooe::text, 'debit', 2, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 2)
  ));
  perform public.is_lab_post('2099-12-14', 'Otro ingreso', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 5, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_oti::text, 'debit', 0, 'credit', 5)
  ));
  perform public.is_lab_post('2099-12-14', 'Otro gasto', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_ote::text, 'debit', 3, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 3)
  ));
  perform public.is_lab_post('2099-12-15', 'Impuesto', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_tax::text, 'debit', 4, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 4)
  ));
  perform public.is_lab_post('2099-12-16', 'Ingreso contrario', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_income::text, 'debit', 12, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 12)
  ));

  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', v_period, null, null, false, null);
  return query select '16_formulas'::text,
    (v_report ->> 'report_complete')::boolean
    and (v_report ->> 'operating_income_total')::numeric = 88
    and (v_report ->> 'sales_contra_total')::numeric = 15
    and (v_report ->> 'net_revenue')::numeric = 73
    and (v_report ->> 'cost_of_sales_total')::numeric = 40
    and (v_report ->> 'gross_profit')::numeric = 33
    and (v_report ->> 'selling_expenses_total')::numeric = 10
    and (v_report ->> 'administrative_expenses_total')::numeric = 8
    and (v_report ->> 'other_operating_expenses_total')::numeric = 2
    and (v_report ->> 'operating_expenses_total')::numeric = 20
    and (v_report ->> 'operating_profit')::numeric = 13
    and (v_report ->> 'other_income_total')::numeric = 5
    and (v_report ->> 'other_expense_total')::numeric = 3
    and (v_report ->> 'other_result')::numeric = 2
    and (v_report ->> 'profit_before_tax')::numeric = 15
    and (v_report ->> 'income_tax_total')::numeric = 4
    and (v_report ->> 'classified_net_result')::numeric = 11
    and (v_report ->> 'net_income')::numeric = 11
    and v_report ->> 'net_result_label' = 'Utilidad neta'
    and jsonb_array_length(v_report -> 'sections') = 9,
    coalesce(v_report ->> 'net_income', 'null') || ' ' || coalesce(v_report ->> 'net_result_label', '');

  select value into v_row
  from jsonb_array_elements(v_report -> 'sections') value
  where value ->> 'key' = 'operating_income';
  return query select '17_contrary_income'::text,
    exists (
      select 1 from jsonb_array_elements(v_row -> 'accounts') account
      where account ->> 'code' = 'IS-OI'
        and (account ->> 'amount')::numeric = 88
        and (account ->> 'contrary')::boolean = false
    ),
    coalesce(v_row ->> 'subtotal', 'null');

  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, null, null, false, null);
  return query select '18_zero_hidden'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'sections') section,
      jsonb_array_elements(section -> 'accounts') account
      where account ->> 'code' = 'IS-ZERO'
    ),
    'hidden';
  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, null, null, true, null);
  return query select '19_zero_included'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'sections') section,
      jsonb_array_elements(section -> 'accounts') account
      where account ->> 'code' = 'IS-ZERO' and (account ->> 'amount')::numeric = 0
    )
    and (v_report ->> 'net_income')::numeric = 11,
    'shown';

  v_neg := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-NEG', 'name', 'Ingreso contrario neto', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2099-12-16', 'Saldo contrario', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_neg::text, 'debit', 1, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 1)
  ));
  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, null, null, false, null);
  select account into v_row
  from jsonb_array_elements(v_report -> 'sections') section,
  jsonb_array_elements(section -> 'accounts') account
  where account ->> 'code' = 'IS-NEG';
  return query select '17b_contrary_balance'::text,
    (v_row ->> 'amount')::numeric = -1
    and (v_row ->> 'contrary')::boolean = true,
    coalesce(v_row ->> 'amount', 'null');

  v_old := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-OLD', 'name', 'Gasto historico', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_admin'
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2099-12-17', 'Historico', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_old::text, 'debit', 1, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 1)
  ));
  perform public.set_finance_chart_account_active(v_old, false);
  v_report := public.get_finance_income_statement(null, null, null, null, null, false, null);
  return query select '20_inactive_history'::text,
    (v_report ->> 'administrative_expenses_total')::numeric = 9
    and exists (
      select 1 from jsonb_array_elements(v_report -> 'sections') section,
      jsonb_array_elements(section -> 'accounts') account
      where account ->> 'code' = 'IS-OLD' and (account ->> 'is_active')::boolean = false
    ),
    coalesce(v_report ->> 'administrative_expenses_total', 'null');

  v_rev := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-REV', 'name', 'Ingreso reversion', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;
  v_entry := public.is_lab_post('2099-12-18', 'Reversion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 6, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_rev::text, 'debit', 0, 'credit', 6)
  ));
  perform public.reverse_finance_journal_entry(v_entry, 'Reversion de laboratorio', '2099-12-18');
  v_report := public.get_finance_income_statement(null, null, null, null, null, false, null);
  select account into v_row
  from jsonb_array_elements(v_report -> 'sections') section,
  jsonb_array_elements(section -> 'accounts') account
  where account ->> 'code' = 'IS-REV';
  return query select '21_reversal'::text,
    (v_row ->> 'movement_count')::int = 2
    and (v_row ->> 'period_debit')::numeric = 6
    and (v_row ->> 'period_credit')::numeric = 6
    and (v_row ->> 'amount')::numeric = 0,
    coalesce(v_row ->> 'movement_count', 'null');

  v_snap := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-SNAP', 'name', 'Ingreso snapshot', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;
  v_entry := public.is_lab_post('2099-12-19', 'Snapshot', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 9, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_snap::text, 'debit', 0, 'credit', 9)
  ));
  select posted_at into v_posted_at from public.finance_journal_entries where id = v_entry;
  v_report := public.get_finance_income_statement(null, null, null, null, null, false, v_posted_at - interval '1 second');
  return query select '22_snapshot_excludes'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'sections') section,
      jsonb_array_elements(section -> 'accounts') account
      where account ->> 'code' = 'IS-SNAP'
    ),
    'excluded';

  v_entry := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2099-12-20', 'description', 'Borrador', 'reference', 'BORRADOR'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 4, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_income::text, 'debit', 0, 'credit', 4)
  ));
  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, null, null, false, null);
  return query select '23_posted_only'::text,
    (v_report ->> 'operating_income_total')::numeric = 96,
    coalesce(v_report ->> 'operating_income_total', 'null');

  begin
    perform public.get_finance_income_statement('2100-01-01', '2100-01-15', v_period, null, null, false, null);
    return query select '24_empty_intersection'::text, false, 'intersection succeeded'::text;
  exception when others then
    return query select '24_empty_intersection'::text,
      sqlerrm = 'El periodo contable y el rango de fechas no se intersectan.', sqlerrm;
  end;
  begin
    perform public.get_finance_income_statement('2099-12-31', '2099-12-01', null, null, null, false, null);
    return query select '25_date_order'::text, false, 'inverted succeeded'::text;
  exception when others then
    return query select '25_date_order'::text,
      sqlerrm = 'La fecha desde no puede ser posterior a la fecha hasta.', sqlerrm;
  end;

  v_dim := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-DIM', 'name', 'Gasto sucursal', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_selling'
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2099-12-21', 'Dimension', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_dim::text, 'branch_id', v_branch::text, 'cost_center_id', v_cc::text, 'debit', 9, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 9)
  ));
  v_report := public.get_finance_income_statement('2099-12-01', '2099-12-31', null, v_branch, v_cc, false, null);
  return query select '26_dimension_scope'::text,
    v_report ->> 'scope' = 'branch_and_cost_center'
    and (v_report ->> 'selling_expenses_total')::numeric = 9
    and (v_report ->> 'operating_income_total')::numeric = 0
    and (v_report ->> 'report_complete')::boolean
    and (v_report ->> 'net_income')::numeric = -9
    and v_report ->> 'net_result_label' = 'Pérdida neta',
    coalesce(v_report ->> 'net_income', 'null') || ' ' || coalesce(v_report ->> 'net_result_label', '');

  v_unc := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-UNC', 'name', 'Gasto sin clasificar', 'financial_type', 'expense',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2099-12-22', 'Sin seccion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_unc::text, 'debit', 7, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 7)
  ));
  v_report := public.get_finance_income_statement(null, null, null, null, null, false, null);
  return query select '27_incomplete'::text,
    (v_report ->> 'report_complete')::boolean = false
    and v_report -> 'net_income' = 'null'::jsonb
    and (v_report ->> 'classified_net_result') is not null
    and (v_report ->> 'unclassified_account_count')::int >= 1
    and (v_report ->> 'unclassified_debit')::numeric = 7
    and (v_report ->> 'unclassified_credit')::numeric = 0
    and (v_report ->> 'unclassified_net_movement')::numeric = 7
    and v_report ->> 'net_result_label' = 'Resultado provisional de cuentas clasificadas'
    and exists (
      select 1 from jsonb_array_elements(v_report -> 'unclassified_accounts') account
      where account ->> 'code' = 'IS-UNC'
    ),
    coalesce(v_report ->> 'net_income', 'json-null') || ' ' || coalesce(v_report ->> 'classified_net_result', '');

  v_unc := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'IS-KEEP', 'name', 'Gasto conservar', 'financial_type', 'expense',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'income_statement_section', 'operating_expense_admin'
  )) ->> 'id')::uuid;
  v_created := public.update_finance_chart_account(v_unc, jsonb_build_object('name', 'Gasto renombrado'));
  return query select '30_omit_keeps_section'::text,
    v_created ->> 'income_statement_section' = 'operating_expense_admin'
    and v_created ->> 'name' = 'Gasto renombrado',
    coalesce(v_created ->> 'income_statement_section', 'null');

  v_created := public.update_finance_chart_account(v_unc, jsonb_build_object(
    'income_statement_section', 'other_expense'
  ));
  return query select '31_assign_section'::text,
    v_created ->> 'income_statement_section' = 'other_expense',
    coalesce(v_created ->> 'income_statement_section', 'null');

  v_created := public.update_finance_chart_account(v_unc, jsonb_build_object(
    'income_statement_section', ''
  ));
  return query select '32b_blank_clears_section'::text,
    v_created ->> 'income_statement_section' is null,
    coalesce(v_created ->> 'income_statement_section', 'null');

  perform public.update_finance_chart_account(v_unc, jsonb_build_object(
    'income_statement_section', 'operating_expense_admin'
  ));
  v_created := public.update_finance_chart_account(
    v_unc,
    jsonb_build_object('name', 'Gasto limpio') || jsonb_build_object('income_statement_section', null)
  );
  return query select '32_null_clears_section'::text,
    (v_created -> 'income_statement_section') = 'null'::jsonb
    and v_created ->> 'name' = 'Gasto limpio',
    coalesce(v_created ->> 'income_statement_section', 'json-null');

  perform public.create_finance_accounting_period(2098, 6);
  perform public.is_lab_post('2098-06-15', 'QA sin seccion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_unc::text, 'debit', 5, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 5)
  ));
  v_report := public.get_finance_income_statement('2098-06-01', '2098-06-30', null, null, null, false, null);
  return query select '33_cleared_movement_incomplete'::text,
    (v_report ->> 'report_complete')::boolean = false
    and v_report -> 'net_income' = 'null'::jsonb
    and (v_report ->> 'unclassified_debit')::numeric = 5
    and (v_report ->> 'unclassified_account_count')::int = 1
    and exists (
      select 1 from jsonb_array_elements(v_report -> 'unclassified_accounts') account
      where account ->> 'code' = 'IS-KEEP'
    ),
    coalesce(v_report ->> 'net_result_label', 'null');

  perform public.update_finance_chart_account(v_unc, jsonb_build_object(
    'income_statement_section', 'operating_expense_admin'
  ));
  v_report := public.get_finance_income_statement('2098-06-01', '2098-06-30', null, null, null, false, null);
  return query select '34_reclassify_restores_complete'::text,
    (v_report ->> 'report_complete')::boolean
    and (v_report ->> 'net_income')::numeric = -5
    and (v_report ->> 'administrative_expenses_total')::numeric = 5
    and (v_report ->> 'unclassified_account_count')::int = 0,
    coalesce(v_report ->> 'net_income', 'null') || ' ' || coalesce(v_report ->> 'net_result_label', '');

  insert into public.finance_chart_accounts (
    code, name, level, financial_type, natural_balance, account_kind, accepts_entries,
    branch_dimension_rule, cost_center_dimension_rule, income_statement_section, description
  )
  select
    'IS-LIM-' || lpad(g::text, 4, '0'),
    'Limite',
    1,
    'income',
    'credit',
    'detail',
    true,
    'required',
    'optional',
    'operating_income',
    ''
  from generate_series(1, 2001) g;

  begin
    perform public.get_finance_income_statement(null, null, null, null, null, true, null);
    return query select '28_limit'::text, false, 'limit succeeded'::text;
  exception when others then
    return query select '28_limit'::text, sqlerrm like '%2000%', sqlerrm;
  end;

  return query select '29_reports_remain'::text,
    to_regprocedure('public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_trial_balance(date,date,uuid,uuid,uuid,text,boolean,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.create_finance_chart_account(jsonb)') is not null,
    'present';

exception when others then
  return query select 'unhandled'::text, false, sqlerrm;
end;
$$;

select scenario, passed, detail from public.test_finance_income_statement();

rollback;
