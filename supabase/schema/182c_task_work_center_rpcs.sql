-- 182c: Work center RPCs — run after 182b.

-- ---------------------------------------------------------------------------
-- Shared row shape (extended)
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
    'objective', p_task.objective,
    'expected_result', p_task.expected_result,
    'status', p_task.status,
    'priority', p_task.priority,
    'difficulty', p_task.difficulty,
    'category', p_task.category,
    'area_id', p_task.area_id,
    'waiting_reason', p_task.waiting_reason,
    'waiting_unblock_note', p_task.waiting_unblock_note,
    'waiting_since', p_task.waiting_since,
    'next_action', p_task.next_action,
    'simple_steps', p_task.simple_steps,
    'evidence_required', p_task.evidence_required,
    'due_at', p_task.due_at,
    'planned_start_at', p_task.planned_start_at,
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
          'avatar_url', p.avatar_url,
          'area_name', (select a.name from public.areas a where a.id = p.area_id),
          'assignment_role', ta.assignment_role,
          'status', ta.status
        )
        order by case ta.assignment_role when 'primary' then 0 else 1 end, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id and ta.status = 'active'
    ), '[]'::jsonb),
    'primary_assignee', (
      select jsonb_build_object(
        'profile_id', ta.profile_id,
        'full_name', coalesce(p.full_name, ''),
        'avatar_url', p.avatar_url,
        'area_name', (select a.name from public.areas a where a.id = p.area_id)
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
        and ta.assignment_role = 'primary'
      limit 1
    ),
    'watchers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', tw.profile_id,
          'full_name', coalesce(p.full_name, ''),
          'avatar_url', p.avatar_url,
          'area_name', (select a.name from public.areas a where a.id = p.area_id),
          'is_assignee', exists (
            select 1 from public.task_assignees ta
            where ta.task_id = tw.task_id
              and ta.profile_id = tw.profile_id
              and ta.status = 'active'
          )
        )
        order by p.full_name
      )
      from public.task_watchers tw
      join public.profiles p on p.id = tw.profile_id
      where tw.task_id = p_task.id
    ), '[]'::jsonb),
    'area_name', (select a.name from public.areas a where a.id = p_task.area_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Card summary with work plan progress
-- ---------------------------------------------------------------------------
create or replace function public.operational_task_card_summary(
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
    'objective', p_task.objective,
    'expected_result', p_task.expected_result,
    'status', p_task.status,
    'priority', p_task.priority,
    'due_at', p_task.due_at,
    'waiting_reason', p_task.waiting_reason,
    'waiting_unblock_note', p_task.waiting_unblock_note,
    'sort_position', p_task.sort_position,
    'area_id', p_task.area_id,
    'area_name', (select a.name from public.areas a where a.id = p_task.area_id),
    'is_overdue', (
      p_task.due_at is not null
      and p_task.due_at < now()
      and p_task.status not in ('completed', 'cancelled')
    ),
    'steps_progress', public.get_task_work_plan_progress(p_task.id),
    'work_summary', public.get_task_next_work_step(p_task.id),
    'assignees', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'profile_id', ta.profile_id,
          'full_name', coalesce(p.full_name, ''),
          'avatar_url', p.avatar_url,
          'assignment_role', ta.assignment_role
        )
        order by case ta.assignment_role when 'primary' then 0 else 1 end, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id and ta.status = 'active'
    ), '[]'::jsonb),
    'primary_assignee', (
      select jsonb_build_object(
        'profile_id', ta.profile_id,
        'full_name', coalesce(p.full_name, ''),
        'avatar_url', p.avatar_url
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
        and ta.assignment_role = 'primary'
      limit 1
    ),
    'permissions', public.get_operational_task_permissions(p_task)
  );
$$;

-- ---------------------------------------------------------------------------
-- Board search (work plan text)
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_tasks_board(
  p_area_id text default null,
  p_assignee_id uuid default null,
  p_search text default null,
  p_include_cancelled boolean default false,
  p_completed_days integer default 7,
  p_include_old_completed boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(trim(lower(coalesce(p_search, ''))), '');
  v_completed_days integer := greatest(coalesce(p_completed_days, 7), 1);
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(
    public.operational_task_card_summary(t)
    order by t.sort_position asc, t.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.assigned_tasks t
  where t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
    and public.can_access_operational_task(t, 'view')
    and (p_include_cancelled or t.status <> 'cancelled')
    and (
      t.status <> 'completed'
      or p_include_old_completed
      or t.completed_at >= now() - make_interval(days => v_completed_days)
      or (t.completed_at is null and t.updated_at >= now() - make_interval(days => v_completed_days))
    )
    and (p_area_id is null or t.area_id = p_area_id)
    and (
      p_assignee_id is null
      or exists (
        select 1 from public.task_assignees ta
        where ta.task_id = t.id and ta.profile_id = p_assignee_id and ta.status = 'active'
      )
    )
    and (
      v_search is null
      or lower(t.title) like '%' || v_search || '%'
      or lower(coalesce(t.objective, '')) like '%' || v_search || '%'
      or lower(coalesce(t.expected_result, '')) like '%' || v_search || '%'
      or exists (
        select 1 from public.task_steps s
        where s.task_id = t.id
          and s.deleted_at is null
          and lower(s.text) like '%' || v_search || '%'
      )
    );

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Task detail (full work center)
-- ---------------------------------------------------------------------------
create or replace function public.get_operational_task_detail(
  p_task_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_activity jsonb;
  v_created_name text;
begin
  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
  end if;

  select * into v_task
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

  select coalesce(p.full_name, 'Sistema') into v_created_name
  from public.profiles p where p.id = v_task.created_by;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id,
      'action', l.action,
      'field_name', l.field_name,
      'old_value', l.old_value,
      'new_value', l.new_value,
      'metadata', l.metadata,
      'created_at', l.created_at,
      'actor_name', coalesce(p.full_name, 'Sistema'),
      'icon', public.task_activity_icon(l.action) ->> 'icon',
      'tone', public.task_activity_icon(l.action) ->> 'tone'
    )
    order by l.created_at desc
  ), '[]'::jsonb)
  into v_activity
  from public.task_activity_log l
  left join public.profiles p on p.id = l.actor_id
  where l.task_id = p_task_id
    and l.action not in ('moved', 'updated');

  return public.operational_task_row(v_task)
    || jsonb_build_object(
      'activity', v_activity,
      'created_by_name', v_created_name,
      'permissions', public.get_operational_task_permissions(v_task),
      'is_overdue', (
        v_task.due_at is not null
        and v_task.due_at < now()
        and v_task.status not in ('completed', 'cancelled')
      ),
      'steps_progress', public.get_task_work_plan_progress(p_task_id),
      'work_summary', public.get_task_next_work_step(p_task_id),
      'work_plan', public.task_work_plan_json(p_task_id),
      'open_days', public.task_open_duration_days(v_task),
      'blocked_days', public.task_blocked_duration_days(v_task),
      'attachments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', a.id,
            'step_id', a.step_id,
            'attachment_type', a.attachment_type,
            'storage_path', a.storage_path,
            'external_url', a.external_url,
            'display_name', a.display_name,
            'mime_type', a.mime_type,
            'size_bytes', a.size_bytes,
            'uploaded_by', a.uploaded_by,
            'uploaded_by_name', (select p.full_name from public.profiles p where p.id = a.uploaded_by),
            'uploaded_at', a.uploaded_at
          )
          order by a.uploaded_at desc
        )
        from public.task_attachments a
        where a.task_id = p_task_id and a.deleted_at is null
      ), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'step_id', c.step_id,
            'body_markdown', c.body_markdown,
            'mention_profile_ids', c.mention_profile_ids,
            'created_by', c.created_by,
            'created_by_name', (select p.full_name from public.profiles p where p.id = c.created_by),
            'created_by_avatar', (select p.avatar_url from public.profiles p where p.id = c.created_by),
            'created_at', c.created_at
          )
          order by c.created_at asc
        )
        from public.task_comments c
        where c.task_id = p_task_id and c.deleted_at is null
      ), '[]'::jsonb),
      'evidence', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', e.id,
            'step_id', e.step_id,
            'evidence_type', e.evidence_type,
            'storage_path', e.storage_path,
            'external_url', e.external_url,
            'display_name', e.display_name,
            'mime_type', e.mime_type,
            'note_text', e.note_text,
            'submitted_by', e.submitted_by,
            'submitted_by_name', (select p.full_name from public.profiles p where p.id = e.submitted_by),
            'submitted_at', e.submitted_at,
            'verified_by', e.verified_by,
            'verified_at', e.verified_at
          )
          order by e.submitted_at desc
        )
        from public.task_evidence e
        where e.task_id = p_task_id and e.deleted_at is null
      ), '[]'::jsonb),
      'recurrence', (
        select jsonb_build_object(
          'id', r.id,
          'frequency', r.frequency,
          'interval_days', r.interval_days,
          'next_run_at', r.next_run_at,
          'enabled', r.enabled
        )
        from public.task_recurrence_rules r
        where r.source_task_id = p_task_id
        limit 1
      )
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Update task (no next_action writes)
-- ---------------------------------------------------------------------------
create or replace function public.update_operational_task(
  p_task_id text,
  p_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_title text;
  v_description text;
  v_objective text;
  v_expected_result text;
  v_priority text;
  v_area_id text;
  v_category text;
  v_due_at timestamptz;
  v_planned_start timestamptz;
  v_waiting_unblock text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null and t.archived_at is null
  for update;

  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para editar esta tarea.';
  end if;
  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes editar una tarea cerrada.';
  end if;

  v_title := coalesce(nullif(trim(p_data ->> 'title'), ''), v_task.title);
  v_description := coalesce(p_data ->> 'description', v_task.description);
  v_objective := coalesce(p_data ->> 'objective', v_task.objective);
  v_expected_result := coalesce(p_data ->> 'expected_result', v_task.expected_result);
  v_priority := coalesce(nullif(trim(p_data ->> 'priority'), ''), v_task.priority);
  v_area_id := case when p_data ? 'area_id' then nullif(trim(p_data ->> 'area_id'), '') else v_task.area_id end;
  v_category := case when p_data ? 'category' then nullif(trim(p_data ->> 'category'), '') else v_task.category end;
  v_due_at := case when p_data ? 'due_at' then nullif(p_data ->> 'due_at', '')::timestamptz else v_task.due_at end;
  v_planned_start := case when p_data ? 'planned_start_at' then nullif(p_data ->> 'planned_start_at', '')::timestamptz else v_task.planned_start_at end;
  v_waiting_unblock := case when p_data ? 'waiting_unblock_note' then nullif(trim(p_data ->> 'waiting_unblock_note'), '') else v_task.waiting_unblock_note end;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridad inválida.';
  end if;

  update public.assigned_tasks
  set title = v_title,
      description = coalesce(v_description, ''),
      objective = coalesce(v_objective, ''),
      expected_result = coalesce(v_expected_result, ''),
      priority = v_priority,
      area_id = v_area_id,
      category = v_category,
      due_at = v_due_at,
      due_date = case when v_due_at is null then null else v_due_at::date end,
      planned_start_at = v_planned_start,
      waiting_unblock_note = v_waiting_unblock,
      updated_at = now()
  where id = p_task_id returning * into v_task;

  return public.get_operational_task_detail(p_task_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Status transitions (waiting/blocked + unblock note)
-- ---------------------------------------------------------------------------
create or replace function public.update_operational_task_status(
  p_task_id text,
  p_status text,
  p_waiting_reason text default null,
  p_next_action text default null,
  p_cancel_reason text default null,
  p_waiting_unblock_note text default null
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
  v_unblock text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;
  if v_status = '' then raise exception 'El estado es obligatorio.'; end if;
  if v_status not in ('pending', 'in_progress', 'waiting', 'blocked', 'in_review', 'completed', 'cancelled') then
    raise exception 'Estado inválido.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null and t.archived_at is null
  for update;

  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para actualizar esta tarea.';
  end if;

  v_old_status := v_task.status;
  v_unblock := coalesce(nullif(trim(p_waiting_unblock_note), ''), nullif(trim(p_next_action), ''));

  if v_status in ('waiting', 'blocked') and coalesce(trim(p_waiting_reason), '') = '' then
    raise exception 'Indica qué estamos esperando.';
  end if;

  if v_status = 'cancelled' and coalesce(trim(p_cancel_reason), '') = '' then
    if not public.is_operational_task_area_manager() then
      raise exception 'Indica el motivo de cancelación.';
    end if;
  end if;

  update public.assigned_tasks
  set status = v_status,
      waiting_reason = case when v_status in ('waiting', 'blocked') then p_waiting_reason else null end,
      waiting_unblock_note = case when v_status in ('waiting', 'blocked') then v_unblock else waiting_unblock_note end,
      waiting_since = case
        when v_status in ('waiting', 'blocked') and v_old_status not in ('waiting', 'blocked') then now()
        when v_status not in ('waiting', 'blocked') then null
        else waiting_since
      end,
      started_at = case when v_status = 'in_progress' and started_at is null then now() else started_at end,
      completed_at = case
        when v_status = 'completed' then now()
        when v_status in ('pending', 'in_progress', 'waiting', 'blocked', 'in_review') then null
        else completed_at
      end,
      cancelled_at = case when v_status = 'cancelled' then now() else cancelled_at end,
      cancelled_by = case when v_status = 'cancelled' then auth.uid() else cancelled_by end,
      cancel_reason = case when v_status = 'cancelled' then nullif(trim(coalesce(p_cancel_reason, '')), '') else cancel_reason end,
      updated_at = now()
  where id = p_task_id returning * into v_task;

  if v_old_status is distinct from v_status then
    perform public.log_task_activity(
      p_task_id, 'status_changed', 'status',
      to_jsonb(v_old_status), to_jsonb(v_status),
      jsonb_build_object('waiting_reason', p_waiting_reason, 'waiting_unblock_note', v_unblock)
    );
  end if;

  return public.operational_task_card_summary(v_task);
end;
$$;

-- ---------------------------------------------------------------------------
-- Move task (Kanban)
-- ---------------------------------------------------------------------------
create or replace function public.move_operational_task(
  p_task_id text,
  p_status text,
  p_sort_position numeric default null,
  p_waiting_reason text default null,
  p_next_action text default null,
  p_waiting_unblock_note text default null
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
  v_old_sort numeric;
  v_unblock text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;
  if v_status = '' then raise exception 'El estado es obligatorio.'; end if;
  if v_status not in ('pending', 'in_progress', 'waiting', 'blocked', 'in_review', 'completed', 'cancelled') then
    raise exception 'Estado inválido.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null and t.archived_at is null
  for update;

  if not found then raise exception 'Tarea no encontrada.'; end if;
  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para mover esta tarea.';
  end if;

  v_unblock := coalesce(nullif(trim(p_waiting_unblock_note), ''), nullif(trim(p_next_action), ''));

  if v_status in ('waiting', 'blocked') and coalesce(trim(p_waiting_reason), '') = '' then
    raise exception 'Indica qué estamos esperando.';
  end if;

  v_old_status := v_task.status;
  v_old_sort := v_task.sort_position;

  update public.assigned_tasks
  set status = v_status,
      sort_position = coalesce(p_sort_position, sort_position),
      waiting_reason = case when v_status in ('waiting', 'blocked') then p_waiting_reason else null end,
      waiting_unblock_note = case when v_status in ('waiting', 'blocked') then v_unblock else waiting_unblock_note end,
      waiting_since = case
        when v_status in ('waiting', 'blocked') and v_old_status not in ('waiting', 'blocked') then now()
        when v_status not in ('waiting', 'blocked') then null
        else waiting_since
      end,
      started_at = case when v_status = 'in_progress' and started_at is null then now() else started_at end,
      completed_at = case
        when v_status = 'completed' then now()
        when v_status in ('pending', 'in_progress', 'waiting', 'blocked', 'in_review') then null
        else completed_at
      end,
      updated_at = now()
  where id = p_task_id returning * into v_task;

  if v_old_status is distinct from v_status then
    perform public.log_task_activity(
      p_task_id, 'status_changed', 'status',
      to_jsonb(v_old_status), to_jsonb(v_status),
      jsonb_build_object('waiting_reason', p_waiting_reason, 'waiting_unblock_note', v_unblock)
    );
  end if;

  return public.operational_task_card_summary(v_task);
end;
$$;
