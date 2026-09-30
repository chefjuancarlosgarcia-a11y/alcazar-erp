-- ACL hardening verification for 219. Not a migration.
-- Requires 202 already applied. Runs inside one transaction and rolls it back.
-- psql: \ir paths are relative to this file.
\set ON_ERROR_STOP on

begin;

create temp table acl219_case (
  scenario text primary key,
  passed boolean not null,
  detail text not null
);

create function pg_temp.chart_acl_digest()
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
      'can_manage_accounting_catalog',
      'finance_chart_account_normalize_code',
      'finance_chart_account_parent_level',
      'finance_chart_account_assert_no_cycle',
      'finance_chart_account_row_to_json',
      'list_finance_chart_accounts',
      'create_finance_chart_account',
      'update_finance_chart_account',
      'set_finance_chart_account_active',
      'preview_finance_chart_accounts_import',
      'finance_chart_import_would_cycle',
      'import_finance_chart_accounts',
      'finance_chart_import_sort_rows'
    );
$$;

create function pg_temp.chart_body_digest()
returns text
language sql
stable
as $$
  select coalesce(string_agg(
    p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):' ||
    p.proowner::text || ':' || p.prosecdef::text || ':' ||
    coalesce(p.proconfig::text, '') || ':' || md5(p.prosrc),
    '|' order by p.proname, pg_get_function_identity_arguments(p.oid)
  ), '')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'can_manage_accounting_catalog',
      'finance_chart_account_normalize_code',
      'finance_chart_account_parent_level',
      'finance_chart_account_assert_no_cycle',
      'finance_chart_account_row_to_json',
      'list_finance_chart_accounts',
      'create_finance_chart_account',
      'update_finance_chart_account',
      'set_finance_chart_account_active',
      'preview_finance_chart_accounts_import',
      'finance_chart_import_would_cycle',
      'import_finance_chart_accounts',
      'finance_chart_import_sort_rows'
    );
$$;

create temp table acl219_before as
select
  pg_temp.chart_body_digest() as body_digest,
  (select count(*) from public.finance_chart_accounts) as chart_count,
  (select count(*) from public.profiles) as profile_count,
  c.relrowsecurity,
  c.relforcerowsecurity,
  c.relowner,
  c.relacl::text as table_acl,
  (
    select md5(string_agg(
      pol.polname || ':' || pol.polcmd::text || ':' ||
      coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ':' ||
      coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
      '|' order by pol.polname
    ))
    from pg_policy pol
    where pol.polrelid = c.oid
  ) as policy_hash
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'finance_chart_accounts';

\ir ../rollback/219_finance_accounting_acl_hardening.rollback.sql

create temp table acl219_previous as
select pg_temp.chart_acl_digest() as acl_digest;

\ir 219_finance_accounting_acl_hardening.sql

create temp table acl219_safe as
select pg_temp.chart_acl_digest() as acl_digest;

\ir 219_finance_accounting_acl_hardening.sql

insert into acl219_case (scenario, passed, detail)
select
  'hardening_twice_same_acl',
  pg_temp.chart_acl_digest() = (select acl_digest from acl219_safe),
  pg_temp.chart_acl_digest();

\ir ../rollback/219_finance_accounting_acl_hardening.rollback.sql

insert into acl219_case (scenario, passed, detail)
select
  'rollback_restores_previous_acl',
  pg_temp.chart_acl_digest() = (select acl_digest from acl219_previous),
  pg_temp.chart_acl_digest();

\ir 219_finance_accounting_acl_hardening.sql

insert into acl219_case (scenario, passed, detail)
select
  'reapply_after_rollback_matches_safe_acl',
  pg_temp.chart_acl_digest() = (select acl_digest from acl219_safe),
  pg_temp.chart_acl_digest();

insert into acl219_case (scenario, passed, detail)
select
  'bodies_owners_and_config_unchanged',
  pg_temp.chart_body_digest() = (select body_digest from acl219_before),
  'body digest compared';

insert into acl219_case (scenario, passed, detail)
select
  'chart_and_profile_rows_unchanged',
  (select count(*) from public.finance_chart_accounts) = (select chart_count from acl219_before)
    and (select count(*) from public.profiles) = (select profile_count from acl219_before),
  (select count(*)::text from public.finance_chart_accounts) || ' chart / ' ||
  (select count(*)::text from public.profiles) || ' profiles';

insert into acl219_case (scenario, passed, detail)
select
  'rls_policies_and_table_acl_unchanged',
  c.relrowsecurity = b.relrowsecurity
    and c.relforcerowsecurity = b.relforcerowsecurity
    and c.relowner = b.relowner
    and c.relacl::text is not distinct from b.table_acl
    and (
      select md5(string_agg(
        pol.polname || ':' || pol.polcmd::text || ':' ||
        coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || ':' ||
        coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''),
        '|' order by pol.polname
      ))
      from pg_policy pol
      where pol.polrelid = c.oid
    ) is not distinct from b.policy_hash,
  'rls ' || c.relrowsecurity::text
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join acl219_before b
where n.nspname = 'public'
  and c.relname = 'finance_chart_accounts';

insert into acl219_case (scenario, passed, detail)
select
  'signature_count_is_13',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'can_manage_accounting_catalog',
      'finance_chart_account_normalize_code',
      'finance_chart_account_parent_level',
      'finance_chart_account_assert_no_cycle',
      'finance_chart_account_row_to_json',
      'list_finance_chart_accounts',
      'create_finance_chart_account',
      'update_finance_chart_account',
      'set_finance_chart_account_active',
      'preview_finance_chart_accounts_import',
      'finance_chart_import_would_cycle',
      'import_finance_chart_accounts',
      'finance_chart_import_sort_rows'
    )) = 13,
  '13 signatures';

do $priv$
declare
  r record;
  v_public boolean;
  v_anon boolean;
  v_auth boolean;
  v_service boolean;
  v_expected_external boolean;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'can_manage_accounting_catalog',
        'finance_chart_account_normalize_code',
        'finance_chart_account_parent_level',
        'finance_chart_account_assert_no_cycle',
        'finance_chart_account_row_to_json',
        'list_finance_chart_accounts',
        'create_finance_chart_account',
        'update_finance_chart_account',
        'set_finance_chart_account_active',
        'preview_finance_chart_accounts_import',
        'finance_chart_import_would_cycle',
        'import_finance_chart_accounts',
        'finance_chart_import_sort_rows'
      )
  loop
    v_public := has_function_privilege('public', r.oid, 'EXECUTE');
    v_anon := has_function_privilege('anon', r.oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', r.oid, 'EXECUTE');
    v_service := has_function_privilege('service_role', r.oid, 'EXECUTE');
    v_expected_external := r.proname in (
      'can_manage_accounting_catalog',
      'list_finance_chart_accounts',
      'create_finance_chart_account',
      'update_finance_chart_account',
      'set_finance_chart_account_active',
      'preview_finance_chart_accounts_import',
      'import_finance_chart_accounts'
    );

    insert into acl219_case (scenario, passed, detail) values
      ('public_denied_' || r.proname, not v_public, r.proname || '(' || r.args || ')'),
      ('anon_denied_' || r.proname, not v_anon, r.proname || '(' || r.args || ')'),
      (
        case when v_expected_external then 'authenticated_kept_' else 'authenticated_denied_' end || r.proname,
        v_auth = v_expected_external,
        r.proname || '(' || r.args || ')'
      ),
      (
        case when v_expected_external then 'service_role_kept_' else 'service_role_denied_' end || r.proname,
        v_service = v_expected_external,
        r.proname || '(' || r.args || ')'
      );
  end loop;
end
$priv$;

set local session_replication_role = replica;
insert into public.profiles (id, full_name, username, role, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Admin Audit', 'admin_audit', 'admin', 'active'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Gerente Audit', 'gerente_audit', 'gerente_general', 'active'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mesero Audit', 'mesero_audit', 'mesero', 'active')
on conflict (id) do update
set role = excluded.role,
    status = excluded.status,
    username = excluded.username;
set local session_replication_role = origin;

do $behavior$
declare
  v_admin uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_gerente uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_mesero uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  r record;
  v_sqlstate text;
  v_message text;
  v_seen int;
begin
  for r in
    select * from (values
      ('parent_level', $sql$select public.finance_chart_account_parent_level('00000000-0000-0000-0000-000000000099'::uuid)$sql$),
      ('assert_no_cycle', $sql$select public.finance_chart_account_assert_no_cycle('00000000-0000-0000-0000-000000000099'::uuid, '00000000-0000-0000-0000-000000000098'::uuid)$sql$),
      ('sort_rows', $sql$select public.finance_chart_import_sort_rows('[{"codigo":"ZZ-PROBE","codigo_padre":"ZZ-PADRE"}]'::jsonb)$sql$),
      ('normalize_code', $sql$select public.finance_chart_account_normalize_code(' abc ')$sql$),
      ('would_cycle', $sql$select public.finance_chart_import_would_cycle('A', 'B', '[]'::jsonb)$sql$),
      ('row_to_json', $sql$select public.finance_chart_account_row_to_json(null::public.finance_chart_accounts)$sql$),
      ('list', $sql$select public.list_finance_chart_accounts()$sql$),
      ('create_empty', $sql$select public.create_finance_chart_account('{}'::jsonb)$sql$)
    ) as t(name, call_sql)
  loop
    begin
      execute 'set local role anon';
      execute r.call_sql;
      v_sqlstate := 'executed';
      v_message := 'call returned';
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    end;
    reset role;
    insert into acl219_case (scenario, passed, detail) values (
      'anon_cannot_execute_' || r.name,
      v_sqlstate = '42501',
      coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
    );
  end loop;

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  for r in
    select * from (values
      ('parent_level', $sql$select public.finance_chart_account_parent_level('00000000-0000-0000-0000-000000000099'::uuid)$sql$),
      ('assert_no_cycle', $sql$select public.finance_chart_account_assert_no_cycle('00000000-0000-0000-0000-000000000099'::uuid, '00000000-0000-0000-0000-000000000098'::uuid)$sql$),
      ('sort_rows', $sql$select public.finance_chart_import_sort_rows('[{"codigo":"ZZ-PROBE","codigo_padre":"ZZ-PADRE"}]'::jsonb)$sql$)
    ) as t(name, call_sql)
  loop
    begin
      execute 'set local role authenticated';
      execute r.call_sql;
      v_sqlstate := 'executed';
      v_message := 'call returned';
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    end;
    reset role;
    insert into acl219_case (scenario, passed, detail) values (
      'authenticated_cannot_execute_' || r.name,
      v_sqlstate = '42501',
      coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
    );
  end loop;

  begin
    set local role authenticated;
    perform public.list_finance_chart_accounts();
    v_sqlstate := 'ok';
    v_message := 'list ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'admin_can_list',
    v_sqlstate = 'ok',
    coalesce(v_message, '')
  );

  begin
    set local role authenticated;
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'ACL219-ADM',
      'name', 'Cuenta ACL',
      'financial_type', 'asset',
      'natural_balance', 'debit',
      'account_kind', 'detail',
      'accepts_entries', true
    ));
    v_sqlstate := 'ok';
    v_message := 'create ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'admin_can_create',
    v_sqlstate = 'ok',
    coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    perform public.list_finance_chart_accounts();
    v_sqlstate := 'executed';
    v_message := 'list returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'mesero_list_rejected',
    v_sqlstate <> '42501' and v_message like '%permiso%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  begin
    set local role authenticated;
    perform public.create_finance_chart_account(jsonb_build_object(
      'code', 'ACL219-BAD',
      'name', 'No debe crearse',
      'financial_type', 'asset',
      'natural_balance', 'debit',
      'account_kind', 'detail',
      'accepts_entries', true
    ));
    v_sqlstate := 'executed';
    v_message := 'create returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'mesero_create_rejected',
    v_sqlstate <> '42501' and v_message like '%permiso%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  for r in
    select * from (values
      ('parent_level', $sql$select public.finance_chart_account_parent_level('00000000-0000-0000-0000-000000000099'::uuid)$sql$),
      ('assert_no_cycle', $sql$select public.finance_chart_account_assert_no_cycle('00000000-0000-0000-0000-000000000099'::uuid, '00000000-0000-0000-0000-000000000098'::uuid)$sql$),
      ('sort_rows', $sql$select public.finance_chart_import_sort_rows('[{"codigo":"ZZ-PROBE","codigo_padre":"ZZ-PADRE"}]'::jsonb)$sql$)
    ) as t(name, call_sql)
  loop
    begin
      execute 'set local role service_role';
      execute r.call_sql;
      v_sqlstate := 'executed';
      v_message := 'call returned';
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    end;
    reset role;
    insert into acl219_case (scenario, passed, detail) values (
      'service_role_cannot_execute_' || r.name,
      v_sqlstate = '42501',
      coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
    );
  end loop;

  begin
    set local role service_role;
    perform public.list_finance_chart_accounts();
    v_sqlstate := 'ok';
    v_message := 'list ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'service_role_can_list_with_admin_jwt',
    v_sqlstate = 'ok',
    coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  begin
    set local role authenticated;
    insert into public.finance_chart_accounts (
      code, name, level, financial_type, natural_balance, account_kind, accepts_entries
    ) values (
      'ACL219-RLS', 'Insercion policy', 1, 'asset', 'debit', 'detail', true
    );
    v_sqlstate := 'ok';
    v_message := 'insert ok';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'admin_rls_insert_allowed',
    v_sqlstate = 'ok',
    coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_gerente::text, true);
  select count(*) into v_seen
  from public.finance_chart_accounts
  where code in ('ACL219-ADM', 'ACL219-RLS');
  reset role;
  begin
    set local role authenticated;
    select count(*) into v_seen
    from public.finance_chart_accounts
    where code in ('ACL219-ADM', 'ACL219-RLS');
    v_sqlstate := 'ok';
    v_message := v_seen::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_seen := -1;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'gerente_rls_select_sees_accounts',
    v_sqlstate = 'ok' and v_seen = 2,
    coalesce(v_message, '')
  );

  perform set_config('request.jwt.claim.sub', v_mesero::text, true);
  begin
    set local role authenticated;
    insert into public.finance_chart_accounts (
      code, name, level, financial_type, natural_balance, account_kind, accepts_entries
    ) values (
      'ACL219-NO', 'Denegada', 1, 'asset', 'debit', 'detail', true
    );
    v_sqlstate := 'executed';
    v_message := 'insert returned';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'mesero_rls_insert_rejected',
    v_message like '%row-level security%',
    coalesce(v_sqlstate, '') || ' ' || coalesce(v_message, '')
  );

  begin
    set local role authenticated;
    select count(*) into v_seen from public.finance_chart_accounts;
    v_sqlstate := 'ok';
    v_message := v_seen::text;
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
    v_seen := -1;
  end;
  reset role;
  insert into acl219_case (scenario, passed, detail) values (
    'mesero_rls_select_hides_accounts',
    v_sqlstate = 'ok' and v_seen = 0,
    coalesce(v_message, '')
  );
end
$behavior$;

select scenario, passed, detail from acl219_case order by scenario;

do $fail$
declare
  v_failed text;
begin
  select string_agg(scenario || '=' || detail, ' | ' order by scenario)
    into v_failed
  from acl219_case
  where not passed;
  if v_failed is not null then
    raise exception '219 ACL test failed: %', v_failed;
  end if;
end
$fail$;

rollback;
