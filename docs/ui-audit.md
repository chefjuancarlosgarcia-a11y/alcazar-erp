# Auditoría UI ERP — ERP UI Spacing System v1.0

**Fecha:** 2026-06-09 · **Actualizado post Sprint UX #1:** 2026-06-09  
**Alcance:** Todo el frontend operativo (`frontend/src/`).  
**Modo:** Auditoría estática + registro de remediación Sprint UX #1.

**Referencias obligatorias:**
- `docs/erp-ui-spacing-system.md`
- `frontend/src/styles/erp-ui-spacing.css`
- `.cursor/rules/erp-ui-spacing-system.mdc`

**Metodología:** Revisión estática de CSS/JSX por módulo de ruta; conteo de tokens `--erp-space-*`, clases del sistema (`.erp-page-shell`, `.erp-kpi-grid`, `.erp-card-grid`, `.erp-form-grid`), valores prohibidos (3, 5, 7, 11, 13, 17, 19, 27px), spacing no múltiplo de 8, breakpoints `@media`, patrones grid vs listas/tablas, e inline styles.

**Archivos CSS analizados:** 36 (+ tokens). **Páginas/módulos de ruta:** 28.

---

## Sprint UX #1 — Estado (cerrado)

| Módulo | Ruta / archivos | Estado | Entregable |
|--------|-----------------|--------|------------|
| **Áreas operativas** | `/inventory?section=areas` · `AreasModule.jsx`, `Areas.css` | **Corregido** | Tokens, `.erp-card-grid`, formulario por secciones |
| **InventoryBase** | `inventario`, `inventarioAreas`, `movimientos` · `InventoryBase.css` | **Corregido** | Tokens, breakpoints 767/1024, cards mobile productos/movimientos |
| **Caja** | `/cash`, `/cashier` · `Cashier.css` | **Corregido** | Tokens, KPI grid, tabla ítems → cards ≤767px |

**Detalle implementación:** [ui-remediation-sprint-1.md](./ui-remediation-sprint-1.md)

### Cola Sprint UX #2 (pendiente)

| Módulo | Archivo principal | Prioridad audit |
|--------|-------------------|-----------------|
| POS | `POS.css`, `POS.jsx` | P1 |
| ProfileManagement | `ProfileManagement.css` | P2 |
| ScheduleManagement | `ScheduleManagement.css` | P2 |
| Tasks | `Tasks.css` | P2 |
| Reports | `ReportsDashboard.css` | P3 |

**Fuera de alcance Sprint #1 (sin cambios):** Legacy órdenes/login shell, POS, CashManagement, Control de caja, Recetas, Requisiciones.

---

## Resumen ejecutivo

| Métrica | Resultado |
|---------|-----------|
| Módulos con cumplimiento **spacing ≥ parcial** | **7 de 28** (~25%) — ↑ tras Sprint UX #1 |
| Módulos que usan clases del sistema en JSX | **5** (Proveedores, Reportes asistencia, Áreas, InventoryBase parcial, Caja KPI) |
| Archivos CSS con tokens `--erp-space-*` | **7** (`erp-ui-spacing.css`, `Suppliers.css`, `PurchaseOrders.css`, `AttendanceReports.css`, `Areas.css`, `InventoryBase.css`, `Cashier.css`) |
| Archivos CSS con valores prohibidos | **~33 de 35** (excl. tokens puros) |
| Breakpoints alineados (768 / 1024 / 1440) | **Minoría** — predominan 620–920px, 700px, 1050px, etc. |

### Cumplimiento global por criterio

| Criterio | Sí | Parcial | No |
|----------|-----|---------|-----|
| Spacing (tokens / múltiplos de 8) | 2 | 5 | 21 |
| Grid (card/KPI/form según spec) | 3 | 6 | 19 |
| Mobile (≤767px) | 2 | 8 | 18 |
| Tablet (768–1024px) | 2 | 7 | 19 |
| Desktop (≥1440px) | 3 | 6 | 19 |

### Prioridad de remediación sugerida

| Prioridad | Módulos |
|-----------|---------|
| **P1 — Crítica** | POS, Legacy shell (órdenes/login) — *Caja, Inventario base y Áreas remediados en Sprint #1* |
| **P2 — Alta** | Productos/movimientos, Recetas, Requisiciones, Perfiles RRHH, Planilla, Tareas (tokens) |
| **P3 — Media** | Reportes ejecutivos, Producción/KDS, Terminal asistencia, Configuración |
| **P4 — Baja** | Dashboard, Auth, Layout chrome, Cuenta, Metas ventas |

---

## Leyenda de columnas

| Valor | Significado |
|-------|-------------|
| **Sí** | Cumple la regla v1.0 en la mayor parte del módulo |
| **Parcial** | Estructura correcta pero spacing/breakpoints/táctil inconsistentes |
| **No** | Legacy dominante; no usa tokens ni patrones del sistema |

---

## Shell y navegación

### Layout global (`MainLayout`, `App.css`, `Sidebar`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Parcial** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `MainLayout.css`: botón menú móvil `padding: 10px 13px`, `border-radius: 9px` (prohibido 13px; radius ≠ 12px).
- `App.css` / `index.css`: drawer sidebar en `max-width: 1024px` ✓; padding contenido no unificado con `--erp-page-padding-*`.
- `Sidebar.css`: acento `inset 3px` (micro fuera de token 4px).
- No usa `.erp-page-shell` en contenedor principal.

**Prioridad:** P4

---

### Dashboard (`/dashboard`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Parcial** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- Usa `.erp-card` de `erp-theme.css` con `gap: 12px`, `padding-top: 10px` en filas — no tokens.
- `dashboard-goal-grid` sin breakpoints documentados del sistema; widgets en `GoalWidgets.css` con `gap`/`padding` arbitrarios (10–14px).
- Sin KPI grid estándar (`.erp-kpi-grid`); estructura header → acciones → widgets ✓ parcialmente.

**Prioridad:** P4

---

## Inventario

### Productos / ingredientes (`InventoryBase` — `inventario`, `inventarioAreas`, `movimientos`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Sí** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Estado:** **Corregido** (Sprint UX #1 — 2026-06-09)

**Remediado:**
- `InventoryBase.css` importa `erp-ui-spacing.css`; tokens en shell, inputs, botones, alerts.
- Breakpoints **767 / 1024** (antes 620 / 920).
- Productos y movimientos: **cards mobile** con `data-label` en celdas.
- Tabla densa conservada en desktop (auditoría §7).

**Pendiente menor (Sprint #2+):** card grid desktop por producto; modal producto en `.erp-form-section`; `inventarioAreas` → `.erp-card-grid` completo.

**Prioridad:** P4 (deuda residual)

---

### Proveedores (`SuppliersModule` — `/inventory?section=proveedores`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Sí** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Sí** |
| Cumple desktop | **Sí** |

**Problemas detectados:**
- Mejor adopción: **42** tokens, breakpoints 768 / 1100 / 1440 alineados con `.erp-card-grid`.
- JSX usa `.erp-kpi-grid`, `.erp-filters-row`, `.erp-form-grid`, `.erp-card-grid`.
- Residuos: **3** prohibidos, **17** no estándar (tipografía 11/13px, detalles menores).
- Formulario superior aún mezcla clases propias `suppliers-*` en lugar de `.erp-form-section` puro.

**Prioridad:** P4 (pulido)

---

### Órdenes de compra (`PurchaseOrdersModule` — `/inventory?section=ordenes`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Sí** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `PurchaseOrders.css`: **52** tokens; import explícito de `erp-ui-spacing.css`.
- KPI 2→4 cols desktop ✓; filtros y tabs con tokens.
- **7** inline styles en JSX; historial/detalle aún denso en scroll largo.
- Breakpoint extra **980px**; tablas de ítems en OC sin card fallback mobile completo.
- Legacy shell (`LegacyInventoryApp`) aporta estilos globales inline (`buttonStyle` padding 12×20, radius 8) mezclados.

**Prioridad:** P2

---

### Áreas operativas (`AreasModule` — `/inventory?section=areas`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Sí** |
| Cumple mobile | **Sí** |
| Cumple tablet | **Sí** |
| Cumple desktop | **Sí** |

**Estado:** **Corregido** (Sprint UX #1 — 2026-06-09)

**Remediado:**
- Extraído a `modules/areas/AreasModule.jsx` + `Areas.css` con tokens y clases ERP.
- Formulario en secciones; listado `.erp-card-grid` (1 / 2 / 3–4 cols).
- Estilos inline de áreas eliminados del bloque admin (bug estilos HR huérfanos resuelto).

**Nota:** `inventarioAreas` legacy inline en `LegacyInventoryApp.jsx` sigue con estilos inline — fuera de Sprint #1.

**Prioridad:** P4

---

### Recetas (`RecipesSupabase`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- `RecipesSupabase.css`: **32** prohibidos, **85** no estándar.
- Listado y editor extensos; poca card grid por receta.
- Breakpoint único **800px**; formulario ingredientes sin agrupación por secciones.
- Sin tokens ni clases del sistema.

**Prioridad:** P2

---

### Requisiciones (`RequisitionsSupabase`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- `RequisitionsSupabase.css`: **23** prohibidos, **42** no estándar.
- Breakpoints **1000px / 650px**; listas verticales vs card grid spec.
- Filtros presentes pero spacing 12–14px; inputs no `--erp-input-height`.

**Prioridad:** P2

---

### Producción interna (`InternalProduction` → `InventoryBase.css`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- Hereda todos los problemas de `InventoryBase.css`.
- Formulario producción multi-paso en panel único; tablas de insumos sin variante mobile card.
- KPIs de resumen en grid ad hoc (`.inventory-production-summary`).

**Prioridad:** P2

---

### Conversiones de ítems (`InventoryItemConversions`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- `InventoryItemConversions.css`: prohibidos + no estándar; comparte patrón inventario legacy.
- Formulario conversión sin `.erp-form-grid` / secciones.

**Prioridad:** P3

---

### Legacy shell — login y estilos compartidos (`LegacyInventoryApp`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- Pantalla login: inline styles (`padding: 24px` ✓, pero `width: 420px` fijo, sin tokens).
- **12** `style={{}}` en JSX + **~40** constantes `*Style` (post-limpieza usuarios: **2,494** líneas).
- Estilos globales `buttonStyle`, `cardStyle`, `inputStyle` usados por áreas/legacy sidebar oculto.
- Cero adopción de `erp-ui-spacing.css`.

**Prioridad:** P1

---

## Punto de venta y caja

### POS (`/pos` — `POS.jsx`, `POS.css`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- Mayor deuda del ERP: `POS.css` **49** prohibidos, **218** no estándar; **12** `@media` pero breakpoints 760/860/980/1100/1180/720 mezclados.
- **Auditoría operativa:** [pos-ux-audit.md](./pos-ux-audit.md) — flujos mesero/cocina/caja/delivery, P1 operativos (auto-reset post-cocina, handlers sin UI).
- `POS.jsx`: **19** bloques inline style; gaps 7px, padding 11px, radius 7px documentados en spec como prohibidos.
- Botones táctiles inconsistentes (<48px en acciones secundarias).
- Cumple espíritu POS (cards grandes, categorías) pero **velocidad > estética** choca con regla de múltiplos de 8.

**Prioridad:** P1

---

### Caja / cobros (`Cashier` — `/cash`, `/cashier`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Sí** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Estado:** **Corregido** (Sprint UX #1 — 2026-06-09)

**Remediado:**
- `Cashier.css` tokenizado; breakpoints **767 / 1024 / 1440**.
- Dashboard: `.erp-kpi-grid` + `.erp-kpi-card`.
- `cashier-items-table`: tabla desktop; **cards mobile** vía CSS + `data-label`.
- Botones/inputs: `--erp-btn-height` / `--erp-input-height` responsive.

**Prioridad:** P4 (deuda residual en split-payment modal menor)

---

### Control de caja (`CashManagement` — `/cash-control`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `CashManagement.css`: **7** prohibidos, **28** no estándar; breakpoints 1050/640px.
- KPIs y paneles presentes; spacing 14–18px; sin tokens.

**Prioridad:** P2

---

## Producción / KDS

### Producción (`Production` — `/production`, `/kds`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `Production.css`: **33** prohibidos, **47** no estándar.
- Grids operativos KDS (5 cols, 4 cols) adecuados para pantalla cocina pero no alineados a card grid entidades.
- Breakpoints 1320/820px; botones bajo 52px mobile en algunos controles.

**Prioridad:** P3

---

## Recursos humanos

### Colaboradores / perfiles (`ProfileManagement` — `/hr?section=usuarios`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **No** |

**Problemas detectados:**
- `ProfileManagement.css`: **22** prohibidos, **52** no estándar.
- Listado tipo **tabla/grid denso** (`profiles-table` multi-columna) — spec pide cards por colaborador.
- Inputs `height: 42px` (debe ser 44/48/52 responsive).
- Breakpoints 1050/640px; formulario extenso (PIN, horarios, permisos) sin `.erp-form-section`.
- **1** inline style en JSX.

**Prioridad:** P2

---

### Planilla / horarios (`ScheduleManagement` — `/hr?section=horarios`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **No** |
| Cumple mobile | **No** |
| Cumple tablet | **No** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `ScheduleManagement.css`: **21** prohibidos, **42** no estándar.
- Tablas HTML semanales sin fallback card mobile.
- `min-height: 42px` en controles; breakpoints 1080/700px.
- **2** inline styles en JSX.

**Prioridad:** P2

---

### Terminal de asistencia (`AttendanceTerminal` — `/hr?section=asistencia`, `/kiosk`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `AttendanceTerminal.css`: **5** prohibidos, **46** no estándar.
- Flujo kiosk con cards grandes ✓; botones no unificados a 48/52px en todos los estados.
- Media **760px** única; padding 14–18px frecuente.

**Prioridad:** P3

---

### Dispositivos de marcaje (`AttendanceDevicesManagement`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- Reutiliza estilos `ProfileManagement.css`; **20** no estándar, sin tokens.
- Breakpoint 1080px; listado dispositivos en filas.

**Prioridad:** P3

---

### Reportes de asistencia (`AttendanceReportsModule` — `/hr?section=reportesAsistencia`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Sí** |
| Cumple grid | **Sí** |
| Cumple mobile | **Sí** |
| Cumple tablet | **Sí** |
| Cumple desktop | **Sí** |

**Problemas detectados:**
- **28** tokens; JSX con `.erp-kpi-grid`, `.erp-filters-row`.
- **Mobile cards** implementadas (`.attendance-reports-mobile-list`) — cumple §7.
- Residuos menores: **2** prohibidos, **14** no estándar; falta `.erp-page-shell` en wrapper.
- Referencia de migración para otros módulos con tablas.

**Prioridad:** P4 (pulido)

---

## Operaciones — Tareas / Checklists

### Tareas (`Tasks` — `/tasks`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- Paradoja: **mejor patrón visual de cards** (`.tasks-template-grid`, wizard, KPIs) pero `Tasks.css` con **63** prohibidos y **198** no estándar (`padding: 17px`, `border-radius: 13px`, KPI `font-size: 27px`).
- Tabla alertas gestión sin card mobile.
- Breakpoints 1080/700px; alturas input 43–46–52px mezcladas.
- Cero tokens `--erp-space-*`.

**Prioridad:** P2 (alto ROI — migrar tokens sin cambiar UX)

---

## Reportes y configuración

### Reportes ejecutivos (`ReportsDashboard` — `/reports`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- Estructura correcta: header → KPIs → filtros → paneles.
- `ReportsDashboard.css`: **20** prohibidos, **64** no estándar; `gap: 12/14/15px`, `border-radius: 13/14px`.
- Tablas en tabs; scroll horizontal mobile, **sin** card rows.
- Usa colores `var(--erp-*)` pero no spacing tokens.

**Prioridad:** P3

---

### Metas de ventas (`SalesGoalsSettings`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `SalesGoalsSettings.css`: **4** prohibidos, **13** no estándar; breakpoint 820px.
- Formularios metas sin `.erp-form-section`.

**Prioridad:** P4

---

### Configuración (`Settings`, branding, roles, tickets)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **No** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `Settings.css`: inputs **46px/42px**; **9** prohibidos.
- `BrandingAppearance.css`: **38** no estándar; preview parcialmente tokenizado.
- `RolesManagement.css`: **15** prohibidos; tablas permisos sin mobile cards.
- `TicketTemplateSettings.css`: **12** prohibidos; breakpoints 1100/680px.

**Prioridad:** P3

---

### Cuenta de usuario (`Account` — `/account`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **Parcial** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- CSS mínimo (**1** no estándar); depende de `erp-theme` parcial.
- Formulario corto; pocos problemas vs resto del ERP.

**Prioridad:** P4

---

## Autenticación y accesos

### Login / recuperación (`Login`, `ForgotPassword`, `ForgotUser`, `UpdatePassword`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `Login.jsx`: estilos **inline** (`pageStyle`, `cardStyle`) — sin CSS dedicado ni tokens.
- `AuthRecovery.css`: **2** prohibidos, **10** no estándar.
- Card centrada funcional; inputs no `--erp-input-height` responsive.

**Prioridad:** P4

---

### Kiosk (`/kiosk` → `AttendanceTerminal`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **Parcial** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **N/A** |

**Problemas detectados:** Mismos hallazgos que Terminal de asistencia; orientado a tablet/kiosk.

**Prioridad:** P3

---

## Componentes transversales

### Sidebar / notificaciones / perfil (`NotificationsBell`, `UserProfileDropdown`, `MyProfilePanel`)

| Criterio | Resultado |
|----------|-----------|
| Cumple spacing | **No** |
| Cumple grid | **N/A** |
| Cumple mobile | **Parcial** |
| Cumple tablet | **Parcial** |
| Cumple desktop | **Parcial** |

**Problemas detectados:**
- `NotificationsBell.css`: **12** prohibidos; panel dropdown spacing 10–14px.
- `UserProfileDropdown.css`: **14** prohibidos.
- `MyProfilePanel.css`: **18** prohibidos; crop avatar con `react-easy-crop` — modal spacing legacy.
- `NotificationsBell` usa media **767px** ✓.

**Prioridad:** P4

---

## Matriz consolidada

| Módulo | Spacing | Grid | Mobile | Tablet | Desktop | Prioridad |
|--------|---------|------|--------|--------|---------|-----------|
| Layout global | Parcial | Parcial | Parcial | Parcial | Parcial | P4 |
| Dashboard | Parcial | Parcial | Parcial | Parcial | Parcial | P4 |
| Inventario — productos/movimientos | **Sí** | Parcial | **Sí** | Parcial | Parcial | ~~P1~~ **Corregido** |
| Inventario — proveedores | **Sí** | **Sí** | Parcial | **Sí** | **Sí** | P4 |
| Inventario — órdenes de compra | **Sí** | Parcial | Parcial | **Sí** | Parcial | P2 |
| Inventario — áreas | **Sí** | **Sí** | **Sí** | **Sí** | **Sí** | ~~P1~~ **Corregido** |
| Inventario — recetas | No | No | Parcial | No | No | P2 |
| Inventario — requisiciones | No | No | Parcial | No | No | P2 |
| Inventario — producción interna | No | No | Parcial | No | No | P2 |
| Inventario — conversiones | No | No | Parcial | No | No | P3 |
| Legacy shell | No | No | Parcial | No | No | **P1** |
| POS | No | Parcial | Parcial | Parcial | Parcial | **P1** |
| Caja | **Sí** | Parcial | **Sí** | Parcial | Parcial | ~~P1~~ **Corregido** |
| Control de caja | No | Parcial | Parcial | No | Parcial | P2 |
| Producción / KDS | No | Parcial | Parcial | Parcial | Parcial | P3 |
| RRHH — colaboradores | No | No | Parcial | No | No | P2 |
| RRHH — planilla | No | No | No | No | Parcial | P2 |
| RRHH — terminal | No | Parcial | Parcial | Parcial | Parcial | P3 |
| RRHH — dispositivos | No | Parcial | Parcial | No | Parcial | P3 |
| RRHH — reportes asistencia | **Sí** | **Sí** | **Sí** | **Sí** | **Sí** | P4 |
| Tareas / checklists | No | Parcial | Parcial | Parcial | Parcial | P2 |
| Reportes ejecutivos | No | Parcial | Parcial | Parcial | Parcial | P3 |
| Metas ventas | No | Parcial | Parcial | No | Parcial | P4 |
| Configuración | No | Parcial | Parcial | No | Parcial | P3 |
| Cuenta | Parcial | Parcial | Parcial | Parcial | Parcial | P4 |
| Auth | No | Parcial | Parcial | Parcial | Parcial | P4 |
| Componentes chrome | No | — | Parcial | Parcial | Parcial | P4 |

---

## Hallazgos transversales (aplican a casi todo el ERP)

1. **Design system documentado pero poco consumido** — tokens y clases existen; adopción sistemática en Proveedores, Órdenes, Reportes asistencia, **Áreas, InventoryBase, Caja** (Sprint #1).
2. **Breakpoints fragmentados** — decenas de valores legacy vs estándar **767 / 1024 / 1440**; mejorado en módulos Sprint #1.
3. **Tablas en mobile** — pendiente en Planilla, Perfiles, Reportes, POS; **Caja e InventoryBase corregidos** en Sprint #1.
4. **Inline styles** — Legacy shell, POS, Login, PurchaseOrders, Reports concentran deuda fuera de CSS tokenizado.
5. **Alturas táctiles** — Mezcla de 42, 43, 46, 50px vs regla 44 / 48 / 52.
6. **Referencias visuales a imitar:** `SuppliersModule` + `AttendanceReportsModule` para migraciones futuras.

---

## Orden de remediación recomendado

| Fase | Módulos | Estado |
|------|---------|--------|
| **1** | Áreas, InventoryBase, Caja | ✅ **Completado** (Sprint UX #1) |
| **2** | POS, ProfileManagement, ScheduleManagement, Tasks, Reports | ☐ Pendiente (Sprint UX #2) |
| **3** | Legacy órdenes shell, Recetas, Requisiciones, CashManagement | ☐ Backlog |
| **4** | Config, Auth, chrome | ☐ Pulido final |

---

## Archivos clave revisados

- Tokens: `frontend/src/styles/erp-ui-spacing.css`, `erp-theme.css`
- Referencia positiva: `modules/suppliers/Suppliers.css`, `modules/purchase-orders/PurchaseOrders.css`, `modules/attendance/AttendanceReports.css`, `modules/areas/Areas.css`
- Remediados Sprint #1: `pages/InventoryBase.css`, `pages/Cashier.css`, `modules/areas/AreasModule.jsx`
- Deuda crítica pendiente: `pages/POS.css`, `modules/LegacyInventoryApp.jsx` (órdenes/login)
- RRHH prod. (Sprint #2): `pages/ProfileManagement.css`, `pages/ScheduleManagement.css`
- Operaciones (Sprint #2): `pages/Tasks.css`, `modules/reports/ReportsDashboard.css`

*Auditoría estática — 2026-06-09. Actualizado post Sprint UX #1. Informe complementario: `docs/ui-audit-report.md`, plan sprint: `docs/ui-remediation-sprint-1.md`.*
