-- SQL Editor debug probe for late arrivals (no auth.uid() required).
-- Apply after 072_late_attendance_diagnostics.sql.
-- Does NOT alter security of get_attendance_daily_late_arrivals.

create or replace function public.debug_probe_attendance_late_arrival_sql_editor(
  p_date date,
  p_employee_name text default null
)
returns table (
  step text,
  ok boolean,
  detail text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_employee_label text;
  v_schedule_count integer;
  v_mark_count integer;
  v_grace integer;
  v_schedule_start time;
  v_check_in time;
  v_check_in_at timestamptz;
  v_raw_late integer;
  v_is_late boolean;
  v_join_detail text;
  v_schedules_detail text;
  v_marks_detail text;
begin
  if p_employee_name is not null and nullif(trim(p_employee_name), '') is not null then
    select p.id, coalesce(p.full_name, p.username, 'Colaborador')
    into v_employee_id, v_employee_label
    from public.profiles p
    where lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
    order by p.full_name
    limit 1;
  end if;

  return query select
    'employee_found'::text,
    v_employee_id is not null,
    case
      when v_employee_id is null then coalesce('Sin coincidencia para "' || p_employee_name || '"', 'Nombre de empleado requerido')
      else format('id=%s name=%s', v_employee_id, v_employee_label)
    end;

  select count(*)::integer,
    coalesce(string_agg(
      format('id=%s area=%s %s-%s status=%s block=%s',
        s.id,
        coalesce(s.area, '-'),
        to_char(s.start_time, 'HH24:MI'),
        to_char(s.end_time, 'HH24:MI'),
        s.status,
        s.block_order
      ), E'\n' order by s.block_order, s.start_time
    ), 'ninguno')
  into v_schedule_count, v_schedules_detail
  from public.employee_schedules s
  join public.profiles p on p.id = s.employee_id
  left join public.shift_types st on st.id = s.shift_type_id
  where s.shift_date = p_date
    and s.status in ('published', 'draft')
    and s.is_work_day
    and s.start_time is not null
    and coalesce(st.is_rest_day, false) = false
    and coalesce(st.is_holiday, false) = false
    and coalesce(s.shift_type, '') not in ('rest', 'asueto')
    and (v_employee_id is null or s.employee_id = v_employee_id)
    and (
      p_employee_name is null
      or nullif(trim(p_employee_name), '') is null
      or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
    );

  return query select
    'schedules_for_date'::text,
    v_schedule_count > 0,
    format('%s horario(s) laborales draft/published:%s%s', v_schedule_count, E'\n', v_schedules_detail);

  select count(*)::integer,
    coalesce(string_agg(
      format('marked_at=%s hora_gt=%s',
        m.marked_at,
        to_char((m.marked_at at time zone 'America/Guatemala'), 'HH24:MI')
      ), E'\n' order by m.marked_at
    ), 'ninguno')
  into v_mark_count, v_marks_detail
  from public.attendance_marks m
  join public.profiles p on p.id = m.employee_id
  where m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = p_date
    and (v_employee_id is null or m.employee_id = v_employee_id)
    and (
      p_employee_name is null
      or nullif(trim(p_employee_name), '') is null
      or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
    );

  return query select
    'entry_marks_for_date'::text,
    v_mark_count > 0,
    format('%s marcaje(s) entrada (fecha local America/Guatemala):%s%s', v_mark_count, E'\n', v_marks_detail);

  select
    coalesce(string_agg(
      format('%s | schedule_start=%s check_in=%s raw_late_minutes=%s status=%s',
        x.full_name,
        to_char(x.start_time, 'HH24:MI'),
        coalesce(to_char(x.check_in_local, 'HH24:MI'), 'sin entrada'),
        x.raw_late,
        x.schedule_status
      ), E'\n' order by x.start_time
    ), 'Sin filas horario+entrada')
  into v_join_detail
  from (
    select
      coalesce(p.full_name, p.username, 'Colaborador') as full_name,
      s.start_time,
      s.status as schedule_status,
      m.marked_at as check_in_at,
      (m.marked_at at time zone 'America/Guatemala')::time as check_in_local,
      greatest(0, coalesce(extract(epoch from (
        m.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer as raw_late
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    left join public.shift_types st on st.id = s.shift_type_id
    left join lateral (
      select am.marked_at
      from public.attendance_marks am
      where am.employee_id = s.employee_id
        and am.mark_type = 'entrada'
        and (am.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      order by am.marked_at asc
      limit 1
    ) m on true
    where s.shift_date = p_date
      and s.status in ('published', 'draft')
      and s.is_work_day
      and s.start_time is not null
      and coalesce(st.is_rest_day, false) = false
      and coalesce(st.is_holiday, false) = false
      and coalesce(s.shift_type, '') not in ('rest', 'asueto')
      and (v_employee_id is null or s.employee_id = v_employee_id)
      and (
        p_employee_name is null
        or nullif(trim(p_employee_name), '') is null
        or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
      )
  ) x;

  select x.start_time, x.check_in_local, x.check_in_at, x.raw_late
  into v_schedule_start, v_check_in, v_check_in_at, v_raw_late
  from (
    select
      s.start_time,
      m.marked_at as check_in_at,
      (m.marked_at at time zone 'America/Guatemala')::time as check_in_local,
      greatest(0, coalesce(extract(epoch from (
        m.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer as raw_late
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
    left join public.shift_types st on st.id = s.shift_type_id
    left join lateral (
      select am.marked_at
      from public.attendance_marks am
      where am.employee_id = s.employee_id
        and am.mark_type = 'entrada'
        and (am.marked_at at time zone 'America/Guatemala')::date = s.shift_date
      order by am.marked_at asc
      limit 1
    ) m on true
    where s.shift_date = p_date
      and s.status in ('published', 'draft')
      and s.is_work_day
      and s.start_time is not null
      and coalesce(st.is_rest_day, false) = false
      and coalesce(st.is_holiday, false) = false
      and coalesce(s.shift_type, '') not in ('rest', 'asueto')
      and (v_employee_id is null or s.employee_id = v_employee_id)
      and (
        p_employee_name is null
        or nullif(trim(p_employee_name), '') is null
        or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
      )
  ) x
  where x.check_in_at is not null
  order by x.raw_late desc, x.start_time
  limit 1;

  return query select
    'schedule_mark_join'::text,
    v_raw_late is not null,
    v_join_detail;

  v_grace := public.get_attendance_late_grace_minutes();
  v_is_late := v_check_in_at is not null and coalesce(v_raw_late, 0) > v_grace;

  return query select
    'computed_late_minutes'::text,
    v_raw_late is not null,
    coalesce(v_raw_late::text, 'null');

  return query select
    'grace_minutes'::text,
    true,
    v_grace::text;

  return query select
    'is_late'::text,
    v_is_late,
    case
      when v_check_in_at is null then 'false (sin entrada)'
      when coalesce(v_raw_late, 0) <= v_grace then format('false (raw_late=%s <= grace=%s)', v_raw_late, v_grace)
      else format('true (raw_late=%s > grace=%s)', v_raw_late, v_grace)
    end;

  return query select
    'final_result'::text,
    v_is_late,
    case
      when v_employee_id is null then 'NO: empleado no encontrado'
      when v_schedule_count = 0 then 'NO: sin horario laboral draft/published para la fecha'
      when v_mark_count = 0 then 'NO: sin marcaje de entrada en fecha local GT'
      when v_check_in_at is null then 'NO: horario y marcaje no se unieron (revisar employee_id / fecha / timezone)'
      when not v_is_late then format(
        'NO: no es tardanza (schedule_start=%s check_in=%s raw_late_minutes=%s grace_minutes=%s)',
        to_char(v_schedule_start, 'HH24:MI'),
        to_char(v_check_in, 'HH24:MI'),
        coalesce(v_raw_late, 0),
        v_grace
      )
      else format(
        'SI: llegada tarde (schedule_start=%s check_in=%s raw_late_minutes=%s grace_minutes=%s is_late=true)',
        to_char(v_schedule_start, 'HH24:MI'),
        to_char(v_check_in, 'HH24:MI'),
        v_raw_late,
        v_grace
      )
    end;
end;
$$;

comment on function public.debug_probe_attendance_late_arrival_sql_editor(date, text) is
  'Diagnóstico de tardanzas para Supabase SQL Editor. Omite auth.uid(). No usar desde la app.';

revoke all on function public.debug_probe_attendance_late_arrival_sql_editor(date, text) from public;
revoke all on function public.debug_probe_attendance_late_arrival_sql_editor(date, text) from anon;
revoke all on function public.debug_probe_attendance_late_arrival_sql_editor(date, text) from authenticated;
grant execute on function public.debug_probe_attendance_late_arrival_sql_editor(date, text) to service_role;
