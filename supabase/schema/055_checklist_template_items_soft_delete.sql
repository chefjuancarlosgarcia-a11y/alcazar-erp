-- Soft delete for checklist template items so run history keeps FK references.

alter table public.checklist_template_items
  add column if not exists is_active boolean not null default true;

update public.checklist_template_items
set is_active = true
where is_active is null;

create index if not exists checklist_template_items_active_idx
  on public.checklist_template_items (template_id, is_active, item_order)
  where is_active = true;

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date default current_date,
  p_assignment_source text default 'manual',
  p_assigned_profile_id uuid default null,
  p_notes text default null
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
begin
  select * into template_row from public.checklist_templates where id = p_template_id and status = 'active';
  if template_row.id is null then
    raise exception 'La plantilla no existe o esta inactiva.';
  end if;

  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para crear checklists.';
  end if;

  effective_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);

  select * into existing_run
  from public.checklist_runs
  where template_id = template_row.id
    and run_date = p_run_date
    and coalesce(assigned_profile_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(effective_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
    template_row.id, p_run_date, template_row.area, effective_profile_id,
    template_row.assigned_role, 'pending',
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

grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) to authenticated;

create or replace function public.approve_checklist_change_request(p_request_id uuid, p_review_notes text default null)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.checklist_template_change_requests;
  v_template_id uuid;
begin
  if not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para aprobar cambios de checklist.';
  end if;

  select * into request_row
  from public.checklist_template_change_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Solicitud no encontrada.';
  end if;
  if request_row.status <> 'pending_review' then
    raise exception 'Solo se pueden aprobar solicitudes pendientes.';
  end if;

  if request_row.request_type = 'create' then
    insert into public.checklist_templates (
      title, description, area, assigned_role, assigned_profile_id, frequency, shift_context,
      status, created_by, supervisor_profile_id, backup_profile_id, reminder_time, due_time,
      recurrence_days, recurrence_month_day, recurrence_rule, skip_non_work_days,
      auto_generate, requires_approval
    )
    values (
      request_row.title, request_row.description, request_row.area, request_row.assigned_role,
      request_row.assigned_profile_id, coalesce(request_row.frequency, 'manual'),
      coalesce(request_row.shift_context, 'general'), coalesce(request_row.status_after_approval, 'active'),
      request_row.submitted_by, request_row.supervisor_profile_id, request_row.backup_profile_id,
      request_row.reminder_time, request_row.due_time, coalesce(request_row.recurrence_days, '{}'::integer[]),
      request_row.recurrence_month_day, request_row.recurrence_rule,
      coalesce(request_row.skip_non_work_days, true), coalesce(request_row.auto_generate, false),
      coalesce(request_row.requires_approval, true)
    )
    returning id into v_template_id;
  elsif request_row.request_type = 'update' then
    v_template_id := request_row.template_id;
    update public.checklist_templates
    set title = request_row.title,
        description = request_row.description,
        area = request_row.area,
        assigned_role = request_row.assigned_role,
        assigned_profile_id = request_row.assigned_profile_id,
        frequency = coalesce(request_row.frequency, 'manual'),
        shift_context = coalesce(request_row.shift_context, 'general'),
        status = coalesce(request_row.status_after_approval, 'active'),
        supervisor_profile_id = request_row.supervisor_profile_id,
        backup_profile_id = request_row.backup_profile_id,
        reminder_time = request_row.reminder_time,
        due_time = request_row.due_time,
        recurrence_days = coalesce(request_row.recurrence_days, '{}'::integer[]),
        recurrence_month_day = request_row.recurrence_month_day,
        recurrence_rule = request_row.recurrence_rule,
        skip_non_work_days = coalesce(request_row.skip_non_work_days, true),
        auto_generate = coalesce(request_row.auto_generate, false),
        requires_approval = coalesce(request_row.requires_approval, true)
    where id = v_template_id;
    update public.checklist_template_items
    set is_active = false
    where template_id = v_template_id
      and is_active = true;
  elsif request_row.request_type = 'archive' then
    v_template_id := request_row.template_id;
    update public.checklist_templates set status = 'inactive' where id = v_template_id;
  elsif request_row.request_type = 'delete' then
    v_template_id := request_row.template_id;
    if exists (select 1 from public.checklist_runs where template_id = request_row.template_id) then
      update public.checklist_templates set status = 'inactive' where id = request_row.template_id;
    else
      delete from public.checklist_templates where id = request_row.template_id;
      v_template_id := null;
    end if;
  end if;

  if request_row.request_type in ('create', 'update') then
    insert into public.checklist_template_items (
      template_id, item_order, title, description, response_type, is_required,
      requires_photo, requires_comment, score_points, options, require_comment_on_no,
      require_photo_on_no, generate_incident_on_no, rule_config, is_active
    )
    select
      v_template_id,
      coalesce((item.value ->> 'item_order')::integer, item.ordinality::integer - 1),
      item.value ->> 'title',
      nullif(item.value ->> 'description', ''),
      coalesce(nullif(item.value ->> 'response_type', ''), 'yes_no'),
      coalesce((item.value ->> 'is_required')::boolean, true),
      coalesce((item.value ->> 'requires_photo')::boolean, false),
      coalesce((item.value ->> 'requires_comment')::boolean, false),
      greatest(0, coalesce((item.value ->> 'score_points')::integer, 1)),
      coalesce(item.value -> 'options', '[]'::jsonb),
      coalesce((item.value ->> 'require_comment_on_no')::boolean, false),
      coalesce((item.value ->> 'require_photo_on_no')::boolean, false),
      coalesce((item.value ->> 'generate_incident_on_no')::boolean, false),
      coalesce(item.value -> 'rule_config', '{}'::jsonb),
      true
    from jsonb_array_elements(request_row.items_snapshot) with ordinality as item(value, ordinality)
    where nullif(trim(item.value ->> 'title'), '') is not null;
  end if;

  update public.checklist_template_change_requests
  set status = 'approved',
      template_id = v_template_id,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(coalesce(p_review_notes, '')), '')
  where id = p_request_id
  returning * into request_row;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    request_row.submitted_by,
    null,
    'checklist_approval_result',
    'Checklist aprobada',
    'Checklist aprobada y publicada: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  );

  return request_row;
end;
$$;

grant execute on function public.approve_checklist_change_request(uuid, text) to authenticated;
