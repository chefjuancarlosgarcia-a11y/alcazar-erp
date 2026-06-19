-- Checklist operational day, display timing, and manual run replacements.
-- Apply after 106_attendance_labor_date.sql.
-- Does not change RLS policies.

insert into public.app_settings (key, value)
values ('checklist_operational_day_end_time', to_jsonb('04:00'::text))
on conflict (key) do nothing;

alter table public.checklist_runs
  add column if not exists original_assigned_profile_id uuid references public.profiles(id),
  add column if not exists replacement_reason text
    check (replacement_reason is null or replacement_reason in (
      'descanso', 'vacaciones', 'permiso', 'ausencia', 'emergencia', 'otro'
    )),
  add column if not exists replacement_notes text,
  add column if not exists replaced_at timestamptz,
  add column if not exists replaced_by uuid references public.profiles(id),
  add column if not exists completion_timing text
    check (completion_timing is null or completion_timing in ('on_time', 'late'));

update public.checklist_runs
set original_assigned_profile_id = assigned_profile_id
where original_assigned_profile_id is null
  and assigned_profile_id is not null;

create index if not exists checklist_runs_replacement_idx
  on public.checklist_runs (replaced_at desc)
  where replaced_at is not null;

create or replace function public.get_checklist_operational_day_end_time()
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select nullif(trim(both '"' from (value #>> '{}')), '')::time
      from public.app_settings
      where key = 'checklist_operational_day_end_time'
      limit 1
    ),
    time '04:00'
  );
$$;

create or replace function public.get_checklist_operational_date(
  p_at timestamptz default now()
)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when ((p_at at time zone 'America/Guatemala')::time < public.get_checklist_operational_day_end_time())
      then ((p_at at time zone 'America/Guatemala')::date - 1)
    else (p_at at time zone 'America/Guatemala')::date
  end;
$$;

create or replace function public.get_checklist_operational_window_end(
  p_run_date date
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (
    (p_run_date + interval '1 day') + public.get_checklist_operational_day_end_time()
  ) at time zone 'America/Guatemala';
$$;

create or replace function public.is_checklist_operational_window_open(
  p_run_date date,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_at < public.get_checklist_operational_window_end(p_run_date);
$$;

create or replace function public.get_checklist_expected_due_at(
  p_run public.checklist_runs
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_run.due_time is null then null
    else ((p_run.run_date + p_run.due_time) at time zone 'America/Guatemala')
  end;
$$;

create or replace function public.get_checklist_operational_status(
  p_run public.checklist_runs,
  p_at timestamptz default now()
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  due_at timestamptz;
  completed_at timestamptz := coalesce(p_run.completed_at, p_run.submitted_at);
begin
  if p_run.status = 'completed' then
    due_at := public.get_checklist_expected_due_at(p_run);
    if p_run.completion_timing = 'on_time' then
      return 'completada_a_tiempo';
    elsif p_run.completion_timing = 'late' then
      return 'completada_tarde';
    elsif due_at is not null and completed_at is not null and completed_at <= due_at then
      return 'completada_a_tiempo';
    elsif due_at is not null and completed_at is not null then
      return 'completada_tarde';
    end if;
    return 'completada_a_tiempo';
  end if;

  if p_run.status = 'overdue'
    or (
      p_run.status in ('pending', 'in_progress', 'rejected')
      and not public.is_checklist_operational_window_open(p_run.run_date, p_at)
    ) then
    return 'vencida';
  end if;

  due_at := public.get_checklist_expected_due_at(p_run);
  if due_at is not null and p_at > due_at then
    return 'pendiente_atrasada';
  end if;

  return 'pendiente';
end;
$$;

create or replace function public.can_assign_checklist_run_replacement()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos', 'rrhh'
      )
  );
$$;

revoke all on function public.get_checklist_operational_day_end_time() from public;
grant execute on function public.get_checklist_operational_day_end_time() to authenticated;
revoke all on function public.get_checklist_operational_date(timestamptz) from public;
grant execute on function public.get_checklist_operational_date(timestamptz) to authenticated;
revoke all on function public.get_checklist_operational_window_end(date) from public;
grant execute on function public.get_checklist_operational_window_end(date) to authenticated;
revoke all on function public.is_checklist_operational_window_open(date, timestamptz) from public;
grant execute on function public.is_checklist_operational_window_open(date, timestamptz) to authenticated;
revoke all on function public.get_checklist_expected_due_at(public.checklist_runs) from public;
revoke all on function public.get_checklist_operational_status(public.checklist_runs, timestamptz) from public;
grant execute on function public.get_checklist_operational_status(public.checklist_runs, timestamptz) to authenticated;
revoke all on function public.can_assign_checklist_run_replacement() from public;
grant execute on function public.can_assign_checklist_run_replacement() to authenticated;

create or replace function public.assign_checklist_run_replacement(
  p_run_id uuid,
  p_replacement_profile_id uuid,
  p_reason text,
  p_notes text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  replacement_row public.profiles;
  original_id uuid;
  reason_value text := lower(trim(coalesce(p_reason, '')));
  notes_value text := nullif(trim(coalesce(p_notes, '')), '');
  replacement_name text;
  actor_name text;
  role_value text;
begin
  if not public.can_assign_checklist_run_replacement() then
    raise exception 'No tienes permiso para asignar reemplazos de checklist.';
  end if;

  if p_replacement_profile_id is null then
    raise exception 'Selecciona un colaborador de reemplazo.';
  end if;

  if reason_value not in ('descanso', 'vacaciones', 'permiso', 'ausencia', 'emergencia', 'otro') then
    raise exception 'Motivo de reemplazo invalido.';
  end if;

  select * into run_row
  from public.checklist_runs
  where id = p_run_id
  for update;

  if run_row.id is null then
    raise exception 'Checklist no encontrada.';
  end if;

  if run_row.status in ('completed', 'cancelled') then
    raise exception 'No se puede reasignar una checklist completada o cancelada.';
  end if;

  select * into replacement_row
  from public.profiles
  where id = p_replacement_profile_id
    and status = 'active';

  if replacement_row.id is null then
    raise exception 'Colaborador de reemplazo no encontrado o inactivo.';
  end if;

  original_id := coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id);

  if original_id = p_replacement_profile_id then
    raise exception 'El reemplazo debe ser un colaborador distinto al responsable original.';
  end if;

  update public.checklist_runs
  set
    original_assigned_profile_id = original_id,
    assigned_profile_id = p_replacement_profile_id,
    replacement_reason = reason_value,
    replacement_notes = notes_value,
    replaced_at = now(),
    replaced_by = auth.uid(),
    updated_at = now()
  where id = p_run_id
  returning * into run_row;

  insert into public.checklist_session_audit (profile_id, checklist_run_id, event_type, details)
  values (
    auth.uid(),
    run_row.id,
    'run_replacement',
    jsonb_build_object(
      'original_assigned_profile_id', original_id,
      'replacement_profile_id', p_replacement_profile_id,
      'replacement_reason', reason_value,
      'replacement_notes', notes_value
    )
  );

  select coalesce(full_name, username, 'Colaborador') into replacement_name
  from public.profiles
  where id = p_replacement_profile_id;

  select coalesce(full_name, username, 'Supervisor') into actor_name
  from public.profiles
  where id = auth.uid();

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    p_replacement_profile_id,
    null,
    'checklist_replacement',
    'Checklist asignada por reemplazo',
    coalesce(
      (select title from public.checklist_templates where id = run_row.template_id limit 1),
      'Checklist'
    ) || ' fue reasignada a ti. Motivo: ' || reason_value || '.',
    'checklist_run',
    run_row.id::text,
    '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
    auth.uid()
  );

  if run_row.supervisor_profile_id is not null then
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      run_row.supervisor_profile_id,
      null,
      'checklist_replacement',
      'Reemplazo de checklist registrado',
      actor_name || ' reasigno una checklist a ' || replacement_name || ' (' || reason_value || ').',
      'checklist_run',
      run_row.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
      auth.uid()
    );
  end if;

  foreach role_value in array array['admin', 'gerente_general']
  loop
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      null,
      role_value,
      'checklist_replacement',
      'Reemplazo de checklist registrado',
      actor_name || ' reasigno una checklist a ' || coalesce(
        (select full_name from public.profiles where id = p_replacement_profile_id limit 1),
        'colaborador'
      ) || ' (' || reason_value || ').',
      'checklist_run',
      run_row.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
      auth.uid()
    );
  end loop;

  return run_row;
end;
$$;

revoke all on function public.assign_checklist_run_replacement(uuid, uuid, text, text) from public;
grant execute on function public.assign_checklist_run_replacement(uuid, uuid, text, text) to authenticated;

create or replace function public.submit_checklist_run_for_review(p_run_id uuid)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  missing_count integer;
  due_at timestamptz;
  completed_ts timestamptz := now();
  timing text := 'on_time';
begin
  select * into run_row from public.checklist_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Checklist no encontrada.'; end if;
  if not public.can_access_checklist_run(run_row) then raise exception 'No tienes permiso para completar esta checklist.'; end if;

  select count(*) into missing_count
  from public.checklist_run_items item
  where item.run_id = p_run_id
    and (
      (item.is_required and not (
        item.checked
        or nullif(trim(coalesce(item.response_text, '')), '') is not null
        or item.response_number is not null
        or item.response_date is not null
        or item.response_time is not null
        or coalesce(item.response_json, '{}'::jsonb) <> '{}'::jsonb
        or nullif(trim(coalesce(item.photo_url, '')), '') is not null
      ))
      or ((item.requires_photo or (item.require_photo_on_no and lower(coalesce(item.response_text, '')) = 'no')) and nullif(trim(coalesce(item.photo_url, '')), '') is null)
      or ((item.requires_comment or (item.require_comment_on_no and lower(coalesce(item.response_text, '')) = 'no')) and nullif(trim(coalesce(item.comment, '')), '') is null)
    );

  if missing_count > 0 then
    raise exception 'Completa las preguntas obligatorias antes de enviar.';
  end if;

  perform public.recalculate_checklist_run_points(p_run_id);

  due_at := public.get_checklist_expected_due_at(run_row);
  if due_at is not null and completed_ts > due_at then
    timing := 'late';
  end if;

  update public.checklist_runs
  set status = 'completed',
      submitted_at = completed_ts,
      completed_at = completed_ts,
      completed_by = auth.uid(),
      completion_timing = timing,
      reviewed_by = null,
      reviewed_at = null,
      review_notes = null
  where id = p_run_id
  returning * into run_row;

  return run_row;
end;
$$;

create or replace function public.notify_overdue_checklist_runs(p_reference timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  template_row public.checklist_templates;
  assignee_name text;
  notified_count integer := 0;
  role_value text;
  current_ts timestamptz := coalesce(p_reference, now());
begin
  for run_row in
    select r.*
    from public.checklist_runs r
    where r.status in ('pending', 'in_progress', 'rejected')
      and r.overdue_notified_at is null
      and not public.is_checklist_operational_window_open(r.run_date, current_ts)
  loop
    select * into template_row
    from public.checklist_templates
    where id = run_row.template_id;

    select coalesce(p.full_name, p.username, 'Colaborador') into assignee_name
    from public.profiles p
    where p.id = run_row.assigned_profile_id;

    update public.checklist_runs
    set status = 'overdue',
        overdue_notified_at = now()
    where id = run_row.id;

    foreach role_value in array array['admin', 'gerente_general']
    loop
      insert into public.notifications (
        user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
      )
      values (
        null,
        role_value,
        'checklist_overdue',
        'Checklist vencida',
        coalesce(nullif(trim(template_row.title), ''), 'Checklist')
          || ' asignada a '
          || coalesce(assignee_name, 'colaborador')
          || ' no fue completada al cierre operativo.',
        'checklist_run',
        run_row.id::text,
        '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
        null
      );
    end loop;

    notified_count := notified_count + 1;
  end loop;

  return jsonb_build_object('notified_count', notified_count);
end;
$$;

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
    effective_profile_id
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

revoke all on function public.submit_checklist_run_for_review(uuid) from public;
grant execute on function public.submit_checklist_run_for_review(uuid) to authenticated;
revoke all on function public.notify_overdue_checklist_runs(timestamptz) from public;
grant execute on function public.notify_overdue_checklist_runs(timestamptz) to authenticated;
