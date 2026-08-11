# Cierre oficial — FELplex Fase 1A.3 en Supabase Stage

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

FELplex Fase 1A.3 fue validada en Supabase Stage mediante:

1. **Pruebas estructurales** (`20260808220000_test_pos_fel_attempt_lifecycle.sql`) — 25 escenarios `executed=true`, todos `passed=true`; 9 escenarios conceptuales honestamente `NOT EXECUTED`.
2. **Runtime transaccional** (`20260808220000_pos_fel_attempt_lifecycle.runtime.sql`) — 9 escenarios operativos `executed=true`, todos `passed=true`; 1 escenario de concurrencia deliberadamente no ejecutado.
3. **Post-ROLLBACK** — configuración FEL y datos fixture restaurados; cero intentos persistidos; cero filas con identificadores ficticios de certificación.

**Veredicto:** **PASS — FELplex Fase 1A.3 validada en Supabase Stage para flujo transaccional secuencial claim/finalize, con rollback limpio.**

**CONCURRENCIA POSTGRESQL REAL: NOT EXECUTED / PENDIENTE.**

**Este cierre no autoriza deploy de Edge Function, habilitación permanente de `emission_enabled`, llamada HTTP a FELplex ni uso en Producción.**

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

---

## 12. Veredicto

**PASS — FELplex Fase 1A.3 validada en Supabase Stage para flujo transaccional secuencial claim/finalize, con rollback limpio.**

**CONCURRENCIA POSTGRESQL REAL: NOT EXECUTED / PENDIENTE.**

**Este cierre no autoriza deploy de Edge Function, habilitación permanente de `emission_enabled`, llamada HTTP a FELplex ni uso en Producción.**

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
| `docs/felplex-20260808220000-stage-runtime-runbook.md` | 10 761 | `4B388B277C23F3E3AE3F364D00B1CB67D9D2584DB48F88DBFE513FE6FAF6CBA5` |

### Referencia base (no re-hasheada en esta entrega)

- `supabase/migrations/20260808190000_pos_fel_documents.sql` — migración FEL Phase 0 (prerequisito)

### Limitaciones de trazabilidad

- Cursor **no** verificó directamente la base remota Stage.
- Resultados numéricos de ejecución: **resultado reportado por el operador y revisado contra los criterios del runbook.**
- Este documento es evidencia documental local; no sustituye logs exportados del SQL Editor si se requieren en auditoría externa.

---

*Fin del registro de cierre — FELplex Fase 1A.3 — Supabase Stage — 2026-08-10 (America/Guatemala)*
