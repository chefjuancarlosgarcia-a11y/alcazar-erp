# Auditoría contractual FELplex Guatemala — 2026-09-10

**Rama:** `integrate/felplex-phase-1a3` @ `ac13a36567e38c4c33fd3e5e6d623a8a4597294a` (runtime Edge Stage **v2**)
**Contrato interno:** `docs/felplex-guatemala-api-contract.md`
**Implementación:** `supabase/functions/_shared/felplex/*`
**Pruebas:** `felplex_guatemala_contract.test.ts` + suite `test:felplex-1a` — **75/75 PASS** (local, post-fix Postman)
**Postman export SHA-256 (2026-09-10):** `388d18c3c876064743230ba6d6bd3dee52bf527f61b6654e21dc258e6f5aeaa6` — **no versionado en repo**

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
- existan campos **UNCONFIRMED** críticos (`datetime_issue`, tipo B/S alimentos preparados, redondeo IVA por línea vs documento, idempotencia/reconsulta `external_id`).

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
| `items[].without_iva` | export 388d18c3… | bandera **0/1** (no base imponible) | POS gravado → `0`; rechazo montos | MATCH (código + tests) | INFO |
| `items[].taxes` | extract | objeto nulls | EMPTY_TAXES | MATCH | INFO |
| `total` / `total_tax` | extract | numéricos | Q297 297 / 31.82 tests | UNCONFIRMED | **BLOCKER** |
| Fórmula IVA | contract; money.ts | 12/112 provisional | `extractVatIncluded` | UNCONFIRMED | **BLOCKER** |
| `emails` / `emails_cc` | export 388d18c3… | `{ email }[]` | builder emite objetos; vacío POS OK | MATCH (código + tests) | INFO |
| `to_cf` / `to` CF | extract | CF / NIT | implementado | MATCH | INFO |
| `exempt_phrase` | extract | null permitido | null | MATCH | INFO |
| `custom_fields` | extract | opcional | `[]` | MATCH | INFO |
| Propina | ERP schema | tip v1 = 0 | bloqueado | N/A | INFO |
| Descuentos | extract | permitidos | ERP v1 discount=0 only | N/A | INFO |

### Respuesta

| Elemento | Fuente | Exigido | Implementación | Estado | Sev. |
|----------|--------|---------|----------------|--------|------|
| `valid=true` campos | export 388d18c3… | uuid, serie, no, authorization; `certification_date` opcional | `responseParser.ts` | MATCH (código + tests) | INFO |
| `valid=false` | extract | errors + codes | parser preserva | MATCH | INFO |
| URLs PDF/XML Stage | extract | host Stage | allowlist | MATCH | INFO |

---

## 4. Hallazgos clasificados

### BLOCKER (antes de HTTP / primera certificación)

1. **`FELPLEX_CONTRACT_HTTP_CONFIRMED` apagado** — comportamiento correcto; debe permanecer hasta prueba HTTP controlada.
2. **`emission_enabled=false`** — correcto para fail-closed; requerir runbook separado para piloto.
3. **`datetime_issue`** — formato/zona no confirmados contractualmente frente a SAT.
4. **`total_tax` redondeo** — fórmula 12/112 a nivel documento en código/tests; redondeo **por línea** vs total no confirmado en certificación real.
5. ~~**`without_iva` / emails / parser date**~~ — **resuelto en código** @ `ac13a365` y **desplegado Stage Edge v2** (evidencia deploy); sigue sin HTTP de validación.
6. **Tipo ítem `B` para consumo alimentos** — regla fiscal ERP provisional.
7. **`external_id` idempotencia** — sin GET por external_id documentado; riesgo duplicado en reintentos manuales.

### HIGH

1. Colección Postman **no re-verificada** por hash el 2026-09-10.
2. **`price` vs IVA incluido** — semántica del campo en ítems multi-línea vs POS línea única.
3. Prueba runtime **C** (`FEL_EMISSION_DISABLED` con JWT válido) pendiente.

### MEDIUM

1. `emails` vacíos en POS — permitido; cuando hay correo, formato `{ email }` implementado.
2. GET/DELETE modelados pero no operativos (decisión consciente).

### LOW / INFO

1. Transporte, headers, host Stage, parser, timeout cat. B — alineados con adopción provisional.
2. Edge Stage **v2** desplegada fail-closed @ `ac13a365` (evidencia separada).
3. Deno FELplex **75/75 PASS** local (`test:felplex-1a`).

---

## 5. Decisión sobre código (actualización post-`ac13a365`)

- Corrección payload/parser **mergeada en rama** y **runtime Stage v2** desplegado fail-closed (2026-09-10).
- Mantener **`FELPLEX_CONTRACT_HTTP_CONFIRMED` apagado** hasta prueba HTTP Stage con empresa `547` y validación de respuesta real.
- Mantener **`FELPLEX_HTTP_ENABLED` apagado**, **`emission_enabled=false`**, **Producción NOT TOUCHED**.
- **No** declarar contrato confirmado mientras persistan UNCONFIRMED listados abajo.

---

## 6. Preguntas para soporte FELplex

1. ¿Formato oficial de `datetime_issue` (solo fecha vs datetime) y zona horaria Guatemala?
2. ¿`price` e `without_iva` deben enviarse con IVA incluido/excluido para restaurante (tipo B)?
3. ¿Regla oficial de redondeo para `total_tax` con IVA 12%?
4. ¿Existe consulta/idempotencia por `external_id` además de UUID?
5. ¿Confirmación de tipo `B` para “Consumo de Alimentos” en FACT?

---

---

## 7. RESUELTO EN CÓDIGO Y DESPLEGADO STAGE V2 (`ac13a365`, Edge plataforma **2**)

| Tema | Estado |
|------|--------|
| `without_iva` bandera **0/1** (no base imponible) | **Implementado** — POS gravado envía **0** |
| `taxable_base` / montos en `without_iva` | **No enviados** (rechazo explícito en builder) |
| `emails` / `emails_cc` | **`{ email }[]`** |
| `sat.certification_date` en `valid=true` | **Opcional** en parser |
| `total_tax` IVA incluido 12/112 | **Conservado** en builder + tests |
| Pruebas locales | **75/75 PASS** (`npm run test:felplex-1a`) |
| HTTP FELplex | **NOT EXECUTED** |
| Primera certificación SAT | **NOT EXECUTED** |
| Prueba runtime **C** | **NOT EXECUTED** — NO SAFE STAGE USER SESSION |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | **OFF/unset** |
| `FELPLEX_HTTP_ENABLED` | **OFF/unset** |
| `emission_enabled` | **false** |

## 8. Confirmaciones piloto v1 (2026-09-11, esta entidad)

- **FELplex:** `datetime_issue` GT; IVA por ítem; `external_id`; consulta UUID; sin retry POST en timeout.
- **Contadoría:** comida **B**, envío **S**; delivery no es todo B ni todo S.
- **Código:** guard `FEL_SALES_CHANNEL_NOT_SUPPORTED`; allowlist `dine_in`, `takeout`; delivery/online bloqueados; línea única B (sin `S` en v1).

Evidencia: `docs/evidence/felplex/2026-09-11-stage-pilot-contract-confirmations.md`.

## 9. UNCONFIRMED / fase posterior

- Multi-ítem B+S en payload (delivery con envío separado).
- Generalización fiscal a otras entidades.
- Consulta por `external_id` en runtime.

Colección Postman SHA `388d18c3…` usada para auditoría; **no** versionada en repo. Posible credencial histórica en export — **no** impresa ni commitada.

## 10. Addendum datetime (2026-09-12, código local sin push)

- **`datetime_issue`:** implementación en `datetimeIssue.ts` convierte instantes ISO UTC/offset a hora civil **`America/Guatemala`** (`YYYY-MM-DDTHH:mm:ss`, sin `Z`/offset/ms) vía `Intl.DateTimeFormat` + `formatToParts`.
- Fuente operativa: confirmación FELplex documentada **2026-09-11** (`2026-09-11-stage-pilot-contract-confirmations.md`).
- HTTP FELplex, certificación SAT, gates y Producción: **sin cambio** (NOT EXECUTED / OFF / no tocada).

*Fin auditoría contractual — actualizado post Edge v2 — 2026-09-10*
