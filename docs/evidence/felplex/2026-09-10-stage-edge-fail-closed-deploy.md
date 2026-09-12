# Evidencia oficial — Deploy fail-closed Edge `felplex-certify-invoice` (Stage)

| Campo | Valor |
|-------|-------|
| **Entorno** | Supabase Stage |
| **Project ref** | `tgrqarxfmpwgrkntvgma` |
| **Producción** | `lwpfrdnsiwtmyonwcduh` — **no involucrada** |
| **PR** | #21 — OPEN, Draft |
| **Function ID** | `5be7fb3a-c010-4824-8fad-3fab146a4d1b` (sin cambio entre v1 y v2) |

---

## Cronología Stage (fail-closed)

| Evento | Fecha | Commit repo (runtime) | Versión plataforma | Bundle `ezbr_sha256` |
|--------|-------|------------------------|--------------------|----------------------|
| **Deploy inicial v1** | 2026-09-10 | `c3b91ec6376183aeafeb67f55af7fa5c1db2566c` | **1** | `3271abf95ea48080b9595da0ceda20dba346f54c3180b5e86acdac749ab9b725` |
| **Redeploy payload v2** | 2026-09-10 | `ac13a36567e38c4c33fd3e5e6d623a8a4597294a` | **2** | `73d79afab19b605460b8aafb31031b30ea534ec75f7d95ed4e0459a2e4034315` |
| **Redeploy piloto gates + datetime v3** | 2026-09-12 | `e061e11efc1cd0d3e7170b95517df6900beac25a` | **3** | `51c51f7145d32d85c8972b8dfe771e804ef838417f20405a3c9b980b51cda3c0` |

Estado actual en Stage: **`ACTIVE`**, **`verify_jwt=true`**, plataforma **v3**. Solo `felplex-certify-invoice` fue redeployada en v2 y v3; `deactivate-user` y `reactivate-user` permanecen en versión **1** sin cambio de bundle.

Alineación contractual Postman (export SHA-256 `388d18c3c876064743230ba6d6bd3dee52bf527f61b6654e21dc258e6f5aeaa6`) incorporada en el runtime **v2**; la colección cruda **no** se versiona en el repo.

---

## Deploy v1 — registro histórico (2026-09-10, `c3b91ec`)

| Campo | Valor |
|-------|-------|
| **Rama** | `integrate/felplex-phase-1a3` @ `c3b91ec6376183aeafeb67f55af7fa5c1db2566c` |
| Versión plataforma | **1** |
| Bundle hash | `3271abf95ea48080b9595da0ceda20dba346f54c3180b5e86acdac749ab9b725` |
| `verify_jwt` | **true** |

**Comando sanitizado:**

```bash
npx supabase functions deploy felplex-certify-invoice --project-ref tgrqarxfmpwgrkntvgma
```

Exit code **0**. Sin flags de secretos ni `--no-verify-jwt`.

### Pruebas locales previas v1

| Comando | Resultado |
|---------|-----------|
| `npm run test:felplex-1a` | **71/71 PASS** |
| `npm run check:felplex-1a` | PASS |

### Snapshot v1 (read-only, pre/post deploy idéntico)

| Control | Valor |
|---------|-------|
| `fel_emission_config` | id=1, `environment=stage`, tres interruptores **false** |
| Billing `felplex_gt/stage` | default+active, `connection_status=unknown` |
| `pos_fel_documents` | **3** × `pending_certification` |
| `pos_fel_attempts` | **0** |
| Billing documents / certification attempts | **0** |

---

## Redeploy v2 — payload Postman (2026-09-10, `ac13a365`)

| Campo | Valor |
|-------|-------|
| **Rama** | `integrate/felplex-phase-1a3` @ `ac13a36567e38c4c33fd3e5e6d623a8a4597294a` |
| **Motivo** | Alinear builder/parser/types con export Postman SHA `388d18c3…` (`without_iva` 0/1, `emails` objeto, parser sin `certification_date` obligatorio) |
| Versión plataforma | **1 → 2** |
| Bundle anterior | `3271abf95ea48080b9595da0ceda20dba346f54c3180b5e86acdac749ab9b725` |
| Bundle nuevo | `73d79afab19b605460b8aafb31031b30ea534ec75f7d95ed4e0459a2e4034315` |
| Estado | **ACTIVE** |
| `verify_jwt` | **true** |

**Comando sanitizado (único redeploy v2):**

```bash
npx supabase functions deploy felplex-certify-invoice --project-ref tgrqarxfmpwgrkntvgma
```

Exit code **0**. Sin establecer secretos ni flags HTTP durante el deploy.

### Pruebas locales asociadas al runtime v2 (repo @ `ac13a365`)

| Comando | Resultado |
|---------|-----------|
| `npm run test:felplex-1a` | **75/75 PASS** (documentado en commit de evidencia posterior) |
| `npm run check:felplex-1a` | PASS |

### Secretos Edge (solo nombres — sin cambio en v2)

| Nombre | Estado |
|--------|--------|
| `FELPLEX_GT_STAGE_API_KEY` | presente (valor **no** leído ni registrado) |
| `FELPLEX_HTTP_ENABLED` | **ausente** (OFF/unset) |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | **ausente** (OFF/unset) |

Secretos de plataforma `SUPABASE_*` presentes (inyectados por Supabase; no modificados en deploy).

### Snapshot Stage v2 (read-only, pre/post redeploy idéntico)

| Control | Valor |
|---------|-------|
| `fel_emission_config` | id=1, `environment=stage`, `emission_enabled` / `auto_issue_paid_orders` / `formal_contingency_enabled` = **false** |
| Billing `felplex_gt/stage` | sin cambio; `connection_status=unknown` |
| `pos_fel_documents` | **3** × `pending_certification` (sin cambio) |
| `pos_fel_attempts` | **0** |
| Campos SAT nuevos | **0** |
| `billing_documents` / `billing_certification_attempts` | **0** |

### Pruebas fail-closed HTTP (runtime v2, 2026-09-10)

Endpoint: `https://tgrqarxfmpwgrkntvgma.supabase.co/functions/v1/felplex-certify-invoice`

| Prueba | Resultado |
|--------|-----------|
| **A — sin Authorization** | **401** — `UNAUTHORIZED_NO_AUTH_HEADER` (gateway, antes del handler) |
| **B — Bearer inválido sintético** | **401** — `UNAUTHORIZED_INVALID_JWT_FORMAT` |
| **C — usuario válido + documento** | **TEST C NOT EXECUTED — NO SAFE STAGE USER SESSION** |

Sin cuerpos con secretos ni JWT en esta evidencia.

**Cero HTTP** hacia `felplex.stage.plex.lat`. **Cero certificaciones SAT.** **Cero attempts** nuevos. **Cero mutaciones** documentales atribuibles al redeploy.

---

## Redeploy v3 — guard `sales_channel` + `datetime_issue` Guatemala (2026-09-12, `e061e11`)

| Campo | Valor |
|-------|-------|
| **Rama / PR head** | `integrate/felplex-phase-1a3` @ `e061e11efc1cd0d3e7170b95517df6900beac25a` |
| **Commits runtime** | `cd0310f` (allowlist `dine_in`/`takeout`, bloqueo delivery/online) + `e061e11` (`America/Guatemala` en `datetimeIssue.ts`) |
| Versión plataforma | **2 → 3** |
| Bundle anterior | `73d79afab19b605460b8aafb31031b30ea534ec75f7d95ed4e0459a2e4034315` |
| Bundle nuevo | `51c51f7145d32d85c8972b8dfe771e804ef838417f20405a3c9b980b51cda3c0` |
| Function ID | `5be7fb3a-c010-4824-8fad-3fab146a4d1b` (sin cambio) |
| `verify_jwt` | **true** |

**Comando sanitizado (único redeploy v3):**

```bash
npx supabase functions deploy felplex-certify-invoice --project-ref tgrqarxfmpwgrkntvgma
```

Exit code **0**. Sin `--no-verify-jwt`, sin flags HTTP/contrato, sin SQL mutativo.

### Pruebas locales asociadas (repo @ `e061e11`)

| Comando | Resultado |
|---------|-----------|
| `npm run test:felplex-1a` | **102/102 PASS** (incl. SC-* canales, DT-* datetime) |
| `npm run check:felplex-1a` | PASS |
| CI @ `e061e11` | **PASS** (FELplex safety, Vercel preview) |

### Secretos Edge (solo nombres — sin cambio en v3)

| Nombre | Estado |
|--------|--------|
| `FELPLEX_GT_STAGE_API_KEY` | presente (valor **no** registrado) |
| `FELPLEX_HTTP_ENABLED` | **ausente** |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | **ausente** |

### Snapshot Stage v3 (read-only, pre/post redeploy idéntico)

| Control | Valor |
|---------|-------|
| `fel_emission_config` | id=1, `environment=stage`, tres interruptores **false** |
| Billing `felplex_gt/stage` | `entity_id=547`, host `felplex.stage.plex.lat`, `connection_status=unknown` |
| `pos_fel_documents` | **3** × `pending_certification` |
| `pos_fel_attempts` | **0** |
| SAT poblado | **0** |
| `billing_documents` / `billing_certification_attempts` | **0** |

Sin pruebas A/B/C adicionales en esta entrega. Sin invocación HTTP FELplex. Sin certificación SAT.

---

## Bloqueos operativos vigentes (cinco capas — v1, v2 y v3)

1. **JWT** — gateway + handler (401 sin identidad válida).
2. **Stage-only** — project ref y allowlist host.
3. **`emission_enabled=false`** — gate TS + RPC claim (409 `FEL_EMISSION_DISABLED` esperado con usuario válido en prueba C futura).
4. **`FELPLEX_HTTP_ENABLED` ausente** — transporte bloqueado.
5. **`FELPLEX_CONTRACT_HTTP_CONFIRMED` ausente** — builder/contrato bloqueado antes de claim.

Los redeploys **v2** y **v3** corrigen runtime desplegado (payload, guard de canal, datetime Guatemala); **no** habilitan HTTP ni confirman contrato operativo frente a FELplex/SAT.

---

## Limitaciones

- Evidencia **no** sustituye primera certificación HTTP ni confirmación contractual completa (`FELPLEX_CONTRACT_UNCONFIRMED` sigue aplicando para piloto).
- Prueba **C** pendiente (`FEL_EMISSION_DISABLED` / 409 con JWT válido sin exponer token).
- Producción no recibió deploy de esta función.
- Colección Postman completa permanece **fuera** del repositorio.

---

*Fin del registro — Edge fail-closed Stage — cronología v1 → v2 → v3 — actualizado 2026-09-12*
