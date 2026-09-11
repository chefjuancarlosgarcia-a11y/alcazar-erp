-- ROLLBACK 208 — finance general journal (Libro Diario RPC).
-- Forward path: supabase/schema/208_finance_general_journal.sql
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
    raise exception '208 rollback blocked: production environment';
  end if;
  if v_env = 'stage' then
    if v_session_ref is null then
      raise exception '208 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
    end if;
    if v_stored_ref is null then
      raise exception '208 rollback blocked: deployment_environment.project_ref missing';
    end if;
    if v_session_ref <> v_stored_ref then
      raise exception '208 rollback blocked: session project ref does not match stored value';
    end if;
  end if;
end $guard$;

drop function if exists public.get_finance_general_journal(date, date, uuid, uuid, uuid, uuid, text, integer, integer, timestamptz);
drop function if exists public.get_finance_general_journal(date, date, uuid, uuid, uuid, uuid, text, integer, integer);
drop function if exists public.finance_general_journal_row_to_json(
  uuid, uuid, date, text, text, text, smallint, uuid, text, text, text, text,
  uuid, text, text, uuid, text, text, numeric, numeric, boolean, uuid, text, uuid
);

commit;
