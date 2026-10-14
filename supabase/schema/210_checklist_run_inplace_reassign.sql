-- Reassign an active checklist run in place.
-- Apply after 123_supervisor_checklist_scope.sql.
-- Does not cancel the run and does not insert a second run for the same template and date.

create or replace function public.reassign_checklist_run_inplace(
  p_run_id uuid,
  p_assigned_profile_id uuid default null,
  p_assigned_role text default null,
  p_area text default null,
  p_due_time text default null,
  p_reason text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  actor_role text;
  reason_value text := nullif(trim(coalesce(p_reason, '')), '');
  effective_role text := nullif(trim(coalesce(p_assigned_role, '')), '');
  effective_area text := nullif(trim(coalesce(p_area, '')), '');
  effective_due time;
  original_id uuid;
  previous_profile_id uuid;
  template_title text;
begin
  select public.normalize_profile_role(role) into actor_role
  from public.profiles
  where id = auth.uid()
    and status = 'active';

  if actor_role is null
    or actor_role not in ('admin', 'gerente_general', 'gerente', 'recursos_humanos') then
    raise exception 'No tienes permiso para reasignar checklists.';
  end if;

  if reason_value is null then
    raise exception 'Indica el motivo del cambio de responsable.';
  end if;

  if p_assigned_profile_id is null and effective_role is null then
    raise exception 'Selecciona un colaborador o un rol.';
  end if;

  begin
    effective_due := nullif(trim(coalesce(p_due_time, '')), '')::time;
  exception
    when others then
      raise exception 'Hora limite invalida.';
  end;

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

  if p_assigned_profile_id is not null
    and not exists (
      select 1
      from public.profiles
      where id = p_assigned_profile_id
        and status = 'active'
    ) then
    raise exception 'Colaborador no encontrado o inactivo.';
  end if;

  previous_profile_id := run_row.assigned_profile_id;
  original_id := coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id);

  update public.checklist_runs
  set
    assigned_profile_id = p_assigned_profile_id,
    assigned_role = effective_role,
    area = effective_area,
    due_time = effective_due,
    original_assigned_profile_id = original_id,
    replacement_reason = 'otro',
    replacement_notes = reason_value,
    replaced_at = now(),
    replaced_by = auth.uid(),
    updated_at = now()
  where id = p_run_id
  returning * into run_row;

  insert into public.checklist_session_audit (profile_id, checklist_run_id, event_type, details)
  values (
    auth.uid(),
    run_row.id,
    'assignment_reassigned_inplace',
    jsonb_build_object(
      'reason', reason_value,
      'previous_assigned_profile_id', previous_profile_id,
      'assigned_profile_id', run_row.assigned_profile_id,
      'assigned_role', run_row.assigned_role,
      'area', run_row.area,
      'due_time', run_row.due_time,
      'status', run_row.status
    )
  );

  if run_row.assigned_profile_id is not null
    and run_row.assigned_profile_id is distinct from previous_profile_id then
    select coalesce(title, 'Checklist') into template_title
    from public.checklist_templates
    where id = run_row.template_id;

    begin
      insert into public.notifications (
        user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
      )
      values (
        run_row.assigned_profile_id,
        null,
        'checklist_replacement',
        'Checklist reasignada',
        coalesce(template_title, 'Checklist')
          || ' fue reasignada a ti. Motivo: '
          || reason_value
          || '.',
        'checklist_run',
        run_row.id::text,
        '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
        auth.uid()
      );
    exception
      when others then
        raise warning 'checklist reassignment notification failed for run %: %', run_row.id, sqlerrm;
    end;
  end if;

  return run_row;
end;
$$;

revoke all on function public.reassign_checklist_run_inplace(uuid, uuid, text, text, text, text) from public;
grant execute on function public.reassign_checklist_run_inplace(uuid, uuid, text, text, text, text) to authenticated;
