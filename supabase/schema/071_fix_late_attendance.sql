-- Fix late-arrival detection: include draft schedules, grace minutes, Guatemala TZ,
-- and mark tardiness without requiring checkout.
-- Apply after 070_checklist_delete_admin_only.sql.

insert into public.app_settings (key, value)
values ('attendance_late_grace_minutes', to_jsonb(5))
on conflict (key) do nothing;

create or replace function public.get_attendance_late_grace_minutes()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(0, coalesce(
    (select (value #>> '{}')::integer from public.app_settings where key = 'attendance_late_grace_minutes' limit 1),
    5
  ));
$$;

revoke all on function public.get_attendance_late_grace_minutes() from public;
grant execute on function public.get_attendance_late_grace_minutes() to authenticated;

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
  computed as (
    select
      s.*,
      entrance.marked_at as entrance_marked_at,
      meal_out.marked_at as meal_out_marked_at,
      meal_back.marked_at as meal_back_marked_at,
      meal_back.duration_minutes as meal_back_duration_minutes,
      exit_mark.marked_at as exit_marked_at,
      entrance.observation as entrance_observation,
      exit_mark.observation as exit_observation,
      case when not s.is_work_day then 0 else greatest(0, coalesce(extract(epoch from (
        entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer end as raw_late_minutes,
      public.get_attendance_late_grace_minutes() as grace_minutes
    from schedule_rows s
    left join lateral (
      select m.*
      from public.attendance_marks m
      where s.is_work_day
        and m.employee_id = s.employee_id
        and m.mark_type = 'entrada'
        and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      order by m.marked_at asc
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
  )
  select
    c.id,
    c.employee_id,
    coalesce(c.full_name, c.username, 'Colaborador'),
    c.role,
    c.area,
    c.shift_date,
    c.shift_type,
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
      when c.shift_type = 'half' and c.entrance_marked_at is not null and c.exit_marked_at is not null then 'medio_turno'
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
    concat_ws(' / ', nullif(c.day_notes, ''), nullif(c.notes, ''), nullif(c.entrance_observation, ''), nullif(c.exit_observation, ''))
  from computed c
  order by c.shift_date, c.block_order, c.full_name;
$$;

create or replace function public.get_attendance_daily_late_arrivals(
  p_date date,
  p_employee_id uuid default null
)
returns table (
  employee_id uuid,
  employee_name text,
  shift_date date,
  area text,
  scheduled_start time,
  check_in_at timestamptz,
  check_in_local time,
  late_minutes integer,
  grace_minutes integer,
  is_late boolean,
  schedule_status text,
  has_checkout boolean
)
language sql stable security definer set search_path = ''
as $$
  with schedule_rows as (
    select distinct on (s.employee_id, s.shift_date, s.block_order)
      s.id,
      s.employee_id,
      s.shift_date,
      s.area,
      s.start_time,
      s.end_time,
      s.is_work_day,
      s.shift_type,
      s.status,
      coalesce(p.full_name, p.username, 'Colaborador') as employee_name
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    where s.shift_date = p_date
      and s.status in ('published', 'draft')
      and s.is_work_day
      and s.start_time is not null
      and (p_employee_id is null or s.employee_id = p_employee_id)
      and public.is_attendance_manager()
    order by s.employee_id, s.shift_date, s.block_order, case s.status when 'published' then 0 else 1 end
  ),
  with_marks as (
    select
      s.*,
      entrance.marked_at as check_in_at,
      exit_mark.marked_at as check_out_at,
      public.get_attendance_late_grace_minutes() as grace_minutes,
      greatest(0, coalesce(extract(epoch from (
        entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer as raw_late_minutes
    from schedule_rows s
    left join lateral (
      select m.marked_at
      from public.attendance_marks m
      where m.employee_id = s.employee_id
        and m.mark_type = 'entrada'
        and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      order by m.marked_at asc
      limit 1
    ) entrance on true
    left join lateral (
      select m.marked_at
      from public.attendance_marks m
      where m.employee_id = s.employee_id
        and m.mark_type in ('salida_final', 'salida')
        and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
        and (entrance.marked_at is null or m.marked_at > entrance.marked_at)
      order by m.marked_at desc
      limit 1
    ) exit_mark on true
    where s.shift_type not in ('rest', 'asueto')
  )
  select
    w.employee_id,
    w.employee_name,
    w.shift_date,
    w.area,
    w.start_time,
    w.check_in_at,
    (w.check_in_at at time zone 'America/Guatemala')::time as check_in_local,
    case when w.raw_late_minutes > w.grace_minutes then w.raw_late_minutes else 0 end as late_minutes,
    w.grace_minutes,
    (w.check_in_at is not null and w.raw_late_minutes > w.grace_minutes) as is_late,
    w.status as schedule_status,
    (w.check_out_at is not null) as has_checkout
  from with_marks w
  where w.check_in_at is not null
    and w.raw_late_minutes > w.grace_minutes
  order by w.employee_name, w.start_time;
$$;

revoke all on function public.get_schedule_attendance_details(date) from public;
grant execute on function public.get_schedule_attendance_details(date) to authenticated;

revoke all on function public.get_attendance_daily_late_arrivals(date, uuid) from public;
grant execute on function public.get_attendance_daily_late_arrivals(date, uuid) to authenticated;
