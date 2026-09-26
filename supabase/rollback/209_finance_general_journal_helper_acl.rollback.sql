-- ROLLBACK 209 — finance general journal helper ACL fix (DELIBERATELY BLOCKED).
-- Forward path: supabase/schema/209_finance_general_journal_helper_acl.sql
--
-- Migration 209 closes a security exposure: finance_general_journal_row_to_json must
-- remain an internal helper with no EXECUTE for PUBLIC, anon, authenticated, or service_role.
-- Restoring the pre-209 ACL would re-expose direct client invocation of the helper.
--
-- This rollback is fail-closed and NOT automatically reversible. It performs NO GRANT,
-- NO REVOKE, and NO DDL/DML. It always stops with an explicit exception.
--
-- To reverse 209 effects safely requires:
--   1. Human authorization and documented impact audit
--   2. A new versioned corrective migration (never GRANT EXECUTE on the helper to external roles)
--   3. For full Libro Diario removal, use rollback 208 instead
\set ON_ERROR_STOP on

begin;

do $guard$
declare
  v_env text := lower(coalesce(
    (select value ->> 'name' from public.app_settings where key = 'deployment_environment'),
    ''
  ));
  v_stored_ref text := nullif(trim(coalesce(
    (select value ->> 'project_ref' from public.app_settings where key = 'deployment_environment'),
    ''
  )), '');
  v_session_ref text := nullif(trim(coalesce(current_setting('alcazar.finance_stage_project_ref', true), '')), '');
begin
  if v_env in ('production', 'prod') then
    raise exception '209 rollback blocked: production environment';
  end if;
  if v_env = 'stage' then
    if v_session_ref is null then
      raise exception '209 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
    end if;
    if v_stored_ref is null then
      raise exception '209 rollback blocked: deployment_environment.project_ref missing';
    end if;
    if v_session_ref <> v_stored_ref then
      raise exception '209 rollback blocked: session project ref does not match stored value';
    end if;
  end if;
end $guard$;

do $block$
begin
  raise exception
    '209 rollback blocked: ACL reversal would re-expose finance_general_journal_row_to_json. '
    'Requires human authorization, impact audit, and a new versioned migration. '
    'For full Libro Diario removal use rollback 208.';
end $block$;
