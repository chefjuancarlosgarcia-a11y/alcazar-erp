-- General Journal helper ACL — SQL verification (NOT a migration).
-- Run manually AFTER 209_finance_general_journal_helper_acl.sql.
-- Uses BEGIN … ROLLBACK. Ten scenarios (2 existence + 8 ACL).

begin;

create or replace function public.test_finance_general_journal_helper_acl()
returns table (scenario text, passed boolean, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_helper_sig regprocedure := 'public.finance_general_journal_row_to_json(uuid, uuid, date, text, text, text, smallint, uuid, text, text, text, text, uuid, text, text, uuid, text, text, numeric, numeric, boolean, uuid, text, uuid)'::regprocedure;
  v_main_sig regprocedure := 'public.get_finance_general_journal(date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz)'::regprocedure;
  v_helper_owner text;
  v_helper_grants text;
  v_main_grants text;
  v_external_helper_grants text;
begin
  select owner_role.rolname
    into v_helper_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles owner_role on owner_role.oid = p.proowner
  where p.oid = v_helper_sig;

  return query select 'helper_exists'::text,
    v_helper_sig is not null,
    coalesce(v_helper_sig::text, 'missing');

  return query select 'main_rpc_exists'::text,
    v_main_sig is not null,
    coalesce(v_main_sig::text, 'missing');

  select coalesce(string_agg(rp.grantee || ':' || rp.privilege_type, ', ' order by rp.grantee), 'none')
    into v_helper_grants
  from information_schema.routine_privileges rp
  where rp.specific_schema = 'public'
    and rp.routine_name = 'finance_general_journal_row_to_json'
    and rp.privilege_type = 'EXECUTE';

  return query select 'helper_public_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'finance_general_journal_row_to_json'
        and rp.grantee = 'PUBLIC'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_helper_grants;

  return query select 'helper_anon_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'finance_general_journal_row_to_json'
        and rp.grantee = 'anon'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_helper_grants;

  return query select 'helper_authenticated_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'finance_general_journal_row_to_json'
        and rp.grantee = 'authenticated'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_helper_grants;

  return query select 'helper_service_role_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'finance_general_journal_row_to_json'
        and rp.grantee = 'service_role'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_helper_grants;

  select coalesce(string_agg(rp.grantee || ':' || rp.privilege_type, ', ' order by rp.grantee), 'none')
    into v_external_helper_grants
  from information_schema.routine_privileges rp
  where rp.specific_schema = 'public'
    and rp.routine_name = 'finance_general_journal_row_to_json'
    and rp.privilege_type = 'EXECUTE'
    and rp.grantee is distinct from v_helper_owner;

  return query select 'helper_no_external_execute_grants'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'finance_general_journal_row_to_json'
        and rp.privilege_type = 'EXECUTE'
        and rp.grantee is distinct from v_helper_owner
    ),
    coalesce(v_external_helper_grants, 'none');

  select coalesce(string_agg(rp.grantee || ':' || rp.privilege_type, ', ' order by rp.grantee), 'none')
    into v_main_grants
  from information_schema.routine_privileges rp
  where rp.specific_schema = 'public'
    and rp.routine_name = 'get_finance_general_journal'
    and rp.privilege_type = 'EXECUTE';

  return query select 'main_authenticated_execute_granted'::text,
    exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'get_finance_general_journal'
        and rp.grantee = 'authenticated'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_main_grants;

  return query select 'main_anon_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'get_finance_general_journal'
        and rp.grantee = 'anon'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_main_grants;

  return query select 'main_public_execute_denied'::text,
    not exists (
      select 1
      from information_schema.routine_privileges rp
      where rp.specific_schema = 'public'
        and rp.routine_name = 'get_finance_general_journal'
        and rp.grantee = 'PUBLIC'
        and rp.privilege_type = 'EXECUTE'
    ),
    v_main_grants;
end;
$$;

do $$
declare
  r record;
begin
  for r in select * from public.test_finance_general_journal_helper_acl() loop
    if not r.passed then
      raise exception 'test_scenario_failed:%:%', r.scenario, r.detail;
    end if;
  end loop;
end $$;

rollback;
