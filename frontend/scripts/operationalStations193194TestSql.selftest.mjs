import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const files = [
  "supabase/schema/193_test_operational_operator_access.sql",
  "supabase/schema/194_test_station_cash_operator_wrappers.sql",
  "supabase/schema/194_test_station_cash_replay_terminal.sql"
]

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

const tests = files.map((rel) => ({
  name: path.basename(rel),
  run: () => assertTestStructure(rel, read(rel))
}))

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
