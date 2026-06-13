# Auditoría de código legacy muerto

Auditoría estática del frontend. Fecha: 2026-06-09.  
**Limpieza ejecutada:** 2026-06-09 — ver sección [Limpieza completada](#limpieza-completada-2026-06-09).

---

## Resumen

**Veredicto (pre-limpieza):** En el flujo normal de producción, las secciones legacy `inventario`, `recetas` y `requisicion` **no se renderizaban**.

**Estado actual:** Esas UIs fueron **eliminadas** de `LegacyInventoryApp.jsx` (−3,511 líneas). Los deep links `/hr?section=inventario|recetas|requisicion` redirigen a `/inventory?section=…` vía `HR.jsx`.

**Monolito:** 9,356 → **5,845** líneas (−37.5% en esta fase; **−49.3%** vs referencia 11,539).

---

## Rutas revisadas

| Ruta | Componente actual | ¿Usa LegacyInventoryApp? | Estado |
|------|-------------------|--------------------------|--------|
| `/inventory?section=inventario` | `InventoryBase` | No | **Vivo (moderno)** — sidebar “Productos” |
| `/inventory?section=recetas` | `RecipesSupabase` | No | **Vivo (moderno)** — sidebar “Recetas estandarizadas”, link POS |
| `/inventory?section=requisicion` | `RequisitionsSupabase` | No | **Vivo (moderno)** — sidebar “Requisiciones” |
| `/inventory?section=ordenes` | `LegacyInventoryApp` → `PurchaseOrdersModule` | Sí (shell + state legacy) | **Vivo** — sidebar, notificaciones |
| `/inventory?section=proveedores` | `LegacyInventoryApp` → `SuppliersModule` | Sí (shell + state legacy) | **Vivo** — sidebar, botón en `InventoryBase` |
| `/inventory?section=areas` | `LegacyInventoryApp` (sección `areas`) | Sí | **Vivo** — sidebar “Áreas operativas” |
| `/inventory?section=inventarioAreas` | `InventoryBase` | No | **Vivo (moderno)** |
| `/inventory?section=movimientosInventario` | `InventoryBase` | No | **Vivo (moderno)** |
| `/inventory?section=produccionInterna` | `InternalProduction` | No | **Vivo (moderno)** |
| `/inventory?section=conversiones` | `InventoryItemConversions` | No | **Vivo (moderno)** |
| `/inventory` (sin section) | `InventoryBase` (`section` default `"inventario"`) | No | **Vivo (moderno)** |
| `/hr?section=reportesAsistencia` | `LegacyInventoryApp` → `AttendanceReportsModule` | Sí | **Vivo** — sidebar RRHH |
| `/hr?section=inventario\|recetas\|requisicion` | Redirect → `/inventory?section=…` | No (guard en `HR.jsx`) | **Resuelto** — ya no monta Legacy |

**Cadena de enrutamiento verificada:**

1. `AppRoutes.jsx` → `/inventory` → `Inventory.jsx` (ProtectedRoute)
2. `MainLayout.jsx` → sidebar global `components/Sidebar.jsx` (no monta Legacy)
3. `Inventory.jsx` early-return antes de lazy-load Legacy:

```32:52:frontend/src/pages/Inventory.jsx
  if (["inventario", "inventarioAreas", "movimientosInventario"].includes(initialSeccion)) {
    return <InventoryBase section={initialSeccion} initialAreaId={areaId} />
  }

  if (initialSeccion === "requisicion") {
    return <RequisitionsSupabase />
  }

  if (initialSeccion === "recetas") {
    return <RecipesSupabase />
  }
  // ...
  return <Suspense ...><LegacyInventoryApp ... hideLegacyNavigation /></Suspense>
```

---

## Secciones legacy revisadas

| Sección legacy | ¿Se renderiza en prod normal? | Cómo se comprobó | Riesgo de borrar |
|----------------|-------------------------------|------------------|------------------|
| `seccionActiva === "inventario"` (~L6717–7371, ~654 líneas JSX) | **No** vía `/inventory` | `Inventory.jsx` redirige a `InventoryBase`; sidebar apunta a `/inventory?section=inventario` | **Bajo** en flujo normal; validar `/hr?section=inventario` |
| `seccionActiva === "recetas"` (~L5629–6152, ~523 líneas JSX) | **No** vía `/inventory` | `Inventory.jsx` redirige a `RecipesSupabase`; no existe `setSeccionActiva("recetas")` en el repo | **Bajo** en flujo normal; validar `/hr?section=recetas` |
| `seccionActiva === "requisicion"` (~L6154–6466, rama ternario) | **No** vía `/inventory` | `Inventory.jsx` redirige a `RequisitionsSupabase`; sidebar apunta a query moderna | **Bajo** en flujo normal; validar `/hr?section=requisicion` |
| `seccionActiva === "inventarioAreas"` (~L6611) | **No** vía `/inventory` | Interceptado por `InventoryBase` | **Bajo** — mismo patrón |
| `seccionActiva === "movimientosInventario"` (~L6703) | **No** vía `/inventory` | Interceptado por `InventoryBase` | **Bajo** — mismo patrón |
| `seccionActiva === "ordenes"` | **Sí** | Sidebar + `NotificationsBell` → `/inventory?section=ordenes` | **Alto** — mantener |
| `seccionActiva === "proveedores"` | **Sí** | Sidebar + link en `InventoryBase` | **Alto** — mantener |
| `seccionActiva === "areas"` | **Sí** | Sidebar “Áreas operativas”; botones internos redirigen a rutas modernas | **Alto** — mantener (aunque botones salen a Supabase) |

**Entry points de `LegacyInventoryApp` (solo 2):**

| Archivo | Cuándo monta Legacy | `hideLegacyNavigation` |
|---------|---------------------|------------------------|
| `frontend/src/pages/Inventory.jsx` | `areas`, `ordenes`, `proveedores` | Siempre `true` |
| `frontend/src/pages/HR.jsx` | Fallback (p. ej. `reportesAsistencia`) | Siempre `true` |

**Navegación interna legacy:** `LegacySidebar` solo renderiza si `!hideLegacyNavigation`. En producción esa condición es siempre falsa → no hay tabs legacy visibles.

---

## Referencias encontradas

| Referencia | Archivo | Uso actual | Acción sugerida |
|------------|---------|------------|-----------------|
| `seccionActiva === "recetas"` | `LegacyInventoryApp.jsx` L5629 | Solo si Legacy montado con `initialSeccion=recetas` | Candidato eliminación Fase 1 |
| `seccionActiva === "requisicion"` | `LegacyInventoryApp.jsx` L6154 | Solo deep link `/hr?` o `setSeccionActiva` interno | Candidato eliminación Fase 1 |
| `seccionActiva === "inventario"` | `LegacyInventoryApp.jsx` L6717 | Solo deep link `/hr?` o `setSeccionActiva` interno | Candidato eliminación Fase 1 |
| `setSeccionActiva("requisicion")` | `LegacyInventoryApp.jsx` L4095 (`crearRequisicionParaArea`) | Handler dentro de sección legacy requisición | Eliminar con bloque requisición |
| `setSeccionActiva("requisicion")` | `LegacyInventoryApp.jsx` L6750 | Botón en UI legacy inventario | Eliminar con bloque inventario |
| `setSeccionActiva("inventario")` | `LegacyInventoryApp.jsx` L4287 (`verRequisicion`) | Handler legacy requisición → inventario | Eliminar con bloques relacionados |
| `setSeccionActiva("recetas")` | — | **No encontrado** en todo el frontend | Confirma que recetas legacy no se alcanza por navegación interna |
| `/inventory?section=inventario` | `Sidebar.jsx` L27 | Navega a `InventoryBase` | Correcto — no tocar |
| `/inventory?section=requisicion` | `Sidebar.jsx` L28 | Navega a `RequisitionsSupabase` | Correcto — no tocar |
| `/inventory?section=recetas` | `Sidebar.jsx` L34, `PosDishCatalog.jsx` L166 | Navega a `RecipesSupabase` | Correcto — no tocar |
| `/inventory?section=inventario` | `LegacyInventoryApp.jsx` L6632 | Botón en sección `areas` → **sale a ruta moderna** (`window.location.assign`) | No alimenta UI legacy |
| `/inventory?section=inventarioAreas` | `LegacyInventoryApp.jsx` L6693 | Botón en sección `areas` → ruta moderna | No alimenta UI legacy |
| `/inventory?section=ordenes` | `Sidebar.jsx`, `NotificationsBell.jsx` | Monta Legacy + `PurchaseOrdersModule` | Mantener |
| `/inventory?section=proveedores` | `Sidebar.jsx`, `InventoryBase.jsx` L797 | Monta Legacy + `SuppliersModule` | Mantener |
| `modulosDisponibles` keys inventario/recetas/requisicion | `LegacyInventoryApp.jsx` L3063–3075 | Alimentan `LegacySidebar` (oculto) y validación de sección | Limpiar tras retirar bloques JSX |
| Handlers recetas (`seleccionarIngredienteReceta`, etc.) | `LegacyInventoryApp.jsx` ~L3107+ | Solo usados por UI legacy recetas | Eliminar con bloque recetas |
| State inventario/requisición/recetas | `LegacyInventoryApp.jsx` (múltiple) | Compartido parcialmente con órdenes/áreas | Auditar dependencias cruzadas antes de borrar state |

---

## Caminos de usuario en producción

| Origen | ¿Llega a legacy inventario/recetas/requisición? |
|--------|--------------------------------------------------|
| Sidebar inventario (`components/Sidebar.jsx`) | **No** — URLs modernas |
| MainLayout + router | **No** — pasa por `Inventory.jsx` |
| Notificaciones (`NotificationsBell.jsx`) | **No** — solo `/inventory?section=ordenes` o `/hr?section=horarios` |
| POS post-guardado (`PosDishCatalog.jsx`) | **No** — link a `RecipesSupabase` |
| Deep link `/inventory?section=*` | **No** para inventario/recetas/requisición |
| Deep link manual `/hr?section=inventario\|recetas\|requisicion` | **Sí** — monta Legacy con bloque correspondiente |
| `LegacySidebar` tabs | **No** — oculto (`hideLegacyNavigation=true`) |
| Login standalone legacy | **No** — `Login.jsx` no monta Legacy |

---

## Veredicto

### Seguro para eliminar (flujo `/inventory` normal)

| Bloque | Líneas aprox. | Notas |
|--------|---------------|-------|
| JSX `seccionActiva === "recetas"` | ~523 | Sin referencias externas; sin `setSeccionActiva("recetas")` |
| JSX rama `seccionActiva === "requisicion"` | ~310 | Sidebar usa módulo Supabase |
| JSX `seccionActiva === "inventario"` | ~654 | Sidebar usa `InventoryBase` |
| JSX `inventarioAreas` / `movimientosInventario` en Legacy | ~100 | Interceptados por `InventoryBase` |
| Handlers UI exclusivos de esas secciones | variable | Tras grep de dependencias con órdenes/áreas |

**Total estimado eliminable en Fase 1:** ~1.500–2.000 líneas JSX + handlers asociados (sin contar state compartido hasta auditar).

### Mantener por ahora

| Bloque | Motivo |
|--------|--------|
| Shell Legacy + state de **órdenes de compra** | En producción vía sidebar y notificaciones |
| **Proveedores** (`SuppliersModule` + state) | En producción |
| **Áreas operativas** | En producción; botones ya redirigen a Supabase |
| **Reportes asistencia** (`AttendanceReportsModule`) | En producción vía `/hr?section=reportesAsistencia` |
| **Usuarios** legacy en Legacy | Interceptado por `ProfileManagement` en HR; bloque legacy probablemente muerto pero fuera del alcance de esta auditoría |

### Requiere validación manual

| Escenario | Acción |
|-----------|--------|
| `/hr?section=inventario`, `/hr?section=recetas`, `/hr?section=requisicion` | Probar en localhost/staging; si nadie usa, redirigir a `/inventory?section=...` o 404 antes de borrar |
| State compartido (`ingredientes`, `requisiciones`, handlers usados por órdenes) | Grep de dependencias cruzadas antes de eliminar state |
| Bookmarks antiguos `/hr?section=...` | Revisar analytics/logs si existen |

---

## Recomendación

### Fase 1 — Limpieza conservadora (inventario / recetas / requisición legacy)

1. **Validación manual (1 sesión):** Abrir `/hr?section=inventario`, `recetas`, `requisicion` y confirmar que no son flujos operativos. Documentar capturas o redirigir explícitamente a rutas modernas en `HR.jsx` como guardia.
2. **Eliminación por bloques** (orden sugerido):
   - Rama JSX `recetas` (L5629–6152)
   - Rama JSX `requisicion` (L6154–6466)
   - Ramas `inventarioAreas`, `movimientosInventario`, `inventario` en el else (L6611–7371)
   - Handlers huérfanos: `crearRequisicionParaArea`, `verRequisicion`, helpers recetas, etc.
   - Entradas en `modulosDisponibles` / `moduleContext` para keys retiradas
3. **No usar feature flag** para UI ya muerta en `/inventory` — el dispatcher ya actúa como switch. Opcional: guard en `HR.jsx` que redirija secciones inventario migradas a `/inventory?section=...`.
4. **Post-limpieza:** `npm run build`, smoke test sidebar (Productos, Requisiciones, Recetas, Órdenes, Proveedores, Áreas), notificaciones de órdenes.

### Fase 2 (posterior, fuera de este alcance)

- Extraer **áreas operativas** a módulo independiente (mismo patrón que órdenes/proveedores).
- Retirar auth local `usuarioActual` / `LegacySidebar` cuando no queden secciones legacy.

---

## Limpieza completada (2026-06-09)

| Métrica | Valor |
|---------|-------|
| Líneas antes | 9,356 |
| Líneas después | 5,845 |
| Eliminadas | 3,511 |
| Reducción vs referencia (11,539) | ~49.3% acumulado |
| Build | OK |
| Bundle Legacy (gzip) | ~52 kB (antes ~190 kB) |

**Archivos tocados:**
- `frontend/src/modules/LegacyInventoryApp.jsx` — eliminación principal
- `frontend/src/pages/HR.jsx` — redirects (hecho en fase previa)
- `docs/legacy-extraction-progress.md`, `docs/legacy-roadmap.md` — actualizados

**Smoke test sugerido:** Productos, Requisiciones, Recetas (Supabase); Órdenes, Proveedores, Áreas (Legacy); `/hr?section=reportesAsistencia`; botón “Crear requisición” en áreas → `/inventory?section=requisicion`.

---

## Archivos auditados

- `frontend/src/pages/Inventory.jsx` — dispatcher principal
- `frontend/src/pages/HR.jsx` — redirects deprecated sections
- `frontend/src/routes/AppRoutes.jsx` — ruta `/inventory`
- `frontend/src/layouts/MainLayout.jsx` — layout con sidebar global
- `frontend/src/components/Sidebar.jsx` — navegación producción
- `frontend/src/components/NotificationsBell.jsx` — deep links notificaciones
- `frontend/src/components/PosDishCatalog.jsx` — link a recetas
- `frontend/src/modules/LegacyInventoryApp.jsx` — **5,845 líneas post-limpieza**
- `frontend/src/modules/LegacySidebar.jsx` — navegación legacy (oculta en prod)

*Auditoría inicial: 2026-06-09. Limpieza aplicada: 2026-06-09.*
