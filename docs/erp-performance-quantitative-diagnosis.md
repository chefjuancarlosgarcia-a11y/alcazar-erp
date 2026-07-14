# Diagnóstico cuantitativo de rendimiento — ERP

**Estado:** modelo arquitectónico + instrumentación lista · **mediciones reales pendientes de tu ronda**  
**Meta de producto:** tiempo interactivo **< 1.5 s** por módulo crítico  
**Hipótesis a validar:** 60–70 % Supabase/RPC/RLS · 20–30 % duplicados · ≤10 % render React

---

## 1. Embudo objetivo (formato)

Tras medir con `__ERP_PERF__.funnel()` verás algo así:

```
Tiempo total (interactivo)     ???? ms
↓
RPC Supabase (reloj de pared)  ???? ms  (?? %)
RPC más lento (crítico)        ???? ms
↓
REST / caché                   ???? ms
↓
Consultas duplicadas (estim.)  ???? ms  (?? %)
↓
Render React (estim.)          ???? ms  (≤10 % esperado)
↓
Skeleton                       0 ms     (no implementado hoy)
↓
Primer contenido visible       ???? ms
↓
Tiempo interactivo             ???? ms
↓
Imágenes                       ???? ms
```

**Comando tras cargar un módulo:**

```js
__ERP_PERF__.funnel()
__ERP_PERF__.breakdown()
```

---

## 2. Modelo estimado — Tablero Trabajo (~8 s percibidos)

> **⚠️ ESTIMACIÓN arquitectónica**, no medición tuya aún.  
> Ancla: impresión ~**7.9 s** hasta ver tarjetas en dev con StrictMode.

### Escenario: cold load dev, rol gerente, ~30–80 tarjetas

| Capa | Estimado (ms) | % del total | Confianza | Evidencia |
|------|-------------:|------------:|:---------:|-----------|
| **RPC Supabase (reloj de pared)** | **5 500 – 6 800** | **68 – 78 %** | Alta | `get_operational_tasks_board` agrega `operational_task_card_summary(t)` **por fila** + `can_access_operational_task` por fila |
| Consultas duplicadas (desperdicio) | **1 200 – 2 400** | **15 – 28 %** | Media-alta | `get_task_assignable_profiles` padre+hijo; StrictMode ×2; `getActiveAreas` ×2 |
| REST / caché (áreas, etc.) | **80 – 300** | **1 – 4 %** | Alta | `queryCache` en áreas |
| Render React | **250 – 450** | **3 – 6 %** | Media | Kanban + cards; sin virtualización |
| Imágenes (avatares) | **0 – 400** | **0 – 5 %** | Media | Avatares URL en tarjetas |
| Skeleton | **0** | **0 %** | — | No existe; columnas vacías = UX “borrado” |
| **Total interactivo** | **~6 500 – 8 500** | **100 %** | Media | Coherente con ~7.9 s |

### Desglose tipo tu ejemplo (si total = 7 940 ms)

| Capa | ms | % |
|------|---:|--:|
| Tiempo total interactivo | **7 940** | 100 % |
| ↳ RPC reloj de pared | **~6 200** | **78 %** |
| ↳ Desperdicio duplicados | **~1 400** | **18 %** |
| ↳ Render React | **~340** | **4 %** |
| ↳ Imágenes | **~0–390** | **0–5 %** |

**Nota:** En cliente, `request_ms` = red + procesamiento DB + RLS **juntos**. No se puede separar “6.8 s RPC” vs “400 ms red” sin logs de Supabase (`EXPLAIN ANALYZE`, Dashboard → Query performance).

---

## 3. Validación de tu hipótesis

| Hipótesis | Predicción | Estimación arquitectónica | ¿Se confirma? |
|-----------|------------|---------------------------|:-------------:|
| 60–70 % en Supabase/RPC/RLS | Sí | **68–78 %** en Tablero | **✅ Probable** |
| 20–30 % consultas repetidas | Sí | **15–28 %** (peor en dev/StrictMode) | **✅ Probable** |
| ≤10 % render React | Sí | **3–6 %** | **✅ Probable** |

### Conclusión anticipada (con evidencia de código)

**No hace falta reescribir el frontend** para pasar de ~8 s a ~1.5 s.

Hace falta:

1. **Pedir menos** en el primer paint (board bootstrap mínimo).
2. **Pedir en paralelo** lo que hoy es waterfall.
3. **Cachear** catálogos estables (perfiles asignables, etiquetas, áreas).
4. **Detalle bajo demanda** (`get_operational_task_detail` solo al abrir tarjeta).
5. **Eliminar duplicados** padre/hijo y StrictMode-aware en dev.

---

## 4. Por qué el Tablero es el cuello de botella #1

### SQL — costo por tarjeta en servidor

```sql
-- get_operational_tasks_board (183b)
select jsonb_agg(public.operational_task_card_summary(t) ...)
from assigned_tasks t
where ... and can_access_operational_task(t, 'view')
```

Por cada tarea visible:

- `can_access_operational_task` — permiso/RLS lógico
- `operational_task_card_summary` — assignees, labels, permisos, overdue
- `get_task_work_card_summary` — pasos + next step (subconsultas)

**Un solo RPC** en red, pero **O(n) trabajo en Postgres** con n = tarjetas del tablero.

### Frontend — waterfall actual (orden lógico)

```
Monta Tasks.jsx (shell)
  → probe checklist access
  → getActiveAreas
  → getTaskAssignableProfiles (si gerente)
Monta TaskBoard
  → get_operational_tasks_board     ← crítico, más pesado
  → getTaskAssignableProfiles       ← duplicado
  → getActiveAreas                  ← cache hit probable
  → get_task_labels_catalog         ← diferible
  → get_operational_task_detail     ← solo si ?task=
```

**Reloj de pared** ≈ max(paralelos) si fueran paralelos; hoy muchos arrancan en el mismo tick pero el board domina.

---

## 5. Estimaciones por módulo (cold, gerente)

| Módulo | Total est. (ms) | RPC dominante | % RPC est. | Duplicados est. |
|--------|----------------:|---------------|----------:|----------------:|
| **Trabajo Tablero** | 6 500 – 8 500 | `get_operational_tasks_board` | 70–78 % | Alto |
| **Trabajo Mi trabajo** | 2 000 – 4 000 | `get_my_operational_tasks` | 65–75 % | Medio |
| **Checklists** | 4 000 – 12 000 | `loadModuleChecklistRuns` + generate due | 75–85 % | Medio (2ª ola) |
| **Inventario** | 3 000 – 15 000 | `getInventoryItems` paginado | 80–90 % | Bajo |
| **Compras PO** | 2 000 – 6 000 | `purchase_orders` + `getInventoryItems` | 70–80 % | Alto (2× PO) |
| **RRHH Usuarios** | 1 500 – 4 000 | `profiles` full select | 75–85 % | Bajo |
| **POS Venta** | 800 – 2 000 | `getPOSProducts` (cache) | 50–70 % | Bajo |
| **Reportes Ejecutivo** | 1 500 – 5 000 | `getExecutiveDashboardReport` | 70–85 % | Bajo (cache 2m) |

Inventario y Checklists pueden **superar** al Tablero en ms absolutos según volumen de datos.

---

## 6. Objetivos cuantitativos del Sprint Performance

| Métrica | Hoy (est.) | Meta | Cómo medir |
|---------|------------|------|------------|
| Tablero `interactive_ms` | ~7 900 ms | **< 1 500 ms** | `__ERP_PERF__.funnel()` |
| Tablero `duplicated_requests` | 2–6 (dev) | **0** | `module_summary` |
| Tablero `requests_count` cold | 5–10 | **≤ 3** | waterfall |
| Checklists 1er paint | 4–12 s | **< 2 s** | funnel |
| Inventario catálogo | 3–15 s | **< 2 s** | funnel |
| Empty flash (UX) | Frecuente | **Nunca** | checklist manual |

---

## 7. Sprint Performance — backlog priorizado

**Antes de nuevas funciones en Trabajo.** ROI estimado por impacto en ms.

### Semana 1 — Quick wins (solo frontend, sin SQL)

| # | Tarea | Impacto est. | Archivos |
|---|-------|-------------|----------|
| 1 | Quitar duplicados: perfiles/áreas solo en hijo | **−0.5 – 1.5 s** | `Tasks.jsx` |
| 2 | Skeleton Kanban (no columnas vacías) | Percepción **−70 %** | `TaskBoard.jsx`, CSS |
| 3 | `stale-while-revalidate`: mantener tarjetas en refetch | Revisit **−80 %** | `useOperationalTasks.js` |
| 4 | Diferir `get_task_labels_catalog` hasta abrir picker | **−100 – 300 ms** | `TaskBoard.jsx` |
| 5 | Focus refresh: no refetch si < 30 s | **−1 s** en revisit foco | `useOperationalTasksSync.js` |

### Semana 2 — Caché cliente

| # | Tarea | Impacto est. |
|---|-------|-------------|
| 6 | `queryCache` para `get_task_assignable_profiles` (5 min) | −300–600 ms revisit |
| 7 | TTL 30–60 s board con invalidación en mutación | Revisit casi instantáneo |
| 8 | Misma estrategia inventario página 1 | −2–10 s revisit |

### Semana 3 — SQL con evidencia (post-medición)

| # | Tarea | Impacto est. | Requisito |
|---|-------|-------------|-----------|
| 9 | `get_operational_tasks_board_light` — sin work summary | **−30–50 %** RPC board | `EXPLAIN` antes/después |
| 10 | Bootstrap RPC: board + labels + areas en 1 round-trip | **−200–500 ms** wall | Medición waterfall |
| 11 | Índices solo si `EXPLAIN` muestra seq scan | Variable | No a ciegas |

### Semana 4 — UX ERP-wide

| # | Tarea |
|---|-------|
| 12 | Patrón loading unificado: skeleton → datos → empty real |
| 13 | Checklists: separar carga “Hoy” de library admin |
| 14 | Inventario: paginación server-first, no full scan cliente |

---

## 8. Qué NO hacer (ahorra semanas)

| Acción | Por qué no |
|--------|------------|
| Reescribir React / cambiar framework | Render es ~4 % del problema |
| Virtualizar tarjetas primero | No ayuda si RPC tarda 6 s |
| Crear índices sin `EXPLAIN` | Puede no tocar el plan real |
| Más campos en board RPC | Empeora payload y CPU |
| Nuevas features Trabajo antes del sprint | Empeora percepción producto |

---

## 9. Cómo convertir estimaciones en números reales

1. `VITE_ERP_PERF_DEBUG=true` + reiniciar dev  
2. [`erp-performance-measurement-round.md`](./erp-performance-measurement-round.md) — Módulo 1 Tablero  
3. Pegar en [`erp-performance-measurement-results.md`](./erp-performance-measurement-results.md)  
4. Ejecutar:

```js
__ERP_PERF__.startRound({ module: "trabajo-tablero", scenario: "cold" })
// ... cargar tablero ...
__ERP_PERF__.funnel()
```

5. Reemplazar `????` en este doc con valores de `breakdown()`

### Criterio de cierre hipótesis

| Métrica | Confirma hipótesis si |
|---------|----------------------|
| `shares.supabase_rpc_pct` (vs wall) | **≥ 60 %** |
| `duplicate_waste_ms` / `total_ms` | **≥ 15 %** |
| `shares.render_pct` | **≤ 10 %** |

---

## 10. Mensaje de producto

Un ERP que responde en **< 1.5 s** se siente profesional con menos funciones.  
Uno que tarda **8 s** se siente roto aunque el diseño sea excelente.

La inversión con **mayor retorno ahora** no es otro panel ni otro RPC de detalle: es un **Sprint Performance ERP-wide** con foco inicial en:

1. **Tablero** (RPC board + duplicados + skeleton)  
2. **Checklists** (2ª ola generate due)  
3. **Inventario** (full paginated fetch)

Tu intuición es correcta: **confirmarla con `__ERP_PERF__.funnel()` toma 15 minutos** en el Tablero.

---

## Referencias

- [Auditoría completa](./erp-performance-audit.md)
- [Ronda de medición](./erp-performance-measurement-round.md)
- [Plantilla resultados](./erp-performance-measurement-results.md)
