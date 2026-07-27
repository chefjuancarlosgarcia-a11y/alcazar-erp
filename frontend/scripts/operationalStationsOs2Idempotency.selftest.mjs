import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  STATION_CASH_IDEMPOTENCY_STORAGE_KEY,
  STATION_CASH_IDEMPOTENCY_UNKNOWN_MESSAGE,
  acquireStationCashIdempotencyKey,
  completeStationCashIdempotencyKey,
  fingerprintStationCashPayload,
  isStationCashAmbiguousError,
  isStationCashBusinessError,
  listUnknownStationCashIntents,
  markStationCashIdempotencyUnknown
} from "../src/services/stationCashIdempotency.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8")
}

const sql194 = read("supabase/schema/194_station_cash_operator_wrappers.sql")
const stationCash = read("frontend/src/services/stationCashService.js")
const idempJs = read("frontend/src/services/stationCashIdempotency.js")

const tests = [
  {
    name: "IDEM-1 no per-call UUID in stationCashService",
    run() {
      if (/function idempotencyKey|crypto\.randomUUID\(\)/.test(stationCash)) {
        throw new Error("stationCashService must not mint new UUID per RPC")
      }
      if (!/runStationCashIdempotentRpc/.test(stationCash)) throw new Error("idempotent wrapper required")
    }
  },
  {
    name: "IDEM-2 sessionStorage only for pending keys",
    run() {
      if (/localStorage/.test(idempJs)) throw new Error("no localStorage for idempotency")
      if (!/sessionStorage/.test(idempJs)) throw new Error("must use sessionStorage")
    }
  },
  {
    name: "IDEM-3 reuse key same fingerprint in flight",
    run() {
      global.sessionStorage = {
        _m: new Map(),
        getItem(k) {
          return this._m.get(k) ?? null
        },
        setItem(k, v) {
          this._m.set(k, v)
        },
        removeItem(k) {
          this._m.delete(k)
        }
      }
      const payload = { movementType: "sale_cash", amount: 10, reason: "", reference: "", orderId: null }
      const a = acquireStationCashIdempotencyKey("movement", payload)
      const b = acquireStationCashIdempotencyKey("movement", payload)
      if (a.key !== b.key) throw new Error("double intent must reuse key")
      completeStationCashIdempotencyKey(a.key)
    }
  },
  {
    name: "IDEM-4 unknown marks retryable state",
    run() {
      global.sessionStorage = {
        _m: new Map(),
        getItem(k) {
          return this._m.get(k) ?? null
        },
        setItem(k, v) {
          this._m.set(k, v)
        },
        removeItem(k) {
          this._m.delete(k)
        }
      }
      const { key } = acquireStationCashIdempotencyKey("sale", { orderId: "x", amount: 1 })
      markStationCashIdempotencyUnknown(key)
      if (!listUnknownStationCashIntents().some((i) => i.key === key)) throw new Error("unknown intent persisted")
    }
  },
  {
    name: "IDEM-5 SQL idempotency_begin + fingerprint column",
    run() {
      if (!/request_fingerprint/.test(sql194)) throw new Error("fingerprint column")
      if (!/station_cash_idempotency_begin/.test(sql194)) throw new Error("begin helper")
      if (!/Conflicto de idempotencia/.test(sql194)) throw new Error("conflict error")
      if (!/for update/i.test(sql194)) throw new Error("row lock for concurrency")
    }
  },
  {
    name: "IDEM-6 replay does not extend idle on cache hit",
    run() {
      const openBlock = sql194.match(/function public.open_station_cash_session[\s\S]*?\$\$;/)
      if (!openBlock?.[0]?.includes("resolve_station_cash_operator_context(p_operator_session_token, false)")) {
        throw new Error("open resolves without idle extend before idempotency")
      }
      if (!/if v_cached is not null then\s+return v_cached/.test(openBlock[0])) {
        throw new Error("cached replay short-circuit")
      }
      if (!/station_cash_extend_operator_idle/.test(openBlock[0])) {
        throw new Error("extend only on new mutation")
      }
    }
  },
  {
    name: "IDEM-7 close persists idempotency complete",
    run() {
      const block = sql194.match(/function public.close_station_cash_session[\s\S]*?\$\$;/)
      if (!block?.[0]?.includes("station_cash_idempotency_complete")) {
        throw new Error("close must complete idempotency row")
      }
    }
  },
  {
    name: "IDEM-8 sale uses sale operation idempotency",
    run() {
      const block = sql194.match(/function public.record_station_cash_sale[\s\S]*?\$\$;/)
      if (!block?.[0]?.includes("'sale', v_fingerprint")) throw new Error("sale operation scope")
    }
  },
  {
    name: "IDEM-9 no operator token in idempotency table",
    run() {
      if (/session_token|operator_pin|p_pin/i.test(sql194.match(/operational_station_cash_idempotency[\s\S]*?primary key/)?.[0] || "")) {
        throw new Error("must not store secrets in idempotency table")
      }
    }
  },
  {
    name: "IDEM-10 ambiguous vs business error classification",
    run() {
      if (!isStationCashBusinessError({ message: "Ya existe una caja abierta." })) {
        throw new Error("business")
      }
      if (!isStationCashAmbiguousError({ message: "Failed to fetch" })) throw new Error("ambiguous")
      if (STATION_CASH_IDEMPOTENCY_UNKNOWN_MESSAGE.length < 10) throw new Error("user message")
    }
  },
  {
    name: "IDEM-11 fingerprint stable",
    run() {
      const a = fingerprintStationCashPayload("open", { openingAmount: 1, notes: "" })
      const b = fingerprintStationCashPayload("open", { notes: "", openingAmount: 1 })
      if (a !== b) throw new Error("fingerprint order independent")
    }
  },
  {
    name: "IDEM-12 require idempotency key server-side",
    run() {
      if (!/Se requiere clave de idempotencia/.test(sql194)) throw new Error("server requires key")
    }
  },
  {
    name: "IDEM-13 fingerprint uses extensions.digest",
    run() {
      const fp = sql194.match(/function public\.station_cash_request_fingerprint[\s\S]*?\$\$;/)
      if (!fp?.[0]?.includes("extensions.digest(")) throw new Error("extensions.digest required")
      if (/public\.digest/.test(fp[0])) throw new Error("no public.digest in fingerprint")
      if (!/set search_path = ''/.test(fp[0])) throw new Error("empty search_path on fingerprint fn")
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
