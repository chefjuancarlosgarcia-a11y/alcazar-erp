# FELplex Guatemala — contrato público adoptado (provisional)

**Fecha de adopción local:** 2026-08-14  
**Rama:** `integrate/felplex-phase-1a3`  
**Estado:** provisional — **HTTP bloqueado** hasta prueba Stage con secretos reales

---

## Fuente pública (no almacenada en repo)

| Campo | Valor |
|-------|-------|
| Colección Postman | `PUBLIC - FELplex - Documentación` |
| Formato | Postman Collection v2.1 |
| Tamaño observado | 359 881 bytes |
| SHA-256 observado | `f9899fbcc3787d96c9967abd3429df7a232f17b3b6fc518c1f5c17b69777b3ce` |

La colección completa **no** se copia al repositorio (ejemplos extensos y datos ficticios de terceros).

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
| `billing_providers.entity_id` | `{empresa}` |
| `billing_providers.base_url` | Base URL Stage |

**Nunca** hardcodear `empresa` ni API key en código, docs operativos ni fixtures commitidos.

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
    "without_iva": 265.18,
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
  "emails": [],
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

Campos mínimos exigidos por parser: `uuid`, `sat.serie`, `sat.no`, `sat.authorization`, `sat.certification_date`.  
`invoice_url` / `invoice_xml` deben pertenecer al host Stage.

### Fallo funcional (`valid: false`)

HTTP 200 con `valid: false` **no** es certificación. Se preservan `errors` (anidados) y `error_codes`.

---

## Inconsistencias documentales — fail-closed

| # | Tema | Estado |
|---|------|--------|
| 1 | `external_id` recomendado; sin GET por external_id; idempotencia no confirmada | **Pendiente** |
| 2 | `datetime_issue`: docs `YYYY-MM-dd` vs ejemplos ISO | **Provisional** → adoptamos ISO |
| 3 | IVA / `total_tax` — redondeo oficial no confirmado | **Provisional** → fórmula 12/112 |
| 4 | Timeouts — códigos reintentables no documentados | **Bloqueante** — sin auto-retry POST |
| 5 | `empresa` y API key reales no recibidos | **Bloqueante antes de HTTP** |
| 6 | Tipo ítem `B`/`S` — regla fiscal ERP definitiva | **Provisional** — B para consumo alimentos |

---

## Tabla de decisión

| Elemento | Confirmado | Provisional | Bloqueante antes de HTTP |
|----------|:----------:|:-----------:|:------------------------:|
| Host Stage `felplex.stage.plex.lat` | ✓ | | |
| Header `X-Authorization` | ✓ | | |
| POST `/invoices/await` | ✓ | | |
| Payload FACT estructura base | ✓ | | |
| `datetime_issue` ISO | | ✓ | ✓ |
| IVA incluido 12/112 | | ✓ | ✓ |
| Tipo ítem B consumo alimentos | | ✓ | ✓ |
| Parser `valid` true/false | ✓ | | |
| Timeout → resultado ambiguo (cat. B) | ✓ | | |
| GET / DELETE operativos | | | ✓ (no habilitados) |
| Secretos Stage reales | | | ✓ |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED=true` | | | ✓ |

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
3. Configurar `entity_id` en `billing_providers` vía SQL/service_role autorizado.
4. **Prohibido:** repo, chat, Cursor rules, Vercel env, frontend, logs.

---

## Artefactos de código

| Módulo | Responsabilidad |
|--------|-----------------|
| `payloadBuilder.ts` | FACT provisional validado |
| `datetimeIssue.ts` | Formatter fecha ISO provisional |
| `itemType.ts` | Regla B/S explícita |
| `responseParser.ts` | Parser estricto |
| `contractHttp.ts` | Barrera HTTP confirmado |
| `ambiguousOutcome.ts` | Timeout sin retry |
| `transport.ts` | POST Stage + headers |
| `urlAllowlist.ts` | Allowlist + URLs GET/DELETE modeladas |
| `felplex_guatemala_contract.test.ts` | Pruebas Deno GT-* |

---

## Confirmaciones de alcance

- **No** HTTP en esta fase
- **No** deploy Edge
- **No** Stage / Producción mutados
- **No** secretos en repo
- **No** FCAM / NCRE / NDEB / SMS / WhatsApp / XML base64 operativos

---

*Documento derivado de colección pública Postman — fixtures sanitizados únicamente.*
