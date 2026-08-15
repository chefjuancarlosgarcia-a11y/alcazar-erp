-- Journal engine — SQL verification (NOT a migration).
-- Run manually AFTER 204_finance_accounting_journal_engine.sql.
-- Uses BEGIN … ROLLBACK.

begin;

create or replace function public.test_finance_accounting_journal_engine()
returns table (scenario text, passed boolean, detail text)
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
  v_branch uuid;
  v_branch_b uuid;
  v_period uuid;
  v_period_jul uuid;
  v_period_sep uuid;
  v_period_oct uuid;
  v_cash uuid;
  v_expense uuid;
  v_equity uuid;
  v_header uuid;
  v_cc uuid;
  v_cc_b uuid;
  v_entry jsonb;
  v_entry_id uuid;
  v_posted jsonb;
  v_posted_id uuid;
  v_first_posted_id uuid;
  v_reversal jsonb;
  v_num1 text;
  v_num2 text;
begin
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin', 'admin_audit', 'admin', 'active'),
    (v_contador, 'Contador', 'contador_audit', 'contador', 'active'),
    (v_gerente, 'Gerente', 'gerente_audit', 'gerente_general', 'active'),
    (v_mesero, 'Mesero', 'mesero_audit', 'mesero', 'active'),
    (v_inactive, 'Inactivo', 'inactive_audit', 'contador', 'inactive')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  select id into v_branch from public.branches where code = 'PRINCIPAL';
  perform public.create_finance_accounting_period(2026, 7);
  perform public.create_finance_accounting_period(2026, 8);
  select id into v_period_jul from public.finance_accounting_periods where period_year = 2026 and period_month = 7;
  select id into v_period from public.finance_accounting_periods where period_year = 2026 and period_month = 8;
  perform public.create_finance_accounting_period(2026, 9);
  perform public.create_finance_accounting_period(2026, 10);
  select id into v_period_sep from public.finance_accounting_periods where period_year = 2026 and period_month = 9;
  select id into v_period_oct from public.finance_accounting_periods where period_year = 2026 and period_month = 10;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', '1.01-JE', 'name', 'Caja JE', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_expense := (public.create_finance_chart_account(jsonb_build_object(
    'code', '5.01-JE', 'name', 'Gasto JE', 'financial_type', 'expense',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', '3.01-JE', 'name', 'Capital JE', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_header := (public.create_finance_chart_account(jsonb_build_object(
    'code', '1-JE', 'name', 'Activos JE', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'header', 'accepts_entries', false
  )) ->> 'id')::uuid;

  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'CC-JE', 'name', 'CC JE', 'branch_id', v_branch::text, 'account_kind', 'detail'
  )) ->> 'id')::uuid;

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-15', 'description', 'Partida cuadrada'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;

  v_entry := public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)
  ));
  v_entry := public.submit_finance_journal_entry(v_entry_id);
  v_entry := public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);
  v_num1 := v_posted ->> 'entry_number';
  v_first_posted_id := (v_posted ->> 'id')::uuid;
  return query select 'balanced_entry_posts'::text,
    (v_posted ->> 'status') = 'posted' and v_num1 like 'JE-2026-%',
    coalesce(v_num1, '');

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-16', 'description', 'Descuadre'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 90)
  ));
  begin
    perform public.submit_finance_journal_entry(v_entry_id);
    return query select 'unbalanced_entry_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'unbalanced_entry_rejected'::text, sqlerrm like '%cuadra%', sqlerrm;
  end;

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-17', 'description', 'Header'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
      jsonb_build_object('line_number', 1, 'account_id', v_header::text, 'debit', 50, 'credit', 0),
      jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 50)
    ));
    return query select 'header_account_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'header_account_rejected'::text, sqlerrm like '%acumuladora%', sqlerrm;
  end;

  perform public.set_finance_chart_account_active(v_cash, false);
  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-18', 'description', 'Inactiva'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
      jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 10, 'credit', 0),
      jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
    ));
    return query select 'inactive_account_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'inactive_account_rejected'::text, sqlerrm like '%inactiva%', sqlerrm;
  end;
  perform public.set_finance_chart_account_active(v_cash, true);

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-19', 'description', 'Dim req'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
      jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'debit', 10, 'credit', 0),
      jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
    ));
    return query select 'required_dimension_missing'::text, false, 'should fail'::text;
  exception when others then
    return query select 'required_dimension_missing'::text, sqlerrm like '%requiere sucursal%', sqlerrm;
  end;

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-20', 'description', 'Dim prohib'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
      jsonb_build_object('line_number', 1, 'account_id', v_equity::text, 'branch_id', v_branch::text, 'debit', 0, 'credit', 10),
      jsonb_build_object('line_number', 2, 'account_id', v_cash::text, 'debit', 10, 'credit', 0)
    ));
    return query select 'prohibited_dimension_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'prohibited_dimension_rejected'::text, sqlerrm like '%prohíbe sucursal%', sqlerrm;
  end;

  v_entry := public.create_branch(jsonb_build_object('code', 'JE-NORTE', 'name', 'Norte JE'));
  v_branch_b := (v_entry ->> 'id')::uuid;
  v_entry := public.create_finance_cost_center(jsonb_build_object(
    'code', 'CC-JE-NORTE', 'name', 'CC Norte', 'branch_id', v_branch_b::text, 'account_kind', 'detail'
  ));
  v_cc_b := (v_entry ->> 'id')::uuid;

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-07-21', 'description', 'CC mismatch'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
      jsonb_build_object('line_number', 1, 'account_id', v_expense::text, 'branch_id', v_branch::text,
        'cost_center_id', v_cc_b::text, 'debit', 10, 'credit', 0),
      jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
    ));
    return query select 'cross_branch_cost_center_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'cross_branch_cost_center_rejected'::text, sqlerrm like '%sucursal%', sqlerrm;
  end;

  perform public.set_finance_accounting_period_status(v_period_oct, 'closed');
  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-10-05', 'description', 'Closed period'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 20, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 20)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  begin
    perform public.post_finance_journal_entry(v_entry_id);
    return query select 'closed_period_post_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'closed_period_post_rejected'::text, sqlerrm like '%cerrado%', sqlerrm;
  end;
  perform public.reopen_finance_accounting_period(v_period_oct, 'Reapertura prueba JE oct');

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-23', 'description', 'Num 2',
    'source_module', 'manual', 'source_id', gen_random_uuid()::text, 'source_event', 'evt-1'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 30, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 30)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);
  v_num2 := v_posted ->> 'entry_number';
  return query select 'atomic_numbering_sequence'::text, v_num1 <> v_num2 and v_num2 like 'JE-2026-%', v_num1 || ' -> ' || v_num2;

  v_posted_id := (v_posted ->> 'id')::uuid;
  begin
    update public.finance_journal_entries set description = 'Hack' where id = v_posted_id;
    return query select 'posted_entry_immutable'::text, false, 'should fail'::text;
  exception when others then
    return query select 'posted_entry_immutable'::text, sqlerrm like '%inmutables%', sqlerrm;
  end;

  v_reversal := public.reverse_finance_journal_entry(v_posted_id, 'Corrección auditoría', '2026-08-23'::date);
  return query select 'reversal_created'::text,
    (v_reversal ->> 'reversal_of_id') = v_posted_id::text and (v_reversal ->> 'status') = 'posted',
    v_reversal ->> 'entry_number';

  begin
    perform public.reverse_finance_journal_entry(v_posted_id, 'Duplicada');
    return query select 'double_reversal_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'double_reversal_rejected'::text, sqlerrm like '%revertida%', sqlerrm;
  end;

  perform public.set_finance_accounting_period_status(v_period, 'closed');
  v_reversal := public.reverse_finance_journal_entry(v_first_posted_id, 'Reversión periodo posterior', '2026-09-05'::date);
  return query select 'reversal_in_later_open_period'::text,
    (v_reversal ->> 'period_id') = v_period_sep::text,
    v_reversal ->> 'entry_number';

  perform public.reopen_finance_accounting_period(v_period, 'Reapertura para pruebas finales');

  perform public.set_finance_accounting_period_status(v_period, 'soft_closed');
  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-08-26', 'description', 'Soft close post'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 15, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 15)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);
  return query select 'soft_closed_post_by_elevated_role'::text,
    (v_posted ->> 'status') = 'posted',
    v_posted ->> 'entry_number';

  perform public.set_finance_accounting_period_status(v_period, 'open');

  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-08-27', 'description', 'Workflow reject'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 5, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 5)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.reject_finance_journal_entry(v_entry_id, 'Corregir descripción');
  return query select 'reject_returns_to_draft'::text,
    (public.get_finance_journal_entry(v_entry_id) ->> 'status') = 'draft',
    'draft'::text;

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-24', 'description', 'Idempotencia',
    'source_module', 'purchases', 'source_id', '11111111-1111-1111-1111-111111111111', 'source_event', 'invoice'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 50, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 50)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  perform public.post_finance_journal_entry(v_entry_id);

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-25', 'description', 'Idempotencia dup',
    'source_module', 'purchases', 'source_id', '11111111-1111-1111-1111-111111111111', 'source_event', 'invoice'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 50, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 50)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  begin
    perform public.post_finance_journal_entry(v_entry_id);
    return query select 'source_idempotency_enforced'::text, false, 'should fail'::text;
  exception when others then
    return query select 'source_idempotency_enforced'::text, true, sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    perform public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-08-26', 'description', 'Fail'));
    return query select 'gerente_cannot_create'::text, false, 'should fail'::text;
  exception when others then
    return query select 'gerente_cannot_create'::text, sqlerrm like '%permiso%', sqlerrm;
  end;
  perform public.list_finance_journal_entries();
  return query select 'gerente_can_view'::text, true, 'list ok'::text;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-09-07', 'description', 'Gerente reverse target'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 8, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 8)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);
  v_posted_id := (v_posted ->> 'id')::uuid;

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  v_reversal := public.reverse_finance_journal_entry(v_posted_id, 'Reversión autorizada gerencia', '2026-09-07'::date);
  return query select 'gerente_can_reverse'::text, (v_reversal ->> 'status') = 'posted', v_reversal ->> 'entry_number';

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.list_finance_journal_entries();
    return query select 'mesero_denied'::text, false, 'should fail'::text;
  exception when others then
    return query select 'mesero_denied'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_inactive::text, true);
  begin
    perform public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-08-27', 'description', 'Fail'));
    return query select 'inactive_profile_denied'::text, false, 'should fail'::text;
  exception when others then
    return query select 'inactive_profile_denied'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  v_entry := public.create_finance_journal_draft(jsonb_build_object('entry_date', '2026-08-28', 'description', 'Pending close'));
  v_entry_id := (v_entry ->> 'id')::uuid;
  begin
    perform public.set_finance_accounting_period_status(v_period, 'closed');
    return query select 'close_with_pending_entries_rejected'::text, false, 'should fail'::text;
  exception when others then
    return query select 'close_with_pending_entries_rejected'::text, sqlerrm like '%pendientes%', sqlerrm;
  end;

  begin
    delete from public.finance_journal_entries where id = v_entry_id;
    return query select 'no_delete_entries'::text, false, 'should fail'::text;
  exception when others then
    return query select 'no_delete_entries'::text, sqlerrm like '%eliminar%', sqlerrm;
  end;

  return;
end;
$$;

with results as materialized (
  select * from public.test_finance_accounting_journal_engine()
)
select r.scenario, r.passed, r.detail,
  count(*) over () as total,
  count(*) filter (where r.passed) over () as passed_total,
  count(*) filter (where not r.passed) over () as failed_total
from results r
order by r.passed asc, r.scenario;

drop function if exists public.test_finance_accounting_journal_engine();

rollback;
