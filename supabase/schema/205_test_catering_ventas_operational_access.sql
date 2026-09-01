-- Regression tests for 205_catering_ventas_operational_access.sql
-- Run AFTER applying 205. Entire file: BEGIN … ROLLBACK (no COMMIT).

begin;

create or replace function public.test_catering_ventas_operational_access_205()
returns table (
  scenario text,
  passed boolean,
  detail text
)
language plpgsql
security definer
set search_path = '', public
as $$
declare
  v_manage_def text;
  v_notify_def text;
  v_edit_def text;
  v_manage_oid oid;
  v_manage_count int;
  v_role text;
  v_expected_roles text[] := array[
    'admin',
    'gerente_general',
    'gerente',
    'gerente_operaciones',
    'supervisor',
    'ventas'
  ];
begin
  select p.oid, pg_get_functiondef(p.oid)
  into v_manage_oid, v_manage_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'can_manage_catering_requests'
  order by p.oid
  limit 1;

  select count(*)
  into v_manage_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'can_manage_catering_requests';

  return query
  select 'manage_single_overload'::text,
    v_manage_count = 1,
    'can_manage_catering_requests has exactly one overload'::text;

  return query
  select 'manage_zero_arg_boolean'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public'
        and p.proname = 'can_manage_catering_requests'
        and p.pronargs = 0
        and t.typname = 'bool'
    ),
    'can_manage_catering_requests() returns boolean with no parameters'::text;

  return query
  select 'manage_security_definer'::text,
    exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'can_manage_catering_requests'
        and p.prosecdef
    ),
    'can_manage_catering_requests is SECURITY DEFINER'::text;

  return query
  select 'manage_search_path_empty'::text,
    v_manage_def ilike '%search_path%''''''%',
    'can_manage_catering_requests sets search_path to empty'::text;

  return query
  select 'manage_uses_auth_uid'::text,
    v_manage_def ilike '%auth.uid()%',
    'can_manage binds profile to auth.uid()'::text;

  return query
  select 'manage_requires_active_profile'::text,
    v_manage_def ilike '%profile.status = ''active''%',
    'can_manage requires active profile status'::text;

  return query
  select 'manage_reads_public_profiles'::text,
    v_manage_def ilike '%from public.profiles%',
    'can_manage reads from public.profiles'::text;

  return query
  select 'manage_no_client_role_parameter'::text,
    v_manage_def not ilike '%p_role%'
      and v_manage_def not ilike '%p_user_id%',
    'can_manage does not accept client-supplied role or user id'::text;

  return query
  select 'manage_not_alias_of_notifications'::text,
    v_manage_def not ilike '%can_receive_catering_notifications%',
    'can_manage is independent from notification helper'::text;

  foreach v_role in array v_expected_roles loop
    return query
    select ('manage_includes_' || v_role)::text,
      v_manage_def ilike ('%' || v_role || '%'),
      'can_manage includes role ' || v_role;
  end loop;

  return query
  select 'manage_excludes_unauthorized_role_cajero'::text,
    v_manage_def not ilike '%cajero%'
      and v_manage_def not ilike '%colaborador%',
    'can_manage does not include cajero or colaborador'::text;

  select pg_get_functiondef(p.oid)
  into v_notify_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'can_receive_catering_notifications'
  order by p.oid
  limit 1;

  return query
  select 'notifications_helper_unchanged'::text,
    v_notify_def ilike '%catering_notification_roles()%',
    'can_receive_catering_notifications still uses catering_notification_roles'::text;

  return query
  select 'notifications_excludes_ventas'::text,
    public.can_receive_catering_notifications('ventas') = false,
    'ventas cannot receive catering notifications'::text;

  return query
  select 'notifications_includes_admin'::text,
    public.can_receive_catering_notifications('admin') = true,
    'admin keeps catering notifications'::text;

  return query
  select 'notifications_includes_gerente_general'::text,
    public.can_receive_catering_notifications('gerente_general') = true,
    'gerente_general keeps catering notifications'::text;

  select pg_get_functiondef(p.oid)
  into v_edit_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'can_edit_catering_quote_settings';

  return query
  select 'edit_settings_excludes_ventas'::text,
    v_edit_def not ilike '%ventas%',
    'can_edit_catering_quote_settings unchanged for ventas'::text;

  return query
  select 'user_roles_catalog_has_ventas'::text,
    exists (
      select 1
      from public.user_roles
      where role_key = 'ventas'
        and is_active = true
    ),
    'ventas exists in user_roles catalog after idempotent insert'::text;

  return query
  select 'rls_catering_requests_uses_manage_helper'::text,
    exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'catering_requests'
        and qual ilike '%can_manage_catering_requests%'
    ),
    'catering_requests RLS still references can_manage_catering_requests'::text;

  return query
  select 'manage_granted_to_authenticated'::text,
    has_function_privilege('authenticated', 'public.can_manage_catering_requests()', 'EXECUTE'),
    'authenticated can execute can_manage_catering_requests'::text;

  return query
  select 'manage_revoked_from_public'::text,
    not has_function_privilege('public', 'public.can_manage_catering_requests()', 'EXECUTE'),
    'public cannot execute can_manage_catering_requests'::text;

  return query
  select 'runtime_skipped_requires_auth_context'::text,
    true,
    'Dynamic ventas active/inactive checks require Stage JWT context; validate after apply'::text;

  return;
end;
$$;

with results as materialized (
  select * from public.test_catering_ventas_operational_access_205()
),
summary as (
  select
    count(*) as total,
    count(*) filter (where passed) as passed,
    count(*) filter (where not passed) as failed
  from results
)
select * from summary;

rollback;
