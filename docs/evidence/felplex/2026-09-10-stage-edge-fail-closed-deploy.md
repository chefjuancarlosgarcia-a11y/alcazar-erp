# Evidencia oficial — Deploy fail-closed Edge `felplex-certify-invoice` (Stage)

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-10 |
| **Entorno** | Supabase Stage |
| **Project ref** | `tgrqarxfmpwgrkntvgma` |
| **Producción** | `lwpfrdnsiwtmyonwcduh` — **no involucrada** |
| **Rama / commit repo** | `integrate/felplex-phase-1a3` @ `c3b91ec6376183aeafeb67f55af7fa5c1db2566c` |
| **PR** | #21 — OPEN, Draft |

---

## 1. Función desplegada (verificado administrativamente)

| Campo | Valor |
|-------|-------|
| Nombre | `felplex-certify-invoice` |
| Estado | `ACTIVE` |
| Versión plataforma | **1** |
| Function ID | `5be7fb3a-c010-4824-8fad-3fab146a4d1b` |
| Bundle hash (`ezbr_sha256`) | `3271abf95ea48080b9595da0ceda20dba346f54c3180b5e86acdac749ab9b725` |
| `verify_jwt` | **true** |

**Decisión JWT:** deploy **sin** `--no-verify-jwt`. El handler valida `Authorization` + `admin.auth.getUser()` + perfil/rol caja; el gateway rechaza JWT inválidos antes del handler.

**Comando sanitizado (único deploy):**

```bash
npx supabase functions deploy felplex-certify-invoice --project-ref tgrqarxfmpwgrkntvgma
```

Exit code **0**. No se establecieron secretos ni flags HTTP durante el deploy.

---

## 2. Pruebas locales previas al deploy (repo @ `c3b91ec`)

| Comando | Resultado |
|---------|-----------|
| `npm run test:felplex-1a` | **71/71 PASS** |
| `npm run check:felplex-1a` | PASS |

---

## 3. Secretos Edge (solo nombres)

| Nombre | Estado |
|--------|--------|
| `FELPLEX_GT_STAGE_API_KEY` | presente (valor **no** leído ni registrado) |
| `FELPLEX_HTTP_ENABLED` | **ausente** (default OFF) |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | **ausente** (default OFF) |

Secretos de plataforma `SUPABASE_*` presentes (inyectados por Supabase; no modificados).

---

## 4. Snapshot Stage previo al deploy (read-only)

| Control | Valor |
|---------|-------|
| `fel_emission_config` | 1 fila, id=1, `environment=stage`, tres interruptores **false** |
| Billing `felplex_gt/stage` | default+active, `entity_id=547`, URL Stage, `secret_env_var` lógico, `connection_status=unknown` |
| `pos_fel_documents` | **3**, solo `pending_certification` |
| `pos_fel_attempts` | **0** |
| `billing_documents` / `billing_certification_attempts` | **0** |

---

## 5. Pruebas fail-closed HTTP (2026-09-10, sin re-ejecución en auditoría documental)

Endpoint: `https://tgrqarxfmpwgrkntvgma.supabase.co/functions/v1/felplex-certify-invoice`

| Prueba | Resultado |
|--------|-----------|
| **A — sin Authorization** | **401** — `UNAUTHORIZED_NO_AUTH_HEADER` |
| **B — Bearer inválido** | **401** — `UNAUTHORIZED_INVALID_JWT_FORMAT` |
| **C — usuario válido + documento** | **NOT EXECUTED** (sin sesión Stage segura disponible sin crear credenciales) |

Sin cuerpos con secretos ni headers completos en esta evidencia.

---

## 6. Snapshot posterior al deploy (read-only, idéntico en controles críticos)

| Control | Valor |
|---------|-------|
| Documentos FEL | 3 × `pending_certification` (sin cambio) |
| `pos_fel_attempts` | **0** |
| Campos SAT nuevos | **0** |
| Interruptores FEL | sin cambio (false) |
| Billing config | sin cambio (`unknown`) |

---

## 7. Bloqueos operativos vigentes (cinco capas)

1. **JWT** — gateway + handler (401 sin identidad válida).
2. **Stage-only** — project ref y allowlist host.
3. **`emission_enabled=false`** — gate TS + RPC claim (409 `FEL_EMISSION_DISABLED` esperado con usuario válido).
4. **`FELPLEX_HTTP_ENABLED` ausente** — transporte bloqueado.
5. **`FELPLEX_CONTRACT_HTTP_CONFIRMED` ausente** — builder/contrato bloqueado antes de claim.

**Cero HTTP** hacia `felplex.stage.plex.lat` en pruebas A/B. **Cero certificaciones SAT.** **Cero mutaciones** documentales en el deploy/validación.

---

## 8. Limitaciones

- Esta evidencia **no** confirma el contrato HTTP Guatemala (`FELPLEX_CONTRACT_UNCONFIRMED` sigue aplicando).
- Prueba C pendiente para demostrar `FEL_EMISSION_DISABLED` en runtime desplegado.
- Producción no recibió deploy de esta función.

---

*Fin del registro — Edge fail-closed Stage — 2026-09-10*
