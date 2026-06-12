-- Require assigned schedule (draft or published) before attendance marks.
-- Apply after 073_fix_late_attendance_sql_editor_probe.sql.

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
  v_work_schedule record;
  v_any_schedule boolean;
  v_rest_only boolean;
begin
  select exists (
    select 1
    from public.employee_schedules s
    where s.employee_id = p_employee_id
      and s.shift_date = p_date
      and s.status in ('draft', 'published')
  ) into v_any_schedule;

  if not v_any_schedule then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Horario no asignado. Comunícate con Recursos Humanos antes de registrar tu asistencia.',
      'reason_code', 'no_schedule',
      'schedule_id', null,
      'schedule_status', null,
      'is_work_day', false
    );
  end if;

  select
    s.id,
    s.status,
    s.is_work_day
  into v_work_schedule
  from public.employee_schedules s
  left join public.shift_types st on st.id = s.shift_type_id
  where s.employee_id = p_employee_id
    and s.shift_date = p_date
    and s.status in ('draft', 'published')
    and s.is_work_day = true
    and coalesce(st.is_rest_day, false) = false
    and coalesce(st.is_holiday, false) = false
    and coalesce(s.shift_type, '') not in ('rest', 'asueto')
  order by case s.status when 'published' then 0 else 1 end, s.block_order, s.start_time
  limit 1;

  if v_work_schedule.id is not null then
    return jsonb_build_object(
      'allowed', true,
      'reason', null,
      'reason_code', 'allowed',
      'schedule_id', v_work_schedule.id,
      'schedule_status', v_work_schedule.status,
      'is_work_day', v_work_schedule.is_work_day
    );
  end if;

  select not exists (
    select 1
    from public.employee_schedules s
    left join public.shift_types st on st.id = s.shift_type_id
    where s.employee_id = p_employee_id
      and s.shift_date = p_date
      and s.status in ('draft', 'published')
      and (
        s.is_work_day = true
        and coalesce(st.is_rest_day, false) = false
        and coalesce(st.is_holiday, false) = false
        and coalesce(s.shift_type, '') not in ('rest', 'asueto')
      )
  ) into v_rest_only;

  if v_rest_only then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'Hoy tienes descanso programado. Comunícate con Recursos Humanos si necesitas registrar asistencia extraordinaria.',
      'reason_code', 'rest_day',
      'schedule_id', null,
      'schedule_status', null,
      'is_work_day', false
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'reason', 'Horario no asignado. Comunícate con Recursos Humanos antes de registrar tu asistencia.',
    'reason_code', 'no_schedule',
    'schedule_id', null,
    'schedule_status', null,
    'is_work_day', false
  );
end;
$$;

revoke all on function public.can_employee_mark_attendance(uuid, date) from public;
grant execute on function public.can_employee_mark_attendance(uuid, date) to authenticated, anon;

drop function if exists public.register_attendance_mark(uuid, text, text, text, text, text, text, text);

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
  schedule_check jsonb;
  mark_date date := (now() at time zone 'America/Guatemala')::date;
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

  schedule_check := public.can_employee_mark_attendance(p_employee_id, mark_date);
  if coalesce((schedule_check ->> 'allowed')::boolean, false) = false then
    raise exception '%', coalesce(
      schedule_check ->> 'reason',
      'Horario no asignado. Comunícate con Recursos Humanos antes de registrar tu asistencia.'
    );
  end if;

  select m.* into open_entry
  from public.attendance_marks m
  where m.employee_id = employee.id
    and m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = mark_date
    and not exists (
      select 1 from public.attendance_marks out_mark
      where out_mark.employee_id = employee.id
        and out_mark.mark_type in ('salida_final', 'salida')
        and out_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

  select m.* into open_meal
  from public.attendance_marks m
  where m.employee_id = employee.id
    and m.mark_type in ('salida_comida', 'bano_inicio')
    and (m.marked_at at time zone 'America/Guatemala')::date = mark_date
    and not exists (
      select 1 from public.attendance_marks back_mark
      where back_mark.employee_id = employee.id
        and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
        and back_mark.marked_at > m.marked_at
    )
  order by m.marked_at desc
  limit 1;

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
    jsonb_build_object('mark_type', p_mark_type, 'mark_id', mark.id)
  );

  return mark;
end;
$$;

grant execute on function public.register_attendance_mark(uuid, text, text, text, text, text, text, text) to authenticated, anon;
