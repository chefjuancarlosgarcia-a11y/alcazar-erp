/**
 * Offline static regression for 190_test_operational_stations_foundation.sql
 * Run: node frontend/scripts/operationalStations190TestSql.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = readFileSync(
  resolve(root, "supabase/schema/190_test_operational_stations_foundation.sql"),
  "utf8"
)

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length
}

const scenarioMatches = [
  ...testSql.matchAll(/return query\s+select\s+'([a-z0-9_]+)'::text/gi)
]

const tests = [
  {
    name: "190 test SQL uses BEGIN and ROLLBACK",
    run() {
      if (!/^begin;/im.test(testSql)) throw new Error("missing BEGIN")
      if (!/^rollback;/im.test(testSql)) throw new Error("missing ROLLBACK")
      if (countMatches(testSql, /^commit;/gim) !== 0) throw new Error("must not COMMIT")
    }
  },
  {
    name: "190 test SQL invokes test function exactly once",
    run() {
      const calls = countMatches(
        testSql,
        /from\s+public\.test_operational_stations_foundation_190\s*\(\s*\)/gi
      )
      if (calls !== 1) throw new Error(`expected 1 invocation, found ${calls}`)
    }
  },
  {
    name: "190 test SQL materializes single result set with summary columns",
    run() {
      if (!/with results as materialized/i.test(testSql)) {
        throw new Error("missing materialized results CTE")
      }
      for (const col of ["scenario", "passed", "detail", "total", "passed_total", "failed_total"]) {
        if (!new RegExp(`\\b${col}\\b`).test(testSql)) {
          throw new Error(`missing output column ${col}`)
        }
      }
      if (!/order by r\.passed asc,\s*r\.scenario/i.test(testSql)) {
        throw new Error("missing failed-first ordering")
      }
    }
  },
  {
    name: "190 test SQL drops ephemeral test function before rollback",
    run() {
      if (
        !/drop function if exists public\.test_operational_stations_foundation_190\(\)/i.test(testSql)
      ) {
        throw new Error("missing DROP FUNCTION cleanup")
      }
      const dropPos = testSql.search(/drop function if exists public\.test_operational_stations_foundation_190/i)
      const rollbackPos = testSql.search(/^rollback;/im)
      if (dropPos < 0 || rollbackPos < 0 || dropPos >= rollbackPos) {
        throw new Error("DROP FUNCTION must precede ROLLBACK")
      }
    }
  },
  {
    name: "190 test SQL does not insert auth.users",
    run() {
      const withoutComments = testSql.replace(/--[^\n]*/g, "")
      if (/auth\.users/i.test(withoutComments)) throw new Error("must not touch auth.users")
    }
  },
  {
    name: "190 test SQL uses isolated random fixtures",
    run() {
      if (!/gen_random_uuid\(\)/.test(testSql)) throw new Error("missing gen_random_uuid fixtures")
      if (/4e6ba009|@stations\.internal|chefjuancarlos/i.test(testSql)) {
        throw new Error("must not embed real identifiers")
      }
    }
  },
  {
    name: "190 test SQL includes permission and unique active checks",
    run() {
      for (const token of [
        "perm_public_no_claim_execute",
        "perm_anon_no_claim_execute",
        "beh_second_active_same_station_fails",
        "struct_no_plaintext_secret_columns"
      ]) {
        if (!testSql.includes(token)) throw new Error(`missing scenario ${token}`)
      }
    }
  },
  {
    name: "190 test SQL documents edge/auth skips",
    run() {
      if (!testSql.includes("runtime_skipped_requires_edge_auth_complete")) {
        throw new Error("missing edge skip scenario")
      }
      const skips = scenarioMatches.filter((m) => m[1].startsWith("runtime_skipped"))
      if (skips.length < 3) throw new Error("expected multiple runtime_skipped scenarios")
    }
  },
  {
    name: "190 test SQL scenario count minimum",
    run() {
      if (scenarioMatches.length < 40) {
        throw new Error(`expected >= 40 scenarios, found ${scenarioMatches.length}`)
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
console.log(`\n${passed}/${tests.length} passed (${scenarioMatches.length} scenarios detected)`)
