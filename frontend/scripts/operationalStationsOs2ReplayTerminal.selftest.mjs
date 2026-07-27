import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql194 = read("supabase/schema/194_station_cash_operator_wrappers.sql")
const sqlReplayTest = read("supabase/schema/194_test_station_cash_replay_terminal.sql")
const runbook = read("docs/os2-station-cash-replay-terminal-runbook.md")

const tests = [
  {
    name: "REPLAY-1 replay helper before resolve in sale",
    run() {
      const block = sql194.match(/function public.record_station_cash_sale[\s\S]*?\$\$;/)
      if (!block) throw new Error("record block")
      const iReplay = block[0].indexOf("station_cash_idempotency_replay_if_completed")
      const iResolve = block[0].indexOf("resolve_station_cash_operator_context")
      if (iReplay < 0 || iResolve < 0 || iReplay > iResolve) throw new Error("replay-first in sale")
    }
  },
  {
    name: "REPLAY-2 replay before resolve in close",
    run() {
      const block = sql194.match(/function public.close_station_cash_session[\s\S]*?\$\$;/)
      if (!block) throw new Error("close block")
      if (
        block[0].indexOf("station_cash_idempotency_replay_if_completed") >
        block[0].indexOf("resolve_station_cash_operator_context")
      ) {
        throw new Error("replay-first in close")
      }
    }
  },
  {
    name: "REPLAY-3 bind includes terminal session lookup",
    run() {
      const bind = sql194.match(/function public.station_cash_bind_operator_session_by_token[\s\S]*?\$\$;/)
      if (!bind?.[0]?.includes("order by created_at desc")) throw new Error("terminal session bind")
      if (bind[0].includes("revoked_at is null")) throw new Error("must include revoked sessions")
    }
  },
  {
    name: "REPLAY-4 replay ties operator_session_id on row",
    run() {
      const replay = sql194.match(/function public.station_cash_idempotency_replay_if_completed[\s\S]*?\$\$;/)
      if (!replay?.[0]?.includes("operator_session_id is distinct from v_op_session_id")) {
        throw new Error("session binding on replay")
      }
    }
  },
  {
    name: "REPLAY-5 impl skip not granted to authenticated in SQL",
    run() {
      if (
        !/revoke all on function public.station_cash_create_movement_impl[\s\S]*from public, anon, authenticated/.test(
          sql194
        )
      ) {
        throw new Error("impl revoked for authenticated")
      }
      if (!/grant execute on function public.create_station_cash_movement\(text, text, numeric, text, text, uuid, text\)/.test(sql194)) {
        throw new Error("7-arg movement granted")
      }
    }
  },
  {
    name: "REPLAY-6 SQL ACL test file present",
    run() {
      if (!/movement_impl_not_client_executable/.test(sqlReplayTest)) throw new Error("acl test")
    }
  },
  {
    name: "REPLAY-7 post-apply runbook documented",
    run() {
      if (!/sale_complete/.test(runbook) || !/dos conexiones/i.test(runbook)) {
        throw new Error("runbook")
      }
    }
  },
  {
    name: "REPLAY-8 replay returns completed without idle extend",
    run() {
      const replay = sql194.match(/function public.station_cash_idempotency_replay_if_completed[\s\S]*?\$\$;/)
      if (/extend_operator_idle/.test(replay?.[0] || "")) throw new Error("replay must not extend idle")
    }
  },
  {
    name: "REPLAY-9 open movement open path replay-first",
    run() {
      for (const fn of ["open_station_cash_session", "station_cash_create_movement_impl"]) {
        const block = sql194.match(new RegExp(`function public.${fn}[\\s\\S]*?\\$\\$;`))
        if (!block) throw new Error(fn)
        if (
          block[0].indexOf("station_cash_idempotency_replay_if_completed") >
          block[0].indexOf("resolve_station_cash_operator_context")
        ) {
          throw new Error(`replay-first in ${fn}`)
        }
      }
    }
  },
  {
    name: "REPLAY-10 frontend still 7-arg RPC only",
    run() {
      const svc = read("frontend/src/services/stationCashService.js")
      if (/p_skip_idempotency|create_movement_impl/.test(svc)) throw new Error("frontend must not call impl")
    }
  },
  {
    name: "REPLAY-11 human port unchanged",
    run() {
      const port = read("frontend/src/services/cashManagementPort.js")
      if (!/createHumanCashPort/.test(port)) throw new Error("human port")
    }
  },
  {
    name: "REPLAY-12 completed status required for replay return",
    run() {
      if (!sql194.includes("idempotency_status', '') = 'completed'")) throw new Error("completed gate")
    }
  }
]

let passed = 0
for (const t of tests) {
  try {
    t.run()
    passed += 1
    console.log(`OK ${t.name}`)
  } catch (e) {
    console.error(`FAIL ${t.name}:`, e.message)
    process.exitCode = 1
  }
}
console.log(`${passed}/${tests.length}`)
if (process.exitCode) process.exit(process.exitCode)
