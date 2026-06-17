-- Prevent duplicate checklist runs for the same logical assignee.
-- Apply after 081_attendance_status_and_all_blocks.sql.

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date default (now() at time zone 'America/Guatemala')::date,
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

  effective_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);
  effective_area := nullif(trim(coalesce(p_area, template_row.area, '')), '');
  effective_role := nullif(trim(coalesce(p_assigned_role, template_row.assigned_role, '')), '');

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
    due_time, assignment_source
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
    template_row.reminder_time, template_row.due_time, coalesce(p_assignment_source, 'manual')
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

  perform public.create_checklist_run_notifications(created_run.id);
  return created_run;
end;
$$;

revoke all on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) from public;
grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text, text, text) to authenticated;

-- Keep the previous RPC signature available for older clients.
drop function if exists public.create_checklist_run_from_template(uuid, date, text, uuid, text);

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date,
  p_assignment_source text,
  p_assigned_profile_id uuid,
  p_notes text
)
returns public.checklist_runs
language sql
security definer
set search_path = ''
as $$
  select public.create_checklist_run_from_template(
    p_template_id,
    p_run_date,
    p_assignment_source,
    p_assigned_profile_id,
    p_notes,
    null,
    null
  );
$$;

revoke all on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) from public;
grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) to authenticated;

create or replace function public.generate_due_checklist_runs(
  p_target_date date default (now() at time zone 'America/Guatemala')::date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  generated_count integer := 0;
begin
  if not public.is_checklist_template_manager() then
    raise exception 'No tienes permiso para generar checklists recurrentes.';
  end if;

  for template_row in
    select * from public.checklist_templates
    where status = 'active'
      and auto_generate = true
      and public.checklist_template_due_on_date(checklist_templates, p_target_date)
  loop
    begin
      perform public.create_checklist_run_from_template(
        template_row.id,
        p_target_date,
        'recurrence',
        null,
        'Generada automaticamente',
        template_row.area,
        template_row.assigned_role
      );
      generated_count := generated_count + 1;
    exception when others then
      -- Skip templates that cannot be assigned because the owner and backup are off.
      null;
    end;
  end loop;

  return generated_count;
end;
$$;

revoke all on function public.generate_due_checklist_runs(date) from public;
grant execute on function public.generate_due_checklist_runs(date) to authenticated;

-- Diagnostic query for today's active duplicate runs. Run manually before cleanup.
/*
SELECT
  r.template_id,
  t.title,
  r.run_date,
  r.area,
  COALESCE(r.assigned_profile_id::text, 'NO_PROFILE') AS assigned_profile,
  COALESCE(r.assigned_role, 'NO_ROLE') AS assigned_role,
  COUNT(*) AS count,
  array_agg(r.id ORDER BY r.created_at) AS run_ids,
  array_agg(r.status ORDER BY r.created_at) AS statuses,
  array_agg(r.created_at ORDER BY r.created_at) AS created_at
FROM public.checklist_runs r
LEFT JOIN public.checklist_templates t ON t.id = r.template_id
WHERE r.status <> 'cancelled'
  AND r.run_date = (now() AT TIME ZONE 'America/Guatemala')::date
GROUP BY
  r.template_id,
  t.title,
  r.run_date,
  r.area,
  COALESCE(r.assigned_profile_id::text, 'NO_PROFILE'),
  COALESCE(r.assigned_role, 'NO_ROLE')
HAVING COUNT(*) > 1
ORDER BY count DESC;
*/

-- Safe cleanup draft: cancel newer empty duplicates, keeping the oldest run active.
-- Review the diagnostic output before running this block.
/*
with duplicate_runs as (
  select
    r.id,
    row_number() over (
      partition by
        r.template_id,
        r.run_date,
        coalesce(nullif(trim(r.area), ''), 'NO_AREA'),
        coalesce(r.assigned_profile_id, '00000000-0000-0000-0000-000000000000'::uuid),
        coalesce(nullif(trim(r.assigned_role), ''), 'NO_ROLE')
      order by
        case when r.status = 'in_progress' then 0 when r.status = 'pending' then 1 else 2 end,
        r.created_at asc
    ) as keep_rank,
    exists (
      select 1
      from public.checklist_run_items item
      where item.run_id = r.id
        and (
          item.checked
          or nullif(trim(coalesce(item.response_text, '')), '') is not null
          or item.response_number is not null
          or item.response_date is not null
          or item.response_time is not null
          or item.photo_url is not null
          or nullif(trim(coalesce(item.comment, '')), '') is not null
          or coalesce(item.response_json, '{}'::jsonb) <> '{}'::jsonb
        )
    ) as has_answers
  from public.checklist_runs r
  where r.status <> 'cancelled'
    and r.run_date = (now() at time zone 'America/Guatemala')::date
)
update public.checklist_runs r
set status = 'cancelled',
    notes = concat_ws(E'\n', nullif(r.notes, ''), 'Cancelada por limpieza segura de duplicados logicos.'),
    updated_at = now()
from duplicate_runs d
where r.id = d.id
  and d.keep_rank > 1
  and d.has_answers = false;
*/
