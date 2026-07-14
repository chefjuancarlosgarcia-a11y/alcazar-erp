# Sprint Performance — Semana 1 (entregables)

**Fecha:** 2026-07-13  
**Alcance implementado:** Track A, B, C · Medición D (instrumentación + script EXPLAIN) · Diseño E, F  
**No implementado:** board light RPC, caché global TTL, índices nuevos

---

## 1. Métricas antes / después

> Completar tras activar `VITE_ERP_PERF_DEBUG=true` y recargar tablero en frío.

### Antes (baseline documentado)

| Métrica | Valor |
|---------|------:|
| Tiempo interactivo tablero | ~7 940 ms (estimación usuario) |
| Empty state falso en carga | Sí |
| `get_operational_tasks_board` duplicado | Sí (StrictMode + focus) |
| `get_task_assignable_profiles` duplicado | Sí (Tasks.jsx + hijo) |
| `getActiveAreas` duplicado | Sí (Tasks.jsx + TaskBoard) |
| Skeleton Kanban | No |
| Focus cooldown 30 s | No |

### Después (medir y pegar salida de `__ERP_PERF__.funnel()`)

```text
# Pegar aquí tras medición:
__ERP_PERF__.funnel()
__ERP_PERF__.breakdown()
__ERP_PERF__.waterfall()
```

| Métrica | Antes | Después | Δ |
|---------|------:|--------:|--:|
| first_content_ms | | | |
| interactive_ms | ~7940 | | |
| get_operational_tasks_board request_ms | | | |
| payload_bytes | | | |
| row_count | | | |
| Requests duplicados (assignable/areas) | 2–4 | 1 c/u | |
| Empty state falso | Sí | 0 esperado | |

### Estimación de reducción (UX + red)

| Área | Reducción esperada | Evidencia |
|------|-------------------|-----------|
| UX percibida | Alta en cold load | Skeleton + no vaciar en refresh |
| Tiempo real interactivo | 10–25 % Semana 1 | Eliminar duplicados padre; focus cooldown |
| Número de requests | −2 a −4 por carga Trabajo | Tasks.jsx skip cuando `workActive` |
| Payload | Sin cambio Semana 1 | Board light pendiente Track E |

---

## 2. Track A — Skeleton y estados

**Archivos:**

- `frontend/src/pages/tasks/taskBoardViewState.js`
- `frontend/src/pages/tasks/TaskBoardSkeleton.jsx`
- `frontend/src/pages/tasks/TaskListSkeleton.jsx`
- `frontend/src/pages/tasks/TaskBoard.jsx`
- `frontend/src/pages/tasks/MyWork.jsx`
- `frontend/src/hooks/useOperationalTasks.js` (SWR)
- `frontend/src/pages/tasks/operationalTasks.css`

**Estados:**

| Estado | Comportamiento |
|--------|----------------|
| `initial-loading` | Skeleton Kanban/lista tras delay 200 ms |
| `background-refresh` | Datos visibles + "Actualizando…" |
| `success-with-data` | Tablero/lista normal |
| `success-empty` | Solo si `requestCompleted && !loading && !error && count=0` |
| `error-with-cache` | Banner + datos anteriores |
| `error-without-cache` | Panel error + Reintentar |

---

## 3. Track B — Duplicados eliminados

| Request | Origen antes | Archivo fix | Antes | Después | Ahorro estimado |
|---------|--------------|-------------|------:|--------:|----------------:|
| `getActiveAreas` | Tasks.jsx + TaskBoard | `Tasks.jsx` skip si `workActive` | 2 | 1 | ~80–150 ms |
| `get_task_assignable_profiles` | Tasks.jsx (manager) + hijo | `Tasks.jsx` skip si `workActive` | 2 | 1 | ~200–500 ms |
| `refreshChecklistModuleAccess` | Tasks.jsx mount | skip si `workActive` | 1 | 0 | ~50–100 ms |

**Nota StrictMode:** en dev React 18 puede duplicar effects; los duplicados **padre+hijo** son reales y están corregidos. StrictMode no se desactiva.

---

## 4. Track C — Cooldown focus

**Archivo:** `frontend/src/hooks/useOperationalTasksSync.js`

| Condición | Skip refetch |
|-----------|--------------|
| Última sync < 30 s | Sí |
| `isRefreshing` activo | Sí |
| `hasUnsavedEdits()` | Sí |
| Montaje < 5 s (grace) | Sí |
| Botón Actualizar | No (siempre disponible) |
| Post-mutación `refresh({ background })` | No afectado |

---

## 5. Track D — Medición SQL

**Script:** `supabase/tests/explain_operational_tasks_board.sql`

Ejecutar en **staging** y completar tabla de métricas en ese archivo (sección D).

**Frontend:** activar perf debug y documentar funnel en sección 1 de este doc.

---

## 6. Track E — Board light

Ver `docs/erp-performance-board-light-design.md`  
**Recomendación:** Opción B (`board_light`) tras EXPLAIN.

---

## 7. Track F — Caché SWR

Ver `docs/erp-performance-board-cache-design.md`  
**Recomendación:** `boardCache.js` + provider en Fase 1; TanStack Query solo si ≥3 módulos.

---

## 8. Build

```bash
cd frontend && npm run build
```

| Resultado | Estado |
|-----------|--------|
| Build OK | ✅ `npm run build` exit 0 |

---

## 9. Capturas requeridas (manual)

- [ ] Cold / initial-loading (skeleton)
- [ ] background-refresh (datos + Actualizando)
- [ ] success-with-data
- [ ] success-empty
- [ ] error-with-cache
- [ ] error-without-cache

---

## 10. Criterios de aceptación Semana 1

| Criterio | Estado |
|----------|--------|
| No tablero vacío durante carga | ✅ Implementado |
| Datos visibles en background refresh | ✅ Implementado |
| Duplicados reales reducidos | ✅ Tasks.jsx guard |
| Focus sin refetch innecesario | ✅ 30 s cooldown |
| Build OK | ✅ `npm run build` exit 0 (2026-07-13) |
| Checklists sin regresión | ✅ Sin cambios en módulo |
| Permisos intactos | ✅ Sin cambios SQL/RLS |
| EXPLAIN preparado | ✅ Script staging |
| Board light / caché global | 📋 Solo diseño |
