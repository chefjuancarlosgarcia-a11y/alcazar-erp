-- Operational tasks v2 RPCs.
-- Apply after 176_operational_tasks_schema.sql.

-- ---------------------------------------------------------------------------
-- Shared row shape for board / my work queries
-- ---------------------------------------------------------------------------
create or replace function public.operational_task_row(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_task.id,
    'title', p_task.title,
    'description', p_task.description,
    'status', p_task.status,
    'priority', p_task.priority,
    'difficulty', p_task.difficulty,
    'category', p_task.category,
    'area_id', p_task.area_id,
    'waiting_reason', p_task.waiting_reason,
    'next_action', p_task.next_action,
    'simple_steps', p_task.simple_steps,
    'evidence_required', p_task.evidence_required,
    'due_at', p_task.due_at,
    'due_date', p_task.due_date,
    'execution_date', p_task.execution_date,
    'scheduled_start', p_task.scheduled_start,
    'started_at', p_task.started_at,
    'completed_at', p_task.completed_at,
    'cancelled_at', p_task.cancelled_at,
    'created_at', p_task.created_at,
    'updated_at', p_task.updated_at,
    'last_activity_at', p_task.last_activity_at,
    'created_by', p_task.created_by,
    'assigned_by', p_task.assigned_by,
    'project_id', p_task.project_id,
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', ta.profile_id,
          'full_name', coalesce(p.full_name, ''),
          'assignment_role', ta.assignment_role,
          'status', ta.status
        )
        order by ta.assignment_role, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
    ), '[]'::jsonb),
    'area_name', (
      select a.name
      from public.areas a
      where a.id = p_task.area_id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- get_operational_tasks_board
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_tasks_board(
  p_area_id text default null,
  p_assignee_id uuid default null,
  p_search text default null,
  p_include_cancelled boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(lower(coalesce(p_search, ''))), '');
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(public.operational_task_row(t) order by
    case t.priority
      when 'critical' then 1
      when 'high' then 2
      when 'medium' then 3
      else 4
    end,
    t.due_at nulls last,
    t.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.assigned_tasks t
  where t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
    and public.can_access_operational_task(t, 'view')
    and (p_include_cancelled or t.status <> 'cancelled')
    and (p_area_id is null or t.area_id = p_area_id)
    and (
      p_assignee_id is null
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = t.id
          and ta.profile_id = p_assignee_id
          and ta.status = 'active'
      )
    )
    and (
      v_search is null
      or lower(t.title) like '%' || v_search || '%'
      or lower(coalesce(t.description, '')) like '%' || v_search || '%'
      or lower(coalesce(t.category, '')) like '%' || v_search || '%'
    );

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_my_operational_tasks
-- ---------------------------------------------------------------------------
create or replace function public.get_my_operational_tasks(
  p_status text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := nullif(trim(coalesce(p_status, '')), '');
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(public.operational_task_row(t) order by
    case when t.status in ('completed', 'cancelled') then 1 else 0 end,
    case t.priority
      when 'critical' then 1
      when 'high' then 2
      when 'medium' then 3
      else 4
    end,
    t.due_at nulls last,
    t.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.assigned_tasks t
  where t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
    and public.can_access_operational_task(t, 'view')
    and (
      t.created_by = auth.uid()
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = t.id
          and ta.profile_id = auth.uid()
          and ta.status = 'active'
      )
    )
    and (v_status is null or t.status = v_status)
  limit v_limit;

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_operational_task_detail
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_task_detail(p_task_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_activity jsonb;
begin
  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
  end if;

  select *
  into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null;

  if not found then
    raise exception 'Tarea no encontrada.';
  end if;

  if not public.can_access_operational_task(v_task, 'view') then
    raise exception 'No tienes permiso para ver esta tarea.';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'action', l.action,
      'field_name', l.field_name,
      'old_value', l.old_value,
      'new_value', l.new_value,
      'metadata', l.metadata,
      'created_at', l.created_at,
      'actor_name', coalesce(p.full_name, 'Sistema')
    )
    order by l.created_at desc
  ), '[]'::jsonb)
  into v_activity
  from public.task_activity_log l
  left join public.profiles p on p.id = l.actor_id
  where l.task_id = p_task_id;

  return public.operational_task_row(v_task)
    || jsonb_build_object('activity', v_activity);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_operational_task_quick
-- ---------------------------------------------------------------------------
create or replace function public.create_operational_task_quick(
  p_title text,
  p_assignee_id uuid default null,
  p_area_id text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := trim(coalesce(p_title, ''));
  v_assignee uuid := coalesce(p_assignee_id, auth.uid());
  v_task_id text;
  v_task public.assigned_tasks;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if v_title = '' then
    raise exception 'El título es obligatorio.';
  end if;

  if not public.can_assign_profile_to_operational_task(v_assignee) then
    raise exception 'No tienes permiso para asignar esta tarea.';
  end if;

  v_task_id := 'opt-' || gen_random_uuid()::text;

  insert into public.assigned_tasks (
    id, title, status, task_source, area_id, due_at, due_date,
    created_by, assigned_by, priority
  )
  values (
    v_task_id,
    v_title,
    'pending',
    'operational',
    p_area_id,
    p_due_at,
    case when p_due_at is null then null else p_due_at::date end,
    auth.uid(),
    auth.uid(),
    'medium'
  )
  returning * into v_task;

  insert into public.task_assignees (
    task_id, profile_id, assignment_role, assigned_by
  )
  values (
    v_task_id, v_assignee, 'primary', auth.uid()
  );

  perform public.log_task_activity(
    v_task_id,
    'created',
    null,
    null,
    jsonb_build_object('title', v_title, 'status', 'pending'),
    jsonb_build_object('mode', 'quick')
  );

  return public.operational_task_row(v_task);
end;
$$;

-- ---------------------------------------------------------------------------
-- create_operational_task
-- ---------------------------------------------------------------------------
create or replace function public.create_operational_task(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := trim(coalesce(p_data ->> 'title', ''));
  v_description text := coalesce(p_data ->> 'description', '');
  v_area_id text := nullif(trim(coalesce(p_data ->> 'area_id', '')), '');
  v_category text := nullif(trim(coalesce(p_data ->> 'category', '')), '');
  v_priority text := coalesce(nullif(trim(p_data ->> 'priority'), ''), 'medium');
  v_difficulty text := nullif(trim(coalesce(p_data ->> 'difficulty', '')), '');
  v_due_at timestamptz := nullif(p_data ->> 'due_at', '')::timestamptz;
  v_evidence_required boolean := coalesce((p_data ->> 'evidence_required')::boolean, false);
  v_simple_steps jsonb := coalesce(p_data -> 'simple_steps', '[]'::jsonb);
  v_assignee_ids uuid[];
  v_assignee uuid;
  v_task_id text;
  v_task public.assigned_tasks;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if v_title = '' then
    raise exception 'El título es obligatorio.';
  end if;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridad inválida.';
  end if;

  select coalesce(array_agg(distinct value::uuid), '{}'::uuid[])
  into v_assignee_ids
  from jsonb_array_elements_text(coalesce(p_data -> 'assignee_ids', '[]'::jsonb)) as value
  where nullif(trim(value), '') is not null;

  if coalesce(array_length(v_assignee_ids, 1), 0) = 0 then
    v_assignee_ids := array[auth.uid()];
  end if;

  foreach v_assignee in array v_assignee_ids loop
    if not public.can_assign_profile_to_operational_task(v_assignee) then
      raise exception 'No tienes permiso para asignar a uno de los colaboradores.';
    end if;
  end loop;

  v_task_id := 'opt-' || gen_random_uuid()::text;

  insert into public.assigned_tasks (
    id, title, description, status, task_source, area_id, category,
    priority, difficulty, due_at, due_date, evidence_required, simple_steps,
    created_by, assigned_by
  )
  values (
    v_task_id,
    v_title,
    v_description,
    'pending',
    'operational',
    v_area_id,
    v_category,
    v_priority,
    v_difficulty,
    v_due_at,
    case when v_due_at is null then null else v_due_at::date end,
    v_evidence_required,
    v_simple_steps,
    auth.uid(),
    auth.uid()
  )
  returning * into v_task;

  foreach v_assignee in array v_assignee_ids loop
    insert into public.task_assignees (
      task_id, profile_id, assignment_role, assigned_by
    )
    values (
      v_task_id,
      v_assignee,
      case when v_assignee = v_assignee_ids[1] then 'primary' else 'participant' end,
      auth.uid()
    );
  end loop;

  perform public.log_task_activity(
    v_task_id,
    'created',
    null,
    null,
    jsonb_build_object('title', v_title, 'status', 'pending'),
    jsonb_build_object('mode', 'full')
  );

  return public.operational_task_row(v_task);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_operational_task_status
-- ---------------------------------------------------------------------------
create or replace function public.update_operational_task_status(
  p_task_id text,
  p_status text,
  p_waiting_reason text default null,
  p_next_action text default null,
  p_cancel_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_status text := trim(coalesce(p_status, ''));
  v_old_status text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if v_status = '' then
    raise exception 'El estado es obligatorio.';
  end if;

  if v_status not in ('pending', 'in_progress', 'waiting', 'in_review', 'completed', 'cancelled') then
    raise exception 'Estado inválido.';
  end if;

  select *
  into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
  for update;

  if not found then
    raise exception 'Tarea no encontrada.';
  end if;

  if not public.can_access_operational_task(v_task, 'edit') then
    if not (
      exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = v_task.id
          and ta.profile_id = auth.uid()
          and ta.status = 'active'
      )
      or public.is_operational_task_area_manager()
    ) then
      raise exception 'No tienes permiso para actualizar esta tarea.';
    end if;
  end if;

  v_old_status := v_task.status;

  if v_status = 'waiting' and coalesce(trim(p_waiting_reason), '') = '' then
    raise exception 'Indica el motivo de espera.';
  end if;

  if v_status = 'cancelled' and coalesce(trim(p_cancel_reason), '') = '' then
    if not public.is_operational_task_area_manager() then
      raise exception 'Indica el motivo de cancelación.';
    end if;
  end if;

  update public.assigned_tasks
  set
    status = v_status,
    waiting_reason = case when v_status = 'waiting' then p_waiting_reason else null end,
    next_action = case when v_status = 'waiting' then nullif(trim(coalesce(p_next_action, '')), '') else next_action end,
    started_at = case
      when v_status = 'in_progress' and started_at is null then now()
      else started_at
    end,
    completed_at = case
      when v_status = 'completed' then now()
      when v_status in ('pending', 'in_progress', 'waiting', 'in_review') then null
      else completed_at
    end,
    cancelled_at = case when v_status = 'cancelled' then now() else cancelled_at end,
    cancelled_by = case when v_status = 'cancelled' then auth.uid() else cancelled_by end,
    cancel_reason = case when v_status = 'cancelled' then nullif(trim(coalesce(p_cancel_reason, '')), '') else cancel_reason end,
    updated_at = now()
  where id = p_task_id
  returning * into v_task;

  perform public.log_task_activity(
    p_task_id,
    'status_changed',
    'status',
    to_jsonb(v_old_status),
    to_jsonb(v_status),
    jsonb_build_object(
      'waiting_reason', p_waiting_reason,
      'next_action', p_next_action,
      'cancel_reason', p_cancel_reason
    )
  );

  return public.operational_task_row(v_task);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.operational_task_row(public.assigned_tasks) from public;
revoke all on function public.get_operational_tasks_board(text, uuid, text, boolean) from public;
revoke all on function public.get_my_operational_tasks(text, integer) from public;
revoke all on function public.get_operational_task_detail(text) from public;
revoke all on function public.create_operational_task_quick(text, uuid, text, timestamptz) from public;
revoke all on function public.create_operational_task(jsonb) from public;
revoke all on function public.update_operational_task_status(text, text, text, text, text) from public;

grant execute on function public.operational_task_row(public.assigned_tasks) to authenticated;
grant execute on function public.get_operational_tasks_board(text, uuid, text, boolean) to authenticated;
grant execute on function public.get_my_operational_tasks(text, integer) to authenticated;
grant execute on function public.get_operational_task_detail(text) to authenticated;
grant execute on function public.create_operational_task_quick(text, uuid, text, timestamptz) to authenticated;
grant execute on function public.create_operational_task(jsonb) to authenticated;
grant execute on function public.update_operational_task_status(text, text, text, text, text) to authenticated;
