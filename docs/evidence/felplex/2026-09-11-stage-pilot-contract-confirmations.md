# Evidencia — confirmaciones piloto FELplex POS v1 (Stage)

| Campo | Valor |
|-------|-------|
| **Fecha** | 2026-09-11 |
| **Entorno documental** | Supabase Stage (`tgrqarxfmpwgrkntvgma`) |
| **Producción** | **no consultada ni tocada** |
| **Rama** | `integrate/felplex-phase-1a3` |
| **PR** | #21 — OPEN, Draft |

---

## 1. Confirmaciones FELplex (operador / soporte — sanitizado)

| Tema | Decisión adoptada en código v1 |
|------|--------------------------------|
| `datetime_issue` | Hora Guatemala, formato `YYYY-MM-DDTHH:mm:ss` (sin `Z`) |
| IVA gravado | `without_iva=0`; IVA calculado/redondeado por **ítem transmitido** |
| Idempotencia emisión | `external_id` estable; **sin** segundo POST automático en timeout/incertidumbre |
| Consulta DTE | Solo por **UUID** (no consulta por `external_id` en v1) |

Sin capturas, facturas reales, UUID SAT, series, autorizaciones ni credenciales en este registro.

---

## 2. Decisión fiscal contable (esta entidad solamente)

| Concepto | Clasificación |
|----------|----------------|
| Alimentos, pizzas, bebidas | `items[].type = "B"` |
| Cargo de envío a domicilio | `items[].type = "S"` |
| Orden delivery | Comida **B** + envío **S** (no toda la orden B ni toda S) |

**Alcance:** decisión documentada para **esta entidad**; no generalizar a otras entidades sin configuración fiscal propia.

---

## 3. Limitación POS FELplex v1 (fail-closed)

| Regla | Estado |
|-------|--------|
| Builder | **Una sola línea agregada** (`qty=1`, descripción fiscal, total orden) |
| Canales permitidos piloto | `dine_in`, `takeout` (sin cargo de envío separado) |
| `delivery` | **NOT SUPPORTED** — `FEL_SALES_CHANNEL_NOT_SUPPORTED` |
| `online` / Wix | **NOT SUPPORTED** (ambiguo respecto a envío) |
| Canal null / ausente / desconocido | **NOT SUPPORTED** |
| Multi-ítem B + S | **Fase posterior** (no v1) |
| Tipo `S` en payload | **No emitido** en v1 (delivery bloqueado antes de claim) |

No inferir ni restar cargo de envío del total agregado.

---

## 4. Prueba C y gates operativos

| Control | Estado |
|---------|--------|
| TEST C fail-closed | **PASS** — HTTP 409, `FEL_EMISSION_DISABLED` (evidencia PR #21) |
| `emission_enabled` | **false** |
| `FELPLEX_HTTP_ENABLED` | **OFF/unset** |
| `FELPLEX_CONTRACT_HTTP_CONFIRMED` | **OFF/unset** |
| HTTP FELplex piloto | **NOT EXECUTED** |
| Certificación SAT | **NOT EXECUTED** |

---

## 5. Schema `sales_channel` (referencia repo)

Valores reales en `pos_orders` (`046_pos_customers_sales_channels.sql`):

- `dine_in` — salón
- `takeout` — para llevar
- `delivery` — domicilio
- `online` — canal en línea / Wix

Allowlist piloto v1 en Edge: **`dine_in`**, **`takeout`** únicamente.

Persistencia: `order_snapshot.sales_channel` al solicitar documento FEL (`request_pos_fel_certification`).

---

*Fin — confirmaciones piloto v1 — 2026-09-11*
