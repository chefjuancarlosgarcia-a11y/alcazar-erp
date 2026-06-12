-- Permanent checklist template deletion including runs, history, and related records.
-- Apply after 068_checklist_sync_completed_reopen.sql.

create or replace function public.force_delete_checklist_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  deleted_runs integer := 0;
  deleted_incidents integer := 0;
begin
  if not public.is_checklist_template_deleter() then
    raise exception 'No tienes permiso para eliminar checklists definitivamente.';
  end if;

  select * into template_row
  from public.checklist_templates
  where id = p_template_id;

  if template_row.id is null then
    raise exception 'Checklist no encontrada.';
  end if;

  delete from public.notifications
  where entity_type = 'checklist_run'
    and entity_id in (
      select run.id::text
      from public.checklist_runs run
      where run.template_id = p_template_id
    );

  delete from public.notifications
  where entity_type = 'checklist_template_change_request'
    and entity_id in (
      select request.id::text
      from public.checklist_template_change_requests request
      where request.template_id = p_template_id
    );

  delete from public.checklist_management_alerts alert
  using public.checklist_runs run
  where alert.checklist_run_id = run.id
    and run.template_id = p_template_id;

  with removed_incidents as (
    delete from public.checklist_incidents incident
    where incident.template_id = p_template_id
       or incident.run_id in (
         select run.id
         from public.checklist_runs run
         where run.template_id = p_template_id
       )
    returning incident.id
  )
  select count(*) into deleted_incidents from removed_incidents;

  with removed_runs as (
    delete from public.checklist_runs run
    where run.template_id = p_template_id
    returning run.id
  )
  select count(*) into deleted_runs from removed_runs;

  delete from public.checklist_template_change_requests
  where template_id = p_template_id;

  delete from public.checklist_template_suggestions
  where template_id = p_template_id;

  delete from public.checklist_template_items
  where template_id = p_template_id;

  delete from public.checklist_templates
  where id = p_template_id;

  return jsonb_build_object(
    'template_id', p_template_id,
    'deleted_runs', deleted_runs,
    'deleted_incidents', deleted_incidents
  );
end;
$$;

grant execute on function public.force_delete_checklist_template(uuid) to authenticated;
