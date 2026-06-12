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
| Líneas actuales (LegacyInventoryApp) | **10,851** |
| Líneas iniciales (referencia) | **11,539** |
| Líneas eliminadas (acumulado) | **~688** |
| Módulos extraídos | **1** |
| Reducción acumulada | **~6.0%** |

**Próximo candidato:** Usuarios / ProfileManagement

---

## Historial de reducción

| Fecha | Módulo | Líneas antes | Líneas después | Eliminadas | Reducción % | Localhost | Build | Producción |
|-------|--------|--------------|----------------|------------|-------------|-----------|-------|------------|
| 2026-06-12 | Proveedores | 11,539 | 10,851 | ~688 | ~6.0% | OK | OK | OK |

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

## Cola de próximos candidatos

| Prioridad | Módulo | Notas |
|-----------|--------|-------|
| **1 (siguiente)** | Usuarios / ProfileManagement | Listado colaboradores, permisos, formularios extensos |
| 2 | Asistencia / RRHH | Terminal, reportes, tablas → cards en mobile |
| 3 | Inventario | `InventoryBase`, formulario monolítico, catálogo en cards |
| 4 | Órdenes de compra | Vistas automático / manual / historial |
| 5 | Reportes | `ReportsDashboard`, KPIs y tablas responsive |

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

- [ ] Contar líneas: `(Get-Content LegacyInventoryApp.jsx).Count` o `wc -l`
- [ ] Actualizar **Resumen actual**
- [ ] Añadir fila en **Historial de reducción**
- [ ] Añadir ficha en **Extracciones completadas**
- [ ] Actualizar **Próximo candidato** en resumen y en ficha
- [ ] Reordenar **Cola de próximos candidatos** si aplica

---

*Última actualización: 2026-06-12*
