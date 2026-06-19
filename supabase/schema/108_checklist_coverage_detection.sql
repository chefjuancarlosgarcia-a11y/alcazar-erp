-- Checklist coverage detection, alerts, and optional auto-reassignment.
-- Apply after 107_checklist_operational_status_and_replacement.sql.
-- Does not change RLS policies.

alter table public.checklist_templates
  add column if not exists primary_replacement_profile_id uuid references public.profiles(id),
  add column if not exists secondary_replacement_profile_id uuid references public.profiles(id),
  add column if not exists coverage_escalation_profile_id uuid references public.profiles(id),
  add column if not exists auto_coverage_enabled boolean not null default false,
  add column if not exists auto_coverage_wait_minutes integer not null default 20
    check (auto_coverage_wait_minutes between 0 and 240);

alter table public.checklist_template_change_requests
  add column if not exists primary_replacement_profile_id uuid references public.profiles(id),
  add column if not exists secondary_replacement_profile_id uuid references public.profiles(id),
  add column if not exists coverage_escalation_profile_id uuid references public.profiles(id),
  add column if not exists auto_coverage_enabled boolean not null default false,
  add column if not exists auto_coverage_wait_minutes integer not null default 20
    check (auto_coverage_wait_minutes between 0 and 240);

alter table public.checklist_runs
  add column if not exists coverage_alert_notified_at timestamptz,
  add column if not exists coverage_auto_applied_at timestamptz,
  add column if not exists last_coverage_availability_state text,
  add column if not exists coverage_escalated_at timestamptz;

alter table public.checklist_runs
  drop constraint if exists checklist_runs_replacement_reason_check;

alter table public.checklist_runs
  add constraint checklist_runs_replacement_reason_check
  check (replacement_reason is null or replacement_reason in (
    'descanso', 'vacaciones', 'permiso', 'ausencia', 'ausencia_no_marcaje', 'emergencia', 'otro'
  ));

create index if not exists checklist_runs_coverage_alert_idx
  on public.checklist_runs (coverage_alert_notified_at)
  where coverage_alert_notified_at is not null;

create index if not exists checklist_templates_auto_coverage_idx
  on public.checklist_templates (auto_coverage_enabled)
  where auto_coverage_enabled = true;

create or replace function public.can_configure_checklist_coverage()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and status = 'active'
      and public.normalize_profile_role(role) in (
        'admin', 'gerente_general', 'gerente', 'supervisor', 'recursos_humanos', 'rrhh'
      )
  );
$$;

create or replace function public._profile_schedule_unavailability(
  p_profile_id uuid,
  p_date date
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  weekday_int integer;
  schedule_row record;
  custom_row record;
begin
  weekday_int := extract(dow from coalesce(p_date, current_date))::integer;

  for schedule_row in
    select
      es.is_work_day,
      es.shift_type,
      coalesce(st.is_rest_day, false) as is_rest_day,
      coalesce(st.is_holiday, false) as is_holiday,
      st.name as shift_type_name
    from public.employee_schedules es
    left join public.shift_types st on st.id = es.shift_type_id
    where es.employee_id = p_profile_id
      and es.shift_date = coalesce(p_date, current_date)
      and es.status = 'published'
  loop
    if schedule_row.is_holiday
      or lower(coalesce(schedule_row.shift_type_name, '')) like '%vacac%' then
      return 'Vacaciones';
    end if;
    if not schedule_row.is_work_day
      or lower(coalesce(schedule_row.shift_type, '')) in ('rest', 'asueto')
      or schedule_row.is_rest_day then
      return 'Dia de descanso';
    end if;
  end loop;

  for custom_row in
    select
      coalesce(st.is_rest_day, false) as is_rest_day,
      coalesce(st.is_holiday, false) as is_holiday,
      st.name as shift_type_name
    from public.employee_custom_schedules ecs
    left join public.shift_types st on st.id = ecs.shift_type_id
    where ecs.profile_id = p_profile_id
      and ecs.status = 'active'
      and (
        ecs.specific_date = coalesce(p_date, current_date)
        or (
          ecs.weekday = weekday_int
          and ecs.specific_date is null
          and (ecs.start_date is null or ecs.start_date <= coalesce(p_date, current_date))
          and (ecs.end_date is null or ecs.end_date >= coalesce(p_date, current_date))
        )
        or (
          ecs.start_date is not null
          and ecs.end_date is not null
          and coalesce(p_date, current_date) between ecs.start_date and ecs.end_date
        )
      )
  loop
    if custom_row.is_holiday
      or lower(coalesce(custom_row.shift_type_name, '')) like '%vacac%' then
      return 'Vacaciones';
    end if;
    if custom_row.is_rest_day then
      return 'Dia de descanso';
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public._profile_has_work_schedule(
  p_profile_id uuid,
  p_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employee_schedules s
    left join public.shift_types st on st.id = s.shift_type_id
    where s.employee_id = p_profile_id
      and s.shift_date = p_date
      and s.status = 'published'
      and s.is_work_day = true
      and coalesce(st.is_rest_day, false) = false
      and coalesce(st.is_holiday, false) = false
      and coalesce(s.shift_type, '') not in ('rest', 'asueto')
  );
$$;

create or replace function public._profile_earliest_shift_start(
  p_profile_id uuid,
  p_date date
)
returns time
language sql
stable
security definer
set search_path = ''
as $$
  select min(s.start_time)
  from public.employee_schedules s
  left join public.shift_types st on st.id = s.shift_type_id
  where s.employee_id = p_profile_id
    and s.shift_date = p_date
    and s.status = 'published'
    and s.is_work_day = true
    and coalesce(st.is_rest_day, false) = false
    and coalesce(st.is_holiday, false) = false
    and coalesce(s.shift_type, '') not in ('rest', 'asueto')
    and s.start_time is not null;
$$;

create or replace function public._profile_is_checked_in(
  p_profile_id uuid,
  p_labor_date date,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ctx jsonb;
begin
  ctx := public.resolve_attendance_context(p_profile_id, 'entrada', p_at);
  if coalesce((ctx ->> 'has_open_entry')::boolean, false) then
    return true;
  end if;

  return exists (
    select 1
    from public.attendance_marks m
    where m.employee_id = p_profile_id
      and m.mark_type = 'entrada'
      and (m.marked_at at time zone 'America/Guatemala')::date = p_labor_date
  );
end;
$$;

create or replace function public.classify_checklist_responsible_availability(
  p_profile_id uuid,
  p_reference_at timestamptz default now(),
  p_operational_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  profile_row public.profiles;
  op_date date := coalesce(p_operational_date, public.get_checklist_operational_date(p_reference_at));
  labor_date date;
  ctx jsonb;
  schedule_gate jsonb;
  unavailability text;
  shift_start time;
  grace_minutes integer;
  shift_start_ts timestamptz;
  tolerance_ts timestamptz;
  availability_state text := 'unknown';
  availability_label text := 'No determinado';
  replacement_reason_suggestion text := null;
  checked_in boolean := false;
  has_work boolean := false;
begin
  if p_profile_id is null then
    return jsonb_build_object(
      'profile_id', null,
      'operational_date', op_date,
      'availability_state', 'unknown',
      'availability_label', 'No determinado'
    );
  end if;

  if not (
    public.can_access_checklists()
    or p_profile_id = auth.uid()
    or public.can_assign_checklist_run_replacement()
  ) then
    raise exception 'No tienes permiso para consultar disponibilidad de checklist.';
  end if;

  select * into profile_row from public.profiles where id = p_profile_id;
  if profile_row.id is null then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'unknown',
      'availability_label', 'Perfil no encontrado'
    );
  end if;

  if profile_row.status in ('inactive', 'suspended') then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'unknown',
      'availability_label', 'Colaborador inactivo o suspendido',
      'profile_status', profile_row.status
    );
  end if;

  unavailability := public._profile_schedule_unavailability(p_profile_id, op_date);
  if unavailability = 'Vacaciones' then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'approved_leave',
      'availability_label', 'Vacaciones o permiso aprobado',
      'replacement_reason_suggestion', 'vacaciones',
      'schedule_unavailability', unavailability
    );
  end if;

  if unavailability = 'Dia de descanso' then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'official_day_off',
      'availability_label', 'Dia de descanso o asueto',
      'replacement_reason_suggestion', 'descanso',
      'schedule_unavailability', unavailability
    );
  end if;

  schedule_gate := public.can_employee_mark_attendance(p_profile_id, op_date);
  has_work := public._profile_has_work_schedule(p_profile_id, op_date);

  if coalesce(schedule_gate ->> 'reason_code', '') = 'no_schedule' and not has_work then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'no_schedule',
      'availability_label', 'Sin horario asignado',
      'schedule_reason_code', schedule_gate ->> 'reason_code'
    );
  end if;

  if coalesce(schedule_gate ->> 'reason_code', '') = 'rest_day' and not has_work then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'official_day_off',
      'availability_label', 'Dia de descanso o asueto',
      'replacement_reason_suggestion', 'descanso',
      'schedule_reason_code', schedule_gate ->> 'reason_code'
    );
  end if;

  ctx := public.resolve_attendance_context(p_profile_id, 'entrada', p_reference_at);
  labor_date := coalesce((ctx ->> 'labor_date')::date, op_date);
  checked_in := public._profile_is_checked_in(p_profile_id, labor_date, p_reference_at);

  if checked_in then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'labor_date', labor_date,
      'availability_state', 'available_present',
      'availability_label', 'Presente o con entrada registrada',
      'checked_in', true,
      'has_open_entry', coalesce((ctx ->> 'has_open_entry')::boolean, false)
    );
  end if;

  if not has_work then
    return jsonb_build_object(
      'profile_id', p_profile_id,
      'operational_date', op_date,
      'availability_state', 'unknown',
      'availability_label', 'No determinado',
      'schedule_reason_code', schedule_gate ->> 'reason_code'
    );
  end if;

  shift_start := public._profile_earliest_shift_start(p_profile_id, op_date);
  grace_minutes := public.get_attendance_late_grace_minutes();

  if shift_start is null then
    availability_state := 'scheduled_not_checked_in';
    availability_label := 'Turno programado sin marcaje de entrada';
    replacement_reason_suggestion := 'ausencia_no_marcaje';
  else
    shift_start_ts := (op_date + shift_start) at time zone 'America/Guatemala';
    tolerance_ts := shift_start_ts + make_interval(mins => grace_minutes);
    if p_reference_at >= tolerance_ts then
      availability_state := 'scheduled_not_checked_in';
      availability_label := 'Turno programado sin marcaje de entrada';
      replacement_reason_suggestion := 'ausencia_no_marcaje';
    else
      availability_state := 'unknown';
      availability_label := 'Esperando marcaje de entrada';
    end if;
  end if;

  return jsonb_build_object(
    'profile_id', p_profile_id,
    'operational_date', op_date,
    'labor_date', labor_date,
    'availability_state', availability_state,
    'availability_label', availability_label,
    'replacement_reason_suggestion', replacement_reason_suggestion,
    'checked_in', false,
    'shift_start', shift_start,
    'grace_minutes', grace_minutes
  );
end;
$$;

create or replace function public._pick_available_checklist_replacement(
  p_candidate_ids uuid[],
  p_reference_at timestamptz default now(),
  p_operational_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate_id uuid;
  availability jsonb;
begin
  foreach candidate_id in array coalesce(p_candidate_ids, array[]::uuid[])
  loop
    if candidate_id is null then
      continue;
    end if;
    availability := public.classify_checklist_responsible_availability(
      candidate_id,
      p_reference_at,
      p_operational_date
    );
    if coalesce(availability ->> 'availability_state', '') = 'available_present' then
      return jsonb_build_object(
        'profile_id', candidate_id,
        'availability', availability
      );
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.get_checklist_run_coverage_context(
  p_run_id uuid,
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  template_row public.checklist_templates;
  original_id uuid;
  op_date date;
  availability jsonb;
  primary_id uuid;
  secondary_id uuid;
  escalation_id uuid;
  picked jsonb;
  suggested_id uuid;
  suggested_source text := 'none';
  suggested_reason text := null;
  needs_alert boolean := false;
  already_replaced boolean := false;
  unavailable_states text[] := array['approved_leave', 'official_day_off', 'scheduled_not_checked_in'];
begin
  select * into run_row from public.checklist_runs where id = p_run_id;
  if run_row.id is null then
    raise exception 'Checklist no encontrada.';
  end if;

  if not public.can_access_checklist_run(run_row) then
    raise exception 'No tienes permiso para consultar esta checklist.';
  end if;

  select * into template_row from public.checklist_templates where id = run_row.template_id;
  op_date := run_row.run_date;
  original_id := coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id);
  already_replaced := run_row.replaced_at is not null
    and run_row.original_assigned_profile_id is not null
    and run_row.original_assigned_profile_id <> run_row.assigned_profile_id;

  if original_id is null then
    return jsonb_build_object(
      'run_id', run_row.id,
      'needs_coverage_alert', false,
      'already_replaced', already_replaced,
      'responsible_availability', jsonb_build_object(
        'availability_state', 'unknown',
        'availability_label', 'Sin responsable fijo'
      )
    );
  end if;

  availability := public.classify_checklist_responsible_availability(original_id, p_reference_at, op_date);

  primary_id := coalesce(
    template_row.primary_replacement_profile_id,
    template_row.backup_profile_id
  );
  secondary_id := template_row.secondary_replacement_profile_id;
  escalation_id := template_row.coverage_escalation_profile_id;

  picked := public._pick_available_checklist_replacement(
    array[primary_id, secondary_id],
    p_reference_at,
    op_date
  );
  if picked is not null then
    suggested_id := (picked ->> 'profile_id')::uuid;
    suggested_source := case
      when suggested_id = primary_id then 'primary'
      when suggested_id = secondary_id then 'secondary'
      else 'candidate'
    end;
    suggested_reason := coalesce(availability ->> 'replacement_reason_suggestion', 'ausencia');
  elsif escalation_id is not null then
    suggested_id := escalation_id;
    suggested_source := 'escalation';
    suggested_reason := coalesce(availability ->> 'replacement_reason_suggestion', 'ausencia');
  end if;

  needs_alert := run_row.status in ('pending', 'in_progress', 'rejected', 'overdue')
    and not already_replaced
    and coalesce(availability ->> 'availability_state', '') = any(unavailable_states)
    and public.is_checklist_operational_window_open(run_row.run_date, p_reference_at);

  return jsonb_build_object(
    'run_id', run_row.id,
    'template_id', run_row.template_id,
    'original_profile_id', original_id,
    'effective_profile_id', run_row.assigned_profile_id,
    'already_replaced', already_replaced,
    'needs_coverage_alert', needs_alert,
    'responsible_availability', availability,
    'suggested_replacement_profile_id', suggested_id,
    'suggested_replacement_source', suggested_source,
    'suggested_replacement_reason', suggested_reason,
    'escalation_profile_id', escalation_id,
    'auto_coverage_enabled', coalesce(template_row.auto_coverage_enabled, false),
    'auto_coverage_wait_minutes', coalesce(template_row.auto_coverage_wait_minutes, 20),
    'coverage_alert_notified_at', run_row.coverage_alert_notified_at,
    'coverage_auto_applied_at', run_row.coverage_auto_applied_at,
    'last_coverage_availability_state', run_row.last_coverage_availability_state
  );
end;
$$;

create or replace function public.get_checklist_coverage_for_runs(
  p_run_ids uuid[],
  p_reference_at timestamptz default now()
)
returns table (
  run_id uuid,
  coverage jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  run_id_value uuid;
begin
  if not public.can_access_checklists() then
    raise exception 'No tienes permiso para consultar cobertura de checklists.';
  end if;

  foreach run_id_value in array coalesce(p_run_ids, array[]::uuid[])
  loop
    run_id := run_id_value;
    coverage := public.get_checklist_run_coverage_context(run_id_value, p_reference_at);
    return next;
  end loop;
end;
$$;

create or replace function public.assign_checklist_run_replacement(
  p_run_id uuid,
  p_replacement_profile_id uuid,
  p_reason text,
  p_notes text default null
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  replacement_row public.profiles;
  original_id uuid;
  reason_value text := lower(trim(coalesce(p_reason, '')));
  notes_value text := nullif(trim(coalesce(p_notes, '')), '');
  replacement_name text;
  actor_name text;
  role_value text;
begin
  if not public.can_assign_checklist_run_replacement() then
    raise exception 'No tienes permiso para asignar reemplazos de checklist.';
  end if;

  if p_replacement_profile_id is null then
    raise exception 'Selecciona un colaborador de reemplazo.';
  end if;

  if reason_value not in (
    'descanso', 'vacaciones', 'permiso', 'ausencia', 'ausencia_no_marcaje', 'emergencia', 'otro'
  ) then
    raise exception 'Motivo de reemplazo invalido.';
  end if;

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

  select * into replacement_row
  from public.profiles
  where id = p_replacement_profile_id
    and status = 'active';

  if replacement_row.id is null then
    raise exception 'Colaborador de reemplazo no encontrado o inactivo.';
  end if;

  original_id := coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id);

  if original_id = p_replacement_profile_id then
    raise exception 'El reemplazo debe ser un colaborador distinto al responsable original.';
  end if;

  update public.checklist_runs
  set
    original_assigned_profile_id = original_id,
    assigned_profile_id = p_replacement_profile_id,
    replacement_reason = reason_value,
    replacement_notes = notes_value,
    replaced_at = now(),
    replaced_by = auth.uid(),
    updated_at = now()
  where id = p_run_id
  returning * into run_row;

  insert into public.checklist_session_audit (profile_id, checklist_run_id, event_type, details)
  values (
    auth.uid(),
    run_row.id,
    'run_replacement',
    jsonb_build_object(
      'original_assigned_profile_id', original_id,
      'replacement_profile_id', p_replacement_profile_id,
      'replacement_reason', reason_value,
      'replacement_notes', notes_value
    )
  );

  select coalesce(full_name, username, 'Colaborador') into replacement_name
  from public.profiles where id = p_replacement_profile_id;

  select coalesce(full_name, username, 'Supervisor') into actor_name
  from public.profiles where id = auth.uid();

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    p_replacement_profile_id,
    null,
    'checklist_replacement',
    'Checklist asignada por reemplazo',
    coalesce(
      (select title from public.checklist_templates where id = run_row.template_id limit 1),
      'Checklist'
    ) || ' fue reasignada a ti. Motivo: ' || reason_value || '.',
    'checklist_run',
    run_row.id::text,
    '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
    auth.uid()
  );

  if run_row.supervisor_profile_id is not null then
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      run_row.supervisor_profile_id,
      null,
      'checklist_replacement',
      'Reemplazo de checklist registrado',
      actor_name || ' reasigno una checklist a ' || replacement_name || ' (' || reason_value || ').',
      'checklist_run',
      run_row.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
      auth.uid()
    );
  end if;

  foreach role_value in array array['admin', 'gerente_general']
  loop
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      null,
      role_value,
      'checklist_replacement',
      'Reemplazo de checklist registrado',
      actor_name || ' reasigno una checklist a ' || replacement_name || ' (' || reason_value || ').',
      'checklist_run',
      run_row.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
      auth.uid()
    );
  end loop;

  return run_row;
end;
$$;

create or replace function public._apply_checklist_auto_coverage(
  p_run_id uuid,
  p_reference_at timestamptz default now()
)
returns public.checklist_runs
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  template_row public.checklist_templates;
  coverage jsonb;
  availability_state text;
  suggested_id uuid;
  suggested_reason text;
  auto_wait integer;
  shift_start time;
  grace_minutes integer;
  auto_ready_at timestamptz;
  replacement_name text;
begin
  select * into run_row
  from public.checklist_runs
  where id = p_run_id
  for update;

  if run_row.id is null then
    return null;
  end if;

  if run_row.status in ('completed', 'cancelled') then
    return null;
  end if;

  if run_row.coverage_auto_applied_at is not null then
    return null;
  end if;

  if run_row.replaced_at is not null
    and run_row.original_assigned_profile_id is not null
    and run_row.original_assigned_profile_id <> run_row.assigned_profile_id then
    return null;
  end if;

  select * into template_row from public.checklist_templates where id = run_row.template_id;
  if coalesce(template_row.auto_coverage_enabled, false) is not true then
    return null;
  end if;

  coverage := public.get_checklist_run_coverage_context(p_run_id, p_reference_at);
  availability_state := coalesce(coverage -> 'responsible_availability' ->> 'availability_state', 'unknown');
  suggested_id := nullif(coverage ->> 'suggested_replacement_profile_id', '')::uuid;
  suggested_reason := coalesce(coverage ->> 'suggested_replacement_reason', 'ausencia');

  if suggested_id is null then
    update public.checklist_runs
    set coverage_escalated_at = coalesce(coverage_escalated_at, now()),
        last_coverage_availability_state = availability_state,
        updated_at = now()
    where id = p_run_id;
    return null;
  end if;

  if availability_state in ('approved_leave', 'official_day_off') then
    null;
  elsif availability_state = 'scheduled_not_checked_in' then
    auto_wait := coalesce(template_row.auto_coverage_wait_minutes, 20);
    grace_minutes := public.get_attendance_late_grace_minutes();
    shift_start := public._profile_earliest_shift_start(
      coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id),
      run_row.run_date
    );
    if shift_start is not null then
      auto_ready_at := ((run_row.run_date + shift_start) at time zone 'America/Guatemala')
        + make_interval(mins => grace_minutes + auto_wait);
      if p_reference_at < auto_ready_at then
        return null;
      end if;
    end if;
  else
    return null;
  end if;

  update public.checklist_runs
  set
    original_assigned_profile_id = coalesce(original_assigned_profile_id, assigned_profile_id),
    assigned_profile_id = suggested_id,
    replacement_reason = suggested_reason,
    replacement_notes = 'Asignacion automatica por motor de cobertura',
    replaced_at = now(),
    replaced_by = null,
    coverage_auto_applied_at = now(),
    last_coverage_availability_state = availability_state,
    updated_at = now()
  where id = p_run_id
  returning * into run_row;

  insert into public.checklist_session_audit (profile_id, checklist_run_id, event_type, details)
  values (
    null,
    run_row.id,
    'run_replacement_auto',
    jsonb_build_object(
      'replacement_profile_id', suggested_id,
      'replacement_reason', suggested_reason,
      'availability_state', availability_state,
      'coverage', coverage
    )
  );

  select coalesce(full_name, username, 'Colaborador') into replacement_name
  from public.profiles where id = suggested_id;

  insert into public.notifications (
    user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
  )
  values (
    suggested_id,
    null,
    'checklist_replacement',
    'Checklist asignada automaticamente',
    coalesce(
      (select title from public.checklist_templates where id = run_row.template_id limit 1),
      'Checklist'
    ) || ' fue reasignada automaticamente. Motivo: ' || suggested_reason || '.',
    'checklist_run',
    run_row.id::text,
    '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
    null
  );

  if run_row.supervisor_profile_id is not null then
    insert into public.notifications (
      user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
    )
    values (
      run_row.supervisor_profile_id,
      null,
      'checklist_coverage',
      'Cobertura automatica aplicada',
      'Se reasigno automaticamente una checklist a ' || replacement_name || '.',
      'checklist_run',
      run_row.id::text,
      '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
      null
    );
  end if;

  return run_row;
end;
$$;

create or replace function public.process_checklist_coverage(
  p_reference_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row public.checklist_runs;
  coverage jsonb;
  alerts_sent integer := 0;
  auto_applied integer := 0;
  escalated integer := 0;
  availability_state text;
  availability_label text;
  suggested_id uuid;
  template_title text;
  original_name text;
  suggested_name text;
  role_value text;
begin
  if not public.can_assign_checklist_run_replacement() then
    raise exception 'No tienes permiso para procesar cobertura de checklists.';
  end if;

  for run_row in
    select r.*
    from public.checklist_runs r
    where r.status in ('pending', 'in_progress', 'rejected', 'overdue')
      and public.is_checklist_operational_window_open(r.run_date, p_reference_at)
  loop
    coverage := public.get_checklist_run_coverage_context(run_row.id, p_reference_at);
    availability_state := coalesce(coverage -> 'responsible_availability' ->> 'availability_state', 'unknown');
    availability_label := coalesce(coverage -> 'responsible_availability' ->> 'availability_label', 'No determinado');
    suggested_id := nullif(coverage ->> 'suggested_replacement_profile_id', '')::uuid;

    update public.checklist_runs
    set last_coverage_availability_state = availability_state
    where id = run_row.id;

    if coalesce((coverage ->> 'needs_coverage_alert')::boolean, false)
      and run_row.coverage_alert_notified_at is null then
      select title into template_title
      from public.checklist_templates
      where id = run_row.template_id;

      select coalesce(full_name, username, 'Colaborador') into original_name
      from public.profiles
      where id = coalesce(run_row.original_assigned_profile_id, run_row.assigned_profile_id);

      select coalesce(full_name, username, 'Colaborador') into suggested_name
      from public.profiles
      where id = suggested_id;

      foreach role_value in array array['admin', 'gerente_general', 'gerente']
      loop
        insert into public.notifications (
          user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
        )
        select
          null,
          role_value,
          'checklist_coverage',
          'Responsable no disponible',
          coalesce(template_title, 'Checklist')
            || ': '
            || coalesce(original_name, 'responsable')
            || ' no disponible ('
            || availability_label
            || ').'
            || case
              when suggested_name is not null then ' Reemplazo sugerido: ' || suggested_name || '.'
              else ' Escalar cobertura manualmente.'
            end,
          'checklist_run',
          run_row.id::text,
          '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
          null
        where not exists (
          select 1
          from public.notifications n
          where n.type = 'checklist_coverage'
            and n.entity_type = 'checklist_run'
            and n.entity_id = run_row.id::text
            and n.target_role = role_value
        );
      end loop;

      if run_row.supervisor_profile_id is not null then
        insert into public.notifications (
          user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
        )
        select
          run_row.supervisor_profile_id,
          null,
          'checklist_coverage',
          'Responsable no disponible',
          coalesce(template_title, 'Checklist')
            || ': '
            || coalesce(original_name, 'responsable')
            || ' no disponible ('
            || availability_label
            || ').',
          'checklist_run',
          run_row.id::text,
          '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
          null
        where not exists (
          select 1
          from public.notifications n
          where n.type = 'checklist_coverage'
            and n.entity_type = 'checklist_run'
            and n.entity_id = run_row.id::text
            and n.user_id = run_row.supervisor_profile_id
        );
      end if;

      if suggested_id is not null then
        insert into public.notifications (
          user_id, target_role, type, title, message, entity_type, entity_id, action_url, created_by
        )
        select
          suggested_id,
          null,
          'checklist_coverage',
          'Posible cobertura de checklist',
          'Se sugiere cubrir '
            || coalesce(template_title, 'checklist')
            || ' porque '
            || coalesce(original_name, 'el responsable')
            || ' no esta disponible.',
          'checklist_run',
          run_row.id::text,
          '/tasks?tab=checklists&view=run&id=' || run_row.id::text,
          null
        where not exists (
          select 1
          from public.notifications n
          where n.type = 'checklist_coverage'
            and n.entity_type = 'checklist_run'
            and n.entity_id = run_row.id::text
            and n.user_id = suggested_id
        );
      else
        update public.checklist_runs
        set coverage_escalated_at = coalesce(coverage_escalated_at, now())
        where id = run_row.id;
        escalated := escalated + 1;
      end if;

      update public.checklist_runs
      set coverage_alert_notified_at = now()
      where id = run_row.id;

      alerts_sent := alerts_sent + 1;
    end if;

    if public._apply_checklist_auto_coverage(run_row.id, p_reference_at) is not null then
      auto_applied := auto_applied + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'alerts_sent', alerts_sent,
    'auto_applied', auto_applied,
    'escalated', escalated
  );
end;
$$;

drop function if exists public.get_checklist_templates_library();

create or replace function public.get_checklist_templates_library()
returns table (
  id uuid,
  title text,
  description text,
  area text,
  assigned_role text,
  assigned_profile_id uuid,
  supervisor_profile_id uuid,
  backup_profile_id uuid,
  primary_replacement_profile_id uuid,
  secondary_replacement_profile_id uuid,
  coverage_escalation_profile_id uuid,
  auto_coverage_enabled boolean,
  auto_coverage_wait_minutes integer,
  frequency text,
  shift_context text,
  status text,
  reminder_time time,
  due_time time,
  recurrence_days integer[],
  recurrence_month_day integer,
  recurrence_rule text,
  skip_non_work_days boolean,
  auto_generate boolean,
  requires_approval boolean,
  created_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  creator_name text,
  checklist_template_items jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    t.id,
    t.title,
    t.description,
    t.area,
    t.assigned_role,
    t.assigned_profile_id,
    t.supervisor_profile_id,
    t.backup_profile_id,
    t.primary_replacement_profile_id,
    t.secondary_replacement_profile_id,
    t.coverage_escalation_profile_id,
    t.auto_coverage_enabled,
    t.auto_coverage_wait_minutes,
    t.frequency,
    t.shift_context,
    t.status,
    t.reminder_time,
    t.due_time,
    t.recurrence_days,
    t.recurrence_month_day,
    t.recurrence_rule,
    t.skip_non_work_days,
    t.auto_generate,
    t.requires_approval,
    t.created_by,
    t.created_at,
    t.updated_at,
    coalesce(p.full_name, p.username, 'Colaborador') as creator_name,
    coalesce(
      (
        select jsonb_agg(to_jsonb(item) order by item.item_order)
        from public.checklist_template_items item
        where item.template_id = t.id
          and item.is_active is distinct from false
      ),
      '[]'::jsonb
    ) as checklist_template_items
  from public.checklist_templates t
  left join public.profiles p on p.id = t.created_by
  where public.can_read_checklist_template(t)
  order by t.created_at desc;
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
      status, created_by, supervisor_profile_id, backup_profile_id,
      primary_replacement_profile_id, secondary_replacement_profile_id, coverage_escalation_profile_id,
      auto_coverage_enabled, auto_coverage_wait_minutes,
      reminder_time, due_time, recurrence_days, recurrence_month_day, recurrence_rule,
      skip_non_work_days, auto_generate, requires_approval
    )
    values (
      request_row.title, request_row.description, request_row.area, request_row.assigned_role,
      request_row.assigned_profile_id, coalesce(request_row.frequency, 'manual'),
      coalesce(request_row.shift_context, 'general'), coalesce(request_row.status_after_approval, 'active'),
      request_row.submitted_by, request_row.supervisor_profile_id, request_row.backup_profile_id,
      request_row.primary_replacement_profile_id, request_row.secondary_replacement_profile_id,
      request_row.coverage_escalation_profile_id,
      coalesce(request_row.auto_coverage_enabled, false), coalesce(request_row.auto_coverage_wait_minutes, 20),
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
        primary_replacement_profile_id = request_row.primary_replacement_profile_id,
        secondary_replacement_profile_id = request_row.secondary_replacement_profile_id,
        coverage_escalation_profile_id = request_row.coverage_escalation_profile_id,
        auto_coverage_enabled = coalesce(request_row.auto_coverage_enabled, false),
        auto_coverage_wait_minutes = coalesce(request_row.auto_coverage_wait_minutes, 20),
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

  if v_template_id is not null and request_row.request_type in ('create', 'update') then
    perform public.sync_checklist_runs_from_template(v_template_id);
  end if;

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

revoke all on function public.can_configure_checklist_coverage() from public;
grant execute on function public.can_configure_checklist_coverage() to authenticated;
revoke all on function public.classify_checklist_responsible_availability(uuid, timestamptz, date) from public;
grant execute on function public.classify_checklist_responsible_availability(uuid, timestamptz, date) to authenticated;
revoke all on function public.get_checklist_run_coverage_context(uuid, timestamptz) from public;
grant execute on function public.get_checklist_run_coverage_context(uuid, timestamptz) to authenticated;
revoke all on function public.get_checklist_coverage_for_runs(uuid[], timestamptz) from public;
grant execute on function public.get_checklist_coverage_for_runs(uuid[], timestamptz) to authenticated;
revoke all on function public.process_checklist_coverage(timestamptz) from public;
grant execute on function public.process_checklist_coverage(timestamptz) to authenticated;
revoke all on function public.get_checklist_templates_library() from public;
grant execute on function public.get_checklist_templates_library() to authenticated;
revoke all on function public.approve_checklist_change_request(uuid, text) from public;
grant execute on function public.approve_checklist_change_request(uuid, text) to authenticated;
