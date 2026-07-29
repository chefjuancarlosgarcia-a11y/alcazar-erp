# Operational station POS shared — technical design (local WIP)

## Executive summary

Shared POS stations reuse **OS2** `operational_operator_sessions` (PIN + opaque token) on top of the **OS1** device JWT. Human `/pos` keeps direct Supabase access; station `/station/pos` must use **SECURITY DEFINER wrappers** only.

**Structural blocker (confirmed in audit):** Human POS RPCs (`open_pos_table_service`, `send_pos_order_to_production`, etc.) authorize via `auth.uid()` and `can_operate_pos_orders()`. The device JWT is **not** a mesero profile. Station wrappers cannot safely delegate to those RPCs; they must re-run business logic with `operator_profile_id` from the bound operator session (194 cash pattern).

## Migration numbering

| File | Purpose |
|------|---------|
| `197_fix_operational_pin_module_station_type.sql` | Map PIN module to `station_type`; POS idle 120s; `absolute_expires_at` column |
| `198_operational_station_pos_shared_foundation.sql` | Flag `operational_station_pos_enabled`, POS idempotency/audit, context + open table wrapper |

Next free number after **196** is **197** (no conflicting `197_*.sql` in repo).

## Session policy (POS)

| Policy | Value |
|--------|--------|
| Idle extension | 120s on confirmed mutations (not reads/replay) |
| Absolute cap | 15 minutes from issuance (`absolute_expires_at`) |
| Storage | `operational_operator_sessions` only (no parallel POS session table) |
| Lock | `station_pos_lock_operator_session` — revokes operator row; **no** `auth.signOut()` |

## Attribution model

| Field | Meaning |
|-------|---------|
| `owner_profile_id` | Mesero responsible for the order (set server-side at open; unchanged by this phase) |
| `actor_profile_id` | Mesero performing each audited action (`operational_station_pos_action_audit`) |
| Terminal | `operational_station_id`, `operational_station_device_id`, `operator_session_id` in audit metadata |

Ranking / sales metrics continue to use **`owner_profile_id`** on `pos_orders`.

## Public wrapper signatures (198)

| RPC | Args (client) |
|-----|----------------|
| `operational_station_pos_enabled()` | none |
| `get_station_pos_context` | `p_operator_session_token text` |
| `open_station_pos_table_service` | token, `p_table_id`, `p_table_name`, `p_area_id`, `p_area_name`, `p_idempotency_key text` |
| `station_pos_lock_operator_session` | token, `p_reason text` |

**Planned (not yet in 198):** `list_station_pos_tables`, `get_station_pos_order`, catalog read, item mutations, production send, bill/cashier send, release table — each with token + idempotency on mutations.

Client must **not** send: `operator_profile_id`, `owner_profile_id`, `waiter_id`, `station_id`, `device_id`, prices, totals, arbitrary status.

## Operation matrix (human vs station)

| Operation | Human FE | Human backend | Station FE | Station backend | JWT technical risk |
|-----------|----------|---------------|------------|-----------------|---------------------|
| Open table service | `posOrdersService.openPosTableService` | RPC `open_pos_table_service` (`auth.uid`) | `stationPosPort.openPosTableService` | `open_station_pos_table_service` | Direct RPC fails RLS/permission |
| Add draft item | `addItemToOrder` | `pos_order_items` INSERT + pricing in FE/SQL | facade → port (WIP) | wrapper TBD | INSERT as device user blocked |
| Send production | `sendOrderToProduction` | `send_pos_order_to_production(uuid)` | **Out of scope UI** | wrapper TBD + lock | Same |
| Split payment | Cashier/POS | `create_pos_split_payment` | **Hidden** | not called | N/A |
| PIN verify | N/A | Edge + `verify_operational_pin_for_device` | `OperationalStationPinGate` module=`pos` | 197 module map | Wrong module rejected |

## Frontend architecture

```
/station/pos → StationDeviceRoute → StationPosEntry
  → flag RPC operational_station_pos_enabled (false → message)
  → OperationalStationPinGate (module pos)
  → posOrdersFacade delegate → createStationPosPort
  → POS.jsx (stationMode) — human imports unchanged via facade default
```

`/pos` human path: facade delegate **null** → human `posOrdersService`.

## Feature flag

- Key: `operational_station_pos_enabled` (default **false**)
- Read: `operational_station_pos_enabled()` RPC (no direct `app_settings` SELECT from FE)
- Does not affect `/pos` human or Caja

## JWT persistence audit (Paso 18)

| Location | Behavior | Risk to device JWT |
|----------|----------|-------------------|
| `AuthContext.logout` | `supabase.auth.signOut({ scope: "local" })` | Only human logout paths |
| `StationCashEntry` / `StationPosEntry` lock | `clearOperatorSession()` sessionStorage only | **Does not** sign out device |
| PR #12 PIN UI | No storage changes | Not root cause of full auth wipe |
| `IdleSessionManager` | Human session | N/A for station routes |

**Finding:** No station code calls `signOut` on operator lock. Full loss of `sb-*-auth-token` likely external (manual clear, browser profile, extension, or explicit logout). **Recommend:** secure breadcrumb event `station:device-session-cleared` without token payload before deploy multi-station.

**Blocker for multi-station rollout:** explain device JWT loss operationally before enrolling many POS terminals.

## Idempotency

- Table: `operational_station_pos_idempotency` (device_id + key PK)
- FE: `stationPosIdempotency.js` → sessionStorage intents (no PIN/token in fingerprint payload)
- Replay completed allowed when operator session terminal-locked (194 cash parity — implement in remaining wrappers)

## Payments (explicitly out)

Station POS must not call `create_pos_split_payment`, cash movements, or open cash sessions. “Enviar a caja” ends operator session (future wrapper + lock).

## ACL principle

- Helpers: REVOKE ALL from PUBLIC, anon, authenticated, service_role
- Public wrappers: GRANT EXECUTE to **authenticated** only (device JWT is authenticated role)

## Remaining work before remote apply

1. Complete SQL wrappers for catalog, items, production, bill, release (inline logic / internal helpers).
2. Wire `stationPosPort` methods to RPCs; remove `stationOnlyError()` stubs.
3. POS.jsx: hide payment/cobro UI when `stationMode` (grep `create_pos_split_payment`, SplitPaymentModal).
4. SQL tests 198 expanded to 25 scenarios (currently static smoke).
5. Edge `verify_pin` touch idle for POS 120s if not already aligned with DB extend.
6. Sync canonical `195` verify body with `197` for greenfield installs (document only; do not reapply 195 remotely).

## Canonical install note

Greenfield installs should apply through **198** after **197**. The body of `verify_operational_pin_for_device` in **195** remains stale until a future consolidation migration; **197** is the forward-fix for production.
