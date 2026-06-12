# ERP UI Audit Report

**Fecha:** 2026-06-12  
**Design system de referencia:**
- `.cursor/rules/erp-ui-spacing-system.mdc`
- `docs/erp-ui-spacing-system.md`
- `frontend/src/styles/erp-ui-spacing.css`

**Alcance:** Fase 1 — solo auditoría, sin cambios de código.  
**Archivos revisados:** **104** (36 CSS + 68 JSX en `frontend/src/`)

---

## Resumen general

| Métrica | Resultado |
|---------|-----------|
| Archivos con valores **prohibidos** (3, 5, 7, 11, 13, 17, 19, 27px) | **~55** archivos |
| Ocurrencias totales de valores prohibidos | **~859** |
| Archivos CSS con spacing **no múltiplo de 8** (10, 12, 14, 18, 20, 22, 30, 42px, etc.) | **35 de 36** CSS (excl. `erp-ui-spacing.css`) |
| Archivos que usan `var(--erp-space-*)` | **3** (`erp-ui-spacing.css`, `Suppliers.css`, `erp-theme.css` parcial) |
| Archivos que usan clases del sistema (`.erp-card-grid`, `.erp-kpi-grid`, `.erp-page-shell`) | **2** (`erp-ui-spacing.css`, `Suppliers.css`) |
| Archivos con `@media` responsive | **~32** CSS |

### Cumplimiento por nivel

| Nivel | Módulos |
|-------|---------|
| **Alto** | Proveedores (`Suppliers.css` + grid reciente), tokens base (`erp-ui-spacing.css`) |
| **Medio** | Checklists/Tasks (patrón cards ✓, CSS ✗), Reportes (`ReportsDashboard`), Settings/Branding, Sidebar/Layout, Asistencia terminal |
| **Crítico** | `LegacyInventoryApp.jsx`, POS, Inventario (`InventoryBase`), Caja (`Cashier`), RRHH legacy, Planilla (`ScheduleManagement`), Perfiles (`ProfileManagement`), Recetas, Requisiciones, Producción |

### Hallazgo transversal

El design system **existe en documentación y tokens**, pero **casi ningún módulo lo consume**. La mayor parte del ERP sigue usando CSS/inline styles legacy con spacing arbitrario. El módulo más grande (`LegacyInventoryApp.jsx`, ~11k líneas, **103** usos de `style={}` y **~80+** objetos de estilo al final del archivo) concentra la deuda técnica visual.

---

## Hallazgos por módulo

### Módulo: Inventario — Proveedores

**Estado:** **Alto** (mejor adopción reciente)

**Problemas:**
- Usa tokens `--erp-space-*` en `Suppliers.css`, pero aún hay `font-size: 11px/13px` (tipografía, no spacing crítico).
- Formulario de crear/editar proveedor sigue en `LegacyInventoryApp.jsx` con `cardStyle` / `inputStyle` globales (padding 20px, radius 10px, sin `--erp-input-height`).
- No usa clases globales `.erp-card-grid` / `.erp-kpi-grid` (clases propias `suppliers-*` duplican lógica).

**Recomendaciones:**
- Migrar clases `suppliers-*` a extender `.erp-card`, `.erp-kpi-grid`, `.erp-search-input`.
- Refactorizar formulario superior a `.erp-form-section` + `.erp-form-grid`.

---

### Módulo: Inventario — Productos / Ingredientes (`inventario`, `InventoryBase`)

**Estado:** **Crítico**

**Problemas:**
- `InventoryBase.css`: **108** valores spacing no estándar; `gap: 10px`, `padding: 14px`, `margin-bottom: 15px`, `gap: 7px`.
- Listado de productos en grid denso tipo tabla/fila (`inventory-row`, `inventory-movements article`) — no cards escaneables.
- Formulario largo en una sola columna/grid 2 cols sin secciones claras (`inventory-form-grid`).
- Breakpoints custom 920px / 620px (no alineados a 768 / 1024 / 1440 del design system).
- `LegacyInventoryApp.jsx` sección `inventario`: lista vertical de ingredientes, formulario monolítico, estilos inline compartidos (`inputStyle`, `cardStyle`).

**Recomendaciones:**
- Cards para catálogo de productos; tablas solo en movimientos/kardex.
- Reemplazar spacing por tokens; unificar breakpoints.
- Dividir formulario en secciones (general, compra, stock, alertas).

---

### Módulo: Inventario — Áreas / Movimientos / Requisiciones

**Estado:** **Crítico / Medio**

**Problemas:**
- `inventarioAreas`: cards básicas en grid inline (`areaDashboardGridStyle`) con spacing no tokenizado.
- `movimientosInventario`: tablas/filas densas en legacy.
- `RequisitionsSupabase.css`: **51** spacing no estándar; listas verticales.

**Recomendaciones:**
- KPIs + filtros + card grid en requisiciones.
- Movimientos: mantener tabla en desktop, cards en mobile (`@media max-width: 767px`).

---

### Módulo: RRHH — Usuarios / Perfiles (`usuarios`, `ProfileManagement`)

**Estado:** **Crítico**

**Problemas:**
- `ProfileManagement.css`: grid de filas tipo tabla (`grid-template-columns: 1.5fr 1fr...`), **59** spacing no estándar, `height: 42px` en inputs.
- Formularios extensos (PIN, horarios, permisos) sin `.erp-form-section`.
- `LegacyInventoryApp.jsx` sección `usuarios`: listas verticales de colaboradores, tabs densos, inline styles.

**Recomendaciones:**
- Card grid por colaborador (nombre, rol, área, estado, acciones).
- Formulario modal o secciones colapsables; inputs a `var(--erp-input-height)`.

---

### Módulo: RRHH — Asistencia / Reportes (`asistencia`, `reportesAsistencia`, `AttendanceTerminal`)

**Estado:** **Medio / Crítico**

**Problemas:**
- **Terminal (`AttendanceTerminal.css`):** **59** spacing no estándar; botones no unificados a 44/48/52px en todos los breakpoints.
- **Reportes legacy (`LegacyInventoryApp.jsx`):** KPI grid (`reportGridStyle`) con `gap: 14px`; **tablas** de historial (`attendanceTableStyle`) sin variante mobile/card.
- Filtros presentes pero mezclados con historial en scroll largo.
- Cumple parcialmente estructura KPI → contenido; no cumple spacing ni mobile tables.

**Recomendaciones:**
- Aplicar `.erp-kpi-grid` en reportes de asistencia.
- Convertir filas de historial a cards en `<768px`.
- Terminal: usar `.erp-btn` + tokens.

---

### Módulo: RRHH — Planilla (`ScheduleManagement`)

**Estado:** **Crítico**

**Problemas:**
- Tablas HTML para horarios y asistencia (`<table>`) sin responsive card fallback.
- `ScheduleManagement.css`: `min-height: 42px` (debe ser 44px), spacing 12px/14px/18px.
- Formulario modal de turno sin secciones visuales del design system.

**Recomendaciones:**
- Vista semanal: cards por colaborador/día en tablet/mobile.
- Tabla detalle solo desktop auditoría.

---

### Módulo: POS (`POS.jsx`, `POS.css`, `Cashier.jsx`)

**Estado:** **Crítico**

**Problemas:**
- **Mayor concentración de deuda:** `POS.css` **248** spacing no estándar; `POS.jsx` **~100+** `var(--erp-*)` mezclados con **decenas de inline styles** prohibidos (`padding: 11px 14px`, `gap: 7px`, `borderRadius: 7px`, `27px`, etc.).
- Muchos botones bajo 48px táctil; algunos `min-height: 50px` (no múltiplo de 8 estricto en altura — aceptable operativamente pero inconsistente).
- `Cashier.css`: **124** spacing no estándar; tabla `cashier-items-table` sin cards mobile.
- POS tiene **12** `@media` (buena intención responsive) pero valores internos no alineados al sistema.

**Recomendaciones:**
- Prioridad 1: extraer estilos inline de `POS.jsx` a CSS con tokens.
- Botones táctiles unificados ≥48px (52px mobile).
- Orden actual y categorías: mantener cards grandes; eliminar micro-gaps 3/5/7px.

---

### Módulo: Checklists / Tareas (`Tasks.jsx`, `Tasks.css`)

**Estado:** **Medio** (referencia de patrón, no de tokens)

**Problemas:**
- **Paradoja:** es el referente visual de cards (`.checklists-card-grid`, `.checklist-template-card`), pero `Tasks.css` tiene **215** spacing no estándar y **~120+** valores prohibidos (`padding: 17px`, `border-radius: 13px`, `gap: 7px`, `font-size: 27px` en KPIs).
- Tabla de alertas (`checklist-management-alerts-table`) sin conversión mobile.
- Inputs/buttons mezclan 44px, 46px, 43px, 48px, 52px sin sistema claro.

**Recomendaciones:**
- Migrar `Tasks.css` a tokens (alta visibilidad — es el módulo “modelo”).
- Alinear `.checklists-kpi` a `.erp-kpi-card`.

---

### Módulo: Reportes ejecutivos (`ReportsDashboard`)

**Estado:** **Medio**

**Problemas:**
- Buena estructura: header → KPIs → filtros → paneles.
- `ReportsDashboard.css`: `gap: 18px`, `border-radius: 13px/14px`, `padding: 14px/15px`, KPI `font-size: 27px`.
- Tablas (`reports-table`) en todos los tabs; scroll horizontal en mobile, **sin** card rows.
- Usa `var(--erp-*)` colores pero **no** spacing tokens.

**Recomendaciones:**
- Reemplazar spacing por `--erp-space-*`; radius → `--erp-radius-card` (12px).
- `@media (max-width: 767px)`: ocultar columnas secundarias o cardificar filas.

---

### Módulo: Recetas (`RecipesSupabase`)

**Estado:** **Crítico / Medio**

**Problemas:**
- **93** spacing no estándar en CSS.
- Listados y formularios extensos; poca agrupación por secciones.
- Sin card grid para listado de recetas.

**Recomendaciones:**
- Card grid por receta (nombre, tipo, área, acciones).
- Formulario en `.erp-form-section`.

---

### Módulo: Órdenes de compra (`ordenes` en Legacy)

**Estado:** **Crítico**

**Problemas:**
- Estilos dedicados al final de `LegacyInventoryApp.jsx` (`purchaseOrderActionBaseStyle` `minHeight: 46px`, `gap: 18px`, `padding: 12px 18px`, `borderRadius: 10px`).
- Vistas automático/manual/historial con scroll largo y bloques apilados.

**Recomendaciones:**
- Extraer a módulo CSS con tokens; KPIs de estado de órdenes arriba.

---

### Módulo: Configuración / Branding (`Settings`, `BrandingAppearance`)

**Estado:** **Medio**

**Problemas:**
- `Settings.css`: inputs `46px`, `42px` height.
- `BrandingAppearance.css`: **45** spacing no estándar; preview usa tokens parciales.
- Formularios largos de branding sin secciones `.erp-form-section`.

**Recomendaciones:**
- Alinear inputs a `--erp-input-height`; secciones colapsables.

---

### Módulo: Layout / Navegación (`MainLayout`, `Sidebar`)

**Estado:** **Medio**

**Problemas:**
- Sidebar ~240px (cumple desktop) pero estilos con spacing mixto.
- `MainLayout.css`: pocos `@media`; contenido no usa `.erp-page-shell` / max-width 1600px de forma consistente.
- `erp-theme.css` sidebar accent `inset 3px` (prohibido); `.branding-logo-actions button` `padding: 7px 11px`.

**Recomendaciones:**
- Envolver `.app-main` children en `.erp-page-shell`.
- Corregir tokens en `erp-theme.css`.

---

### Módulo: Legacy monolito (`LegacyInventoryApp.jsx`)

**Estado:** **Crítico** (mayor impacto)

**Problemas:**
- **103** atributos `style={}` inline.
- Objetos globales al pie del archivo (~L9156–L11300): `cardStyle` (`padding: 20px`, `borderRadius: 10px`), `inputStyle` (sin min-height), decenas de valores 5/7/9/10/13/14/18px.
- Secciones afectadas: inventario, usuarios, recetas, requisición, órdenes, asistencia, reportes, proveedores (form), áreas, movimientos, login embebido.
- Listas verticales infinitas en usuarios, recetas, historial compras, órdenes.
- Tablas inline en órdenes e historial de asistencia.

**Recomendaciones:**
- **Prioridad 1 del ERP:** migración incremental por sección a CSS modules + tokens.
- Eliminar progresivamente objetos `*Style` del final del archivo.

---

## Lista priorizada de correcciones

### Prioridad 1 — Urgente (usabilidad / responsive / operación diaria)

1. **`LegacyInventoryApp.jsx`**: reemplazar `inputStyle` / `buttonStyle` / `cardStyle` base por tokens; min-height inputs/botones responsive.
2. **POS (`POS.jsx`)**: eliminar inline styles prohibidos; botones ≥48px; gaps 8/16px.
3. **Reportes asistencia + tablas legacy**: card rows en mobile; KPIs con `.erp-kpi-grid`.
4. **`Cashier.jsx`**: tabla de ítems → cards en mobile.
5. **`InventoryBase`**: catálogo en card grid; formulario por secciones.
6. **`ProfileManagement`**: listado colaboradores → cards; inputs 44/48/52px.

### Prioridad 2 — Importante (consistencia visual)

7. **`Tasks.css`**: migrar referente visual a tokens (impacto en todo el ERP).
8. **`ReportsDashboard.css`**: spacing + radius + tablas mobile.
9. **`ScheduleManagement`**: responsive horarios.
10. **`RecipesSupabase`**, **`RequisitionsSupabase`**: card grids.
11. **`erp-theme.css`**: alinear `.erp-card`, botones, dashboard gaps.
12. **Proveedores**: unificar con clases globales (eliminar duplicación `suppliers-*`).

### Prioridad 3 — Refinamiento

13. Tipografía (`11px`, `13px`) → escala tipográfica separada del spacing grid (documentar en v1.1).
14. Unificar breakpoints custom (920px, 620px) → 767 / 1024 / 1440.
15. Adoptar `.erp-data-table` donde corresponda auditoría desktop.
16. `AttendanceTerminal`, `Settings`, `Production`, `RolesManagement`: pasada de tokens.

---

## Archivos con spacing hardcodeado no permitido

Muestra representativa (valor prohibido → reemplazo sugerido). Total global: **~859** ocurrencias.

| Archivo | Línea aprox. | Valor encontrado | Reemplazo sugerido |
|---------|--------------|------------------|-------------------|
| `modules/LegacyInventoryApp.jsx` | 9288 | `margin: 0 0 5px` | `margin: 0 0 var(--erp-space-8)` |
| `modules/LegacyInventoryApp.jsx` | 9304 | `padding: 9px 13px` | `padding: 0 var(--erp-space-16); min-height: var(--erp-btn-height)` |
| `modules/LegacyInventoryApp.jsx` | 9321 | `gap: 5px` | `gap: var(--erp-space-8)` |
| `modules/LegacyInventoryApp.jsx` | 9359 | `padding: 13px 14px` | `padding: var(--erp-space-16)` |
| `modules/LegacyInventoryApp.jsx` | 9985 | `padding: 5px 8px` | `padding: var(--erp-space-4) var(--erp-space-8)` |
| `modules/LegacyInventoryApp.jsx` | 10053 | `box-shadow: 0 0 0 3px` | `0 0 0 var(--erp-space-4)` (focus ring) |
| `modules/LegacyInventoryApp.jsx` | 9159 | `borderRadius: 10px` | `var(--erp-radius-card)` (12px) |
| `pages/POS.jsx` | 4013 | `padding: 11px 14px` | `0 var(--erp-space-16); min-height: var(--erp-btn-height)` |
| `pages/POS.jsx` | 4026 | `gap: 7px` | `var(--erp-space-8)` |
| `pages/POS.jsx` | 4036 | `27px × 27px` | `var(--erp-space-32)` (32px) |
| `pages/POS.jsx` | 4041 | `padding: 5px 9px` | `var(--erp-space-4) var(--erp-space-8)` |
| `pages/POS.jsx` | 636 | `outline: 3px` | `var(--erp-space-4)` |
| `pages/POS.css` | 6 | `margin: 3px 0 4px` | `margin: var(--erp-space-4) 0` |
| `pages/POS.css` | 98 | `gap: 3px` | `var(--erp-space-4)` |
| `pages/POS.css` | 229 | `margin: 5px 0 0` | `var(--erp-space-8) 0 0` |
| `pages/POS.css` | 341 | `padding: 3px 8px` | `var(--erp-space-4) var(--erp-space-8)` |
| `pages/Tasks.css` | 48 | `gap: 7px` | `var(--erp-space-8)` |
| `pages/Tasks.css` | 51 | `border-radius: 13px` | `var(--erp-radius-card)` |
| `pages/Tasks.css` | 942 | `padding: 17px` | `var(--erp-space-16)` |
| `pages/Tasks.css` | 979 | `padding: 5px 10px` | `var(--erp-space-4) var(--erp-space-8)` |
| `pages/InventoryBase.css` | 288 | `gap: 7px` | `var(--erp-space-8)` |
| `pages/InventoryBase.css` | 344 | `padding: 14px` | `var(--erp-space-16)` |
| `modules/reports/ReportsDashboard.css` | 14 | `padding: 14px; radius 13px` | `var(--erp-space-16); var(--erp-radius-card)` |
| `modules/reports/ReportsDashboard.css` | 32 | `padding: 5px 8px` | `var(--erp-space-4) var(--erp-space-8)` |
| `styles/erp-theme.css` | 350 | `inset 3px 0 0` | `inset var(--erp-space-4) 0 0` |
| `styles/erp-theme.css` | 433 | `padding: 7px 11px` | `0 var(--erp-space-8)` |
| `pages/ProfileManagement.css` | 185 | `height: 42px` | `var(--erp-input-height)` (44px) |
| `pages/ScheduleManagement.css` | 50 | `min-height: 42px` | `var(--erp-input-height)` |
| `pages/CashManagement.css` | 89 | `min-height: 42px` | `var(--erp-input-height)` |
| `pages/Production.css` | 113 | `min-height: 42px` | `var(--erp-input-height)` |
| `components/AttendanceTerminal.css` | varios | `5px`, `7px`, `11px` | tokens `--erp-space-8/16` |
| `layouts/MainLayout.css` | varios | spacing mixto | `--erp-page-padding-x/y` |

> **Nota:** Para listado completo ejecutar en Fase 2:  
> `rg "\b(3|5|7|11|13|17|19|27)px\b" frontend/src --glob "*.{css,jsx}"`

---

## Adopción de tokens (estado actual)

| Token / clase | Archivos que lo usan |
|---------------|---------------------|
| `var(--erp-space-*)` | 3 |
| `var(--erp-input-height)` | 1 (`erp-ui-spacing.css` only) |
| `var(--erp-radius-card)` | 2 |
| `.erp-card-grid` | 2 |
| `.erp-kpi-grid` | 1 |
| `.erp-page-shell` | 1 |
| `var(--erp-primary)` etc. (colores) | ~15 archivos |

Los **tokens de color** del ERP tienen adopción moderada; los **tokens de spacing** casi nula fuera del archivo recién creado.

---

## Checklist final (design system v1.0)

| # | Regla | ¿Cumple ERP global? |
|---|--------|---------------------|
| 1 | Spacing solo múltiplos de 8 (4 micro) | ❌ ~859 valores prohibidos + miles de 10/12/14/18px |
| 2 | Responsive desktop / tablet / mobile | ⚠️ Parcial — muchos `@media`, breakpoints inconsistentes |
| 3 | Cards vs listas infinitas | ⚠️ Checklists + Proveedores ✓; resto ❌ |
| 4 | Formularios agrupados por secciones | ❌ Mayoría monolíticos |
| 5 | Botones/inputs 44 / 48 / 52px | ❌ Mezcla 40–52px sin regla |
| 6 | Escaneo rápido operativo | ⚠️ Mejora en Proveedores/Tasks; legacy denso |
| 7 | Mobile sin tablas completas | ❌ POS, Cashier, Schedule, Reports, Legacy |
| 8 | KPIs arriba cuando aplica | ⚠️ Reports/Tasks/Proveedores sí; Legacy parcial |
| 9 | Filtros antes del contenido | ⚠️ Variable; a menudo mezclados |
| 10 | Sensación ERP SaaS moderno | ⚠️ Tema oscuro ✓; spacing/layout inconsistente |

**Veredicto:** El design system está **documentado pero no adoptado**. Cumplimiento global estimado: **~15–20%**.  
**Próximo paso (Fase 2):** plan de migración por módulo empezando por tokens base compartidos + `LegacyInventoryApp` + POS.

---

## Archivos revisados (inventario)

**CSS (36):** `App.css`, `index.css`, `styles/erp-theme.css`, `styles/erp-ui-spacing.css`, `styles/TicketTemplateSettings.css`, `layouts/MainLayout.css`, `modules/Suppliers.css`, `modules/reports/ReportsDashboard.css`, `components/*.css` (12), `pages/*.css` (18).

**JSX principales (68+):** `modules/LegacyInventoryApp.jsx`, `modules/LegacyDashboard.jsx`, `modules/LegacySidebar.jsx`, `pages/POS.jsx`, `pages/Tasks.jsx`, `pages/InventoryBase.jsx`, `pages/ProfileManagement.jsx`, `pages/ScheduleManagement.jsx`, `pages/HR.jsx`, `components/AttendanceTerminal.jsx`, `modules/reports/ReportsDashboard.jsx`, y resto de páneas/rutas en `frontend/src/pages/` y `frontend/src/components/`.

---

*Generado en Fase 1 — auditoría estática. No incluye pruebas visuales en dispositivos reales (recomendado en Fase 2).*
