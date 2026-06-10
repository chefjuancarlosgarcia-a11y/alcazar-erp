-- Checklists v2: execution completes without approval; overdue notifications.
-- Apply after 056_checklist_management_alerts.sql.

alter table public.checklist_runs
  add column if not exists overdue_notified_at timestamptz;

create index if not exists checklist_runs_overdue_notify_idx
  on public.checklist_runs (status, run_date, due_time)
  where overdue_notified_at is null and status in ('pending', 'in_progress', 'rejected');

alter table public.checklist_templates
  alter column requires_approval set default false;

update public.checklist_templates
set requires_approval = false
where requires_approval = true;

-- Legacy runs waiting for execution approval become completed.
update public.checklist_runs
set
  status = 'completed',
  completed_at = coalesce(completed_at, submitted_at, now()),
  completed_by = coalesce(completed_by, reviewed_by)
where status = 'pending_review';

create or replace function public.submit_checklist_run_for_review(p_run_id uuid)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  missing_count integer;
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

  update public.checklist_runs
  set status = 'completed',
      submitted_at = now(),
      completed_at = now(),
      completed_by = auth.uid(),
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
  current_date_gt date := (current_ts at time zone 'America/Guatemala')::date;
  current_time_gt time := (current_ts at time zone 'America/Guatemala')::time;
begin
  for run_row in
    select r.*
    from public.checklist_runs r
    where r.status in ('pending', 'in_progress', 'rejected')
      and r.overdue_notified_at is null
      and (
        r.run_date < current_date_gt
        or (
          r.run_date = current_date_gt
          and r.due_time is not null
          and r.due_time < current_time_gt
        )
      )
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
          || ' no fue completada a tiempo.',
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

-- Template approval notifications: admin and gerente_general only.
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
begin
  if actor_role not in ('admin', 'gerente_general', 'gerente', 'supervisor') then
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

  select coalesce(full_name, username, 'Supervisor') into actor_name
  from public.profiles
  where id = auth.uid();

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  select
    p.id,
    null,
    'checklist_approval',
    'Nueva checklist pendiente de aprobacion',
    coalesce(actor_name, 'Supervisor') || ' envio a verificacion: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  from public.profiles p
  where p.status = 'active'
    and public.normalize_profile_role(p.role) in ('admin', 'gerente_general')
    and not exists (
      select 1
      from public.notifications n
      where n.user_id = p.id
        and n.type = 'checklist_approval'
        and n.entity_type = 'checklist_template_change_request'
        and n.entity_id = request_row.id::text
    );

  return request_row;
end;
$$;

revoke all on function
  public.submit_checklist_run_for_review(uuid),
  public.notify_overdue_checklist_runs(timestamptz),
  public.submit_checklist_change_request(uuid)
from public;

grant execute on function
  public.submit_checklist_run_for_review(uuid),
  public.notify_overdue_checklist_runs(timestamptz),
  public.submit_checklist_change_request(uuid)
to authenticated;
