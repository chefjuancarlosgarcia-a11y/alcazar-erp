/**
 * Offline static regression for 187_test_pos_table_service_lifecycle.sql
 * Run: node frontend/scripts/posTableServiceLifecycle187TestSql.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const testSql = readFileSync(
  resolve(root, "supabase/schema/187_test_pos_table_service_lifecycle.sql"),
  "utf8"
)

function countMatches(source, pattern) {
  return (source.match(pattern) || []).length
}

const tests = [
  {
    name: "187 test SQL uses BEGIN and ROLLBACK",
    run() {
      if (!/^begin;/im.test(testSql)) throw new Error("missing BEGIN")
      if (!/^rollback;/im.test(testSql)) throw new Error("missing ROLLBACK")
      if (countMatches(testSql, /^commit;/gim) !== 0) throw new Error("must not COMMIT")
    }
  },
  {
    name: "187 test SQL invokes test function exactly once",
    run() {
      const calls = countMatches(
        testSql,
        /from\s+public\.test_pos_table_service_lifecycle_187\s*\(\s*\)/gi
      )
      if (calls !== 1) throw new Error(`expected 1 invocation, found ${calls}`)
    }
  },
  {
    name: "187 test SQL materializes single result set with summary columns",
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
    name: "187 test SQL drops ephemeral test function before rollback",
    run() {
      if (!/drop function if exists public\.test_pos_table_service_lifecycle_187\(\)/i.test(testSql)) {
        throw new Error("missing DROP FUNCTION cleanup")
      }
      const dropPos = testSql.search(/drop function if exists public\.test_pos_table_service_lifecycle_187/i)
      const rollbackPos = testSql.search(/^rollback;/im)
      if (dropPos < 0 || rollbackPos < 0 || dropPos >= rollbackPos) {
        throw new Error("DROP FUNCTION must precede ROLLBACK")
      }
    }
  },
  {
    name: "187 test SQL does not reference evidence order 4e6ba009",
    run() {
      const withoutComments = testSql.replace(/--[^\n]*/g, "")
      if (/4e6ba009/i.test(withoutComments)) {
        throw new Error("must not touch evidence order in executable SQL")
      }
    }
  },
  {
    name: "187 test SQL validates release search_path via proconfig not pg_get_functiondef",
    run() {
      if (/v_release_def ilike '%set search_path = ''''%'/i.test(testSql)) {
        throw new Error("must not depend on pg_get_functiondef search_path text")
      }
      if (!/p\.proconfig/i.test(testSql) || !/release_pos_table_service/i.test(testSql)) {
        throw new Error("missing structural proconfig check for release_pos_table_service")
      }
      if (!/split_part\(cfg, '=', 1\) = 'search_path'/i.test(testSql)) {
        throw new Error("missing split_part search_path proconfig check")
      }
      if (/btrim\s*\(\s*both/i.test(testSql)) {
        throw new Error("must not use invalid btrim(both ...) syntax")
      }
    }
  },
  {
    name: "187 test SQL validates payments block via helper chain not release literal",
    run() {
      if (/v_release_def ilike '%POS_RELEASE_BLOCKED_PAYMENTS%'/.test(testSql)) {
        throw new Error("must not grep POS_RELEASE_BLOCKED_PAYMENTS in v_release_def")
      }
      const required = [
        "v_classify_def",
        "v_assert_def",
        "v_has_payments_def",
        "pos_classify_release_scenario",
        "pos_assert_release_authorized",
        "pos_order_has_payments",
        "public.pos_order_payments",
        "L5_payments",
        "POS_RELEASE_BLOCKED_PAYMENTS",
        "clear_pos_order_draft_items",
        "update public.pos_orders"
      ]
      for (const token of required) {
        if (!testSql.includes(token)) throw new Error(`missing payments chain token ${token}`)
      }
    }
  },
  {
    name: "187 test SQL defines expected static scenarios",
    run() {
      for (const scenario of [
        "static_release_search_path",
        "static_release_payments_block",
        "A17_index_all_active_statuses",
        "static_index_dine_in_scope",
        "runtime_skipped_no_auth"
      ]) {
        if (!testSql.includes(scenario)) throw new Error(`missing scenario ${scenario}`)
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
