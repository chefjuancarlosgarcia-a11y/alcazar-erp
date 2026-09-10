# Auditoría contractual FELplex Guatemala — 2026-09-10

**Rama:** `integrate/felplex-phase-1a3` @ `c3b91ec6376183aeafeb67f55af7fa5c1db2566c`  
**Contrato interno:** `docs/felplex-guatemala-api-contract.md`  
**Implementación:** `supabase/functions/_shared/felplex/*`  
**Pruebas:** `felplex_guatemala_contract.test.ts` (24 escenarios GT)

---

## 1. Fuente contractual recuperada

| Campo | Valor |
|-------|-------|
| Nombre | `PUBLIC - FELplex - Documentación` |
| Formato esperado | Postman Collection v2.1 |
| SHA-256 histórico (2026-08-14) | `f9899fbcc3787d96c9967abd3429df7a232f17b3b6fc518c1f5c17b69777b3ce` |
| Tamaño histórico | 359 881 bytes |
| Re-fetch 2026-09-10 | **No disponible** — `https://www.felplex.com/api/` no publica URL de descarga Postman; acceso requiere registro/correo a soporte |
| Referencia local secundaria | `docs/felplex-extract.txt` (extracto sanitizado, **91274** bytes, SHA-256 `2B40511A345790F8D14D914A99C59AD3569B5BEB636484B5BEDC60A6447F5D34`) — **no** es el JSON v2.1 completo |

**Consecuencia:** no se pudo recalcular el hash `f9899fb…` el 2026-09-10. Cualquier drift de la colección oficial permanece **UNCONFIRMED** hasta nueva exportación verificada.

---

## 2. Veredicto de primera certificación Stage (HTTP)

**NO APTO** para primera certificación HTTP real mientras:

- `FELPLEX_CONTRACT_HTTP_CONFIRMED` permanezca apagado (barrera de código);
- `emission_enabled=false`;
- existan campos **UNCONFIRMED** críticos (IVA/`without_iva`, `datetime_issue`, tipo B/S, idempotencia `external_id`).

La implementación es **estáticamente coherente** con la adopción provisional documentada el 2026-08-14, pero **no** constituye confirmación contractual operativa.

---

## 3. Matriz de compatibilidad (resumen)

Leyenda estado: **MATCH** | **MISMATCH** | **UNCONFIRMED** | **N/A**

### Transporte

| Elemento | Fuente | Exigido | Implementación | Estado | Sev. |
|----------|--------|---------|----------------|--------|------|
| Base URL Stage | extract L688; contract | `https://felplex.stage.plex.lat` | `constants.ts`, allowlist | MATCH | INFO |
| Método POST await | extract L23-25 | POST | `transport.ts` | MATCH | INFO |
| Ruta | extract | `/api/entity/{empresa}/invoices/await` | `buildFelplexCertifyUrl` | MATCH | INFO |
| Header auth | contract | `X-Authorization` (no Bearer) | `transport.ts` | MATCH | INFO |
| Accept / Content-Type | contract | `application/json` | `transport.ts` | MATCH | INFO |
| Timeout | contract | ambiguo → cat. B | 30s + `ambiguousOutcome` | MATCH | INFO |
| Redirect | contract | bloquear | `redirect: error` | MATCH | INFO |
| HTTP con flags OFF | código | imposible | gates + contractHttp | MATCH | BLOCKER gate |
| Host productivo | código | bloqueado | allowlist | MATCH | BLOCKER gate |

### Payload FACT (campos clave)

| Campo | Fuente | Exigido / observado | Implementación | Estado | Sev. |
|-------|--------|---------------------|----------------|--------|------|
| `type` | extract | `FACT` | payloadBuilder | MATCH | INFO |
| `currency` | extract | `GTQ` | payloadBuilder | MATCH | INFO |
| `datetime_issue` | extract L10,32,698 | variable `YYYY-MM-DDThh:mm:ss`; ejemplos ISO sin TZ | `formatFelplexDatetimeIssue` ISO local | UNCONFIRMED | **BLOCKER** |
| Zona horaria GT | extract | no documentada explícitamente | sin sufijo Z; hora ERP | UNCONFIRMED | HIGH |
| `external_id` | extract | recomendado; ej. string | estable desde documento | MATCH | INFO |
| Idempotencia GET por external_id | extract / contract § | no confirmada | no implementada | UNCONFIRMED | **BLOCKER** |
| `items[].qty` | extract | num/string en ejemplos | `1` fijo POS v1 | N/A | INFO |
| `items[].type` | extract L37,88 | `B` bienes / `S` servicios | `B` provisional alimentos | UNCONFIRMED | **BLOCKER** |
| `items[].price` | extract | numérico | total factura (IVA incluido) | UNCONFIRMED | HIGH |
| `items[].without_iva` | extract | often `0` en ejemplos | base calculada 12/112 | UNCONFIRMED | **BLOCKER** |
| `items[].taxes` | extract | objeto nulls | EMPTY_TAXES | MATCH | INFO |
| `total` / `total_tax` | extract | numéricos | Q297 297 / 31.82 tests | UNCONFIRMED | **BLOCKER** |
| Fórmula IVA | contract; money.ts | 12/112 provisional | `extractVatIncluded` | UNCONFIRMED | **BLOCKER** |
| `emails` / `emails_cc` | extract | arrays | vacíos POS | MATCH | INFO |
| `to_cf` / `to` CF | extract | CF / NIT | implementado | MATCH | INFO |
| `exempt_phrase` | extract | null permitido | null | MATCH | INFO |
| `custom_fields` | extract | opcional | `[]` | MATCH | INFO |
| Propina | ERP schema | tip v1 = 0 | bloqueado | N/A | INFO |
| Descuentos | extract | permitidos | ERP v1 discount=0 only | N/A | INFO |

### Respuesta

| Elemento | Fuente | Exigido | Implementación | Estado | Sev. |
|----------|--------|---------|----------------|--------|------|
| `valid=true` campos | extract L145-160 | uuid, sat.*, urls | `responseParser.ts` estricto | MATCH | INFO |
| `valid=false` | extract | errors + codes | parser preserva | MATCH | INFO |
| URLs PDF/XML Stage | extract | host Stage | allowlist | MATCH | INFO |

---

## 4. Hallazgos clasificados

### BLOCKER (antes de HTTP / primera certificación)

1. **`FELPLEX_CONTRACT_HTTP_CONFIRMED` apagado** — comportamiento correcto; debe permanecer hasta prueba HTTP controlada.
2. **`emission_enabled=false`** — correcto para fail-closed; requerir runbook separado para piloto.
3. **`datetime_issue`** — formato/zona no confirmados contractualmente frente a SAT.
4. **`without_iva` / IVA incluido** — ejemplos Postman con `0` vs ERP envía base calculada; requiere confirmación FELplex/SAT.
5. **`total_tax` redondeo** — fórmula 12/112 adoptada provisionalmente; no validada en certificación real.
6. **Tipo ítem `B` para consumo alimentos** — regla fiscal ERP provisional.
7. **`external_id` idempotencia** — sin GET por external_id documentado; riesgo duplicado en reintentos manuales.

### HIGH

1. Colección Postman **no re-verificada** por hash el 2026-09-10.
2. **`price` vs IVA incluido** — semántica del campo en ítems multi-línea vs POS línea única.
3. Prueba runtime **C** (`FEL_EMISSION_DISABLED` con JWT válido) pendiente.

### MEDIUM

1. `emails` en extract como objetos `{email}` vs ERP envía `[]` (vacío permitido para CF operativo).
2. GET/DELETE modelados pero no operativos (decisión consciente).

### LOW / INFO

1. Transporte, headers, host Stage, parser, timeout cat. B — alineados con adopción provisional.
2. Edge desplegada fail-closed (evidencia separada).
3. Deno GT tests 24/24 en suite Guatemala.

---

## 5. Decisión sobre código

**No modificar código** en esta auditoría.

- La implementación refleja la **adopción provisional** acordada localmente (2026-08-14).
- Mantener **`FELPLEX_CONTRACT_HTTP_CONFIRMED` apagado** hasta prueba HTTP Stage con empresa `547` y validación de respuesta real.
- **No** declarar contrato confirmado.

---

## 6. Preguntas para soporte FELplex

1. ¿Formato oficial de `datetime_issue` (solo fecha vs datetime) y zona horaria Guatemala?
2. ¿`price` e `without_iva` deben enviarse con IVA incluido/excluido para restaurante (tipo B)?
3. ¿Regla oficial de redondeo para `total_tax` con IVA 12%?
4. ¿Existe consulta/idempotencia por `external_id` además de UUID?
5. ¿Confirmación de tipo `B` para “Consumo de Alimentos” en FACT?

---

---

## Actualización post-auditoría (export Postman SHA `388d18c3…`, 2026-09-10)

Corrección de código (sin HTTP): `without_iva` como bandera **0/1**; `emails`/`emails_cc` como `{ email }[]`; parser acepta `valid=true` sin `sat.certification_date`. Ambigüedades datetime/B-S/redondeo por línea/idempotencia siguen **UNCONFIRMED**. Colección cruda **no** versionada en repo.

*Fin auditoría contractual — 2026-09-10*
