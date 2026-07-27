import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql194 = read("supabase/schema/194_station_cash_operator_wrappers.sql")
const cashMgmt = read("frontend/src/pages/CashManagement.jsx")
const stationCash = read("frontend/src/services/stationCashService.js")
const stationEntry = read("frontend/src/pages/StationCashEntry.jsx")

const tests = [
  {
    name: "CASH-1 station wrappers named",
    run() {
      for (const fn of [
        "get_station_cash_context",
        "open_station_cash_session",
        "create_station_cash_movement",
        "close_station_cash_session",
        "record_station_cash_sale"
      ]) {
        if (!new RegExp(`function public.${fn}`).test(sql194)) throw new Error(`missing ${fn}`)
      }
    }
  },
  {
    name: "CASH-2 no client station_id authority",
    run() {
      if (/p_station_id/.test(sql194.match(/get_station_cash_context[\s\S]*?\$\$;/)?.[0] || "")) {
        throw new Error("context must not accept station_id")
      }
      if (/p_operator_profile_id/.test(stationCash)) throw new Error("frontend must not send operator_profile_id")
      if (/p_cash_register_id/.test(stationCash)) throw new Error("frontend must not send cash_register_id")
    }
  },
  {
    name: "CASH-3 resolve uses device auth uid",
    run() {
      if (!/resolve_operational_device_for_auth_user/.test(sql194)) throw new Error("device resolver")
    }
  },
  {
    name: "CASH-4 open session preserves Ya existe rule",
    run() {
      if (!/Ya existe una caja abierta/.test(sql194)) throw new Error("duplicate open guard")
    }
  },
  {
    name: "CASH-5 close own session rule",
    run() {
      if (!/Solo puedes cerrar tu propia caja/.test(sql194)) throw new Error("close ownership")
    }
  },
  {
    name: "CASH-6 sale locks operator",
    run() {
      if (!/sale_complete/.test(sql194)) throw new Error("sale lock reason")
    }
  },
  {
    name: "CASH-7 CashManagement port adapter",
    run() {
      if (!/cashPort/.test(cashMgmt) || !/createHumanCashPort/.test(cashMgmt)) throw new Error("port pattern")
      if (!/createStationCashPort/.test(stationEntry)) throw new Error("station port")
    }
  },
  {
    name: "CASH-8 human routes unchanged default port",
    run() {
      if (!/cashPortProp \|\| createHumanCashPort/.test(cashMgmt)) throw new Error("default human port")
    }
  },
  {
    name: "CASH-9 no signOut on operator lock",
    run() {
      if (/signOut/.test(stationEntry)) throw new Error("must not signOut device on lock")
    }
  },
  {
    name: "CASH-10 attribution metadata",
    run() {
      if (!/operational_station_device_id/.test(sql194)) throw new Error("movement metadata")
    }
  },
  {
    name: "CASH-11 get_station_cash_context no idle extend",
    run() {
      const block = sql194.match(/function public.get_station_cash_context[\s\S]*?\$\$;/)
      if (!block?.[0]?.includes("resolve_station_cash_operator_context(p_operator_session_token, false)")) {
        throw new Error("context must not extend idle on read")
      }
    }
  },
  {
    name: "CASH-12 no idle touch interval",
    run() {
      if (/setInterval\s*\(\s*debouncedTouch|TOUCH_DEBOUNCE_MS/.test(stationEntry)) {
        throw new Error("removed periodic touch")
      }
      if (!/shouldSendOperatorTouch/.test(stationEntry)) throw new Error("human-gated touch")
    }
  },
  {
    name: "CASH-13 idempotency not per rpc uuid",
    run() {
      if (/function idempotencyKey|crypto\.randomUUID\(\)/.test(stationCash)) {
        throw new Error("use stationCashIdempotency intents")
      }
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
