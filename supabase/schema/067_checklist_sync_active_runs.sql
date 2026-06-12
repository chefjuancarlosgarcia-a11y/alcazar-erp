-- Sync active checklist runs (Hoy) when a template is edited or an update is approved.
-- Apply after 066_checklist_supervisor_approval_flow.sql.

create or replace function public.checklist_run_item_has_answer(p_item public.checklist_run_items)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_item.checked
    or nullif(trim(coalesce(p_item.response_text, '')), '') is not null
    or p_item.response_number is not null
    or p_item.response_date is not null
    or p_item.response_time is not null
    or nullif(trim(coalesce(p_item.photo_url, '')), '') is not null
    or p_item.completed_at is not null
    or (p_item.response_json is not null and p_item.response_json <> '{}'::jsonb),
    false
  );
$$;

create or replace function public.sync_checklist_runs_from_template(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  synced_runs integer := 0;
begin
  if not exists (
    select 1
    from public.checklist_templates
    where id = p_template_id
  ) then
    raise exception 'Plantilla no encontrada.';
  end if;

  if not (
    public.is_checklist_template_manager()
    or public.is_checklist_change_approver()
  ) then
    raise exception 'No tienes permiso para sincronizar ejecuciones de checklist.';
  end if;

  for run_row in
    select *
    from public.checklist_runs
    where template_id = p_template_id
      and status in ('pending', 'in_progress', 'overdue', 'rejected', 'pending_review')
  loop
    update public.checklist_runs r
    set
      area = t.area,
      supervisor_profile_id = coalesce(r.supervisor_profile_id, t.supervisor_profile_id),
      reminder_time = coalesce(r.reminder_time, t.reminder_time),
      due_time = coalesce(r.due_time, t.due_time)
    from public.checklist_templates t
    where r.id = run_row.id
      and t.id = p_template_id;

    delete from public.checklist_run_items ri
    where ri.run_id = run_row.id
      and not public.checklist_run_item_has_answer(ri)
      and (
        ri.template_item_id is null
        or not exists (
          select 1
          from public.checklist_template_items ti
          where ti.id = ri.template_item_id
            and ti.template_id = p_template_id
            and ti.is_active = true
        )
      );

    update public.checklist_run_items ri
    set
      item_order = ti.item_order,
      title = ti.title,
      response_type = ti.response_type,
      is_required = ti.is_required,
      requires_photo = ti.requires_photo,
      requires_comment = ti.requires_comment,
      score_points = ti.score_points,
      options = ti.options,
      require_comment_on_no = ti.require_comment_on_no,
      require_photo_on_no = ti.require_photo_on_no,
      generate_incident_on_no = ti.generate_incident_on_no,
      rule_config = ti.rule_config,
      expected_response = ti.expected_response,
      triggers_incident = ti.triggers_incident,
      incident_severity = ti.incident_severity,
      notify_roles = ti.notify_roles,
      create_task_on_fail = ti.create_task_on_fail
    from public.checklist_template_items ti
    where ri.run_id = run_row.id
      and ri.template_item_id = ti.id
      and ti.template_id = p_template_id
      and ti.is_active = true;

    insert into public.checklist_run_items (
      run_id, template_item_id, item_order, title, response_type, is_required,
      requires_photo, requires_comment, score_points, options,
      require_comment_on_no, require_photo_on_no, generate_incident_on_no, rule_config,
      expected_response, triggers_incident, incident_severity, notify_roles, create_task_on_fail
    )
    select
      run_row.id,
      ti.id,
      ti.item_order,
      ti.title,
      ti.response_type,
      ti.is_required,
      ti.requires_photo,
      ti.requires_comment,
      ti.score_points,
      ti.options,
      ti.require_comment_on_no,
      ti.require_photo_on_no,
      ti.generate_incident_on_no,
      ti.rule_config,
      ti.expected_response,
      ti.triggers_incident,
      ti.incident_severity,
      ti.notify_roles,
      ti.create_task_on_fail
    from public.checklist_template_items ti
    where ti.template_id = p_template_id
      and ti.is_active = true
      and not exists (
        select 1
        from public.checklist_run_items ri
        where ri.run_id = run_row.id
          and ri.template_item_id = ti.id
      );

    update public.checklist_runs r
    set
      total_points = coalesce((
        select sum(ri.score_points)::integer
        from public.checklist_run_items ri
        where ri.run_id = r.id
      ), 0),
      earned_points = coalesce((
        select sum(ri.earned_points)::integer
        from public.checklist_run_items ri
        where ri.run_id = r.id
      ), 0)
    where r.id = run_row.id;

    synced_runs := synced_runs + 1;
  end loop;

  return jsonb_build_object('synced_runs', synced_runs);
end;
$$;

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

  if v_template_id is not null and request_row.request_type in ('create', 'update') then
    perform public.sync_checklist_runs_from_template(v_template_id);
  end if;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    request_row.submitted_by,
    null,
    'checklist_approval_result',
    'Checklist aprobada',
    'Tu checklist "' || request_row.title || '" fue aprobada. Ya puedes asignarla y utilizarla.',
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=templates',
    auth.uid()
  );

  return request_row;
end;
$$;

grant execute on function
  public.checklist_run_item_has_answer(public.checklist_run_items),
  public.sync_checklist_runs_from_template(uuid),
  public.approve_checklist_change_request(uuid, text)
to authenticated;
