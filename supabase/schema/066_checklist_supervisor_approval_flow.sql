-- Supervisor checklist proposals: expanded approvers, notifications, and resubmit policy.
-- Apply after 065_pos_floor_plan_supabase.sql.

create or replace function public.is_checklist_change_approver()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.normalize_profile_role(public.current_profile_role()) in (
    'admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh'
  );
$$;

drop policy if exists "checklist_change_requests_update" on public.checklist_template_change_requests;
create policy "checklist_change_requests_update"
  on public.checklist_template_change_requests for update to authenticated
  using (
    public.is_checklist_change_approver()
    or (submitted_by = auth.uid() and status in ('draft', 'rejected', 'cancelled'))
  )
  with check (
    public.is_checklist_change_approver()
    or (submitted_by = auth.uid() and status in ('draft', 'rejected', 'cancelled'))
  );

create or replace function public.submit_checklist_change_request(p_request_id uuid)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text := public.normalize_profile_role(public.current_profile_role());
  request_row public.checklist_template_change_requests;
  actor_name text;
  notification_title text;
  notification_message text;
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos', 'rrhh') then
    raise exception 'No tienes permiso para enviar cambios de checklist.';
  end if;

  select * into request_row
  from public.checklist_template_change_requests
  where id = p_request_id
  for update;

  if request_row.id is null then
    raise exception 'Solicitud no encontrada.';
  end if;
  if request_row.submitted_by <> auth.uid() and not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para enviar esta solicitud.';
  end if;
  if request_row.status not in ('draft', 'rejected') then
    raise exception 'Solo se pueden enviar borradores o solicitudes rechazadas.';
  end if;
  if request_row.template_id is not null and exists (
    select 1
    from public.checklist_template_change_requests other
    where other.template_id = request_row.template_id
      and other.status = 'pending_review'
      and other.id <> request_row.id
  ) then
    raise exception 'Ya existe una solicitud pendiente para esta checklist.';
  end if;

  update public.checklist_template_change_requests
  set status = 'pending_review',
      submitted_by = coalesce(submitted_by, auth.uid()),
      submitted_at = now(),
      reviewed_by = null,
      reviewed_at = null,
      review_notes = null
  where id = p_request_id
  returning * into request_row;

  select coalesce(full_name, username, 'Colaborador') into actor_name
  from public.profiles
  where id = auth.uid();

  notification_title := case
    when request_row.request_type = 'create' then 'Nueva checklist pendiente de aprobacion'
    else 'Cambio de checklist pendiente de aprobacion'
  end;
  notification_message := coalesce(actor_name, 'Colaborador') || ' envio a verificacion: ' || request_row.title;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  select
    p.id,
    null,
    'checklist_approval',
    notification_title,
    notification_message,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) in ('admin', 'gerente_general', 'gerente', 'recursos_humanos', 'rrhh')
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'checklist_approval'
        and n.entity_type = 'checklist_template_change_request'
        and n.entity_id = request_row.id::text
    );

  if actor_role = 'supervisor' and request_row.submitted_by is not null then
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      request_row.submitted_by,
      null,
      'checklist_approval_pending',
      'Checklist pendiente de aprobacion',
      'Tu checklist "' || request_row.title || '" esta pendiente de aprobacion. Podras asignarla y utilizarla cuando gerencia, RRHH o admin la autoricen.',
      'checklist_template_change_request',
      request_row.id::text,
      '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
      auth.uid()
    );
  end if;

  return request_row;
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

create or replace function public.reject_checklist_change_request(p_request_id uuid, p_review_notes text)
returns public.checklist_template_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.checklist_template_change_requests;
begin
  if not public.is_checklist_change_approver() then
    raise exception 'No tienes permiso para rechazar cambios de checklist.';
  end if;
  if nullif(trim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'La nota de rechazo es obligatoria.';
  end if;

  update public.checklist_template_change_requests
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = trim(p_review_notes)
  where id = p_request_id
    and status = 'pending_review'
  returning * into request_row;

  if request_row.id is null then
    raise exception 'Solicitud pendiente no encontrada.';
  end if;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    request_row.submitted_by,
    null,
    'checklist_approval_result',
    'Checklist rechazada',
    'Tu checklist "' || request_row.title || '" fue rechazada. Revisa las notas y vuelve a enviarla: ' || trim(p_review_notes),
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  );

  return request_row;
end;
$$;

grant execute on function
  public.is_checklist_change_approver(),
  public.submit_checklist_change_request(uuid),
  public.approve_checklist_change_request(uuid, text),
  public.reject_checklist_change_request(uuid, text)
to authenticated;
