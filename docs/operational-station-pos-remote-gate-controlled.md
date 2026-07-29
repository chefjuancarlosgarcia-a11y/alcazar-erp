# Station POS 197/198 — controlled remote gate (staging)

**Status:** preparation only until explicit authorization for each phase.
**PR:** [#13](https://github.com/chefjuancarlosgarcia-a11y/alcazar-erp/pull/13) (Draft, do not merge from this doc).
**Flag:** `operational_station_pos_enabled` must stay **false** through SQL apply and postflight.

Local reproducible evidence lives under `.local-backup/pg-lab/evidence/` (not in Git). Keep until remote gate closes.

---

## Phase 0 — PR review (no database)

- [ ] Review full diff on PR #13 (32 files, +6060 / −15 vs `main`).
- [ ] Commit `7ecb4b7`: SQL 197/198, tests, diagnose, rollback, docs, local Docker script only.
- [ ] Commit `cb47fd9`: frontend `/station/pos`, facade/port, UUID idempotency, selftests.
- [ ] Confirm no `.local-backup/`, secrets, or lab runners in the PR file list.
- [ ] Vercel checks green (already reported on Draft).

**198 review map:** `supabase/schema/parts/198_README.md` (sections A–I, single transaction).

---

## Phase 1 — Read-only on staging (authorized separately)

Run in Supabase SQL Editor or `psql` against **staging** — **SELECT/diagnose only**, no apply.

| Step | Script | Pass criteria |
|------|--------|----------------|
| R1 | `diagnose_operational_pin_module_station_type_preflight_197.sql` | Blockers green; `ready_to_apply_197` or already applied |
| R2 | `diagnose_operational_station_pos_preflight_198.sql` | Blockers green; `ready_to_apply_198`; flag not enabled |
| R3 | Confirm backup | Point-in-time or nightly backup **after** R1/R2, **before** any apply |

Record: timestamp, operator, project ref, `ready_to_apply_*` rows, flag value.

---

## Phase 2 — Apply 197 (authorized separately)

| Step | Action |
|------|--------|
| A1 | Apply `197_fix_operational_pin_module_station_type.sql` (one transaction) |
| A2 | Run `197_test_operational_pin_module_station_type.sql` → `failed_total = 0` |
| A3 | Run `diagnose_operational_pin_module_station_type_postflight_197.sql` |

---

## Phase 3 — Apply 198 (authorized separately)

| Step | Action |
|------|--------|
| B1 | Re-run `diagnose_operational_station_pos_preflight_198.sql` |
| B2 | Apply `198_operational_station_pos_shared_foundation.sql` (single BEGIN/COMMIT) |
| B3 | Run `198_test_operational_station_pos_shared.sql` → `failed_total = 0` |
| B4 | Run `198_test_station_pos_pricing_fixtures.sql` → `failed_total = 0` |
| B5 | Run `diagnose_operational_station_pos_postflight_198.sql` |
| B6 | Verify `operational_station_pos_enabled` still **false** |

**Not in this phase:** destructive rollback, improvised DROP, flag ON.

---

## Phase 4 — Controlled smoke (authorized separately)

Only after Phase 3 postflight green:

- One POS **test** station + device (enrollment runbook OS1).
- One **test** mesero: PIN + assignment (RRHH).
- Optional: set flag **true on staging only** with product sign-off.
- Smoke: PIN → plano → mesa → pizza (tamaño/modifiers) → producción → cuenta → enviar a caja — **no cobro**.

---

## Phase 5 — Merge / production (separate authorizations)

- Merge PR #13: **not** authorized by this document.
- Production SQL / flag: **not** authorized by this document.

---

## Local lab parity (already executed)

| Check | Result |
|-------|--------|
| PG 18.4 embedded lab | 197+198 apply |
| test_197 | 6/6 |
| test_198 | 44/44 |
| pricing fixtures | 5/5 |
| concurrency A/B/C ×10 | passed |
| atomicity 198 | passed |
| Client idempotency | RFC UUID (`stationPosIdempotency.js`) |

**Pre-staging risk:** repeat Phase 2–3 on host PG **major version** (documented target PG 16) before treating staging as equivalent to local PG 18.4.
