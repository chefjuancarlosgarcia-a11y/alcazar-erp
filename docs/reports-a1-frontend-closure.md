# Cierre formal — Fase A1 (Frontend Reportes / Dashboard)

**Veredicto:** **PASS WITH MINOR NOTES — A1 frontend aprobada.**

**Fecha de cierre:** 2026-07-31  
**Validación:** propietario (manual) + selftests automatizados + build frontend  
**Alcance cerrado:** optimización frontend de Reportes/Dashboard (A1 → A1.7). Sin SQL, RPC, migraciones ni cambios backend.

---

## 1. Resumen ejecutivo

La Fase A1 reduce refetch innecesario, introduce stale-while-revalidate en tabs de reportes, separa estados loading/empty/error, aísla caché por usuario/rol/área y sanitiza logs sensibles. La validación manual confirma comportamiento visible y estable en interfaz. **No quedan blockers para cerrar A1.**

Subfases completadas:

| Subfase | Entregable principal |
|---------|---------------------|
| **A1** | `cachedQuery` en reportes, bundle operacional, lazy export PDF/Excel, skeletons y view states |
| **A1.5** | Auditoría read-only de aislamiento y TTL (hallazgos corregidos en A1.6) |
| **A1.6** | Scope/generación en `queryCache`, TTL por volatilidad GT, tab cache con scope |
| **A1.6b** | Stale-while-revalidate: TTL = frescura (no borrado), `error-with-cache`, guardas de tab |
| **A1.7** | Validación manual del propietario — **PASS WITH MINOR NOTES** |

---

## 2. Resultados consolidados (validación manual)

| Escenario | Resultado |
|-----------|-----------|
| Dashboard quieto sin refetch repetitivo | **PASS** |
| Refetch al volver a la pestaña de Chrome | Aceptable — **P2 no bloqueante** |
| Reporte ejecutivo: 8 rangos en paralelo (primer cache miss) | **PASS** (observado) |
| Reentrada al tab ejecutivo: 0 requests adicionales, sin flash vacío | **PASS** |
| Estados loading / empty / error separados | **PASS** |
| Caché aislado por usuario, rol y área | **PASS** |
| Logout / cambio de ámbito: reset + generación | **PASS** |
| Requests inflight anteriores no repoblan otra sesión | **PASS** |
| TTL por volatilidad y fecha operativa Guatemala | **PASS** |
| Excel vía import dinámico | **PASS** |
| PDF + autotable vía import dinámico | **PASS** |
| Logs API key / JWT sanitizados | **PASS** |
| Freshness posterior al TTL (stale → background refresh) | **PASS** |
| Offline con stale-while-revalidate (A1.6b) | **PASS** |
| Últimos datos conservados cuando falla el refresh | **PASS** |
| Recuperación mediante **Reintentar** | **PASS** |
| Sin SQL, RPC, migraciones ni cambios backend | **PASS** |
| POS, KDS, Caja e Inventario fuera de alcance | **PASS** (sin modificaciones funcionales) |

---

## 3. Pruebas automatizadas (verdes al cierre)

```bash
node frontend/scripts/queryCacheScope.selftest.mjs        # 28/28 OK
node frontend/scripts/queryCachePosProducts.selftest.mjs  # PASS (regresión POS products)
node frontend/scripts/reportsTabCacheStale.selftest.mjs   # 20/20 OK
cd frontend && npm run build                              # PASS
```

---

## 4. Archivos tocados en A1 (referencia)

### Servicios y caché

- `frontend/src/services/queryCache.js` — scope, generación, inflight isolation
- `frontend/src/services/cacheConfig.js` — TTL semánticos, claves, helpers GT
- `frontend/src/services/reportsService.js` — `cachedQuery`, errores explícitos, bundle operacional
- `frontend/src/context/AuthContext.jsx` — reset de scope en logout / cambio de perfil

### Reportes / Dashboard

- `frontend/src/modules/reports/reportsViewState.js` — tab cache store, `peekReportsTabCacheEntry`, view states
- `frontend/src/modules/reports/ReportsDashboard.jsx` — SWR tabs, guardas, retry
- `frontend/src/components/commandCenter/useCommandCenter.js` — bundle operacional único
- `frontend/src/pages/Dashboard.jsx`, `CommandCenterLayer.jsx` — skeleton, banner refresh

### Seguridad / observabilidad

- `frontend/src/lib/supabase.js`, `frontend/src/utils/supabaseConnectivity.js` — logs sanitizados
- `frontend/src/utils/reportsPerf.js`, `frontend/src/utils/erpPerf.js` — instrumentación dev

### Selftests

- `frontend/scripts/queryCacheScope.selftest.mjs`
- `frontend/scripts/reportsTabCacheStale.selftest.mjs`

---

## 5. Notas no bloqueantes (P2 / futuro)

| ID | Nota | Acción recomendada |
|----|------|-------------------|
| **P2** | Refetch al recuperar foco de Chrome (Command Center) | Evaluar debounce antes de implementar |
| **Futuro** | Validaciones manuales costosas | Stage + cuentas de prueba + Playwright E2E |
| **Futuro** | Scope frontend sin sucursal explícita | Incorporar `branchId` cuando el ERP sea multisucursal |

---

## 6. Deuda principal — siguiente trabajo A2

La **primera carga** del Dashboard ejecutivo sigue ejecutando **ocho consultas** a `pos_orders` con órdenes completas e `items:pos_order_items(*)`.

- La caché mejora **revisitas** y **navegación entre tabs**, pero **no reduce el payload pesado** del primer cache miss.
- **Siguiente paso recomendado:** **A2** — diseño y validación de una **RPC ejecutiva agregada** (read-only en fase de diseño; implementación no autorizada por este cierre).

Referencias relacionadas:

- `docs/erp-performance-rpc-audit.md`
- `docs/erp-performance-quantitative-diagnosis.md`

---

## 7. Restricciones de este cierre

Este documento **no autoriza**:

- Crear o aplicar SQL
- Crear migraciones
- Implementar la RPC ejecutiva
- Ejecutar cambios en Supabase
- Commit, push o deploy
- Modificar POS, KDS, Caja, Inventario ni autenticación

---

## 8. Protocolo manual de referencia (escenario offline stale)

Para revalidar A1.6b / escenario 6 en cualquier entorno:

1. `cd frontend` → `$env:VITE_ERP_PERF_DEBUG="true"; npm run dev`
2. Iniciar sesión con rol ejecutivo (`admin` / `ceo` / `gerente_general`)
3. **Reportes → Dashboard ejecutivo** — esperar KPIs
4. Cambiar a otra pestaña del dashboard (p. ej. Ventas)
5. Esperar **> 60 s** (TTL executive = 60 s)
6. DevTools → Network → **Offline**
7. Volver a **Dashboard ejecutivo**

**Esperado:** KPIs previos visibles + advertencia + **Reintentar**; **no** pantalla `error-without-cache` vacía.

---

## 9. Declaración de cierre

**Fase A1 (frontend Reportes/Dashboard) queda formalmente cerrada con veredicto PASS WITH MINOR NOTES.**

Blockers: **ninguno.**  
Trabajo inmediato siguiente (fuera de A1): **A2 — diseño RPC ejecutiva agregada.**

---

*Documento generado al cierre de A1.7. No sustituye runbooks de despliegue ni migraciones.*
