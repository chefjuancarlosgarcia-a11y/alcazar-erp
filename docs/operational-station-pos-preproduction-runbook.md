# Operational station POS — preproduction runbook (future)

**Do not execute remotely until authorized.** Flag defaults false. **No SQL remoto** until staging postflight passes.

## Gates A–T (manual checklist)

| Gate | Action | Pass criteria |
|------|--------|---------------|
| A | Backup | Staging DB backup confirmed before any apply |
| B | Commit/PR | Exact SHA and Draft PR reviewed |
| C | Preflight 197 | `ready_to_apply_197` true |
| D | Apply 197 | Single migration, no errors |
| E | Test/postflight 197 | `197_test_*` failed_total=0; postflight blockers green |
| F | Preflight 198 | `ready_to_apply_198` true |
| G | Apply 198 | Single transaction completes |
| H | Test/postflight 198 | Structural test + pricing fixtures + postflight |
| I | Flag | `operational_station_pos_enabled` still false |
| J | Test station | Create POS test station (staging only) |
| K | PIN assignment | Test mesero PIN + assignment |
| L | Enable flag | **Only** with explicit product authorization |
| M | Smoke catalog/plano | Real floor layout RPC |
| N | Smoke order | Draft order, no payment |
| O | Pricing | Pizza size, modifiers, configurable options |
| P | Production/KDS | Send to production smoke |
| Q | Bill → cashier | No split payment |
| R | Idle/replay | Terminal idempotency replay |
| S | Rollback flag | Disable flag if smoke fails |
| T | Evidence | Attach postflight + test output; rollout decision |

Nothing in this document auto-applies SQL.

## Order (staging only)

1. **Preflight 197:** `diagnose_operational_pin_module_station_type_preflight_197.sql`
2. Apply `197_fix_operational_pin_module_station_type.sql`
3. **Postflight 197:** `diagnose_operational_pin_module_station_type_postflight_197.sql`
4. **Preflight 198:** `diagnose_operational_station_pos_preflight_198.sql` (deps OK, wrappers absent)
5. Apply `198_operational_station_pos_shared_foundation.sql` (**single transaction**)
6. **Postflight 198:** `diagnose_operational_station_pos_postflight_198.sql`
7. **Tests:** `198_test_operational_station_pos_shared.sql` (BEGIN/ROLLBACK harness)
8. Deploy frontend with `/station/pos` (flag still false in DB)
9. Enrollment POS station + device (OS1 runbook)
10. RRHH: PIN + assignment (`OperationalAccessSection`)
11. Set `operational_station_pos_enabled` true **only on staging** for smoke
12. Smoke: PIN → plano real → mesa → pizza (tamaño + modifiers) → configurable mitades → producción → cuenta → enviar a caja → re-PIN

## Local PostgreSQL (developer)

This machine may not have `psql`. Use Docker:

```powershell
docker run --name alcazar-pg-test -e POSTGRES_PASSWORD=postgres -p 54329:5432 -d postgres:16
# Restore baseline schema from your usual dump OR apply migrations 001…196 from repo in order
$env:PGPASSWORD="postgres"
docker exec -i alcazar-pg-test psql -U postgres -d postgres -f - < supabase/schema/197_fix_operational_pin_module_station_type.sql
docker exec -i alcazar-pg-test psql -U postgres -d postgres -f - < supabase/schema/198_operational_station_pos_shared_foundation.sql
docker exec -i alcazar-pg-test psql -U postgres -d postgres -f - < supabase/schema/198_test_operational_station_pos_shared.sql
```

Or run: `powershell -File scripts/local-postgres-test-197-198.ps1` (requires Docker + baseline DB).

## Frontend selftests (no DB)

```bash
node frontend/scripts/operationalStationsPosShared.selftest.mjs
node frontend/scripts/operationalStationsOs1.selftest.mjs
node frontend/scripts/operationalStationsOs2.selftest.mjs
node frontend/scripts/operationalStationsOs2Cash.selftest.mjs
node frontend/scripts/stationPinEntryUx.selftest.mjs
npm run build --prefix frontend
```

## Rollback

- **Forward-only:** there is **no** destructive down migration for 197/198. The files under `supabase/rollback/197_*.rollback.sql` and `198_*.rollback.sql` are guidance only (disable flag, forward-fix wrappers). **Do not** run improvised `DROP` on staging or production.
- **Transaction atomicity:** `198_operational_station_pos_shared_foundation.sql` is a single `BEGIN` … `COMMIT`. Any error before `COMMIT` rolls back the entire migration (tables, functions, grants). Local proof: `.local-backup/pg-lab/run-atomicity-fail-198.mjs` applies a lab-only broken copy of 198 that raises before `COMMIT`, then applies the real file and runs postflight.
- **After a successful apply:** recovery from a bad rollout is **flag off** (`operational_station_pos_enabled` / `operational_stations_enabled`) plus a **corrective forward migration**, not a destructive rollback.

## PostgreSQL version (local lab vs target)

- Local embedded lab (`.local-backup/pg-lab`) uses **PostgreSQL 18.4** via `embedded-postgres`.
- This repo has **no** checked-in `supabase/config.toml`; the runbook’s Docker example uses **`postgres:16`**. Treat **PG 16** as the documented pre-staging target until the hosted Supabase project version is confirmed from the dashboard.
- Migrations **197** and **198** were reviewed for PG18-only syntax (e.g. `MERGE`, `JSON_TABLE`); none found. **Risk:** passing tests on PG 18.4 does **not** automatically guarantee identical behavior on the hosted major version — re-run apply + `198_test_*` on the target major before staging.

## Local lab runners (not in commit package)

```powershell
cd .local-backup/pg-lab
npm install
node run-lab.mjs
node run-concurrency.mjs
node run-atomicity-fail-198.mjs
```

Evidence: `.local-backup/pg-lab/evidence/` (gitignored via `.local-backup/` untracked). Do not commit `data/`, `node_modules/`, or logs with secrets.

## Out of scope this phase

Payments, split tender, cash session coupling, supervisor PIN overrides on release.

## Draft PR checklist (after local audit sign-off)

- [ ] All selftests green
- [ ] Postflight 198 on staging DB
- [ ] Audit doc `docs/operational-station-pos-migration-audit-197-198.md` reviewed
- [ ] PR body states flag remains false until product sign-off
- [ ] **Do not** merge without staging smoke

Create draft (when remote allowed): push branch `feat/operational-stations-pos-shared` and `gh pr create --draft`.
