# FELplex — Fase 1A.2: endurecimiento transaccional y de seguridad

**Estado:** implementación y corrección pre-merge locales revisables.
**No desplegado.** **Sin llamadas FELplex.** **La corrección 230000 no se ejecutó contra Stage/Producción.**

Los resultados SQL históricos de `20260808220000` fueron ejecutados y reportados por el operador; no fueron reejecutados durante esta corrección local.

Switches obligatorios permanecen **OFF**:

- `fel_emission_config.environment = stage`
- `emission_enabled = false`
- `auto_issue_paid_orders = false`
- `formal_contingency_enabled = false`
- `FELPLEX_HTTP_ENABLED` unset/false
- Producción completamente bloqueada

---

## 1. Arquitectura transaccional

```
POST felplex-certify-invoice
  1. Validar input UUID
  2. Validar JWT
  3. Validar autorización canónica (is_cash_operator equivalente)
  4. Validar proyecto Stage
  5. Cargar configuración y documento
  6. Validar gates no mutantes (incluye idempotencia certified tras gates)
  7. Construir payload (bloqueado por contrato)
  8. Si contrato no confirmado → FELPLEX_CONTRACT_UNCONFIRMED, cero claim, cero HTTP
  9. RPC fel_claim_pos_fel_certification_attempt (atómica + gates DB)
 10. Transporte FELplex (allowlist estricta, redirect:error)
 11. Adaptar y sanitizar respuesta
 12. RPC fel_finalize_pos_fel_certification_attempt (atómica)
 13. Responder certified/failed solo si finalize confirma DB
```

**Semántica de entrega:** at-least-once protegido por `external_id` e idempotencia, con reconciliación manual para resultado incierto.

---

## 2. Gates DB en claim (PostgreSQL)

Tras `pg_advisory_xact_lock`, **antes** de insertar el intento, `fel_claim_pos_fel_certification_attempt` lee `fel_emission_config id=1` y aborta si:

| Condición | Código |
|-----------|--------|
| Fila ausente | `FEL_EMISSION_DISABLED` |
| `environment <> 'stage'` | `FEL_ENVIRONMENT_NOT_STAGE` |
| `emission_enabled = false` | `FEL_EMISSION_DISABLED` |
| `formal_contingency_enabled = true` | `FEL_CONTINGENCY_NOT_SUPPORTED` |

Además mantiene validación de documento `environment='stage'`, conciliación de pagos y estados certificables. **No depende solo de gates TypeScript.**

---

## 3. RPC claim / finalize (service_role only)

### Claim

```sql
fel_claim_pos_fel_certification_attempt(p_document_id uuid, p_actor_id uuid) RETURNS jsonb
```

### Finalize

```sql
fel_finalize_pos_fel_certification_attempt(
  p_document_id uuid, p_attempt_id uuid, p_outcome text,
  p_fel_uuid text, p_sat_authorization text, ...
  p_safe_response_payload jsonb, p_request_payload jsonb
) RETURNS jsonb
```

### Privilegios

- `SECURITY DEFINER`, `SET search_path = ''`
- `REVOKE ALL` de `public`, `anon`, `authenticated` en claim, finalize y `fel_actor_can_request_certification`
- `GRANT EXECUTE` únicamente a `service_role` en claim/finalize
- Acceso directo de `service_role`: `SELECT` en `pos_fel_documents`; sin privilegios directos en `pos_fel_attempts`
- Escritura de documentos/intentos únicamente dentro de los RPC `SECURITY DEFINER`

### Normalización de rol

Edge replica la normalización PostgreSQL: el alias histórico `administrador` se normaliza a `admin`. Esto corrige una denegación incorrecta; no añade operadores canónicos, no autoriza roles nuevos y mantiene obligatorio `status='active'`.

---

## 4. Finalize no confirmado → FEL_UNCERTAIN_OUTCOME

Si el transporte o el adaptador indican fallo pero `fel_finalize_pos_fel_certification_attempt`:

- retorna `null`,
- lanza error, o
- devuelve IDs/status incongruentes,

la Edge responde **HTTP 500** con `FEL_UNCERTAIN_OUTCOME`. **No** devuelve el error FELplex como resultado definitivo. Documento permanece `processing`. Sin reintento automático.

La misma regla estricta aplica a `outcome='success'` y `outcome='failed'`.

Solo si finalize confirma `status='failed'` se devuelve el error de transporte/adaptador al cliente.

---

## 5. Errores RPC públicos (allowlist)

Módulo `rpcErrors.ts`:

- Allowlist de códigos `FEL_*` conocidos con mensajes públicos fijos
- Código desconocido (p. ej. `FEL_RPC_UNKNOWN`) → HTTP 500 genérico
- No se exponen mensajes crudos de PostgreSQL/Supabase, nombres de tablas, constraints ni stack

---

## 6. Safe response payload en SQL

`fel_validate_safe_response_payload(p_payload jsonb)`:

- Acepta `NULL` u objeto jsonb
- Solo claves: `http_status`, `error_kind`, `provider_valid`, `safe_code`, `safe_message`
- Rechaza `invoice_xml`, `invoice_url`, `errors`, `uuid`, `sat`, headers, credenciales
- Limita `safe_code` (64) y `safe_message` (240)

Finalize invoca el validador antes de persistir.

`fel_validate_request_payload` valida por separado el request construido por Edge:

- acepta `NULL` u objeto JSON;
- máximo serializado de 32 KiB;
- rechaza recursivamente claves sensibles, sin distinción de mayúsculas;
- no define una allowlist contractual mientras FELplex continúe sin confirmar.

En `outcome='success'`, finalize vuelve a comprobar que la orden siga `paid`, completamente conciliada y con saldo cero antes de marcar el documento `certified`.

---

## 7. Allowlist estricta

Único host: **`https://felplex.stage.plex.lat`**. Fetch con `redirect: "error"`.

---

## 8. Pruebas

### TypeScript (ejecutadas localmente)

```bash
npm run test:felplex-1a
npm run check:felplex-1a
```

Incluye escenarios 1A.1 y 1A.2 (finalize incierto, claim emission gate, handler try/catch, redirect, RPC allowlist).

### SQL (solo revisión estática — NOT EXECUTED)

`supabase/schema/20260808220000_test_pos_fel_attempt_lifecycle.sql`

| Tipo | executed | passed |
|------|----------|--------|
| `static_*` (firmas, grants, SECURITY DEFINER, gates en definición) | true cuando migración aplicada | true si checks estructurales OK |
| `concept_*` (transiciones, concurrencia real) | **false** | **false** — detalle `NOT EXECUTED` |

**Concurrencia PostgreSQL real** (dos sesiones claim simultáneo) permanece pendiente del runbook Stage; no se afirma como probada localmente.

---

## 9. Contrato FELplex

Builder bloqueado (`FELPLEX_CONTRACT_UNCONFIRMED`). Sin HTTP operativo hasta confirmación oficial.

Los switches continúan apagados por defecto: `emission_enabled=false`, `auto_issue_paid_orders=false`, `formal_contingency_enabled=false` y `FELPLEX_HTTP_ENABLED` unset/false.

Un documento `processing` atascado permanece fail-closed y requiere reconciliación manual. Recovery automático y concurrencia PostgreSQL real siguen pendientes antes de emisión real.

---

## 10. Rollback

`supabase/rollback/20260808220000_pos_fel_attempt_lifecycle.rollback.sql`

El hardening aditivo usa `20260808230000_pos_fel_premerge_hardening.sql`. Su rollback aborta deliberadamente porque restaurar las definiciones previas degradaría los controles de Stage, payload y privilegios.
