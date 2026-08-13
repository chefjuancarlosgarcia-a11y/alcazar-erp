# Evidencia histórica reportada — FELplex Fase 1A.3 en Supabase Stage

| Campo | Valor |
|-------|-------|
| **Entorno validado** | Supabase Stage |
| **Project ref** | `tgrqarxfmpwgrkntvgma` |
| **Fase** | FELplex 1A.3 — claim/finalize transaccional |
| **Fecha de cierre** | 2026-08-10 |
| **Zona horaria documental** | America/Guatemala |
| **Ejecución** | Manual — Supabase Stage SQL Editor (rol privilegiado) |
| **Producción** | No involucrada |
| **Documento generado** | Evidencia local de cierre (repositorio) |

---

## 2. Resumen ejecutivo

Según los resultados ejecutados y reportados por el operador, FELplex Fase 1A.3 fue validada en Supabase Stage mediante:

1. **Pruebas estructurales** (`20260808220000_test_pos_fel_attempt_lifecycle.sql`) — 25 escenarios `executed=true`, todos `passed=true`; 9 escenarios conceptuales honestamente `NOT EXECUTED`.
2. **Runtime transaccional** (`20260808220000_pos_fel_attempt_lifecycle.runtime.sql`) — 9 escenarios operativos `executed=true`, todos `passed=true`; 1 escenario de concurrencia deliberadamente no ejecutado.
3. **Post-ROLLBACK** — configuración FEL y datos fixture restaurados; cero intentos persistidos; cero filas con identificadores ficticios de certificación.

**Veredicto histórico reportado por el operador:** **PASS — FELplex Fase 1A.3 validada en Supabase Stage para flujo transaccional secuencial claim/finalize, con rollback limpio.**

**CONCURRENCIA POSTGRESQL REAL: NOT EXECUTED / PENDIENTE.**

**Este cierre no autoriza deploy de Edge Function, habilitación permanente de `emission_enabled`, llamada HTTP a FELplex ni uso en Producción.**

Este registro no valida la migración posterior `20260808230000_pos_fel_premerge_hardening.sql`. Esa corrección permanece pendiente de aplicación y pruebas en Stage.

---

## 3. Alcance de la validación

### Incluido

- Migración `20260808220000_pos_fel_attempt_lifecycle.sql` aplicada en Stage (confirmado por operador: `db push --dry-run` = up to date).
- RPCs PostgreSQL:
  - `fel_claim_pos_fel_certification_attempt(uuid, uuid)`
  - `fel_finalize_pos_fel_certification_attempt(...)`
  - Helpers: `fel_actor_can_request_certification`, `fel_validate_safe_response_payload`, `fel_order_payment_reconciliation`
- Gates DB en claim (`fel_emission_config id=1`, stage, `emission_enabled`, contingencia).
- Validación de safe response payload en finalize.
- Flujo secuencial claim → finalize (éxito, fallo, stale, cross-document, idempotencia de processing).
- Integridad de órdenes y pagos fixture durante RPCs FEL.
- Reversión completa vía `ROLLBACK` del runtime transaccional.

### Excluido

- HTTP / FELplex / Edge Function deploy
- Certificación SAT real
- Producción
- Concurrencia PostgreSQL con dos sesiones
- Confirmación del contrato externo del payload FELplex (sigue bloqueado)
- Habilitación permanente de emisión FEL

---

## 4. Artefactos revisados

| Artefacto | Rol |
|-----------|-----|
| `supabase/migrations/20260808190000_pos_fel_documents.sql` | Referencia base FEL (documentos, intentos, config) |
| `supabase/migrations/20260808220000_pos_fel_attempt_lifecycle.sql` | Migración 1A.3 (claim/finalize + helpers) |
| `supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql` | Pruebas estructurales Stage |
| `supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql` | Runtime transaccional con ROLLBACK |
| `docs/felplex-20260808220000-stage-runtime-runbook.md` | Runbook operativo Stage |

---

## 5. Preconditions de Stage

Resultado reportado por el operador y revisado contra los criterios del runbook.

| Precondición | Estado |
|--------------|--------|
| Project ref `tgrqarxfmpwgrkntvgma` | Confirmado |
| Migración 20260808220000 aplicada | Confirmado |
| `fel_emission_config id=1`: `environment=stage` | Confirmado |
| `emission_enabled=false` (baseline pre-runtime) | Confirmado |
| `auto_issue_paid_orders=false` | Confirmado |
| `formal_contingency_enabled=false` | Confirmado |
| `pos_fel_documents` = 3 (fixture Q297 ficticio) | Confirmado |
| `pos_fel_attempts` = 0 (pre-runtime) | Confirmado |
| Usuarios fixture (`cajero@stage-fel.test`, etc.) | Confirmado |
| Fixture POS (`M-FEL-PAID`, producto `fef00001-…`) | Confirmado |

---

## 6. Evidencia estructural

Resultado reportado por el operador y revisado contra los criterios del runbook.

### Resumen numérico

| Métrica | Valor |
|---------|-------|
| `executed=true`, `passed=true` | **25** |
| `executed=true`, `passed=false` | **0** |
| `executed=false` (conceptuales) | **9** |
| Total escenarios estructurales | **34** |

### Controles confirmados (todos passed)

- Firmas de claim, finalize, actor helper y safe payload validator
- `EXECUTE` de claim/finalize **solo** para `service_role`
- Sin `EXECUTE` para `anon` / `authenticated` en claim/finalize
- Helper actor no ejecutable por PUBLIC (ACL `grantee=0`), `anon` ni `authenticated`
- `SECURITY DEFINER` confirmado vía `pg_proc.prosecdef`
- `search_path` vacío confirmado vía `proconfig @> array['search_path=""']`
- Gate `fel_emission_config` presente en claim (post-lock, pre-insert)
- Finalize invoca `fel_validate_safe_response_payload`
- Safe payload: `http_status` null o entero 100–599; rechazo de claves prohibidas/desconocidas; límites `safe_code` ≤ 64, `safe_message` ≤ 240

Los 9 escenarios conceptuales permanecen `executed=false` con detail `NOT EXECUTED` (sin afirmar comportamiento no probado en DB).

---

## 7. Evidencia runtime

Resultado reportado por el operador y revisado contra los criterios del runbook.

### Resumen numérico

```json
{
  "executed_passed": 9,
  "executed_failed": 0,
  "not_executed": 1,
  "total": 10
}
```

### Escenarios ejecutados y aprobados (`executed=true`, `passed=true`)

| # | Escenario | Validación |
|---|-----------|------------|
| 1 | `runtime_claim_pending_document` | `pending_certification → processing`, intento #1 `pending` |
| 2 | `runtime_claim_processing_rejected` | Segundo claim → `FEL_ALREADY_PROCESSING`, sin segundo intento |
| 3 | `runtime_finalize_success` | Finalize ficticio `TEST-ROLLBACK-NOT-CERTIFIED` → `certified` / intento `success` |
| 4 | `runtime_certified_not_overwritable` | Segundo finalize → `FEL_ALREADY_CERTIFIED`, sin sobrescritura |
| 5 | `runtime_finalize_failure_retry` | Doc2 failed, `retry_count + 1`, `last_error` sanitizado |
| 6 | `runtime_reclaim_failed_document` | Re-claim → intento #2 `pending`, doc `processing` |
| 7 | `runtime_stale_attempt_rejected` | Finalize intento #1 stale → `FEL_FINALIZE_STALE`; intento #2 sigue `pending` |
| 8 | `runtime_attempt_belongs_to_document` | Cross `attempt_id` → `FEL_ATTEMPT_NOT_FOUND`, sin mutación |
| 9 | `runtime_order_payment_intact` | Snapshots `pos_orders` / `pos_order_payments` idénticos antes/después |

### Escenario no ejecutado (deliberado)

| Escenario | Estado | Razón |
|-----------|--------|-------|
| `runtime_postgres_concurrency` | **PENDIENTE / NOT EXECUTED** | Requiere runbook separado, coordinación de dos sesiones y aprobación explícita. **No** se presenta como aprobado ni fallido. |

---

## 8. Evidencia post-ROLLBACK

Resultado reportado por el operador y revisado contra los criterios del runbook.

```json
{
  "environment": "stage",
  "emission_enabled": false,
  "auto_issue_paid_orders": false,
  "formal_contingency_enabled": false,
  "fel_documents": 3,
  "fel_attempts": 0,
  "test_certification_rows": 0
}
```

### Interpretación obligatoria

- El runtime fue **completamente revertido** mediante `ROLLBACK`.
- **No** quedaron intentos FEL persistidos (`fel_attempts = 0`).
- **No** quedaron UUID ni autorizaciones ficticias (`test_certification_rows = 0`).
- Los **tres** documentos FEL originales permanecieron.
- `emission_enabled` regresó a **`false`**.
- Órdenes y pagos permanecieron intactos (corroborado por `runtime_order_payment_intact`).
- **No** hubo HTTP, `pg_net`, llamada a FELplex ni certificación SAT real.
- **No** se desplegó la Edge Function.
- **No** se habilitó emisión automática.

---

## 9. Controles de seguridad confirmados

| Control | Estado |
|---------|--------|
| Sin secretos en scripts de prueba / runtime | Confirmado (revisión local) |
| Claim/finalize `service_role` only | Confirmado (estructural) |
| Actor helper no expuesto a roles frontend | Confirmado (estructural) |
| Safe payload allowlist en finalize | Confirmado (estructural + runtime) |
| Toggle `emission_enabled=true` solo intra-transacción | Confirmado (runtime + post-ROLLBACK) |
| Identificadores `TEST-ROLLBACK-NOT-CERTIFIED` no persistidos | Confirmado (post-ROLLBACK) |
| Sin DELETE / TRUNCATE / SET ROLE en runtime | Confirmado (revisión local del script) |
| Producción no involucrada | Confirmado |

---

## 10. Elementos expresamente no ejecutados

| Elemento | Estado |
|----------|--------|
| Concurrencia PostgreSQL real (dos sesiones) | **NOT EXECUTED / PENDIENTE** |
| Deploy Edge Function `felplex-certify-invoice` | No ejecutado |
| HTTP a FELplex | No ejecutado |
| `FELPLEX_HTTP_ENABLED` | No habilitado |
| Certificación SAT real | No ejecutada |
| Producción | No involucrada |
| Confirmación contrato payload FELplex | Sigue bloqueado (`FELPLEX_CONTRACT_UNCONFIRMED`) |
| Habilitación permanente `emission_enabled` | No autorizada |

---

## 11. Riesgos y pendientes

| ID | Pendiente | Severidad | Notas |
|----|-----------|-----------|-------|
| P1 | Concurrencia PostgreSQL real | Media | Runbook separado requerido; receta de dos SQL Editors inválida por bloqueo en `fel_emission_config` |
| P2 | Contrato payload FELplex | Alta | Builder Edge sigue bloqueado hasta confirmación externa |
| P3 | Edge Function deploy | Media | Requiere fase posterior con gates HTTP + secretos Stage |
| P4 | Primera llamada FELplex real | Alta | Fuera de alcance 1A.3 |
| P5 | Producción | Alta | Explícitamente no autorizada por este cierre |
| P6 | Aplicación y tests de 230000 en Stage | Alta | **NOT EXECUTED**; no reutilizar los conteos históricos |
| P7 | Recovery de documentos `processing` | Alta | Fail-closed; reconciliación manual hasta definir política |

---

## 12. Veredicto histórico y estado actual

**PASS histórico reportado por el operador — 25/25 estructurales y 9/9 runtime ejecutados para 20260808220000.**

**CONCURRENCIA POSTGRESQL REAL: NOT EXECUTED / PENDIENTE.**

**Este cierre no autoriza deploy de Edge Function, habilitación permanente de `emission_enabled`, llamada HTTP a FELplex ni uso en Producción.**

**20260808230000: NOT EXECUTED / PENDIENTE DE APLICACIÓN Y VALIDACIÓN STAGE. No existe cierre definitivo de 230000.**

---

## 13. Criterios para avanzar a la siguiente fase

Antes de considerar Edge deploy o primera integración HTTP controlada:

1. Aprobar y ejecutar (si procede) runbook de concurrencia PostgreSQL con diseño que evite bloqueo mutuo en `fel_emission_config`.
2. Confirmar o mantener bloqueo del contrato payload FELplex según decisión de producto/arquitectura.
3. Desplegar Edge Function solo en Stage con `FELPLEX_HTTP_ENABLED` explícitamente off hasta runbook HTTP dedicado.
4. Mantener `emission_enabled=false` confirmado fuera de transacciones de prueba hasta runbook de emisión controlada.
5. Repetir postcondiciones post-rollback tras cualquier prueba adicional.
6. **No** promover a Producción sin hito de aprobación independiente.

---

## 14. Trazabilidad e integridad

Hashes calculados **localmente** sobre copias en repositorio (sin alterar archivos). La evidencia de ejecución remota se etiqueta como reportada por el operador.

| Artefacto | Bytes | SHA-256 |
|-----------|------:|---------|
| `supabase/migrations/20260808220000_pos_fel_attempt_lifecycle.sql` | 16 405 | `9BD5C4666EB7A4893E34DB23CEBDA328AD9BE1CAAFFD3BF7A45A6B1E67161C5A` |
| `supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql` | 12 743 | `823190BADE58AF2A12B6BEE7FCCBF45CAE5339D15C0C0FC252F7C32AF55CB259` |
| `supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql` | 23 620 | `8EF1C2178327E8D1041FCFB90554110C6A197AFE9D142894BDA5A30A478EA759` |
| `docs/felplex-20260808220000-stage-runtime-runbook.md` | 11 522 | `43627438C7CC3162CB37ECE2C00E9C63818BB828BE7A49EC11420B6F814D9867` |

### Referencia base (no re-hasheada en esta entrega)

- `supabase/migrations/20260808190000_pos_fel_documents.sql` — migración FEL Phase 0 (prerequisito)

### Limitaciones de trazabilidad

- Cursor **no** verificó directamente la base remota Stage.
- Resultados numéricos de ejecución: **resultado reportado por el operador y revisado contra los criterios del runbook.**
- Este documento es evidencia documental local; no sustituye logs exportados del SQL Editor si se requieren en auditoría externa.

## 15. Corrección pre-merge local posterior

La corrección local de 2026-08-11 se limita a:

- revisión estática y validador local de artefactos;
- tests y type-check Deno locales;
- guard del baseline, seed no destructivo y validación canónica del trigger;
- migración/rollback/tests `20260808230000`;
- normalización Edge de `administrador` a `admin`;
- CI sin secretos, SQL remoto ni deploy.

Corrección adicional local (commit 6, sin push):

- guard `230000` exige `emission_enabled=false` en la fila viva antes de mutar;
- workflow FELplex CI se dispara también ante cambios aislados en `.gitattributes`.

Corrección adicional local (commit 7, sin push):

- `230000`: `GRANT EXECUTE` explícito de `fel_order_payment_reconciliation(uuid)` solo a `service_role`;
- `230000`: bloqueo `FOR UPDATE` de `pos_orders` en finalize success antes de reconciliar pagos;
- `230000`: validación recursiva de alias secretos en `request_payload` vía `fel_payload_key_is_forbidden`;
- `180000` guard: detección de tipos compuestos (`relkind='c'`) sin alterar el sufijo aprobado;
- validador local ampliado con auto-pruebas negativas; tests estructurales 230000 ampliados.

Serialización finalize vs pagos POS: demostrada estáticamente porque `create_pos_split_payment` es el único escritor SQL de `pos_order_payments` y bloquea `pos_orders` con `FOR UPDATE` al inicio de la transacción.

Clasificación de evidencia:

| Fuente | Estado |
|--------|--------|
| Stage 25/25 y 9/9 de 220000 | Histórico, reportado por operador |
| Tests Deno de la corrección | Local |
| Revisión de SQL/CI/secretos | Estática local |
| SQL y tests 230000 | **NOT EXECUTED** |
| Concurrencia PostgreSQL real | **NOT EXECUTED** |
| Recovery de `processing` | Pendiente; reconciliación manual |

### Huellas locales de artefactos modificados por la corrección

Estas huellas prueban únicamente contenido local; no prueban aplicación en Stage.

| Artefacto | Bytes | SHA-256 |
|-----------|------:|---------|
| `.gitattributes` | 103 | `F73746903F637183E39AD57E88744067B97545DDB994F15F399E982C453877E0` |
| `supabase/migrations/20260808180000_erp_schema_baseline.sql` | 2 143 116 | `1FFBB4C022025C617C5FF92D1856E8B11343CDC88E7C5C16B654EEE504E99C55` |
| `supabase/migrations/20260808230000_pos_fel_premerge_hardening.sql` | 21 413 | `E15B68DB0CB710F36A880269636F5B5ADB5BEAD4C91F22B86587A8E20B4E54F5` |
| `supabase/rollback/20260808230000_pos_fel_premerge_hardening.rollback.sql` | 2 384 | `586D6CEB5168D7A37F05002423980858C2883ED5137CAF5313CF8079BC3E6CB0` |
| `supabase/schema/20260808230000_test_pos_fel_premerge_hardening.sql` | 16 564 | `F512BB284D7F0846A747794BABCBAADE683A28992E972332630E11091DA833BF` |
| `scripts/validate-felplex-migration-safety.mjs` | 17 907 | `153CA5C50FDA2D80B7E9EDCE4C7599A959D3E8FF0A0D504303B3AB543465DD42` |
| `docs/felplex-baseline-adoption-runbook.md` | 2 336 | `896245E89966A93E42BDF7DEE703B61DDB6FE6929E67E1F1D21D0EB117B32373` |

La fuente binaria autorizada y el sufijo posterior al guard miden exactamente 2 141 307 bytes, comparten SHA-256 `F0A9AA71F46D78084D40DBDF5454ABB5BB55F809F4AA3D145B36E090C1FAAD35` y son byte-idénticos. El baseline protegido completo contiene 1 809 bytes de guard (incluye `relkind='c'`) más el snapshot aprobado.

---

*Fin del registro de cierre — FELplex Fase 1A.3 — Supabase Stage — 2026-08-10 (America/Guatemala)*
