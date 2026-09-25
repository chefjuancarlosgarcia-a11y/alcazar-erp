## Resumen

Rama FELplex Fase 1A.3 con fundación Stage, ciclo transaccional claim/finalize, pruebas SQL/Deno, runbooks, bootstrap billing Stage, **Edge Stage v3 ACTIVE fail-closed** (payload Postman v2 + **guard `sales_channel`** + **`datetime_issue` America/Guatemala**), y auditoría contractual Guatemala documentada.

**Head:** `e061e11efc1cd0d3e7170b95517df6900beac25a` — **OPEN**, **Draft**, sin auto-merge — **no listo para merge** hacia `main`.

## Evidencia de validación (consolidado actual)

- Structural SQL (220000): 25/25 — histórico operador.
- Runtime Stage (220000): 9/9 — histórico operador.
- Migración 230000: 36/0/6/42 — histórico operador.
- Runtime post-230000 + concurrencia PostgreSQL: **PASS** Stage (2026-08-13).
- Bootstrap billing Stage: **2026-09-10** (`docs/evidence/felplex/2026-09-10-stage-billing-bootstrap.md`).
- Edge fail-closed **v1 → v2 → v3** (`docs/evidence/felplex/2026-09-10-stage-edge-fail-closed-deploy.md`):
  - **v2** @ `ac13a365` — payload Postman SHA `388d18c3…`
  - **v3** @ `e061e11` — `cd0310f` (allowlist `dine_in`/`takeout`; `FEL_SALES_CHANNEL_NOT_SUPPORTED`) + `e061e11` (datetime GT); bundle `51c51f71…da3c0`; **`verify_jwt=true`**
- **Deno FELplex:** **102/102 PASS**; `check:felplex-1a` OK; CI **PASS** @ `e061e11`.
- **Pruebas gateway A/B:** **401** — histórico 2026-09-10.
- **Prueba C:** **PASS fail-closed** — `FEL_EMISSION_DISABLED` (comentario PR #21; sin re-ejecución en deploy v3).
- **Auditoría acumulada** `eadedfd..e061e11`: **APTO** push + redeploy fail-closed (gates OFF).

Post-redeploy **v3**: snapshot DB idéntico (3 `pending_certification`, 0 attempts, 0 SAT); **sin HTTP FELplex**; **sin certificación SAT**.

## Controles de seguridad (gates apagados)

- Edge **ACTIVE** Stage, **`verify_jwt=true`**
- `FELPLEX_HTTP_ENABLED` / `FELPLEX_CONTRACT_HTTP_CONFIRMED` **OFF/unset**
- `emission_enabled` / `auto_issue_paid_orders` / `formal_contingency_enabled` **false**
- Piloto v1: solo **`dine_in` / `takeout`**; **delivery / online** bloqueados en Edge
- **Producción no involucrada**

## Blockers restantes (antes de piloto HTTP / SAT)

- Confirmación operativa contrato HTTP (`FELPLEX_CONTRACT_HTTP_CONFIRMED` + prueba controlada).
- Multi-ítem B+S (envío) — fase posterior; delivery sigue bloqueado en v1.
- Idempotencia consulta documento `certified` + canal no allowlisted — riesgo MEDIUM documentado; revisar antes de delivery histórico.
- **Piloto HTTP** y certificación SAT — **no autorizados** en este PR.

## Commits recientes (trazabilidad)

- `e061e11` — datetime Guatemala (`datetimeIssue.ts`)
- `cd0310f` — guard canal piloto v1
- `eadedfd` — evidencia Edge v2
- `ac13a365` — payload Postman
- Ver historial para fundación 1A.3 completa.

## Test plan (operador)

- [ ] Mantener gates OFF hasta runbook piloto
- [ ] Tras flags futuros: una orden `dine_in` pagada, JWT cajero, esperar 409 si emisión OFF
- [ ] No certificar delivery/online hasta multi-ítem B/S
