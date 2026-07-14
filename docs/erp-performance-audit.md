# Auditoría integral de rendimiento y experiencia de carga — ERP El Gran Alcázar

**Fase actual:** diagnóstico + instrumentación + plan técnico  
**Fecha:** 2026-07-13  
**Alcance:** frontend, Supabase/RPC, caché, estados loading/empty, red  
**Sin cambios de arquitectura, permisos, índices ni datos productivos**

---

## Resumen ejecutivo

El ERP presenta **dos problemas distintos** que se perciben como uno solo:

| Síntoma | Causa principal (evidencia en código) | Tipo |
|--------|----------------------------------------|------|
| Pantalla vacía al entrar | Estados `loading` mal coordinados; columnas/listas renderizan **antes** de datos; `loading` inicial `false` en algunos módulos | UX / estado |
| Tarda en mostrar datos | Waterfalls de red; **sin caché** en módulos críticos; refetch al foco; padre+hijo duplican RPCs | Latencia / sobrecarga |
| Al regresar, recarga todo | `queryCache` solo en catálogos; Trabajo/Inventario/Checklists/PO **sin persistencia** entre visitas | Falta de caché |
| “Parece que borraron datos” | Mensajes empty (`!loading && !items.length`) + UI vacía mientras `loading=true` sin skeleton | UX engañosa |

**Conclusión:** el volumen de datos actual **no explica** la lentitud. Hay sobrecarga evitable (duplicados, waterfalls, refetch) y **mala señalización visual** que amplifica la percepción de pérdida de datos.

---

## Instrumentación añadida (solo desarrollo)

### Activación

```env
# frontend/.env.development (comentado por defecto)
VITE_ERP_PERF_DEBUG=true
```

Reiniciar `npm run dev`. Filtrar consola: **`[ERP PERF]`**

### Archivos nuevos

| Archivo | Rol |
|---------|-----|
| `frontend/src/utils/erpPerf.js` | Logger, sesiones por módulo, interceptor fetch Supabase, export |
| `frontend/src/hooks/useErpPerfModule.js` | Montaje, renders, tiempo a primer contenido |

### Métricas registradas

- `route`, `module`, `request_name`, `request_start`, `request_end`, `request_ms`
- `payload_bytes`, `row_count`, `render_start`, `first_contentful_module_render_ms`, `interactive_ms`
- `cache_hit`, `refetch_reason`, `requests_count`, `duplicated_requests`, `component_render_count`

### Export en consola del navegador

```js
window.__ERP_PERF__.export()
window.__ERP_PERF__.summarize()
```

### Módulos instrumentados (montaje)

- `trabajo-tablero` — `TaskBoard.jsx`
- `trabajo-mi-trabajo` — `MyWork.jsx`
- `inventario-{section}` — `InventoryBase.jsx`
- `checklists` — `ChecklistsModule` en `Tasks.jsx`
- `rrhh-{section}` — `HR.jsx`
- `pos-{section}` — `POS.jsx`
- `reportes` — `ReportsDashboard.jsx`

Todas las llamadas Supabase pasan por interceptor fetch cuando el flag está activo (incluye RPC y REST).

`queryCache.js` emite `cache_hit` / `cache_miss` / `cache_inflight` en `[ERP PERF]`.

**No se envía a producción:** el flag debe permanecer `false` o ausente en build productivo.

---

## Metodología de medición recomendada

1. Activar `VITE_ERP_PERF_DEBUG=true`
2. Abrir módulo en ventana limpia (hard refresh)
3. Copiar secuencia `[ERP PERF] request_start` / `request_end` en orden
4. Repetir: salir → regresar; cambiar pestaña del navegador → volver (refetch foco)
5. Comparar `duplicated_requests` y `module_summary` al desmontar

Complementar con DevTools → Network (Disable cache) para latencia TLS/RLS real.

---

## 1. Trabajo / Tareas (`/tasks/trabajo/*`)

### Waterfall estimado — Tablero

| Orden | Request | Dependencia | ¿Necesaria para 1er render? |
|------:|---------|-------------|:----------------------------:|
| 1 | `auth.getSession` + `profiles` | — | Sí (layout) |
| 2 | `rpc:get_operational_tasks_board` | auth | **Sí** |
| 3 | `rpc:get_task_assignable_profiles` | auth | No (solo asignación) |
| 4 | `areas` (REST, cache) | — | No (filtro área) |
| 5 | `rpc:get_task_labels_catalog` | `filters.areaId` | No |
| 6 | `rpc:get_operational_task_detail` | `?task=` en URL | No (panel lateral) |
| 7 | Refetch foco (`useTaskFocusRefresh`) | visibility | No |

**Paralelizable:** 2 + 3 + 4 + 5 (independientes tras auth).  
**Diferible:** 5 (etiquetas), 3 (perfiles hasta abrir asignación).  
**Combinable (futuro):** board + labels + areas en un RPC “board bootstrap”.

### Waterfall — Mi trabajo

Similar sin `get_operational_tasks_board`; usa `get_my_operational_tasks`. Sin `getActiveAreas`.

### Duplicados documentados

| Evidencia | Archivo | Función |
|-----------|---------|---------|
| `getTaskAssignableProfiles` padre + hijo | `Tasks.jsx` ~L703; `useOperationalTasks.js` `useAssignableProfiles` | Dos RPC iguales si rol gerente |
| `getActiveAreas` padre + tablero | `Tasks.jsx` ~L730; `TaskBoard.jsx` ~L238 | Cache dedupe, pero 2 suscriptores |
| `probeChecklistModuleAccess` | `AuthContext.jsx`; `Tasks.jsx` `refreshChecklistModuleAccess` | Doble probe `checklist_runs` |
| List + detail tras mutación | `useOperationalTasksSync.js` `confirmOperationalMutation` | Por diseño; duplica latencia post-acción |
| `useEffect([params])` + `openTask` | `TaskBoard.jsx` | Puede alinear estado URL 2× (no siempre 2 RPC) |
| StrictMode dev | `main.jsx` | Efectos mount **2×** en desarrollo |

### N+1

| Patrón | Estado |
|--------|--------|
| Labels por tarjeta | **Resuelto** en SQL `182e` / `get_task_work_card_summary` embebido en board RPC |
| Assignees por tarjeta | Incluidos en `operational_task_card_summary` |
| Permisos por tarjeta | Incluidos en summary |
| Detail separado por tarjeta abierta | 1 RPC extra solo con `?task=` — aceptable |

### Loading / empty engañoso

| Vista | Problema |
|-------|----------|
| **TaskBoard** | Columnas Kanban visibles vacías mientras `loading`; parece tablero borrado |
| **TaskDetailPanel** | Al cambiar tarea, posible flash “No se encontró la tarea” |
| **MyWork** | Mejor: texto “Cargando tareas…” explícito |

---

## 2. Checklists (`/tasks?tab=checklists`)

### Waterfall estimado

| Orden | Request | ¿1er render? |
|------:|---------|:------------:|
| 1 | Auth + checklist access probe | Sí |
| 2 | `loadModuleChecklistRuns` (multi-query por fechas) | **Sí** |
| 3 | `getChecklistProfiles` | Parcial |
| 4 | Library batch (templates, incidents, …) si permiso | No |
| 5 | `getOperationalProcessRunsForDate` | Parcial |
| 6 | `generateDueChecklistRuns` / `ensureDue…` | Post-carga (bloquea refresh) |
| 7 | `getChecklistCoverageForRuns` | Post-carga |
| 8 | Realtime debounce 1200ms → `refresh` silencioso | No |

### Duplicados / cascada

- `refresh()` encadena generación de runs **después** del primer paint → segunda ola de requests.
- `loading` inicia en `false` → primera pintura puede ser “Hoy vacío”.
- Realtime + focus + permission deps → refetch completo.

### N+1

- `loadModuleChecklistRuns`: 1 + N queries por `todayDates` — **batch por diseño**, no per-row.
- `replayPendingChecklistDrafts`: updates secuenciales por draft.

---

## 3. Inventario (`/inventory`)

### Waterfall — `InventoryBase.refresh()`

| Orden | Request | Cache | ¿1er render? |
|------:|---------|-------|:------------:|
| 1 | `getActiveAreas` | Sí | No |
| 2 | `getInventoryItems` (paginado 1000/pág) | **No** | **Sí** |
| 3 | `getInventoryMovements` (100) | No | No |
| 4 | `getSuppliers` | Sí | No |
| 5 | `getActiveInventoryCategories` | Sí | Parcial |
| 6 | `getInventoryUnitConversions` | No | No |

**Problema principal:** `getInventoryItems` pagina todo el catálogo en frío — mayor costo del módulo.

### Refetch

- Realtime `area_inventory` + `inventory_movements` → `refreshOperationalData` (items + movements).

### Empty flash

- `loading=true` inicial — correcto.
- Categorías con `categoriesLoading` separado → posible “sin categorías” temporal.

---

## 4. Compras (`/inventory?section=ordenes` → Legacy)

### Waterfall

| Orden | Request | Notas |
|------:|---------|-------|
| 1 | `getPurchaseOrders` | Sin caché |
| 2 | `getPurchaseOrders` (**duplicado**) | Deep-link effect en mismo mount |
| 3 | `getInventoryItems` | Catálogo completo para picker manual |

### Evidencia duplicado PO

`LegacyInventoryApp.jsx`: efecto por `seccionActiva === "ordenes"` + efecto deep-link notificaciones.

### Loading

- Lista PO sin gate global de loading; depende de hidratación de estado local.

---

## 5. RRHH (`/hr`)

### Waterfall — Usuarios (`ProfileManagement`)

| Orden | Request | Cache |
|------:|---------|-------|
| 1 | `profiles.select("*")` | No — **tabla completa** |
| 2 | `getAttendanceTerminalProfiles` | No |
| 3 | `getActiveAreas` | Sí |
| 4 | Roles / shift types | Varies |

### Otros

- `AttendanceTerminal`: polling por `setInterval`.
- Sin `useTaskFocusRefresh`, pero intervalos activos.

---

## 6. POS catálogo (`/pos`, `/pos?section=agregar-item`)

### Waterfall — venta

| Orden | Request | Cache |
|------:|---------|-------|
| 1 | `getPOSProducts` (≤500) | Sí 5 min |
| 2 | `getProductionAreas` | Sí |
| 3 | `getActiveRecipes` | Sí |

### Admin catálogo

- `getPOSCatalogPage` paginado por filtro/página — ya tiene `[POS PERF]` separado.

### Positivo

- Único módulo con auditoría de rendimiento previa madura (`posCatalogPerformance.js`).

---

## 7. Reportes (`/reports`)

### Waterfall

| Tab | Requests principales |
|-----|---------------------|
| `executive` | `getExecutiveDashboardReport` (cache 2 min) + órdenes multi-rango |
| `purchases` | `purchase_orders` full select |
| `inventory` | `area_inventory` + movements |
| `sales` | POS orders + products cache |

### Empty flash

- `loading` inicial `false` hasta `setTimeout(0)` — breve flash posible.
- `changeTab` hace `setData(null); setLoading(true)` — **buen patrón**.

---

## 8. Dashboard principal (`/dashboard`)

- **Sin Supabase** en mount — localStorage (`assignedTasks`, notifications).
- No contribuye a latencia Supabase; sí a percepción si mezclado con `/tasks`.

---

## Matriz: causas vs módulos

| Causa | Trabajo | Checklists | Inventario | Compras | RRHH | POS | Reportes |
|-------|:-------:|:----------:|:----------:|:-------:|:----:|:---:|:--------:|
| Latencia real RPC | ●● | ●●● | ●●● | ●● | ●● | ● | ●● |
| Sobrecarga consultas | ●●● | ●●● | ●● | ●●● | ●● | ● | ●● |
| Render lento | ● | ● | ●● | ● | ● | ●● | ● |
| Loading/empty mal | ●●● | ●● | ● | ●● | ● | ● | ● |
| Sin caché | ●●● | ●●● | ●●● | ●●● | ●● | ● | ● |
| Refetch innecesario | ●●● | ●●● | ●● | ● | ●● | ●● | ● |

---

## Plan técnico por fases (sin implementar aún)

### Fase A — Medición (ahora)

- [x] Instrumentación `[ERP PERF]` + hook módulo
- [ ] Correr checklist de pruebas por módulo y **llenar tablas con ms reales**
- [ ] Capturar 3 sesiones: cold load, revisit, tab focus return

### Fase B — UX de carga (bajo riesgo, sin cambiar datos)

1. **Skeletons** en Kanban, listas de inventario, checklists “Hoy” — nunca empty grid con `loading=true`
2. **Diferir mensaje empty** hasta `!loading && !refreshing && dataFetchedOnce`
3. **Conservar datos anteriores** al refetch background (`placeholderData` pattern)
4. Unificar chip “Sincronizando…” vs vacío

**Archivos candidatos:** `TaskBoard.jsx`, `ChecklistsModule`, `InventoryBase.jsx`, `PurchaseOrdersModule.jsx`

### Fase C — Eliminar duplicados (evidencia clara)

| Cambio | Archivos | Impacto esperado |
|--------|----------|------------------|
| Quitar `getTaskAssignableProfiles` del padre `Tasks.jsx` | `Tasks.jsx` | −1 RPC en Trabajo |
| Quitar `getActiveAreas` del padre si hijo ya carga | `Tasks.jsx` | −1 subscriber |
| Unificar checklist access probe | `AuthContext`, `Tasks.jsx` | −1 query login |
| Fusionar doble `getPurchaseOrders` en deep link | `LegacyInventoryApp.jsx` | −1 RPC Compras |
| Revisar `useEffect([params])` vs handlers URL | `TaskBoard.jsx` | Menos renders |

### Fase D — Paralelización / bootstrap RPC (requiere SQL, con evidencia)

Solo tras medir que el waterfall supera umbral (ej. >800ms p95):

- `get_tasks_board_bootstrap(area, labels)` — board + labels + areas
- Inventario: RPC paginado server-side con filtros, no full scan cliente
- Checklists: separar “runs hoy” de “library admin” en rutas de carga

**No crear índices** hasta `EXPLAIN ANALYZE` en queries lentas identificadas.

### Fase E — Caché estratégica

| Datos | TTL sugerido | Invalidación |
|-------|--------------|--------------|
| Board / my tasks | 30–60s + stale-while-revalidate | mutación, realtime opcional |
| `getInventoryItems` primera página | 2–5 min | realtime inventory |
| Checklist runs hoy | 60s | realtime checklist |
| PO list | 60s | on save |

Extender `queryCache` o adoptar capa SWR/React Query **sin cambiar permisos**.

### Fase F — Refetch policy

| Hook | Acción propuesta |
|------|------------------|
| `useTaskFocusRefresh` | Aumentar debounce; no refetch si <30s desde último sync |
| Checklists realtime | Ya silencioso — validar que no dispare con `loading=true` inicial |
| Inventory realtime | Limitar a diff, no `refresh()` completo |

---

## StrictMode (desarrollo)

`main.jsx` usa `<StrictMode>` → **doble mount** de efectos en dev.  
Esto **duplica** requests en desarrollo y **no ocurre en producción**.  
Al interpretar `[ERP PERF]`, comparar siempre build production o desactivar StrictMode temporalmente para auditoría.

---

## Checklist de verificación por módulo

```
[ ] Cold load: requests_count y request_ms anotados
[ ] Revisit mismo módulo: cache_hit > 0 donde aplique
[ ] Tab blur/focus: refetch_reason documentado
[ ] duplicated_requests = 0 tras Fase C
[ ] Sin mensaje "no hay datos" mientras loading=true
[ ] first_contentful_module_render_ms < interactive_ms
```

---

## Próximo paso inmediato

1. Activar `VITE_ERP_PERF_DEBUG=true`
2. Recorrer los 8 módulos prioritarios
3. Pegar en este doc la tabla waterfall **con ms medidos**
4. Priorizar Fase B (UX) y Fase C (duplicados) antes de SQL/índices

**Regla:** ninguna optimización de backend sin traza `[ERP PERF]` + Network que la justifique.

---

## Ronda de medición (siguiente paso)

Guía paso a paso módulo por módulo: **[`erp-performance-measurement-round.md`](./erp-performance-measurement-round.md)**  
Plantilla para pegar resultados: **[`erp-performance-measurement-results.md`](./erp-performance-measurement-results.md)**

Comandos rápidos en consola:

```js
__ERP_PERF__.startRound({ module: "trabajo-tablero", scenario: "cold" })
__ERP_PERF__.summarize()
await __ERP_PERF__.copyWaterfall()
__ERP_PERF__.funnel()   // embudo cuantitativo
```

**Diagnóstico cuantitativo (estimaciones + hipótesis):** [`erp-performance-quantitative-diagnosis.md`](./erp-performance-quantitative-diagnosis.md)
