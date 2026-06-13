# Legacy Extraction Progress

Seguimiento de la migración incremental desde `frontend/src/modules/LegacyInventoryApp.jsx` hacia módulos independientes.

**Archivo legacy:** `frontend/src/modules/LegacyInventoryApp.jsx`  
**Estrategia:** extraer módulo por módulo, validar en localhost, limpiar legacy solo después de confirmar.

---

## Obligatorio después de cada extracción exitosa

1. Actualizar **este archivo** (`docs/legacy-extraction-progress.md`).
2. Registrar en **Historial de reducción** (tabla):
   - fecha
   - módulo
   - líneas antes
   - líneas después
   - reducción % (respecto a la línea base del legacy)
   - validación localhost
   - build
   - producción
3. Añadir ficha en **Extracciones completadas**.
4. Actualizar **Resumen actual** (líneas, acumulado, %).
5. Registrar **próximo candidato** (mover el #1 de la cola o reordenar si cambió la prioridad).

**Fórmula reducción %:** `(líneas_eliminadas / líneas_iniciales_referencia) × 100`  
**Línea base referencia:** 11,539 (tamaño antes de la primera extracción).

---

## Resumen actual

| Métrica | Valor |
|---------|-------|
| Líneas actuales (LegacyInventoryApp) | **9,356** |
| Líneas iniciales (referencia) | **11,539** |
| Líneas eliminadas (acumulado) | **~2,183** |
| Módulos extraídos y limpiados | **4** |
| Reducción acumulada | **~18.9%** |

**Próximo candidato:** Deprecación UI legacy — inventario / recetas / requisición (código muerto en rutas actuales)

---

## Historial de reducción

| Fecha | Módulo | Líneas antes | Líneas después | Eliminadas | Reducción % | Localhost | Build | Producción |
|-------|--------|--------------|----------------|------------|-------------|-----------|-------|------------|
| 2026-06-12 | Proveedores | 11,539 | 10,851 | ~688 | ~6.0% | OK | OK | OK |
| 2026-06-12 | Usuarios / RRHH | 10,911 | 10,357 | ~554 | ~4.8% | OK | OK | Pendiente |
| 2026-06-13 | Reportes de asistencia | 10,405 | 10,064 | ~341 | ~3.0% | OK | OK | Pendiente |
| 2026-06-09 | Órdenes de compra | 10,140 | 9,356 | ~784 | ~6.8% | OK | OK | Pendiente |

---

## Extracciones completadas

### 2026-06-12 — Proveedores

| Campo | Valor |
|-------|-------|
| Líneas antes | 11,539 |
| Líneas después | 10,851 |
| Eliminadas | ~688 |
| Reducción % | ~6.0% (vs. referencia 11,539) |
| Localhost | OK — crear, editar, buscar, ver perfil, sin errores en consola |
| Build | OK — `npm run build` |
| Producción | OK |
| **Próximo candidato** | Usuarios / ProfileManagement |

**Destino:**
- `frontend/src/modules/suppliers/SuppliersModule.jsx`
- `frontend/src/modules/suppliers/Suppliers.css`
- `frontend/src/modules/suppliers/suppliersHelpers.js`

**Funcionalidad migrada:**
- Listado con cards responsivas
- KPIs y buscador
- Crear / editar proveedor
- Autocompletado en formulario
- Ver proveedor / perfil detallado
- Productos asociados, similares e historial de compras

**Conservado en Legacy (compartido):**
- Carga Supabase (`cargarProveedoresSupabase`, `proveedores` state)
- Búsqueda de proveedor en formulario de **Inventario** (`proveedorBusqueda`, `proveedorSeleccionadoId`)
- Datos de proveedor en **Órdenes de compra** (`manualProveedor*`, `updateSupplier` al recibir)

**Design system:** ERP UI Spacing System v1.0 aplicado en el módulo nuevo.

---

### 2026-06-12 — Usuarios / RRHH

| Campo | Valor |
|-------|-------|
| Líneas antes (pre-limpieza) | 10,911 |
| Líneas después | 10,357 |
| Eliminadas (esta limpieza) | ~554 |
| Reducción % (vs. referencia) | ~4.8% acumulado en esta extracción |
| Localhost | OK — cards, búsqueda, filtros, ver perfil, navegación |
| Build | OK — `npm run build` |
| Producción | Pendiente |
| **Próximo candidato** | Asistencia / RRHH |

**Destino:**
- `frontend/src/modules/users/UsersModule.jsx`
- `frontend/src/modules/users/Users.css`
- `frontend/src/modules/users/usersHelpers.js`

**Funcionalidad migrada:**
- Shell RRHH: acciones, formulario crear/editar colaborador (design system)
- Tab Colaboradores: KPIs, buscador, filtros, grid de cards responsive
- Tabs Dashboard / Alertas / Gestión usuarios (UI contenedora; render delegado)

**Eliminado en limpieza legacy:**
- Flag `USE_LEGACY_USERS_UI` y bloque JSX inline (~486 líneas)
- Computed `colaboradoresFiltrados` (movido a `usersHelpers.filtrarColaboradores`)
- Estilos solo legacy: `hrActionBarStyle`, `secondaryPanelButtonStyle`, `hrEmployeeGridStyle`, `hrEmployeeCardStyle`, `hrEmployeeHeaderStyle`, `hrEmployeeActionsStyle`
- Bloque muerto `mostrarPerfilColaborador && false`

**Conservado en Legacy (compartido):**
- State `users`, `userForm`, `hrFilters`, `hrEmployees`, permisos RRHH
- Lógica: guardar/editar colaborador, toggle activo, crop foto, hash password
- Renderers delegados: `renderHRDashboard`, `renderHRProfile`, `renderUserManagementView`, turnos
- Navegación a terminal HR y enlace a reportes de asistencia
- Estilos HR usados por perfil/dashboard: `profileShellStyle`, `hrTabBarStyle`, `hrFilterGridStyle`, etc.

**Design system:** ERP UI Spacing System v1.0 en formulario, KPIs, cards y filtros.

---

### 2026-06-13 — Reportes de asistencia

| Campo | Valor |
|-------|-------|
| Líneas antes (pre-limpieza) | 10,405 |
| Líneas después | 10,064 |
| Eliminadas (esta limpieza) | ~341 |
| Reducción % (vs. referencia) | ~3.0% en esta limpieza; **~12.8% acumulado** |
| Localhost | OK — KPIs, filtros, tardanzas, historial, modales, mobile |
| Build | OK — `npm run build` |
| Producción | Pendiente |
| **Próximo candidato** | Inventario |

**Destino:**
- `frontend/src/modules/attendance/AttendanceReportsModule.jsx`
- `frontend/src/modules/attendance/AttendanceReports.css`
- `frontend/src/modules/attendance/attendanceReportsHelpers.js`

**Funcionalidad migrada:**
- KPIs de asistencia (11 indicadores)
- Filtros por fecha / colaborador / búsqueda
- Detalle de llegadas tarde
- Historial por colaborador (tabla desktop, cards mobile, paginación)
- Modales de detalle de marcaje y foto ampliada
- Cálculo de métricas en `computeAttendanceReportMetrics` (helpers)
- Error boundary y estado de carga

**Eliminado en limpieza legacy:**
- Flag `USE_LEGACY_ATTENDANCE_REPORTS_UI` y bloque JSX inline (~131 líneas)
- Computed huérfanos de reportes (~60 líneas): `movimientosReportes`, `entradasDelDia`, `llegadasTarde`, `horasTrabajadas`, etc.
- `colaboradoresAsistencia` / `colaboradorSesion` (sin uso)
- `getAttendanceMarkLabel` (movido a helpers del módulo)
- `obtenerMovimientosColaboradorHoy` / `obtenerUltimoMovimientoEntradaSalida` (solo usados por computed eliminado)
- Estilos solo legacy: `attendanceToolbarStyle`, `reportGridStyle`, `attendanceTable*`, `attendancePhoto*`, `attendanceDetail*`, `attendanceDeviceAlertStyle`

**Conservado en Legacy (compartido):**
- State: `asistenciaBusqueda`, `asistenciaFechaFiltro`, `asistenciaReporteColaboradorId`, `asistenciaPerfiles`, `asistenciaMovimientos`, `asistenciaLlegadasTarde`, `asistenciaGraceMinutes`, `asistenciaCargando`, modales
- Effects: `cargarAsistenciaSupabase`, `cargarLlegadasTarde`, logs `[asistencia/tardanza]`
- Sección `asistencia` (redirect a terminal HR / kiosco)
- Permisos `puedeVerReportesRRHH`, validación de sección, bridge auth → `usuarioActual`
- Estilos de terminal legacy: `attendanceGridStyle`, `attendanceCardStyle`, `attendanceEmployee*`, etc.

**Design system:** ERP UI Spacing System v1.0 en KPIs, filtros, cards y badges.

---

### 2026-06-09 — Órdenes de compra

| Campo | Valor |
|-------|-------|
| Líneas antes (pre-limpieza, post-integración) | 10,140 |
| Líneas después | 9,356 |
| Eliminadas (esta limpieza) | ~784 |
| Reducción % (vs. referencia) | ~6.8% en esta limpieza; **~18.9% acumulado** |
| Localhost | OK — automáticas, manuales, historial, recepción, PDF, proveedores, notificaciones, responsive |
| Build | OK — `npm run build` |
| Producción | Pendiente |
| **Próximo candidato** | Deprecación inventario / recetas / requisición legacy |

**Destino:**
- `frontend/src/modules/purchase-orders/PurchaseOrdersModule.jsx`
- `frontend/src/modules/purchase-orders/PurchaseOrders.css`
- `frontend/src/modules/purchase-orders/purchaseOrdersHelpers.js`

**Funcionalidad migrada:**
- Órdenes automáticas (propuesta por mínimos, PDF)
- Órdenes manuales (buscador ingredientes, proveedor, crear)
- Historial con filtros (tabla desktop / cards mobile)
- Recepción (tab dedicado)
- KPIs operativos
- Badges de estado ERP

**Eliminado en limpieza legacy:**
- Flag `USE_LEGACY_PURCHASE_ORDERS_UI` y bloque JSX inline (~481 líneas)
- Computed huérfanos (~25 líneas): `manualSearchText`, `manualProductoCompra`, `manualSubtotal`, `manualCantidadBaseTotal`, `manualIngredientesSugeridos`
- Helpers solo UI: `getPurchaseSearchScore`, `getProductInitials`
- Estilos solo legacy (~235 líneas): `purchaseOrders*`, `manualSelectedProduct*`, `manualProductMetric*`, `purchaseQuantity*`, `purchaseCalculated*`, `manualSupplier*`, `purchaseOrderData*`

**Conservado en Legacy (compartido):**
- State: `ordenCompra`, `purchaseOrderView`, `ordenesCompraManual`, `manual*` (formulario/recepción), `manualInventoryItems`
- Handlers: `generarOrdenCompra`, `crearOrdenCompraManual`, `aprobarOrdenManual`, `recibirOrdenManual`, `descargarOrdenPDF`, notificaciones
- Effects: carga `getPurchaseOrders`, deep links `initialPurchaseOrderView/Id`, `purchase-order-action`
- Helpers compartidos: `getPurchaseProductDetails`, `mapPurchaseInventoryItem`, `getPurchaseOrderStatusLabel`, `manualInventorySource`, `manualIngredienteSeleccionado`
- Permisos: `puedeCrearOrdenCompra`, `puedeAprobarOrdenCompra`, `puedeRecibirOrdenCompra`
- Estilos reutilizados: `purchaseButtonStyle`, `orderBoxStyle`, `orderItemStyle`

**Design system:** ERP UI Spacing System v1.0 en header, KPIs, tabs, cards, filtros y badges.

---

## Cola de próximos candidatos

| Prioridad | Módulo | Notas |
|-----------|--------|-------|
| **1 (siguiente)** | Deprecación inventario legacy | UI muerta — ruta usa `InventoryBase` |
| 2 | Deprecación recetas / requisición legacy | UI muerta — rutas Supabase |
| 3 | Renderers HR (perfil, dashboard) | Completar fase 2 UsersModule |
| 4 | Áreas operativas | Admin de áreas |

---

## Plantilla — copiar tras cada extracción

### Tabla historial (añadir fila)

```markdown
| YYYY-MM-DD | [Módulo] | [antes] | [después] | ~[eliminadas] | ~[%] | OK / Pendiente | OK / Pendiente | OK / Pendiente |
```

### Ficha detallada

```markdown
### YYYY-MM-DD — [Nombre módulo]

| Campo | Valor |
|-------|-------|
| Líneas antes | |
| Líneas después | |
| Eliminadas | |
| Reducción % | |
| Localhost | |
| Build | |
| Producción | |
| **Próximo candidato** | |

**Destino:**
- `frontend/src/modules/[nombre]/`

**Conservado en Legacy (compartido):**
-

**Notas:**
-
```

### Checklist post-extracción

- [x] Contar líneas: `(Get-Content LegacyInventoryApp.jsx).Count`
- [x] Actualizar **Resumen actual**
- [x] Añadir fila en **Historial de reducción**
- [x] Añadir ficha en **Extracciones completadas**
- [x] Actualizar **Próximo candidato** en resumen y en ficha
- [x] Reordenar **Cola de próximos candidatos** si aplica

---

*Última actualización: 2026-06-09*
