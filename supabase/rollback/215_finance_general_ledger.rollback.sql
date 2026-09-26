-- ROLLBACK 215 — finance general ledger (Libro Mayor RPC).
-- Forward path: supabase/schema/215_finance_general_ledger.sql
--
-- Removes only get_finance_general_ledger. Does not delete journal entries,
-- lines, accounts, periods, or Libro Diario objects from 208/209.
-- The report is computed on read. Dropping the function does not discard
-- posted accounting data, and there is no stored report snapshot to restore.
-- Reapplying 215 recreates the function. This script does not GRANT anything.
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
    raise exception '215 rollback blocked: production environment';
  end if;
  if v_env = 'stage' then
    if v_session_ref is null then
      raise exception '215 rollback blocked: set alcazar.finance_stage_project_ref before rollback';
    end if;
    if v_stored_ref is null then
      raise exception '215 rollback blocked: deployment_environment.project_ref missing';
    end if;
    if v_session_ref <> v_stored_ref then
      raise exception '215 rollback blocked: session project ref does not match stored value';
    end if;
  end if;
end $guard$;

do $drop_ledger$
begin
  if to_regprocedure('public.get_finance_general_ledger(uuid,date,date,uuid,uuid,uuid,text,integer,integer,timestamptz)') is not null then
    revoke all on function public.get_finance_general_ledger(
      uuid, date, date, uuid, uuid, uuid, text, integer, integer, timestamptz
    ) from public, anon, authenticated, service_role;
  end if;
end $drop_ledger$;

drop function if exists public.get_finance_general_ledger(
  uuid, date, date, uuid, uuid, uuid, text, integer, integer, timestamptz
);

commit;
