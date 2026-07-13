-- 181c: RPCs + grants (run third, after 181b).

-- ---------------------------------------------------------------------------
-- Shared row shape (objective, watchers, avatars)
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
          'avatar_url', p.avatar_url,
          'area_name', (select a.name from public.areas a where a.id = p.area_id),
          'assignment_role', ta.assignment_role,
          'status', ta.status
        )
        order by case ta.assignment_role when 'primary' then 0 else 1 end, p.full_name
      )
      from public.task_assignees ta
      join public.profiles p on p.id = ta.profile_id
      where ta.task_id = p_task.id
        and ta.status = 'active'
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
    'area_name', (
      select a.name
      from public.areas a
      where a.id = p_task.area_id
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Card summary with objective/result snippets
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
-- Board search includes objective/result
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
    raise exception 'SesiÃ³n invÃ¡lida o perfil inactivo.';
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
      or lower(coalesce(t.next_action, '')) like '%' || v_search || '%'
    );

  return jsonb_build_object('tasks', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Update task fields (objective, expected_result)
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
  v_next_action text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'SesiÃ³n invÃ¡lida o perfil inactivo.';
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
  v_next_action := case when p_data ? 'next_action' then nullif(trim(p_data ->> 'next_action'), '') else v_task.next_action end;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridad invÃ¡lida.';
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
      next_action = v_next_action,
      updated_at = now()
  where id = p_task_id returning * into v_task;

  perform public.log_task_activity(p_task_id, 'updated', null, null,
    jsonb_build_object(
      'title', v_title,
      'priority', v_priority,
      'due_at', v_due_at,
      'objective', v_objective,
      'expected_result', v_expected_result
    ),
    '{}'::jsonb);

  return public.operational_task_row(v_task)
    || jsonb_build_object(
      'permissions', public.get_operational_task_permissions(v_task),
      'created_by_name', (select full_name from public.profiles where id = v_task.created_by)
    );
end;
$$;

-- ---------------------------------------------------------------------------
-- Members + watchers RPC
-- ---------------------------------------------------------------------------
create or replace function public.update_operational_task_members(
  p_task_id text,
  p_primary_profile_id uuid,
  p_participant_ids uuid[] default '{}',
  p_watcher_ids uuid[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.assigned_tasks;
  v_assignee uuid;
  v_primary uuid;
  v_participants uuid[];
  v_all_assignees uuid[];
  v_old_assignees uuid[];
  v_old_watchers uuid[];
  v_final_watchers uuid[];
  v_actor_name text;
  v_title text;
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'SesiÃ³n invÃ¡lida o perfil inactivo.';
  end if;

  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
  end if;

  if p_primary_profile_id is null then
    raise exception 'Debes asignar un responsable principal.';
  end if;

  select * into v_task
  from public.assigned_tasks t
  where t.id = p_task_id
    and t.task_source = 'operational'
    and t.deleted_at is null
    and t.archived_at is null
  for update;

  if not found then
    raise exception 'Tarea no encontrada.';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes cambiar miembros en una tarea cerrada.';
  end if;

  if not public.can_access_operational_task(v_task, 'view') then
    raise exception 'No tienes permiso para ver esta tarea.';
  end if;

  select coalesce(array_agg(ta.profile_id order by ta.profile_id), '{}'::uuid[])
  into v_old_assignees
  from public.task_assignees ta
  where ta.task_id = p_task_id and ta.status = 'active';

  select coalesce(array_agg(tw.profile_id order by tw.profile_id), '{}'::uuid[])
  into v_old_watchers
  from public.task_watchers tw
  where tw.task_id = p_task_id;

  if public.can_manage_operational_task_members(v_task) then
    select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
    into v_participants
    from unnest(coalesce(p_participant_ids, '{}'::uuid[])) as value
    where value is not null
      and value <> p_primary_profile_id;

    v_all_assignees := array[p_primary_profile_id] || v_participants;

    foreach v_assignee in array v_all_assignees loop
      if not public.can_assign_profile_to_operational_task(v_assignee) then
        raise exception 'No tienes permiso para asignar a uno de los colaboradores.';
      end if;
    end loop;

    v_primary := p_primary_profile_id;

    update public.task_assignees
    set status = 'transferred',
        unassigned_at = now(),
        unassigned_by = auth.uid(),
        unassign_reason = 'reassigned'
    where task_id = p_task_id
      and status = 'active'
      and not (profile_id = any(v_all_assignees));

    foreach v_assignee in array v_all_assignees loop
      if exists (
        select 1 from public.task_assignees ta
        where ta.task_id = p_task_id and ta.profile_id = v_assignee and ta.status = 'active'
      ) then
        update public.task_assignees
        set assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
            assigned_by = auth.uid()
        where task_id = p_task_id and profile_id = v_assignee and status = 'active';
      elsif exists (
        select 1 from public.task_assignees ta
        where ta.task_id = p_task_id and ta.profile_id = v_assignee
      ) then
        update public.task_assignees
        set status = 'active',
            assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
            assigned_by = auth.uid(),
            assigned_at = now(),
            unassigned_at = null,
            unassigned_by = null,
            unassign_reason = null
        where task_id = p_task_id and profile_id = v_assignee;
      else
        insert into public.task_assignees (task_id, profile_id, assignment_role, assigned_by)
        values (
          p_task_id,
          v_assignee,
          case when v_assignee = v_primary then 'primary' else 'participant' end,
          auth.uid()
        );
      end if;
    end loop;

    update public.task_assignees
    set assignment_role = 'participant'
    where task_id = p_task_id
      and status = 'active'
      and profile_id <> v_primary
      and assignment_role = 'primary';

    perform public.sync_assigned_tasks_profile_ids(p_task_id);
    perform public.log_task_activity(
      p_task_id, 'assignees_updated', 'assignees', to_jsonb(v_old_assignees), to_jsonb(v_all_assignees), '{}'::jsonb
    );
  else
    v_all_assignees := v_old_assignees;
  end if;

  perform public.ensure_operational_task_assignee_watchers(p_task_id);

  if p_watcher_ids is null then
    select coalesce(array_agg(tw.profile_id order by tw.profile_id), '{}'::uuid[])
    into v_final_watchers
    from public.task_watchers tw
    where tw.task_id = p_task_id;
  else
    select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
    into v_final_watchers
    from (
      select unnest(v_all_assignees) as value
      union
      select unnest(p_watcher_ids) as value
    ) s
    where value is not null;

    if public.can_manage_operational_task_watchers(v_task) then
      insert into public.task_watchers (task_id, profile_id, created_by)
      select p_task_id, w, auth.uid()
      from unnest(v_final_watchers) as w
      on conflict (task_id, profile_id) do nothing;

      delete from public.task_watchers tw
      where tw.task_id = p_task_id
        and not (tw.profile_id = any(v_final_watchers))
        and not exists (
          select 1 from public.task_assignees ta
          where ta.task_id = p_task_id
            and ta.profile_id = tw.profile_id
            and ta.status = 'active'
        );
    else
      if auth.uid() = any(p_watcher_ids) and not public.is_operational_task_watcher(p_task_id, auth.uid()) then
        insert into public.task_watchers (task_id, profile_id, created_by)
        values (p_task_id, auth.uid(), auth.uid())
        on conflict (task_id, profile_id) do nothing;
        perform public.log_task_activity(p_task_id, 'watcher_added', 'watchers', null, to_jsonb(auth.uid()), '{}'::jsonb);
      elsif not (auth.uid() = any(p_watcher_ids)) and public.is_operational_task_watcher(p_task_id, auth.uid()) then
        delete from public.task_watchers tw
        where tw.task_id = p_task_id
          and tw.profile_id = auth.uid()
          and not exists (
            select 1 from public.task_assignees ta
            where ta.task_id = p_task_id
              and ta.profile_id = tw.profile_id
              and ta.status = 'active'
          );
        perform public.log_task_activity(p_task_id, 'watcher_removed', 'watchers', to_jsonb(auth.uid()), null, '{}'::jsonb);
      elsif p_watcher_ids <> v_old_watchers then
        raise exception 'No tienes permiso para cambiar seguidores.';
      end if;

      select coalesce(array_agg(tw.profile_id order by tw.profile_id), '{}'::uuid[])
      into v_final_watchers
      from public.task_watchers tw
      where tw.task_id = p_task_id;
    end if;
  end if;

  if public.can_manage_operational_task_watchers(v_task)
    and p_watcher_ids is not null
    and v_final_watchers <> v_old_watchers then
    perform public.log_task_activity(
      p_task_id, 'watchers_updated', 'watchers', to_jsonb(v_old_watchers), to_jsonb(v_final_watchers), '{}'::jsonb
    );
  end if;

  select coalesce(p.full_name, 'Sistema'), v_task.title
  into v_actor_name, v_title
  from public.profiles p
  where p.id = auth.uid();

  foreach v_assignee in array v_all_assignees loop
    if not (v_assignee = any(v_old_assignees)) then
      perform public.notify_operational_task_event(
        v_assignee,
        'task_assigned',
        'Nueva tarea asignada: ' || v_title,
        v_actor_name || ' te asignÃ³ la tarea Â«' || v_title || 'Â».',
        p_task_id
      );
    end if;
  end loop;

  foreach v_assignee in array v_old_assignees loop
    if not (v_assignee = any(v_all_assignees)) then
      perform public.notify_operational_task_event(
        v_assignee,
        'task_member_removed',
        'Cambio en tarea: ' || v_title,
        v_actor_name || ' te retirÃ³ de la tarea Â«' || v_title || 'Â».',
        p_task_id
      );
    end if;
  end loop;

  foreach v_assignee in array v_final_watchers loop
    if not (v_assignee = any(v_old_watchers))
      and not (v_assignee = any(v_all_assignees)) then
      perform public.notify_operational_task_event(
        v_assignee,
        'task_watcher_added',
        'Seguimiento de tarea: ' || v_title,
        v_actor_name || ' te aÃ±adiÃ³ como seguidor de Â«' || v_title || 'Â».',
        p_task_id
      );
    end if;
  end loop;

  select * into v_task from public.assigned_tasks where id = p_task_id;

  return public.operational_task_row(v_task)
    || jsonb_build_object('permissions', public.get_operational_task_permissions(v_task));
end;
$$;

revoke all on function public.update_operational_task_members(text, uuid, uuid[], uuid[]) from public;
grant execute on function public.update_operational_task_members(text, uuid, uuid[], uuid[]) to authenticated;

-- Keep legacy assignees RPC delegating to members (primary = first id)
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
  v_ids uuid[];
  v_primary uuid;
begin
  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into v_ids
  from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) as value
  where value is not null;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Debes asignar al menos un colaborador.';
  end if;

  v_primary := v_ids[1];

  return public.update_operational_task_members(
    p_task_id,
    v_primary,
    v_ids[2:array_length(v_ids, 1)],
    null
  );
end;
$$;

-- Auto-watch on quick create
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
    raise exception 'SesiÃ³n invÃ¡lida o perfil inactivo.';
  end if;
  if v_title = '' then raise exception 'El tÃ­tulo es obligatorio.'; end if;

  if p_assignee_id is not null and p_assignee_id <> auth.uid() then
    if not public.can_assign_profile_to_operational_task(v_assignee) then
      raise exception 'No tienes permiso para asignar esta tarea.';
    end if;
  end if;

  v_task_id := 'opt-' || gen_random_uuid()::text;
  v_sort := extract(epoch from now()) * 1000;

  insert into public.assigned_tasks (
    id, title, status, task_source, priority, area_id, due_at, due_date,
    created_by, assigned_by, sort_position
  )
  values (
    v_task_id, v_title, 'pending', 'operational', 'medium', p_area_id, p_due_at,
    case when p_due_at is null then null else p_due_at::date end,
    auth.uid(), auth.uid(), v_sort
  )
  returning * into v_task;

  insert into public.task_assignees (task_id, profile_id, assignment_role, assigned_by)
  values (v_task_id, v_assignee, 'primary', auth.uid());

  perform public.sync_assigned_tasks_profile_ids(v_task_id);
  perform public.ensure_operational_task_assignee_watchers(v_task_id);
  perform public.log_task_activity(v_task_id, 'created', null, null, jsonb_build_object('title', v_title), '{}'::jsonb);

  if v_assignee <> auth.uid() then
    perform public.notify_operational_task_event(
      v_assignee,
      'task_assigned',
      'Nueva tarea asignada: ' || v_title,
      coalesce((select full_name from public.profiles where id = auth.uid()), 'Sistema')
        || ' te asignÃ³ la tarea Â«' || v_title || 'Â».',
      v_task_id
    );
  end if;

  return public.operational_task_card_summary(v_task);
end;
$$;

-- Grants
revoke all on function public.update_operational_task(text, jsonb) from public;
grant execute on function public.update_operational_task(text, jsonb) to authenticated;

revoke all on function public.update_operational_task_assignees(text, uuid[]) from public;
grant execute on function public.update_operational_task_assignees(text, uuid[]) to authenticated;

revoke all on function public.get_operational_tasks_board(text, uuid, text, boolean, integer, boolean) from public;
grant execute on function public.get_operational_tasks_board(text, uuid, text, boolean, integer, boolean) to authenticated;

revoke all on function public.create_operational_task_quick(text, uuid, text, timestamptz) from public;
grant execute on function public.create_operational_task_quick(text, uuid, text, timestamptz) to authenticated;
