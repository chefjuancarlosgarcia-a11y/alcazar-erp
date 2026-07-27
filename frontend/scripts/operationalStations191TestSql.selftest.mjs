/**
 * Offline static regression for 191_test_operational_stations_function_permissions.sql
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = readFileSync(
  resolve(root, "supabase/schema/191_test_operational_stations_function_permissions.sql"),
  "utf8"
)

const tests = [
  {
    name: "191 test SQL uses BEGIN and ROLLBACK without COMMIT",
    run() {
      if (!/^begin;/im.test(testSql)) throw new Error("missing BEGIN")
      if (!/^rollback;/im.test(testSql)) throw new Error("missing ROLLBACK")
      if (/^commit;/im.test(testSql)) throw new Error("must not COMMIT")
    }
  },
  {
    name: "191 test invokes permission test function once",
    run() {
      const calls = (
        testSql.match(/from\s+public\.test_operational_stations_function_permissions_191\s*\(\s*\)/gi) || []
      ).length
      if (calls !== 1) throw new Error(`expected 1 invocation, found ${calls}`)
    }
  },
  {
    name: "191 test materialized summary columns",
    run() {
      for (const col of ["scenario", "passed", "detail", "total", "passed_total", "failed_total"]) {
        if (!testSql.includes(col)) throw new Error(`missing ${col}`)
      }
    }
  },
  {
    name: "191 migration revokes service_role on device RPCs",
    run() {
      const mig191 = readFileSync(
        resolve(root, "supabase/schema/191_operational_stations_function_permissions.sql"),
        "utf8"
      )
      if (!/revoke execute on function public\.get_operational_station_device_context\(\)\s*\n\s*from service_role/i.test(mig191)) {
        throw new Error("191 canonical must revoke device context from service_role")
      }
    }
  },
  {
    name: "191 test ACL checks use pg_proc oid not regprocedure",
    run() {
      if (/format\('public\.%I\(%s\)',\s*p\.proname,\s*pg_get_function_identity_arguments/.test(testSql)) {
        throw new Error("must not build regprocedure from identity arguments")
      }
      if (/::regprocedure/.test(testSql)) {
        throw new Error("191 test must not use regprocedure for ACL checks")
      }
      if (/has_function_privilege\([^)]*'public\./.test(testSql)) {
        throw new Error("has_function_privilege must not use string signatures")
      }
      if (!/has_function_privilege\('anon',\s*p\.oid,\s*'EXECUTE'\)/.test(testSql)) {
        throw new Error("matrix must use has_function_privilege with p.oid")
      }
    }
  },
  {
    name: "191 test uses aclexplode for PUBLIC",
    run() {
      if (!/aclexplode/.test(testSql)) throw new Error("missing aclexplode")
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
