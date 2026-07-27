import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  OPERATOR_IDLE_DEBOUNCE_MS,
  afterSuccessfulOperatorTouch,
  isOperatorSessionExpired,
  onHumanOperatorActivity,
  shouldSendOperatorTouch
} from "../src/services/operationalOperatorIdle.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const stationEntry = read("frontend/src/pages/StationCashEntry.jsx")
const sql194 = read("supabase/schema/194_station_cash_operator_wrappers.sql")
const sql193 = read("supabase/schema/193_operational_operator_access_foundation.sql")
const stationCash = read("frontend/src/services/stationCashService.js")
const humanPort = read("frontend/src/services/cashManagementPort.js")

const tests = [
  {
    name: "IDLE-1 no periodic touch interval in StationCashEntry",
    run() {
      if (/setInterval\s*\(\s*debouncedTouch|setInterval\s*\([^)]*touchOperatorSession/.test(stationEntry)) {
        throw new Error("periodic touch interval forbidden")
      }
      if (/setInterval\s*\([^)]*flushOperatorTouch/.test(stationEntry)) {
        throw new Error("must not interval-flush touch without human activity")
      }
    }
  },
  {
    name: "IDLE-2 activityPending + shouldSendOperatorTouch gate",
    run() {
      if (!/activityPendingRef/.test(stationEntry) || !/shouldSendOperatorTouch/.test(stationEntry)) {
        throw new Error("missing activity pending gate")
      }
      const now = 100_000
      if (shouldSendOperatorTouch({ activityPending: false, lastTouchSentAt: 0, nowMs: now, debounceMs: 18000 })) {
        throw new Error("touch without pending activity")
      }
    }
  },
  {
    name: "IDLE-3 debounce blocks rapid duplicate touch",
    run() {
      const now = 200_000
      const debounce = OPERATOR_IDLE_DEBOUNCE_MS
      if (!shouldSendOperatorTouch({ activityPending: true, lastTouchSentAt: now - 1000, nowMs: now, debounceMs: debounce })) {
        // expected blocked
      } else {
        throw new Error("debounce should block second touch within window")
      }
      if (
        !shouldSendOperatorTouch({
          activityPending: true,
          lastTouchSentAt: now - debounce - 1,
          nowMs: now,
          debounceMs: debounce
        })
      ) {
        throw new Error("touch allowed after debounce with pending activity")
      }
    }
  },
  {
    name: "IDLE-4 local expiry at 91s without touch renewal",
    run() {
      const base = Date.parse("2026-01-01T12:00:00.000Z")
      const exp = new Date(base + 90_000).toISOString()
      if (isOperatorSessionExpired(exp, base + 89_000)) throw new Error("should not expire before idle_expires_at")
      if (!isOperatorSessionExpired(exp, base + 91_000)) throw new Error("should expire after idle window")
    }
  },
  {
    name: "IDLE-5 polling get_station_cash_context does not extend idle",
    run() {
      const block = sql194.match(/function public.get_station_cash_context[\s\S]*?\$\$;/)
      if (!block) throw new Error("get_station_cash_context block")
      if (!/resolve_station_cash_operator_context\(p_operator_session_token,\s*false\)/.test(block[0])) {
        throw new Error("context read must pass p_extend_idle false")
      }
    }
  },
  {
    name: "IDLE-6 touch RPC rejects expired session (no revive)",
    run() {
      if (!/touch_operational_operator_session/.test(sql193)) throw new Error("touch rpc")
      const touchBlock = sql193.match(/function public.touch_operational_operator_session[\s\S]*?\$\$;/)
      if (!touchBlock) throw new Error("touch block")
      if (!/idle_expires_at\s*<=\s*now\(\)/.test(touchBlock[0]) && !/idle_expires_at\s*<\s*now\(\)/.test(touchBlock[0])) {
        throw new Error("touch must fail when already expired")
      }
    }
  },
  {
    name: "IDLE-7 successful touch clears pending",
    run() {
      let state = { activityPending: false, lastTouchSentAt: 0, nowMs: 0 }
      state = onHumanOperatorActivity(state)
      if (!state.activityPending) throw new Error("human activity sets pending")
      state = afterSuccessfulOperatorTouch({ ...state, nowMs: 50_000 })
      if (state.activityPending) throw new Error("pending cleared after success")
    }
  },
  {
    name: "IDLE-8 expiry path no signOut",
    run() {
      if (/signOut/.test(stationEntry)) throw new Error("expiry must not signOut technical session")
      if (!/clearOperatorSession/.test(stationEntry)) throw new Error("must clear operator token locally")
    }
  },
  {
    name: "IDLE-9 human listeners trusted events only pattern",
    run() {
      if (!/event\.isTrusted/.test(stationEntry)) throw new Error("pointer/key must check isTrusted")
    }
  },
  {
    name: "IDLE-10 CashManagement wires onHumanActivity for station",
    run() {
      const cm = read("frontend/src/pages/CashManagement.jsx")
      if (!/onHumanActivity/.test(cm) || !/onFunctionalCashAction/.test(cm)) {
        throw new Error("station uiConfig activity hooks")
      }
    }
  },
  {
    name: "IDLE-11 station path no human 045 RPC names in stationCashService",
    run() {
      const forbidden = [
        "get_cash_management_context",
        "open_cash_session",
        "create_cash_movement",
        "close_cash_session"
      ]
      for (const fn of forbidden) {
        if (new RegExp(`\\.rpc\\(['"]${fn}['"]`).test(stationCash)) {
          throw new Error(`station service must not call ${fn}`)
        }
      }
    }
  },
  {
    name: "IDLE-12 human cash-control still uses human cashService port",
    run() {
      if (!/openCashSession/.test(humanPort) || !/createHumanCashPort/.test(humanPort)) {
        throw new Error("human port unchanged")
      }
      const cashSvc = read("frontend/src/services/cashService.js")
      if (!/open_cash_session/.test(cashSvc)) throw new Error("human RPC via cashService")
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
