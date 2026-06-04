-- Automatic checklist incidents.
-- Apply after 036_recipe_item_unit_conversions.sql.

alter table public.checklist_template_items
  add column if not exists expected_response text default null,
  add column if not exists triggers_incident boolean not null default false,
  add column if not exists incident_severity text not null default 'medium',
  add column if not exists notify_roles text[] not null default array['admin','gerente_general','gerente'],
  add column if not exists create_task_on_fail boolean not null default false;

alter table public.checklist_template_items
  drop constraint if exists checklist_template_items_incident_severity_check;

alter table public.checklist_template_items
  add constraint checklist_template_items_incident_severity_check
  check (incident_severity in ('low', 'medium', 'high', 'critical'));

alter table public.checklist_run_items
  add column if not exists expected_response text default null,
  add column if not exists triggers_incident boolean not null default false,
  add column if not exists incident_severity text not null default 'medium',
  add column if not exists notify_roles text[] not null default array['admin','gerente_general','gerente'],
  add column if not exists create_task_on_fail boolean not null default false;

alter table public.checklist_run_items
  drop constraint if exists checklist_run_items_incident_severity_check;

alter table public.checklist_run_items
  add constraint checklist_run_items_incident_severity_check
  check (incident_severity in ('low', 'medium', 'high', 'critical'));

update public.checklist_template_items
set
  triggers_incident = true,
  expected_response = coalesce(expected_response, 'si')
where coalesce(generate_incident_on_no, false) = true;

update public.checklist_run_items
set
  triggers_incident = true,
  expected_response = coalesce(expected_response, 'si')
where coalesce(generate_incident_on_no, false) = true;

create table if not exists public.checklist_incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.checklist_runs(id) on delete cascade,
  run_item_id uuid references public.checklist_run_items(id) on delete cascade,
  template_id uuid references public.checklist_templates(id),
  template_item_id uuid references public.checklist_template_items(id),
  title text not null,
  description text,
  area text,
  severity text not null default 'medium'
    check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open'
    check (status in ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed')),
  reported_by uuid references public.profiles(id),
  assigned_to uuid references public.profiles(id),
  resolved_by uuid references public.profiles(id),
  resolved_at timestamptz,
  resolution_notes text,
  created_task_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists checklist_incidents_status_idx
  on public.checklist_incidents (status, severity, created_at desc);

create index if not exists checklist_incidents_run_idx
  on public.checklist_incidents (run_id, run_item_id);

create unique index if not exists checklist_incidents_open_run_item_unique
  on public.checklist_incidents (run_item_id)
  where status in ('open', 'acknowledged', 'in_progress');

alter table public.checklist_incidents enable row level security;

grant select, insert, update on public.checklist_incidents to authenticated;
grant all on public.checklist_incidents to service_role;

drop trigger if exists set_checklist_incidents_updated_at on public.checklist_incidents;
create trigger set_checklist_incidents_updated_at
  before update on public.checklist_incidents
  for each row execute procedure public.set_checklist_updated_at();

create or replace function public.can_access_checklist_incident(p_incident public.checklist_incidents)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        public.normalize_profile_role(profile.role) in ('admin', 'gerente_general', 'gerente')
        or p_incident.reported_by = auth.uid()
        or (
          public.normalize_profile_role(profile.role) = 'supervisor'
          and (
            p_incident.reported_by = auth.uid()
            or nullif(trim(coalesce(profile.area_name, '')), '') = nullif(trim(coalesce(p_incident.area, '')), '')
            or nullif(trim(coalesce(profile.area_id, '')), '') = nullif(trim(coalesce(p_incident.area, '')), '')
          )
        )
      )
  );
$$;

create or replace function public.can_manage_checklist_incident_status(p_next_status text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.status = 'active'
      and (
        public.normalize_profile_role(profile.role) in ('admin', 'gerente_general', 'gerente')
        or (
          public.normalize_profile_role(profile.role) = 'supervisor'
          and coalesce(p_next_status, '') <> 'dismissed'
        )
      )
  );
$$;

drop policy if exists "checklist_incidents_authorized_read" on public.checklist_incidents;
create policy "checklist_incidents_authorized_read"
  on public.checklist_incidents for select to authenticated
  using (public.can_access_checklist_incident(checklist_incidents));

drop policy if exists "checklist_incidents_system_insert" on public.checklist_incidents;
create policy "checklist_incidents_system_insert"
  on public.checklist_incidents for insert to authenticated
  with check (reported_by = auth.uid() or public.is_checklist_template_manager());

drop policy if exists "checklist_incidents_status_update" on public.checklist_incidents;
create policy "checklist_incidents_status_update"
  on public.checklist_incidents for update to authenticated
  using (public.can_access_checklist_incident(checklist_incidents) and public.can_manage_checklist_incident_status(status))
  with check (public.can_access_checklist_incident(checklist_incidents) and public.can_manage_checklist_incident_status(status));

create or replace function public.checklist_item_failed(
  p_response_type text,
  p_expected_response text,
  p_is_required boolean,
  p_checked boolean,
  p_response_text text,
  p_response_number numeric
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  expected text := lower(trim(coalesce(p_expected_response, '')));
  given text := lower(trim(coalesce(p_response_text, '')));
begin
  if p_response_type in ('checkbox', 'acknowledgement') then
    if expected in ('', 'true', 'checked', 'si', 'sí', 'yes', '1') then
      return coalesce(p_checked, false) = false;
    end if;
    if expected in ('false', 'unchecked', 'no', '0') then
      return coalesce(p_checked, false) = true;
    end if;
  end if;

  if p_response_type = 'yes_no' then
    if expected = '' then expected := 'si'; end if;
    return given <> expected;
  end if;

  if p_response_type = 'select' then
    return expected <> '' and given <> expected;
  end if;

  if p_response_type in ('number', 'temperature') then
    return coalesce(p_is_required, false) and p_response_number is null;
  end if;

  if expected <> '' then
    return given <> expected;
  end if;

  return false;
end;
$$;

create or replace function public.evaluate_checklist_run_item_incident(run_item_id uuid)
returns public.checklist_incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_item public.checklist_run_items;
  template_item public.checklist_template_items;
  run_record public.checklist_runs;
  template_record public.checklist_templates;
  incident_record public.checklist_incidents;
  should_trigger boolean;
  should_fail boolean;
  expected text;
  severity_value text;
  roles text[];
  incident_title text;
  incident_description text;
  role_value text;
begin
  select * into run_item
  from public.checklist_run_items
  where id = run_item_id;

  if run_item.id is null then
    return null;
  end if;

  select * into template_item
  from public.checklist_template_items
  where id = run_item.template_item_id;

  select * into run_record
  from public.checklist_runs
  where id = run_item.run_id;

  select * into template_record
  from public.checklist_templates
  where id = coalesce(run_record.template_id, template_item.template_id);

  should_trigger := coalesce(run_item.triggers_incident, template_item.triggers_incident, false)
    or coalesce(run_item.generate_incident_on_no, template_item.generate_incident_on_no, false);

  if not should_trigger then
    return null;
  end if;

  expected := coalesce(
    nullif(trim(run_item.expected_response), ''),
    nullif(trim(template_item.expected_response), ''),
    case when coalesce(run_item.generate_incident_on_no, template_item.generate_incident_on_no, false) then 'si' else null end
  );

  should_fail := public.checklist_item_failed(
    run_item.response_type,
    expected,
    run_item.is_required,
    run_item.checked,
    run_item.response_text,
    run_item.response_number
  );

  if not should_fail then
    return null;
  end if;

  severity_value := coalesce(nullif(trim(run_item.incident_severity), ''), nullif(trim(template_item.incident_severity), ''), 'medium');
  roles := coalesce(nullif(run_item.notify_roles, '{}'::text[]), nullif(template_item.notify_roles, '{}'::text[]), array['admin','gerente_general','gerente']);
  incident_title := coalesce(template_record.title, 'Checklist') || ': ' || run_item.title;
  incident_description := concat_ws(E'\n',
    'Respuesta: ' || coalesce(nullif(run_item.response_text, ''), case when run_item.checked then 'checked' else 'unchecked' end),
    case when run_item.response_number is not null then 'Numero: ' || run_item.response_number::text else null end,
    case when nullif(trim(coalesce(run_item.comment, '')), '') is not null then 'Comentario: ' || run_item.comment else null end,
    case when nullif(trim(coalesce(run_item.photo_url, '')), '') is not null then 'Foto: ' || run_item.photo_url else null end
  );

  select * into incident_record
  from public.checklist_incidents
  where checklist_incidents.run_item_id = run_item.id
    and checklist_incidents.status in ('open', 'acknowledged', 'in_progress')
  limit 1;

  if incident_record.id is null then
    insert into public.checklist_incidents (
      run_id, run_item_id, template_id, template_item_id, title, description,
      area, severity, status, reported_by
    )
    values (
      run_record.id, run_item.id, template_record.id, template_item.id, incident_title,
      incident_description, coalesce(run_record.area, template_record.area), severity_value,
      'open', coalesce(run_item.completed_by, auth.uid())
    )
    returning * into incident_record;

    foreach role_value in array roles
    loop
      insert into public.notifications (
        user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
      )
      values (
        null,
        public.normalize_profile_role(role_value),
        'checklist_incident',
        'Incidencia en checklist',
        coalesce(template_record.title, 'Checklist') || ': ' || run_item.title || ' requiere atencion',
        'checklist_incident',
        incident_record.id::text,
        '/tasks?tab=checklists&view=incidents&id=' || incident_record.id::text,
        coalesce(run_item.completed_by, auth.uid())
      );
    end loop;
  else
    update public.checklist_incidents
    set
      title = incident_title,
      description = incident_description,
      severity = severity_value,
      area = coalesce(run_record.area, template_record.area),
      updated_at = now()
    where id = incident_record.id
    returning * into incident_record;
  end if;

  return incident_record;
end;
$$;

create or replace function public.evaluate_checklist_run_item_incident_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.evaluate_checklist_run_item_incident(new.id);
  return new;
end;
$$;

drop trigger if exists evaluate_checklist_run_item_incident_after_save on public.checklist_run_items;
create trigger evaluate_checklist_run_item_incident_after_save
  after insert or update of checked, response_text, response_number, photo_url, comment, completed_by on public.checklist_run_items
  for each row execute procedure public.evaluate_checklist_run_item_incident_trigger();

create or replace function public.update_checklist_incident_status(
  p_incident_id uuid,
  p_status text,
  p_resolution_notes text default null
)
returns public.checklist_incidents
language plpgsql
security definer
set search_path = ''
as $$
declare
  incident_record public.checklist_incidents;
begin
  if p_status not in ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed') then
    raise exception 'Estado de incidencia no valido.';
  end if;

  select * into incident_record
  from public.checklist_incidents
  where id = p_incident_id
  for update;

  if incident_record.id is null then
    raise exception 'La incidencia no existe.';
  end if;

  if not public.can_access_checklist_incident(incident_record) or not public.can_manage_checklist_incident_status(p_status) then
    raise exception 'No tienes permiso para actualizar esta incidencia.';
  end if;

  update public.checklist_incidents
  set
    status = p_status,
    resolution_notes = coalesce(nullif(trim(p_resolution_notes), ''), resolution_notes),
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else resolved_by end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
    updated_at = now()
  where id = p_incident_id
  returning * into incident_record;

  return incident_record;
end;
$$;

revoke all on function
  public.can_access_checklist_incident(public.checklist_incidents),
  public.can_manage_checklist_incident_status(text),
  public.checklist_item_failed(text, text, boolean, boolean, text, numeric),
  public.evaluate_checklist_run_item_incident(uuid),
  public.evaluate_checklist_run_item_incident_trigger(),
  public.update_checklist_incident_status(uuid, text, text)
from public;

grant execute on function
  public.can_access_checklist_incident(public.checklist_incidents),
  public.can_manage_checklist_incident_status(text),
  public.checklist_item_failed(text, text, boolean, boolean, text, numeric),
  public.evaluate_checklist_run_item_incident(uuid),
  public.update_checklist_incident_status(uuid, text, text)
to authenticated;

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
  existing_run public.checklist_runs;
  created_run public.checklist_runs;
  effective_profile_id uuid;
begin
  select * into template_row from public.checklist_templates where id = p_template_id and status = 'active';
  if template_row.id is null then
    raise exception 'La plantilla no existe o esta inactiva.';
  end if;

  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para crear checklists.';
  end if;

  effective_profile_id := coalesce(p_assigned_profile_id, template_row.assigned_profile_id);

  select * into existing_run
  from public.checklist_runs
  where template_id = template_row.id
    and run_date = p_run_date
    and coalesce(assigned_profile_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(effective_profile_id, '00000000-0000-0000-0000-000000000000'::uuid)
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
    require_comment_on_no, require_photo_on_no, generate_incident_on_no, rule_config,
    expected_response, triggers_incident, incident_severity, notify_roles, create_task_on_fail
  )
  select
    created_run.id, item.id, item.item_order, item.title, item.response_type,
    item.is_required, item.requires_photo, item.requires_comment, item.score_points,
    item.options, item.require_comment_on_no, item.require_photo_on_no,
    item.generate_incident_on_no, item.rule_config, item.expected_response,
    item.triggers_incident, item.incident_severity, item.notify_roles, item.create_task_on_fail
  from public.checklist_template_items item
  where item.template_id = template_row.id
  order by item.item_order;

  perform public.create_checklist_run_notifications(created_run.id);
  return created_run;
end;
$$;

grant execute on function public.create_checklist_run_from_template(uuid, date, text, uuid, text) to authenticated;
