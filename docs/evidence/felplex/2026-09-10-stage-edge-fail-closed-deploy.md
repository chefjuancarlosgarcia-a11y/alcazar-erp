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

Estado actual en Stage: **`ACTIVE`**, **`verify_jwt=true`**. Solo `felplex-certify-invoice` fue redeployada en v2; `deactivate-user` y `reactivate-user` permanecen en versión **1** sin cambio de bundle.

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

## Bloqueos operativos vigentes (cinco capas — v1 y v2)

1. **JWT** — gateway + handler (401 sin identidad válida).
2. **Stage-only** — project ref y allowlist host.
3. **`emission_enabled=false`** — gate TS + RPC claim (409 `FEL_EMISSION_DISABLED` esperado con usuario válido en prueba C futura).
4. **`FELPLEX_HTTP_ENABLED` ausente** — transporte bloqueado.
5. **`FELPLEX_CONTRACT_HTTP_CONFIRMED` ausente** — builder/contrato bloqueado antes de claim.

El redeploy **v2** corrige payload/parser en código desplegado; **no** habilita HTTP ni confirma contrato operativo frente a FELplex/SAT.

---

## Limitaciones

- Evidencia **no** sustituye primera certificación HTTP ni confirmación contractual completa (`FELPLEX_CONTRACT_UNCONFIRMED` sigue aplicando para piloto).
- Prueba **C** pendiente (`FEL_EMISSION_DISABLED` / 409 con JWT válido sin exponer token).
- Producción no recibió deploy de esta función.
- Colección Postman completa permanece **fuera** del repositorio.

---

*Fin del registro — Edge fail-closed Stage — cronología v1 → v2 — 2026-09-10*
