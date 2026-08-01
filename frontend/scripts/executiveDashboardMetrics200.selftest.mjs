/**
 * Static regression for 200 executive dashboard RPC SQL (A2.1b).
 * Run: node frontend/scripts/executiveDashboardMetrics200.selftest.mjs
 */
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const mig = readFileSync(resolve(root, "supabase/schema/200_get_executive_dashboard_metrics.sql"), "utf8")
const testSql = readFileSync(resolve(root, "supabase/schema/200_test_get_executive_dashboard_metrics.sql"), "utf8")

function assert(label, condition) {
  if (!condition) {
    console.error("FAIL:", label)
    process.exitCode = 1
    return
  }
  console.log("OK:", label)
}

assert("migration defines RPC", /get_executive_dashboard_metrics/i.test(mig))
assert("migration security invoker on main RPC", /get_executive_dashboard_metrics[\s\S]*security invoker/i.test(mig))
assert("migration uses America/Guatemala", /America\/Guatemala/.test(mig))
assert("migration settled uses paid_at filter", /o\.paid_at >= v_day_cur_s/i.test(mig))
assert("migration excludes cancelled via paid status", /o\.status = 'paid'/i.test(mig))
assert("migration partial_open snapshot", /partial_open/i.test(mig) && /executive_partial_open_snapshot/i.test(mig))
assert("migration no partial_collections", !/partial_collections/i.test(mig))
assert("migration no payments executive RLS", !/pos_order_payments_executive_read/i.test(mig))
assert("migration data_quality paid_without_paid_at", /paid_without_paid_at/i.test(mig))
assert("migration single settled scan", /v_min_settled/i.test(mig))
assert("migration apply after 199", /199_fix_operational_station_pos_catalog_parity/i.test(mig))
assert("migration no materialized view", !/materialized view/i.test(mig))
assert("test uses BEGIN ROLLBACK", /^begin;/im.test(testSql) && /^rollback;/im.test(testSql))
assert("test no COMMIT", !/^commit;/im.test(testSql))
assert("test partial_open", /partial_open_snapshot/i.test(testSql))
assert("test no double count", /no_double_count_settled_vs_partial_open/i.test(testSql))
assert("test security mesero", /security_mesero_denied/i.test(testSql))
assert("test operational cutoff", /operational_day_cutoff_0400/i.test(testSql))

if (process.exitCode) {
  console.error("\nSome static tests failed.")
  process.exit(1)
}
console.log("\nAll executiveDashboardMetrics200 static tests passed.")
