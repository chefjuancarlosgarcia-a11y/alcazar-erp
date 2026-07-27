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
  verify: read("supabase/schema/194_concurrency_test_verify_cleanup.sql")
}

const forbidden = [/caja-principal-01/i, /\bCaja Principal\b/]
const sharedKey = "cc194-conc-key-001"

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
