-- Include completed runs (Hoy) in template sync, reopen when new items are added, notify assignee.
-- Apply after 067_checklist_sync_active_runs.sql.

create or replace function public.checklist_run_has_pending_required(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.checklist_run_items ri
    where ri.run_id = p_run_id
      and ri.is_required = true
      and not public.checklist_run_item_has_answer(ri)
  );
$$;

create or replace function public.notify_checklist_run_reopened(
  p_run_id uuid,
  p_reason text default 'Se actualizo la checklist y faltan items por completar.'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_record public.checklist_runs;
  template_title text;
begin
  select * into run_record
  from public.checklist_runs
  where id = p_run_id;

  if run_record.id is null or run_record.assigned_profile_id is null then
    return;
  end if;

  select title into template_title
  from public.checklist_templates
  where id = run_record.template_id;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    run_record.assigned_profile_id,
    null,
    'checklist',
    'Checklist pendiente de terminar',
    coalesce(template_title, 'Checklist') || ': ' || coalesce(p_reason, 'Faltan items por completar.'),
    'checklist_run',
    run_record.id::text,
    '/tasks?tab=checklists&view=run&id=' || run_record.id::text,
    auth.uid()
  )
  on conflict do nothing;
end;
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
  reopened_runs integer := 0;
  inserted_count integer := 0;
  was_completed boolean := false;
  template_title text;
  today_gt date := (now() at time zone 'America/Guatemala')::date;
begin
  if not exists (
    select 1
    from public.checklist_templates
    where id = p_template_id
  ) then
    raise exception 'Plantilla no encontrada.';
  end if;

  if not (
    public.is_checklist_library_admin()
    or public.is_checklist_change_approver()
  ) then
    raise exception 'No tienes permiso para sincronizar ejecuciones de checklist.';
  end if;

  select title into template_title
  from public.checklist_templates
  where id = p_template_id;

  for run_row in
    select *
    from public.checklist_runs
    where template_id = p_template_id
      and status <> 'cancelled'
      and (
        status in ('pending', 'in_progress', 'overdue', 'rejected', 'pending_review')
        or (status = 'completed' and run_date >= today_gt)
      )
  loop
    was_completed := run_row.status = 'completed';

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

    GET DIAGNOSTICS inserted_count = ROW_COUNT;

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

    if was_completed and (inserted_count > 0 or public.checklist_run_has_pending_required(run_row.id)) then
      update public.checklist_runs
      set
        status = 'in_progress',
        completed_at = null,
        reviewed_at = null,
        reviewed_by = null,
        review_notes = null,
        started_at = coalesce(started_at, now())
      where id = run_row.id;

      perform public.notify_checklist_run_reopened(
        run_row.id,
        coalesce(template_title, 'Checklist') || ' fue actualizada y tiene items pendientes por completar.'
      );

      reopened_runs := reopened_runs + 1;
    end if;

    synced_runs := synced_runs + 1;
  end loop;

  return jsonb_build_object(
    'synced_runs', synced_runs,
    'reopened_runs', reopened_runs
  );
end;
$$;

grant execute on function
  public.checklist_run_has_pending_required(uuid),
  public.notify_checklist_run_reopened(uuid, text),
  public.sync_checklist_runs_from_template(uuid)
to authenticated;
