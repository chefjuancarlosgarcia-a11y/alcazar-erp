-- Harden late-arrival RPC: explicit permissions, diagnostics, role alias fix.
-- Apply after 071_fix_late_attendance.sql.

create or replace function public.normalize_profile_role(p_role text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('rrhh', 'rr.hh.', 'recursos humanos', 'recursos_humanos') then 'recursos_humanos'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('gerente general', 'gerente_general') then 'gerente_general'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('administrador', 'admin') then 'admin'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('encargado almacen', 'encargado de almacen', 'encargado_almacen') then 'encargado_almacen'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('cajero', 'caja') then 'caja'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('cocinero', 'cocina') then 'cocina'
    when translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou') in ('pizzero', 'pizzeria') then 'pizzeria'
    else replace(translate(lower(coalesce(p_role, '')), 'áéíóúÁÉÍÓÚ', 'aeiouaeiou'), ' ', '_')
  end;
$$;

create or replace function public.can_view_attendance_reports()
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
      and public.normalize_profile_role(role) in ('admin', 'gerente_general', 'recursos_humanos')
  );
$$;

revoke all on function public.can_view_attendance_reports() from public;
grant execute on function public.can_view_attendance_reports() to authenticated;

create or replace function public.attendance_late_arrivals_setup_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  has_grace_fn boolean;
  has_late_fn boolean;
  has_details_fn boolean;
begin
  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_attendance_late_grace_minutes'
  ) into has_grace_fn;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_attendance_daily_late_arrivals'
  ) into has_late_fn;

  select exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_schedule_attendance_details'
      and pg_get_function_result(p.oid) like '%attendance_status%'
  ) into has_details_fn;

  return jsonb_build_object(
    'migration_071_applied', has_grace_fn and has_late_fn,
    'get_attendance_late_grace_minutes', has_grace_fn,
    'get_attendance_daily_late_arrivals', has_late_fn,
    'get_schedule_attendance_details', has_details_fn,
    'grace_minutes', case when has_grace_fn then public.get_attendance_late_grace_minutes() else null end,
    'viewer_uid', auth.uid(),
    'viewer_can_view_reports', public.can_view_attendance_reports()
  );
end;
$$;

revoke all on function public.attendance_late_arrivals_setup_status() from public;
grant execute on function public.attendance_late_arrivals_setup_status() to authenticated;

create or replace function public.probe_attendance_late_arrival(
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
  v_schedule_count integer;
  v_mark_count integer;
  v_grace integer;
begin
  if not public.can_view_attendance_reports() then
    return query select
      'permission'::text,
      false,
      format('auth.uid=%s no tiene permiso de reportes (admin/gerente_general/recursos_humanos)', coalesce(auth.uid()::text, 'null'));
    return;
  end if;

  return query select 'migration_071'::text, exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_attendance_daily_late_arrivals'
  ), 'Función get_attendance_daily_late_arrivals en catálogo';

  v_grace := public.get_attendance_late_grace_minutes();
  return query select 'grace_minutes'::text, true, v_grace::text;

  if p_employee_name is not null then
    select p.id into v_employee_id
    from public.profiles p
    where lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%'
    order by p.full_name
    limit 1;

    return query select
      'employee_match'::text,
      v_employee_id is not null,
      coalesce(v_employee_id::text, 'Sin coincidencia para "' || p_employee_name || '"');
  end if;

  select count(*)::integer into v_schedule_count
  from public.employee_schedules s
  join public.profiles p on p.id = s.employee_id
  where s.shift_date = p_date
    and s.status in ('published', 'draft')
    and s.is_work_day
    and s.start_time is not null
    and (v_employee_id is null or s.employee_id = v_employee_id)
    and (p_employee_name is null or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%');

  return query select
    'schedules_for_date'::text,
    v_schedule_count > 0,
    format('%s horario(s) laborales draft/published', v_schedule_count);

  select count(*)::integer into v_mark_count
  from public.attendance_marks m
  join public.profiles p on p.id = m.employee_id
  where m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = p_date
    and (v_employee_id is null or m.employee_id = v_employee_id)
    and (p_employee_name is null or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%');

  return query select
    'entrada_marks_for_date'::text,
    v_mark_count > 0,
    format('%s marcaje(s) de entrada en fecha local GT', v_mark_count);

  return query
  select
    'schedule_mark_join'::text,
    count(*) filter (where x.raw_late > v_grace) > 0,
    coalesce(string_agg(
      format('%s | prog=%s entrada=%s raw_late=%s min grace=%s status=%s',
        x.full_name,
        to_char(x.start_time, 'HH24:MI'),
        coalesce(to_char(x.check_in_local, 'HH24:MI'), 'sin entrada'),
        x.raw_late,
        v_grace,
        x.schedule_status
      ), E'\n' order by x.full_name
    ), 'Sin filas horario+entrada')
  from (
    select
      coalesce(p.full_name, p.username, 'Colaborador') as full_name,
      s.start_time,
      s.status as schedule_status,
      (m.marked_at at time zone 'America/Guatemala')::time as check_in_local,
      greatest(0, coalesce(extract(epoch from (
        m.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
      )) / 60, 0))::integer as raw_late
    from public.employee_schedules s
    join public.profiles p on p.id = s.employee_id
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
      and (v_employee_id is null or s.employee_id = v_employee_id)
      and (p_employee_name is null or lower(coalesce(p.full_name, p.username, '')) like '%' || lower(trim(p_employee_name)) || '%')
  ) x;

  return query
  select
    'rpc_result'::text,
    count(*) > 0,
    coalesce(string_agg(
      format('%s late=%s min entrada=%s prog=%s',
        employee_name, late_minutes, check_in_local, scheduled_start
      ), E'\n'
    ), 'RPC get_attendance_daily_late_arrivals devolvió 0 filas')
  from public.get_attendance_daily_late_arrivals(p_date, v_employee_id);
end;
$$;

revoke all on function public.probe_attendance_late_arrival(date, text) from public;
grant execute on function public.probe_attendance_late_arrival(date, text) to authenticated;

drop function if exists public.get_attendance_daily_late_arrivals(date, uuid);

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
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_view_attendance_reports() then
    raise exception 'PERMISSION_DENIED: se requiere rol admin, gerente_general o recursos_humanos (auth.uid=%).', auth.uid();
  end if;

  return query
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
    left join public.shift_types st on st.id = s.shift_type_id
    where s.shift_date = p_date
      and s.status in ('published', 'draft')
      and s.is_work_day
      and s.start_time is not null
      and (p_employee_id is null or s.employee_id = p_employee_id)
      and coalesce(st.is_rest_day, false) = false
      and coalesce(st.is_holiday, false) = false
      and coalesce(s.shift_type, '') not in ('rest', 'asueto')
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
end;
$$;

revoke all on function public.get_attendance_daily_late_arrivals(date, uuid) from public;
grant execute on function public.get_attendance_daily_late_arrivals(date, uuid) to authenticated;
