-- Attendance labor date: unify terminal marking with overnight shifts and open entries.
-- Apply after 105_area_inventory_indexes.sql.
-- Does not change RLS, payroll RPCs, or get_schedule_attendance_details (reports).

-- ---------------------------------------------------------------------------
-- resolve_attendance_context: labor date + open shift detection
-- ---------------------------------------------------------------------------
create or replace function public.resolve_attendance_context(
  p_employee_id uuid,
  p_mark_type text default 'entrada',
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
  v_mark_type text;
  v_calendar_date date;
  v_labor_date date;
  v_open_entry public.attendance_marks;
  v_open_meal public.attendance_marks;
  v_overnight record;
  v_shift_end_ts timestamptz;
  v_schedule_check jsonb;
  v_overnight_active boolean := false;
begin
  v_mark_type := lower(trim(coalesce(p_mark_type, 'entrada')));
  if v_mark_type = 'salida' then v_mark_type := 'salida_final'; end if;
  if v_mark_type = 'bano_inicio' then v_mark_type := 'salida_comida'; end if;
  if v_mark_type = 'bano_regreso' then v_mark_type := 'regreso_comida'; end if;

  v_calendar_date := (p_at at time zone v_tz)::date;

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
    v_labor_date := (v_open_entry.marked_at at time zone v_tz)::date;

    select m.* into v_open_meal
    from public.attendance_marks m
    where m.employee_id = p_employee_id
      and m.mark_type in ('salida_comida', 'bano_inicio')
      and m.marked_at > v_open_entry.marked_at
      and not exists (
        select 1
        from public.attendance_marks back_mark
        where back_mark.employee_id = m.employee_id
          and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
          and back_mark.marked_at > m.marked_at
      )
    order by m.marked_at desc
    limit 1;

    return jsonb_build_object(
      'labor_date', v_labor_date,
      'calendar_date', v_calendar_date,
      'has_open_entry', true,
      'open_entry_id', v_open_entry.id,
      'open_entry_marked_at', v_open_entry.marked_at,
      'has_open_meal', v_open_meal.id is not null,
      'open_meal_id', v_open_meal.id,
      'schedule_check_required', v_mark_type = 'entrada',
      'overnight_shift', v_labor_date < v_calendar_date,
      'mark_type', v_mark_type
    );
  end if;

  v_labor_date := v_calendar_date;
  v_schedule_check := public.can_employee_mark_attendance(p_employee_id, v_labor_date);

  if coalesce((v_schedule_check ->> 'allowed')::boolean, false) = false
     and v_mark_type = 'entrada' then
    select
      s.id,
      s.shift_date,
      s.start_time,
      s.end_time
    into v_overnight
    from public.employee_schedules s
    left join public.shift_types st on st.id = s.shift_type_id
    where s.employee_id = p_employee_id
      and s.shift_date = v_calendar_date - 1
      and s.status in ('draft', 'published')
      and s.is_work_day = true
      and s.start_time is not null
      and s.end_time is not null
      and s.end_time <= s.start_time
      and coalesce(st.is_rest_day, false) = false
      and coalesce(st.is_holiday, false) = false
      and coalesce(s.shift_type, '') not in ('rest', 'asueto')
    order by case s.status when 'published' then 0 else 1 end, s.block_order, s.start_time
    limit 1;

    if v_overnight.id is not null then
      v_shift_end_ts := (
        (v_overnight.shift_date + interval '1 day') + v_overnight.end_time
      ) at time zone v_tz;

      if p_at <= v_shift_end_ts + interval '4 hours' then
        v_labor_date := v_overnight.shift_date;
        v_overnight_active := true;
        v_schedule_check := public.can_employee_mark_attendance(p_employee_id, v_labor_date);
      end if;
    end if;
  end if;

  return jsonb_build_object(
    'labor_date', v_labor_date,
    'calendar_date', v_calendar_date,
    'has_open_entry', false,
    'open_entry_id', null,
    'open_entry_marked_at', null,
    'has_open_meal', false,
    'open_meal_id', null,
    'schedule_check_required', true,
    'overnight_shift', v_overnight_active,
    'mark_type', v_mark_type,
    'schedule_allowed', coalesce((v_schedule_check ->> 'allowed')::boolean, false),
    'schedule_id', v_schedule_check -> 'schedule_id',
    'schedule_status', v_schedule_check -> 'schedule_status',
    'schedule_reason_code', v_schedule_check -> 'reason_code'
  );
end;
$$;

revoke all on function public.resolve_attendance_context(uuid, text, timestamptz) from public;
grant execute on function public.resolve_attendance_context(uuid, text, timestamptz) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- get_attendance_marking_state: terminal UI validation
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
  v_labor_date date;
begin
  if lower(v_mark_type) = 'salida' then v_mark_type := 'salida_final'; end if;
  if lower(v_mark_type) = 'bano_inicio' then v_mark_type := 'salida_comida'; end if;
  if lower(v_mark_type) = 'bano_regreso' then v_mark_type := 'regreso_comida'; end if;

  v_ctx := public.resolve_attendance_context(p_employee_id, v_mark_type, now());
  v_labor_date := (v_ctx ->> 'labor_date')::date;
  v_schedule := public.can_employee_mark_attendance(p_employee_id, v_labor_date);

  if coalesce((v_ctx ->> 'has_open_entry')::boolean, false) then
    if v_mark_type = 'entrada' then
      return jsonb_build_object(
        'allowed', false,
        'allowed_for_entrada', false,
        'allowed_for_completion', true,
        'reason', 'Ya existe una entrada activa para este colaborador.',
        'reason_code', 'open_entry',
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
      'reason', null,
      'reason_code', 'open_shift',
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
    'allowed', coalesce((v_schedule ->> 'allowed')::boolean, false),
    'allowed_for_entrada', coalesce((v_schedule ->> 'allowed')::boolean, false),
    'allowed_for_completion', false,
    'reason', v_schedule -> 'reason',
    'reason_code', v_schedule -> 'reason_code',
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

revoke all on function public.get_attendance_marking_state(uuid, text) from public;
grant execute on function public.get_attendance_marking_state(uuid, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- get_attendance_terminal_marks: include yesterday when open overnight shift
-- ---------------------------------------------------------------------------
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
  duration_minutes integer
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
    m.duration_minutes
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
-- register_attendance_mark: labor date + bypass schedule on open shift close
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
  schedule_check jsonb;
  labor_date date;
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

  if coalesce((ctx ->> 'schedule_check_required')::boolean, true) then
    schedule_check := public.can_employee_mark_attendance(p_employee_id, labor_date);
    if coalesce((schedule_check ->> 'allowed')::boolean, false) = false then
      raise exception '%', coalesce(
        schedule_check ->> 'reason',
        'Horario no asignado. Comunícate con Recursos Humanos antes de registrar tu asistencia.'
      );
    end if;
  end if;

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
    related_mark_id, duration_minutes, observation
  )
  values (
    employee.id, coalesce(employee.full_name, employee.username, 'Colaborador'),
    p_mark_type, trim(p_photo_path), trim(p_device_id), trim(p_device_name), unrecognized_device,
    case when p_mark_type = 'regreso_comida' then open_meal.id else open_entry.id end,
    meal_minutes,
    observation_text
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
      'calendar_date', ctx -> 'calendar_date'
    )
  );

  return mark;
end;
$$;

grant execute on function public.register_attendance_mark(uuid, text, text, text, text, text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Manual test cases (Supabase SQL Editor + terminal /kiosk)
-- ---------------------------------------------------------------------------
-- 1) Turno normal (07:00-15:00 mismo día)
--    - can_employee_mark_attendance(emp, today) -> allowed
--    - resolve_attendance_context(emp, 'entrada') -> labor_date = today
--    - Flujo entrada -> comida -> regreso -> salida_final sin cambios vs antes
--
-- 2) Turno cruza medianoche (22:00-00:30 shift_date=D)
--    - Entrada D 22:05: labor_date=D, allowed
--    - Salida D+1 00:15: has_open_entry=true, schedule_check_required=false
--    - get_attendance_terminal_marks incluye marcas de D para ese empleado
--
-- 3) Descanso cambiado el mismo día (después de entrada abierta)
--    - HR cambia hoy a descanso; get_attendance_marking_state(..., 'salida_final')
--      -> allowed_for_completion=true (no bloqueo por descanso)
--
-- 4) Salida después de 00:00
--    - register_attendance_mark(..., 'salida_final') con entrada abierta ayer -> OK
--
-- 5) Comida pendiente después de medianoche
--    - salida_comida D 23:00, regreso_comida D+1 00:10 -> open_meal sin filtro calendario
--    - salida_final D+1 00:20 -> OK tras regreso
