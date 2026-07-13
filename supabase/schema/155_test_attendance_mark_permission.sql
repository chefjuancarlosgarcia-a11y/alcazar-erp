-- Sprint 1.1 — validación de resolve_attendance_mark_permission
-- Ejecutar en Supabase SQL Editor después de aplicar 155_attendance_mark_permission.sql
-- No modifica datos.

-- =============================================================================
-- 1. Pruebas unitarias de cadena (sin fixtures)
-- =============================================================================
select
  scenario,
  mark_type,
  has_open_entry,
  has_open_meal,
  expected_allowed,
  expected_reason_code,
  passed,
  detail
from public.test_attendance_mark_chain_rules()
order by scenario;

-- Debe retornar passed=true en todas las filas.

-- =============================================================================
-- 2. Resumen rápido
-- =============================================================================
select
  count(*) as total,
  count(*) filter (where passed) as passed,
  count(*) filter (where not passed) as failed
from public.test_attendance_mark_chain_rules();

-- =============================================================================
-- 3. Diagnóstico por colaborador (reemplazar UUID)
-- =============================================================================
-- select * from public.diagnose_attendance_mark_permission('EMPLOYEE_UUID_HERE');

-- =============================================================================
-- 4. Casos reales conocidos (nombres parciales)
-- =============================================================================
-- Turno abierto / overnight
select d.*
from public.profiles p
cross join lateral public.diagnose_attendance_mark_permission(p.id) d
where lower(coalesce(p.full_name, p.username, '')) like '%osman%'
order by d.mark_type;

-- Entrada abierta + salida_comida
select d.*
from public.profiles p
cross join lateral public.diagnose_attendance_mark_permission(p.id) d
where lower(coalesce(p.full_name, p.username, '')) like '%mois%'
order by d.mark_type;

-- =============================================================================
-- 5. Alineación permission vs marking_state (todos los abiertos)
-- =============================================================================
select
  s.employee_name,
  d.*
from public.get_open_attendance_shifts() s
cross join lateral public.diagnose_attendance_mark_permission(s.employee_id) d
where not d.aligned
order by s.employee_name, d.mark_type;

-- Debe retornar 0 filas si permission y marking_state están alineados.

-- =============================================================================
-- 6. Descanso / extra / nocturno — inspección manual por empleado
-- =============================================================================
-- select
--   p.full_name,
--   public.resolve_attendance_mark_permission(p.id, 'entrada', now()) as perm
-- from public.profiles p
-- where p.id = 'EMPLOYEE_UUID_HERE';

-- Verificar classification / approval_status en perm:
--   rest_day_worked + pending  → descanso trabajado
--   authorized_overtime + approved → tiempo extraordinario autorizado
--   labor_date < calendar_date con open_entry → turno nocturno / viejo abierto
