/**
 * Offline static regression for 185 KDS ambiguity fix.
 * Run: node frontend/scripts/sendPosOrderProduction185.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const migrationPath = resolve(root, "supabase/schema/185_fix_send_pos_order_product_ambiguity.sql")
const legacy157Path = resolve(root, "supabase/schema/157_pos_implementation_mode.sql")

const sql185 = readFileSync(migrationPath, "utf8")
const sql157 = readFileSync(legacy157Path, "utf8")

const tests = [
  {
    name: "185 removes join public.pos_products product alias",
    run() {
      if (/join public\.pos_products product/i.test(sql185)) {
        throw new Error("185 still contains conflicting product alias")
      }
    }
  },
  {
    name: "185 uses pop alias in inventory loops",
    run() {
      const matches = sql185.match(/join public\.pos_products pop/gi) || []
      if (matches.length < 2) throw new Error(`expected >=2 pop joins, got ${matches.length}`)
    }
  },
  {
    name: "185 declares v_product not bare product",
    run() {
      if (!/v_product public\.pos_products/.test(sql185)) {
        throw new Error("missing v_product declaration")
      }
      if (/declare[\s\S]*?\n\s+product public\.pos_products/.test(sql185)) {
        throw new Error("bare product variable still declared")
      }
    }
  },
  {
    name: "185 preserves function signature and grants",
    run() {
      if (!/create or replace function public\.send_pos_order_to_production\(p_order_id uuid\)/i.test(sql185)) {
        throw new Error("signature mismatch")
      }
      if (!/returns jsonb/i.test(sql185)) throw new Error("missing jsonb return")
      if (!/security definer/i.test(sql185)) throw new Error("missing security definer")
      if (!/grant execute on function public\.send_pos_order_to_production\(uuid\) to authenticated/i.test(sql185)) {
        throw new Error("missing authenticated grant")
      }
    }
  },
  {
    name: "157 documents the bug pattern (regression anchor)",
    run() {
      const hits = sql157.match(/join public\.pos_products product on product\.id/gi) || []
      if (hits.length < 2) throw new Error("157 anchor pattern not found")
    }
  },
  {
    name: "158 and 185 bodies align on pop alias strategy",
    run() {
      const path158 = resolve(root, "supabase/schema/158_fix_pos_kds_product_id_ambiguity.sql")
      const sql158 = readFileSync(path158, "utf8")
      if (!/join public\.pos_products pop on pop\.id = poi\.product_id/i.test(sql158)) {
        throw new Error("158 reference missing pop join")
      }
      if (sql158.replace(/\s+/g, " ").includes("join public.pos_products product")) {
        throw new Error("158 unexpectedly still has product alias")
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
