/**
 * Offline static regression for 192_test_operational_station_device_function_permissions.sql
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = readFileSync(
  resolve(root, "supabase/schema/192_test_operational_station_device_function_permissions.sql"),
  "utf8"
)
const mig192 = readFileSync(
  resolve(root, "supabase/schema/192_operational_station_device_function_permissions.sql"),
  "utf8"
)

const tests = [
  {
    name: "192 migration is ACL-only begin/commit",
    run() {
      if (!/^begin;/im.test(mig192)) throw new Error("192 missing BEGIN")
      if (!/^commit;/im.test(mig192)) throw new Error("192 missing COMMIT")
      if (/^(insert|update|delete|drop|create table)/im.test(mig192)) {
        throw new Error("192 must not mutate data or DDL tables")
      }
      if (!/revoke execute on function public\.get_operational_station_device_context\(\)/i.test(mig192)) {
        throw new Error("192 must revoke device context from service_role")
      }
      if (!/revoke execute on function public\.touch_operational_station_device_seen\(text\)/i.test(mig192)) {
        throw new Error("192 must revoke touch_seen from service_role")
      }
    }
  },
  {
    name: "192 test SQL BEGIN ROLLBACK summary",
    run() {
      if (!/^begin;/im.test(testSql)) throw new Error("missing BEGIN")
      if (!/^rollback;/im.test(testSql)) throw new Error("missing ROLLBACK")
      for (const col of ["scenario", "passed", "detail", "total", "passed_total", "failed_total"]) {
        if (!testSql.includes(col)) throw new Error(`missing ${col}`)
      }
    }
  },
  {
    name: "192 test checks device service_role and matrix",
    run() {
      for (const token of [
        "device_context_service_role_denied",
        "touch_seen_service_role_denied",
        "acl_diagnostic_matrix_all_match",
        "inventory_twenty_os1_functions",
        "edge_claim_service_role_still_allowed"
      ]) {
        if (!testSql.includes(token)) throw new Error(`missing scenario ${token}`)
      }
      if (!/has_function_privilege\('service_role',\s*v_ctx_oid/i.test(testSql)) {
        throw new Error("must use oid for privilege checks")
      }
    }
  }
]

let passed = 0
for (const test of tests) {
  try {
    test.run()
    passed += 1
    console.log(`OK ${test.name}`)
  } catch (error) {
    console.error(`FAIL ${test.name}: ${error.message}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${tests.length} passed`)
