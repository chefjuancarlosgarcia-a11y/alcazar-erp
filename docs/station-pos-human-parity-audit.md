# Auditoría paridad POS humano vs estación — implementación local

**Rama:** `fix/station-pos-human-parity` (PR #17 Draft).

**Repo:** `C:\Users\chefj\alcazar-inventario-os1`
**Estado remoto:** sin cambios; flags OFF; operador bloqueado; 199 **no** aplicada remoto.

---

## 0. Regresión hotfix — `service_opened` en migración 199

**Problema:** el `CREATE OR REPLACE` de `open_station_pos_table_service` en **199** conservó guards de ownership e idempotencia, pero **omitió** el `INSERT` en `public.pos_order_events` que **198** ejecuta al crear una orden nueva (`event_type = 'service_opened'`, `created_by = v_operator_id`).

**Impacto:** aperturas nuevas desde estación no registraban el evento de servicio abierto; replay/reuse no debían duplicarlo (y no lo hacían porque el insert faltaba por completo).

**Corrección (commit hotfix):** restaurar el bloque exacto de 198 **solo** tras `INSERT INTO pos_orders` exitoso (rama `created = true`), sin insertarlo en replay idempotente ni en reuse temprano/`unique_violation`.

**Verificación:** tests SQL 199 (`pg_get_functiondef` + runtime `open_station_pos_table_service`: new / idempotency replay / valid reuse) y preflight 199 (`baseline_open_preserves_service_opened`).

**Nota lab runtime:** el trigger `audit_pos_order_created` registra `order_created` con `auth.uid()` (JWT del dispositivo). El fixture cc199 incluye perfil mínimo para el auth user del device para que el FK `pos_order_events.created_by` no bloquee la apertura antes del insert de `service_opened`.

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

## 6. Migración 199 (propuesta, no remota)

Archivos:

- `supabase/schema/199_fix_operational_station_pos_catalog_parity.sql`
- `supabase/schema/199_test_operational_station_pos_catalog_parity.sql`
- `supabase/schema/diagnose_operational_station_pos_catalog_preflight_199.sql`
- `supabase/schema/diagnose_operational_station_pos_catalog_postflight_199.sql`
- `supabase/rollback/199_fix_operational_station_pos_catalog_parity.rollback.sql`

Cambios: `get_station_pos_catalog` (+`image_url`, `description`, `production_area_name`); assert/open owner guards; ACL preservada (`authenticated` en wrappers públicos; assert interno sin grant).

---

## 7. Evidencia PostgreSQL local

Script: `scripts/run-parity-lab-199.mjs`
Evidencia: `.local-backup/pg-lab/evidence/parity-199/199_test.log`

**Escenarios lab (última corrida post-hotfix):** ver `199_test.log` — incluye `service_opened` estático + runtime (new / replay / reuse).

---

## 8. Resultados suites

| Suite | Resultado |
|-------|-----------|
| `operationalStationsPosShared.selftest.mjs` | **51/51 PASS** |
| `stationPosHumanParity.selftest.mjs` | **8/8 PASS** |
| `operationalStations199TestSql.selftest.mjs` | **9/9 PASS** (structure SQL 199) |
| `run-parity-lab-199.mjs` (PG lab) | **20/20 PASS** |
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

**SQL:** 199 + test + diagnose + rollback

**Scripts:** `operationalStationsPosShared.selftest.mjs`, `stationPosHumanParity.selftest.mjs`, `operationalStations199TestSql.selftest.mjs`, `run-parity-lab-199.mjs`

---

## 10. Riesgos restantes

1. Categorías custom solo en `localStorage` humano no aparecen en estación (documentado).
2. Transferencia de servicio entre meseros → fase futura (no implementada).
3. 199 debe aplicarse en staging antes de smoke remoto con flags ON.
4. Verificación visual 1366×768 / zoom pendiente post-merge.

---

## 11. Veredicto final

### **APROBAR CON CONDICIONES**

PR #17 (Draft): hotfix `service_opened` aplicado en 199 local; listo para revisión con condiciones:

1. Aplicar 199 en staging (no producción) antes de smoke operativo.
2. Validar visualmente catálogo/imágenes con flags ON y operador desbloqueado en entorno controlado.
3. Confirmar que no hay mesas con órdenes humanas activas mezcladas en prueba real.
4. Ejecutar `diagnose_operational_station_pos_catalog_preflight_199.sql` remoto antes de apply; `ready_to_apply_199` debe ser true.

---
