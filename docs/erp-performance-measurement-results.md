# Resultados — ronda de medición ERP

**Fecha:** _______________  
**Medidor:** _______________  
**Rol de prueba:** _______________  
**Entorno:** dev / preview / producción  
**VITE_ERP_PERF_DEBUG:** true / false  
**StrictMode duplicados en dev:** sí / no / no verificado  

---

## Resumen global (completar al final)

| Métrica | Valor |
|---------|------:|
| Módulos medidos | /9 |
| Request más lento (nombre) | |
| request_ms máximo | |
| Módulo con peor first_contentful_ms | |
| Total duplicated_requests (cold, todos) | |
| Módulos con empty flash | |
| ¿Caché útil en revisit? (módulos con cache_hit) | |

### Top 5 requests más lentos (cold)

| # | Módulo | Request | request_ms | payload_bytes | row_count |
|---|--------|---------|----------:|-------------:|----------:|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

### Duplicados confirmados

| Request | Módulo | Escenario | ¿Dev only? | Archivo sospechoso |
|---------|--------|-----------|:----------:|-------------------|
| | | | | |

### Decisión post-ronda

- [ ] Prioridad 1: Fase B — UX loading/skeletons  
- [ ] Prioridad 1: Fase C — eliminar duplicados  
- [ ] Prioridad 1: Fase D — bootstrap RPC  
- [ ] Prioridad 1: Fase E — caché  

**Notas:**

---

## Módulo 1 — Trabajo / Tablero

**URL:** `/tasks/trabajo/tablero`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| interactive_ms | |
| requests_count | |
| duplicated_requests | |
| component_render_count | |
| Empty flash antes de datos | sí / no |
| Mensaje “no hay datos” incorrecto | sí / no |

<details>
<summary>Waterfall A (pegar markdown)</summary>

_Pegar salida de `__ERP_PERF__.copyWaterfall()`_

</details>

### Escenario B — Revisit

| Campo | Valor |
|-------|------:|
| requests_count | |
| cache_hit observado | sí / no |
| Tiempo percibido vs A | más rápido / igual / más lento |

<details>
<summary>Waterfall B</summary>

</details>

### Escenario C — Tab focus

| Campo | Valor |
|-------|------:|
| Refetch tras volver | sí / no |
| requests_count | |
| refetch_reason en log | |

<details>
<summary>Waterfall C</summary>

</details>

---

## Módulo 2 — Trabajo / Mi trabajo

**URL:** `/tasks/trabajo/mi-trabajo`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| interactive_ms | |
| requests_count | |
| duplicated_requests | |
| Empty flash | sí / no |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

| cache_hit | |
| requests_count | |

### Escenario C — Focus

| Refetch | sí / no |

---

## Módulo 3 — Checklists

**URL:** `/tasks?tab=checklists`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| interactive_ms | |
| requests_count | |
| Segunda ola post-generateDue | sí / no |
| “Hoy” vacío al inicio | sí / no |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

### Escenario C — Focus + realtime

| Realtime refresh silencioso | sí / no |

---

## Módulo 4 — Inventario / Catálogo

**URL:** `/inventory?section=inventario`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| requests_count | |
| payload total estimado (sum bytes) | |
| Paginas getInventoryItems | |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

### Escenario C — Focus

---

## Módulo 5 — Compras / Órdenes

**URL:** `/inventory?section=ordenes`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| requests_count | |
| getPurchaseOrders duplicado | sí / no |
| getInventoryItems en mismo mount | sí / no |
| Lista PO sin loading gate | sí / no |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

### Escenario C — Focus

---

## Módulo 6 — RRHH / Usuarios

**URL:** `/hr?section=usuarios`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| requests_count | |
| profiles full table bytes | |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

### Escenario C — Focus

---

## Módulo 7 — POS / Venta

**URL:** `/pos?section=pos`

### Escenario A — Cold

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| requests_count | |
| cache_hit en productos | sí / no |

<details>
<summary>Waterfall A</summary>

</details>

### Escenario B — Revisit

### Escenario C — Focus

---

## Módulo 8 — POS / Catálogo admin

**URL:** `/pos?section=agregar-item`

### Escenario A — Cold (página 1)

| rpc_ms [POS PERF] | |
| payload_bytes | |

<details>
<summary>Waterfall A + [POS PERF]</summary>

</details>

### Cambio de página/filtro

| Segundo request_ms | |

---

## Módulo 9 — Reportes / Ejecutivo

**URL:** `/reports`

### Escenario A — Cold (tab executive)

| Campo | Valor |
|-------|------:|
| first_contentful_module_render_ms | |
| requests_count | |
| executive cache_hit | sí / no |
| Flash al cambiar tab | sí / no |

<details>
<summary>Waterfall A</summary>

</details>

### Tab secundario probado: _______________

| requests_count | |

### Escenario B — Revisit

### Escenario C — Focus

---

## JSON backups (opcional)

_Guardar exports grandes como archivos en `docs/perf-samples/YYYY-MM-DD/` si hace falta._

| Módulo | Escenario | Archivo / nota |
|--------|-----------|----------------|
| | | |
