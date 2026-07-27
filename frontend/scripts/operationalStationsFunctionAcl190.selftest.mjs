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

const os1FunctionNames = [
  "operational_stations_enabled",
  "is_operational_stations_admin",
  "log_operational_station_event",
  "provision_operational_station",
  "update_operational_station",
  "create_station_enrollment_token",
  "record_operational_enrollment_secret_attempt",
  "verify_operational_device_claim_secret",
  "claim_station_enrollment",
  "authorize_station_device_enrollment",
  "reject_and_block_station_device",
  "get_device_enrollment_status",
  "finalize_station_device_enrollment",
  "fail_station_device_enrollment",
  "revoke_station_device",
  "replace_station_device",
  "list_operational_stations_admin",
  "list_operational_station_devices_admin",
  "get_operational_station_device_context",
  "touch_operational_station_device_seen"
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
      const selects = (executable.match(/\bselect\b/gi) || []).length
      if (selects < 2) throw new Error("expected CTE + final SELECT only")
    }
  },
  {
    name: "ACL diagnose uses pg_proc oid for has_function_privilege",
    run() {
      if (!/has_function_privilege\('anon',\s*f\.oid,\s*'EXECUTE'\)/.test(sql)) {
        throw new Error("anon must use f.oid")
      }
      if (!/has_function_privilege\('authenticated',\s*f\.oid,\s*'EXECUTE'\)/.test(sql)) {
        throw new Error("authenticated must use f.oid")
      }
      if (!/has_function_privilege\('service_role',\s*f\.oid,\s*'EXECUTE'\)/.test(sql)) {
        throw new Error("service_role must use f.oid")
      }
    }
  },
  {
    name: "ACL diagnose forbids regprocedure privilege reconstruction",
    run() {
      if (/::regprocedure/.test(sql)) throw new Error("must not cast to regprocedure")
      if (/to_regprocedure/i.test(sql)) throw new Error("must not use to_regprocedure")
      if (/has_function_privilege\([^)]*format\s*\(/i.test(sql)) {
        throw new Error("must not build function identity via format for privileges")
      }
      if (/has_function_privilege\s*\(\s*'public'/i.test(sql)) {
        throw new Error("must not use has_function_privilege for PUBLIC")
      }
    }
  },
  {
    name: "ACL diagnose uses proacl_raw and owner_oid for aclexplode",
    run() {
      if (!/p\.proacl as proacl_raw/i.test(sql)) throw new Error("missing proacl_raw")
      if (!/p\.proowner as owner_oid/i.test(sql)) throw new Error("missing owner_oid")
      if (!/acldefault\('f',\s*f\.owner_oid\)/.test(sql)) {
        throw new Error("acldefault must use owner_oid")
      }
      if (!/coalesce\(\s*f\.proacl_raw,\s*acldefault\('f',\s*f\.owner_oid\)\s*\)/.test(sql)) {
        throw new Error("aclexplode coalesce must use proacl_raw + acldefault")
      }
    }
  },
  {
    name: "ACL diagnose forbids coalesce on textual proacl for aclexplode",
    run() {
      if (/aclexplode\(coalesce\(f\.proacl,/.test(sql)) {
        throw new Error("must not coalesce textual proacl in aclexplode")
      }
    }
  },
  {
    name: "ACL diagnose uses aclexplode for PUBLIC",
    run() {
      if (!/aclexplode/.test(sql)) throw new Error("missing aclexplode")
      if (!/a\.grantee = 0/.test(sql)) throw new Error("missing PUBLIC grantee OID 0")
      if (!/privilege_type = 'EXECUTE'/.test(sql)) throw new Error("missing EXECUTE filter")
    }
  },
  {
    name: "ACL diagnose exports expected columns",
    run() {
      for (const col of [
        "function_signature",
        "proacl",
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
    name: "ACL diagnose lists exactly twenty OS1 functions",
    run() {
      for (const fn of os1FunctionNames) {
        if (!sql.includes(`'${fn}'`)) throw new Error(`missing function ${fn}`)
      }
      const inList = sql.match(/and p\.proname in \(\s*([\s\S]*?)\s*\)/i)
      if (!inList) throw new Error("missing proname in list")
      const names = [...inList[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
      if (names.length !== 20) throw new Error(`expected 20 names in inventory, found ${names.length}`)
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
