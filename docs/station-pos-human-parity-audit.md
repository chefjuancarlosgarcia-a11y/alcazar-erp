# Auditoría paridad POS humano vs estación — implementación local

**Rama:** `fix/station-pos-human-parity` (PR #17 Draft).

**Repo:** `C:\Users\chefj\alcazar-inventario-os1`
**Head:** `f413b1e6a2a268ea54b8a7f7d481f81b7a57b6b6`
**Estado remoto:** migración **199 aplicada y verificada** (una sola vez); flags OFF; operador bloqueado; sin smoke, PIN, órdenes, comandas ni pagos.

---

## 0. Regresión hotfix — `service_opened` en migración 199

**Problema:** el `CREATE OR REPLACE` de `open_station_pos_table_service` en **199** conservó guards de ownership e idempotencia, pero **omitió** el `INSERT` en `public.pos_order_events` que **198** ejecuta al crear una orden nueva (`event_type = 'service_opened'`, `created_by = v_operator_id`).

**Impacto:** aperturas nuevas desde estación no registraban el evento de servicio abierto; replay/reuse no debían duplicarlo (y no lo hacían porque el insert faltaba por completo).

**Corrección (commit hotfix):** restaurar el bloque exacto de 198 **solo** tras `INSERT INTO pos_orders` exitoso (rama `created = true`), sin insertarlo en replay idempotente ni en reuse temprano/`unique_violation`.

**Verificación:** tests SQL 199 (`pg_get_functiondef` + runtime lab `open_station_pos_table_service`: new / idempotency replay / valid reuse) y preflight/postflight 199 (`baseline_open_preserves_service_opened`).

**Nota lab runtime:** el trigger `audit_pos_order_created` registra `order_created` con `auth.uid()` (JWT del dispositivo). El fixture cc199 incluye perfil mínimo para el auth user del device para que el FK `pos_order_events.created_by` no bloquee la apertura antes del insert de `service_opened`.

---

## 0.1 Gate remoto 199 — aplicada y verificada

> **NO REAPLICAR 199** — ni 197 ni 198. La migración 199 ya está presente en Supabase remoto; repetir apply puede dejar estado parcial o romper funciones.

| Gate | Resultado | Detalle |
|------|-----------|---------|
| Preflight 199 | **16/16**, `ready_to_apply_199=true` | Read-only; `pg_proc.proconfig`; flags false |
| Apply 199 | **Aplicada una sola vez** | Forward-fix catalog parity + owner guards |
| Test remoto seguro | **21/21**, `failed_total=0` | Read-only estructural; sin DML operativo |
| Postflight 199 | **14/14**, `failed_total=0`, `ready_after_199=true` | Funciones seguras, ACL, markers, flags false |
| Lab runtime local | **20/20** | `199_lab_operational_station_pos_catalog_parity_runtime.sql` |
| Selftest SQL estructural | **11/11** | `operationalStations199TestSql.selftest.mjs` |
| Flags remoto | **false / false** | `operational_stations_enabled`, `operational_station_pos_enabled` |
| Operador remoto | **Bloqueado** | Sin smoke, PIN, órdenes, comandas ni pagos |

### Incidente primer test remoto (resuelto)

El primer intento de `199_test_operational_station_pos_catalog_parity.sql` en Supabase administrado **abortó** en la primera llamada (~línea 88):

- **Error:** `42501 permission denied to set parameter session_replication_role`
- **Causa:** el test original era un lab PostgreSQL con privilegios elevados (`session_replication_role`, `INSERT auth.users`, toggles de trigger, `UPDATE app_settings`, fixtures cc199-*).
- **Corrección (commit `f413b1e`):** separación estricta:
  - **A — Test remoto:** read-only estructural (`BEGIN/ROLLBACK`, catálogo + `pg_get_functiondef` + `pg_proc.proconfig`).
  - **B — Lab local:** runtime 20/20 con fixtures elevados vía `run-parity-lab-199.mjs`.

Transacción abortada/revertida en el intento fallido; **sin fixtures persistentes** en remoto.

---

## 1. Causa demostrada — letras “M” en tabs de categoría

**Función:** `buildStationCategoriesFromCatalogProducts` (versión pre-paridad en `stationPosCatalogMapper.js`).

**Condición:** categorías derivadas solo del RPC, sin merge con metadata canónica.

**Default artificial:** `icon: "M"`, `color: "#64748b"` para toda categoría RPC.

**Corrección:** merge con `DEFAULT_POS_CATEGORIES` por ID (`posDefaultCategories.js` + `posCatalogCanonical.js`). Iconos reales (🍕, 🥗, …). Categorías custom **solo en localStorage humano** no se sincronizan (documentado, by design PR #16).

---

## 2. Causa demostrada — monogramas en tarjetas de producto

**Componente:** `PosProductGrid` en `PosTicketPanel.jsx` (369–371).

**Propiedad faltante:** `item.imagen` — mapper estación no mapeaba `image_url`; RPC `get_station_pos_catalog` (198) no devolvía imagen.

**Corrección:** migración **199** añade `image_url` en batch; normalizador canónico `mapPOSProductFromSupabase` → `imagen`.

---

## 3. Causa exacta reproducida del P0001 remoto

**Descartado como causa primaria:** flags OFF (plano y catálogo cargaron en smoke → gates activos).

### Reproducción PostgreSQL local (embedded, puerto 54330)

| Campo | Valor demostrado |
|-------|------------------|
| **Función** | `station_pos_assert_order_open_for_drafts` |
| **Bloque** | `if not public.station_pos_is_order_owner(...)` |
| **Condición** | `owner_profile_id ≠ operator_profile_id` |
| **Mensaje 198** | `Operacion no permitida.` (P0001 genérico) |
| **Mensaje 199** | `STATION_POS_ORDER_OWNER_MISMATCH` |
| **order_id** | `19900000-…0010` |
| **owner_profile_id** | `19900000-…0001` |
| **operator_profile_id** | UUID distinto (operador PIN estación) |
| **Estado mesa/orden** | `status = open`, mesa con servicio existente de otro titular |

**Escenario remoto equivalente:**

1. Mesa con orden abierta desde `/pos` humano (`owner_profile_id` = mesero humano).
2. Operador estación selecciona mesa → `cargarMesaDesdeSupabase` carga orden ajena → `activeOrderId` queda seteado.
3. Primer producto llama `addItemToOrder` **sin** `openPosTableService` (orden ya existía).
4. SQL: `add_station_pos_order_item` → `station_pos_assert_order_open_for_drafts` → owner mismatch → **P0001**.

**Correcciones aplicadas:**

- **199:** errores diferenciados + bloqueo reuse en `open_station_pos_table_service`.
- **Frontend:** mensaje “Esta mesa está siendo atendida por otro mesero.” al seleccionar mesa / antes de add; `mapPosTableServiceError` traduce códigos.

---

## 4. Tabla — 24× “Operacion no permitida.” en 198

| # | Función | Condición | Contexto | Error esperado (199 donde aplica) |
|---|---------|-----------|----------|-----------------------------------|
| 1 | `station_pos_idempotency_replay_if_completed` | `operator_session_id` ≠ sesión actual | Idempotencia replay | Genérico |
| 2 | `station_pos_idempotency_begin` | token vacío | Inicio idempotencia | Genérico |
| 3 | `station_pos_idempotency_begin` | device null | Device auth | Genérico |
| 4 | `station_pos_idempotency_begin` | estación no POS/activa | Device/station | Genérico |
| 5 | `station_pos_idempotency_begin` | sesión módulo/estación inválida | Session | Genérico |
| 6 | `resolve_station_pos_operator_context` | flags OFF | Gate global | Genérico |
| 7 | `resolve_station_pos_operator_context` | device null/inactivo | Device | Genérico |
| 8 | `resolve_station_pos_operator_context` | estación no POS/activa | Station | Genérico |
| 9 | `resolve_station_pos_operator_context` | sesión módulo/estación ≠ POS | Session module | Genérico |
| 10 | `resolve_station_pos_operator_context` | operador null/inactivo | Profile | Genérico |
| 11 | `resolve_station_pos_operator_context` | sin assignment activo | Assignment | Genérico |
| 12 | `resolve_station_pos_operator_context` | `station_pos_can_operate_orders` false | Rol | Genérico |
| 13 | `station_pos_lock_operator_session` | estación no POS | Lock | Genérico |
| 14 | `open_station_pos_table_service` | `auth.uid()` null | Auth | Genérico |
| 15 | `open_station_pos_table_service` | cannot operate orders | Rol | Genérico |
| 16 | `station_pos_assert_order_open_for_drafts` | status ≠ open | Draft gate | **STATION_POS_ORDER_NOT_OPEN** |
| 17 | `station_pos_assert_order_open_for_drafts` | not owner | Owner | **STATION_POS_ORDER_OWNER_MISMATCH** |
| 18–24 | Wrappers mutación (`add_`, `update_`, `remove_`, `clear_`, `send_`, …) | `auth.uid()` null; catch-all | Mutación | Genérico / códigos propagados |

Lecturas (`get_station_pos_catalog`, floor, …): solo `auth.uid()` null → genérico.

---

## 5. Contrato humano vs técnico (antes / después)

| Campo UI | Humano (antes) | Estación (antes) | Estación (después 199 + canónico) |
|----------|----------------|------------------|-----------------------------------|
| `imagen` | `image_url` vía mapper | ausente | `image_url` batch RPC |
| `categoria` tab icon/color | DEFAULT + LS | `"M"` / gris | DEFAULT merge, sin LS |
| `productionArea.name` | areas service | ausente | `production_area_name` RPC |
| variantes/modificadores | mapper camelCase | arrays crudos | mismo `mapPOSProductFromSupabase` |
| owner conflict | N/A humano | P0001 silencioso | mensaje + código SQL |

---

## 6. Migración 199 — aplicada remoto

Archivos:

- `supabase/schema/199_fix_operational_station_pos_catalog_parity.sql`
- `supabase/schema/199_test_operational_station_pos_catalog_parity.sql` (remoto read-only)
- `supabase/schema/199_lab_operational_station_pos_catalog_parity_runtime.sql` (lab local 20/20)
- `supabase/schema/diagnose_operational_station_pos_catalog_preflight_199.sql`
- `supabase/schema/diagnose_operational_station_pos_catalog_postflight_199.sql`
- `supabase/rollback/199_fix_operational_station_pos_catalog_parity.rollback.sql`

Cambios: `get_station_pos_catalog` (+`image_url`, `description`, `production_area_name`); assert/open owner guards; ACL preservada (`authenticated` en wrappers públicos; assert interno sin grant).

---

## 7. Evidencia PostgreSQL local

Script: `scripts/run-parity-lab-199.mjs`
Evidencia: `.local-backup/pg-lab/evidence/parity-199/`

| Capa | Escenarios |
|------|------------|
| Test remoto seguro (lab) | **21/21** estructural |
| Lab runtime | **20/20** (`service_opened`, replay, reuse, owner mismatch, pricing) |

---

## 8. Resultados suites

| Suite | Resultado |
|-------|-----------|
| `operationalStationsPosShared.selftest.mjs` | **51/51 PASS** |
| `stationPosHumanParity.selftest.mjs` | **8/8 PASS** |
| `operationalStations199TestSql.selftest.mjs` | **11/11 PASS** (remote-safe + lab separation) |
| `run-parity-lab-199.mjs` (PG lab) | **21/21 structural + 20/20 runtime PASS** |
| OS1 / OS2 / OS2 Cash / PIN UX | **PASS** |
| POS humano 187 (selftest + SQL) | **PASS** |
| `npm run build --prefix frontend` | **PASS** |
| `git diff --check` | **PASS** |
| `service_role` en frontend tocado | **0** |
| `create_pos_split_payment` path estación | **0** |
| `get_pos_product_image_url` N+1 estación | **0** |

---

## 9. Archivos modificados

**Frontend:** `posCatalogCanonical.js`, `posDefaultCategories.js`, `posProductsService.js`, `stationPosCatalogMapper.js`, `stationPosService.js`, `posOrdersService.js`, `POS.jsx`

**SQL:** 199 + test remoto + lab runtime + diagnose + rollback

**Scripts:** `operationalStationsPosShared.selftest.mjs`, `stationPosHumanParity.selftest.mjs`, `operationalStations199TestSql.selftest.mjs`, `run-parity-lab-199.mjs`

**Docs:** `docs/station-pos-human-parity-audit.md`

---

## 10. Riesgos restantes

1. Categorías custom solo en `localStorage` humano no aparecen en estación (documentado).
2. Transferencia de servicio entre meseros → fase futura (no implementada).
3. Verificación visual 1366×768 / zoom pendiente post-merge.
4. Gate operativo posterior: flags ON, operador desbloqueado, smoke controlado — **autorización separada**.

---

## 11. Veredicto final

### **APROBAR PARA READY/MERGE, CON GATE OPERATIVO POSTERIOR**

PR #17 (Draft): migración 199 aplicada y verificada en remoto; frontend + SQL alineados.

**Completado:**

- Preflight 16/16 → apply 199 (una vez) → test remoto 21/21 → postflight 14/14
- Lab runtime 20/20; selftest SQL 11/11
- Flags remoto false; operador bloqueado

**Pendiente (autorización separada):**

1. Marcar PR Ready y merge a `main`
2. Deploy frontend a producción
3. Gate operativo: habilitar flags + smoke controlado (sin órdenes reales ni pagos hasta autorización explícita)

**Prohibición:** **NO REAPLICAR 197 / 198 / 199**.

---
