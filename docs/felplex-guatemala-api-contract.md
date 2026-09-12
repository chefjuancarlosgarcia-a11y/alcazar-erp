# FELplex Guatemala — contrato público adoptado (provisional)

**Fecha de adopción local:** 2026-08-14  
**Última auditoría contractual:** 2026-09-10 — export Postman SHA `388d18c3…`; runtime Stage **v3** @ `e061e11`
**Rama / runtime Stage:** `integrate/felplex-phase-1a3` @ `e061e11…` — Edge **v3** ACTIVE fail-closed (guard canal + datetime GT)
**Estado:** provisional — **HTTP bloqueado**; payload Postman corregido en runtime desplegado (**no** sustituye confirmación contractual operativa)

---

## Fuente pública (no almacenada en repo)

| Campo | Valor |
|-------|-------|
| Colección Postman | `PUBLIC - FELplex - Documentación` |
| Formato | Postman Collection v2.1 |
| Tamaño observado | 359 881 bytes |
| SHA-256 observado (2026-08-14) | `f9899fbcc3787d96c9967abd3429df7a232f17b3b6fc518c1f5c17b69777b3ce` |
| SHA-256 export completo (2026-09-10) | `388d18c3c876064743230ba6d6bd3dee52bf527f61b6654e21dc258e6f5aeaa6` |
| Extracto local sanitizado | `docs/felplex-extract.txt` — SHA-256 `2B40511A345790F8D14D914A99C59AD3569B5BEB636484B5BEDC60A6447F5D34` (≠ colección completa) |

La colección completa **no** se versiona en el repo (ejemplos con datos de terceros y posible credencial histórica en respuestas guardadas de Postman). Referencia local read-only fuera del repositorio únicamente para auditoría.

---

## Endpoints Guatemala confirmados (Stage)

| Operación | Método | Ruta |
|-----------|--------|------|
| Certificación síncrona | `POST` | `/api/entity/{empresa}/invoices/await` |
| Consulta por UUID | `GET` | `/api/entity/{empresa}/invoices/{dte_uuid}` |
| Texto del DTE | `GET` | `/api/entity/{empresa}/invoices/{dte_uuid}/text` |
| Anulación | `DELETE` | `/api/entity/{empresa}/invoices/{dte_uuid}` body `{ "reason": "..." }` |

**Base URL Stage autorizada:** `https://felplex.stage.plex.lat`

---

## Headers confirmados

| Header | Valor |
|--------|-------|
| `Accept` | `application/json` |
| `Content-Type` | `application/json` (cuando hay body) |
| `X-Authorization` | API key |

**Prohibido:** `Authorization: Bearer …`

---

## Variables / secretos (reutilizar nombres existentes)

| Variable | Uso |
|----------|-----|
| `FELPLEX_HTTP_ENABLED` | Kill switch HTTP (default **false**) |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | Segunda barrera — default **false** |
| `FELPLEX_GT_STAGE_API_KEY` | API key Stage (solo Supabase secrets) |
| `billing_provider_configs.entity_id` | `{empresa}` FELplex (ej. `547` en Stage) |
| `billing_provider_configs.base_url` | Base URL Stage del adaptador |

**Esquema:** `billing_providers` es únicamente el catálogo del adaptador `felplex_gt`.
La configuración operativa por entidad y ambiente vive en **`billing_provider_configs`**.

**Nunca** hardcodear `empresa` ni API key en código, docs operativos ni fixtures commitidos fuera de `supabase/stage-fixtures/`.

---

## Payload FACT sanitizado (provisional)

```json
{
  "type": "FACT",
  "currency": "GTQ",
  "datetime_issue": "2026-08-08T20:00:00",
  "external_id": "POS-22222222-2222-4222-8222-222222222222",
  "items": [{
    "qty": 1,
    "type": "B",
    "price": 297,
    "description": "Consumo de Alimentos",
    "without_iva": 0,
    "discount": 0,
    "is_discount_percentage": 0,
    "taxes": {
      "quantity": null,
      "tax_code": null,
      "full_name": null,
      "short_name": null,
      "tax_amount": null,
      "taxable_amount": null
    }
  }],
  "total": 297,
  "total_tax": 31.82,
  "emails": [{ "email": "cliente@example.com" }],
  "emails_cc": [],
  "to_cf": 1,
  "to": {
    "tax_code_type": "NIT",
    "tax_code": "CF",
    "tax_name": "Consumidor Final",
    "address": {
      "street": "Ciudad",
      "city": "Guatemala",
      "state": "Guatemala",
      "zip": "01001",
      "country": "GT"
    }
  },
  "exempt_phrase": null,
  "custom_fields": []
}
```

Implementación: `supabase/functions/_shared/felplex/payloadBuilder.ts`

---

## Respuesta sanitizada

### Éxito funcional (`valid: true`)

Campos mínimos exigidos por parser en `valid: true`: `uuid`, `sat.serie`, `sat.no`, `sat.authorization`.
`sat.certification_date` es **opcional** (observado ausente en ejemplos GT); no se inventa.
`invoice_url` / `invoice_xml` opcionales; si vienen, deben pertenecer al host Stage.

**Confirmado (Postman Variables generales, export 2026-09-10):** `without_iva` es bandera **0** (con IVA) / **1** (sin IVA); el IVA monetario va en `total_tax`. Base imponible **no** se envía en `without_iva`.
**Confirmado:** `emails` / `emails_cc` como arreglos de `{ "email": "…" }`.

**Confirmado (FELplex + contadoría, esta entidad, 2026-09-11):** `datetime_issue` hora civil **America/Guatemala** como `YYYY-MM-DDTHH:mm:ss` (sin `Z`/offset/ms); el Edge convierte un instante UTC (`toISOString()`) vía `Intl` + `formatToParts` antes del payload; comida **B**, cargo envío **S**; IVA por ítem transmitido con `without_iva=0`; consulta DTE solo por UUID; sin retry POST en timeout.

**Piloto POS v1 (Edge):** una línea agregada **B** solo en canales `dine_in` y `takeout`. **`delivery` / `online` / canal ausente → `FEL_SALES_CHANNEL_NOT_SUPPORTED`**. Multi-ítem B+S **no** implementado.

**HTTP:** NOT EXECUTED. `FELPLEX_CONTRACT_HTTP_CONFIRMED` permanece apagado.

### Fallo funcional (`valid: false`)

HTTP 200 con `valid: false` **no** es certificación. Se preservan `errors` (anidados) y `error_codes`.

---

## Inconsistencias documentales — fail-closed

| # | Tema | Estado |
|---|------|--------|
| 1 | `external_id` recomendado; sin GET por external_id; idempotencia no confirmada | **Pendiente** |
| 2 | `datetime_issue`: docs `YYYY-MM-dd` vs ejemplos ISO | **Confirmado** — zona `America/Guatemala`, formato `YYYY-MM-DDTHH:mm:ss` |
| 3 | IVA / `total_tax` — redondeo por línea vs total no confirmado | **Provisional** → fórmula 12/112 a nivel documento |
| 4 | Timeouts — códigos reintentables no documentados | **Bloqueante** — sin auto-retry POST |
| 5 | `empresa` Stage vía billing bootstrap; API key solo en secretos Edge (nombre `FELPLEX_GT_STAGE_API_KEY`) — contrato HTTP sigue sin confirmar | **Bloqueante antes de HTTP** |
| 6 | Tipo ítem `B`/`S` — comida B / envío S (esta entidad) | **Confirmado fiscalmente** — v1 solo línea B en dine_in/takeout; delivery bloqueado |

---

## Tabla de decisión

| Elemento | Confirmado | Provisional | Bloqueante antes de HTTP |
|----------|:----------:|:-----------:|:------------------------:|
| Host Stage `felplex.stage.plex.lat` | ✓ | | |
| Header `X-Authorization` | ✓ | | |
| POST `/invoices/await` | ✓ | | |
| Payload FACT estructura base | ✓ | | |
| `without_iva` bandera 0/1 | ✓ | | |
| `emails` objeto `{ email }` | ✓ | | |
| `datetime_issue` GT `YYYY-MM-DDTHH:mm:ss` | ✓ | | |
| IVA incluido 12/112 (`total_tax`) por ítem v1 | ✓ | | |
| Piloto v1 canales `dine_in`/`takeout` | ✓ | | |
| Delivery / online en piloto v1 | | | ✓ (bloqueado en gates) |
| Parser `valid` true/false | ✓ | | |
| Timeout → resultado ambiguo (cat. B) | ✓ | | |
| GET / DELETE operativos | | | ✓ (no habilitados) |
| Secretos Stage (nombre presente; valor no en repo) | ✓ | | |
| Edge Stage fail-closed desplegada (v3 @ `e061e11`) | ✓ | | |
| `without_iva` 0/1 + `emails` objeto (código + 102/102 tests) | ✓ | | |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED=true` | | | ✓ |
| Auditoría 2026-09-10 — datetime/tipo B/redondeo línea/idempotencia | | ✓ | ✓ |

---

## Timeout / resultado ambiguo

- **Nunca** reintentar automáticamente `POST /invoices/await`.
- Timeout → `FEL_UNCERTAIN_OUTCOME` (recovery categoría B).
- **No** finalize failed automático si pudo llegar a FELplex.
- Ver runbook: `docs/felplex-230000-stage-concurrency-and-recovery-runbook.md`

---

## Procedimiento seguro para recibir secretos

1. Solo en **Supabase Stage** → Project Settings → Edge Functions → Secrets.
2. Nombres: `FELPLEX_GT_STAGE_API_KEY` (existente).
3. **`billing_provider_configs` en Stage:** el fixture `supabase/stage-fixtures/felplex_gt_billing_bootstrap.sql` fue **ejecutado exitosamente el 2026-09-10** en project ref `tgrqarxfmpwgrkntvgma` (evidencia: `docs/evidence/felplex/2026-09-10-stage-billing-bootstrap.md`). La configuración operativa (`entity_id`, `base_url`, `secret_env_var` lógico) vive en **`billing_provider_configs`**; `billing_provider_status.connection_status` permanece **`unknown`**.
4. El bootstrap **no** confirma el contrato HTTP; el bloqueo **`FELPLEX_CONTRACT_UNCONFIRMED`** (y la barrera `FELPLEX_CONTRACT_HTTP_CONFIRMED`) sigue aplicando en runtime. **No** autoriza Producción.
5. **Prohibido:** repo (salvo stage-fixtures), chat, Cursor rules, Vercel env, frontend, logs.

---

## Artefactos de código

| Módulo | Responsabilidad |
|--------|-----------------|
| `payloadBuilder.ts` | FACT provisional validado |
| `datetimeIssue.ts` | Instant → hora civil Guatemala (`America/Guatemala`) |
| `itemType.ts` | Regla B/S explícita |
| `responseParser.ts` | Parser estricto |
| `contractHttp.ts` | Barrera HTTP confirmado |
| `ambiguousOutcome.ts` | Timeout sin retry |
| `transport.ts` | POST Stage + headers |
| `urlAllowlist.ts` | Allowlist + URLs GET/DELETE modeladas |
| `felplex_guatemala_contract.test.ts` | Pruebas Deno GT-* |

---

## Confirmaciones de alcance (2026-09-12, post Edge v3)

- **HTTP FELplex NOT EXECUTED** — `FELPLEX_HTTP_ENABLED` / `FELPLEX_CONTRACT_HTTP_CONFIRMED` **OFF/unset**
- **Primera certificación SAT NOT EXECUTED**
- **Prueba runtime C NOT EXECUTED** (sin sesión Stage segura)
- Edge Stage **v3** desplegada fail-closed — `docs/evidence/felplex/2026-09-10-stage-edge-fail-closed-deploy.md`
- **`emission_enabled=false`** y switches FEL permanecen apagados
- Bootstrap billing Stage completado; `connection_status=unknown`
- **Producción NOT TOUCHED**
- **No** secretos ni colección Postman en repo
- **No** FCAM / NCRE / NDEB / SMS / WhatsApp / XML base64 operativos
- **No** declarar contrato completamente confirmado (UNCONFIRMED: datetime, B/S, redondeo línea, `external_id`)

---

*Documento derivado de colección pública Postman — fixtures sanitizados únicamente.*
