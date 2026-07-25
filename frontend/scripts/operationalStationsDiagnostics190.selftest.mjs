/**
 * Static checks for OS1 preflight/postflight diagnose SQL (read-only).
 * Run: node frontend/scripts/operationalStationsDiagnostics190.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

function load(rel) {
  return readFileSync(resolve(root, rel), "utf8")
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
}

const forbidden = [
  "CREATE FUNCTION",
  "CREATE OR REPLACE FUNCTION",
  "CREATE TABLE",
  "CREATE VIEW",
  "DROP ",
  "GRANT ",
  "REVOKE ",
  "INSERT ",
  "UPDATE ",
  "DELETE ",
  "DO $$"
]

function assertReadOnly(name, sql) {
  const executable = stripComments(sql).trim()
  if (!executable.endsWith(";")) throw new Error(`${name}: must end with semicolon`)
  const withoutStrings = executable.replace(/'([^']|'')*'/g, "''")
  const semicolons = (withoutStrings.match(/;/g) || []).length
  if (semicolons !== 1) throw new Error(`${name}: expected one statement, found ${semicolons}`)
  for (const word of forbidden) {
    if (executable.toUpperCase().includes(word.toUpperCase())) {
      throw new Error(`${name}: forbidden ${word.trim()}`)
    }
  }
  if (/\bauth\.users\b/i.test(executable)) throw new Error(`${name}: must not reference auth.users`)
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(executable)) throw new Error(`${name}: must not include emails`)
  const selects = (executable.match(/\bselect\b/gi) || []).length
  if (selects < 1) throw new Error(`${name}: expected SELECT`)
}

const preflight = load("supabase/schema/diagnose_operational_stations_preflight_190.sql")
const postflight = load("supabase/schema/diagnose_operational_stations_postflight_190.sql")

const tests = [
  {
    name: "preflight read-only single statement",
    run() {
      assertReadOnly("preflight", preflight)
    }
  },
  {
    name: "postflight read-only single statement",
    run() {
      assertReadOnly("postflight", postflight)
    }
  },
  {
    name: "preflight detects partial OS1 and baseline counts",
    run() {
      for (const token of [
        "os1_any_partial_object",
        "ready_to_apply_190",
        "baseline_counts",
        "profiles_active",
        "pos_orders"
      ]) {
        if (!preflight.includes(token)) throw new Error(`missing ${token}`)
      }
    }
  },
  {
    name: "postflight validates RLS index grants and zero counts",
    run() {
      for (const token of [
        "rls_all_true",
        "initial_os1_counts",
        "one_active_index",
        "core_functions_present",
        "finalize_authenticated_denied",
        "flag_enabled"
      ]) {
        if (!postflight.includes(token)) throw new Error(`missing ${token}`)
      }
    }
  },
  {
    name: "diagnose scripts export one snapshot row",
    run() {
      if (!/^select 'preflight_os1'/m.test(preflight)) throw new Error("preflight snapshot label")
      if (!/^select 'postflight_os1'/m.test(postflight)) throw new Error("postflight snapshot label")
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
