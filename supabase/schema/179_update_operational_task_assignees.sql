-- RPC: sync operational task assignees.
-- Apply after 178_update_operational_task.sql.

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

  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
  end if;

  select coalesce(array_agg(distinct value order by value), '{}'::uuid[])
  into v_ids
  from unnest(coalesce(p_assignee_ids, '{}'::uuid[])) as value
  where value is not null;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception 'Debes asignar al menos un colaborador.';
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

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes cambiar asignaciones en una tarea cerrada.';
  end if;

  if not public.can_access_operational_task(v_task, 'edit')
    and not (
      v_task.created_by = auth.uid()
      or public.is_operational_task_area_manager()
    ) then
    raise exception 'No tienes permiso para asignar esta tarea.';
  end if;

  foreach v_assignee in array v_ids loop
    if not public.can_assign_profile_to_operational_task(v_assignee) then
      raise exception 'No tienes permiso para asignar a uno de los colaboradores.';
    end if;
  end loop;

  v_primary := v_ids[1];

  update public.task_assignees
  set
    status = 'transferred',
    unassigned_at = now(),
    unassigned_by = auth.uid(),
    unassign_reason = 'reassigned'
  where task_id = p_task_id
    and status = 'active'
    and not (profile_id = any(v_ids));

  foreach v_assignee in array v_ids loop
    if exists (
      select 1
      from public.task_assignees ta
      where ta.task_id = p_task_id
        and ta.profile_id = v_assignee
        and ta.status = 'active'
    ) then
      update public.task_assignees
      set
        assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
        assigned_by = auth.uid()
      where task_id = p_task_id
        and profile_id = v_assignee
        and status = 'active';
    elsif exists (
      select 1
      from public.task_assignees ta
      where ta.task_id = p_task_id
        and ta.profile_id = v_assignee
    ) then
      update public.task_assignees
      set
        status = 'active',
        assignment_role = case when v_assignee = v_primary then 'primary' else 'participant' end,
        assigned_by = auth.uid(),
        assigned_at = now(),
        unassigned_at = null,
        unassigned_by = null,
        unassign_reason = null
      where task_id = p_task_id
        and profile_id = v_assignee;
    else
      insert into public.task_assignees (
        task_id, profile_id, assignment_role, assigned_by
      )
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
    p_task_id,
    'assignees_updated',
    'assignees',
    null,
    to_jsonb(v_ids),
    '{}'::jsonb
  );

  select *
  into v_task
  from public.assigned_tasks
  where id = p_task_id;

  return public.operational_task_row(v_task);
end;
$$;

revoke all on function public.update_operational_task_assignees(text, uuid[]) from public;
grant execute on function public.update_operational_task_assignees(text, uuid[]) to authenticated;
