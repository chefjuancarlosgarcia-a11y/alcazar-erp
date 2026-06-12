# Legacy Extraction Progress

Seguimiento de la migración incremental desde `frontend/src/modules/LegacyInventoryApp.jsx` hacia módulos independientes.

**Archivo legacy:** `frontend/src/modules/LegacyInventoryApp.jsx`  
**Estrategia:** extraer módulo por módulo, validar en navegador, limpiar legacy solo después de confirmar.

---

## Resumen actual

| Métrica | Valor |
|---------|-------|
| Líneas actuales (LegacyInventoryApp) | **10,851** |
| Líneas iniciales (referencia) | **11,539** |
| Líneas eliminadas (acumulado) | **~688** |
| Módulos extraídos | **1** |
| Reducción acumulada | **~6.0%** |

---

## Historial de reducción

| Fecha | Módulo | Líneas antes | Líneas después | Eliminadas | Estado |
|-------|--------|--------------|----------------|------------|--------|
| 2026-06-12 | Proveedores | 11,539 | 10,851 | ~688 | Validado en navegador · Build OK · Producción OK |

---

## Extracciones completadas

### 2026-06-12 — Proveedores

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

**Validación:**
- [x] Navegador — crear, editar, buscar, ver perfil
- [x] `npm run build`
- [x] Producción

---

## Próximos candidatos

| Prioridad | Módulo | Notas |
|-----------|--------|-------|
| 1 | Usuarios / ProfileManagement | Listado colaboradores, permisos, formularios extensos |
| 2 | Asistencia / RRHH | Terminal, reportes, tablas → cards en mobile |
| 3 | Inventario | `InventoryBase`, formulario monolítico, catálogo en cards |
| 4 | Órdenes de compra | Vistas automático / manual / historial |
| 5 | Reportes | `ReportsDashboard`, KPIs y tablas responsive |

---

## Plantilla para nuevas extracciones

```markdown
### YYYY-MM-DD — [Nombre módulo]

**Destino:** `frontend/src/modules/[nombre]/`

**Líneas Legacy:** [antes] → [después] (−[eliminadas])

**Estado:** [ ] Navegador · [ ] Build · [ ] Producción

**Notas:**
-
```

---

*Última actualización: 2026-06-12*
