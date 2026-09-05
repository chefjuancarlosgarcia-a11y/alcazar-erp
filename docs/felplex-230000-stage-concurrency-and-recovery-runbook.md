# FELplex 230000 — Runbook Stage (concurrencia PostgreSQL y recuperación)

**Proyecto Stage autorizado:** `tgrqarxfmpwgrkntvgma`  
**Proyecto prohibido:** `lwpfrdnsiwtmyonwcduh` (Producción)  
**Alcance:** validación de locks reales con dos conexiones PostgreSQL independientes y procedimiento operativo de recuperación manual para documentos `processing`.  
**Coordinador:** `scripts/run-felplex-stage-concurrency-test.ps1`  
**SQL:** `supabase/stage-tests/felplex-concurrency/`

---

## 1. Propósito

Demostrar en Stage que:

1. Dos claims concurrentes sobre el mismo `document_id` producen **exactamente un** claim exitoso y **exactamente un** intento (`attempt_number=1` en fixture sin historial).
2. El segundo claim **espera** el advisory transaction lock de la sesión A y luego es **rechazado** con `FEL_ALREADY_PROCESSING`.
3. La recuperación **categoría A** (claim sin HTTP) puede finalizarse con `finalize failed` de forma controlada.
4. La recuperación **categoría B** (resultado incierto después de HTTP) **permanece bloqueada** hasta reconciliación manual con FELplex.

**No** despliega Edge. **No** llama HTTP a FELplex. **No** activa `auto_issue_paid_orders` ni `formal_contingency_enabled`. **No** deja `emission_enabled=true` al terminar.

---

## 2. Precondiciones

| Elemento | Valor esperado |
|----------|----------------|
| Migraciones | `180000`–`230000` aplicadas; `db push --dry-run` → Remote database is up to date |
| `fel_emission_config id=1` | `environment=stage`, `emission_enabled=false`, `auto_issue_paid_orders=false`, `formal_contingency_enabled=false` |
| `pos_fel_attempts` | 0 |
| `processing_documents` | 0 |
| Fixtures FEL | ≥2 candidatos M-FEL-PAID, Q297, producto `fef00001-0000-4000-8000-000000000001` |
| Edge Function | No desplegada / no operativa en Stage |
| Actor | `cajero@stage-fel.test` activo, rol caja/cajero |

---

## 3. Ejecución automatizada (recomendada)

```powershell
# Desde la raíz del repo, CLI ya autenticada y enlazada a tgrqarxfmpwgrkntvgma
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-felplex-stage-concurrency-test.ps1

# Ensayo local sin mutar Stage
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-felplex-stage-concurrency-test.ps1 -DryRun
```

### Secuencia del coordinador

| Fase | Archivo | Acción |
|------|---------|--------|
| Preflight | `preflight.sql` | Read-only; selecciona fixture dinámico |
| Enable window | `enable-window.sql` | `emission_enabled=true` (COMMIT corto) |
| Session A | `session-a.sql` | Proceso independiente: BEGIN → claim → `pg_sleep(10)` → COMMIT |
| Session B | `session-b.sql` | +2s: claim concurrente; debe rechazar tras espera |
| Verify | `verify.sql` | 1 attempt, documento `processing`, sin UUID/SAT |
| Recovery | `recovery-failed.sql` | Categoría A: finalize `failed` (`FEL_TEST_CONCURRENCY`) |
| Cleanup | `cleanup.sql` | Elimina attempt de prueba; restaura documento; `emission_enabled=false` |
| Post-preflight | `preflight.sql` | Confirma baseline |

### `finally` / emergencia

Si cualquier fase falla, el coordinador ejecuta `emergency-restore.sql` y reintenta `cleanup.sql`. Si no puede confirmar baseline → **`CRITICAL_STAGE_CLEANUP_REQUIRED`** (exit 2).

---

## 4. Criterios de aprobación

| Métrica | Esperado |
|---------|----------|
| `session_a_success` | 1 |
| `session_b_success` | 0 |
| `session_b_rejected` | 1 |
| `attempts_created` | 1 |
| `attempt_number` | 1 |
| Espera Session B | ≥1000 ms (objetivo 8–12 s con hold 10 s) |
| `recovery_without_http` | PASS |
| `cleanup` | PASS |
| Post-cierre | `emission_enabled=false`, `fel_attempts=0`, `processing_documents=0` |
| Snapshot fixture | pre = post (documento, orden, pagos) |

---

## 5. Recuperación operativa — clasificación obligatoria

### Categoría A — Resultado conocido SIN HTTP

**Cuándo aplica:**

- Claim/`processing` creado localmente.
- **No** hubo llamada HTTP a FELplex (Edge no invocada, transporte no ejecutado).
- **No** existe `fel_uuid`, autorización SAT ni `certified_at`.
- **No** hay evidencia externa de certificación.

**Acción permitida (manual, autorizada):**

1. Localizar attempt pendiente del documento.
2. Invocar `fel_finalize_pos_fel_certification_attempt` con `outcome=failed`, código seguro documentado (ej. prueba: `FEL_TEST_CONCURRENCY`).
3. Verificar documento → `failed`, `retry_count` coherente, sin UUID/SAT.
4. Registrar evidencia (timestamp, actor, attempt_id, motivo).

**Ejemplo de esta validación Stage:** claim concurrente demostrado; finalize failed con payload seguro `{"http_status":499,"error_kind":"transport","safe_code":"CONCURRENCY"}`; cleanup restauró fixture.

### Categoría B — Resultado incierto DESPUÉS de HTTP

**Cuándo aplica:**

- Timeout o respuesta perdida hacia FELplex.
- Proveedor pudo haber certificado.
- Finalize local falló **después** de respuesta FELplex.
- Cualquier duda sobre envío externo.

**Prohibido:**

- Reintento automático.
- Reset ciego a `pending`/`failed`.
- Cron de recuperación por antigüedad.
- Liberar documento sin consultar FELplex por `external_id`.

**Acción requerida:**

1. **Bloquear** el documento en `processing`.
2. Revisar evidencia: `external_id`, attempt, request/response segura, logs Edge (si existieran).
3. **Consultar FELplex** por `external_id` / correlación.
4. Documentar resultado de la consulta.
5. Solo entonces decidir finalize success/failed o escalamiento manual.
6. Autorización: operador senior + responsable FELplex; dejar registro en evidencia oficial.

### Escalamiento — FELplex certificó pero DB no finalizó

1. No sobrescribir UUID/SAT locales sin reconciliación.
2. Capturar UUID y autorización SAT desde FELplex.
3. Evaluar finalize success manual con datos del proveedor **solo** tras confirmación escrita.
4. Escalar a ingeniería DB si hay inconsistencia persistente.

---

## 6. Cómo identificar documentos `processing`

```sql
select d.id, d.order_id, d.status, d.retry_count, d.last_error,
       d.fel_uuid, d.sat_authorization, d.certified_at, d.updated_at
from public.pos_fel_documents d
where d.status = 'processing'
  and d.environment = 'stage';
```

```sql
select a.id, a.fel_document_id, a.attempt_number, a.outcome,
       a.error_code, a.started_at, a.finished_at, a.http_status
from public.pos_fel_attempts a
where a.fel_document_id = '<document_id>'
order by a.attempt_number;
```

---

## 7. Evidencia a registrar en cada recuperación

| Campo | Obligatorio |
|-------|-------------|
| Fecha/hora (America/Guatemala) | Sí |
| Project ref | Sí |
| `document_id` / `order_id` | Sí |
| `attempt_id` / `attempt_number` | Sí |
| Categoría A o B | Sí |
| ¿HTTP enviado? | Sí (con evidencia) |
| Acción tomada | Sí |
| Autorizador | Sí (recuperación manual) |
| Estado post-acción | Sí |
| Consulta FELplex (cat. B) | Sí, si aplica |

---

## 8. Limitaciones explícitas

- Esta prueba **no** demuestra exactly-once frente a FELplex HTTP.
- **No** sustituye validación de contrato externo ni deploy Edge.
- **No** autoriza Producción.
- Recovery categoría B permanece **manual y pendiente de consulta externa**.

---

## 9. Referencias

- Evidencia oficial: `docs/evidence/felplex/2026-08-10-phase-1a3-stage-validation.md`
- Runtime transaccional ROLLBACK: `docs/felplex-20260808220000-stage-runtime-runbook.md`
- RPCs: `fel_claim_pos_fel_certification_attempt`, `fel_finalize_pos_fel_certification_attempt`

---

*Runbook FELplex 230000 — concurrencia Stage — 2026-08-13*
