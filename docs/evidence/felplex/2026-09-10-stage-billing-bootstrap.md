# Evidencia oficial — Bootstrap billing FELplex en Supabase Stage

| Campo | Valor |
|-------|-------|
| **Fecha de ejecución** | 2026-09-10 |
| **Entorno** | Supabase Stage |
| **Project ref** | `tgrqarxfmpwgrkntvgma` |
| **Producción** | `lwpfrdnsiwtmyonwcduh` — **no involucrada** |
| **Rama documentada** | `integrate/felplex-phase-1a3` |
| **Commit de referencia (repo)** | `143b744c9252ed2eb0c984c211a32399d790a1a1` |
| **PR** | #21 — OPEN, Draft |
| **Fixture** | `supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql` |
| **SHA256 fixture (verificado local)** | `02C6C657523D9AE6006D02DC63B01162F5EAFCBD0AC19DB2273CD54F23F48780` |
| **Método** | Supabase CLI `db query --linked --project-ref tgrqarxfmpwgrkntvgma` (sin exponer credenciales) |

---

## 1. Preflight (read-only, sanitizado)

| Control | Resultado |
|---------|-----------|
| `fel_emission_config` — exactamente una fila | Sí |
| `id = 1` | Sí |
| `environment = stage` | Sí |
| `emission_enabled = false` | Sí |
| `auto_issue_paid_orders = false` | Sí |
| `formal_contingency_enabled = false` | Sí |
| Tablas billing inicialmente vacías | Sí (0 filas en las cuatro tablas) |
| Configuraciones `production` en billing | 0 |
| `pos_fel_documents` certified/processing | 0 |
| `pos_fel_documents` totales | 3 — únicamente `pending_certification` |
| `pos_fel_attempts` | 0 |
| `billing_documents` | 0 |
| `billing_certification_attempts` | 0 |

Identidad Stage confirmada por project ref enlazado, flag CLI `--project-ref tgrqarxfmpwgrkntvgma` y guards del fixture vía `fel_emission_config`.

---

## 2. Ejecución

- **Una sola aplicación** del fixture completo (transacción atómica con advisory lock y guards fail-closed).
- **Sin** rollback.
- **Sin** edición del SQL versionado.
- **Transacción:** exitosa (CLI exit code 0).

---

## 3. Resultado — cuatro filas creadas

| # | Tabla | Filas post |
|---|-------|------------|
| 1 | `billing_legal_entities` | 1 |
| 2 | `billing_providers` | 1 |
| 3 | `billing_provider_configs` | 1 |
| 4 | `billing_provider_status` | 1 |

### Valores verificados (campos no sensibles)

**Entidad legal (`code=default`):**

- `legal_name` / `trade_name`: Pruebas Gran Alcazar
- `tax_id`: `'326070'` (texto, sin guiones)
- `country_code`: GT — `currency_code`: GTQ
- `is_default`: true — `is_active`: true
- `settings`: `{}`

**Proveedor (`felplex_gt`):**

- `name`: FELplex Guatemala
- `adapter_key`: felplex_gt — `adapter_version`: 1.0.0
- `is_active`: true — `capabilities`: `{}`

**Configuración Stage (`felplex_gt` / `stage`):**

- Entidad legal: `default`
- `entity_id`: `'547'`
- `base_url`: `https://felplex.stage.plex.lat`
- `secret_env_var`: `FELPLEX_GT_STAGE_API_KEY` (solo nombre lógico; valor en Edge secrets, no en DB)
- `adapter_version`: null
- `is_default`: true — `is_active`: true
- `issuer_settings`: `{}`

**Status:**

- `connection_status`: `unknown`
- `adapter_version` efectivo en status: 1.0.0 (coalesce con catálogo)

---

## 4. Postcondiciones

| Área | Estado |
|------|--------|
| Cuatro tablas billing | 0 → 1 fila cada una (único cambio estructural del bootstrap) |
| `fel_emission_config` | Sin cambio |
| Interruptores FEL (3) | Permanecieron `false` |
| `billing_documents` | 0 (sin cambio) |
| `billing_certification_attempts` | 0 (sin cambio) |
| `pos_fel_documents` | 3 `pending_certification` (sin cambio) |
| `pos_fel_attempts` | 0 (sin cambio) |
| HTTP FELplex | No ejecutado |
| Edge deploy | No ejecutado |
| Certificación SAT real | No ejecutada |
| Rollback | No ejecutado |
| Producción | No involucrada |

---

## 5. Limitaciones explícitas

- El bootstrap **no** verifica conectividad con FELplex (`connection_status` permanece `unknown`).
- **No** confirma el contrato HTTP Guatemala (`FELPLEX_CONTRACT_HTTP_CONFIRMED` / bloqueo `FELPLEX_CONTRACT_UNCONFIRMED` en runtime).
- **No** autoriza Producción ni replica valores Stage en migraciones.
- **No** habilita emisión, HTTP ni certificación.

---

## 6. Trazabilidad

- Runbook operativo: `docs/felplex-stage-billing-bootstrap-runbook.md`
- Evidencia consolidada Fase 1A.3: `docs/evidence/felplex/2026-08-10-phase-1a3-stage-validation.md`

---

*Fin del registro — bootstrap billing FELplex Stage — 2026-09-10*
