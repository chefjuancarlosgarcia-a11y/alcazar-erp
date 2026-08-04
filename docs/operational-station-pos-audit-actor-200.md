# Station POS audit actor — migration 200 remote gate

**PR:** [#20](https://github.com/chefjuancarlosgarcia-a11y/alcazar-erp/pull/20) (Draft until Ready/Merge authorized separately).

**Branch:** `fix/station-pos-runtime-audit-and-input`

**Flags (remote, current):** `operational_stations_enabled` = **false**, `operational_station_pos_enabled` = **false** — must stay false through merge, deploy, and until explicit smoke authorization.

**Operator:** station operator session **blocked** — no PIN enrollment or live POS operations in this gate.

---

## Root cause — trigger / FK

On `/station/pos`, `audit_pos_order_change()` wrote `auth.uid()` into `pos_order_events.created_by`, which references `public.profiles(id)`.

Since migration **196**, the station device JWT is a **technical identity without a `profiles` row**. When station wrappers insert into `pos_orders` or `pos_order_items`, audit triggers fire and attempt:

```sql
insert into public.pos_order_events (..., created_by)
values (..., auth.uid());  -- technical UUID → FK violation
```

The FK failure is caught by `open_station_pos_table_service` / `add_station_pos_order_item` `WHEN others` handlers and re-raised as generic `P0001` (`Operacion no permitida.`). The frontend then showed nested `message: message: message:` errors and Q0.00 tickets.

**Note:** `service_opened` events inserted manually by wrappers used `v_operator_id` (correct). Failures occurred on trigger-driven events (`order_created`, `item_added`, etc.).

---

## Why migration 199 lab hid the bug

`199_lab_operational_station_pos_catalog_parity_runtime.sql` creates an active `profiles` row for the lab device auth user (`19900000-…0030`). That masked the production post-196 invariant: **technical device users must not have profiles**.

Migration **200** lab runtime (`200_lab_station_pos_audit_actor_runtime.sql`) explicitly asserts **no profile for the technical user** (scenarios L01/L14).

---

## Actor design (human vs technical)

Migration **200** introduces internal helper `pos_order_event_actor_profile(uuid, uuid, uuid)`:

| Session | Resolution |
|---------|------------|
| Human (`auth.uid()` has active profile) | Use `auth.uid()` |
| Technical station device | Use order `owner_profile_id`, fallback `waiter_id` — validated server-side against `profiles` |
| No valid actor | Raise `STATION_POS_AUDIT_ACTOR_INVALID` — no fake profile, no auto-create |

Security:

- Helper: `SECURITY DEFINER`, empty `search_path`, **REVOKE EXECUTE** from `PUBLIC` / `anon` / `authenticated`
- `audit_pos_order_change()`: same hardening; signatures preserved

Canonical baseline for fresh installs: `supabase/schema/011_fix_pos_order_audit.sql` (aligned with 200).

---

## Remote execution record — **COMPLETED** (read-only from here)

These steps were executed on the **remote** database. **Do not repeat** them on that environment.

| Step | Script / action | Remote result |
|------|-----------------|---------------|
| Preflight 200 | `diagnose_station_pos_audit_actor_preflight_200.sql` | **13/13** gates passed, **0 blockers**, `ready_to_apply_200 = true` |
| Apply **200** (once) | `200_fix_station_pos_audit_actor.sql` | **Done** — single apply only |
| Remote-safe test | `200_test_station_pos_audit_actor.sql` | **12/12**, `failed_total = 0` |
| Postflight 200 | `diagnose_station_pos_audit_actor_postflight_200.sql` | **12/12**, `ready_after_200 = true` |
| Signatures | `audit_pos_order_change()`, `pos_order_event_actor_profile(uuid, uuid, uuid)` | **Preserved** |
| Helper ACL | `pos_order_event_actor_profile` | **No EXECUTE** for `PUBLIC` / `anon` / `authenticated` |
| SECURITY DEFINER + empty search_path | audit + helper | **Confirmed** on both functions |
| Flags after 200 | app_settings | Still **false / false** |
| Operator | station session | **Blocked** — no smoke, no real orders |

Local reproducible evidence: `scripts/run-station-pos-audit-lab-200.mjs` → `.local-backup/pg-lab/evidence/audit-200/` (not in Git).

### Prohibición explícita — no reaplicar 197, 198, 199 ni 200

On any host where the table above is already true:

- **Do not** re-execute `197_fix_operational_pin_module_station_type.sql`
- **Do not** re-execute `198_operational_station_pos_shared_foundation.sql`
- **Do not** re-execute `199_fix_operational_station_pos_catalog_parity.sql`
- **Do not** re-execute `200_fix_station_pos_audit_actor.sql`
- **Do not** use rollback scripts for “refresh” on live staging/production without separate disaster-recovery authorization

Allowed follow-up on remote: **read-only** preflight/postflight/drift checks. Failed drift → fix-forward migration, not blind reapply.

---

## Local evidence (repo / lab)

| Suite | Result |
|-------|--------|
| Lab PostgreSQL 200 | 15/15 PASS |
| `200_test` structural (BEGIN/ROLLBACK) | 12/12 PASS |
| `operationalStations200AuditActor.selftest.mjs` | 16/16 PASS |
| `normalizeStationPosError.selftest.mjs` | 4/4 PASS |
| `operationalStationsPosShared.selftest.mjs` | 72/72 PASS |
| OS1 / OS2 / OS2 Caja / PIN UX / POS 187 | PASS |
| `npm run build` | PASS |

Related SQL artifacts:

- `supabase/schema/200_fix_station_pos_audit_actor.sql`
- `supabase/schema/200_test_station_pos_audit_actor.sql`
- `supabase/schema/200_lab_station_pos_audit_actor_runtime.sql`
- `supabase/schema/diagnose_station_pos_audit_actor_preflight_200.sql`
- `supabase/schema/diagnose_station_pos_audit_actor_postflight_200.sql`
- `supabase/rollback/200_fix_station_pos_audit_actor.rollback.sql`

Frontend (PR #20, no additional SQL in doc commit):

- `normalizeStationPosError.js` — idempotent error display
- Station scroll/input mitigations — **not closed** without physical QA

---

## Pending — requires separate authorization

| Item | Status | Notes |
|------|--------|-------|
| PR review / Ready / merge | **Open** | PR #20 remains **Draft** |
| Deploy `main` | **Pending** | After authorized merge |
| QA físico scroll | **Pending** | 1366×768, zoom 125%/150% on station PC |
| Bug buscador “3” | **Pending** | Classify scenario A vs E with DEV probe on station hardware — **not declared fixed** |
| Smoke open+add | **Pending** | Controlled: mesa → producto → ticket — **no cocina, inventario, pagos** |
| Enable flags | **Pending** | Only with product sign-off after smoke |
| Unblock operator | **Pending** | Separate authorization |

Nothing in this section auto-merges, deploys, enables flags, unblocks the operator, or runs smoke.

---

## Gate checklist

- [x] Preflight remoto 200 — 13/13, `ready_to_apply_200 = true`
- [x] Aplicar únicamente migración 200 (una vez)
- [x] Test remoto seguro — 12/12, `failed_total = 0`
- [x] Postflight remoto — 12/12, `ready_after_200 = true`
- [ ] Revisión final PR #20
- [ ] Ready y merge
- [ ] Deploy main
- [ ] QA físico scroll y bug “3”
- [ ] Smoke controlado open+add (sin cocina/inventario/pagos)

---

## Cross-references

- Station POS shared design: `docs/operational-station-pos-shared-design.md`
- 197/198 remote gate: `docs/operational-station-pos-remote-gate-controlled.md`
- 199 parity audit: `docs/station-pos-human-parity-audit.md`
- Preproduction runbook: `docs/operational-station-pos-preproduction-runbook.md`
