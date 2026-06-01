-- Professional HR schedules, split shifts, meal marks and attendance reports.
-- Apply after 023_public_attendance_kiosk.sql.
-- PIN functions are intentionally untouched.

alter table public.employee_schedules
  add column if not exists is_work_day boolean not null default true,
  add column if not exists shift_type text not null default 'full',
  add column if not exists block_order integer not null default 1,
  add column if not exists day_notes text;

alter table public.employee_schedules
  drop constraint if exists employee_schedules_shift_type_check;

alter table public.employee_schedules
  add constraint employee_schedules_shift_type_check
  check (shift_type in ('full', 'half', 'rest'));

alter table public.employee_schedules
  alter column area drop not null,
  alter column start_time drop not null,
  alter column end_time drop not null;

alter table public.employee_schedules
  drop constraint if exists employee_schedules_work_day_time_check;

alter table public.employee_schedules
  add constraint employee_schedules_work_day_time_check
  check (
    (is_work_day = false and shift_type = 'rest')
    or (is_work_day = true and start_time is not null and end_time is not null and nullif(trim(coalesce(area, '')), '') is not null)
  );

create index if not exists employee_schedules_day_blocks_idx
  on public.employee_schedules (employee_id, shift_date, block_order);

alter table public.attendance_marks
  add column if not exists observation text;

alter table public.attendance_marks
  drop constraint if exists attendance_marks_mark_type_check;

alter table public.attendance_marks
  add constraint attendance_marks_mark_type_check
  check (mark_type in ('entrada', 'salida_comida', 'regreso_comida', 'salida_final', 'salida', 'bano_inicio', 'bano_regreso'));

create or replace function public.save_employee_schedule(p_data jsonb)
returns public.employee_schedules
language plpgsql security definer set search_path = ''
as $$
declare
  existing public.employee_schedules;
  saved public.employee_schedules;
  schedule_id uuid;
  v_employee_id uuid := (p_data ->> 'employee_id')::uuid;
  v_is_work_day boolean := coalesce((p_data ->> 'is_work_day')::boolean, true);
  v_shift_type text := coalesce(nullif(p_data ->> 'shift_type', ''), case when coalesce((p_data ->> 'is_work_day')::boolean, true) then 'full' else 'rest' end);
begin
  if not public.is_schedule_editor() then
    raise exception 'No tienes permiso para editar horarios.';
  end if;
  if v_employee_id is null then
    raise exception 'Colaborador es obligatorio.';
  end if;
  if v_shift_type not in ('full', 'half', 'rest') then
    raise exception 'Tipo de turno invalido.';
  end if;
  if v_shift_type = 'rest' then
    v_is_work_day := false;
  end if;
  if v_is_work_day and (
    nullif(trim(p_data ->> 'area'), '') is null
    or nullif(p_data ->> 'start_time', '') is null
    or nullif(p_data ->> 'end_time', '') is null
  ) then
    raise exception 'Area, entrada y salida son obligatorios para dias laborales.';
  end if;

  schedule_id := nullif(p_data ->> 'id', '')::uuid;
  if schedule_id is not null then
    select * into existing from public.employee_schedules where id = schedule_id;
    if existing.id is null then raise exception 'Turno no encontrado.'; end if;
    if existing.status = 'published' and not public.is_schedule_publisher() then
      raise exception 'Solo Admin, Gerente General o RRHH pueden editar un horario publicado.';
    end if;
    update public.employee_schedules set
      employee_id = v_employee_id,
      area = case when v_is_work_day then trim(p_data ->> 'area') else coalesce(nullif(trim(p_data ->> 'area'), ''), 'Descanso') end,
      position = nullif(trim(p_data ->> 'position'), ''),
      shift_date = (p_data ->> 'shift_date')::date,
      start_time = case when v_is_work_day then (p_data ->> 'start_time')::time else null end,
      end_time = case when v_is_work_day then (p_data ->> 'end_time')::time else null end,
      break_minutes = case when v_is_work_day then greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)) else 0 end,
      notes = nullif(trim(p_data ->> 'notes'), ''),
      day_notes = nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), ''),
      is_work_day = v_is_work_day,
      shift_type = v_shift_type,
      block_order = greatest(1, coalesce((p_data ->> 'block_order')::integer, 1)),
      updated_by = auth.uid(),
      updated_at = now()
    where id = schedule_id returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, old_value, new_value)
    values (saved.id, auth.uid(), 'updated', to_jsonb(existing), to_jsonb(saved));
  else
    insert into public.employee_schedules (
      employee_id, area, position, shift_date, start_time, end_time, break_minutes, notes,
      status, created_by, updated_by, is_work_day, shift_type, block_order, day_notes
    ) values (
      v_employee_id,
      case when v_is_work_day then trim(p_data ->> 'area') else coalesce(nullif(trim(p_data ->> 'area'), ''), 'Descanso') end,
      nullif(trim(p_data ->> 'position'), ''),
      (p_data ->> 'shift_date')::date,
      case when v_is_work_day then (p_data ->> 'start_time')::time else null end,
      case when v_is_work_day then (p_data ->> 'end_time')::time else null end,
      case when v_is_work_day then greatest(0, coalesce((p_data ->> 'break_minutes')::integer, 0)) else 0 end,
      nullif(trim(p_data ->> 'notes'), ''),
      'draft', auth.uid(), auth.uid(), v_is_work_day, v_shift_type,
      greatest(1, coalesce((p_data ->> 'block_order')::integer, 1)),
      nullif(trim(coalesce(p_data ->> 'day_notes', p_data ->> 'notes')), '')
    ) returning * into saved;
    insert into public.schedule_change_logs (schedule_id, changed_by, change_type, new_value)
    values (saved.id, auth.uid(), 'created', to_jsonb(saved));
  end if;
  return saved;
end;
$$;

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
  select
    m.id, m.employee_id, m.employee_name, m.mark_type, m.marked_at,
    m.device_name, m.device_alert, m.related_mark_id, m.duration_minutes
  from public.attendance_marks m
  where m.marked_at >= date_trunc('day', now() at time zone 'America/Guatemala') at time zone 'America/Guatemala'
  order by m.marked_at desc;
$$;

drop function if exists public.register_attendance_mark(uuid,text,text,text,text,text);
drop function if exists public.register_attendance_mark(uuid,text,text,text,text,text,text);

create or replace function public.register_attendance_mark(
  p_employee_id uuid,
  p_pin text,
  p_mark_type text,
  p_photo_path text,
  p_device_id text,
  p_device_name text,
  p_observation text default null
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
begin
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

  select m.* into open_entry
  from public.attendance_marks m
  where m.employee_id = employee.id
    and m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = (now() at time zone 'America/Guatemala')::date
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
    and (m.marked_at at time zone 'America/Guatemala')::date = (now() at time zone 'America/Guatemala')::date
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
    nullif(trim(p_observation), '')
  )
  returning * into mark;

  return mark;
end;
$$;

drop function if exists public.get_schedule_attendance_details(date);

create or replace function public.get_schedule_attendance_details(p_week_start date)
returns table (
  schedule_id uuid, employee_id uuid, employee_name text, role text, area text, shift_date date,
  shift_type text, is_work_day boolean, scheduled_start time, actual_start timestamptz,
  meal_out timestamptz, meal_back timestamptz, meal_minutes integer,
  scheduled_end time, actual_end timestamptz, scheduled_hours numeric, actual_hours numeric,
  late_minutes integer, early_departure_minutes integer, overtime_hours numeric,
  attendance_status text, observations text
)
language sql stable security definer set search_path = ''
as $$
  with schedule_rows as (
    select s.*, p.full_name, p.username, p.role
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    where s.shift_date between p_week_start and p_week_start + 6
      and s.status = 'published'
      and public.is_schedule_publisher()
  )
  select
    s.id,
    s.employee_id,
    coalesce(s.full_name, s.username, 'Colaborador'),
    s.role,
    s.area,
    s.shift_date,
    s.shift_type,
    s.is_work_day,
    s.start_time,
    entrance.marked_at,
    meal_out.marked_at,
    meal_back.marked_at,
    greatest(0, coalesce(extract(epoch from (meal_back.marked_at - meal_out.marked_at)) / 60, meal_back.duration_minutes, 0))::integer,
    s.end_time,
    exit_mark.marked_at,
    case when not s.is_work_day then 0 else greatest(0, extract(epoch from (
      (s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
      - (s.shift_date + s.start_time)
    )) / 3600 - s.break_minutes / 60.0)::numeric(10,2) end,
    greatest(0, coalesce(extract(epoch from (exit_mark.marked_at - entrance.marked_at)) / 3600, 0)
      - greatest(0, coalesce(extract(epoch from (meal_back.marked_at - meal_out.marked_at)) / 3600, 0)))::numeric(10,2),
    greatest(0, coalesce(extract(epoch from (
      entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
    )) / 60, 0))::integer,
    greatest(0, coalesce(extract(epoch from (
      (s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
      - (exit_mark.marked_at at time zone 'America/Guatemala')
    )) / 60, 0))::integer,
    case
      when not s.is_work_day then 0
      when exit_mark.marked_at is null then 0
      else (
        greatest(0, extract(epoch from (
          (exit_mark.marked_at at time zone 'America/Guatemala') -
          ((s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
            + case when s.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
        )) / 3600)
      )::numeric(10,2)
    end,
    case
      when not s.is_work_day or s.shift_type = 'rest' then 'descanso'
      when s.shift_type = 'half' and entrance.marked_at is not null and exit_mark.marked_at is not null then 'medio_turno'
      when s.shift_date < (now() at time zone 'America/Guatemala')::date and entrance.marked_at is null then 'falta'
      when entrance.marked_at is null or exit_mark.marked_at is null then 'incompleto'
      when greatest(0, coalesce(extract(epoch from (
        (exit_mark.marked_at at time zone 'America/Guatemala') -
        ((s.shift_date + s.end_time + case when s.end_time < s.start_time then interval '1 day' else interval '0 day' end)
          + case when s.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
      )) / 60, 0)) > 0 then 'horas_extra'
      when greatest(0, coalesce(extract(epoch from (
        entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0)) > 0 then 'tarde'
      else 'completo'
    end,
    concat_ws(' / ', nullif(s.day_notes, ''), nullif(s.notes, ''), nullif(entrance.observation, ''), nullif(exit_mark.observation, ''))
  from schedule_rows s
  left join lateral (
    select m.* from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type = 'entrada'
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
    order by m.marked_at limit 1
  ) entrance on true
  left join lateral (
    select m.* from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type in ('salida_comida', 'bano_inicio')
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      and (entrance.marked_at is null or m.marked_at > entrance.marked_at)
    order by m.marked_at limit 1
  ) meal_out on true
  left join lateral (
    select m.* from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type in ('regreso_comida', 'bano_regreso')
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      and meal_out.marked_at is not null and m.marked_at > meal_out.marked_at
    order by m.marked_at limit 1
  ) meal_back on true
  left join lateral (
    select m.* from public.attendance_marks m
    where m.employee_id = s.employee_id and m.mark_type in ('salida_final', 'salida')
      and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      and (entrance.marked_at is null or m.marked_at > entrance.marked_at)
    order by m.marked_at desc limit 1
  ) exit_mark on true
  order by s.shift_date, s.block_order, s.full_name;
$$;

create or replace function public.get_schedule_attendance_summary(p_week_start date)
returns table (
  employee_id uuid, employee_name text, area text, scheduled_hours numeric, actual_hours numeric,
  regular_hours numeric, overtime_hours numeric, late_minutes integer, absences integer,
  estimated_pay numeric, payroll_status text
)
language sql stable security definer set search_path = ''
as $$
  with details as (
    select * from public.get_schedule_attendance_details(p_week_start)
  )
  select
    p.id,
    coalesce(p.full_name, p.username, 'Colaborador'),
    max(d.area),
    coalesce(sum(d.scheduled_hours), 0)::numeric(10,2),
    coalesce(sum(d.actual_hours), 0)::numeric(10,2),
    least(coalesce(sum(d.actual_hours), 0), coalesce(sum(d.scheduled_hours), 0))::numeric(10,2),
    coalesce(sum(d.overtime_hours), 0)::numeric(10,2),
    coalesce(sum(d.late_minutes), 0)::integer,
    coalesce(sum(case when d.attendance_status = 'falta' then 1 else 0 end), 0)::integer,
    (coalesce(sum(d.actual_hours), 0) * coalesce(p.hourly_rate, 0))::numeric(12,2),
    coalesce(ps.status, 'pending')
  from details d
  join public.profiles p on p.id = d.employee_id
  left join public.payroll_summaries ps on ps.employee_id = p.id and ps.week_start = p_week_start
  group by p.id, p.full_name, p.username, p.hourly_rate, ps.status;
$$;

revoke all on function public.register_attendance_mark(uuid,text,text,text,text,text,text), public.get_schedule_attendance_details(date), public.get_schedule_attendance_summary(date) from public;
grant execute on function public.register_attendance_mark(uuid,text,text,text,text,text,text), public.get_schedule_attendance_details(date), public.get_schedule_attendance_summary(date) to authenticated;
grant execute on function public.register_attendance_mark(uuid,text,text,text,text,text,text) to anon;
