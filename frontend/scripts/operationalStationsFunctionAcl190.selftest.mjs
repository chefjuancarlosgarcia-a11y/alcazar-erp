/**
 * Static checks for diagnose_operational_stations_function_acl_190.sql
 * Run: node frontend/scripts/operationalStationsFunctionAcl190.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const sql = readFileSync(
  resolve(root, "supabase/schema/diagnose_operational_stations_function_acl_190.sql"),
  "utf8"
)

function stripComments(source) {
  return source.replace(/--[^\n]*/g, "")
}

const executable = stripComments(sql).trim()

const expectedFunctions = [
  "claim_station_enrollment",
  "finalize_station_device_enrollment",
  "log_operational_station_event",
  "get_operational_station_device_context",
  "provision_operational_station"
]

const forbidden = ["INSERT ", "UPDATE ", "DELETE ", "CREATE ", "DROP ", "GRANT ", "REVOKE ", "DO $$"]

const tests = [
  {
    name: "ACL diagnose is read-only single statement",
    run() {
      if (!executable.endsWith(";")) throw new Error("must end with semicolon")
      const semis = (executable.replace(/'([^']|'')*'/g, "''").match(/;/g) || []).length
      if (semis !== 1) throw new Error(`expected 1 statement, found ${semis}`)
      for (const word of forbidden) {
        if (executable.toUpperCase().includes(word)) throw new Error(`forbidden ${word}`)
      }
    }
  },
  {
    name: "ACL diagnose uses aclexplode for PUBLIC",
    run() {
      if (!/aclexplode/.test(sql)) throw new Error("missing aclexplode")
      if (!/a\.grantee = 0/.test(sql)) throw new Error("missing PUBLIC grantee OID 0")
    }
  },
  {
    name: "ACL diagnose exports expected columns",
    run() {
      for (const col of [
        "function_signature",
        "public_execute",
        "anon_execute",
        "authenticated_execute",
        "service_role_execute",
        "expected_access",
        "acl_matches_expected"
      ]) {
        if (!sql.includes(col)) throw new Error(`missing column ${col}`)
      }
    }
  },
  {
    name: "ACL diagnose covers twenty OS1 function names",
    run() {
      const listed = (sql.match(/'[a-z_]+'/g) || []).filter((s) => s.includes("operational") || s.includes("station"))
      if (listed.length < 20) throw new Error("expected 20+ function name literals")
      for (const fn of expectedFunctions) {
        if (!sql.includes(fn)) throw new Error(`missing ${fn}`)
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
