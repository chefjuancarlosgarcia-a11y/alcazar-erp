-- Fix attendance status: do not use "medio_turno" as record status (that is shift type).
-- Add "pendiente" for future work days without marks.
-- Apply after 080_attendance_multi_shift_matching.sql.

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
      de.observation as entrance_observation
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
      xa.exit_marked_at,
      xa.exit_observation,
      meal_out.marked_at as meal_out_marked_at,
      meal_back.marked_at as meal_back_marked_at,
      meal_back.duration_minutes as meal_back_duration_minutes,
      case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
        ea.entrance_marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer end as raw_late_minutes,
      public.get_attendance_late_grace_minutes() as grace_minutes
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
    case when not c.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (c.exit_marked_at - c.entrance_marked_at)) / 3600, 0)
      - greatest(0, coalesce(extract(epoch from (c.meal_back_marked_at - c.meal_out_marked_at)) / 3600, 0)))::numeric(10,2) end,
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
    )
  from computed c
  order by c.shift_date, c.block_order, c.start_time nulls last, c.full_name;
$$;

revoke all on function public.get_schedule_attendance_details(date) from public;
grant execute on function public.get_schedule_attendance_details(date) to authenticated;
