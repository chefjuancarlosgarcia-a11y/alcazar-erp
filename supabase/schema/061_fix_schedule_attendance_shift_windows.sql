-- Fix attendance report: associate marks to each published shift window instead of whole day.
-- Apply after 060_add_due_at_to_assigned_tasks.sql.

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
    select
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
      (s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0 day' end)
      - (s.shift_date + s.start_time)
    )) / 3600 - s.break_minutes / 60.0)::numeric(10,2) end,
    case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (exit_mark.marked_at - entrance.marked_at)) / 3600, 0)
      - greatest(0, coalesce(extract(epoch from (meal_back.marked_at - meal_out.marked_at)) / 3600, 0)))::numeric(10,2) end,
    case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
      entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
    )) / 60, 0))::integer end,
    case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
      (s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0 day' end)
      - (exit_mark.marked_at at time zone 'America/Guatemala')
    )) / 60, 0))::integer end,
    case
      when not s.is_work_day then 0
      when exit_mark.marked_at is null then 0
      else (
        greatest(0, extract(epoch from (
          (exit_mark.marked_at at time zone 'America/Guatemala') -
          ((s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0 day' end)
            + case when s.start_time < time '12:00' then interval '20 minutes' else interval '30 minutes' end)
        )) / 3600)
      )::numeric(10,2)
    end,
    case
      when s.shift_type = 'asueto' then 'asueto'
      when not s.is_work_day or s.shift_type = 'rest' then 'descanso'
      when s.shift_type = 'half' and entrance.marked_at is not null and exit_mark.marked_at is not null then 'medio_turno'
      when s.shift_date < (now() at time zone 'America/Guatemala')::date and entrance.marked_at is null then 'falta'
      when entrance.marked_at is null or exit_mark.marked_at is null then 'incompleto'
      when greatest(0, coalesce(extract(epoch from (
        (exit_mark.marked_at at time zone 'America/Guatemala') -
        ((s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0 day' end)
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
    select m.*
    from public.attendance_marks m
    where s.shift_start_ts is not null
      and s.shift_end_ts is not null
      and m.employee_id = s.employee_id
      and m.mark_type = 'entrada'
      and m.marked_at >= s.shift_start_ts - interval '2 hours'
      and m.marked_at <= s.shift_end_ts + interval '2 hours'
    order by abs(extract(epoch from (m.marked_at - s.shift_start_ts)))
    limit 1
  ) entrance on true
  left join lateral (
    select m.*
    from public.attendance_marks m
    where s.shift_start_ts is not null
      and s.shift_end_ts is not null
      and m.employee_id = s.employee_id
      and m.mark_type in ('salida_comida', 'bano_inicio')
      and m.marked_at >= s.shift_start_ts - interval '2 hours'
      and m.marked_at <= s.shift_end_ts + interval '2 hours'
      and entrance.marked_at is not null
      and m.marked_at > entrance.marked_at
    order by m.marked_at
    limit 1
  ) meal_out on true
  left join lateral (
    select m.*
    from public.attendance_marks m
    where s.shift_start_ts is not null
      and s.shift_end_ts is not null
      and m.employee_id = s.employee_id
      and m.mark_type in ('regreso_comida', 'bano_regreso')
      and m.marked_at >= s.shift_start_ts - interval '2 hours'
      and m.marked_at <= s.shift_end_ts + interval '2 hours'
      and meal_out.marked_at is not null
      and m.marked_at > meal_out.marked_at
    order by m.marked_at
    limit 1
  ) meal_back on true
  left join lateral (
    select m.*
    from public.attendance_marks m
    where s.shift_start_ts is not null
      and s.shift_end_ts is not null
      and m.employee_id = s.employee_id
      and m.mark_type in ('salida_final', 'salida')
      and m.marked_at >= s.shift_start_ts - interval '2 hours'
      and m.marked_at <= s.shift_end_ts + interval '2 hours'
      and (entrance.marked_at is null or m.marked_at > entrance.marked_at)
    order by abs(extract(epoch from (m.marked_at - s.shift_end_ts)))
    limit 1
  ) exit_mark on true
  order by s.shift_date, s.block_order, s.full_name;
$$;

revoke all on function public.get_schedule_attendance_details(date) from public;
grant execute on function public.get_schedule_attendance_details(date) to authenticated;
