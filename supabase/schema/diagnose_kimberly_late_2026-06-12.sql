-- Diagnóstico manual para Supabase SQL Editor (sin depender de auth.uid()).
-- Ejecutar cada bloque por separado para el caso Kimberly Rivas / 2026-06-12.

-- 1) ¿Existe la migración 071?
select
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_attendance_daily_late_arrivals'
  ) as has_late_arrivals_rpc,
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_attendance_late_grace_minutes'
  ) as has_grace_rpc;

-- 2) Perfil Kimberly
select id, full_name, username, role, status
from public.profiles
where lower(coalesce(full_name, username, '')) like '%kimberly%';

-- 3) Horarios del día (draft + published)
select
  s.id,
  s.employee_id,
  p.full_name,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.area,
  s.status,
  s.is_work_day,
  s.shift_type,
  s.shift_type_id
from public.employee_schedules s
join public.profiles p on p.id = s.employee_id
where s.shift_date = date '2026-06-12'
  and lower(coalesce(p.full_name, p.username, '')) like '%kimberly%';

-- 4) Marcajes de entrada del día (fecha local Guatemala)
select
  m.id,
  m.employee_id,
  p.full_name,
  m.mark_type,
  m.marked_at,
  (m.marked_at at time zone 'America/Guatemala')::date as fecha_gt,
  (m.marked_at at time zone 'America/Guatemala')::time as hora_gt
from public.attendance_marks m
join public.profiles p on p.id = m.employee_id
where lower(coalesce(p.full_name, p.username, '')) like '%kimberly%'
  and m.mark_type = 'entrada'
  and (m.marked_at at time zone 'America/Guatemala')::date = date '2026-06-12';

-- 5) Cálculo crudo tardanza (sin permisos)
select
  p.full_name,
  s.shift_date,
  s.start_time as schedule_start,
  (entrance.marked_at at time zone 'America/Guatemala')::time as check_in_local,
  greatest(0, coalesce(extract(epoch from (
    entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
  )) / 60, 0))::integer as raw_late_minutes,
  public.get_attendance_late_grace_minutes() as grace_minutes,
  greatest(0, coalesce(extract(epoch from (
    entrance.marked_at at time zone 'America/Guatemala' - (s.shift_date + s.start_time)
  )) / 60, 0))::integer > public.get_attendance_late_grace_minutes() as is_late
from public.employee_schedules s
join public.profiles p on p.id = s.employee_id
left join lateral (
  select m.marked_at
  from public.attendance_marks m
  where m.employee_id = s.employee_id
    and m.mark_type = 'entrada'
    and (m.marked_at at time zone 'America/Guatemala')::date = s.shift_date
  order by m.marked_at asc
  limit 1
) entrance on true
where s.shift_date = date '2026-06-12'
  and lower(coalesce(p.full_name, p.username, '')) like '%kimberly%'
  and s.status in ('published', 'draft')
  and s.is_work_day;

-- 6) Probe debug sin auth (aplicar 073 primero)
-- select * from public.debug_probe_attendance_late_arrival_sql_editor(date '2026-06-12', 'Kimberly');

-- 7) RPC real (requiere sesión autenticada admin/RRHH; en SQL Editor auth.uid() es null)
-- select * from public.get_attendance_daily_late_arrivals(date '2026-06-12', null);
