# Ronda de medición — rendimiento ERP (módulo por módulo)

**Objetivo:** capturar latencia real, duplicados, caché y UX de carga **antes** de optimizar.  
**Relacionado:** [`erp-performance-audit.md`](./erp-performance-audit.md) (diagnóstico y plan)  
**Plantilla de resultados:** [`erp-performance-measurement-results.md`](./erp-performance-measurement-results.md)

---

## 0. Preparación (una sola vez)

### Activar instrumentación

1. En `frontend/.env.development` descomentar o añadir:
   ```env
   VITE_ERP_PERF_DEBUG=true
   ```
2. Reiniciar dev server: `npm run dev`
3. Chrome/Edge DevTools → **Console** → filtro: `ERP PERF`
4. DevTools → **Network** → marcar **Disable cache** (solo para escenario *cold*)
5. Opcional: DevTools → **Performance** → grabar 5s en el primer módulo para validar

### Usuario de prueba recomendado

| Rol | Por qué |
|-----|---------|
| `gerente` o `admin` | Ve tablero, reportes, checklists library, asignación |
| Alternativa `supervisor` | Vista operativa sin todo el catálogo admin |

Anotar rol usado en la plantilla de resultados.

### Tres escenarios por módulo

| ID | Nombre | Pasos |
|----|--------|-------|
| **A** | Cold load | `__ERP_PERF__.clear()` → hard refresh (Ctrl+Shift+R) → esperar datos visibles |
| **B** | Revisit | Ir a otro módulo (ej. Dashboard) → volver **sin** refresh |
| **C** | Tab focus | Con módulo abierto → otra pestaña del navegador 10s → volver |

### Comandos de consola (copiar/pegar)

```js
// Iniciar ronda limpia antes de cada escenario
__ERP_PERF__.startRound({ module: "NOMBRE_MODULO", scenario: "cold" })

// Tras ver datos en pantalla (o 15s timeout)
__ERP_PERF__.summarize()
__ERP_PERF__.funnel()          // embudo: RPC / duplicados / render / imágenes
__ERP_PERF__.breakdown()       // objeto JSON con shares %
await __ERP_PERF__.copyWaterfall() // pega en measurement-results.md

// Backup JSON completo
copy(JSON.stringify(__ERP_PERF__.export(), null, 2))
```

Pegar salida en [`erp-performance-measurement-results.md`](./erp-performance-measurement-results.md).

### Qué observar además de ms

| Pregunta | Valores |
|----------|---------|
| ¿Viste grid/lista vacía antes de datos? | sí / no |
| ¿Mensaje “no hay datos” mientras cargaba? | sí / no |
| ¿Spinner o solo texto “Cargando…”? | spinner / texto / ninguno |
| `duplicated_requests` en summary | número |
| `cache_hit` en escenario B | sí / no |

### StrictMode (importante)

En **desarrollo**, React monta efectos **2 veces** → puedes ver requests duplicados que **no existen en producción**.  
Si `duplicated_requests > 0` en escenario A, repetir una vez con build preview:

```bash
cd frontend && npm run build && npm run preview
```

Anotar si el duplicado desaparece en preview.

---

## Orden sugerido de la ronda

Hacer **en este orden** para no mezclar caché entre módulos relacionados:

1. Trabajo — Tablero  
2. Trabajo — Mi trabajo  
3. Checklists  
4. Inventario — Catálogo  
5. Compras — Órdenes  
6. RRHH — Usuarios  
7. POS — Venta  
8. POS — Catálogo admin  
9. Reportes — Ejecutivo  

Tiempo estimado: **~45–60 min** (3 escenarios × 9 módulos).

---

## Módulo 1 — Trabajo / Tablero

| Campo | Valor |
|-------|-------|
| URL | `/tasks/trabajo/tablero` |
| `module` en `startRound` | `trabajo-tablero` |
| Rol | gerente / admin |

### Pasos escenario A (cold)

1. `__ERP_PERF__.startRound({ module: "trabajo-tablero", scenario: "cold" })`
2. Navegar a `/tasks/trabajo/tablero` (o hard refresh si ya estás ahí)
3. Esperar hasta que las tarjetas aparezcan en columnas (máx 15s)
4. `summarize()` + `copyWaterfall()`

### Pasos escenario B (revisit)

1. Ir a `/dashboard`
2. `startRound({ module: "trabajo-tablero", scenario: "revisit" })`
3. Volver a `/tasks/trabajo/tablero` sin refresh
4. Exportar waterfall

### Pasos escenario C (focus)

1. En tablero con datos visibles
2. `startRound({ scenario: "focus" })`
3. Cambiar a otra pestaña del navegador 10s → volver
4. Esperar 5s adicionales (debounce foco Trabajo ~2.5s)
5. Exportar waterfall

### Requests esperados (hipótesis — marcar presente/ausente)

| Request | ¿1er render? |
|---------|:------------:|
| `rpc:get_operational_tasks_board` | ✓ |
| `rpc:get_task_assignable_profiles` | |
| `rest:/areas` o cache `areas:active` | |
| `rpc:get_task_labels_catalog` | |
| `rpc:get_operational_task_detail` | solo con `?task=` |

### UX a documentar

- [ ] Columnas Kanban vacías mientras carga  
- [ ] Texto “Cargando tablero…” visible  

---

## Módulo 2 — Trabajo / Mi trabajo

| Campo | Valor |
|-------|-------|
| URL | `/tasks/trabajo/mi-trabajo` |
| `module` | `trabajo-mi-trabajo` |

Mismos escenarios A/B/C.

### Requests esperados

| Request | ¿1er render? |
|---------|:------------:|
| `rpc:get_my_operational_tasks` | ✓ |
| `rpc:get_task_assignable_profiles` | |
| `rpc:get_task_labels_catalog` | |
| `rpc:get_operational_task_detail` | con `?task=` |

---

## Módulo 3 — Checklists (+ procesos operativos)

| Campo | Valor |
|-------|-------|
| URL | `/tasks?tab=checklists` |
| `module` | `checklists` |

### Pasos adicionales

- Tras cold load, anotar si la vista **Hoy** apareció vacía antes del chip “Cargando”
- Si tienes permiso library: cambiar sub-tab a **Checklists** (plantillas) y anotar segunda ola de requests

### Requests esperados (pueden ser muchos)

| Request | Notas |
|---------|-------|
| `checklist_runs` (REST/RPC) | Core |
| `getChecklistProfiles` | |
| `getChecklistTemplates` | si library |
| `getOperationalProcessRunsForDate` | procesos |
| `generateDueChecklistRuns` | post-carga |
| `getChecklistCoverageForRuns` | post-carga |

---

## Módulo 4 — Inventario / Catálogo

| Campo | Valor |
|-------|-------|
| URL | `/inventory` o `/inventory?section=inventario` |
| `module` | `inventario-inventario` |

### Requests esperados

| Request | ¿1er render? | Cache |
|---------|:------------:|:-----:|
| `getInventoryItems` (paginado) | ✓ | no |
| `getActiveAreas` | | sí |
| `getInventoryMovements` | | no |
| `getSuppliers` | | sí |
| `getActiveInventoryCategories` | parcial | sí |

### Nota

Este módulo suele ser el de **mayor payload**. Anotar `payload_bytes` total aproximado en summary.

---

## Módulo 5 — Compras / Órdenes de compra

| Campo | Valor |
|-------|-------|
| URL | `/inventory?section=ordenes` |
| `module` | `inventario-ordenes` (LegacyInventoryApp) |

### Pasos

1. Cold load en sección órdenes
2. Anotar si la lista PO muestra empty antes de datos
3. **Opcional:** abrir con deep link de notificación si tienes uno (`?po=` o similar) — buscar duplicado `getPurchaseOrders`

### Requests esperados

| Request | Notas |
|---------|-------|
| `purchase_orders` select | 1–2× sospechado |
| `getInventoryItems` | picker manual |

---

## Módulo 6 — RRHH / Usuarios

| Campo | Valor |
|-------|-------|
| URL | `/hr?section=usuarios` |
| `module` | `rrhh-usuarios` |
| Rol | admin / rrhh |

### Requests esperados

| Request | Cache |
|---------|:-----:|
| `profiles` select `*` | no |
| `getAttendanceTerminalProfiles` | no |
| `getActiveAreas` | sí |

---

## Módulo 7 — POS / Venta

| Campo | Valor |
|-------|-------|
| URL | `/pos` o `/pos?section=pos` |
| `module` | `pos-pos` |

### Requests esperados

| Request | Cache |
|---------|:-----:|
| POS products catalog | sí 5m |
| `getProductionAreas` | sí |
| `getActiveRecipes` | sí |

Complementar con filtro consola `[POS PERF]` si catálogo admin se mide aparte.

---

## Módulo 8 — POS / Catálogo admin

| Campo | Valor |
|-------|-------|
| URL | `/pos?section=agregar-item` |
| `module` | `pos-agregar-item` |

### Pasos

1. Cold load página 1 del catálogo
2. Cambiar búsqueda o página → anotar nuevo `getPOSCatalogPage`
3. Usar `[POS PERF]` existente + `[ERP PERF]`

---

## Módulo 9 — Reportes / Ejecutivo

| Campo | Valor |
|-------|-------|
| URL | `/reports` (tab `executive` por defecto gerente) |
| `module` | `reportes` |

### Pasos

1. Cold load tab ejecutivo
2. Cambiar a tab **Compras** o **Inventario** → anotar `setData(null)` visual (flash)
3. Escenario B: volver a reportes desde dashboard

### Requests esperados

| Tab | Request principal |
|-----|-----------------|
| executive | `getExecutiveDashboardReport` (cache 2m) |
| purchases | `purchase_orders` |
| inventory | `area_inventory` + movements |

---

## Criterios de éxito de la ronda

La ronda está **completa** cuando en `erp-performance-measurement-results.md`:

- [ ] 9 módulos × 3 escenarios documentados (o N/A con motivo)
- [ ] Tabla waterfall pegada por cada escenario A
- [ ] Columna UX (empty flash sí/no) llena
- [ ] Top 5 requests más lentos identificados globalmente
- [ ] Lista de duplicados confirmados (dev vs preview)
- [ ] Decisión: ¿Fase B (UX) o Fase C (duplicados) primero?

---

## Después de medir

1. Completar tablas en [`erp-performance-measurement-results.md`](./erp-performance-measurement-results.md)
2. Actualizar [`erp-performance-audit.md`](./erp-performance-audit.md) § waterfalls con **ms reales**
3. Priorizar intervenciones solo con evidencia
4. **Desactivar** `VITE_ERP_PERF_DEBUG` al terminar la ronda diaria

---

## Atajos rápidos

| Acción | Comando |
|--------|---------|
| Limpiar log | `__ERP_PERF__.clear()` |
| Nueva ronda | `__ERP_PERF__.startRound({ module, scenario })` |
| Resumen sesión | `__ERP_PERF__.summarize()` |
| Tabla markdown | `__ERP_PERF__.waterfall()` |
| Copiar tabla | `await __ERP_PERF__.copyWaterfall()` |
| JSON completo | `copy(JSON.stringify(__ERP_PERF__.export(), null, 2))` |
