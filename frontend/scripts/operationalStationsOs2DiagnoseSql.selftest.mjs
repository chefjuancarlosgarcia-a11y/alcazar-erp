import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const preflight193 = read("supabase/schema/diagnose_operational_operator_access_preflight_193.sql")
const postflight193 = read("supabase/schema/diagnose_operational_operator_access_postflight_193.sql")
const preflight194 = read("supabase/schema/diagnose_station_cash_preflight_194.sql")
const postflight194 = read("supabase/schema/diagnose_station_cash_postflight_194.sql")

const os2FnPattern =
  /has_function_privilege\s*\(\s*'[^']+'\s*,\s*'public\.(?:resolve_operational|verify_operational|operational_pin|get_station_cash|station_cash|lock_operational|touch_operational)/

const tests = [
  {
    name: "DIAG-PREF193 no hard regprocedure on 193-only functions",
    run() {
      if (os2FnPattern.test(preflight193)) {
        throw new Error("preflight 193 must not use string has_function_privilege on 193/194 RPCs")
      }
      if (/resolve_operational_device_for_auth_user\(\)'::regprocedure/i.test(preflight193)) {
        throw new Error("no ::regprocedure cast on resolve helper")
      }
    }
  },
  {
    name: "DIAG-PREF193 uses to_regprocedure for OS1 ACL",
    run() {
      if (!preflight193.includes("to_regprocedure('public.get_operational_station_device_context()')")) {
        throw new Error("device context via to_regprocedure")
      }
      if (!preflight193.includes("to_regprocedure('public.resolve_operational_device_for_auth_user()')")) {
        throw new Error("resolve absence via to_regprocedure")
      }
    }
  },
  {
    name: "DIAG-PREF193 inventory gates",
    run() {
      for (const g of ["functions_193_missing", "objects_193_partial", "ready_to_apply_193"]) {
        if (!preflight193.includes(g)) throw new Error(`missing gate ${g}`)
      }
    }
  },
  {
    name: "DIAG-PREF193 no ::regclass on absent OS2 tables",
    run() {
      if (/'public\.operational_[^']+'::regclass/i.test(preflight193)) {
        throw new Error("no ::regclass on operational tables in preflight 193")
      }
    }
  },
  {
    name: "DIAG-POST193 fn CTE uses to_regprocedure",
    run() {
      if (!postflight193.includes("to_regprocedure('public.verify_operational_pin_for_device(text, text, text)')")) {
        throw new Error("postflight 193 OID-safe ACL")
      }
      if (!postflight193.includes("to_regclass('public.operational_security_secrets')")) {
        throw new Error("secrets table via to_regclass")
      }
    }
  },
  {
    name: "DIAG-POST194 fn CTE uses to_regprocedure",
    run() {
      if (!postflight194.includes("to_regprocedure('public.get_station_cash_context(text)')")) {
        throw new Error("postflight 194 OID-safe ACL")
      }
      if (os2FnPattern.test(postflight194)) {
        throw new Error("postflight 194 should use fn CTE oids not string signatures")
      }
    }
  },
  {
    name: "DIAG-PREF194 safe without 194 applied",
    run() {
      if (os2FnPattern.test(preflight194)) {
        throw new Error("preflight 194 must not string-check 194 RPC privileges")
      }
    }
  },
  {
    name: "DIAG all single SELECT export",
    run() {
      for (const [name, sql] of [
        ["preflight193", preflight193],
        ["postflight193", postflight193],
        ["preflight194", preflight194],
        ["postflight194", postflight194]
      ]) {
        if (!/select\s+gate_code,\s*is_blocker,\s*detail/im.test(sql)) {
          throw new Error(`${name}: expected gate_code/is_blocker/detail result set`)
        }
        if (/^\s*(insert|update|delete|create|drop|alter)\s/im.test(sql.replace(/--[^\n]*/g, ""))) {
          throw new Error(`${name}: must be read-only`)
        }
      }
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed++
    console.log(`OK ${t.name}`)
  } catch (e) {
    console.error(`FAIL ${t.name}: ${e.message}`)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
