-- RPC: update operational task fields (edit).
-- Apply after 177_operational_tasks_rpc.sql.

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
begin
  if auth.uid() is null or not public.is_current_profile_active() then
    raise exception 'Sesión inválida o perfil inactivo.';
  end if;

  if p_task_id is null or trim(p_task_id) = '' then
    raise exception 'p_task_id es obligatorio.';
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

  if not public.can_access_operational_task(v_task, 'edit')
    and not (
      v_task.created_by = auth.uid()
      or exists (
        select 1
        from public.task_assignees ta
        where ta.task_id = v_task.id
          and ta.profile_id = auth.uid()
          and ta.status = 'active'
      )
      or public.is_operational_task_area_manager()
    ) then
    raise exception 'No tienes permiso para editar esta tarea.';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    raise exception 'No puedes editar una tarea completada o cancelada.';
  end if;

  v_title := coalesce(nullif(trim(p_data ->> 'title'), ''), v_task.title);
  v_description := coalesce(p_data ->> 'description', v_task.description);
  v_priority := coalesce(nullif(trim(p_data ->> 'priority'), ''), v_task.priority);
  v_area_id := case
    when p_data ? 'area_id' then nullif(trim(p_data ->> 'area_id'), '')
    else v_task.area_id
  end;
  v_category := case
    when p_data ? 'category' then nullif(trim(p_data ->> 'category'), '')
    else v_task.category
  end;
  v_due_at := case
    when p_data ? 'due_at' then nullif(p_data ->> 'due_at', '')::timestamptz
    else v_task.due_at
  end;

  if v_priority not in ('low', 'medium', 'high', 'critical') then
    raise exception 'Prioridad inválida.';
  end if;

  update public.assigned_tasks
  set
    title = v_title,
    description = coalesce(v_description, ''),
    priority = v_priority,
    area_id = v_area_id,
    category = v_category,
    due_at = v_due_at,
    due_date = case when v_due_at is null then null else v_due_at::date end,
    updated_at = now()
  where id = p_task_id
  returning * into v_task;

  perform public.log_task_activity(
    p_task_id,
    'updated',
    null,
    null,
    jsonb_build_object(
      'title', v_title,
      'priority', v_priority,
      'area_id', v_area_id,
      'due_at', v_due_at
    )
  );

  return public.operational_task_row(v_task);
end;
$$;

revoke all on function public.update_operational_task(text, jsonb) from public;
grant execute on function public.update_operational_task(text, jsonb) to authenticated;
