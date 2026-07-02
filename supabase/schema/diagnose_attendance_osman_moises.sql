-- Diagnóstico manual: Osman Mazáriegos y Moisés
-- Ejecutar en Supabase SQL Editor después de aplicar 152 y 153.
-- No modifica datos.

-- =============================================================================
-- 1. Osman Mazáriegos — turno abierto 20/06/2026 13:25
-- =============================================================================
select * from public.diagnose_attendance_employee_state('Osman', date '2026-06-18', date '2026-06-22')
order by
  case section
    when 'profile' then 1
    when 'open_entry' then 2
    when 'open_meal' then 3
    when 'context' then 4
    when 'marking_state' then 5
    when 'terminal_ui' then 6
    when 'schedule' then 7
    when 'custom_schedule' then 8
    when 'mark' then 9
    else 99
  end,
  marked_at nulls last;

-- Entrada abierta exacta (si existe)
select
  m.id,
  m.employee_id,
  p.full_name,
  m.marked_at at time zone 'America/Guatemala' as marked_at_gt,
  m.labor_date,
  m.mark_type,
  m.classification,
  m.approval_status,
  m.device_name,
  m.observation,
  exists (
    select 1 from public.attendance_marks out_mark
    where out_mark.employee_id = m.employee_id
      and out_mark.mark_type in ('salida_final', 'salida')
      and out_mark.marked_at > m.marked_at
  ) as has_later_exit
from public.attendance_marks m
join public.profiles p on p.id = m.employee_id
where lower(coalesce(p.full_name, p.username, '')) like '%osman%'
  and m.mark_type = 'entrada'
  and not exists (
    select 1 from public.attendance_marks out_mark
    where out_mark.employee_id = m.employee_id
      and out_mark.mark_type in ('salida_final', 'salida')
      and out_mark.marked_at > m.marked_at
  )
order by m.marked_at desc;

-- Turnos abiertos globales (RRHH)
select * from public.get_open_attendance_shifts()
where lower(employee_name) like '%osman%';

-- =============================================================================
-- 2. Moisés — bloqueo salida_comida
-- =============================================================================
select * from public.diagnose_attendance_employee_state('Mois', date '2026-06-18', current_date)
order by
  case section
    when 'profile' then 1
    when 'open_entry' then 2
    when 'open_meal' then 3
    when 'context' then 4
    when 'marking_state' then 5
    when 'terminal_ui' then 6
    when 'mark' then 7
    else 99
  end,
  marked_at nulls last;

-- Comidas huérfanas (salida_comida sin regreso, posible falso activeMeal en UI)
select
  meal.id as meal_id,
  meal.marked_at at time zone 'America/Guatemala' as meal_at_gt,
  meal.mark_type,
  exists (
    select 1 from public.attendance_marks back_mark
    where back_mark.employee_id = meal.employee_id
      and back_mark.mark_type in ('regreso_comida', 'bano_regreso')
      and back_mark.marked_at > meal.marked_at
  ) as has_regreso,
  exists (
    select 1 from public.attendance_marks out_mark
    where out_mark.employee_id = meal.employee_id
      and out_mark.mark_type in ('salida_final', 'salida')
      and out_mark.marked_at > meal.marked_at
  ) as has_later_exit_after_meal
from public.attendance_marks meal
join public.profiles p on p.id = meal.employee_id
where lower(coalesce(p.full_name, p.username, '')) like '%mois%'
  and meal.mark_type in ('salida_comida', 'bano_inicio')
order by meal.marked_at desc
limit 20;

-- marking_state salida_comida directo
select public.get_attendance_marking_state(p.id, 'salida_comida') as moises_salida_comida_state
from public.profiles p
where lower(coalesce(p.full_name, p.username, '')) like '%mois%'
limit 1;
