# Sprint UX #1 — Remediación ERP UI Spacing System v1.0

**Backlog oficial:** [ui-audit.md](./ui-audit.md)  
**Spec:** [erp-ui-spacing-system.md](./erp-ui-spacing-system.md) · `frontend/src/styles/erp-ui-spacing.css`  
**Fecha plan:** 2026-06-09 · **Sprint UX #1 completado (código):** 2026-06-09  
**Alcance del sprint:** 3 módulos P1 — sin tocar lógica, Supabase ni SQL.

---

## Objetivo

Alinear **Legacy áreas**, **InventoryBase** y **Caja** al ERP UI Spacing System v1.0, priorizando:

1. Spacing (tokens `--erp-space-*`, múltiplos de 8, sin 3/5/7/11/13/17/19/27px)
2. Responsive (breakpoints **767 / 1024 / 1440**)
3. Botones táctiles (**44 / 48 / 52px** según breakpoint)
4. Inputs (`--erp-input-height`)
5. Cards (`.erp-card`, `.erp-card-grid`, padding 16px, radius 12px)
6. Tablas → **cards en mobile** (≤767px)

---

## Restricciones

| Permitido | Prohibido |
|-----------|-----------|
| CSS nuevo/refactor | Cambiar handlers, state, flujos |
| Clases del design system en JSX | Migraciones SQL / RPC |
| Reorganizar markup **solo** si es presentacional | Cambiar llamadas Supabase o servicios |
| Extraer inline styles → CSS | Rediseño funcional (nuevos campos, tabs, rutas) |

---

## Referencia interna (copiar patrón)

| Patrón | Archivo modelo |
|--------|----------------|
| Tokens + import spacing | `modules/purchase-orders/PurchaseOrders.css` |
| KPI + filtros + card grid en JSX | `modules/suppliers/SuppliersModule.jsx` + `Suppliers.css` |
| Tabla desktop + cards mobile | `modules/attendance/AttendanceReports.css` (`.attendance-reports-mobile-list`) |

---

## Orden de trabajo sugerido

```
1. Legacy áreas   → desbloquea ruta /inventory?section=areas (bug estilos huérfanos)
2. InventoryBase  → mayor superficie; beneficia inventarioAreas/movimientos vía CSS compartido
3. Caja           → tablas de cobro + tabs; validar en viewport real
```

---

## Definition of Done (sprint)

- [x] Cero referencias a estilos inline/`style={}` en bloque áreas de Legacy (login legacy fuera de scope)
- [x] `InventoryBase.css` importa tokens de `erp-ui-spacing.css`
- [x] Breakpoints unificados en InventoryBase: `767px` / `1024px`
- [x] Inputs y botones principales en InventoryBase usan `var(--erp-input-height)` / `var(--erp-btn-height)`
- [x] Listados mobile InventoryBase: productos y movimientos como cards (≤767px)
- [ ] `npm run build` OK
- [ ] Smoke manual en desktop + tablet (768px) + mobile (375px) por módulo (checklist abajo)
- [ ] Actualizar filas en `ui-audit.md` (estado post-sprint) — tarea doc al cerrar sprint

---

## Módulo 1 — Legacy áreas operativas ✅ Implementado

**Ruta:** `/inventory?section=areas`  
**Archivos:** `frontend/src/modules/areas/AreasModule.jsx`, `Areas.css`, `LegacyInventoryApp.jsx` (integración)  
**Estado post-sprint:** spacing **Sí** · grid **Sí** · mobile **Sí** · prioridad **P1** cerrada en este módulo

### Deuda técnica detectada (prerrequisito) — resuelta

Referencias rotas (`hrFilterGridStyle`, `inputStyle`, `passwordOptionStyle`, `attendanceWarningStyle`) eliminadas; formulario migrado a clases ERP.

### Checklist — Spacing

- [x] Crear `frontend/src/modules/areas/Areas.css` con `@import "../../styles/erp-ui-spacing.css"`
- [x] Reemplazar `cardStyle` del bloque áreas por `.erp-form-section` (padding 24px, gap 16px)
- [x] Sustituir gaps arbitrarios por tokens `--erp-space-*`
- [x] Badge activo/inactivo: `.erp-badge` / `.erp-badge--success` (radius 8px)
- [x] Eliminar `box-shadow` exagerado en cards registradas
- [x] Wrapper: `.erp-section-stack--large` (sin doble padding con shell legacy)

### Checklist — Grid / Cards

- [x] Extraer JSX a `AreasModule.jsx` (handlers en Legacy)
- [x] Formulario: `.erp-form-grid` (1 / 2 / 3 cols)
- [x] Listado: `.erp-card-grid` (1 / 2 / 3–4 cols vía `erp-ui-spacing.css`)
- [x] Cards con `.erp-card`, `.erp-card__header`, `.erp-card__body`, `.erp-card__footer`
- [x] `inventarioAreas` legacy inline sin cambios (fuera de scope)

### Checklist — Inputs

- [x] Campos con `.erp-field` + `var(--erp-input-height)`
- [x] Checkboxes: `.areas-checkbox-row` gap 16px
- [x] Labels gap 8px vía `.erp-field`

### Checklist — Botones

- [x] Crear / Actualizar / Cancelar: `.erp-btn` `--primary` / `--secondary`
- [x] Acciones card: `.erp-btn` + modifiers; full-width mobile
- [x] Eliminados `registeredArea*ButtonStyle` inline

### Checklist — Responsive

- [x] Breakpoints vía clases globales + `@media (max-width: 767px)` en `Areas.css`
- [x] Formulario 1 col mobile; card grid 1 col mobile
- [x] Tablet 2 cols; desktop 3–4 cols en `.erp-card-grid`

### Checklist — Limpieza Legacy

- [x] Removidos `registeredAreasGridStyle`, `registeredArea*Style`, `areaOptionRowStyle`
- [x] Removidas referencias rotas HR
- [x] **Conservados** (usados por `inventarioAreas`): `areaDashboardGridStyle`, `areaDashboardCardStyle`, badges
- [x] Handlers sin cambios: `guardarArea`, `editarArea`, `desactivarArea`, `cargarAreasSupabase`, `puedeAdministrarAreas`

### Smoke test — Áreas (manual pendiente)

- [ ] Desktop: crear área, editar, desactivar (excepto almacén)
- [ ] Tablet: formulario usable sin scroll horizontal
- [ ] Mobile: cards apiladas, botones ≥52px, sin overflow horizontal
- [ ] Links “Ver inventario” siguen navegando a rutas modernas

---

## Módulo 2 — InventoryBase ✅ Implementado

**Rutas:** `/inventory?section=inventario` · `inventarioAreas` · `movimientosInventario`  
**Archivos:** `frontend/src/pages/InventoryBase.jsx`, `frontend/src/pages/InventoryBase.css`  
**Consumidores CSS compartidos:** `InternalProduction.jsx` (hereda estilos tokenizados)  
**Estado post-sprint:** spacing **Sí** · grid **Parcial** (tabla desktop + cards mobile) · mobile **Sí** · prioridad **P1** cerrada en este módulo

### Checklist — Spacing (shell y tokens)

- [x] `@import "../styles/erp-ui-spacing.css"` al inicio de `InventoryBase.css`
- [x] `.inventory-base`: gap/padding con tokens ERP
- [x] Headers/acciones: `gap: var(--erp-space-16)`
- [x] Alerts: padding 16px, radius 12px, gap 16px
- [x] Valores prohibidos corregidos en todo el archivo (3/5/6/7/9/10/11/13/14/15/17/18/20/22px → múltiplos de 8)

### Checklist — Grid / Cards — Sección `inventario`

- [x] Desktop: tabla densa conservada con filas tokenizadas (48px / padding 16px)
- [x] KPI inversión: `.erp-kpi-card` en resumen
- [x] Filtros: `.erp-search-input` + select tokenizado

### Checklist — Grid / Cards — Sección `inventarioAreas`

- [x] Controles y líneas tokenizados (gap 8/16px, botones `--erp-btn-height`)
- [x] Tabs áreas: min-height token
- [ ] Migración completa a `.erp-card-grid` — diferido (fuera de alcance conservador)

### Checklist — Grid / Cards — Sección `movimientosInventario`

- [x] Desktop: tabla/historial conservada
- [x] Mobile ≤767px: `.inventory-movement-row` con `data-label` → cards

### Checklist — Inputs

- [x] Regla global input/select/textarea con `--erp-input-height`
- [x] `.inventory-field`: gap 8px
- [x] Textarea: `--erp-textarea-min` (120px)
- [ ] Modal producto reorganizado en `.erp-form-section` — diferido (modal funcional sin cambio estructural)

### Checklist — Botones

- [x] Botones base: `--erp-btn-height`, padding `0 16px`, radius 8px
- [x] `.inventory-row-actions button`: min-height token
- [x] FAB mobile: right 16px, padding tokenizado
- [x] Tabs áreas: min-height token

### Checklist — Responsive

- [x] `920px` → `1024px` (scroll horizontal tabla tablet)
- [x] `620px` → `767px`
- [x] ≤767px productos: cards con `data-label` por celda
- [x] ≤767px movimientos: cards label + valor
- [x] 768–1024px: panel grid 1 col, import preview 2 cols

### Checklist — Sin lógica

- [x] Handlers sin cambios (solo markup presentacional: `data-label`, clases)
- [x] Modales/validaciones intactos
- [ ] Smoke manual InternalProduction — pendiente

### Smoke test — InventoryBase (manual pendiente)

- [ ] `inventario`: listar, filtrar, crear/editar producto, desactivar
- [ ] `inventarioAreas`: cambiar área tab, ajuste stock si aplica
- [ ] `movimientosInventario`: listado historial
- [ ] Mobile 375px: sin scroll horizontal en listado productos
- [ ] Realtime badge “En vivo” visible

---

## Módulo 3 — Caja (`Cashier`) ✅ Implementado

**Rutas:** `/cash`, `/cashier`  
**Archivos:** `frontend/src/pages/Cashier.jsx`, `frontend/src/pages/Cashier.css`  
**Estado post-sprint:** spacing **Sí** · grid **Parcial** · mobile **Sí** · prioridad **P1** cerrada en este módulo

### Checklist — Spacing

- [x] `@import "../styles/erp-ui-spacing.css"`
- [x] `.cashier-page`: gap/padding tokens ERP
- [x] Paneles: padding 16px, radius 12px
- [x] Tabs: gap/padding 8px, radius 12px
- [x] Feedback: padding 16px
- [x] Valores prohibidos corregidos en todo el archivo

### Checklist — Grid / Cards

- [x] Dashboard `.cashier-metrics`: `.erp-kpi-grid` + `.erp-kpi-card`
- [x] Solicitudes: grid tokenizado; 1 col mobile
- [x] Terminal cobro: jerarquía hero → orden → pago conservada

### Checklist — Tablas mobile

- [x] Desktop: tabla con header/fila tokenizados (52px / 48px, padding 8px 16px)
- [x] ≤767px: tabla → cards vía CSS + `data-label` en `<td>` (sin dual DOM)
- [x] Totales/propina: stack vertical mobile en filas editables

### Checklist — Inputs

- [x] Inputs/select/textarea: `--erp-input-height`
- [x] Denominaciones arqueo: altura token
- [x] Modo pago: min-height token

### Checklist — Botones

- [x] Tabs, acciones, confirmar pago: `--erp-btn-height` (confirm ≥56px desktop)
- [x] Badge contador tab: padding `0 8px`
- [x] Mobile: acciones cobro full-width

### Checklist — Responsive

- [x] `980px` → `1024px`
- [x] Bloque `@media (max-width: 767px)` con cards ítems
- [x] Hero meta: 2 cols tablet, 1 col mobile
- [x] KPI 5 cols en ≥1440px

### Checklist — Sin lógica

- [x] Handlers, cálculos, split, POS, sesión intactos
- [x] CashManagement no tocado

### Smoke test — Caja (manual pendiente)

- [ ] Abrir caja → dashboard métricas
- [ ] Tab solicitudes: aprobar/rechazar
- [ ] Cobrar mesa: tabla desktop OK; mobile cards legibles
- [ ] Efectivo / tarjeta / pago mixto
- [ ] Arqueo / denominaciones si rol lo permite
- [ ] 375px sin overflow horizontal

---

## Matriz de entrega sprint

| Módulo | Archivos nuevos (estimado) | Archivos modificados | Riesgo regresión | Estado |
|--------|---------------------------|----------------------|------------------|--------|
| Legacy áreas | `modules/areas/AreasModule.jsx`, `Areas.css` | `LegacyInventoryApp.jsx` | Medio — permisos admin | ✅ Entregado |
| InventoryBase | — | `InventoryBase.css`, `InventoryBase.jsx` | Alto — InternalProduction | ✅ Entregado |
| Caja | — | `Cashier.css`, `Cashier.jsx` | Alto — flujo cobro | ✅ Entregado |

---

## Fuera de scope (Sprint UX #1)

- POS, Legacy login, órdenes de compra, proveedores (ya parcialmente alineados)
- ProfileManagement, Schedule, Tasks, Reportes
- `MainLayout` / sidebar global
- Migrar `inventarioAreas` legacy inline en `LegacyInventoryApp` (L2048–2076)
- Cambiar copy, permisos, validaciones de negocio

---

## Sprint UX #2 (preview — no ejecutar aún)

POS → Control de caja → Recetas/Requisiciones → Perfiles RRHH (según [ui-audit.md](./ui-audit.md) fase 1 remediación).

---

## Registro de avance

| Ítem | Responsable | Estado | Notas |
|------|-------------|--------|-------|
| Legacy áreas — CSS + componente | | ✅ Implementado | Bug estilos huérfanos corregido; build OK |
| InventoryBase — tokens + breakpoints | | ✅ Implementado | Build OK |
| InventoryBase — mobile productos/movimientos cards | | ✅ Implementado | `data-label` en celdas |
| Caja — tokens + KPI grid | | ✅ Implementado | `.erp-kpi-grid` dashboard |
| Caja — items table → mobile cards | | ✅ Implementado | CSS + `data-label` |
| Build + smoke | | ◐ Parcial | `npm run build` OK ×3 módulos; smoke manual pendiente |
| Actualizar ui-audit.md | | ☐ Pendiente | Al cierre sprint completo |
