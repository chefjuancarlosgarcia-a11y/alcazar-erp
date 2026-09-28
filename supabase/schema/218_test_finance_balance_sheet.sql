-- Balance General — SQL verification. BEGIN … ROLLBACK. Does not persist rows.

begin;

create or replace function public.is_lab_post(p_date date, p_description text, p_lines jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_branch uuid := nullif(current_setting('alcazar.bs_lab_branch', true), '')::uuid;
  v_lines jsonb;
begin
  if v_branch is null then
    raise exception 'La sucursal del laboratorio no está configurada.';
  end if;

  update public.finance_chart_accounts
  set branch_dimension_rule = case
        when branch_dimension_rule = 'prohibited' then 'optional'
        else branch_dimension_rule
      end,
      cost_center_dimension_rule = case
        when cost_center_dimension_rule = 'prohibited' then 'optional'
        else cost_center_dimension_rule
      end
  where id in (
    select (elem ->> 'account_id')::uuid
    from jsonb_array_elements(p_lines) elem
  );

  select coalesce(jsonb_agg(
    case
      when nullif(elem ->> 'branch_id', '') is not null then elem
      else elem || jsonb_build_object('branch_id', v_branch::text)
    end
    order by (elem ->> 'line_number')::int
  ), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(p_lines) elem;

  v_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', to_char(p_date, 'YYYY-MM-DD'),
    'description', p_description,
    'reference', left(p_description, 40)
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_id, v_lines);
  perform public.submit_finance_journal_entry(v_id);
  perform public.approve_finance_journal_entry(v_id);
  perform public.post_finance_journal_entry(v_id);
  return v_id;
end;
$$;

create or replace function public.bs_lab_account(p_report jsonb, p_code text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select account
  from (
    select account
    from jsonb_array_elements(p_report -> 'sections') section,
         jsonb_array_elements(section -> 'accounts') account
    union all
    select account
    from jsonb_array_elements(coalesce(p_report -> 'unclassified_accounts', '[]'::jsonb)) account
  ) found(account)
  where account ->> 'code' = p_code
  limit 1;
$$;

create or replace function public.test_finance_balance_sheet()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_admin uuid := '11111111-1111-1111-1111-111111111111';
  v_mesero uuid := '22222222-2222-2222-2222-222222222222';
  v_fn oid;
  v_classifier oid;
  v_branch uuid;
  v_dim_branch uuid;
  v_cc uuid;
  v_cash uuid;
  v_equip uuid;
  v_dep uuid;
  v_cap uuid;
  v_re uuid;
  v_income uuid;
  v_expense uuid;
  v_unc_pnl uuid;
  v_unc_asset uuid;
  v_zero_unclass uuid;
  v_zero_class uuid;
  v_future uuid;
  v_old uuid;
  v_rev uuid;
  v_snap uuid;
  v_dim_asset uuid;
  v_dim_equity uuid;
  v_keep uuid;
  v_entry uuid;
  v_posted_at timestamptz;
  v_report jsonb;
  v_row jsonb;
  v_preview jsonb;
  v_created jsonb;
  v_i int;
begin
  select p.oid into v_fn
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_finance_balance_sheet';
  select p.oid into v_classifier
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'finance_chart_account_classify_balance_sheet_section';

  return query select '01_compiles'::text, v_fn is not null and v_classifier is not null, coalesce(v_fn::text, 'missing');
  return query select '02_signature'::text,
    pg_get_function_identity_arguments(v_fn) = 'p_cutoff_date date, p_branch_id uuid, p_cost_center_id uuid, p_include_zero_accounts boolean, p_snapshot_at timestamp with time zone',
    pg_get_function_identity_arguments(v_fn);
  return query select '03_security'::text,
    (
      select p.prosecdef and p.provolatile = 's'
        and coalesce(p.proconfig::text, '') like '%search_path=%'
        and coalesce(p.proconfig::text, '') not like '%search_path=public%'
      from pg_proc p where p.oid = v_fn
    ),
    (select coalesce(p.proconfig::text, 'null') from pg_proc p where p.oid = v_fn);
  return query select '04_acl'::text,
    has_function_privilege('authenticated', v_fn, 'EXECUTE')
    and not has_function_privilege('public', v_fn, 'EXECUTE')
    and not has_function_privilege('anon', v_fn, 'EXECUTE')
    and not has_function_privilege('service_role', v_fn, 'EXECUTE'),
    'auth=' || has_function_privilege('authenticated', v_fn, 'EXECUTE')::text;
  return query select '04b_classifier_not_executable'::text,
    not has_function_privilege('public', v_classifier, 'EXECUTE')
    and not has_function_privilege('anon', v_classifier, 'EXECUTE')
    and not has_function_privilege('authenticated', v_classifier, 'EXECUTE')
    and not has_function_privilege('service_role', v_classifier, 'EXECUTE'),
    'auth=' || has_function_privilege('authenticated', v_classifier, 'EXECUTE')::text;
  return query select '05_column'::text,
    exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'finance_chart_accounts'
        and column_name = 'balance_sheet_section' and is_nullable = 'YES'
    ),
    'present';

  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin Balance', 'admin_balance', 'admin', 'active'),
    (v_mesero, 'Mesero Balance', 'mesero_balance', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_finance_balance_sheet('2097-04-30', null, null, false, null);
    return query select '06_rejects_without_permission'::text, false, 'unauthenticated succeeded'::text;
  exception when others then
    return query select '06_rejects_without_permission'::text, sqlerrm like '%autenticado%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_finance_balance_sheet('2097-04-30', null, null, false, null);
    return query select '06b_operational_role'::text, false, 'mesero succeeded'::text;
  exception when others then
    return query select '06b_operational_role'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  v_created := public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-PLAIN', 'name', 'Activo sin seccion', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  ));
  return query select '07_create_without_section'::text,
    v_created ->> 'balance_sheet_section' is null
    and v_created ->> 'income_statement_section' is null,
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  v_created := public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-CA', 'name', 'Caja etiqueta', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'Activo corriente'
  ));
  return query select '08_create_spanish_label'::text,
    v_created ->> 'balance_sheet_section' = 'current_asset',
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  v_created := public.update_finance_chart_account((v_created ->> 'id')::uuid, jsonb_build_object(
    'name', 'Caja editada',
    'balance_sheet_section', 'noncurrent_asset'
  ));
  return query select '09_update_section'::text,
    v_created ->> 'balance_sheet_section' = 'noncurrent_asset'
    and v_created ->> 'name' = 'Caja editada',
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'BS-BAD', 'name', 'Combinacion invalida', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
      'balance_sheet_section', 'equity'
    ));
    return query select '10_invalid_combination'::text, false, 'invalid combination succeeded'::text;
  exception when others then
    return query select '10_invalid_combination'::text, sqlerrm like '%no corresponde%', sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'BS-HEAD', 'name', 'Encabezado', 'financial_type', 'asset',
      'natural_balance', 'debit', 'account_kind', 'header', 'accepts_entries', false,
      'balance_sheet_section', 'current_asset'
    ));
    return query select '11_header_rejects_section'::text, false, 'header section succeeded'::text;
  exception when others then
    return query select '11_header_rejects_section'::text, sqlerrm like '%acumuladoras%', sqlerrm;
  end;

  begin
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'BS-INC-BAD', 'name', 'Ingreso con balance', 'financial_type', 'income',
      'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true,
      'balance_sheet_section', 'equity'
    ));
    return query select '12_results_reject_section'::text, false, 'results section succeeded'::text;
  exception when others then
    return query select '12_results_reject_section'::text, sqlerrm like '%resultados%', sqlerrm;
  end;

  v_preview := public.preview_finance_chart_accounts_import(jsonb_build_array(
    jsonb_build_object(
      'codigo', 'BS-IMP-W', 'nombre', 'Activo sin seccion', 'tipo_financiero', 'asset',
      'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true'
    )
  ));
  return query select '13_import_warning_without_section'::text,
    (v_preview ->> 'blocking_errors')::boolean = false
    and (v_preview ->> 'warning_rows')::int = 1
    and (v_preview -> 'warnings' -> 0 ->> 'message') like '%incompleto%',
    coalesce(v_preview ->> 'warning_rows', 'null');

  v_preview := public.preview_finance_chart_accounts_import(jsonb_build_array(
    jsonb_build_object(
      'codigo', 'BS-IMP-D', 'nombre', 'Seccion mala', 'tipo_financiero', 'asset',
      'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true',
      'seccion_balance', 'no-existe'
    )
  ));
  return query select '14_import_rejects_unknown'::text,
    (v_preview ->> 'blocking_errors')::boolean = true
    and (v_preview -> 'errors' -> 0 ->> 'message') like '%desconocida%',
    coalesce(v_preview -> 'errors' -> 0 ->> 'message', 'null');

  perform public.import_finance_chart_accounts(jsonb_build_array(
    jsonb_build_object(
      'codigo', 'BS-IMP-A', 'nombre', 'Caja importada', 'tipo_financiero', 'asset',
      'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true',
      'seccion_balance', 'Activo corriente'
    ),
    jsonb_build_object(
      'codigo', 'BS-IMP-B', 'nombre', 'Gasto importado', 'tipo_financiero', 'expense',
      'naturaleza', 'debit', 'tipo_cuenta', 'detail', 'acepta_movimientos', 'true',
      'seccion_resultados', 'Gastos administrativos'
    )
  ));
  return query select '14b_import_stores_label'::text,
    (select balance_sheet_section from public.finance_chart_accounts where code = 'BS-IMP-A') = 'current_asset'
    and (select income_statement_section from public.finance_chart_accounts where code = 'BS-IMP-B') = 'operating_expense_admin'
    and (select balance_sheet_section from public.finance_chart_accounts where code = 'BS-IMP-B') is null,
    coalesce((select balance_sheet_section from public.finance_chart_accounts where code = 'BS-IMP-A'), 'null');

  v_keep := (v_created ->> 'id')::uuid;
  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('balance_sheet_section', 'current_asset'));
  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('name', 'Caja conservada'));
  return query select '15_omit_keeps_section'::text,
    v_created ->> 'balance_sheet_section' = 'current_asset'
    and v_created ->> 'name' = 'Caja conservada',
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('balance_sheet_section', ''));
  return query select '16_blank_clears_section'::text,
    v_created ->> 'balance_sheet_section' is null,
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('balance_sheet_section', 'current_asset'));
  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('balance_sheet_section', null));
  return query select '17_null_clears_section'::text,
    v_created ->> 'balance_sheet_section' is null,
    coalesce(v_created ->> 'balance_sheet_section', 'null');

  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object('balance_sheet_section', 'current_asset'));
  begin
    perform public.update_finance_chart_account(v_keep, jsonb_build_object('financial_type', 'income'));
    return query select '18_type_change_requires_clear'::text, false, 'incompatible type change succeeded'::text;
  exception when others then
    return query select '18_type_change_requires_clear'::text,
      sqlerrm like '%no corresponde%' or sqlerrm like '%no llevan sección%',
      sqlerrm;
  end;
  v_created := public.update_finance_chart_account(v_keep, jsonb_build_object(
    'financial_type', 'income',
    'natural_balance', 'credit',
    'balance_sheet_section', ''
  ));
  return query select '38_income_section_preserved'::text,
    v_created ->> 'financial_type' = 'income'
    and v_created ->> 'balance_sheet_section' is null
    and (
      select income_statement_section from public.finance_chart_accounts where code = 'BS-IMP-B'
    ) = 'operating_expense_admin',
    coalesce(v_created ->> 'financial_type', 'null');

  perform public.create_finance_accounting_period(2097, 4);
  perform public.create_finance_accounting_period(2097, 5);
  v_branch := (public.create_branch(jsonb_build_object(
    'code', 'BS-LAB-218-ISO',
    'name', 'Sucursal laboratorio balance'
  )) ->> 'id')::uuid;
  v_dim_branch := (public.create_branch(jsonb_build_object(
    'code', 'BS-LAB-218-DIM',
    'name', 'Sucursal laboratorio dimension'
  )) ->> 'id')::uuid;
  perform set_config('alcazar.bs_lab_branch', v_branch::text, true);
  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'BS-LAB-218-CC',
    'name', 'Centro laboratorio dimension',
    'branch_id', v_dim_branch::text
  )) ->> 'id')::uuid;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-CASH', 'name', 'Caja', 'financial_type', 'asset', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;
  v_equip := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-EQP', 'name', 'Equipo', 'financial_type', 'asset', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'balance_sheet_section', 'noncurrent_asset'
  )) ->> 'id')::uuid;
  v_dep := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-DEP', 'name', 'Depreciacion acumulada', 'financial_type', 'asset', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'balance_sheet_section', 'noncurrent_asset'
  )) ->> 'id')::uuid;
  v_cap := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-CAP', 'name', 'Capital', 'financial_type', 'equity', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'balance_sheet_section', 'equity'
  )) ->> 'id')::uuid;
  v_re := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-RE', 'name', 'Utilidades retenidas', 'financial_type', 'equity', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'balance_sheet_section', 'equity'
  )) ->> 'id')::uuid;
  v_income := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-INC', 'name', 'Ventas', 'financial_type', 'income', 'natural_balance', 'credit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_income'
  )) ->> 'id')::uuid;
  v_expense := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-EXP', 'name', 'Gasto', 'financial_type', 'expense', 'natural_balance', 'debit',
    'account_kind', 'detail', 'accepts_entries', true, 'income_statement_section', 'operating_expense_admin'
  )) ->> 'id')::uuid;
  v_unc_pnl := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-UPNL', 'name', 'Gasto sin seccion de resultados', 'financial_type', 'expense',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_zero_unclass := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-ZEROU', 'name', 'Activo sin seccion ni saldo', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_zero_class := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-ZEROC', 'name', 'Activo clasificado en cero', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;
  v_future := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-FUT', 'name', 'Activo posterior', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;

  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '25_unclassified_without_balance_complete'::text,
    (v_report ->> 'report_complete')::boolean
    and public.bs_lab_account(v_report, 'BS-ZEROU') is null
    and (v_report ->> 'unclassified_account_count')::int = 0,
    coalesce(v_report ->> 'report_label', 'null');
  return query select '29_zero_hidden'::text,
    public.bs_lab_account(v_report, 'BS-ZEROC') is null,
    'hidden';
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, true, null);
  return query select '29b_zero_included'::text,
    (public.bs_lab_account(v_report, 'BS-ZEROC') ->> 'amount')::numeric = 0,
    coalesce(public.bs_lab_account(v_report, 'BS-ZEROC') ->> 'amount', 'missing');

  perform public.is_lab_post('2097-05-02', 'Posterior al corte', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_future::text, 'debit', 8, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cap::text, 'debit', 0, 'credit', 8)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '32_cutoff_excludes'::text,
    public.bs_lab_account(v_report, 'BS-FUT') is null
    and (v_report ->> 'classified_total_assets')::numeric = 0,
    coalesce(v_report ->> 'classified_total_assets', 'null');

  perform public.is_lab_post('2097-04-10', 'Apertura', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cap::text, 'debit', 0, 'credit', 60),
    jsonb_build_object('line_number', 3, 'account_id', v_income::text, 'debit', 0, 'credit', 40)
  ));
  perform public.is_lab_post('2097-04-11', 'Gasto', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 10)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '19_square'::text,
    (v_report ->> 'report_complete')::boolean
    and v_report ->> 'report_label' = 'Balance General'
    and (v_report ->> 'classified_total_assets')::numeric = 90
    and (v_report ->> 'classified_registered_equity')::numeric = 60
    and (v_report ->> 'accumulated_result')::numeric = 30
    and (v_report ->> 'classified_total_equity')::numeric = 90
    and (v_report ->> 'control_total_assets')::numeric = 90
    and (v_report ->> 'difference')::numeric = 0
    and (v_report ->> 'is_square')::boolean
    and v_report ->> 'balance_status' = 'Cuadrado',
    coalesce(v_report ->> 'difference', 'null');

  perform public.is_lab_post('2097-04-12', 'Equipo', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_equip::text, 'debit', 80, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 80)
  ));
  perform public.is_lab_post('2097-04-12', 'Depreciacion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_dep::text, 'debit', 0, 'credit', 30)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  v_row := public.bs_lab_account(v_report, 'BS-DEP');
  return query select '20_depreciation_reduces_assets'::text,
    (v_row ->> 'amount')::numeric = -30
    and (v_row ->> 'natural_signed')::numeric = 30
    and (v_row ->> 'contrary')::boolean = false
    and (v_report ->> 'current_assets_total')::numeric = 10
    and (v_report ->> 'noncurrent_assets_total')::numeric = 50
    and (v_report ->> 'classified_total_assets')::numeric = 60
    and (v_report ->> 'accumulated_result')::numeric = 0
    and (v_report ->> 'difference')::numeric = 0,
    coalesce(v_row ->> 'amount', 'missing');

  perform public.is_lab_post('2097-04-13', 'Perdida', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 20)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  v_row := public.bs_lab_account(v_report, 'BS-CASH');
  return query select '21_loss_reduces_equity'::text,
    (v_report ->> 'accumulated_result')::numeric = -20
    and (v_report ->> 'classified_registered_equity')::numeric = 60
    and (v_report ->> 'classified_total_equity')::numeric = 40
    and (v_report ->> 'classified_total_assets')::numeric = 40
    and (v_report ->> 'difference')::numeric = 0
    and (v_report ->> 'is_square')::boolean,
    coalesce(v_report ->> 'classified_total_equity', 'null');
  return query select '27_contrary_visible'::text,
    (v_row ->> 'amount')::numeric = -10
    and (v_row ->> 'natural_signed')::numeric = -10
    and (v_row ->> 'contrary')::boolean,
    coalesce(v_row ->> 'amount', 'missing');

  perform public.is_lab_post('2097-04-14', 'Cierre', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_income::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_re::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 3, 'account_id', v_expense::text, 'debit', 0, 'credit', 60)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '22_close_does_not_duplicate'::text,
    (v_report ->> 'accumulated_result')::numeric = 0
    and (public.bs_lab_account(v_report, 'BS-RE') ->> 'amount')::numeric = -20
    and (v_report ->> 'classified_registered_equity')::numeric = 40
    and (v_report ->> 'classified_total_equity')::numeric = 40
    and (v_report ->> 'classified_total_assets')::numeric = 40
    and (v_report ->> 'difference')::numeric = 0,
    coalesce(v_report ->> 'accumulated_result', 'null');

  perform public.is_lab_post('2097-04-15', 'Gasto sin seccion de resultados', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_unc_pnl::text, 'debit', 5, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 5)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '23_unclassified_pnl_in_result'::text,
    (select income_statement_section from public.finance_chart_accounts where id = v_unc_pnl) is null
    and (v_report ->> 'accumulated_result')::numeric = -5
    and (v_report ->> 'report_complete')::boolean
    and (v_report ->> 'classified_total_assets')::numeric = 35
    and (v_report ->> 'difference')::numeric = 0,
    coalesce(v_report ->> 'accumulated_result', 'null');

  v_unc_asset := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-UNCA', 'name', 'Activo sin seccion con saldo', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2097-04-16', 'Activo sin seccion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_unc_asset::text, 'debit', 12, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 12)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '24_unclassified_asset_incomplete'::text,
    (v_report ->> 'report_complete')::boolean = false
    and v_report ->> 'report_label' = 'Balance provisional'
    and (v_report ->> 'classified_total_assets')::numeric = 23
    and (v_report ->> 'unclassified_asset_amount')::numeric = 12
    and (v_report ->> 'control_total_assets')::numeric = 35
    and (v_report ->> 'difference')::numeric = 0
    and (v_report ->> 'is_square')::boolean
    and public.bs_lab_account(v_report, 'BS-UNCA') is not null
    and public.bs_lab_account(v_report, 'BS-ZEROU') is null,
    coalesce(v_report ->> 'control_total_assets', 'null');
  return query select '26_classified_differs_from_control'::text,
    (v_report ->> 'classified_total_assets')::numeric <> (v_report ->> 'control_total_assets')::numeric
    and (v_report ->> 'classified_difference')::numeric = -12
    and (v_report ->> 'difference')::numeric = 0
    and (v_report ->> 'classified_total_equity')::numeric = 35
    and (v_report ->> 'control_total_equity')::numeric = 35,
    coalesce(v_report ->> 'classified_difference', 'null');

  v_old := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-OLD', 'name', 'Activo inactivo', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2097-04-17', 'Historial inactivo', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_old::text, 'debit', 6, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 6)
  ));
  perform public.set_finance_chart_account_active(v_old, false);
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  v_row := public.bs_lab_account(v_report, 'BS-OLD');
  return query select '28_inactive_history'::text,
    v_row is not null
    and (v_row ->> 'is_active')::boolean = false
    and (v_row ->> 'amount')::numeric = 6,
    coalesce(v_row ->> 'is_active', 'missing');

  v_rev := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-REV', 'name', 'Activo reversado', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;
  v_entry := public.is_lab_post('2097-04-18', 'Reversion', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_rev::text, 'debit', 4, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 4)
  ));
  perform public.reverse_finance_journal_entry(v_entry, 'Reversion de laboratorio', '2097-04-18');
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '30_reversal'::text,
    public.bs_lab_account(v_report, 'BS-REV') is null,
    'net zero';

  v_snap := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-SNAP', 'name', 'Activo snapshot', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset'
  )) ->> 'id')::uuid;
  v_entry := public.is_lab_post('2097-04-19', 'Snapshot', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_snap::text, 'debit', 3, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 0, 'credit', 3)
  ));
  select posted_at into v_posted_at from public.finance_journal_entries where id = v_entry;
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, v_posted_at - interval '1 second');
  return query select '31_snapshot'::text,
    public.bs_lab_account(v_report, 'BS-SNAP') is null,
    'excluded';

  begin
    perform public.get_finance_balance_sheet(null, null, null, false, null);
    return query select '33_cutoff_required'::text, false, 'null cutoff succeeded'::text;
  exception when others then
    return query select '33_cutoff_required'::text, sqlerrm = 'La fecha de corte es obligatoria.', sqlerrm;
  end;

  v_entry := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2097-04-20', 'description', 'Borrador', 'reference', 'BORRADOR'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'branch_id', v_branch::text, 'debit', 50, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_cap::text, 'branch_id', v_branch::text, 'debit', 0, 'credit', 50)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_branch, null, false, null);
  return query select '34_posted_only'::text,
    public.bs_lab_account(v_report, 'BS-SNAP') is not null
    and (public.bs_lab_account(v_report, 'BS-CAP') ->> 'amount')::numeric = 60,
    coalesce(public.bs_lab_account(v_report, 'BS-CAP') ->> 'amount', 'null');

  v_dim_asset := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-DIMA', 'name', 'Activo sucursal', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'current_asset',
    'branch_dimension_rule', 'optional', 'cost_center_dimension_rule', 'optional'
  )) ->> 'id')::uuid;
  v_dim_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', 'BS-DIME', 'name', 'Capital sucursal', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true,
    'balance_sheet_section', 'equity'
  )) ->> 'id')::uuid;
  perform public.is_lab_post('2097-04-21', 'Dimension', jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_dim_asset::text, 'branch_id', v_dim_branch::text, 'cost_center_id', v_cc::text, 'debit', 9, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_dim_equity::text, 'debit', 0, 'credit', 9)
  ));
  v_report := public.get_finance_balance_sheet('2097-04-30', v_dim_branch, v_cc, false, null);
  return query select '35_dimension_warning'::text,
    v_report ->> 'scope' = 'branch_and_cost_center'
    and (v_report ->> 'dimensional_filter')::boolean
    and v_report ->> 'warnings' like '%descuadrar%'
    and (v_report ->> 'control_total_assets')::numeric = 9
    and (v_report ->> 'control_registered_equity')::numeric = 0
    and (v_report ->> 'difference')::numeric = 9
    and (v_report ->> 'is_square')::boolean = false
    and v_report ->> 'balance_status' = 'Descuadrado',
    coalesce(v_report ->> 'difference', 'null') || ' ' || coalesce(v_report ->> 'warnings', '');

  for v_i in 1..2001 loop
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'BSL' || lpad(v_i::text, 4, '0'),
      'name', 'Cuenta limite ' || v_i::text,
      'financial_type', 'asset',
      'natural_balance', 'debit',
      'account_kind', 'detail',
      'accepts_entries', true,
      'balance_sheet_section', 'current_asset'
    ));
  end loop;
  begin
    perform public.get_finance_balance_sheet('2097-04-30', v_branch, null, true, null);
    return query select '36_limit'::text, false, 'limit succeeded'::text;
  exception when others then
    return query select '36_limit'::text, sqlerrm like '%2000%', sqlerrm;
  end;

  v_report := public.get_finance_income_statement('2097-04-01', '2097-04-30', null, v_branch, null, false, null);
  return query select '37_reports_remain'::text,
    to_regprocedure('public.get_finance_general_journal(date,date,uuid,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_trial_balance(date,date,uuid,uuid,uuid,text,boolean,integer,integer,timestamptz)') is not null
    and to_regprocedure('public.get_finance_income_statement(date,date,uuid,uuid,uuid,boolean,timestamptz)') is not null
    and v_report ? 'report_complete'
    and (v_report ->> 'report_complete')::boolean = false,
    coalesce(v_report ->> 'report_complete', 'null');

exception when others then
  return query select 'unhandled'::text, false, sqlerrm;
end;
$$;

select scenario, passed, detail from public.test_finance_balance_sheet();

rollback;
