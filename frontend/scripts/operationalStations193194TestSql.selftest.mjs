import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const testFiles = [
  "supabase/schema/193_test_operational_operator_access.sql",
  "supabase/schema/194_test_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_replay_terminal.sql"
]

const os2SqlAudit = [
  "supabase/schema/193_operational_operator_access_foundation.sql",
  "supabase/schema/193_test_operational_operator_access.sql",
  "supabase/schema/194_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_replay_terminal.sql",
  "supabase/schema/diagnose_operational_operator_access_preflight_193.sql",
  "supabase/schema/diagnose_operational_operator_access_postflight_193.sql",
  "supabase/schema/diagnose_station_cash_preflight_194.sql",
  "supabase/schema/diagnose_station_cash_postflight_194.sql",
  "supabase/rollback/193_operational_operator_access_foundation.rollback.sql",
  "supabase/rollback/194_station_cash_operator_wrappers.rollback.sql"
]

const os2Sql194 = [
  "supabase/schema/194_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_replay_terminal.sql",
  "supabase/schema/diagnose_station_cash_preflight_194.sql",
  "supabase/schema/diagnose_station_cash_postflight_194.sql",
  "supabase/rollback/194_station_cash_operator_wrappers.rollback.sql"
]

const badPgcryptoPublic = /public\.(digest|hmac|crypt|gen_salt)\s*\(/i
const unqualifiedPgcrypto = /(?<!extensions\.)(?<![.\w])(digest|hmac|crypt|gen_salt)\s*\(/i

function assert194Pgcrypto(rel, sql) {
  if (badPgcryptoPublic.test(sql)) {
    throw new Error(`${rel}: use extensions.* for pgcrypto, not public.*`)
  }
  const body = sql.replace(/--[^\n]*/g, "")
  if (unqualifiedPgcrypto.test(body)) {
    throw new Error(`${rel}: pgcrypto calls must be extensions-qualified (search_path '')`)
  }
}

function assertFingerprintDigest(sql194) {
  const fp = sql194.match(/function public\.station_cash_request_fingerprint[\s\S]*?\$\$;/)
  if (!fp?.[0]?.includes("extensions.digest(")) {
    throw new Error("station_cash_request_fingerprint must use extensions.digest")
  }
  if (fp?.[0]?.includes("public.digest")) {
    throw new Error("fingerprint must not use public.digest")
  }
}
const brokenLimitComma = /\blimit\s+\d+\s*,\s*'/i

function assertTestStructure(name, sql) {
  if (!/^begin;/im.test(sql)) throw new Error(`${name}: missing begin`)
  if (!/rollback;\s*$/im.test(sql.trim())) throw new Error(`${name}: must end with rollback`)
  if (/\bcommit;\s*$/im.test(sql.trim())) throw new Error(`${name}: must not commit`)
  if (!/with results as materialized/.test(sql)) throw new Error(`${name}: materialized results`)
  if (!/passed_total/.test(sql) || !/failed_total/.test(sql)) {
    throw new Error(`${name}: summary columns`)
  }
  if (!/drop function if exists public\.test_/.test(sql)) {
    throw new Error(`${name}: drop test function before rollback`)
  }
  if (!/order by r\.passed asc/.test(sql)) throw new Error(`${name}: failed first ordering`)
}

function assertNoMysqlLimit(rel, sql) {
  if (mysqlLimit.test(sql)) {
    throw new Error(`${rel}: MySQL LIMIT offset,count not supported in PostgreSQL`)
  }
  if (brokenLimitComma.test(sql)) {
    throw new Error(`${rel}: LIMIT must not use comma before next SELECT item`)
  }
}

const tests = [
  ...testFiles.map((rel) => ({
    name: `structure ${path.basename(rel)}`,
    run: () => assertTestStructure(rel, read(rel))
  })),
  ...os2SqlAudit.map((rel) => ({
    name: `limit-syntax ${path.basename(rel)}`,
    run: () => assertNoMysqlLimit(rel, read(rel))
  })),
  ...os2Sql194.map((rel) => ({
    name: `pgcrypto-194 ${path.basename(rel)}`,
    run: () => assert194Pgcrypto(rel, read(rel))
  })),
  {
    name: "194 migration single begin commit",
    run: () => {
      const sql = read("supabase/schema/194_station_cash_operator_wrappers.sql")
      if (!/^begin;/im.test(sql)) throw new Error("194 must begin with begin")
      if ((sql.match(/\bcommit;/g) || []).length !== 1) throw new Error("194 must have single commit")
      assertFingerprintDigest(sql)
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed++
    console.log(`OK SQL-TEST ${t.name}`)
  } catch (e) {
    console.error(`FAIL SQL-TEST ${t.name}: ${e.message}`)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
