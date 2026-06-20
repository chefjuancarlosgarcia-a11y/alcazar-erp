-- Checklist run generation: manual+auto_generate due dates, resilient notifications.
-- Apply after 111_checklist_due_on_date_auto_generate_fix.sql.

create or replace function public.checklist_template_due_on_date(p_template public.checklist_templates, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_template.status <> 'active' then false
    when not public.checklist_template_should_auto_generate(p_template) then false
    when coalesce(p_template.frequency, 'manual') = 'manual' then coalesce(p_template.auto_generate, false)
    when p_template.frequency = 'diaria' then true
    when p_template.frequency = 'semanal' then
      coalesce(array_length(p_template.recurrence_days, 1), 0) > 0
      and extract(isodow from p_date)::integer = any(p_template.recurrence_days)
    when p_template.frequency = 'mensual' then
      coalesce(p_template.recurrence_month_day, 1) = extract(day from p_date)::integer
    when p_template.frequency in ('apertura', 'cierre', 'por_turno') then true
    else false
  end;
$$;

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date default public.get_checklist_operational_date(),
  p_assignment_source text default 'manual',
  p_assigned_profile_id uuid default null,
  p_notes text default null,
  p_area text default null,
  p_assigned_role text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  existing_run public.checklist_runs;
  created_run public.checklist_runs;
  effective_profile_id uuid;
  original_profile_id uuid;
  effective_area text;
  effective_role text;
begin
  select * into template_row
  from public.checklist_templates
  where id = p_template_id
    and status = 'active';

  if template_row.id is null then
    raise exception 'La plantilla no existe o esta inactiva.';
  end if;

  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para crear checklists.';
  end if;

  original_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);
  effective_profile_id := original_profile_id;
  effective_area := nullif(trim(coalesce(p_area, template_row.area, '')), '');
  effective_role := nullif(trim(coalesce(p_assigned_role, template_row.assigned_role, '')), '');

  if template_row.skip_non_work_days
    and effective_profile_id is not null
    and not public.is_profile_scheduled_to_work(effective_profile_id, p_run_date)
  then
    if template_row.backup_profile_id is not null
      and template_row.backup_profile_id <> effective_profile_id
      and public.is_profile_scheduled_to_work(template_row.backup_profile_id, p_run_date)
    then
      effective_profile_id := template_row.backup_profile_id;
    end if;
  end if;

  select * into existing_run
  from public.checklist_runs
  where template_id = template_row.id
    and run_date = p_run_date
    and status <> 'cancelled'
    and coalesce(assigned_profile_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(effective_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(nullif(trim(assigned_role), ''), 'NO_ROLE') = coalesce(effective_role, 'NO_ROLE')
    and coalesce(nullif(trim(area), ''), 'NO_AREA') = coalesce(effective_area, 'NO_AREA')
  order by created_at asc
  limit 1;

  if existing_run.id is not null then
    return existing_run;
  end if;

  insert into public.checklist_runs (
    template_id, run_date, area, assigned_profile_id, assigned_role, status,
    total_points, earned_points, notes, supervisor_profile_id, reminder_time,
    due_time, assignment_source, original_assigned_profile_id
  )
  values (
    template_row.id, p_run_date, effective_area, effective_profile_id,
    effective_role, 'pending',
    coalesce((
      select sum(score_points)::integer
      from public.checklist_template_items
      where template_id = template_row.id
        and is_active = true
    ), 0),
    0, nullif(trim(coalesce(p_notes, '')), ''), template_row.supervisor_profile_id,
    template_row.reminder_time, template_row.due_time, coalesce(p_assignment_source, 'manual'),
    original_profile_id
  )
  returning * into created_run;

  insert into public.checklist_run_items (
    run_id, template_item_id, item_order, title, response_type, is_required,
    requires_photo, requires_comment, score_points, options,
    require_comment_on_no, require_photo_on_no, generate_incident_on_no, rule_config,
    expected_response, triggers_incident, incident_severity, notify_roles, create_task_on_fail
  )
  select
    created_run.id, item.id, item.item_order, item.title, item.response_type,
    item.is_required, item.requires_photo, item.requires_comment, item.score_points,
    item.options, item.require_comment_on_no, item.require_photo_on_no,
    item.generate_incident_on_no, item.rule_config, item.expected_response,
    item.triggers_incident, item.incident_severity, item.notify_roles, item.create_task_on_fail
  from public.checklist_template_items item
  where item.template_id = template_row.id
    and item.is_active = true
  order by item.item_order;

  if coalesce(p_assignment_source, 'manual') <> 'recurrence' then
    begin
      perform public.create_checklist_run_notifications(created_run.id);
    exception
      when others then
        raise warning 'create_checklist_run_notifications failed for run %: %', created_run.id, sqlerrm;
    end;
  end if;

  return created_run;
end;
$$;

revoke all on function public.checklist_template_due_on_date(public.checklist_templates, date) from public;
grant execute on function public.checklist_template_due_on_date(public.checklist_templates, date) to authenticated;

revoke all on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) from public;
grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) to authenticated;
