import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const files = {
  setup: read("supabase/schema/194_concurrency_test_setup.sql"),
  workerA: read("supabase/schema/194_concurrency_test_worker_a.sql"),
  workerB: read("supabase/schema/194_concurrency_test_worker_b.sql"),
  verify: read("supabase/schema/194_concurrency_test_verify_cleanup.sql"),
  cleanupOnly: read("supabase/schema/194_concurrency_test_cleanup_only.sql")
}

const forbidden = [/caja-principal-01/i, /\bCaja Principal\b/]
const sharedKey = "cc194-conc-key-001"

const FIXTURE_UUIDS = [
  "19400000-0000-4000-8000-000000000001",
  "19400000-0000-4000-8000-000000000002",
  "19400000-0000-4000-8000-000000000003",
  "19400000-0000-4000-8000-000000000004"
]

const UUID_LIT = /'([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})'::uuid/gi
const FORBIDDEN_UUID_PREFIX = /cc1940000-/i

function extractUuidLiterals(sql) {
  return [...sql.matchAll(UUID_LIT)].map((m) => m[1].toLowerCase())
}

function isValidUuidFormat(u) {
  const parts = u.split("-")
  if (parts.length !== 5) return false
  if (parts[0].length !== 8) return false
  return parts.every((p, i) => {
    const len = i === 0 ? 8 : i === 4 ? 12 : 4
    return p.length === len && /^[0-9a-f]+$/.test(p)
  })
}

const BAD_REGCLASS_EXISTS =
  /to_regclass\s*\(\s*'public\.cc194_concurrency_(?:lab|heartbeat)'\s*\)\s*is\s*not\s*null[\s\S]{0,120}\bexists\s*\(\s*select\s+1\s+from\s+public\.cc194_concurrency_/i

const tests = [
  {
    name: "CC194-1 setup uses cc194 fixture prefix",
    run() {
      if (!files.setup.includes("cc194-conc-lab")) throw new Error("station code")
      if (!files.setup.includes("CC194 Test Register")) throw new Error("register name")
    }
  },
  {
    name: "CC194-2 no production caja references",
    run() {
      for (const [name, sql] of Object.entries(files)) {
        if (name === "verify") continue
        for (const re of forbidden) {
          if (re.test(sql)) throw new Error(`${name} mentions forbidden caja id/name`)
        }
      }
      if (!files.verify.includes("isolated_station_code")) {
        throw new Error("verify must assert cc194-conc-lab isolation")
      }
      for (const re of forbidden) {
        if (re.test(files.verify)) throw new Error(`verify mentions forbidden caja id/name`)
      }
    }
  },
  {
    name: "CC194-3 workers share idempotency key and helpers",
    run() {
      for (const sql of [files.workerA, files.workerB]) {
        if (!sql.includes("station_cash_idempotency_begin")) throw new Error("begin helper")
        if (!sql.includes("cc194_concurrency_lab")) throw new Error("lab table")
      }
      if (!files.workerA.includes(sharedKey) && !files.workerA.includes("idempotency_key")) {
        throw new Error("worker A key source")
      }
    }
  },
  {
    name: "CC194-4 same operation and fingerprint from lab",
    run() {
      if (!files.workerA.includes("operation, fingerprint")) throw new Error("A loads fp")
      if (!files.workerB.includes("operation, fingerprint")) throw new Error("B loads fp")
      if (!files.setup.includes("fingerprint_alt")) throw new Error("alt fp for conflict")
    }
  },
  {
    name: "CC194-5 worker A holds lock with bounded sleep",
    run() {
      const m = files.workerA.match(/pg_sleep\s*\(\s*(\d+(?:\.\d+)?)\s*\)/g) || []
      for (const call of m) {
        const n = Number(call.replace(/[^\d.]/g, ""))
        if (n > 8) throw new Error(`sleep ${n}s exceeds 8s cap`)
      }
      if (!files.workerA.includes("holding_lock")) throw new Error("heartbeat signal")
    }
  },
  {
    name: "CC194-6 verify has counts passed failed cleanup",
    run() {
      for (const col of ["passed_total", "failed_total", "cleanup_required"]) {
        if (!files.verify.includes(col)) throw new Error(`missing ${col}`)
      }
      if (!files.verify.includes("conflict_fingerprint_raises")) throw new Error("conflict scenario")
      if (!files.verify.includes("single_idempotency_row")) throw new Error("count scenario")
    }
  },
  {
    name: "CC194-7 cleanup drops lab tables and cc194 rows",
    run() {
      if (!files.verify.includes("drop table if exists public.cc194_concurrency_lab")) {
        throw new Error("drop lab")
      }
      if (!files.verify.includes("cc194-conc-lab")) throw new Error("station cleanup guard")
    }
  },
  {
    name: "CC194-8 no sensitive output in verify select",
    run() {
      if (/session_token|pin_hash|pepper|operator_session_token/i.test(files.verify)) {
        throw new Error("verify must not export secrets")
      }
    }
  },
  {
    name: "CC194-9 worker B expects completed replay not second mutation",
    run() {
      if (!files.workerB.includes("idempotency_status")) throw new Error("status check")
      if (!files.workerB.includes("se esperaba resultado completed")) throw new Error("B guard")
    }
  },
  {
    name: "CC194-10 setup aborts on existing fixture",
    run() {
      if (!files.setup.includes("fixture cc194-conc-lab ya existe")) {
        throw new Error("abort if station exists")
      }
      if (!files.setup.includes("CC194_SETUP_ALREADY_EXISTS")) {
        throw new Error("abort if lab/heartbeat objects exist")
      }
      if (!/to_regclass\s*\(\s*'public\.cc194_concurrency_lab'\s*\)\s*is\s*not\s*null\s*then/i.test(
        files.setup
      )) {
        throw new Error("direct lab to_regclass guard")
      }
      if (!/to_regclass\s*\(\s*'public\.cc194_concurrency_heartbeat'\s*\)\s*is\s*not\s*null\s*then/i.test(
        files.setup
      )) {
        throw new Error("direct heartbeat to_regclass guard")
      }
      const guardEnd = files.setup.search(/create table if not exists public\.cc194_concurrency_lab/i)
      const firstGuard = files.setup.search(/do \$\$/i)
      if (guardEnd < 0 || firstGuard < 0 || guardEnd < firstGuard) {
        throw new Error("guards must precede CREATE TABLE lab")
      }
      if (BAD_REGCLASS_EXISTS.test(Object.values(files).join("\n"))) {
        throw new Error("no to_regclass AND EXISTS on optional lab tables")
      }
      if (!files.setup.includes("no hay profile activo")) throw new Error("abort if no safe profile")
      if (/delete from public\.operational_stations/i.test(files.setup)) {
        throw new Error("setup must not delete prod fixture inline; use verify_cleanup")
      }
      if (/insert into public\.cash_sessions/i.test(files.setup)) {
        throw new Error("setup must not open human cash_session")
      }
      if (/cash_movements|record_station_cash_sale|open_cash_session/i.test(
        Object.values(files).join("\n")
      )) {
        throw new Error("no real cash movements or human RPCs")
      }
    }
  },
  {
    name: "CC194-11 verify seven scenarios and runbook jwt gap",
    run() {
      const scenarios = [
        "isolated_station_code",
        "single_idempotency_row",
        "idempotency_completed",
        "single_lab_mutation",
        "worker_a_committed",
        "worker_b_replay_ok",
        "conflict_fingerprint_raises"
      ]
      if (scenarios.length !== 7) throw new Error("expected 7 verify scenarios")
      for (const s of scenarios) {
        if (!files.verify.includes(s)) throw new Error(`missing scenario ${s}`)
      }
      const runbook = read("docs/os2-station-cash-concurrency-two-tab-runbook.md")
      if (!/Edge|JWT|auth\.uid/i.test(runbook)) throw new Error("runbook must document Edge/JWT limit")
      if (!/cleanup_only/i.test(runbook)) throw new Error("runbook must document cleanup_only recovery")
    }
  },
  {
    name: "CC194-12 fixture UUID literals valid and consistent",
    run() {
      if (FORBIDDEN_UUID_PREFIX.test(Object.values(files).join("\n"))) {
        throw new Error("forbidden cc1940000- uuid prefix")
      }
      const byFile = {}
      for (const [name, sql] of Object.entries(files)) {
        byFile[name] = extractUuidLiterals(sql)
        for (const u of byFile[name]) {
          if (!isValidUuidFormat(u)) throw new Error(`${name}: invalid uuid ${u}`)
          if (u.split("-")[0].length !== 8) throw new Error(`${name}: first block must be 8 hex chars`)
        }
      }
      const setupSet = new Set(byFile.setup)
      for (const id of FIXTURE_UUIDS) {
        if (!setupSet.has(id)) throw new Error(`setup missing fixture uuid ${id}`)
      }
      for (const id of FIXTURE_UUIDS.slice(0, 3)) {
        if (!byFile.verify.includes(id)) throw new Error(`verify cleanup missing uuid ${id}`)
        if (!extractUuidLiterals(files.cleanupOnly).includes(id)) {
          throw new Error(`cleanup_only missing uuid ${id}`)
        }
      }
      const workerUuids = new Set([...byFile.workerA, ...byFile.workerB])
      if (workerUuids.size > 0) {
        throw new Error("workers must not hardcode uuid literals; use cc194_concurrency_lab")
      }
    }
  },
  {
    name: "CC194-13 setup wrapped in begin commit",
    run() {
      if (!/^begin;/im.test(files.setup)) throw new Error("setup must begin transaction")
      if (!/\bcommit;\s*\n\s*select\s+'cc194_setup_ok'/is.test(files.setup)) {
        throw new Error("setup must commit before success select")
      }
    }
  },
  {
    name: "CC194-14 cleanup_only idempotent recovery script",
    run() {
      const sql = files.cleanupOnly
      if (/[^if exists\s]public\.cc194_concurrency_verify\s*\(\s*\)/i.test(
        sql.replace(/drop function if exists public\.cc194_concurrency_verify\s*\(\s*\)\s*;/gi, "")
      )) {
        throw new Error("cleanup_only must not call verify")
      }
      if (/from\s+public\.cc194_concurrency_lab/i.test(sql)) {
        throw new Error("cleanup_only must not select from lab table")
      }
      if (!/^begin;/im.test(sql) || (sql.match(/\bcommit;/g) || []).length !== 1) {
        throw new Error("cleanup_only single begin/commit")
      }
      for (const id of FIXTURE_UUIDS) {
        if (!sql.includes(id)) throw new Error(`cleanup_only missing ${id}`)
      }
      if (!sql.includes("CC194 cleanup abortado")) throw new Error("name/code guards")
      if (!sql.includes("drop table if exists public.cc194_concurrency_lab")) {
        throw new Error("drop lab if exists")
      }
      if (!/cc194_cleanup_done/.test(sql) || !/cleanup_required/.test(sql)) {
        throw new Error("final status row")
      }
      if (!sql.includes("drop function if exists public.cc194_concurrency_verify()")) {
        throw new Error("drop stray verify function")
      }
    }
  },
  {
    name: "CC194-15 verify_cleanup handles missing lab",
    run() {
      if (!files.verify.includes("to_regclass('public.cc194_concurrency_lab')")) {
        throw new Error("guard before querying lab")
      }
      if (!files.verify.includes("cc194_lab_missing_use_cleanup_only")) {
        throw new Error("missing lab message scenario")
      }
      if (!files.verify.includes("Capturar/exportar")) throw new Error("document capture before cleanup")
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
