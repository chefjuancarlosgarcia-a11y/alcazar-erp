-- Attendance: register always, classify and review after.
-- Apply after 139_notifications_mark_all_read_admin.sql.

alter table public.attendance_marks
  add column if not exists labor_date date,
  add column if not exists classification text,
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_notes text,
  add column if not exists schedule_exception_id uuid references public.employee_custom_schedules(id) on delete set null,
  add column if not exists system_reason text;

alter table public.attendance_marks
  drop constraint if exists attendance_marks_classification_check;

alter table public.attendance_marks
  add constraint attendance_marks_classification_check
  check (
    classification is null
    or classification in (
      'normal', 'late', 'early', 'out_of_schedule', 'no_schedule',
      'rest_day_worked', 'authorized_overtime', 'pending_overtime', 'manual_adjustment'
    )
  );

alter table public.attendance_marks
  drop constraint if exists attendance_marks_approval_status_check;

alter table public.attendance_marks
  add constraint attendance_marks_approval_status_check
  check (approval_status in ('not_required', 'pending', 'approved', 'rejected'));

create index if not exists attendance_marks_review_idx
  on public.attendance_marks (approval_status, classification, labor_date desc, marked_at desc);

-- ---------------------------------------------------------------------------
-- find_attendance_schedule_exception
-- ---------------------------------------------------------------------------
create or replace function public.find_attendance_schedule_exception(
  p_employee_id uuid,
  p_date date,
  p_at timestamptz default now()
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Guatemala';
  v_weekday integer;
  v_exception_id uuid;
begin
  v_weekday := extract(dow from p_date)::integer;

  select ecs.id into v_exception_id
  from public.employee_custom_schedules ecs
  where ecs.profile_id = p_employee_id
    and ecs.status = 'active'
    and (
      ecs.specific_date = p_date
      or (
        ecs.weekday = v_weekday
        and ecs.specific_date is null
        and (ecs.start_date is null or ecs.start_date <= p_date)
        and (ecs.end_date is null or ecs.end_date >= p_date)
      )
      or (
        ecs.start_date is not null
        and ecs.end_date is not null
        and p_date between ecs.start_date and ecs.end_date
      )
    )
    and (
      ecs.start_time is null
      or ecs.end_time is null
      or p_at between
        ((p_date + ecs.start_time) at time zone v_tz)
        and (
          ((p_date + case when ecs.end_time <= ecs.start_time then 1 else 0 end) + ecs.end_time)
            at time zone v_tz
          + interval '2 hours'
        )
    )
  order by
    case when ecs.specific_date = p_date then 0 else 1 end,
    case when ecs.start_time is not null and ecs.end_time is not null then 0 else 1 end,
    ecs.updated_at desc
  limit 1;

  return v_exception_id;
end;
$$;

revoke all on function public.find_attendance_schedule_exception(uuid, date, timestamptz) from public;
grant execute on function public.find_attendance_schedule_exception(uuid, date, timestamptz) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- classify_attendance_mark
-- ---------------------------------------------------------------------------
create or replace function public.classify_attendance_mark(
  p_employee_id uuid,
  p_labor_date date,
  p_mark_type text,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz constant text := 'America/Guatemala';
  v_mark_type text := lower(trim(coalesce(p_mark_type, 'entrada')));
  v_work record;
  v_any_schedule boolean;
  v_rest_only boolean;
  v_exception_id uuid;
  v_grace integer;
  v_shift_start_ts timestamptz;
  v_shift_end_ts timestamptz;
  v_early_minutes integer;
  v_late_minutes integer;
  v_open_entry public.attendance_marks;
begin
  if v_mark_type = 'salida' then v_mark_type := 'salida_final'; end if;

  if v_mark_type <> 'entrada' then
    select m.* into v_open_entry
    from public.attendance_marks m
    where m.employee_id = p_employee_id
      and m.mark_type = 'entrada'
      and not exists (
        select 1
        from public.attendance_marks out_mark
        where out_mark.employee_id = m.employee_id
          and out_mark.mark_type in ('salida_final', 'salida')
          and out_mark.marked_at > m.marked_at
      )
    order by m.marked_at desc
    limit 1;

    if v_open_entry.id is not null then
      return jsonb_build_object(
        'classification', coalesce(v_open_entry.classification, 'normal'),
        'approval_status', coalesce(v_open_entry.approval_status, 'not_required'),
        'schedule_exception_id', v_open_entry.schedule_exception_id,
        'system_reason', coalesce(v_open_entry.system_reason, 'Marcación de cierre vinculada a la entrada activa.'),
        'schedule_id', null,
        'schedule_status', null,
        'reason_code', coalesce(v_open_entry.classification, 'normal')
      );
    end if;
  end if;

  v_exception_id := public.find_attendance_schedule_exception(p_employee_id, p_labor_date, p_at);
  if v_exception_id is not null then
    return jsonb_build_object(
      'classification', 'authorized_overtime',
      'approval_status', 'approved',
      'schedule_exception_id', v_exception_id,
      'system_reason', 'Excepción de horario / tiempo extraordinario autorizado.',
      'schedule_id', null,
      'schedule_status', null,
      'reason_code', 'authorized_overtime'
    );
  end if;

  select exists (
    select 1
    from public.employee_schedules s
    where s.employee_id = p_employee_id
      and s.shift_date = p_labor_date
      and s.status in ('draft', 'published')
  ) into v_any_schedule;

  if not v_any_schedule then
    return jsonb_build_object(
      'classification', 'no_schedule',
      'approval_status', 'pending',
      'schedule_exception_id', null,
      'system_reason', 'Sin horario asignado para esta fecha.',
      'schedule_id', null,
      'schedule_status', null,
      'reason_code', 'no_schedule'
    );
  end if;

  select
    s.id,
    s.status,
    s.is_work_day,
    s.start_time,
    s.end_time
  into v_work
  from public.employee_schedules s
  left join public.shift_types st on st.id = s.shift_type_id
  where s.employee_id = p_employee_id
    and s.shift_date = p_labor_date
    and s.status in ('draft', 'published')
    and s.is_work_day = true
    and coalesce(st.is_rest_day, false) = false
    and coalesce(st.is_holiday, false) = false
    and coalesce(s.shift_type, '') not in ('rest', 'asueto')
  order by case s.status when 'published' then 0 else 1 end, s.block_order, s.start_time
  limit 1;

  if v_work.id is null then
    select not exists (
      select 1
      from public.employee_schedules s
      left join public.shift_types st on st.id = s.shift_type_id
      where s.employee_id = p_employee_id
        and s.shift_date = p_labor_date
        and s.status in ('draft', 'published')
        and s.is_work_day = true
        and coalesce(st.is_rest_day, false) = false
        and coalesce(st.is_holiday, false) = false
        and coalesce(s.shift_type, '') not in ('rest', 'asueto')
    ) into v_rest_only;

    if v_rest_only then
      return jsonb_build_object(
        'classification', 'rest_day_worked',
        'approval_status', 'pending',
        'schedule_exception_id', null,
        'system_reason', 'Día de descanso programado.',
        'schedule_id', null,
        'schedule_status', null,
        'reason_code', 'rest_day'
      );
    end if;

    return jsonb_build_object(
      'classification', 'no_schedule',
      'approval_status', 'pending',
      'schedule_exception_id', null,
      'system_reason', 'Sin bloque laboral válido para esta fecha.',
      'schedule_id', null,
      'schedule_status', null,
      'reason_code', 'no_schedule'
    );
  end if;

  v_grace := public.get_attendance_late_grace_minutes();
  v_shift_start_ts := ((p_labor_date + v_work.start_time) at time zone v_tz);
  v_shift_end_ts := (
    (p_labor_date + case when v_work.end_time <= v_work.start_time then 1 else 0 end) + v_work.end_time
  ) at time zone v_tz;

  if p_at < v_shift_start_ts - interval '2 hours' then
    return jsonb_build_object(
      'classification', 'out_of_schedule',
      'approval_status', 'pending',
      'schedule_exception_id', null,
      'system_reason', 'Marcación antes del horario permitido.',
      'schedule_id', v_work.id,
      'schedule_status', v_work.status,
      'reason_code', 'out_of_schedule'
    );
  end if;

  if p_at > v_shift_end_ts + interval '2 hours' then
    return jsonb_build_object(
      'classification', 'pending_overtime',
      'approval_status', 'pending',
      'schedule_exception_id', null,
      'system_reason', 'Marcación después del horario programado.',
      'schedule_id', v_work.id,
      'schedule_status', v_work.status,
      'reason_code', 'out_of_schedule'
    );
  end if;

  v_early_minutes := greatest(0, floor(extract(epoch from (v_shift_start_ts - p_at)) / 60)::integer);
  if v_early_minutes > 15 then
    return jsonb_build_object(
      'classification', 'early',
      'approval_status', 'not_required',
      'schedule_exception_id', null,
      'system_reason', 'Entrada anticipada dentro de ventana operativa.',
      'schedule_id', v_work.id,
      'schedule_status', v_work.status,
      'reason_code', 'allowed'
    );
  end if;

  v_late_minutes := greatest(0, floor(extract(epoch from (p_at - v_shift_start_ts)) / 60)::integer);
  if v_late_minutes > v_grace then
    return jsonb_build_object(
      'classification', 'late',
      'approval_status', 'not_required',
      'schedule_exception_id', null,
      'system_reason', format('Entrada tarde (%s min después del horario).', v_late_minutes),
      'schedule_id', v_work.id,
      'schedule_status', v_work.status,
      'reason_code', 'allowed'
    );
  end if;

  return jsonb_build_object(
    'classification', 'normal',
    'approval_status', 'not_required',
    'schedule_exception_id', null,
    'system_reason', 'Marcación dentro del horario asignado.',
    'schedule_id', v_work.id,
    'schedule_status', v_work.status,
    'reason_code', 'allowed'
  );
end;
$$;

revoke all on function public.classify_attendance_mark(uuid, date, text, timestamptz) from public;
grant execute on function public.classify_attendance_mark(uuid, date, text, timestamptz) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- can_employee_mark_attendance: classify without blocking
-- ---------------------------------------------------------------------------
create or replace function public.can_employee_mark_attendance(
  p_employee_id uuid,
  p_date date default (now() at time zone 'America/Guatemala')::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_class jsonb;
begin
  v_class := public.classify_attendance_mark(p_employee_id, p_date, 'entrada', now());

  return jsonb_build_object(
    'allowed', true,
    'reason', case
      when v_class ->> 'reason_code' = 'no_schedule' then
        'Sin horario asignado. La marcación se registrará para revisión de RRHH.'
      when v_class ->> 'reason_code' = 'rest_day' then
        'Día de descanso. La marcación se registrará como tiempo extraordinario pendiente.'
      when v_class ->> 'reason_code' = 'out_of_schedule' then
        'Fuera del horario asignado. La marcación se registrará para revisión.'
      when v_class ->> 'reason_code' = 'authorized_overtime' then
        'Tiempo extraordinario autorizado.'
      else null
    end,
    'reason_code', v_class -> 'reason_code',
    'classification', v_class -> 'classification',
    'approval_status', v_class -> 'approval_status',
    'schedule_exception_id', v_class -> 'schedule_exception_id',
    'system_reason', v_class -> 'system_reason',
    'schedule_id', v_class -> 'schedule_id',
    'schedule_status', v_class -> 'schedule_status',
    'is_work_day', coalesce((v_class ->> 'reason_code') = 'allowed', false)
      or (v_class ->> 'reason_code') = 'authorized_overtime'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- get_attendance_marking_state
-- ---------------------------------------------------------------------------
create or replace function public.get_attendance_marking_state(
  p_employee_id uuid,
  p_mark_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_mark_type text := coalesce(nullif(trim(p_mark_type), ''), 'entrada');
  v_ctx jsonb;
  v_schedule jsonb;
  v_class jsonb;
  v_labor_date date;
begin
  if lower(v_mark_type) = 'salida' then v_mark_type := 'salida_final'; end if;
  if lower(v_mark_type) = 'bano_inicio' then v_mark_type := 'salida_comida'; end if;
  if lower(v_mark_type) = 'bano_regreso' then v_mark_type := 'regreso_comida'; end if;

  v_ctx := public.resolve_attendance_context(p_employee_id, v_mark_type, now());
  v_labor_date := (v_ctx ->> 'labor_date')::date;
  v_schedule := public.can_employee_mark_attendance(p_employee_id, v_labor_date);
  v_class := public.classify_attendance_mark(p_employee_id, v_labor_date, v_mark_type, now());

  if coalesce((v_ctx ->> 'has_open_entry')::boolean, false) then
    if v_mark_type = 'entrada' then
      return jsonb_build_object(
        'allowed', false,
        'allowed_for_entrada', false,
        'allowed_for_completion', true,
        'reason', 'Ya existe una entrada activa para este colaborador.',
        'reason_code', 'open_entry',
        'classification', v_class -> 'classification',
        'approval_status', v_class -> 'approval_status',
        'system_reason', v_class -> 'system_reason',
        'schedule_exception_id', v_class -> 'schedule_exception_id',
        'labor_date', v_labor_date,
        'calendar_date', v_ctx -> 'calendar_date',
        'has_open_entry', true,
        'has_open_meal', coalesce((v_ctx ->> 'has_open_meal')::boolean, false),
        'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
        'schedule_id', v_schedule -> 'schedule_id',
        'schedule_status', v_schedule -> 'schedule_status',
        'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
      );
    end if;

    return jsonb_build_object(
      'allowed', true,
      'allowed_for_entrada', false,
      'allowed_for_completion', true,
      'reason', v_schedule -> 'reason',
      'reason_code', 'open_shift',
      'classification', v_class -> 'classification',
      'approval_status', v_class -> 'approval_status',
      'system_reason', v_class -> 'system_reason',
      'schedule_exception_id', v_class -> 'schedule_exception_id',
      'labor_date', v_labor_date,
      'calendar_date', v_ctx -> 'calendar_date',
      'has_open_entry', true,
      'has_open_meal', coalesce((v_ctx ->> 'has_open_meal')::boolean, false),
      'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
      'schedule_id', v_schedule -> 'schedule_id',
      'schedule_status', v_schedule -> 'schedule_status',
      'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, true)
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'allowed_for_entrada', true,
    'allowed_for_completion', false,
    'reason', v_schedule -> 'reason',
    'reason_code', v_schedule -> 'reason_code',
    'classification', v_class -> 'classification',
    'approval_status', v_class -> 'approval_status',
    'system_reason', v_class -> 'system_reason',
    'schedule_exception_id', v_class -> 'schedule_exception_id',
    'labor_date', v_labor_date,
    'calendar_date', v_ctx -> 'calendar_date',
    'has_open_entry', false,
    'has_open_meal', false,
    'overnight_shift', coalesce((v_ctx ->> 'overnight_shift')::boolean, false),
    'schedule_id', v_schedule -> 'schedule_id',
    'schedule_status', v_schedule -> 'schedule_status',
    'is_work_day', coalesce((v_schedule ->> 'is_work_day')::boolean, false)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- register_attendance_mark: always register, classify on insert
-- ---------------------------------------------------------------------------
create or replace function public.register_attendance_mark(
  p_employee_id uuid,
  p_pin text,
  p_mark_type text,
  p_photo_path text,
  p_device_id text,
  p_device_name text,
  p_observation text default null,
  p_client_ip text default null
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = '', extensions, public
as $$
declare
  employee public.profiles;
  credential public.attendance_credentials;
  mark public.attendance_marks;
  open_entry public.attendance_marks;
  open_meal public.attendance_marks;
  meal_minutes integer;
  unrecognized_device boolean;
  observation_text text := nullif(trim(p_observation), '');
  user_agent text;
  ctx jsonb;
  labor_date date;
  v_class jsonb;
begin
  perform public.assert_attendance_device_can_mark(
    p_device_id,
    p_employee_id,
    p_client_ip,
    null
  );

  if nullif(trim(p_photo_path), '') is null then
    raise exception 'Se requiere foto para registrar asistencia.';
  end if;
  if p_mark_type = 'salida' then p_mark_type := 'salida_final'; end if;
  if p_mark_type = 'bano_inicio' then p_mark_type := 'salida_comida'; end if;
  if p_mark_type = 'bano_regreso' then p_mark_type := 'regreso_comida'; end if;
  if p_mark_type not in ('entrada', 'salida_comida', 'regreso_comida', 'salida_final') then
    raise exception 'Tipo de marcaje no valido.';
  end if;

  select * into employee from public.profiles where id = p_employee_id and status = 'active';
  select * into credential from public.attendance_credentials where employee_id = p_employee_id;
  if employee.id is null or credential.employee_id is null
    or crypt(p_pin, credential.pin_hash) <> credential.pin_hash then
    raise exception 'PIN incorrecto o colaborador sin PIN configurado.';
  end if;

  ctx := public.resolve_attendance_context(p_employee_id, p_mark_type, now());
  labor_date := (ctx ->> 'labor_date')::date;
  v_class := public.classify_attendance_mark(p_employee_id, labor_date, p_mark_type, now());

  if coalesce((ctx ->> 'has_open_entry')::boolean, false) then
    select m.* into open_entry
    from public.attendance_marks m
    where m.id = (ctx ->> 'open_entry_id')::uuid;
  else
    open_entry := null;
  end if;

  if open_entry.id is not null then
    select m.* into open_meal
    from public.attendance_marks m
    where m.employee_id = employee.id
      and m.mark_type in ('salida_comida', 'bano_inicio')
      and m.marked_at > open_entry.marked_at
      and not exists (
        select 1 from public.attendance_marks back_mark
        where back_mark.employee_id = employee.id
          and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
          and back_mark.marked_at > m.marked_at
      )
    order by m.marked_at desc
    limit 1;
  end if;

  if p_mark_type = 'entrada' and open_entry.id is not null then
    raise exception 'Ya existe una entrada activa para este colaborador.';
  elsif p_mark_type = 'salida_comida' and open_entry.id is null then
    raise exception 'No existe entrada activa para registrar salida a comida.';
  elsif p_mark_type = 'salida_comida' and open_meal.id is not null then
    raise exception 'Ya existe una salida a comida pendiente de regreso.';
  elsif p_mark_type = 'regreso_comida' and open_meal.id is null then
    raise exception 'No existe salida a comida pendiente.';
  elsif p_mark_type = 'salida_final' and open_entry.id is null then
    raise exception 'No existe entrada activa para registrar salida final.';
  elsif p_mark_type = 'salida_final' and open_meal.id is not null then
    raise exception 'Registra el regreso de comida antes de la salida final.';
  end if;

  if p_mark_type = 'regreso_comida' then
    meal_minutes := greatest(0, floor(extract(epoch from (now() - open_meal.marked_at)) / 60)::integer);
  end if;

  unrecognized_device := employee.authorized_attendance_device is not null
    and employee.authorized_attendance_device <> p_device_id;

  insert into public.attendance_marks (
    employee_id, employee_name, mark_type, photo_path, device_id, device_name, device_alert,
    related_mark_id, duration_minutes, observation,
    labor_date, classification, approval_status, schedule_exception_id, system_reason
  )
  values (
    employee.id, coalesce(employee.full_name, employee.username, 'Colaborador'),
    p_mark_type, trim(p_photo_path), trim(p_device_id), trim(p_device_name), unrecognized_device,
    case when p_mark_type = 'regreso_comida' then open_meal.id else open_entry.id end,
    meal_minutes,
    observation_text,
    labor_date,
    v_class ->> 'classification',
    coalesce(v_class ->> 'approval_status', 'not_required'),
    nullif(v_class ->> 'schedule_exception_id', '')::uuid,
    v_class ->> 'system_reason'
  )
  returning * into mark;

  perform public.log_attendance_security_event(
    trim(p_device_id),
    employee.id,
    'authorized_mark_attempt',
    p_client_ip,
    user_agent,
    jsonb_build_object(
      'mark_type', p_mark_type,
      'mark_id', mark.id,
      'labor_date', labor_date,
      'calendar_date', ctx -> 'calendar_date',
      'classification', mark.classification,
      'approval_status', mark.approval_status
    )
  );

  return mark;
end;
$$;

grant execute on function public.register_attendance_mark(uuid, text, text, text, text, text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- get_attendance_terminal_marks
-- ---------------------------------------------------------------------------
drop function if exists public.get_attendance_terminal_marks();

create or replace function public.get_attendance_terminal_marks()
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  mark_type text,
  marked_at timestamptz,
  device_name text,
  device_alert boolean,
  related_mark_id uuid,
  duration_minutes integer,
  labor_date date,
  classification text,
  approval_status text,
  system_reason text,
  schedule_exception_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with open_overnight as (
    select distinct e.employee_id
    from public.attendance_marks e
    where e.mark_type = 'entrada'
      and not exists (
        select 1
        from public.attendance_marks out_mark
        where out_mark.employee_id = e.employee_id
          and out_mark.mark_type in ('salida_final', 'salida')
          and out_mark.marked_at > e.marked_at
      )
      and (e.marked_at at time zone 'America/Guatemala')::date
        < (now() at time zone 'America/Guatemala')::date
  ),
  window_start as (
    select case
      when exists (select 1 from open_overnight) then
        date_trunc(
          'day',
          (now() at time zone 'America/Guatemala')::date - 1
        ) at time zone 'America/Guatemala'
      else
        date_trunc('day', now() at time zone 'America/Guatemala') at time zone 'America/Guatemala'
    end as ts
  )
  select
    m.id,
    m.employee_id,
    m.employee_name,
    m.mark_type,
    m.marked_at,
    m.device_name,
    m.device_alert,
    m.related_mark_id,
    m.duration_minutes,
    m.labor_date,
    m.classification,
    m.approval_status,
    m.system_reason,
    m.schedule_exception_id
  from public.attendance_marks m
  cross join window_start w
  where m.marked_at >= date_trunc('day', now() at time zone 'America/Guatemala') at time zone 'America/Guatemala'
     or (
       m.employee_id in (select employee_id from open_overnight)
       and m.marked_at >= w.ts
     )
  order by m.marked_at desc;
$$;

revoke all on function public.get_attendance_terminal_marks() from public;
grant execute on function public.get_attendance_terminal_marks() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- HR review RPCs
-- ---------------------------------------------------------------------------
create or replace function public.can_view_attendance_reviews()
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
        'admin', 'gerente_general', 'recursos_humanos', 'rrhh', 'supervisor'
      )
  );
$$;

revoke all on function public.can_view_attendance_reviews() from public;
grant execute on function public.can_view_attendance_reviews() to authenticated;

create or replace function public.get_attendance_marks_for_review(
  p_status text default 'pending',
  p_from date default null,
  p_to date default null
)
returns table (
  id uuid,
  employee_id uuid,
  employee_name text,
  mark_type text,
  marked_at timestamptz,
  labor_date date,
  classification text,
  approval_status text,
  system_reason text,
  schedule_exception_id uuid,
  approved_by uuid,
  approved_at timestamptz,
  approval_notes text,
  approver_name text,
  observation text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id,
    m.employee_id,
    m.employee_name,
    m.mark_type,
    m.marked_at,
    coalesce(m.labor_date, (m.marked_at at time zone 'America/Guatemala')::date) as labor_date,
    m.classification,
    m.approval_status,
    m.system_reason,
    m.schedule_exception_id,
    m.approved_by,
    m.approved_at,
    m.approval_notes,
    coalesce(ap.full_name, ap.username, '') as approver_name,
    m.observation
  from public.attendance_marks m
  left join public.profiles ap on ap.id = m.approved_by
  where public.can_view_attendance_reviews()
    and m.mark_type = 'entrada'
    and (
      coalesce(nullif(trim(p_status), ''), 'pending') = 'all'
      or m.approval_status = coalesce(nullif(trim(p_status), ''), 'pending')
    )
    and (
      m.classification in (
        'no_schedule', 'rest_day_worked', 'out_of_schedule',
        'pending_overtime', 'authorized_overtime', 'manual_adjustment'
      )
      or m.approval_status in ('pending', 'approved', 'rejected')
    )
    and (p_from is null or coalesce(m.labor_date, (m.marked_at at time zone 'America/Guatemala')::date) >= p_from)
    and (p_to is null or coalesce(m.labor_date, (m.marked_at at time zone 'America/Guatemala')::date) <= p_to)
  order by m.marked_at desc;
$$;

revoke all on function public.get_attendance_marks_for_review(text, date, date) from public;
grant execute on function public.get_attendance_marks_for_review(text, date, date) to authenticated;

create or replace function public.review_attendance_mark(
  p_mark_id uuid,
  p_action text,
  p_notes text default null
)
returns public.attendance_marks
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.attendance_marks;
  next_status text;
  entry_mark public.attendance_marks;
begin
  if not public.is_attendance_manager() then
    raise exception 'No tienes permiso para revisar marcaciones.';
  end if;

  next_status := case lower(trim(coalesce(p_action, '')))
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    else null
  end;
  if next_status is null then
    raise exception 'Acción de revisión no válida.';
  end if;

  select * into target from public.attendance_marks where id = p_mark_id;
  if target.id is null then
    raise exception 'Marcación no encontrada.';
  end if;

  update public.attendance_marks
  set
    approval_status = next_status,
    approved_by = auth.uid(),
    approved_at = now(),
    approval_notes = nullif(trim(p_notes), '')
  where id = p_mark_id
  returning * into target;

  if target.mark_type = 'entrada' then
    update public.attendance_marks m
    set
      approval_status = next_status,
      approved_by = auth.uid(),
      approved_at = now(),
      approval_notes = coalesce(nullif(trim(p_notes), ''), m.approval_notes)
    where m.employee_id = target.employee_id
      and m.marked_at >= target.marked_at
      and m.approval_status = 'pending'
      and m.id <> target.id
      and not exists (
        select 1
        from public.attendance_marks out_mark
        where out_mark.employee_id = target.employee_id
          and out_mark.mark_type in ('salida_final', 'salida')
          and out_mark.marked_at > target.marked_at
          and out_mark.marked_at < m.marked_at
      );
  end if;

  return target;
end;
$$;

revoke all on function public.review_attendance_mark(uuid, text, text) from public;
grant execute on function public.review_attendance_mark(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Reports: separate pending vs approved extraordinary hours
-- ---------------------------------------------------------------------------
drop function if exists public.get_schedule_attendance_details(date);

create or replace function public.get_schedule_attendance_details(p_week_start date)
returns table (
  schedule_id uuid, employee_id uuid, employee_name text, role text, area text, shift_date date,
  shift_type text, is_work_day boolean, scheduled_start time, actual_start timestamptz,
  meal_out timestamptz, meal_back timestamptz, meal_minutes integer,
  scheduled_end time, actual_end timestamptz, scheduled_hours numeric, actual_hours numeric,
  late_minutes integer, early_departure_minutes integer, overtime_hours numeric,
  attendance_status text, observations text,
  pending_extra_hours numeric, approved_extra_hours numeric,
  entrance_classification text, entrance_approval_status text
)
language sql stable security definer set search_path = ''
as $$
  with schedule_rows as (
    select distinct on (s.id)
      s.*,
      p.full_name,
      p.username,
      p.role,
      case
        when s.is_work_day and s.start_time is not null then
          ((s.shift_date + s.start_time) at time zone 'America/Guatemala')
      end as shift_start_ts,
      case
        when s.is_work_day and s.end_time is not null then
          (
            (s.shift_date + case when s.end_time <= s.start_time then 1 else 0 end) + s.end_time
          ) at time zone 'America/Guatemala'
      end as shift_end_ts
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    where s.shift_date between p_week_start and p_week_start + 6
      and s.status in ('published', 'draft')
      and public.is_schedule_publisher()
    order by s.id, case s.status when 'published' then 0 else 1 end
  ),
  work_shifts as (
    select
      s.*,
      row_number() over (
        partition by s.employee_id, s.shift_date
        order by s.block_order, s.start_time nulls last, s.id
      )::integer as shift_rank
    from schedule_rows s
    where s.is_work_day
  ),
  day_entrances as (
    select
      m.id,
      m.employee_id,
      m.marked_at,
      m.observation,
      m.classification,
      m.approval_status,
      (m.marked_at at time zone 'America/Guatemala')::date as mark_date,
      row_number() over (
        partition by m.employee_id, (m.marked_at at time zone 'America/Guatemala')::date
        order by m.marked_at
      )::integer as entrance_rank
    from public.attendance_marks m
    where m.mark_type = 'entrada'
  ),
  entrance_assignments as (
    select
      ws.id as schedule_id,
      de.marked_at as entrance_marked_at,
      de.observation as entrance_observation,
      de.classification as entrance_classification,
      de.approval_status as entrance_approval_status
    from work_shifts ws
    left join day_entrances de
      on de.employee_id = ws.employee_id
      and de.mark_date = ws.shift_date
      and de.entrance_rank = ws.shift_rank
      and (
        ws.shift_start_ts is null
        or (
          de.marked_at >= ws.shift_start_ts - interval '2 hours'
          and de.marked_at <= coalesce(ws.shift_end_ts, ws.shift_start_ts) + interval '2 hours'
        )
      )
  ),
  exit_assignments as (
    select
      ws.id as schedule_id,
      exit_mark.marked_at as exit_marked_at,
      exit_mark.observation as exit_observation
    from work_shifts ws
    left join entrance_assignments ea on ea.schedule_id = ws.id
    left join lateral (
      select ea2.entrance_marked_at as next_entrance_at
      from work_shifts ws2
      join entrance_assignments ea2 on ea2.schedule_id = ws2.id
      where ws2.employee_id = ws.employee_id
        and ws2.shift_date = ws.shift_date
        and ws2.shift_rank = ws.shift_rank + 1
      limit 1
    ) next_shift on true
    left join lateral (
      select m.marked_at, m.observation
      from public.attendance_marks m
      where ea.entrance_marked_at is not null
        and m.employee_id = ws.employee_id
        and m.mark_type in ('salida_final', 'salida')
        and m.marked_at > ea.entrance_marked_at
        and (
          next_shift.next_entrance_at is null
          or m.marked_at < next_shift.next_entrance_at
        )
        and (
          ws.shift_end_ts is null
          or m.marked_at <= ws.shift_end_ts + interval '4 hours'
        )
      order by abs(extract(epoch from (m.marked_at - coalesce(ws.shift_end_ts, m.marked_at))))
      limit 1
    ) exit_mark on true
  ),
  computed as (
    select
      s.*,
      ea.entrance_marked_at,
      ea.entrance_observation,
      ea.entrance_classification,
      ea.entrance_approval_status,
      xa.exit_marked_at,
      xa.exit_observation,
      meal_out.marked_at as meal_out_marked_at,
      meal_back.marked_at as meal_back_marked_at,
      meal_back.duration_minutes as meal_back_duration_minutes,
      case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
        ea.entrance_marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer end as raw_late_minutes,
      public.get_attendance_late_grace_minutes() as grace_minutes,
      case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (xa.exit_marked_at - ea.entrance_marked_at)) / 3600, 0)
        - greatest(0, coalesce(extract(epoch from (meal_back.marked_at - meal_out.marked_at)) / 3600, 0)))::numeric(10,2) end as gross_work_hours
    from schedule_rows s
    left join entrance_assignments ea on ea.schedule_id = s.id
    left join exit_assignments xa on xa.schedule_id = s.id
    left join lateral (
      select m.*
      from public.attendance_marks m
      where s.is_work_day
        and ea.entrance_marked_at is not null
        and s.shift_start_ts is not null
        and s.shift_end_ts is not null
        and m.employee_id = s.employee_id
        and m.mark_type in ('salida_comida', 'bano_inicio')
        and m.marked_at > ea.entrance_marked_at
        and (xa.exit_marked_at is null or m.marked_at < xa.exit_marked_at)
        and m.marked_at >= s.shift_start_ts - interval '2 hours'
        and m.marked_at <= s.shift_end_ts + interval '2 hours'
      order by m.marked_at
      limit 1
    ) meal_out on true
    left join lateral (
      select m.*
      from public.attendance_marks m
      where s.is_work_day
        and meal_out.marked_at is not null
        and s.shift_start_ts is not null
        and s.shift_end_ts is not null
        and m.employee_id = s.employee_id
        and m.mark_type in ('regreso_comida', 'bano_regreso')
        and m.marked_at > meal_out.marked_at
        and (xa.exit_marked_at is null or m.marked_at < xa.exit_marked_at)
        and m.marked_at >= s.shift_start_ts - interval '2 hours'
        and m.marked_at <= s.shift_end_ts + interval '2 hours'
      order by m.marked_at
      limit 1
    ) meal_back on true
  )
  select
    c.id,
    c.employee_id,
    coalesce(c.full_name, c.username, 'Colaborador'),
    c.role,
    c.area,
    c.shift_date,
    coalesce(c.shift_type_id::text, c.shift_type),
    c.is_work_day,
    c.start_time,
    c.entrance_marked_at,
    c.meal_out_marked_at,
    c.meal_back_marked_at,
    greatest(0, coalesce(extract(epoch from (c.meal_back_marked_at - c.meal_out_marked_at)) / 60, c.meal_back_duration_minutes, 0))::integer,
    c.end_time,
    c.exit_marked_at,
    case when not c.is_work_day then 0 else greatest(0, extract(epoch from (
      (c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
      - (c.shift_date + c.start_time)
    )) / 3600 - c.break_minutes / 60.0)::numeric(10,2) end,
    case
      when not c.is_work_day then 0
      when c.entrance_marked_at is null then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then 0
      when coalesce(c.entrance_approval_status, 'not_required') = 'rejected' then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'approved' then 0
      else c.gross_work_hours
    end,
    case
      when not c.is_work_day then 0
      when c.entrance_marked_at is null then 0
      when c.raw_late_minutes <= c.grace_minutes then 0
      else c.raw_late_minutes
    end,
    case when not c.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
      (c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
      - (c.exit_marked_at at time zone 'America/Guatemala')
    )) / 60, 0))::integer end,
    case
      when not c.is_work_day then 0
      when c.exit_marked_at is null then 0
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime') then 0
      else (
        greatest(0, extract(epoch from (
          (c.exit_marked_at at time zone 'America/Guatemala') -
          ((c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
            + case when c.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
        )) / 3600)
      )::numeric(10,2)
    end,
    case
      when c.shift_type = 'asueto' then 'asueto'
      when not c.is_work_day or c.shift_type = 'rest' then 'descanso'
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then 'extra_pendiente'
      when c.entrance_classification = 'authorized_overtime'
        and coalesce(c.entrance_approval_status, 'approved') = 'approved' then 'horas_extra'
      when c.entrance_approval_status = 'rejected' then 'extra_rechazada'
      when c.shift_date > (now() at time zone 'America/Guatemala')::date then 'pendiente'
      when c.shift_date < (now() at time zone 'America/Guatemala')::date and c.entrance_marked_at is null then 'falta'
      when c.entrance_marked_at is not null and c.raw_late_minutes > c.grace_minutes then 'tarde'
      when c.entrance_marked_at is null or c.exit_marked_at is null then 'incompleto'
      when greatest(0, coalesce(extract(epoch from (
        (c.exit_marked_at at time zone 'America/Guatemala') -
        ((c.shift_date + c.end_time + case when c.end_time <= c.start_time then interval '1 day' else interval '0 day' end)
          + case when c.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
      )) / 60, 0)) > 0 then 'horas_extra'
      else 'completo'
    end,
    nullif(
      concat_ws(
        ' / ',
        public.sanitize_attendance_observation(c.day_notes),
        public.sanitize_attendance_observation(c.notes),
        public.sanitize_attendance_observation(c.entrance_observation),
        public.sanitize_attendance_observation(c.exit_observation)
      ),
      ''
    ),
    case
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'pending' then c.gross_work_hours
      else 0
    end,
    case
      when c.entrance_classification in ('no_schedule', 'rest_day_worked', 'out_of_schedule', 'pending_overtime', 'authorized_overtime')
        and coalesce(c.entrance_approval_status, 'pending') = 'approved' then c.gross_work_hours
      else 0
    end,
    c.entrance_classification,
    c.entrance_approval_status
  from computed c
  order by c.shift_date, c.block_order, c.start_time nulls last, c.full_name;
$$;

revoke all on function public.get_schedule_attendance_details(date) from public;
grant execute on function public.get_schedule_attendance_details(date) to authenticated;
