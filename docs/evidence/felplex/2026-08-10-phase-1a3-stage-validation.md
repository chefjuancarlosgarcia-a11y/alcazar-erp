# Evidencia oficial — FELplex Fase 1A.3 en Supabase Stage

| Campo | Valor |
|-------|-------|
| **Entorno validado** | Supabase Stage |
| **Project ref** | `tgrqarxfmpwgrkntvgma` |
| **Nombre proyecto** | chefjuancarlosgarcia-a11y's el-gran-alcazar-stage |
| **Fase** | FELplex 1A.3 — claim/finalize transaccional + pre-merge hardening |
| **Fecha cierre histórico 220000** | 2026-08-10 |
| **Fecha actualización 230000** | 2026-08-13 |
| **Fecha runtime post-230000** | 2026-08-13 14:56 (America/Guatemala) |
| **Zona horaria documental** | America/Guatemala |
| **Rama documentada** | `integrate/felplex-phase-1a3` @ `d0131954e94227d1018f4338bbb8a5ec8c906edc` |
| **PR** | #21 — OPEN, Draft (no Ready, no merge) |
| **Producción** | No involucrada |
| **Documento** | Evidencia local de validación estructural 230000 y runtime post-230000 |

---

## 1. Veredicto actualizado

### Histórico 220000 (2026-08-10)

**PASS histórico reportado por el operador** — 25/25 estructurales y 9/9 runtime ejecutados para `20260808220000`. Concurrencia PostgreSQL real: **NOT EXECUTED / PENDIENTE**.

### Migración 230000 (2026-08-13)

**PASS ESTRUCTURAL STAGE PARA MIGRACIÓN 230000**

Resultado final del test estructural `20260808230000_test_pos_fel_premerge_hardening.sql` en Stage (reportado por el operador, no re-ejecutado en esta entrega documental):

| Métrica | Valor |
|---------|-------|
| `executed_passed` | **36** |
| `executed_failed` | **0** |
| `not_executed` | **6** |
| **Total** | **42** |

**Limitaciones explícitas de este veredicto:**

- **No** autoriza deploy de Edge Function.
- **No** autoriza FELplex HTTP.
- **No** autoriza activar `emission_enabled` ni `auto_issue_paid_orders`.
- **No** autoriza Producción.
- Concurrencia PostgreSQL real con dos sesiones **continúa pendiente**.

### Runtime post-230000 (2026-08-13)

**PASS RUNTIME TRANSACCIONAL POST-230000 EN STAGE**

Ejecución única de `supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql` en project ref `tgrqarxfmpwgrkntvgma` vía `npx supabase db query --linked` (exit code 0). Transacción `BEGIN` … `ROLLBACK`; sin `COMMIT`.

| Métrica | Valor |
|---------|-------|
| `executed_passed` | **9** |
| `executed_failed` | **0** |
| `not_executed` | **1** |
| **Total** | **10** |

El escenario `runtime_finalize_success` satisface en Stage la validación runtime pendiente del concepto estructural `concept_finalize_success_with_fixture` (finalize success con fixtures FEL aprobados, identificadores ficticios `TEST-ROLLBACK-NOT-CERTIFIED`, revertidos por ROLLBACK).

**Limitaciones explícitas de este veredicto runtime:**

- **No** autoriza deploy de Edge Function.
- **No** autoriza FELplex HTTP.
- **No** autoriza activar `emission_enabled` ni `auto_issue_paid_orders` de forma persistente.
- **No** autoriza Producción.
- Concurrencia PostgreSQL real (`runtime_postgres_concurrency`) **continúa NOT EXECUTED**.

---

## 2. Alcance

### Incluido — histórico 220000

- Migración `20260808220000_pos_fel_attempt_lifecycle.sql` aplicada en Stage.
- RPCs claim/finalize, helpers actor y safe payload.
- Pruebas estructurales 25/25 y runtime 9/9 (reportado por operador).
- Post-ROLLBACK runtime limpio.

### Incluido — 230000 (2026-08-13)

- Migración `20260808230000_pos_fel_premerge_hardening.sql` aplicada **una sola vez** en Stage vía `npx supabase db push` (exit code 0).
- Validación estructural final 36/0/6/42 en Stage.
- Correcciones del archivo de prueba (PG17, PUBLIC `grantee=0`, cobertura tres helpers).
- ACL observado read-only post-validación.
- Stage intacto; switches apagados confirmados.
- Runtime transaccional post-230000 re-ejecutado: **9/0/1/10** con ROLLBACK limpio.

### Excluido (ambas fases)

- HTTP / FELplex / Edge Function deploy
- Certificación SAT real
- Producción
- Concurrencia PostgreSQL con dos sesiones
- Confirmación del contrato externo del payload FELplex (sigue bloqueado)
- Habilitación permanente de emisión FEL

---

## 3. Migraciones aplicadas en Stage

| Timestamp | Archivo | Estado remoto Stage |
|-----------|---------|---------------------|
| `20260808180000` | `erp_schema_baseline.sql` | Aplicada (local/remoto coincidente) |
| `20260808190000` | `pos_fel_documents.sql` | Aplicada |
| `20260808200000` | *(FELplex phase artifacts)* | Aplicada |
| `20260808210000` | *(FELplex phase artifacts)* | Aplicada |
| `20260808220000` | `pos_fel_attempt_lifecycle.sql` | Aplicada |
| `20260808230000` | `pos_fel_premerge_hardening.sql` | **Aplicada 2026-08-13** |

**230000 — detalle de aplicación (reportado por operador):**

- Comando: `npx supabase db push`
- Exit code: **0**
- Historial posterior: `20260808230000` presente local y remoto.
- Dry-run posterior: **Remote database is up to date**
- **No** se reaplicaron `180000`–`220000`.
- **No** se ejecutó rollback productivo `20260808230000`.

---

## 4. Preflight Stage antes de aplicar 230000

Documentado por el operador antes de `db push`:

| Precondición | Valor |
|--------------|-------|
| `config_rows` | 1 |
| `environment` | stage |
| `emission_enabled` | false |
| `auto_issue_paid_orders` | false |
| `formal_contingency_enabled` | false |
| `fel_documents` | 3 |
| `fel_attempts` | 0 |
| `processing_documents` | 0 |
| `non_stage_documents` | 0 |
| `claim_rpc_exists` | true |
| `finalize_rpc_exists` | true |
| `reconciliation_rpc_exists` | true |

Enlace local autorizado: project ref `tgrqarxfmpwgrkntvgma`. Producción no involucrada.

---

## 5. Cronología de validación estructural 230000

### Intento 1 — fallo PG17

- Ejecución del test completo en Stage vía CLI enlazada.
- **PostgreSQL ERROR 42601:** *a column definition list is redundant for a function with OUT parameters*
- Escenario donde se manifestó: `payload_helpers_revoked_from_clients`
- Causa: listas manuales redundantes en `pg_catalog.aclexplode(...) AS a(tipos...)`.
- La transacción revirtió; **no** hubo tabla completa de resultados.
- Stage operativo intacto (configuración y conteos sin cambio).

### Corrección 1 — compatibilidad PostgreSQL 17

- Commit: `fd791c636356fd44f8e1b1cfb21372bec35593fc`
- Mensaje: `fix(felplex): make ACL structural tests PostgreSQL 17 compatible`
- Cambio: alias simple `AS a`; columnas nativas `grantee`, `privilege_type`; eliminación de `priv_type` / `priv`.

### Hallazgo 2 — falso PASS de PUBLIC

- Comprobar PUBLIC mediante `JOIN pg_roles … rolname = 'public'` **no** es equivalente al pseudo-rol PUBLIC (`grantee = 0`).
- Prueba negativa reportada: fila simulada `grantee=0` + EXECUTE — lógica corregida detecta; lógica legacy con `pg_roles` omite.

### Corrección 2 — PUBLIC vía grantee = 0

- Commit: `d329b81b30ea33873ac25567ecf5a6a8761d0334`
- Mensaje: `fix(felplex): validate PUBLIC ACL via pseudo-role grantee`
- Cambio: PUBLIC identificado exclusivamente con `a.grantee = 0`.

### Hallazgo 3 — cobertura ACL incompleta de helpers

- `payload_helpers_revoked_from_clients` solo inspeccionaba `fel_payload_key_is_forbidden(text)`.
- Faltaban `fel_validate_request_payload_node(jsonb)` y `fel_validate_request_payload(jsonb)`.

### Corrección 3 — tres helpers

- Commit: `e9d639a5eec471be4090e185089a1713032e158f`
- Mensaje: `fix(felplex): cover ACLs for all payload helpers`
- Cambio: `p.oid IN (...)` con las tres firmas regprocedure.

### Resultado final válido (Stage, reportado por operador)

| Métrica | Valor |
|---------|-------|
| `executed_passed` | 36 |
| `executed_failed` | 0 |
| `not_executed` | 6 |
| **Total** | 42 |

Commits de corrección publicados en `origin/integrate/felplex-phase-1a3` (push normal, sin force). Commit de contenido operativo previo: `1a049938b496111e7988516a8dd01023e5fa6fa2` (*resolve pre-merge operational gaps*).

---

## 6. Resultado estructural final — escenarios NOT EXECUTED

Los seis escenarios con `executed=false` **no** se presentan como PASS:

| # | Escenario | Razón |
|---|-----------|-------|
| 1 | `source_baseline_guard_before_first_ddl` | Delegado a validador local |
| 2 | `source_role_seed_do_nothing_no_do_update` | Delegado a validador local |
| 3 | `source_trigger_migration_checks_enabled_when_args` | Delegado a validador local |
| 4 | `source_rollback_correspondence` | Delegado a validador local |
| 5 | `concept_finalize_success_with_fixture` | Permanece `executed=false` en test estructural; **cubierto por runtime** `runtime_finalize_success` post-230000 (§9) |
| 6 | `concept_postgresql_concurrency` | Requiere runbook two-session; pendiente |

---

## 7. ACL final observado en Stage (read-only)

Reportado por operador mediante catálogos y `aclexplode`:

### Helpers de payload

| Función | EXECUTE concedido a |
|---------|---------------------|
| `fel_payload_key_is_forbidden(text)` | postgres únicamente |
| `fel_validate_request_payload_node(jsonb)` | postgres únicamente |
| `fel_validate_request_payload(jsonb)` | postgres únicamente |

Sin EXECUTE para PUBLIC (`grantee=0`), anon, authenticated ni service_role.

### Reconciliación

| Función | EXECUTE concedido a |
|---------|---------------------|
| `fel_order_payment_reconciliation(uuid)` | postgres, service_role |

Sin EXECUTE para PUBLIC, anon ni authenticated. PUBLIC inspeccionado en test mediante `grantee = 0`.

---

## 8. Estado post-ROLLBACK final (230000)

Después de la última ejecución estructural válida (reportado por operador):

| Campo | Valor |
|-------|-------|
| `environment` | stage |
| `emission_enabled` | false |
| `auto_issue_paid_orders` | false |
| `formal_contingency_enabled` | false |
| `fel_documents` | 3 |
| `fel_attempts` | 0 |
| `processing_documents` | 0 |
| Función temporal `test_pos_fel_premerge_hardening_20260808230000()` | **Ausente** |
| `db push --dry-run` | Remote database is up to date |

---

## 9. Runtime transaccional post-230000 en Stage

### Preflight read-only (2026-08-13 14:56 America/Guatemala)

| Precondición | Valor |
|--------------|-------|
| Project ref | `tgrqarxfmpwgrkntvgma` |
| `config_rows` | 1 |
| `environment` | stage |
| `emission_enabled` | false |
| `auto_issue_paid_orders` | false |
| `formal_contingency_enabled` | false |
| `fel_documents` | 3 |
| `fel_attempts` | 0 |
| `processing_documents` | 0 |
| `non_stage_documents` | 0 |
| Candidatos fixture válidos (`M-FEL-PAID`, Q297, pagado, producto `fef00001…`) | **3** (≥2 requeridos) |
| Intentos previos en candidatos | 0 |
| `db push --dry-run` | Remote database is up to date |

Candidatos fixture seleccionables (sin FEL UUID / SAT / `certified_at`; `request_payload` nulo):

| Documento | Orden | Mesa | Estado doc | `retry_count` |
|-----------|-------|------|------------|--------------:|
| `711fccf2-2152-4d46-a15b-930498fcc7ac` | `7d41dee2-6978-4e01-a078-baf82099bbce` | M-FEL-PAID | pending_certification | 0 |
| `798ae286-b17a-4312-95d6-d10034a26503` | `ed1bd4b6-358e-471e-8162-82bb3e5cab10` | M-FEL-PAID | pending_certification | 0 |
| `b737dd69-3d64-495b-8d5c-bb18914ca51c` | `8658cfcb-812d-4f83-b242-6cdd7214342d` | M-FEL-PAID | pending_certification | 0 |

### Ejecución

- Comando: `npx supabase db query --linked --project-ref tgrqarxfmpwgrkntvgma -f supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql`
- Exit code: **0**
- Una sola ejecución; `BEGIN` … `ROLLBACK`; toggle temporal `emission_enabled=true` revertido.
- Artefacto runtime @ HEAD blob: 22 844 bytes (`9F16453C…BF437`); invoca RPCs desplegadas post-230000.

### Resultado por escenario

| # | Escenario | `executed` | `passed` | Notas |
|---|-----------|:----------:|:--------:|-------|
| 1 | `runtime_claim_pending_document` | true | true | Claim documento pendiente |
| 2 | `runtime_claim_processing_rejected` | true | true | Segundo claim rechazado (`FEL_ALREADY_PROCESSING`) |
| 3 | `runtime_finalize_success` | true | true | Finalize success; cubre `concept_finalize_success_with_fixture` |
| 4 | `runtime_certified_not_overwritable` | true | true | Certificado no sobrescribible |
| 5 | `runtime_finalize_failure_retry` | true | true | Fallo + `retry_count` |
| 6 | `runtime_reclaim_failed_document` | true | true | Reclaim documento failed |
| 7 | `runtime_stale_attempt_rejected` | true | true | Stale attempt rechazado |
| 8 | `runtime_attempt_belongs_to_document` | true | true | Attempt debe pertenecer al documento |
| 9 | `runtime_order_payment_intact` | true | true | Órdenes y pagos intactos |
| 10 | `runtime_postgres_concurrency` | **false** | false | **NOT EXECUTED** — runbook two-session |

```json
{ "executed_passed": 9, "executed_failed": 0, "not_executed": 1, "total": 10 }
```

### Post-ROLLBACK (read-only, idéntico a preflight)

| Campo | Valor |
|-------|-------|
| `environment` | stage |
| `emission_enabled` | false |
| `auto_issue_paid_orders` | false |
| `formal_contingency_enabled` | false |
| `fel_documents` | 3 |
| `fel_attempts` | 0 |
| `processing_documents` | 0 |
| `test_certification_rows` | 0 |
| Documentos fixture | Restaurados a `pending_certification`, `retry_count=0`, sin FEL UUID/SAT |
| Órdenes/pagos fixture | Sin cambios vs snapshot pre-runtime |
| `db push --dry-run` | Remote database is up to date |

---

## 10. Pruebas locales (evidencia más reciente)

| Prueba | Resultado |
|--------|-----------|
| `scripts/validate-felplex-migration-safety.mjs` | PASS |
| `npm run test:felplex-1a` | 47/47 PASS |
| `npm run check:felplex-1a` | PASS |
| `git diff --check` (commits corrección test) | PASS |
| `deno.lock` | Ausente |
| `package-lock.json` | Intacto |
| Secret scan (commits test + este documento) | Sin secretos detectados |

---

## 11. Riesgos y pendientes reales

| ID | Pendiente | Severidad |
|----|-----------|-----------|
| P1 | Concurrencia PostgreSQL real (dos sesiones) | Media |
| P2 | Contrato payload FELplex (`FELPLEX_CONTRACT_UNCONFIRMED`) | Alta |
| P3 | Deploy Edge Function `felplex-certify-invoice` | Media |
| P4 | Secretos Stage para Edge | Media |
| P5 | Primera llamada HTTP real a FELplex | Alta |
| P6 | Runtime con fixture FEL (`concept_finalize_success_with_fixture`) | ~~Alta~~ **Resuelto** — runtime post-230000 `runtime_finalize_success` |
| P7 | Recovery operativo documentos `processing` | Alta |
| P8 | Producción | Alta — no autorizada |
| P9 | `emission_enabled` permanece **false** | Obligatorio |
| P10 | `auto_issue_paid_orders` permanece **false** | Obligatorio |
| P11 | Actualización evidencia PR / revisión externa | Baja |

**Resuelto respecto a estado anterior del documento:**

- ~~P6 anterior: aplicación y tests 230000 en Stage~~ → **230000 aplicada; test estructural 36/0/6/42 aprobado en Stage.**
- ~~Runtime fixture finalize pendiente~~ → **Runtime post-230000 9/0/1/10 con ROLLBACK limpio (2026-08-13).**

---

## 12. Restricciones de autorización

Este documento **no** autoriza:

- Deploy de Edge Function
- `FELPLEX_HTTP_ENABLED` ni llamada HTTP a FELplex
- Activar `emission_enabled` o `auto_issue_paid_orders` fuera de transacciones de prueba revertidas
- Uso en Producción
- Marcar PR #21 Ready o mergear sin hito independiente

PR #21 permanece **OPEN** y **Draft**.

---

## 13. Evidencia histórica 220000 (preservada)

### Resumen ejecutivo histórico

Según resultados reportados por el operador el 2026-08-10:

1. **Pruebas estructurales** (`20260808220000_test_pos_fel_attempt_lifecycle.sql`) — 25 `executed=true` / `passed=true`; 9 conceptuales `NOT EXECUTED`.
2. **Runtime transaccional** (`20260808220000_pos_fel_attempt_lifecycle.runtime.sql`) — 9/9 operativos; 1 concurrencia no ejecutada.
3. **Post-ROLLBACK runtime** — configuración y fixtures restaurados.

### Resumen numérico estructural 220000

| Métrica | Valor |
|---------|-------|
| `executed=true`, `passed=true` | 25 |
| `executed=true`, `passed=false` | 0 |
| `executed=false` | 9 |
| Total | 34 |

### Resumen runtime 220000

```json
{ "executed_passed": 9, "executed_failed": 0, "not_executed": 1, "total": 10 }
```

### Post-ROLLBACK runtime 220000

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

---

## 14. Trazabilidad e integridad (blobs Git @ `e9d639a`)

Los tamaños y SHA-256 se calcularon sobre los **blobs Git raw** de `e9d639a5eec471be4090e185089a1713032e158f` (`git cat-file blob`, bytes sin conversión). Los archivos de texto del working tree de Windows pueden presentar tamaños diferentes debido a CRLF; esos bytes locales **no** se usan como evidencia canónica.

**Artefactos verificados:** 8/8 (7 archivos versionados + sufijo aprobado del baseline).

Ejecución remota etiquetada como *reportada por el operador*.

| Artefacto | Bytes | SHA-256 |
|-----------|------:|---------|
| `supabase/migrations/20260808230000_pos_fel_premerge_hardening.sql` | 21 413 | `E15B68DB0CB710F36A880269636F5B5ADB5BEAD4C91F22B86587A8E20B4E54F5` |
| `supabase/schema/20260808230000_test_pos_fel_premerge_hardening.sql` | 16 091 | `5F049D4B796C9682B8F4ED1C2DCCA66AF0B508FDC0A62B1106C68926C108FBAA` |
| `supabase/migrations/20260808220000_pos_fel_attempt_lifecycle.sql` | 15 908 | `5F23E0147748565E4615224836082008EB780C18250BC651A93237248A88461E` |
| `supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql` | 12 463 | `52927DB8B763BE3B54606CF0995127689D92F1CF139C29F58BB9FE9D5BCECCF0` |
| `supabase/stage-tests/20260808220000_pos_fel_attempt_lifecycle.runtime.sql` | 22 844 | `9F16453CB96A955B0B5104C884614784D7408F6BA57BC7EB6E77FF3871FBF437` |
| `docs/felplex-20260808220000-stage-runtime-runbook.md` | 11 264 | `DB0C74B19E0CCC4DC73E00396997BA20EB1904F8611D640A27597E9DCD00A771` |
| `supabase/migrations/20260808180000_erp_schema_baseline.sql` (completo) | 2 143 116 | `1FFBB4C022025C617C5FF92D1856E8B11343CDC88E7C5C16B654EEE504E99C55` |

### Sufijo aprobado del baseline (sin cambio)

| Medida | Valor |
|--------|-------|
| Bytes | **2 141 307** |
| SHA-256 | `F0A9AA71F46D78084D40DBDF5454ABB5BB55F809F4AA3D145B36E090C1FAAD35` |

El baseline protegido completo contiene guard (incluye `relkind='c'`) más snapshot aprobado byte-idéntico al sufijo.

### Commits de trazabilidad (test estructural 230000)

| SHA | Descripción |
|-----|-------------|
| `1a049938b496111e7988516a8dd01023e5fa6fa2` | Contenido operativo 230000 (*resolve pre-merge operational gaps*) |
| `fd791c636356fd44f8e1b1cfb21372bec35593fc` | PG17 — `aclexplode` columnas nativas |
| `d329b81b30ea33873ac25567ecf5a6a8761d0334` | PUBLIC — `grantee = 0` |
| `e9d639a5eec471be4090e185089a1713032e158f` | Cobertura ACL tres helpers payload |

### Clasificación de evidencia

| Fuente | Estado |
|--------|--------|
| Stage 25/25 y 9/9 de 220000 | Histórico, reportado por operador |
| Migración 230000 aplicada Stage | Reportado por operador |
| Test estructural 230000 36/0/6/42 | Ejecutado Stage, reportado por operador |
| Runtime post-230000 9/0/1/10 | Ejecutado Stage, reportado por operador (2026-08-13) |
| Tests Deno / validador / type-check | Local |
| Concurrencia PostgreSQL real | **NOT EXECUTED** |
| Edge deploy / FELplex HTTP | **NOT EXECUTED** |
| Producción | **No involucrada** |

### Limitaciones de trazabilidad

- Este documento es evidencia documental local.
- Resultados numéricos de ejecución remota: **reportados por el operador** salvo tamaños y SHA-256 recalculados desde blobs Git raw de `e9d639a`.
- No sustituye logs exportados del SQL Editor / CLI si se requieren en auditoría externa.

---

## 15. Confirmación — Producción no involucrada

- Project ref Stage: `tgrqarxfmpwgrkntvgma` únicamente para operaciones documentadas.
- Producción no autorizada en ninguna fase de este registro.
- Sin deploy Edge, sin HTTP FELplex, sin activación de emisión.
- PR #21 permanece Draft.

---

*Fin del registro — FELplex Fase 1A.3 — Supabase Stage — actualizado 2026-08-13 (America/Guatemala) — incluye runtime post-230000*
