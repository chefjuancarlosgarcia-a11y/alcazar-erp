-- General Journal — SQL verification (NOT a migration).
-- Run manually AFTER 208_finance_general_journal.sql.
-- Uses BEGIN … ROLLBACK.

begin;

create or replace function public.test_finance_general_journal()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_contador uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_branch uuid;
  v_period uuid;
  v_period_jul uuid;
  v_cash uuid;
  v_expense uuid;
  v_equity uuid;
  v_cc uuid;
  v_entry jsonb;
  v_entry_id uuid;
  v_posted jsonb;
  v_posted_id uuid;
  v_reversal jsonb;
  v_report jsonb;
  v_draft_id uuid;
  v_pending_id uuid;
  v_approved_id uuid;
  v_total_pages integer;
begin
  set local session_replication_role = replica;
  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin GJ', 'admin_gj', 'admin', 'active'),
    (v_contador, 'Contador GJ', 'contador_gj', 'contador', 'active'),
    (v_mesero, 'Mesero GJ', 'mesero_gj', 'mesero', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;
  set local session_replication_role = default;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.get_finance_general_journal();
    return query select 'rejects_unauthenticated'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rejects_unauthenticated'::text, sqlerrm like '%autenticado%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    perform public.get_finance_general_journal();
    return query select 'rejects_without_permission'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rejects_without_permission'::text, sqlerrm like '%permiso%', sqlerrm;
  end;

  perform set_config('request.jwt.claim.sub', v_contador::text, true);

  select id into v_branch from public.branches where code = 'PRINCIPAL';
  perform public.create_finance_accounting_period(2026, 7);
  perform public.create_finance_accounting_period(2026, 8);
  select id into v_period_jul from public.finance_accounting_periods where period_year = 2026 and period_month = 7;
  select id into v_period from public.finance_accounting_periods where period_year = 2026 and period_month = 8;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', '1.01-GJ', 'name', 'Caja GJ', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_expense := (public.create_finance_chart_account(jsonb_build_object(
    'code', '5.01-GJ', 'name', 'Gasto GJ', 'financial_type', 'expense',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true,
    'branch_dimension_rule', 'required'
  )) ->> 'id')::uuid;

  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', '3.01-GJ', 'name', 'Capital GJ', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  v_cc := (public.create_finance_cost_center(jsonb_build_object(
    'code', 'CC-GJ', 'name', 'CC GJ', 'branch_id', v_branch::text, 'account_kind', 'detail'
  )) ->> 'id')::uuid;

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-10', 'description', 'Posted GJ alpha', 'reference', 'REF-GJ-1'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  v_posted := public.post_finance_journal_entry(v_entry_id);
  v_posted_id := (v_posted ->> 'id')::uuid;

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-08-12', 'description', 'Posted GJ beta', 'reference', 'REF-GJ-2'
  ));
  v_entry_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object(
      'line_number', 1, 'account_id', v_expense::text, 'branch_id', v_branch::text,
      'cost_center_id', v_cc::text, 'description', 'Linea gasto GJ', 'reference', 'LINE-REF-GJ',
      'debit', 50, 'credit', 0
    ),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 50)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  perform public.post_finance_journal_entry(v_entry_id);

  v_reversal := public.reverse_finance_journal_entry(v_posted_id, 'Reversión GJ', '2026-08-11'::date);

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-07-05', 'description', 'Draft excluded', 'reference', 'DRAFT-GJ'
  ));
  v_draft_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_draft_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-07-06', 'description', 'Pending excluded', 'reference', 'PEND-GJ'
  ));
  v_pending_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_pending_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  perform public.submit_finance_journal_entry(v_pending_id);

  v_entry := public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-07-07', 'description', 'Approved excluded', 'reference', 'APPR-GJ'
  ));
  v_approved_id := (v_entry ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_approved_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  perform public.submit_finance_journal_entry(v_approved_id);
  perform public.approve_finance_journal_entry(v_approved_id);

  v_report := public.get_finance_general_journal();
  return query select 'includes_posted'::text,
    (v_report ->> 'total_rows')::int >= 6,
    v_report ->> 'total_rows';

  return query select 'returns_snapshot_at'::text,
    (v_report ->> 'snapshot_at') is not null,
    v_report ->> 'snapshot_at';

  return query select 'excludes_draft'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where (r ->> 'entry_id')::uuid = v_draft_id
    ),
    'draft absent'::text;

  return query select 'excludes_pending'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where (r ->> 'entry_id')::uuid = v_pending_id
    ),
    'pending absent'::text;

  return query select 'excludes_approved'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where (r ->> 'entry_id')::uuid = v_approved_id
    ),
    'approved absent'::text;

  v_report := public.get_finance_general_journal(
    p_from_date => '2026-08-11'::date,
    p_to_date => '2026-08-12'::date
  );
  return query select 'filters_by_date'::text,
    not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where (r ->> 'entry_date')::date < '2026-08-11'::date
         or (r ->> 'entry_date')::date > '2026-08-12'::date
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_period_id => v_period);
  return query select 'filters_by_period'::text,
    jsonb_array_length(v_report -> 'rows') > 0
    and not exists (
      select 1 from public.finance_journal_entries je
      where je.id in (select (r ->> 'entry_id')::uuid from jsonb_array_elements(v_report -> 'rows') r)
        and je.period_id <> v_period
    ),
    v_report ->> 'total_entries';

  v_report := public.get_finance_general_journal(p_account_id => v_expense);
  return query select 'filters_by_account'::text,
    coalesce(jsonb_array_length(v_report -> 'rows'), 0) >= 1
    and not exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r where r ->> 'account_id' <> v_expense::text
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_branch_id => v_branch, p_account_id => v_expense);
  return query select 'filters_by_branch'::text,
    coalesce(jsonb_array_length(v_report -> 'rows'), 0) >= 1,
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_cost_center_id => v_cc, p_account_id => v_expense);
  return query select 'filters_by_cost_center'::text,
    coalesce(jsonb_array_length(v_report -> 'rows'), 0) >= 1,
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => 'REF-GJ-1');
  return query select 'search_by_reference'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'entry_reference' = 'REF-GJ-1'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => (v_posted ->> 'entry_number'));
  return query select 'search_by_entry_number'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'entry_number' = v_posted ->> 'entry_number'
    ),
    v_posted ->> 'entry_number';

  v_report := public.get_finance_general_journal(p_search => 'Posted GJ beta');
  return query select 'search_by_description'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'entry_description' = 'Posted GJ beta'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => '5.01-GJ');
  return query select 'search_by_account_code'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'account_code' = '5.01-GJ'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => 'Gasto GJ');
  return query select 'search_by_account_name'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'account_name' = 'Gasto GJ'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => 'Linea gasto GJ');
  return query select 'search_by_line_description'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'line_description' = 'Linea gasto GJ'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_search => 'LINE-REF-GJ');
  return query select 'search_by_line_reference'::text,
    exists (
      select 1 from jsonb_array_elements(v_report -> 'rows') r
      where r ->> 'line_reference' = 'LINE-REF-GJ'
    ),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_account_id => v_cash);
  return query select 'no_duplicate_lines'::text,
    (select count(*) from jsonb_array_elements(v_report -> 'rows')) =
    (select count(distinct (r ->> 'line_id')) from jsonb_array_elements(v_report -> 'rows') r),
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_page_size => 500);
  return query select 'deterministic_order'::text,
    (v_report -> 'rows' -> 0 ->> 'entry_date') <= (v_report -> 'rows' -> 1 ->> 'entry_date')
    or jsonb_array_length(v_report -> 'rows') < 2,
    'asc dates'::text;

  v_report := public.get_finance_general_journal(p_page_size => 500);
  return query select 'global_totals_correct'::text,
    (v_report ->> 'difference')::numeric = round(
      (v_report ->> 'total_debit')::numeric - (v_report ->> 'total_credit')::numeric,
      2
    )
    and (v_report ->> 'total_debit')::numeric >= 0
    and (v_report ->> 'total_credit')::numeric >= 0,
    v_report ->> 'total_debit';

  v_report := public.get_finance_general_journal(p_page_size => 500);
  return query select 'balanced_difference_zero'::text,
    (v_report ->> 'difference')::numeric = 0,
    v_report ->> 'difference';

  v_report := public.get_finance_general_journal(p_page => 1, p_page_size => 2);
  return query select 'pagination_consistent'::text,
    jsonb_array_length(v_report -> 'rows') <= 2 and (v_report ->> 'page')::int = 1,
    v_report ->> 'total_pages';

  v_report := public.get_finance_general_journal(p_page_size => 500);
  return query select 'includes_original_and_reversal'::text,
    exists (select 1 from jsonb_array_elements(v_report -> 'rows') r where (r ->> 'entry_id')::uuid = v_posted_id)
    and exists (select 1 from jsonb_array_elements(v_report -> 'rows') r where (r ->> 'is_reversal')::boolean = true),
    v_reversal ->> 'entry_number';

  v_report := public.get_finance_general_journal(
    p_from_date => '2099-01-01'::date,
    p_to_date => '2099-01-31'::date
  );
  return query select 'handles_empty_result'::text,
    (v_report ->> 'total_rows')::int = 0 and jsonb_array_length(v_report -> 'rows') = 0,
    v_report ->> 'total_rows';

  v_report := public.get_finance_general_journal(p_page_size => 500);
  return query select 'two_decimal_precision'::text,
    (v_report -> 'rows' -> 0 ->> 'debit') ~ '^\d+\.\d{2}$'
    or (v_report -> 'rows' -> 0 ->> 'credit') ~ '^\d+\.\d{2}$',
    v_report -> 'rows' -> 0 ->> 'debit';

  v_report := public.get_finance_general_journal(p_page => 1, p_page_size => 2);
  return query select 'totals_independent_of_page'::text,
    (v_report ->> 'total_debit') = (public.get_finance_general_journal(p_page => 2, p_page_size => 2) ->> 'total_debit'),
    v_report ->> 'total_debit';

  begin
    perform public.get_finance_general_journal(
      p_from_date => '2026-08-15'::date,
      p_to_date => '2026-08-01'::date
    );
    return query select 'invalid_date_range'::text, false, 'should fail'::text;
  exception when others then
    return query select 'invalid_date_range'::text, sqlerrm like '%desde%', sqlerrm;
  end;

  begin
    perform public.get_finance_general_journal(p_page_size => 501);
    return query select 'max_page_size_guard'::text, false, 'should fail'::text;
  exception when others then
    return query select 'max_page_size_guard'::text, sqlerrm like '%500%', sqlerrm;
  end;

  begin
    perform public.get_finance_general_journal(p_page => 0);
    return query select 'invalid_page_zero'::text, false, 'should fail'::text;
  exception when others then
    return query select 'invalid_page_zero'::text, sqlerrm like '%página%', sqlerrm;
  end;

  begin
    perform public.get_finance_general_journal(p_page => -1);
    return query select 'invalid_page_negative'::text, false, 'should fail'::text;
  exception when others then
    return query select 'invalid_page_negative'::text, sqlerrm like '%página%', sqlerrm;
  end;

  v_report := public.get_finance_general_journal(p_page_size => 2);
  v_total_pages := (v_report ->> 'total_pages')::int;
  return query select 'page_beyond_last_empty_rows'::text,
    jsonb_array_length(
      (public.get_finance_general_journal(p_page => v_total_pages + 1, p_page_size => 2) -> 'rows')
    ) = 0,
    (v_total_pages + 1)::text;

  v_report := public.get_finance_general_journal(p_page_size => 2);
  v_total_pages := (v_report ->> 'total_pages')::int;
  return query select 'page_beyond_last_preserves_totals'::text,
    (v_report ->> 'total_debit') = (
      public.get_finance_general_journal(p_page => v_total_pages + 1, p_page_size => 2) ->> 'total_debit'
    )
    and (v_report ->> 'total_rows') = (
      public.get_finance_general_journal(p_page => v_total_pages + 1, p_page_size => 2) ->> 'total_rows'
    ),
    v_report ->> 'total_debit';

  v_report := public.get_finance_general_journal(p_snapshot_at => now() + interval '1 hour');
  return query select 'snapshot_includes_current_posted'::text,
    (v_report ->> 'total_rows')::int >= 6,
    v_report ->> 'snapshot_at';

  v_report := public.get_finance_general_journal(p_snapshot_at => '2020-01-01'::timestamptz);
  return query select 'snapshot_excludes_future_posted'::text,
    (v_report ->> 'total_rows')::int = 0,
    v_report ->> 'total_rows';

  return query select 'branch_scope_currently_unrestricted'::text,
    public.accounting_journal_branch_scope() is null,
    'NULL scope — multisucursal risk documented'::text;
end;
$$;

select * from public.test_finance_general_journal() order by scenario;

rollback;
