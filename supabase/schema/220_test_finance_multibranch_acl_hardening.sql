-- ACL hardening verification for 220. Not a migration.
-- Requires 202, 219 and 203 already applied, in that order.
-- The lab must simulate Supabase function default EXECUTE for anon,
-- authenticated and service_role before those migrations.
-- Runs inside one transaction and rolls it back.
\set ON_ERROR_STOP on

begin;

create temp table acl220_case (
  scenario text primary key,
  passed boolean not null,
  detail text not null
);

create function pg_temp.acl220_digest()
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
      'can_manage_accounting_structure',
      'can_manage_accounting_periods',
      'can_close_accounting_period',
      'can_reopen_accounting_period',
      'list_branches',
      'create_branch',
      'update_branch',
      'set_branch_active',
      'set_branch_main',
      'list_finance_cost_centers',
      'create_finance_cost_center',
      'update_finance_cost_center',
      'set_finance_cost_center_active',
      'list_finance_accounting_periods',
      'create_finance_accounting_period',
      'set_finance_accounting_period_status',
      'reopen_finance_accounting_period',
      'branch_normalize_code',
      'finance_cost_center_normalize_code',
      'finance_cost_center_assert_branch_hierarchy',
      'finance_chart_account_default_branch_dimension_rule',
      'finance_chart_account_default_cost_center_dimension_rule',
      'finance_chart_account_validate_dimension_rule',
      'finance_cost_center_parent_level',
      'finance_cost_center_assert_no_cycle',
      'finance_accounting_period_bounds',
      'branch_row_to_json',
      'finance_cost_center_row_to_json',
      'finance_accounting_period_row_to_json'
    );
$$;

create function pg_temp.acl220_body_digest()
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
      'can_manage_accounting_structure',
      'can_manage_accounting_periods',
      'can_close_accounting_period',
      'can_reopen_accounting_period',
      'list_branches',
      'create_branch',
      'update_branch',
      'set_branch_active',
      'set_branch_main',
      'list_finance_cost_centers',
      'create_finance_cost_center',
      'update_finance_cost_center',
      'set_finance_cost_center_active',
      'list_finance_accounting_periods',
      'create_finance_accounting_period',
      'set_finance_accounting_period_status',
      'reopen_finance_accounting_period',
      'branch_normalize_code',
      'finance_cost_center_normalize_code',
      'finance_cost_center_assert_branch_hierarchy',
      'finance_chart_account_default_branch_dimension_rule',
      'finance_chart_account_default_cost_center_dimension_rule',
      'finance_chart_account_validate_dimension_rule',
      'finance_cost_center_parent_level',
      'finance_cost_center_assert_no_cycle',
      'finance_accounting_period_bounds',
      'branch_row_to_json',
      'finance_cost_center_row_to_json',
      'finance_accounting_period_row_to_json',
      'create_finance_chart_account',
      'update_finance_chart_account',
      'import_finance_chart_accounts',
      'finance_chart_account_row_to_json'
    );
$$;

do $before$
declare
  v_count int;
  v_public boolean;
  v_anon boolean;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_manage_accounting_structure','can_manage_accounting_periods',
      'can_close_accounting_period','can_reopen_accounting_period',
      'list_branches','create_branch','update_branch','set_branch_active','set_branch_main',
      'list_finance_cost_centers','create_finance_cost_center','update_finance_cost_center',
      'set_finance_cost_center_active','list_finance_accounting_periods',
      'create_finance_accounting_period','set_finance_accounting_period_status',
      'reopen_finance_accounting_period','branch_normalize_code',
      'finance_cost_center_normalize_code','finance_cost_center_assert_branch_hierarchy',
      'finance_chart_account_default_branch_dimension_rule',
      'finance_chart_account_default_cost_center_dimension_rule',
      'finance_chart_account_validate_dimension_rule','finance_cost_center_parent_level',
      'finance_cost_center_assert_no_cycle','finance_accounting_period_bounds',
      'branch_row_to_json','finance_cost_center_row_to_json',
      'finance_accounting_period_row_to_json'
    );
  insert into acl220_case values (
    'signature_count_before',
    v_count = 29,
    v_count::text
  );

  select
    p.proacl is null or exists (
      select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'
    ),
    has_function_privilege('anon', p.oid, 'EXECUTE')
  into v_public, v_anon
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'finance_accounting_period_bounds';

  insert into acl220_case values
    ('period_bounds_public_before', v_public, coalesce(v_public::text, 'null')),
    ('period_bounds_anon_before', v_anon, coalesce(v_anon::text, 'null'));

  insert into acl220_case
  select
    'vulnerable_anon_' || p.proname,
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_manage_accounting_structure','list_branches','create_branch',
      'finance_cost_center_parent_level','finance_cost_center_assert_no_cycle',
      'finance_cost_center_assert_branch_hierarchy','finance_accounting_period_bounds'
    );

  insert into acl220_case values
    (
      'chart_create_anon_still_denied',
      not has_function_privilege('anon', 'public.create_finance_chart_account(jsonb)'::regprocedure, 'EXECUTE'),
      'create'
    ),
    (
      'chart_update_authenticated_kept',
      has_function_privilege('authenticated', 'public.update_finance_chart_account(uuid,jsonb)'::regprocedure, 'EXECUTE'),
      'update'
    ),
    (
      'chart_import_authenticated_kept',
      has_function_privilege('authenticated', 'public.import_finance_chart_accounts(jsonb)'::regprocedure, 'EXECUTE'),
      'import'
    ),
    (
      'chart_row_json_authenticated_denied',
      not has_function_privilege('authenticated', 'public.finance_chart_account_row_to_json(public.finance_chart_accounts)'::regprocedure, 'EXECUTE'),
      'row_to_json'
    );
end
$before$;

select pg_temp.acl220_body_digest() as body_before \gset
select pg_temp.acl220_digest() as acl_before \gset
select count(*) as branches_before from public.branches \gset
select count(*) as chart_before from public.finance_chart_accounts \gset

\ir 220_finance_multibranch_acl_hardening.sql
select pg_temp.acl220_digest() as acl_safe \gset
\ir 220_finance_multibranch_acl_hardening.sql
select pg_temp.acl220_digest() as acl_again \gset
\ir ../rollback/220_finance_multibranch_acl_hardening.rollback.sql
select pg_temp.acl220_digest() as acl_restored \gset
\ir 220_finance_multibranch_acl_hardening.sql
select pg_temp.acl220_digest() as acl_final \gset
select pg_temp.acl220_body_digest() as body_after \gset
select count(*) as branches_after from public.branches \gset
select count(*) as chart_after from public.finance_chart_accounts \gset

insert into acl220_case values
  ('idempotent_digest', :'acl_safe' = :'acl_again', 'digest'),
  ('rollback_restores_previous', :'acl_before' = :'acl_restored', 'digest'),
  ('reapply_matches_safe', :'acl_safe' = :'acl_final', 'digest'),
  ('bodies_unchanged', :'body_before' = :'body_after', 'body'),
  ('branch_count_unchanged', :'branches_before' = :'branches_after', :'branches_after'),
  ('chart_count_unchanged', :'chart_before' = :'chart_after', :'chart_after');

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
        'can_manage_accounting_structure','can_manage_accounting_periods',
        'can_close_accounting_period','can_reopen_accounting_period',
        'list_branches','create_branch','update_branch','set_branch_active','set_branch_main',
        'list_finance_cost_centers','create_finance_cost_center','update_finance_cost_center',
        'set_finance_cost_center_active','list_finance_accounting_periods',
        'create_finance_accounting_period','set_finance_accounting_period_status',
        'reopen_finance_accounting_period','branch_normalize_code',
        'finance_cost_center_normalize_code','finance_cost_center_assert_branch_hierarchy',
        'finance_chart_account_default_branch_dimension_rule',
        'finance_chart_account_default_cost_center_dimension_rule',
        'finance_chart_account_validate_dimension_rule','finance_cost_center_parent_level',
        'finance_cost_center_assert_no_cycle','finance_accounting_period_bounds',
        'branch_row_to_json','finance_cost_center_row_to_json',
        'finance_accounting_period_row_to_json'
      )
  loop
    v_external := r.proname in (
      'can_manage_accounting_structure','can_manage_accounting_periods',
      'can_close_accounting_period','can_reopen_accounting_period',
      'list_branches','create_branch','update_branch','set_branch_active','set_branch_main',
      'list_finance_cost_centers','create_finance_cost_center','update_finance_cost_center',
      'set_finance_cost_center_active','list_finance_accounting_periods',
      'create_finance_accounting_period','set_finance_accounting_period_status',
      'reopen_finance_accounting_period'
    );
    select
      p.proacl is null or exists (
        select 1 from aclexplode(p.proacl) x where x.grantee = 0 and x.privilege_type = 'EXECUTE'
      )
    into v_public
    from pg_proc p where p.oid = r.oid;
    v_anon := has_function_privilege('anon', r.oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_service := has_function_privilege('service_role', r.oid, 'EXECUTE');
    v_owner := has_function_privilege(r.owner_name, r.oid, 'EXECUTE');
    insert into acl220_case values
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
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Audit', 'admin_audit_220', 'admin', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Gerente Audit', 'gerente_audit_220', 'gerente_general', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mesero Audit', 'mesero_audit_220', 'mesero', 'active')
on conflict (id) do update
set role = excluded.role, status = excluded.status, username = excluded.username;
set local session_replication_role = origin;

do $behavior$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_gerente uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_sqlstate text;
  v_message text;
  v_seen int;
begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    set local role anon;
    perform public.finance_cost_center_parent_level('00000000-0000-0000-0000-000000000099'::uuid);
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('anon_parent_level_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  begin
    set local role anon;
    perform public.list_branches();
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('anon_list_branches_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin
    set local role authenticated;
    perform public.finance_cost_center_assert_no_cycle(
      '00000000-0000-0000-0000-000000000099'::uuid,
      '00000000-0000-0000-0000-000000000098'::uuid
    );
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('admin_helper_42501', v_sqlstate = '42501', coalesce(v_message, ''));

  begin
    set local role authenticated;
    perform public.list_branches();
    v_sqlstate := 'ok';
    v_message := 'list ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('admin_can_list_branches', v_sqlstate = 'ok', coalesce(v_message, ''));

  begin
    set local role authenticated;
    perform public.create_branch(jsonb_build_object('code', 'ACL220', 'name', 'Sucursal ACL'));
    v_sqlstate := 'ok';
    v_message := 'create ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('admin_can_create_branch', v_sqlstate = 'ok', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    perform public.list_branches();
    v_sqlstate := 'executed';
    v_message := 'returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values (
    'mesero_list_rejected',
    v_sqlstate <> '42501' and v_message like '%permiso%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    set local role authenticated;
    insert into public.branches (code, name) values ('ACL220-RLS', 'Policy');
    v_sqlstate := 'ok';
    v_message := 'insert ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values ('admin_rls_insert', v_sqlstate = 'ok', coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  begin
    set local role authenticated;
    select count(*) into v_seen from public.branches where code in ('ACL220', 'ACL220-RLS');
    v_sqlstate := 'ok';
    v_message := v_seen::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_seen := -1;
  end;
  reset role;
  insert into acl220_case values ('gerente_sees_branches', v_sqlstate = 'ok' and v_seen = 2, coalesce(v_message, ''));

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    insert into public.branches (code, name) values ('ACL220-NO', 'Denegada');
    v_sqlstate := 'executed';
    v_message := 'inserted';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl220_case values (
    'mesero_rls_insert_denied',
    v_message ilike '%row-level security%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );
end
$behavior$;

select scenario, passed, detail from acl220_case order by scenario;

do $fail$
declare
  v_failed text;
  v_passed int;
  v_total int;
begin
  select count(*) filter (where passed), count(*) into v_passed, v_total from acl220_case;
  select string_agg(scenario || '=' || detail, ' | ' order by scenario)
    into v_failed
  from acl220_case
  where not passed;
  if v_failed is not null then
    raise exception '220_test failed: %', v_failed;
  end if;
  raise notice 'OK 220_test passed_rows=% failed_rows=0 total=%', v_passed, v_total;
end
$fail$;

rollback;
