-- Adversarial audit for migration 204 (NOT a migration).
-- Run as authenticated role where bypass is tested; SECURITY INVOKER runner.
-- Uses BEGIN … ROLLBACK.

begin;

grant authenticated to postgres;

create or replace function public.test_finance_journal_adversarial()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_contador uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_branch uuid;
  v_period uuid;
  v_cash uuid;
  v_equity uuid;
  v_entry_id uuid;
  v_line_id uuid;
  v_posted_id uuid;
  v_other_id uuid;
  v_approved_id uuid;
  v_pending_line_id uuid;
  v_posted_line_id uuid;
  v_err text;
begin
  insert into auth.users (id) values
    (v_admin), (v_contador)
  on conflict (id) do nothing;

  insert into public.profiles (id, full_name, username, role, status) values
    (v_admin, 'Admin', 'admin_adv', 'admin', 'active'),
    (v_contador, 'Contador', 'contador_adv', 'contador', 'active')
  on conflict (id) do update set role = excluded.role, status = excluded.status;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  select id into v_branch from public.branches where code = 'PRINCIPAL';
  perform public.create_finance_accounting_period(2026, 11);
  select id into v_period from public.finance_accounting_periods where period_year = 2026 and period_month = 11;

  v_cash := (public.create_finance_chart_account(jsonb_build_object(
    'code', '1.01-ADV', 'name', 'Caja ADV', 'financial_type', 'asset',
    'natural_balance', 'debit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;
  v_equity := (public.create_finance_chart_account(jsonb_build_object(
    'code', '3.01-ADV', 'name', 'Capital ADV', 'financial_type', 'equity',
    'natural_balance', 'credit', 'account_kind', 'detail', 'accepts_entries', true
  )) ->> 'id')::uuid;

  -- Seed entries via RPC (as definer path through postgres session before SET ROLE)
  v_entry_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-05', 'description', 'Draft target'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 100, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 100)
  ));
  select id into v_line_id from public.finance_journal_lines where journal_entry_id = v_entry_id limit 1;

  v_other_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-06', 'description', 'Pending target'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_other_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 50, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 50)
  ));
  perform public.submit_finance_journal_entry(v_other_id);
  select id into v_pending_line_id from public.finance_journal_lines where journal_entry_id = v_other_id limit 1;

  v_approved_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-06', 'description', 'Approved target'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_approved_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 40, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 40)
  ));
  perform public.submit_finance_journal_entry(v_approved_id);
  perform public.approve_finance_journal_entry(v_approved_id);

  v_posted_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-07', 'description', 'Posted target'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_posted_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 25, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 25)
  ));
  perform public.submit_finance_journal_entry(v_posted_id);
  perform public.approve_finance_journal_entry(v_posted_id);
  perform public.post_finance_journal_entry(v_posted_id);
  select id into v_posted_line_id from public.finance_journal_lines where journal_entry_id = v_posted_id limit 1;

  -- Approved entry for transition tests
  perform set_config('request.jwt.claim.sub', v_contador::text, true);

  -- -------------------------------------------------------------------------
  -- 1. Direct bypass as authenticated
  -- -------------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_contador::text, true);

  begin
    insert into public.finance_journal_entries (entry_date, period_id, description, status)
    values ('2026-11-08', v_period, 'Bypass insert', 'draft');
    return query select 'bypass_insert_entry'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_insert_entry'::text, true, sqlerrm;
    when others then
      return query select 'bypass_insert_entry'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set status = 'posted' where id = v_entry_id;
    return query select 'bypass_draft_to_posted'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_draft_to_posted'::text, true, sqlerrm;
    when others then
      return query select 'bypass_draft_to_posted'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set entry_number = 'JE-2026-999999' where id = v_entry_id;
    return query select 'bypass_manual_entry_number'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_manual_entry_number'::text, true, sqlerrm;
    when others then
      return query select 'bypass_manual_entry_number'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set entry_date = '2026-11-01' where id = v_other_id;
    return query select 'bypass_change_date_after_submit'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_change_date_after_submit'::text, true, sqlerrm;
    when others then
      return query select 'bypass_change_date_after_submit'::text, false, sqlerrm;
  end;

  begin
    insert into public.finance_journal_lines (journal_entry_id, line_number, account_id, debit, credit)
    values (v_other_id, 9, v_cash, 1, 0);
    return query select 'bypass_insert_line_pending'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_insert_line_pending'::text, true, sqlerrm;
    when others then
      return query select 'bypass_insert_line_pending'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_lines set debit = 999 where id = v_line_id;
    return query select 'bypass_update_line_draft'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_update_line_draft'::text, true, sqlerrm;
    when others then
      return query select 'bypass_update_line_draft'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set description = 'Hack posted' where id = v_posted_id;
    return query select 'bypass_update_posted_entry'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_update_posted_entry'::text, true, sqlerrm;
    when others then
      return query select 'bypass_update_posted_entry'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set period_id = v_period where id = v_other_id;
    return query select 'bypass_change_period_after_submit'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_change_period_after_submit'::text, true, sqlerrm;
    when others then
      return query select 'bypass_change_period_after_submit'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set description = 'Hack pending' where id = v_other_id;
    return query select 'bypass_update_entry_pending'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_update_entry_pending'::text, true, sqlerrm;
    when others then
      return query select 'bypass_update_entry_pending'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries set description = 'Hack approved' where id = v_approved_id;
    return query select 'bypass_update_entry_approved'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_update_entry_approved'::text, true, sqlerrm;
    when others then
      return query select 'bypass_update_entry_approved'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_lines set debit = 888 where id = v_pending_line_id;
    return query select 'bypass_update_line_pending'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_update_line_pending'::text, true, sqlerrm;
    when others then
      return query select 'bypass_update_line_pending'::text, false, sqlerrm;
  end;

  begin
    delete from public.finance_journal_lines where id = v_line_id;
    return query select 'bypass_delete_line_draft'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_delete_line_draft'::text, true, sqlerrm;
    when others then
      return query select 'bypass_delete_line_draft'::text, false, sqlerrm;
  end;

  begin
    delete from public.finance_journal_lines where id = v_posted_line_id;
    return query select 'bypass_delete_line_posted'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_delete_line_posted'::text, true, sqlerrm;
    when others then
      return query select 'bypass_delete_line_posted'::text, false, sqlerrm;
  end;

  begin
    delete from public.finance_journal_entries where id = v_posted_id;
    return query select 'bypass_delete_posted_entry'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_delete_posted_entry'::text, true, sqlerrm;
    when others then
      return query select 'bypass_delete_posted_entry'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries
    set reversed_by_entry_id = gen_random_uuid()
    where id = v_posted_id;
    return query select 'bypass_tamper_reversed_by'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_tamper_reversed_by'::text, true, sqlerrm;
    when others then
      return query select 'bypass_tamper_reversed_by'::text, false, sqlerrm;
  end;

  begin
    update public.finance_journal_entries
    set reversal_of_id = v_posted_id
    where id = v_entry_id;
    return query select 'bypass_tamper_reversal_of'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_tamper_reversal_of'::text, true, sqlerrm;
    when others then
      return query select 'bypass_tamper_reversal_of'::text, false, sqlerrm;
  end;

  begin
    insert into public.finance_journal_entries (
      entry_date, period_id, description, status, entry_number, reversal_of_id, reversal_reason, posted_at
    ) values (
      '2026-11-07', v_period, 'Manual reversal', 'posted', 'JE-2026-888888', v_posted_id, 'hack', now()
    );
    return query select 'bypass_manual_reversal_insert'::text, false, 'should fail'::text;
  exception
    when insufficient_privilege then
      return query select 'bypass_manual_reversal_insert'::text, true, sqlerrm;
    when others then
      return query select 'bypass_manual_reversal_insert'::text, false, sqlerrm;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_contador::text, true);

  -- Trigger defense-in-depth as owner (service_role path)
  begin
    update public.finance_journal_entries set status = 'approved' where id = v_entry_id;
    return query select 'trigger_blocks_draft_to_approved'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_draft_to_approved'::text,
      sqlerrm like '%Transición%' or sqlerrm like '%inválida%', sqlerrm;
  end;

  begin
    update public.finance_journal_entries set status = 'posted', entry_number = 'JE-2026-777777'
    where id = v_entry_id;
    return query select 'trigger_blocks_draft_to_posted'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_draft_to_posted'::text,
      sqlerrm like '%Transición%' or sqlerrm like '%número%', sqlerrm;
  end;

  begin
    update public.finance_journal_entries set status = 'draft' where id = v_posted_id;
    return query select 'trigger_blocks_posted_status_change'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_posted_status_change'::text,
      sqlerrm like '%inmutables%' or sqlerrm like '%Transición%', sqlerrm;
  end;

  begin
    update public.finance_journal_entries set reversed_by_entry_id = gen_random_uuid() where id = v_posted_id;
    return query select 'trigger_blocks_reversal_link_tamper'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_reversal_link_tamper'::text,
      sqlerrm like '%reversión%' or sqlerrm like '%inmutables%', sqlerrm;
  end;

  begin
    update public.finance_journal_lines set debit = 1 where id = v_posted_line_id;
    return query select 'trigger_blocks_posted_line_mutation'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_posted_line_mutation'::text,
      sqlerrm like '%borrador%' or sqlerrm like '%inmutables%', sqlerrm;
  end;

  -- -------------------------------------------------------------------------
  -- 2. State flow via RPC
  -- -------------------------------------------------------------------------
  begin
    perform public.approve_finance_journal_entry(v_entry_id);
    return query select 'rpc_rejects_draft_to_approved'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rpc_rejects_draft_to_approved'::text, sqlerrm like '%pendientes%', sqlerrm;
  end;

  begin
    perform public.post_finance_journal_entry(v_entry_id);
    return query select 'rpc_rejects_draft_to_posted'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rpc_rejects_draft_to_posted'::text, sqlerrm like '%aprobadas%', sqlerrm;
  end;

  begin
    perform public.post_finance_journal_entry(v_other_id);
    return query select 'rpc_rejects_pending_to_posted'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rpc_rejects_pending_to_posted'::text, sqlerrm like '%aprobadas%', sqlerrm;
  end;

  v_entry_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-09', 'description', 'Approved rollback test'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 10, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 10)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);

  begin
    update public.finance_journal_entries set status = 'draft' where id = v_entry_id;
    return query select 'trigger_blocks_approved_to_draft'::text, false, 'should fail'::text;
  exception when others then
    return query select 'trigger_blocks_approved_to_draft'::text, sqlerrm like '%Transición%', sqlerrm;
  end;

  begin
    perform public.post_finance_journal_entry(v_posted_id);
    return query select 'rpc_rejects_double_post'::text, false, 'should fail'::text;
  exception when others then
    return query select 'rpc_rejects_double_post'::text, sqlerrm like '%aprobadas%', sqlerrm;
  end;

  begin
    perform public.reject_finance_journal_entry(v_other_id, '  ');
    return query select 'reject_requires_reason'::text, false, 'should fail'::text;
  exception when others then
    return query select 'reject_requires_reason'::text, sqlerrm like '%motivo%', sqlerrm;
  end;

  perform public.reject_finance_journal_entry(v_other_id, 'Corregir montos');
  return query select 'reject_stores_audit_fields'::text,
    exists (
      select 1 from public.finance_journal_entries je
      where je.id = v_other_id
        and je.status = 'draft'
        and je.rejected_by = v_contador
        and je.rejected_at is not null
        and je.rejection_reason = 'Corregir montos'
    ),
    'rejected audit'::text;

  begin
    perform public.reverse_finance_journal_entry(v_posted_id, '   ');
    return query select 'reversal_requires_reason'::text, false, 'should fail'::text;
  exception when others then
    return query select 'reversal_requires_reason'::text, sqlerrm like '%motivo%', sqlerrm;
  end;

  v_posted_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-08', 'description', 'Reversal audit target'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_posted_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 15, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 15)
  ));
  perform public.submit_finance_journal_entry(v_posted_id);
  perform public.approve_finance_journal_entry(v_posted_id);
  perform public.post_finance_journal_entry(v_posted_id);
  perform public.reverse_finance_journal_entry(v_posted_id, 'Auditoría reversión', '2026-11-08'::date);
  return query select 'reversal_stores_audit_fields'::text,
    exists (
      select 1 from public.finance_journal_entries je
      where je.reversal_of_id = v_posted_id
        and je.reversal_reason = 'Auditoría reversión'
        and je.posted_by = v_contador
        and je.posted_at is not null
    ),
    'reversal audit'::text;

  -- Valid transitions smoke
  v_entry_id := (public.create_finance_journal_draft(jsonb_build_object(
    'entry_date', '2026-11-10', 'description', 'Valid flow'
  )) ->> 'id')::uuid;
  perform public.replace_finance_journal_lines(v_entry_id, jsonb_build_array(
    jsonb_build_object('line_number', 1, 'account_id', v_cash::text, 'debit', 12, 'credit', 0),
    jsonb_build_object('line_number', 2, 'account_id', v_equity::text, 'debit', 0, 'credit', 12)
  ));
  perform public.submit_finance_journal_entry(v_entry_id);
  perform public.approve_finance_journal_entry(v_entry_id);
  perform public.post_finance_journal_entry(v_entry_id);
  return query select 'valid_state_flow'::text,
    (select status from public.finance_journal_entries where id = v_entry_id) = 'posted',
    'posted'::text;

  return;
end;
$$;

create or replace function public.test_finance_journal_sql_security()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_name text;
  v_ok boolean;
  v_definer boolean;
  v_search_path_ok boolean;
  v_expected_definer text[] := array[
    'can_view_accounting', 'can_create_journal', 'can_approve_journal', 'can_post_journal',
    'can_post_journal_in_soft_closed_period', 'can_reverse_journal', 'accounting_journal_branch_scope',
    'finance_journal_resolve_period', 'finance_journal_next_entry_number',
    'finance_journal_validate_cost_center_branch', 'finance_journal_validate_line',
    'finance_journal_validate_entry_balance', 'finance_journal_assert_postable_period',
    'create_finance_journal_draft', 'replace_finance_journal_lines', 'submit_finance_journal_entry',
    'reject_finance_journal_entry', 'approve_finance_journal_entry', 'post_finance_journal_entry',
    'reverse_finance_journal_entry', 'get_finance_journal_entry', 'list_finance_journal_entries',
    'set_finance_accounting_period_status'
  ];
  v_internal text[] := array[
    'finance_journal_line_row_to_json', 'finance_journal_entry_row_to_json',
    'finance_journal_entry_guard_transitions', 'finance_journal_entry_block_posted_mutation',
    'finance_journal_line_block_posted_parent'
  ];
begin
  foreach v_name in array v_expected_definer loop
    select p.prosecdef,
      coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
    into v_definer, v_search_path_ok
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = v_name
    limit 1;
    v_ok := coalesce(v_definer, false) and coalesce(v_search_path_ok, false);
    return query select ('security_definer_' || v_name)::text, v_ok,
      case when v_ok then 'ok' else coalesce(v_definer::text, 'missing') end;
  end loop;

  foreach v_name in array v_internal loop
    select not exists (
      select 1 from information_schema.routine_privileges rp
      where rp.routine_schema = 'public'
        and rp.routine_name = v_name
        and rp.grantee in ('PUBLIC', 'authenticated')
        and rp.privilege_type = 'EXECUTE'
    ) into v_ok;
    return query select ('internal_not_exposed_' || v_name)::text, v_ok,
      case when v_ok then 'no public/authenticated execute' else 'EXPOSED' end;
  end loop;

  select not exists (
    select 1 from information_schema.table_privileges tp
    where tp.table_schema = 'public'
      and tp.table_name in ('finance_journal_entries', 'finance_journal_lines')
      and tp.grantee = 'authenticated'
      and tp.privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) into v_ok;
  return query select 'authenticated_no_table_writes'::text, v_ok,
    case when v_ok then 'select only' else 'WRITE GRANT LEAK' end;

  select not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'finance_journal%'
      and pg_get_functiondef(p.oid) ilike '%execute %'
      and pg_get_functiondef(p.oid) not ilike '%execute function%'
  ) into v_ok;
  return query select 'no_dynamic_sql_in_journal_funcs'::text, v_ok, 'static sql only'::text;

  return;
end;
$$;

create or replace function public.test_finance_journal_lock_definitions()
returns table (scenario text, passed boolean, detail text)
language sql
security invoker
set search_path = public
as $$
  select 'post_locks_entry_for_update'::text,
    pg_get_functiondef(p.oid) ilike '%from public.finance_journal_entries where id = p_id for update%',
    'post_finance_journal_entry'::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'post_finance_journal_entry'
  union all
  select 'post_locks_period_for_update'::text,
    pg_get_functiondef(p.oid) ilike '%finance_accounting_periods%for update%',
    'post_finance_journal_entry'::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'post_finance_journal_entry'
  union all
  select 'period_status_locks_period_for_update'::text,
    pg_get_functiondef(p.oid) ilike '%finance_accounting_periods where id = p_id for update%',
    'set_finance_accounting_period_status'::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'set_finance_accounting_period_status'
  union all
  select 'reverse_locks_original_for_update'::text,
    pg_get_functiondef(p.oid) ilike '%finance_journal_entries%for update%',
    'reverse_finance_journal_entry'::text
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'reverse_finance_journal_entry';
$$;

with results as materialized (
  select * from public.test_finance_journal_adversarial()
  union all
  select * from public.test_finance_journal_sql_security()
  union all
  select * from public.test_finance_journal_lock_definitions()
)
select r.scenario, r.passed, r.detail,
  count(*) over () as total,
  count(*) filter (where r.passed) over () as passed_total,
  count(*) filter (where not r.passed) over () as failed_total
from results r
order by r.passed asc, r.scenario;

drop function if exists public.test_finance_journal_adversarial();
drop function if exists public.test_finance_journal_sql_security();
drop function if exists public.test_finance_journal_lock_definitions();

rollback;
