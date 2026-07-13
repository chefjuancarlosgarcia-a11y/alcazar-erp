-- Phase B: compact Kanban cards, sort_position, move RPC, permissions.
-- Apply after 179_update_operational_task_assignees.sql.

-- ---------------------------------------------------------------------------
-- Schema extensions
-- ---------------------------------------------------------------------------
alter table public.assigned_tasks
  add column if not exists sort_position numeric not null default 0;

create index if not exists assigned_tasks_operational_sort_idx
  on public.assigned_tasks (status, sort_position)
  where task_source = 'operational'
    and deleted_at is null
    and archived_at is null;

alter table public.assigned_tasks
  drop constraint if exists assigned_tasks_waiting_reason_check;

alter table public.assigned_tasks
  add constraint assigned_tasks_waiting_reason_check
  check (
    waiting_reason is null
    or waiting_reason in (
      'vendor', 'approval', 'info', 'collaborator', 'spare_part', 'date', 'other'
    )
  );

create unique index if not exists task_assignees_active_profile_uidx
  on public.task_assignees (task_id, profile_id)
  where status = 'active';

-- Backfill sort_position from created_at for existing rows
update public.assigned_tasks
set sort_position = extract(epoch from created_at) * 1000
where task_source = 'operational'
  and sort_position = 0;

-- ---------------------------------------------------------------------------
-- Permission helper for mutations (CEO read-only unless participant/creator)
-- ---------------------------------------------------------------------------
create or replace function public.can_mutate_operational_task(
  p_task public.assigned_tasks
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    return false;
  end if;

  if p_task.task_source <> 'operational' then
    return false;
  end if;

  if p_task.deleted_at is not null or p_task.archived_at is not null then
    return actor_role = 'admin';
  end if;

  if p_task.status in ('completed', 'cancelled') and actor_role not in ('admin', 'gerente_general', 'gerente') then
    if not (
      exists (
        select 1 from public.task_assignees ta
        where ta.task_id = p_task.id and ta.profile_id = auth.uid() and ta.status = 'active'
      )
      or p_task.created_by = auth.uid()
    ) then
      return false;
    end if;
  end if;

  if actor_role = 'ceo' then
    return p_task.created_by = auth.uid()
      or exists (
        select 1 from public.task_assignees ta
        where ta.task_id = p_task.id and ta.profile_id = auth.uid() and ta.status = 'active'
      );
  end if;

  if exists (
    select 1 from public.task_assignees ta
    where ta.task_id = p_task.id and ta.profile_id = auth.uid() and ta.status = 'active'
  ) then
    return true;
  end if;

  if p_task.created_by = auth.uid() then
    return true;
  end if;

  if public.is_operational_task_area_manager() then
    if actor_role = 'supervisor' then
      return exists (
        select 1
        from public.task_assignees ta
        join public.profiles p on p.id = ta.profile_id
        where ta.task_id = p_task.id
          and ta.status = 'active'
          and p.supervisor_profile_id = auth.uid()
      );
    end if;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.get_operational_task_permissions(
  p_task public.assigned_tasks
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'can_view', public.can_access_operational_task(p_task, 'view'),
    'can_edit', public.can_mutate_operational_task(p_task),
    'can_assign', public.can_mutate_operational_task(p_task)
      and (
        public.is_operational_task_area_manager()
        or p_task.created_by = auth.uid()
      ),
    'can_move', public.can_mutate_operational_task(p_task)
  );
$$;

-- ---------------------------------------------------------------------------
-- Compact card summary (no description, no full activity)
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
    'status', p_task.status,
    'priority', p_task.priority,
    'due_at', p_task.due_at,
    'waiting_reason', p_task.waiting_reason,
    'next_action', p_task.next_action,
    'sort_position', p_task.sort_position,
    'area_id', p_task.area_id,
    'area_name', (select a.name from public.areas a where a.id = p_task.area_id),
    'is_overdue', (
      p_task.due_at is not null
      and p_task.due_at < now()
      and p_task.status not in ('completed', 'cancelled')
    ),
    'steps_progress', case
      when coalesce(jsonb_array_length(p_task.simple_steps), 0) > 0 then jsonb_build_object(
        'total', jsonb_array_length(p_task.simple_steps),
        'done', (
          select count(*)::int
          from jsonb_array_elements(p_task.simple_steps) step
          where coalesce((step ->> 'done')::boolean, (step ->> 'completed')::boolean, false)
        )
      )
      else null
    end,
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
-- Board RPC (compact)
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
      or lower(coalesce(t.next_action, '')) like '%' || v_search || '%'
    );

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Detail RPC (full + permissions + activity)
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
  v_created_name text;
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

  select coalesce(p.full_name, 'Sistema')
  into v_created_name
  from public.profiles p
  where p.id = v_task.created_by;

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
    || jsonb_build_object(
      'activity', v_activity,
      'created_by_name', v_created_name,
      'permissions', public.get_operational_task_permissions(v_task),
      'is_overdue', (
        v_task.due_at is not null
        and v_task.due_at < now()
        and v_task.status not in ('completed', 'cancelled')
      ),
      'steps_progress', case
        when coalesce(jsonb_array_length(v_task.simple_steps), 0) > 0 then jsonb_build_object(
          'total', jsonb_array_length(v_task.simple_steps),
          'done', (
            select count(*)::int
            from jsonb_array_elements(v_task.simple_steps) step
            where coalesce((step ->> 'done')::boolean, (step ->> 'completed')::boolean, false)
          )
        )
        else null
      end
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Move task (status + sort_position)
-- ---------------------------------------------------------------------------
create or replace function public.move_operational_task(
  p_task_id text,
  p_status text,
  p_sort_position numeric default null,
  p_waiting_reason text default null,
  p_next_action text default null
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

  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para mover esta tarea.';
  end if;

  if v_status = 'waiting' and coalesce(trim(p_waiting_reason), '') = '' then
    raise exception 'Indica el motivo de espera.';
  end if;

  v_old_status := v_task.status;
  v_old_sort := v_task.sort_position;

  update public.assigned_tasks
  set
    status = v_status,
    sort_position = coalesce(p_sort_position, sort_position),
    waiting_reason = case when v_status = 'waiting' then p_waiting_reason else null end,
    next_action = case
      when v_status = 'waiting' then nullif(trim(coalesce(p_next_action, '')), '')
      else next_action
    end,
    started_at = case
      when v_status = 'in_progress' and started_at is null then now()
      else started_at
    end,
    completed_at = case
      when v_status = 'completed' then now()
      when v_status in ('pending', 'in_progress', 'waiting', 'in_review') then null
      else completed_at
    end,
    updated_at = now()
  where id = p_task_id
  returning * into v_task;

  if v_old_status is distinct from v_status then
    perform public.log_task_activity(
      p_task_id, 'status_changed', 'status',
      to_jsonb(v_old_status), to_jsonb(v_status),
      jsonb_build_object('waiting_reason', p_waiting_reason, 'next_action', p_next_action)
    );
  end if;

  if p_sort_position is not null and v_old_sort is distinct from p_sort_position then
    perform public.log_task_activity(
      p_task_id, 'moved', 'sort_position',
      to_jsonb(v_old_sort), to_jsonb(p_sort_position),
      jsonb_build_object('status', v_status)
    );
  end if;

  return public.operational_task_card_summary(v_task);
end;
$$;

-- Patch update_operational_task to use can_mutate
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
  v_priority text;
  v_area_id text;
  v_category text;
  v_due_at timestamptz;
  v_next_action text;
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
  v_priority := coalesce(nullif(trim(p_data ->> 'priority'), ''), v_task.priority);
  v_area_id := case when p_data ? 'area_id' then nullif(trim(p_data ->> 'area_id'), '') else v_task.area_id end;
  v_category := case when p_data ? 'category' then nullif(trim(p_data ->> 'category'), '') else v_task.category end;
  v_due_at := case when p_data ? 'due_at' then nullif(p_data ->> 'due_at', '')::timestamptz else v_task.due_at end;
  v_next_action := case when p_data ? 'next_action' then nullif(trim(p_data ->> 'next_action'), '') else v_task.next_action end;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridad inválida.';
  end if;

  update public.assigned_tasks
  set title = v_title, description = coalesce(v_description, ''), priority = v_priority,
      area_id = v_area_id, category = v_category, due_at = v_due_at,
      due_date = case when v_due_at is null then null else v_due_at::date end,
      next_action = v_next_action, updated_at = now()
  where id = p_task_id returning * into v_task;

  perform public.log_task_activity(p_task_id, 'updated', null, null,
    jsonb_build_object('title', v_title, 'priority', v_priority, 'due_at', v_due_at),
    '{}'::jsonb);

  return public.operational_task_row(v_task)
    || jsonb_build_object(
      'permissions', public.get_operational_task_permissions(v_task),
      'created_by_name', (select full_name from public.profiles where id = v_task.created_by)
    );
end;
$$;

-- Patch assignees RPC
create or replace function public.update_operational_task_assignees(
  p_task_id text,
  p_assignee_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_assignee uuid;
  v_ids uuid[];
  v_primary uuid;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into v_ids from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) as value where value is not null;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Debes asignar al menos un colaborador.';
  end if;

  select * into v_task from public.assigned_tasks t
  where t.id = p_task_id and t.task_source = 'operational'
    and t.deleted_at is null and t.archived_at is null for update;

  if not found then raise exception 'Tarea no encontrada.'; end if;

  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para asignar esta tarea.';
  end if;

  if not (
    public.is_operational_task_area_manager() or v_task.created_by = auth.uid()
  ) then
    raise exception 'No tienes permiso para cambiar miembros.';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes cambiar asignaciones en una tarea cerrada.';
  end if;

  foreach v_assignee in array v_ids loop
    if not public.can_assign_profile_to_operational_task(v_assignee) then
      raise exception 'No tienes permiso para asignar a uno de los colaboradores.';
    end if;
  end loop;

  v_primary := v_ids[1];

  update public.task_assignees
  set status = 'transferred', unassigned_at = now(), unassigned_by = auth.uid(), unassign_reason = 'reassigned'
  where task_id = p_task_id and status = 'active' and not (profile_id = any(v_ids));

  foreach v_assignee in array v_ids loop
    if exists (select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.profile_id = v_assignee and ta.status = 'active') then
      update public.task_assignees
      set assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
          assigned_by = auth.uid()
      where task_id = p_task_id and profile_id = v_assignee and status = 'active';
    elsif exists (select 1 from public.task_assignees ta where ta.task_id = p_task_id and ta.profile_id = v_assignee) then
      update public.task_assignees
      set status = 'active',
          assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
          assigned_by = auth.uid(), assigned_at = now(),
          unassigned_at = null, unassigned_by = null, unassign_reason = null
      where task_id = p_task_id and profile_id = v_assignee;
    else
      insert into public.task_assignees (task_id, profile_id, assignment_role, assigned_by)
      values (p_task_id, v_assignee, case when v_assignee = v_primary then 'primary' else 'participant' end, auth.uid());
    end if;
  end loop;

  update public.task_assignees set assignment_role = 'participant'
  where task_id = p_task_id and status = 'active' and profile_id <> v_primary and assignment_role = 'primary';

  perform public.sync_assigned_tasks_profile_ids(p_task_id);
  perform public.log_task_activity(p_task_id, 'assignees_updated', 'assignees', null, to_jsonb(v_ids), '{}'::jsonb);

  select * into v_task from public.assigned_tasks where id = p_task_id;
  return public.operational_task_row(v_task)
    || jsonb_build_object('permissions', public.get_operational_task_permissions(v_task));
end;
$$;

-- Default sort on quick create
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
  v_sort numeric;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;
  if v_title = '' then raise exception 'El título es obligatorio.'; end if;

  if p_assignee_id is not null and p_assignee_id <> auth.uid() then
    if not public.can_assign_profile_to_operational_task(v_assignee) then
      raise exception 'No tienes permiso para asignar esta tarea.';
    end if;
  end if;

  v_task_id := 'opt-' || gen_random_uuid()::text;
  v_sort := extract(epoch from now()) * 1000;

  insert into public.assigned_tasks (
    id, title, status, task_source, area_id, due_at, due_date,
    created_by, assigned_by, priority, sort_position
  )
  values (
    v_task_id, v_title, 'pending', 'operational', p_area_id, p_due_at,
    case when p_due_at is null then null else p_due_at::date end,
    auth.uid(), auth.uid(), 'medium', v_sort
  )
  returning * into v_task;

  insert into public.task_assignees (task_id, profile_id, assignment_role, assigned_by)
  values (v_task_id, v_assignee, 'primary', auth.uid());

  perform public.log_task_activity(v_task_id, 'created', null, null,
    jsonb_build_object('title', v_title, 'status', 'pending'),
    jsonb_build_object('mode', 'quick'));

  return public.operational_task_card_summary(v_task);
end;
$$;

revoke all on function public.can_mutate_operational_task(public.assigned_tasks) from public;
revoke all on function public.get_operational_task_permissions(public.assigned_tasks) from public;
revoke all on function public.operational_task_card_summary(public.assigned_tasks) from public;
revoke all on function public.move_operational_task(text, text, numeric, text, text) from public;

grant execute on function public.can_mutate_operational_task(public.assigned_tasks) to authenticated;
grant execute on function public.get_operational_task_permissions(public.assigned_tasks) to authenticated;
grant execute on function public.operational_task_card_summary(public.assigned_tasks) to authenticated;
grant execute on function public.move_operational_task(text, text, numeric, text, text) to authenticated;

-- My work list uses compact cards
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
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rows jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  select coalesce(jsonb_agg(
    public.operational_task_card_summary(t)
    order by t.sort_position asc, t.updated_at desc
  ), '[]'::jsonb)
  into v_rows
  from (
    select t.*
    from public.assigned_tasks t
    where t.task_source = 'operational'
      and t.deleted_at is null
      and t.archived_at is null
      and public.can_access_operational_task(t, 'view')
      and exists (
        select 1 from public.task_assignees ta
        where ta.task_id = t.id and ta.profile_id = auth.uid() and ta.status = 'active'
      )
      and (p_status is null or t.status = p_status)
    order by t.sort_position asc, t.updated_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- Status RPC uses can_mutate
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

  if not public.can_mutate_operational_task(v_task) then
    raise exception 'No tienes permiso para actualizar esta tarea.';
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

  return public.operational_task_card_summary(v_task);
end;
$$;
