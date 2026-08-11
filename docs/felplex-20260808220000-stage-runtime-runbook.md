# FELplex 20260808220000 — Runbook Stage (runtime transaccional)

**Proyecto Stage:** `tgrqarxfmpwgrkntvgma`  
**Alcance:** validación operativa local de RPCs `claim` / `finalize` (Fase 1A.3)  
**Estado del repo:** diseño + script listo para revisión externa — **no ejecutado en esta entrega**

---

## 1. Propósito

Validar en Supabase Stage, **dentro de una sola transacción con `ROLLBACK`**, que:

- `fel_claim_pos_fel_certification_attempt(uuid, uuid)` respeta gates DB, locks e intentos.
- `fel_finalize_pos_fel_certification_attempt(...)` finaliza éxito/fallo sin mutar órdenes ni pagos.
- La habilitación temporal `emission_enabled = true` **no persiste** fuera de la transacción.

**No** despliega Edge Functions. **No** llama a FELplex. **No** usa HTTP, `pg_net` ni secretos.

---

## 2. Precondiciones confirmadas (Stage actual)

| Elemento | Valor esperado |
|----------|----------------|
| Migración aplicada | `20260808220000_pos_fel_attempt_lifecycle.sql` |
| `db push --dry-run` | Remote database is up to date |
| `fel_emission_config id=1` | `environment=stage`, `emission_enabled=false`, `auto_issue_paid_orders=false`, `formal_contingency_enabled=false` |
| `pos_fel_documents` | 3 filas ficticias Q297 |
| `pos_fel_attempts` | 0 filas |
| Pruebas estructurales | 25/25 `executed=true passed=true` (archivo `supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql`) |

Usuarios ficticios Stage:

| Email | Rol |
|-------|-----|
| `admin@stage-fel.test` | admin |
| `cajero@stage-fel.test` | caja / cajero (actor del runtime) |
| `mesero@stage-fel.test` | mesero |

Fixture POS (`supabase/stage-fixtures/felplex_pos_minimal_fixture.sql`):

- Área `fel_test_cocina`
- Producto `fef00001-0000-4000-8000-000000000001`
- Zona `fel_test_salon`
- Mesas `M-FEL-OPEN`, `M-FEL-PARTIAL`, `M-FEL-PAID`
- Caja `fef00002-0000-4000-8000-000000000002`

---

## 3. Archivo a ejecutar

```
supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql
```

**Rol requerido:** SQL Editor privilegiado (`postgres`). Las RPC están concedidas a `service_role`; `postgres` puede invocarlas en Stage.

**Modo:** pegar y ejecutar **el archivo completo** en una sola corrida.

---

## 4. Guards transaccionales (abortan antes de mutar)

El script aborta con `RAISE EXCEPTION 'GUARD_FAIL: …'` si:

1. No existe `fel_emission_config id=1`.
2. `environment <> 'stage'`.
3. `emission_enabled <> false` al inicio.
4. `auto_issue_paid_orders <> false`.
5. `formal_contingency_enabled <> false`.
6. No existe `cajero@stage-fel.test` activo con rol `caja`/`cajero`.
7. Hay menos de **dos** documentos candidatos en `M-FEL-PAID`, total Q297, orden `paid`, conciliación completa, `environment=stage`, estado `pending_certification|failed`, `request_payload IS NULL`, sin intentos previos, **exclusivamente** producto fixture `fef00001-…` (sin ítems adicionales no cancelados).
8. Algún candidato tiene `fel_uuid`, `sat_authorization` o `certified_at`.
9. Algún candidato FEL no pertenece a mesas fixture (`M-FEL-*`).
10. Alguna orden candidata no incluye producto ficticio `fef00001-…`.
11. Alguna orden candidata incluye **cualquier** `pos_order_items` no cancelado cuyo `product_id` sea distinto de `fef00001-…` (`IS DISTINCT FROM`).

Los documentos se seleccionan **dinámicamente** (sin IDs hardcodeados de Producción).

---

## 5. Aislamiento transaccional

Dentro de la misma transacción:

1. `UPDATE fel_emission_config SET emission_enabled = true WHERE id = 1`
2. Verificación inmediata: sigue `stage`, `formal_contingency_enabled=false`, `auto_issue_paid_orders=false`
3. Solo RPC PostgreSQL (`fel_claim_*`, `fel_finalize_*`)
4. Identificadores ficticios de éxito: `TEST-ROLLBACK-NOT-CERTIFIED` (**no** certificación real)
5. `ROLLBACK` final — revierte config, documentos, intentos y side-effects

---

## 6. Escenarios ejecutables (`executed=true`)

| Escenario | Qué valida |
|-----------|------------|
| `runtime_claim_pending_document` | `pending_certification → processing`, intento `pending`, `attempt_number=1` |
| `runtime_claim_processing_rejected` | Segundo claim → `FEL_ALREADY_PROCESSING`, sin segundo intento |
| `runtime_finalize_success` | Finalize `success` ficticio → `certified` / intento `success` |
| `runtime_certified_not_overwritable` | Segundo finalize → `FEL_ALREADY_CERTIFIED`, sin sobrescritura |
| `runtime_finalize_failure_retry` | Segundo doc: claim + finalize `failed`, `retry_count + 1`, `last_error` sanitizado |
| `runtime_reclaim_failed_document` | Re-claim doc failed → intento #2 `pending`, doc `processing` |
| `runtime_stale_attempt_rejected` | Finalize con intento #1 ya finalizado → `FEL_FINALIZE_STALE`; intento #2 sigue `pending` |
| `runtime_attempt_belongs_to_document` | Finalize doc2 con `attempt_id` de doc1 → `FEL_ATTEMPT_NOT_FOUND` |
| `runtime_order_payment_intact` | Snapshots `pos_orders` / `pos_order_payments` idénticos antes/después |

Antes del `ROLLBACK`, el script finaliza controladamente el intento pendiente #2 como `failed` (estado temporal coherente; todo se revierte).

---

## 7. Concurrencia PostgreSQL — NOT EXECUTED

El runtime **no simula** dos sesiones concurrentes.

Escenario registrado:

- `runtime_postgres_concurrency`
- `executed=false`, `passed=false`
- `detail = NOT EXECUTED: requires separate approved concurrency runbook`

### Por qué la receta de dos sesiones SQL Editor no es válida

**No ejecutar** el procedimiento previamente esbozado (dos pestañas del SQL Editor, cada una con `BEGIN` + `UPDATE fel_emission_config SET emission_enabled = true`).

Motivo técnico:

- `fel_emission_config id=1` es una fila singleton compartida.
- La primera sesión que hace `UPDATE … emission_enabled = true` dentro de una transacción abierta retiene el lock de fila.
- La segunda sesión que intenta el mismo `UPDATE` **queda bloqueada** esperando a la primera.
- Por tanto, **no** llegan concurrentemente al `fel_claim_pos_fel_certification_attempt` sobre el mismo `document_id`; la prueba no mide contención real de claim, solo bloqueo en configuración.

### Estado actual

- `runtime_postgres_concurrency` permanece **NOT EXECUTED** en el runtime transaccional.
- **No diseñar ni ejecutar** en esta corrección un runbook de concurrencia operativo.
- `emission_enabled` debe permanecer **`false` confirmado** fuera del runtime transaccional con `ROLLBACK`.

### Requisitos para una prueba real futura (solo documentación)

Una validación de concurrencia PostgreSQL real requeriría, como mínimo:

1. **Runbook separado** y **aprobación explícita** del operador Stage (distinto de este runtime).
2. Un **coordinador** que habilite temporalmente el gate de emisión de forma visible para ambas sesiones **y garantice su restauración** a `false`, **o** un diseño de pruebas dedicado (p. ej. fixture transaccional aislado, ventana coordinada, timeouts documentados) que evite el bloqueo mutuo en `fel_emission_config`.
3. Dos sesiones que invoquen claim sobre el **mismo** `document_id` **sin** quedar serializadas en el toggle de configuración.
4. Expectativa: exactamente un claim exitoso, exactamente un intento, segundo claim rechazado (`FEL_ALREADY_PROCESSING` o equivalente).
5. Limpieza verificable: ningún `COMMIT` accidental; postcondiciones iguales a la sección 8.

Hasta contar con ese diseño aprobado, la concurrencia permanece **pendiente** y **fuera de alcance** del runtime 1A.3.

---

## 8. Postcondiciones (consulta separada tras ROLLBACK)

Ejecutar **después** del runtime, en una nueva consulta de solo lectura:

```sql
select id, environment, emission_enabled, auto_issue_paid_orders, formal_contingency_enabled
from public.fel_emission_config
where id = 1;

select count(*) as fel_documents from public.pos_fel_documents;
select count(*) as fel_attempts from public.pos_fel_attempts;

select id, status, fel_uuid, sat_authorization, retry_count
from public.pos_fel_documents
order by created_at;

select count(*) filter (where fel_uuid = 'TEST-ROLLBACK-NOT-CERTIFIED') as test_uuid_rows
from public.pos_fel_documents;
```

**Esperado:**

| Check | Esperado |
|-------|----------|
| `environment` | `stage` |
| `emission_enabled` | `false` |
| `auto_issue_paid_orders` | `false` |
| `formal_contingency_enabled` | `false` |
| `pos_fel_documents` | 3 filas, estados originales (`pending_certification`, sin certificación real) |
| `pos_fel_attempts` | `0` |
| `TEST-ROLLBACK-NOT-CERTIFIED` | `0` filas persistidas |
| Órdenes / pagos fixture | Sin cambios de `status`, `total`, sumas pagadas |

---

## 9. Resultados esperados del runtime

Al final del script (antes del `ROLLBACK` implícito en la misma ejecución, las SELECT son visibles en el mismo batch):

```text
executed_passed  = 9
executed_failed  = 0
not_executed     = 1   -- runtime_postgres_concurrency
total            = 10
```

Si cualquier escenario `executed=true` muestra `passed=false`, **detener** revisión Stage y no habilitar Edge deploy.

---

## 10. Firmas RPC verificadas (auditoría previa)

```sql
fel_claim_pos_fel_certification_attempt(uuid, uuid) RETURNS jsonb

fel_finalize_pos_fel_certification_attempt(
  uuid, uuid, text, text, text, text, text,
  timestamptz, integer, text, text, jsonb, jsonb
) RETURNS jsonb

fel_order_payment_reconciliation(uuid) RETURNS jsonb
```

Privilegios: `GRANT EXECUTE` claim/finalize → `service_role` únicamente.

---

## 11. Seguridad

Prohibido en este runbook:

- Secretos, API keys, JWT reales
- HTTP / FELplex / Edge deploy
- `COMMIT` manual
- `DELETE`, `TRUNCATE`, deshabilitar triggers
- Cambios RLS permanentes
- Datos de Producción

---

## 12. Orden recomendado de validación Stage

1. Confirmar precondiciones (sección 2).
2. Ejecutar pruebas estructurales (`20260808220000_test_pos_fel_attempt_lifecycle.sql`) si no se corrieron recientemente.
3. Ejecutar runtime (`20260808220000_pos_fel_attempt_lifecycle.runtime.sql`).
4. Verificar postcondiciones (sección 8).
5. **No** ejecutar prueba de concurrencia hasta contar con runbook separado aprobado (sección 7).

---

## 13. Referencias

- Migración: `supabase/migrations/20260808220000_pos_fel_attempt_lifecycle.sql`
- Pruebas estructurales: `supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql`
- Referencia FEL base: `supabase/migrations/20260808190000_pos_fel_documents.sql`
- Fixture POS: `supabase/stage-fixtures/felplex_pos_minimal_fixture.sql`
- Edge (no desplegar en este paso): `docs/felplex-phase-1-edge-function.md`
