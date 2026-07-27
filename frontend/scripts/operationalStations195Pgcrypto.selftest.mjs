import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql193 = read("supabase/schema/193_operational_operator_access_foundation.sql")
const sql195 = read("supabase/schema/195_fix_operational_operator_pgcrypto_schema.sql")
const test195 = read("supabase/schema/195_test_operational_operator_pgcrypto_schema.sql")

const badPublic = /public\.(digest|hmac|crypt|gen_salt)\s*\(/i

const tests = [
  {
    name: "195-1 migration single begin commit",
    run() {
      if (!/^begin;/im.test(sql195)) throw new Error("begin required")
      if ((sql195.match(/\bcommit;/g) || []).length !== 1) throw new Error("single commit")
    }
  },
  {
    name: "195-2 replaces four operator RPCs only",
    run() {
      const names = [
        "admin_set_operational_pin",
        "verify_operational_pin_for_device",
        "touch_operational_operator_session",
        "lock_operational_operator_session"
      ]
      for (const n of names) {
        if (!new RegExp(`create or replace function public\\.${n}`).test(sql195)) {
          throw new Error(`missing ${n}`)
        }
      }
      if (/create table/i.test(sql195)) throw new Error("no DDL tables")
    }
  },
  {
    name: "195-3 no public pgcrypto in 195",
    run() {
      if (badPublic.test(sql195)) throw new Error("use extensions.* in 195")
    }
  },
  {
    name: "195-4 canonical 193 qualified pgcrypto",
    run() {
      if (badPublic.test(sql193)) throw new Error("193 canonical must use extensions.*")
      if (!sql193.includes("extensions.digest")) throw new Error("193 digest")
      if (!sql193.includes("extensions.crypt")) throw new Error("193 crypt")
    }
  },
  {
    name: "195-5 test structure and runtime smoke",
    run() {
      if (!/runtime_extensions_digest/.test(test195)) throw new Error("runtime digest test")
      if (!/rollback;\s*$/im.test(test195.trim())) throw new Error("rollback")
      if (!/drop function if exists public\.test_operational_operator_pgcrypto_195/.test(test195)) {
        throw new Error("drop test fn")
      }
    }
  },
  {
    name: "195-6 diagnose scripts present",
    run() {
      for (const f of [
        "supabase/schema/diagnose_operational_operator_pgcrypto_preflight_195.sql",
        "supabase/schema/diagnose_operational_operator_pgcrypto_postflight_195.sql"
      ]) {
        read(f)
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
