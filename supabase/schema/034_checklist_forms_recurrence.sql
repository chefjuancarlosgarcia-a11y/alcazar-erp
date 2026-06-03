-- Checklist forms, recurring assignments, and execution approvals.
-- Apply after 033_user_roles_catalog.sql.

alter table public.checklist_template_items
  drop constraint if exists checklist_template_items_response_type_check;

alter table public.checklist_template_items
  add constraint checklist_template_items_response_type_check
  check (response_type in (
    'yes_no', 'checkbox', 'short_text', 'long_text', 'text', 'number',
    'date', 'time', 'photo', 'rating', 'multi_select', 'select',
    'signature', 'acknowledgement', 'temperature'
  ));

alter table public.checklist_run_items
  drop constraint if exists checklist_run_items_response_type_check;

alter table public.checklist_run_items
  add constraint checklist_run_items_response_type_check
  check (response_type in (
    'yes_no', 'checkbox', 'short_text', 'long_text', 'text', 'number',
    'date', 'time', 'photo', 'rating', 'multi_select', 'select',
    'signature', 'acknowledgement', 'temperature'
  ));

alter table public.checklist_runs
  drop constraint if exists checklist_runs_status_check;

alter table public.checklist_runs
  add constraint checklist_runs_status_check
  check (status in ('pending', 'in_progress', 'pending_review', 'completed', 'overdue', 'cancelled', 'rejected'));

alter table public.checklist_templates
  add column if not exists supervisor_profile_id uuid references public.profiles(id),
  add column if not exists backup_profile_id uuid references public.profiles(id),
  add column if not exists reminder_time time,
  add column if not exists due_time time,
  add column if not exists recurrence_days integer[] not null default '{}'::integer[],
  add column if not exists recurrence_month_day integer check (recurrence_month_day between 1 and 31),
  add column if not exists recurrence_rule text,
  add column if not exists skip_non_work_days boolean not null default true,
  add column if not exists auto_generate boolean not null default false,
  add column if not exists requires_approval boolean not null default true;

alter table public.checklist_template_items
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists require_comment_on_no boolean not null default false,
  add column if not exists require_photo_on_no boolean not null default false,
  add column if not exists generate_incident_on_no boolean not null default false,
  add column if not exists rule_config jsonb not null default '{}'::jsonb;

alter table public.checklist_runs
  add column if not exists supervisor_profile_id uuid references public.profiles(id),
  add column if not exists reminder_time time,
  add column if not exists due_time time,
  add column if not exists assignment_source text not null default 'manual'
    check (assignment_source in ('manual', 'recurrence')),
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_notes text;

alter table public.checklist_run_items
  add column if not exists options jsonb not null default '[]'::jsonb,
  add column if not exists response_json jsonb not null default '{}'::jsonb,
  add column if not exists response_date date,
  add column if not exists response_time time,
  add column if not exists require_comment_on_no boolean not null default false,
  add column if not exists require_photo_on_no boolean not null default false,
  add column if not exists generate_incident_on_no boolean not null default false,
  add column if not exists rule_config jsonb not null default '{}'::jsonb;

alter table public.checklist_template_change_requests
  add column if not exists supervisor_profile_id uuid references public.profiles(id),
  add column if not exists backup_profile_id uuid references public.profiles(id),
  add column if not exists reminder_time time,
  add column if not exists due_time time,
  add column if not exists recurrence_days integer[] not null default '{}'::integer[],
  add column if not exists recurrence_month_day integer check (recurrence_month_day between 1 and 31),
  add column if not exists recurrence_rule text,
  add column if not exists skip_non_work_days boolean not null default true,
  add column if not exists auto_generate boolean not null default false,
  add column if not exists requires_approval boolean not null default true;

-- Existing manual assignments may already have duplicated runs for the same
-- template/date/person. Keep this non-unique so the migration is safe on
-- production history; create_checklist_run_from_template prevents new
-- recurrence duplicates by returning an existing active run.
drop index if exists public.checklist_runs_template_date_profile_unique;

create index if not exists checklist_runs_template_date_profile_idx
  on public.checklist_runs (template_id, run_date, assigned_profile_id)
  where template_id is not null and assigned_profile_id is not null and status <> 'cancelled';

create index if not exists checklist_templates_auto_generate_idx
  on public.checklist_templates (status, auto_generate, frequency);

create index if not exists checklist_runs_review_idx
  on public.checklist_runs (status, supervisor_profile_id, submitted_at desc)
  where status = 'pending_review';

create table if not exists public.checklist_template_suggestions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid references public.checklist_templates(id) on delete cascade,
  suggested_by uuid references public.profiles(id) default auth.uid(),
  area text,
  change_type text not null check (change_type in (
    'add_item', 'remove_item', 'edit_item_text', 'change_order',
    'change_frequency', 'change_responsible', 'change_evidence', 'other'
  )),
  description text not null,
  justification text not null,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  evidence_url text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_template_suggestions_status_idx
  on public.checklist_template_suggestions (status, created_at desc);

alter table public.checklist_template_suggestions enable row level security;

grant select, insert, update on public.checklist_template_suggestions to authenticated;
grant all on public.checklist_template_suggestions to service_role;

drop trigger if exists set_checklist_template_suggestions_updated_at on public.checklist_template_suggestions;
create trigger set_checklist_template_suggestions_updated_at
  before update on public.checklist_template_suggestions
  for each row execute procedure public.set_checklist_updated_at();

drop policy if exists "checklist_template_suggestions_read" on public.checklist_template_suggestions;
create policy "checklist_template_suggestions_read"
  on public.checklist_template_suggestions for select to authenticated
  using (
    public.is_checklist_change_approver()
    or suggested_by = auth.uid()
    or public.is_checklist_template_manager()
  );

drop policy if exists "checklist_template_suggestions_insert" on public.checklist_template_suggestions;
create policy "checklist_template_suggestions_insert"
  on public.checklist_template_suggestions for insert to authenticated
  with check (
    suggested_by = auth.uid()
    and public.normalize_profile_role(public.current_profile_role()) = 'supervisor'
  );

drop policy if exists "checklist_template_suggestions_update" on public.checklist_template_suggestions;
create policy "checklist_template_suggestions_update"
  on public.checklist_template_suggestions for update to authenticated
  using (public.is_checklist_change_approver())
  with check (public.is_checklist_change_approver());

create or replace function public.is_profile_scheduled_to_work(p_profile_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select bool_or(s.is_work_day and s.shift_type not in ('rest', 'asueto'))
    from public.employee_schedules s
    where s.employee_id = p_profile_id
      and s.shift_date = p_date
  ), true);
$$;

create or replace function public.checklist_template_due_on_date(p_template public.checklist_templates, p_date date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when p_template.status <> 'active' or not p_template.auto_generate then false
    when p_template.frequency = 'diaria' then true
    when p_template.frequency = 'semanal' then
      coalesce(array_length(p_template.recurrence_days, 1), 0) = 0
      or extract(isodow from p_date)::integer = any(p_template.recurrence_days)
    when p_template.frequency = 'mensual' then
      coalesce(p_template.recurrence_month_day, 1) = extract(day from p_date)::integer
    when p_template.frequency in ('apertura', 'cierre', 'por_turno') then true
    else false
  end;
$$;

create or replace function public.create_checklist_run_from_template(
  p_template_id uuid,
  p_run_date date default current_date,
  p_assignment_source text default 'manual',
  p_assigned_profile_id uuid default null,
  p_notes text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  effective_profile_id uuid;
  existing_run public.checklist_runs;
  created_run public.checklist_runs;
begin
  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para crear checklists.';
  end if;

  select * into template_row
  from public.checklist_templates
  where id = p_template_id
    and status = 'active';

  if template_row.id is null then
    raise exception 'Plantilla no encontrada o inactiva.';
  end if;

  effective_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);

  if template_row.skip_non_work_days and effective_profile_id is not null
    and not public.is_profile_scheduled_to_work(effective_profile_id, p_run_date) then
    effective_profile_id := template_row.backup_profile_id;
  end if;

  if template_row.skip_non_work_days and effective_profile_id is not null
    and not public.is_profile_scheduled_to_work(effective_profile_id, p_run_date) then
    raise exception 'El responsable no trabaja ese dia y no hay suplente disponible.';
  end if;

  select * into existing_run
  from public.checklist_runs
  where template_id = p_template_id
    and run_date = p_run_date
    and coalesce(assigned_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(effective_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and status <> 'cancelled'
  limit 1;

  if existing_run.id is not null then
    return existing_run;
  end if;

  insert into public.checklist_runs (
    template_id, run_date, area, assigned_profile_id, assigned_role, status,
    total_points, earned_points, notes, supervisor_profile_id, reminder_time,
    due_time, assignment_source
  )
  values (
    template_row.id, p_run_date, template_row.area, effective_profile_id,
    template_row.assigned_role, 'pending',
    coalesce((select sum(score_points)::integer from public.checklist_template_items where template_id = template_row.id), 0),
    0, nullif(trim(coalesce(p_notes, '')), ''), template_row.supervisor_profile_id,
    template_row.reminder_time, template_row.due_time, coalesce(p_assignment_source, 'manual')
  )
  returning * into created_run;

  insert into public.checklist_run_items (
    run_id, template_item_id, item_order, title, response_type, is_required,
    requires_photo, requires_comment, score_points, options,
    require_comment_on_no, require_photo_on_no, generate_incident_on_no, rule_config
  )
  select
    created_run.id, item.id, item.item_order, item.title, item.response_type,
    item.is_required, item.requires_photo, item.requires_comment, item.score_points,
    item.options, item.require_comment_on_no, item.require_photo_on_no,
    item.generate_incident_on_no, item.rule_config
  from public.checklist_template_items item
  where item.template_id = template_row.id
  order by item.item_order;

  perform public.create_checklist_run_notifications(created_run.id);
  return created_run;
end;
$$;

create or replace function public.generate_due_checklist_runs(p_target_date date default current_date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_row public.checklist_templates;
  generated_count integer := 0;
begin
  if not public.is_checklist_template_manager() then
    raise exception 'No tienes permiso para generar checklists recurrentes.';
  end if;

  for template_row in
    select * from public.checklist_templates
    where status = 'active'
      and auto_generate = true
      and public.checklist_template_due_on_date(checklist_templates, p_target_date)
  loop
    begin
      perform public.create_checklist_run_from_template(template_row.id, p_target_date, 'recurrence', null, 'Generada automaticamente');
      generated_count := generated_count + 1;
    exception when others then
      -- Skip templates that cannot be assigned because the owner and backup are off.
      null;
    end;
  end loop;

  return generated_count;
end;
$$;

create or replace function public.set_checklist_run_item_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.checked
    or nullif(trim(coalesce(new.response_text, '')), '') is not null
    or new.response_number is not null
    or new.response_date is not null
    or new.response_time is not null
    or coalesce(new.response_json, '{}'::jsonb) <> '{}'::jsonb
    or nullif(trim(coalesce(new.photo_url, '')), '') is not null
  then
    new.completed_at := coalesce(new.completed_at, now());
    new.completed_by := coalesce(new.completed_by, auth.uid());
    new.earned_points := new.score_points;
  else
    new.completed_at := null;
    new.completed_by := null;
    new.earned_points := 0;
  end if;
  return new;
end;
$$;

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
  if not public.can_access_checklist_run(run_row) then raise exception 'No tienes permiso para enviar esta checklist.'; end if;

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
  set status = case when coalesce((select requires_approval from public.checklist_templates where id = run_row.template_id), true) then 'pending_review' else 'completed' end,
      submitted_at = now(),
      completed_at = case when coalesce((select requires_approval from public.checklist_templates where id = run_row.template_id), true) then null else now() end,
      completed_by = auth.uid(),
      reviewed_by = null,
      reviewed_at = null,
      review_notes = null
  where id = p_run_id
  returning * into run_row;

  return run_row;
end;
$$;

create or replace function public.approve_checklist_run(p_run_id uuid, p_review_notes text default null)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
begin
  select * into run_row from public.checklist_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Checklist no encontrada.'; end if;
  if not public.is_checklist_change_approver() and coalesce(run_row.supervisor_profile_id <> auth.uid(), true) then
    raise exception 'No tienes permiso para aprobar esta checklist.';
  end if;
  if run_row.status <> 'pending_review' then raise exception 'Solo se pueden aprobar checklists en revision.'; end if;

  update public.checklist_runs
  set status = 'completed',
      completed_at = now(),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = nullif(trim(coalesce(p_review_notes, '')), '')
  where id = p_run_id
  returning * into run_row;

  return run_row;
end;
$$;

create or replace function public.reject_checklist_run(p_run_id uuid, p_review_notes text)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
begin
  if nullif(trim(coalesce(p_review_notes, '')), '') is null then
    raise exception 'La nota de rechazo es obligatoria.';
  end if;
  select * into run_row from public.checklist_runs where id = p_run_id for update;
  if run_row.id is null then raise exception 'Checklist no encontrada.'; end if;
  if not public.is_checklist_change_approver() and coalesce(run_row.supervisor_profile_id <> auth.uid(), true) then
    raise exception 'No tienes permiso para rechazar esta checklist.';
  end if;
  if run_row.status <> 'pending_review' then raise exception 'Solo se pueden rechazar checklists en revision.'; end if;

  update public.checklist_runs
  set status = 'rejected',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_notes = trim(p_review_notes)
  where id = p_run_id
  returning * into run_row;

  return run_row;
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
    delete from public.checklist_template_items where checklist_template_items.template_id = v_template_id;
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
      require_photo_on_no, generate_incident_on_no, rule_config
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
      coalesce(item.value -> 'rule_config', '{}'::jsonb)
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
    'Checklist aprobada y publicada: ' || request_row.title,
    'checklist_template_change_request',
    request_row.id::text,
    '/tasks?tab=checklists&view=approvals&id=' || request_row.id::text,
    auth.uid()
  );

  return request_row;
end;
$$;

revoke all on function
  public.is_profile_scheduled_to_work(uuid, date),
  public.checklist_template_due_on_date(public.checklist_templates, date),
  public.create_checklist_run_from_template(uuid, date, text, uuid, text),
  public.generate_due_checklist_runs(date),
  public.submit_checklist_run_for_review(uuid),
  public.approve_checklist_run(uuid, text),
  public.reject_checklist_run(uuid, text)
from public;

grant execute on function
  public.is_profile_scheduled_to_work(uuid, date),
  public.create_checklist_run_from_template(uuid, date, text, uuid, text),
  public.generate_due_checklist_runs(date),
  public.submit_checklist_run_for_review(uuid),
  public.approve_checklist_run(uuid, text),
  public.reject_checklist_run(uuid, text)
to authenticated;
