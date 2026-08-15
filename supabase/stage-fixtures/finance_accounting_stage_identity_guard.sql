-- Shared Stage identity guard (inline in rollbacks/smoke; not a migration).
-- Requires:
--   app_settings.deployment_environment.name = 'stage'
--   app_settings.deployment_environment.project_ref = session value
-- Session operator MUST run first:
--   select set_config('alcazar.finance_stage_project_ref', '<project-ref>', false);

do $finance_stage_identity_guard$
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
    raise exception 'Stage guard blocked: production environment detected';
  end if;
  if v_env <> 'stage' then
    raise exception 'Stage guard blocked: deployment_environment.name must be stage';
  end if;
  if v_session_ref is null then
    raise exception 'Stage guard blocked: set alcazar.finance_stage_project_ref before running';
  end if;
  if v_stored_ref is null then
    raise exception 'Stage guard blocked: deployment_environment.project_ref missing in app_settings';
  end if;
  if v_session_ref <> v_stored_ref then
    raise exception 'Stage guard blocked: session project ref does not match stored value';
  end if;
end $finance_stage_identity_guard$;
