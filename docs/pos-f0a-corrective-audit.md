# F0A — Auditoría correctiva (post-implementación local)

**Fecha:** 2026-07-18  
**Estado:** Correcciones aplicadas en repo; **184 no aplicada en Stage/prod**  
**F0B:** no iniciada

---

## 1. Expansión de roles — revertida

Se **revirtió** la inclusión de `cajero` y `servicio` en `POS_ROLES` (`frontend/src/pages/POS.jsx`).

Regla aplicada: **F0A no concede acceso operativo nuevo.** Las inconsistencias frontend/backend quedan documentadas para una fase futura de permisos POS.

### Matriz antes / después F0A (comportamiento efectivo)

| Rol | ProtectedRoute `pos` | POS_ROLES (página) | `can_operate_pos_orders` | Crear orden (RLS) | Agregar productos | Cobrar (`/cash`) | Antes F0A | Después F0A (corregido) |
|-----|----------------------|--------------------|---------------------------|-------------------|-------------------|------------------|-----------|-------------------------|
| admin | Sí | Sí | Sí | Sí | Sí | Sí | POS completo | Igual |
| gerente_general | Sí | Sí | Sí | Sí | Sí | Sí | POS completo | Igual |
| gerente_operaciones | Sí | **No** | **No** | No | No* | No | Bloqueado en página POS | Igual |
| supervisor | Sí | Sí | Sí | Sí | Sí | Sí | POS completo | Igual |
| mesero | Sí | Sí | Sí | Sí | Sí | No** | POS mesero | Igual |
| servicio | Sí | **No** | Sí | Sí*** | Sí*** | No | **Bloqueado en página** aunque router permita | Igual (no ampliado) |
| caja | Sí | Sí | Sí | Sí | Sí | Sí | POS + caja | Igual |
| cajero | Sí | **No** | Sí | Sí*** | Sí*** | Sí | **Bloqueado en página** aunque router/caja permitan | Igual (no ampliado) |

\* Sin acceso a UI POS.  
\*\* `canAccessCashier` no incluye mesero.  
\*\*\* Solo si alcanzaran la UI POS (hoy bloqueados por `POS_ROLES`).

### Inconsistencias pendientes (fase permisos dedicada)

| Capa | Inconsistencia |
|------|----------------|
| Router | `servicio`, `cajero`, `gerente_operaciones` tienen módulo `pos` en `ROLE_PERMISSIONS` |
| Página POS | `POS_ROLES` más restrictivo (comportamiento legacy intencional) |
| PostgreSQL | `can_operate_pos_orders` incluye `cajero`, `caja`, `servicio`, `supervisor` |
| Caja | `CASHIER_ROLES` incluye `cajero`, `caja`; no incluye `mesero` |

**No corregido en F0A** — requiere decisión de negocio explícita.

---

## 2. `set_pos_order_owner_internal` — eliminada

| Aspecto | Hallazgo original | Corrección |
|---------|-------------------|------------|
| Presencia | RPC SECURITY DEFINER con `set_config` bypass | **Eliminada** de `184_pos_order_owner_f0a.sql` |
| EXECUTE PUBLIC | `REVOKE FROM PUBLIC` insuficiente solo | Función ya no existe; `DROP IF EXISTS` al final de 184 |
| F0B | Bypass anticipado | F0B creará RPC atómica autorizada |

**Decisión:** no hay razón técnica indispensable para conservarla en F0A.

---

## 3. Funciones diagnósticas y test — permisos

| Función | Security | search_path | EXECUTE efectivo | Datos expuestos |
|---------|----------|-------------|------------------|-----------------|
| `diagnose_pos_order_owner_integrity` | DEFINER | `'', public` | **service_role** only | Agregados (conteos) |
| `diagnose_pos_order_owner_orphans` | DEFINER | `'', public` | **service_role** only | order_id, orphan uuid, status, created_at |
| `test_pos_order_owner_f0a_rules` | DEFINER | `'', public` | **service_role** only | Resultados pass/fail |
| `sync_pos_order_owner_legacy` | INVOKER (trigger) | `'', public` | N/A (trigger) | — |
| `guard_pos_order_owner_columns` | INVOKER (trigger) | `'', public` | N/A (trigger) | — |
| `get_waiter_sales_ranking` | DEFINER | `''` | authenticated (sin cambio) | Ranking según permisos existentes |

**Revocado:** PUBLIC, anon, authenticated en diagnósticos y tests.  
**Uso operativo:** SQL Editor (postgres) o service_role en Stage.

---

## 4. Triggers — diseño corregido

| Escenario | Comportamiento esperado |
|-----------|-------------------------|
| INSERT owner NULL, waiter = auth.uid() | Sync → owner = waiter |
| INSERT owner ≠ waiter | **REJECT** `POS_ORDER_OWNER_WAITER_MISMATCH` (no overwrite silencioso) |
| UPDATE owner only | **REJECT** `POS_ORDER_OWNER_IMMUTABLE` |
| UPDATE waiter only | **REJECT** |
| UPDATE both | **REJECT** |
| UPDATE status | **Permitido** |
| Backfill migración | Ejecuta **antes** de crear triggers |
| set_config bypass | **Eliminado** |

Sync trigger: solo **BEFORE INSERT** (sin rama UPDATE).

---

## 5. Ranking — revisión

| Criterio | Estado |
|----------|--------|
| Filtros `status = 'paid'`, rango mes | Conservados |
| Permisos `can_read_sales_goals` / public widget | Conservados |
| `search_path = ''` | Conservado (igual que 048) |
| `coalesce(owner_profile_id, waiter_id)` | Sí |
| Duplicación ventas | No — un seller_id por orden; post-backfill owner=waiter |
| Cambio totales vs pre-F0A | **No** mientras owner=waiter (backfill) |

---

## 6. Pruebas locales ejecutadas

| Prueba | Resultado |
|--------|-----------|
| `node frontend/scripts/posOrderOwnerF0a.selftest.mjs` | **4/4 OK** |
| `npm run build` (frontend) | **OK** |
| `npm run lint` (archivos tocados) | Ver salida abajo |

### Pendiente en Stage (obligatorio antes de prod)

Ver checklist completo en [`docs/pos-f0a-stage-runbook.md`](pos-f0a-stage-runbook.md) §7:

1. Cero pérdidas/cambios de órdenes  
2. Huérfanos identificados y explicados  
3. SQL/RLS aprobados (`184_test`, guard owner)  
4. Orden nueva `owner_profile_id = waiter_id`  
5. Ayuda entre meseros sin apropiación  
6. KDS, cuenta, cobro OK  
7. Ranking mismos totales pre/post  
8. Operations Center sin errores nuevos  

**F0B bloqueada** hasta aprobación explícita post-Stage.

---

## 7. Archivos ajustados en esta auditoría

| Archivo | Cambio |
|---------|--------|
| `frontend/src/pages/POS.jsx` | Revertido `POS_ROLES` |
| `supabase/schema/184_pos_order_owner_f0a.sql` | Backfill antes triggers; sin internal RPC; sin set_config; permisos diagnostics |
| `supabase/schema/184_test_pos_order_owner_f0a.sql` | Tests ampliados; permisos service_role only |
| `frontend/scripts/posOrderOwnerF0a.selftest.mjs` | Test roles revertidos |
| `docs/pos-f0a-corrective-audit.md` | Este documento |
| `docs/pos-f0a-stage-runbook.md` | Instrucciones Stage |

---

## Confirmaciones

- [x] Expansión roles revertida  
- [x] Función interna eliminada  
- [x] Permisos diagnósticos restringidos  
- [x] Triggers corregidos (sin bypass, backfill ordenado)  
- [ ] **F0A no verificada en Stage** (SQL/RLS pendientes)  
- [x] **F0B no comenzada**  
- [x] Sin commit, push, despliegue ni SQL en producción
