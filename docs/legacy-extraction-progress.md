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
| Líneas actuales (LegacyInventoryApp) | **10,357** |
| Líneas iniciales (referencia) | **11,539** |
| Líneas eliminadas (acumulado) | **~1,182** |
| Módulos extraídos y limpiados | **2** |
| Reducción acumulada | **~10.2%** |

**Próximo candidato:** Asistencia / RRHH (reportes + terminal)

---

## Historial de reducción

| Fecha | Módulo | Líneas antes | Líneas después | Eliminadas | Reducción % | Localhost | Build | Producción |
|-------|--------|--------------|----------------|------------|-------------|-----------|-------|------------|
| 2026-06-12 | Proveedores | 11,539 | 10,851 | ~688 | ~6.0% | OK | OK | OK |
| 2026-06-12 | Usuarios / RRHH | 10,911 | 10,357 | ~554 | ~4.8% | OK | OK | Pendiente |

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
- **Reportes de asistencia** (`reportesAsistencia`) y navegación a terminal HR
- Estilos HR usados por perfil/dashboard: `profileShellStyle`, `hrTabBarStyle`, `hrFilterGridStyle`, etc.

**Design system:** ERP UI Spacing System v1.0 en formulario, KPIs, cards y filtros.

---

## Cola de próximos candidatos

| Prioridad | Módulo | Notas |
|-----------|--------|-------|
| **1 (siguiente)** | Asistencia / RRHH | `reportesAsistencia` en Legacy, `AttendanceTerminal`, tablas → cards mobile |
| 2 | Inventario | `inventario` + `InventoryBase`, formulario monolítico, catálogo en cards |
| 3 | Órdenes de compra | Vistas automático / manual / historial |
| 4 | Recetas | Formulario extenso en Legacy |
| 5 | Reportes ejecutivos | `ReportsDashboard` (ya módulo parcial) |

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

*Última actualización: 2026-06-12*
