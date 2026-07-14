-- =============================================================================
-- EXPLAIN ANALYZE — get_operational_tasks_board (STAGING ONLY)
-- =============================================================================
-- Seguro: solo SELECT / EXPLAIN. No INSERT, UPDATE, DELETE, DDL ni índices.
--
-- Objetivo: medir tiempo real del RPC y sus subconsultas con permisos reales.
--
-- IMPORTANTE — contexto de usuario
-- El SQL Editor corre como service role por defecto; auth.uid() será NULL y
-- can_access_operational_task devolverá 0 filas o planes irreales.
-- Antes de los EXPLAIN, ejecutar el bloque "0) Impersonar usuario" abajo.
--
-- Copiar resultados a docs/erp-performance-sprint-week1.md o pegar en chat:
--   - Execution Time de A, B, C, D
--   - Filas (rows) de cada plan
--   - Líneas con "loops=", "Seq Scan", "Index Scan", "Buffers:"
--   - Conteo E
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Impersonar usuario de staging (OBLIGATORIO)
-- ---------------------------------------------------------------------------
-- Sustituir YOUR_PROFILE_UUID por el uuid del perfil a medir (ej. gerente).
-- Obtenerlo: select id, full_name, role from public.profiles where role = 'gerente' limit 5;

begin;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', 'YOUR_PROFILE_UUID',
    'role', 'authenticated',
    'aal', 'aal1'
  )::text,
  true
);

-- Verificar contexto (debe devolver el uuid, no null):
select auth.uid() as impersonated_uid, public.current_profile_role() as role;

-- ---------------------------------------------------------------------------
-- 1) Parámetros de prueba — editar aquí
-- ---------------------------------------------------------------------------
-- Equivalente a lo que envía el frontend (operationalTasksService.js)

do $$
declare
  v_area_id text := null;                    -- uuid área o null
  v_assignee_id uuid := null;                -- uuid asignado o null
  v_search text := null;                     -- texto búsqueda o null
  v_include_cancelled boolean := false;
  v_completed_days integer := 7;             -- ventana completadas
  v_include_old_completed boolean := false;
  v_label_ids uuid[] := null;                -- array uuid o null
  v_card_limit integer := 50;                  -- límite sección C
begin
  raise notice 'area_id=% assignee=% search=% completed_days=% limit=%',
    v_area_id, v_assignee_id, v_search, v_completed_days, v_card_limit;
end $$;

-- Valores para copiar en las consultas A–D:
-- p_area_id              = null
-- p_assignee_id          = null
-- p_search               = null
-- p_include_cancelled    = false
-- p_completed_days       = 7
-- p_include_old_completed= false
-- p_label_ids            = null
-- v_card_limit           = 50

-- ---------------------------------------------------------------------------
-- A) RPC completo — tiempo total percibido por el cliente
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select public.get_operational_tasks_board(
  null,    -- p_area_id
  null,    -- p_assignee_id
  null,    -- p_search
  false,   -- p_include_cancelled
  7,       -- p_completed_days
  false,   -- p_include_old_completed
  null     -- p_label_ids
);

-- Esperado: Function Scan → Execution Time total del RPC.
-- Copiar: Execution Time, Buffers: shared hit/read.

-- ---------------------------------------------------------------------------
-- B) Candidatas + autorización (WHERE sin card_summary)
--    Mide: can_access_operational_task × N en filtro
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select
  t.id,
  t.status,
  t.sort_position,
  t.updated_at
from public.assigned_tasks t
where t.task_source = 'operational'
  and t.deleted_at is null
  and t.archived_at is null
  and public.can_access_operational_task(t, 'view')
  and t.status <> 'cancelled'
  and (
    t.status <> 'completed'
    or t.completed_at >= now() - make_interval(days => 7)
    or (t.completed_at is null and t.updated_at >= now() - make_interval(days => 7))
  );

-- Copiar: rows=N, loops en Filter/Function Scan, Seq Scan vs Index Scan.

-- ---------------------------------------------------------------------------
-- C) Card summary por tarjeta (N = LIMIT)
--    Mide: operational_task_card_summary × N
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select public.operational_task_card_summary(t)
from public.assigned_tasks t
where t.task_source = 'operational'
  and t.deleted_at is null
  and t.archived_at is null
  and public.can_access_operational_task(t, 'view')
  and t.status <> 'cancelled'
  and (
    t.status <> 'completed'
    or t.completed_at >= now() - make_interval(days => 7)
    or (t.completed_at is null and t.updated_at >= now() - make_interval(days => 7))
  )
order by t.sort_position asc, t.created_at desc
limit 50;   -- ajustar a row_count real del tablero

-- ---------------------------------------------------------------------------
-- D) Work summary aislado (get_task_work_card_summary × N)
-- ---------------------------------------------------------------------------
explain (analyze, buffers, verbose, format text)
select public.get_task_work_card_summary(t.id)
from public.assigned_tasks t
where t.task_source = 'operational'
  and t.deleted_at is null
  and t.archived_at is null
  and public.can_access_operational_task(t, 'view')
  and t.status <> 'cancelled'
order by t.sort_position asc, t.created_at desc
limit 50;

-- ---------------------------------------------------------------------------
-- E) Conteo rápido (sin ANALYZE — contexto de volumen)
-- ---------------------------------------------------------------------------
select
  count(*) as operational_active_rows,
  count(*) filter (where t.status = 'completed') as completed_rows,
  count(*) filter (where t.status <> 'completed' and t.status <> 'cancelled') as open_rows
from public.assigned_tasks t
where t.task_source = 'operational'
  and t.deleted_at is null
  and t.archived_at is null;

-- ---------------------------------------------------------------------------
-- F) Variante con filtros (opcional — replicar tu sesión)
-- ---------------------------------------------------------------------------
-- Área:
-- explain (analyze, buffers, verbose, format text)
-- select public.get_operational_tasks_board('AREA_UUID_HERE', null, null, false, 7, false, null);

-- Búsqueda:
-- explain (analyze, buffers, verbose, format text)
-- select public.get_operational_tasks_board(null, null, 'inventario', false, 7, false, null);

-- Etiquetas:
-- explain (analyze, buffers, verbose, format text)
-- select public.get_operational_tasks_board(null, null, null, false, 7, false, array['LABEL_UUID']::uuid[]);

-- Completadas antiguas:
-- explain (analyze, buffers, verbose, format text)
-- select public.get_operational_tasks_board(null, null, null, false, 30, true, null);

rollback;  -- no persiste set_config de impersonación

-- =============================================================================
-- Plantilla de resultados (completar y copiar)
-- =============================================================================
-- | Métrica | Valor |
-- |---------|------:|
-- | Impersonated role | |
-- | Execution Time A (RPC total) | ms |
-- | Execution Time B (can_access filter) | ms |
-- | Execution Time C (card_summary × N) | ms |
-- | Execution Time D (work_summary × N) | ms |
-- | Filas B (rows) | |
-- | LIMIT C / D | |
-- | can_access loops / Filter rows | |
-- | Seq Scan assigned_tasks | sí/no |
-- | Buffers A hit / read | |
-- | Buffers C hit / read | |
-- | Sort en plan | sí/no |
