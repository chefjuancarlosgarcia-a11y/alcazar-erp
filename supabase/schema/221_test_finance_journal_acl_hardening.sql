-- ACL hardening verification for 221. Not a migration.
-- Requires 202, 219, 203, 220 and 204 already applied.
-- The lab must simulate Supabase function default EXECUTE.
-- Runs inside one transaction and rolls it back.
\set ON_ERROR_STOP on

begin;

create temp table acl221_case (
  scenario text primary key,
  passed boolean not null,
  detail text not null
);

create function pg_temp.acl221_digest()
returns text
language sql
stable
as $$
  select coalesce(string_agg(
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')=' || coalesce((
      select string_agg(
        coalesce(gr.rolname, 'PUBLIC') || ':' || priv.privilege_type,
        ',' order by coalesce(gr.rolname, 'PUBLIC'), priv.privilege_type
      )
      from aclexplode(p.proacl) priv
      left join pg_roles gr on gr.oid = priv.grantee
      where priv.privilege_type = 'EXECUTE'
    ), 'none'),
    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)
  ), '')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_view_accounting','can_create_journal','can_approve_journal','can_post_journal',
      'can_post_journal_in_soft_closed_period','can_reverse_journal','accounting_journal_branch_scope',
      'finance_journal_entry_guard_transitions','finance_journal_entry_block_posted_mutation',
      'finance_journal_line_block_posted_parent','finance_journal_resolve_period',
      'finance_journal_next_entry_number','finance_journal_validate_cost_center_branch',
      'finance_journal_validate_line','finance_journal_validate_entry_balance',
      'finance_journal_assert_postable_period','finance_journal_line_row_to_json',
      'finance_journal_entry_row_to_json','create_finance_journal_draft',
      'replace_finance_journal_lines','submit_finance_journal_entry','reject_finance_journal_entry',
      'approve_finance_journal_entry','post_finance_journal_entry','reverse_finance_journal_entry',
      'get_finance_journal_entry','list_finance_journal_entries'
    );
$$;

create function pg_temp.acl221_body_digest()
returns text
language sql
stable
as $$
  select coalesce(string_agg(
    p.proname || ':' || p.proowner::text || ':' || p.prosecdef::text || ':' ||
    coalesce(p.proconfig::text, '') || ':' || md5(p.prosrc),
    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)
  ), '')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_view_accounting','can_create_journal','can_approve_journal','can_post_journal',
      'can_post_journal_in_soft_closed_period','can_reverse_journal','accounting_journal_branch_scope',
      'finance_journal_entry_guard_transitions','finance_journal_entry_block_posted_mutation',
      'finance_journal_line_block_posted_parent','finance_journal_resolve_period',
      'finance_journal_next_entry_number','finance_journal_validate_cost_center_branch',
      'finance_journal_validate_line','finance_journal_validate_entry_balance',
      'finance_journal_assert_postable_period','finance_journal_line_row_to_json',
      'finance_journal_entry_row_to_json','create_finance_journal_draft',
      'replace_finance_journal_lines','submit_finance_journal_entry','reject_finance_journal_entry',
      'approve_finance_journal_entry','post_finance_journal_entry','reverse_finance_journal_entry',
      'get_finance_journal_entry','list_finance_journal_entries',
      'set_finance_accounting_period_status'
    );
$$;

do $before$
declare
  v_count int;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_view_accounting','can_create_journal','can_approve_journal','can_post_journal',
      'can_post_journal_in_soft_closed_period','can_reverse_journal','accounting_journal_branch_scope',
      'finance_journal_entry_guard_transitions','finance_journal_entry_block_posted_mutation',
      'finance_journal_line_block_posted_parent','finance_journal_resolve_period',
      'finance_journal_next_entry_number','finance_journal_validate_cost_center_branch',
      'finance_journal_validate_line','finance_journal_validate_entry_balance',
      'finance_journal_assert_postable_period','finance_journal_line_row_to_json',
      'finance_journal_entry_row_to_json','create_finance_journal_draft',
      'replace_finance_journal_lines','submit_finance_journal_entry','reject_finance_journal_entry',
      'approve_finance_journal_entry','post_finance_journal_entry','reverse_finance_journal_entry',
      'get_finance_journal_entry','list_finance_journal_entries'
    );
  insert into acl221_case values ('signature_count_before', v_count = 27, v_count::text);

  insert into acl221_case
  select 'vulnerable_anon_' || p.proname, has_function_privilege('anon', p.oid, 'EXECUTE'), p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_view_accounting','can_create_journal','finance_journal_resolve_period',
      'finance_journal_next_entry_number','finance_journal_assert_postable_period',
      'create_finance_journal_draft','list_finance_journal_entries',
      'finance_journal_entry_guard_transitions'
    );

  insert into acl221_case values (
    'period_status_acl_survived_204',
    not has_function_privilege('anon', 'public.set_finance_accounting_period_status(uuid,text)'::regprocedure, 'EXECUTE')
      and has_function_privilege('authenticated', 'public.set_finance_accounting_period_status(uuid,text)'::regprocedure, 'EXECUTE'),
    'set_status'
  );
end
$before$;

select pg_temp.acl221_body_digest() as body_before \gset
select pg_temp.acl221_digest() as acl_before \gset
select count(*) as entries_before from public.finance_journal_entries \gset
select count(*) as lines_before from public.finance_journal_lines \gset
select count(*) as counters_before from public.finance_journal_entry_counters \gset

\ir 221_finance_journal_acl_hardening.sql
select pg_temp.acl221_digest() as acl_safe \gset
\ir 221_finance_journal_acl_hardening.sql
select pg_temp.acl221_digest() as acl_again \gset
\ir ../rollback/221_finance_journal_acl_hardening.rollback.sql
select pg_temp.acl221_digest() as acl_restored \gset
\ir 221_finance_journal_acl_hardening.sql
select pg_temp.acl221_digest() as acl_final \gset
select pg_temp.acl221_body_digest() as body_after \gset
select count(*) as entries_after from public.finance_journal_entries \gset
select count(*) as lines_after from public.finance_journal_lines \gset
select count(*) as counters_after from public.finance_journal_entry_counters \gset

insert into acl221_case values
  ('idempotent_digest', :'acl_safe' = :'acl_again', 'digest'),
  ('rollback_restores_previous', :'acl_before' = :'acl_restored', 'digest'),
  ('reapply_matches_safe', :'acl_safe' = :'acl_final', 'digest'),
  ('bodies_unchanged', :'body_before' = :'body_after', 'body'),
  ('entries_unchanged', :'entries_before' = :'entries_after', :'entries_after'),
  ('lines_unchanged', :'lines_before' = :'lines_after', :'lines_after'),
  ('counters_unchanged', :'counters_before' = :'counters_after', :'counters_after');

do $priv$
declare
  r record;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_service boolean;
  v_owner boolean;
  v_external boolean;
begin
  for r in
    select p.oid, p.proname, pg_get_userbyid(p.proowner) as owner_name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'can_view_accounting','can_create_journal','can_approve_journal','can_post_journal',
        'can_post_journal_in_soft_closed_period','can_reverse_journal','accounting_journal_branch_scope',
        'finance_journal_entry_guard_transitions','finance_journal_entry_block_posted_mutation',
        'finance_journal_line_block_posted_parent','finance_journal_resolve_period',
        'finance_journal_next_entry_number','finance_journal_validate_cost_center_branch',
        'finance_journal_validate_line','finance_journal_validate_entry_balance',
        'finance_journal_assert_postable_period','finance_journal_line_row_to_json',
        'finance_journal_entry_row_to_json','create_finance_journal_draft',
        'replace_finance_journal_lines','submit_finance_journal_entry','reject_finance_journal_entry',
        'approve_finance_journal_entry','post_finance_journal_entry','reverse_finance_journal_entry',
        'get_finance_journal_entry','list_finance_journal_entries'
      )
  loop
    v_external := r.proname in (
      'can_view_accounting','create_finance_journal_draft','replace_finance_journal_lines',
      'submit_finance_journal_entry','reject_finance_journal_entry','approve_finance_journal_entry',
      'post_finance_journal_entry','reverse_finance_journal_entry','get_finance_journal_entry',
      'list_finance_journal_entries'
    );
    select p.proacl is null or exists (
      select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'
    ) into v_public from pg_proc p where p.oid = r.oid;
    v_anon := has_function_privilege('anon', r.oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_service := has_function_privilege('service_role', r.oid, 'EXECUTE');
    v_owner := has_function_privilege(r.owner_name, r.oid, 'EXECUTE');
    insert into acl221_case values
      ('public_denied_' || r.proname, not v_public, r.proname),
      ('anon_denied_' || r.proname, not v_anon, r.proname),
      ('owner_kept_' || r.proname, v_owner and r.owner_name = 'postgres', r.owner_name),
      (
        case when v_external then 'authenticated_kept_' else 'authenticated_denied_' end || r.proname,
        v_auth = v_external,
        r.proname
      ),
      (
        case when v_external then 'service_role_kept_' else 'service_role_denied_' end || r.proname,
        v_service = v_external,
        r.proname
      );
  end loop;
end
$priv$;

set local session_replication_role = replica;
insert into public.profiles (id, full_name, username, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Audit', 'admin_audit_221', 'admin', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mesero Audit', 'mesero_audit_221', 'mesero', 'active')
on conflict (id) do update
set role = excluded.role, status = excluded.status, username = excluded.username;
set local session_replication_role = origin;

do $behavior$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_sqlstate text;
  v_message text;
  v_seen int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    set local role anon;
    perform public.finance_journal_resolve_period(current_date);
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values ('anon_resolve_period_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  begin
    set local role anon;
    perform public.list_finance_journal_entries();
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values ('anon_list_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    set local role authenticated;
    perform public.finance_journal_next_entry_number(2026);
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values ('admin_helper_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  begin
    set local role authenticated;
    perform public.list_finance_journal_entries();
    v_sqlstate := 'ok';
    v_message := 'list ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values ('admin_can_list', v_sqlstate = 'ok', coalesce(v_message, ''));

  begin
    set local role authenticated;
    perform public.create_finance_journal_draft('{}'::jsonb);
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values (
    'admin_create_reaches_business_check',
    v_sqlstate <> '42501',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    perform public.list_finance_journal_entries();
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values (
    'mesero_list_rejected',
    v_sqlstate <> '42501' and v_message like '%permiso%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  begin
    set local role service_role;
    perform public.finance_journal_resolve_period(current_date);
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl221_case values ('service_role_helper_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    set local role authenticated;
    select count(*) into v_seen from public.finance_journal_entries;
    v_sqlstate := 'ok';
    v_message := v_seen::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_seen := -1;
  end;
  reset role;
  insert into acl221_case values ('admin_rls_select', v_sqlstate = 'ok', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    select count(*) into v_seen from public.finance_journal_entries;
    v_sqlstate := 'ok';
    v_message := v_seen::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_seen := -1;
  end;
  reset role;
  insert into acl221_case values (
    'mesero_rls_select_empty',
    v_sqlstate = 'ok' and v_seen = 0,
    coalesce(v_message, '')
  );
end
$behavior$;

select scenario, passed, detail from acl221_case order by scenario;

do $fail$
declare
  v_failed text;
  v_passed int;
  v_total int;
begin
  select count(*) filter (where passed), count(*) into v_passed, v_total from acl221_case;
  select string_agg(scenario || '=' || detail, ' | ' order by scenario)
    into v_failed
  from acl221_case
  where not passed;
  if v_failed is not null then
    raise exception '221_test failed: %', v_failed;
  end if;
  raise notice 'OK 221_test passed_rows=% failed_rows=0 total=%', v_passed, v_total;
end
$fail$;

rollback;
