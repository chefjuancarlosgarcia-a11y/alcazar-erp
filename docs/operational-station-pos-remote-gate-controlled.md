# Station POS 197/198 — controlled remote gate

**PR:** [#13](https://github.com/chefjuancarlosgarcia-a11y/alcazar-erp/pull/13) (Draft until Ready/Merge authorized separately).

**Flag (remote, current):** `operational_station_pos_enabled` = **false** — must stay false through merge, deploy verification, and until explicit smoke authorization.

Local reproducible evidence lives under `.local-backup/pg-lab/evidence/` (not in Git). Keep until the full gate (including smoke) closes.

---

## Remote execution record — **COMPLETED** (read-only from here)

These steps were executed on the **remote** database. **Do not repeat** them on that environment.

| Item | Status | Evidence |
|------|--------|----------|
| Backup before SQL apply | **Done** | Confirmed before 197/198 apply (operator record) |
| Preflight / read-only gate (R1–R3) | **Done** | Blockers green prior to apply |
| Apply **197** | **Done** | `197_fix_operational_pin_module_station_type.sql` |
| Test **197** | **Done** | **6/6** (`197_test_operational_pin_module_station_type.sql`) |
| Postflight **197** | **Done** | `diagnose_operational_pin_module_station_type_postflight_197.sql` |
| Apply **198** | **Done** | `198_operational_station_pos_shared_foundation.sql` (single transaction) |
| Test **198** | **Done** | **44/44** (`198_test_operational_station_pos_shared.sql`) |
| Postflight **198** | **Done** | **22 wrappers** (`diagnose_operational_station_pos_postflight_198.sql`) |
| Flag after 198 | **Done** | Still **false** (`operational_station_pos_enabled`) |

### Prohibición explícita — no reaplicar 197 ni 198

On any host where the row above is already true:

- **Do not** re-execute `supabase/schema/197_fix_operational_pin_module_station_type.sql`.
- **Do not** re-execute `supabase/schema/198_operational_station_pos_shared_foundation.sql`.
- **Do not** use rollback scripts for “refresh” on live staging/production without a separate disaster-recovery authorization.

Allowed follow-up on remote: **read-only** diagnose/preflight/postflight scripts to audit **drift** vs repo SHAs (`7ecb4b7` migrations in PR #13). Failed drift → fix-forward migration, not blind reapply.

---

## Pending — requires separate authorization (not done by this doc)

| Step | Description |
|------|-------------|
| **Merge** | Merge PR #13 into `main` (Ready + merge explicitly authorized) |
| **Deploy** | Production/staging deploy of **frontend from `main`** (Vercel after merge) |
| **Verification** | Post-deploy check: `/station/pos`, station device context, RPC errors absent; flag still **false** in DB |
| **Flag** | Set `operational_station_pos_enabled` true only with product sign-off (staging first) |
| **Smoke** | Controlled smoke: PIN → plano → mesa → pizza (tamaño/modifiers) → producción → cuenta → caja — **no cobro** |

Nothing in this section auto-merges, deploys, enables the flag, or runs smoke.

---

## Phase 0 — PR review (no database)

- [x] Review full diff on PR #13 (33 files, +6152 / −15 vs `main` at review time).
- [x] Commit `7ecb4b7`: SQL 197/198, tests, diagnose, rollback, docs, local Docker script only.
- [x] Commit `cb47fd9`: frontend `/station/pos`, facade/port, UUID idempotency, selftests.
- [x] Commit `3b1bbcd`: remote gate checklist (this file, initial).
- [x] Confirm no `.local-backup/`, `.pr-13-body.md`, secrets, or lab runners in the PR file list.
- [x] Vercel checks green on PR head.

**198 review map:** `supabase/schema/parts/198_README.md` (sections A–I, single transaction).

---

## Phase 1 — Read-only on staging — **COMPLETED on remote**

Historical gate (already satisfied on remote before apply):

| Step | Script | Result on remote |
|------|--------|------------------|
| R1 | `diagnose_operational_pin_module_station_type_preflight_197.sql` | Passed / ready |
| R2 | `diagnose_operational_station_pos_preflight_198.sql` | Passed; flag not enabled |
| R3 | Confirm backup | **Completed** before apply |

**Do not re-run Phase 1 as a prelude to reapply** — use read-only drift checks only if needed.

---

## Phase 2 — Apply 197 — **COMPLETED on remote — DO NOT REAPPLY**

| Step | Action | Remote |
|------|--------|--------|
| A1 | Apply `197_fix_operational_pin_module_station_type.sql` | **Done** |
| A2 | Run `197_test_operational_pin_module_station_type.sql` | **6/6** |
| A3 | Run `diagnose_operational_pin_module_station_type_postflight_197.sql` | **Done** |

---

## Phase 3 — Apply 198 — **COMPLETED on remote — DO NOT REAPPLY**

| Step | Action | Remote |
|------|--------|--------|
| B1 | Re-run preflight 198 (before apply) | **Done** |
| B2 | Apply `198_operational_station_pos_shared_foundation.sql` | **Done** |
| B3 | Run `198_test_operational_station_pos_shared.sql` | **44/44** |
| B4 | Run `198_test_station_pos_pricing_fixtures.sql` | Executed per remote gate |
| B5 | Run `diagnose_operational_station_pos_postflight_198.sql` | **22 wrappers** |
| B6 | Verify flag still **false** | **Confirmed false** |

**Not applicable now:** destructive rollback, improvised DROP, flag ON during SQL phase.

---

## Phase 4 — Controlled smoke — **PENDING**

Only after **merge + deploy + verification** and explicit flag authorization:

- One POS **test** station + device (enrollment runbook OS1).
- One **test** mesero: PIN + assignment (RRHH).
- Optional: set flag **true on staging only** with product sign-off.
- Smoke: PIN → plano → mesa → pizza (tamaño/modifiers) → producción → cuenta → enviar a caja — **no cobro**.

---

## Phase 5 — Merge / production — **PENDING**

- Merge PR #13: **pending** explicit authorization.
- Deploy frontend from `main`: **pending** after merge.
- Production/staging flag ON: **pending** smoke gate.

---

## Local lab parity (developer reference)

| Check | Result |
|-------|--------|
| PG 18.4 embedded lab | 197+198 apply |
| test_197 | 6/6 |
| test_198 | 44/44 |
| pricing fixtures | 5/5 |
| concurrency A/B/C ×10 | passed |
| atomicity 198 | passed |
| Client idempotency | RFC UUID (`stationPosIdempotency.js`) |

**Note:** Local lab validates repo migrations; remote already applied — parity checks are drift audits, not reapply triggers.

**Pre-staging risk (historical):** repeat Phase 2–3 on host PG **major version** mismatch — remote apply already completed; document retained for other environments only.
