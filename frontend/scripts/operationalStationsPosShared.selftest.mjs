import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const mig197 = read("supabase/schema/197_fix_operational_pin_module_station_type.sql")
const mig198 = read("supabase/schema/198_operational_station_pos_shared_foundation.sql")
const mig198test = read("supabase/schema/198_test_operational_station_pos_shared.sql")
const routes = read("frontend/src/routes/AppRoutes.jsx")
const posEntry = read("frontend/src/pages/StationPosEntry.jsx")
const facade = read("frontend/src/services/posOrdersFacade.js")
const portCtx = read("frontend/src/services/posOrdersPortContext.jsx")
const stationPos = read("frontend/src/services/stationPosService.js")
const posPage = read("frontend/src/pages/POS.jsx")
const posTicket = read("frontend/src/components/PosTicketPanel.jsx")
const access = read("frontend/src/components/OperationalAccessSection.jsx")

const tests = [
  {
    name: "POS-1 migration 197 module map",
    run() {
      if (!/v_required_module/.test(mig197)) throw new Error("required module")
      if (!/absolute_expires_at/.test(mig197)) throw new Error("absolute column")
    }
  },
  {
    name: "POS-2 migration 198 flag off",
    run() {
      if (!/operational_station_pos_enabled/.test(mig198)) throw new Error("flag")
      if (!/jsonb_build_object\('enabled', false/.test(mig198)) throw new Error("default false")
    }
  },
  {
    name: "POS-3 route station pos",
    run() {
      if (!/\/station\/pos/.test(routes) || !/StationPosEntry/.test(routes)) throw new Error("route")
    }
  },
  {
    name: "POS-4 facade no silent station fallback",
    run() {
      if (!/setStationPosOrdersDelegate/.test(facade)) throw new Error("delegate setter")
      if (!/stationDelegate\?\.\[name\]/.test(facade)) throw new Error("explicit delegate")
      if (!/human\[name\]/.test(facade)) throw new Error("human when no delegate")
    }
  },
  {
    name: "POS-5 station port no direct from",
    run() {
      if (/\.from\("pos_orders"\)/.test(stationPos)) throw new Error("no direct table access")
    }
  },
  {
    name: "POS-6 zero stationOnlyError stubs",
    run() {
      if (/stationOnlyError/.test(stationPos)) throw new Error("stubs remain")
    }
  },
  {
    name: "POS-7 pin module pos",
    run() {
      if (!/module="pos"/.test(posEntry)) throw new Error("pos pin module")
    }
  },
  {
    name: "POS-8 flag false UI",
    run() {
      if (!/operational_station_pos_enabled = false/.test(posEntry)) throw new Error("disabled copy")
    }
  },
  {
    name: "POS-9 POS uses facade",
    run() {
      if (!/posOrdersFacade/.test(posPage)) throw new Error("POS facade import")
    }
  },
  {
    name: "POS-10 RRHH multi station",
    run() {
      if (/station_type === "cash"/.test(access)) throw new Error("cash-only filter removed")
      if (!/station_type/.test(access)) throw new Error("show station type")
    }
  },
  {
    name: "POS-11 no split payment in station service",
    run() {
      if (/create_pos_split_payment/.test(stationPos)) throw new Error("no payments")
    }
  },
  {
    name: "POS-12 all station RPC wrappers wired",
    run() {
      const rpcs = [
        "open_station_pos_table_service",
        "get_station_pos_floor_layout",
        "get_station_pos_order",
        "get_station_pos_table_events",
        "get_station_pos_order_events",
        "get_station_pos_catalog",
        "add_station_pos_order_item",
        "send_station_pos_order_to_production",
        "request_station_pos_order_bill",
        "send_station_pos_order_to_cashier",
        "release_station_pos_table_service"
      ]
      rpcs.forEach((rpc) => {
        if (!stationPos.includes(rpc)) throw new Error(`missing ${rpc}`)
      })
    }
  },
  {
    name: "POS-13 PosOrdersPortProvider mount",
    run() {
      if (!/PosOrdersPortProvider/.test(posEntry)) throw new Error("provider")
      if (!/setStationPosOrdersDelegate/.test(portCtx)) throw new Error("provider sets delegate")
    }
  },
  {
    name: "POS-14 stationMode hides cobro utilities",
    run() {
      if (!/stationMode/.test(posPage)) throw new Error("stationMode prop")
      if (!/!stationMode && canRequestCashier/.test(posTicket)) throw new Error("hide solicitar cobro")
      if (!/!stationMode &&/.test(posTicket)) throw new Error("hide split")
    }
  },
  {
    name: "POS-15 SQL wrappers present in 198",
    run() {
      const fns = [
        "list_station_pos_tables",
        "get_station_pos_catalog",
        "get_station_pos_table_events",
        "send_pos_order_to_production_for_operator",
        "station_pos_compute_line_item_pricing"
      ]
      fns.forEach((fn) => {
        if (!mig198.includes(fn)) throw new Error(`198 missing ${fn}`)
      })
    }
  },
  {
    name: "POS-16 SQL tests 25+ scenarios",
    run() {
      const matches = mig198test.match(/return query select '/g) || []
      if (matches.length < 25) throw new Error(`only ${matches.length} scenarios`)
    }
  },
  {
    name: "POS-17 no createPosSplitPayment in station path",
    run() {
      if (/createPosSplitPayment/.test(stationPos)) throw new Error("split in station service")
    }
  },
  {
    name: "POS-19 no synthetic Salón fallback",
    run() {
      if (/pos_floor_zone === id \? "Salón"/.test(stationPos)) throw new Error("synthetic zone")
    }
  },
  {
    name: "POS-20 table events RPC wired",
    run() {
      if (!/get_station_pos_table_events/.test(stationPos)) throw new Error("table events")
      if (/getTableOrderEvents\(\)[\s\S]*data:\s*\[\]/.test(stationPos)) throw new Error("empty stub")
    }
  },
  {
    name: "POS-18 design doc",
    run() {
      read("docs/operational-station-pos-shared-design.md")
    }
  },
  {
    name: "POS-21 idempotency keys are RFC UUID only",
    run() {
      const idem = read("frontend/src/services/stationPosIdempotency.js")
      if (/\$\{actionType\}-\$\{crypto\.randomUUID/.test(idem)) {
        throw new Error("idempotency key must not prefix actionType (198 UUID contract)")
      }
      if (!/crypto\.randomUUID\(\)/.test(idem)) throw new Error("must use crypto.randomUUID()")
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      // Static sample: every mutation path uses runStationPosIdempotentRpc → acquireStationPosIdempotencyKey
      const mutations = [
        "open_table",
        "add_item",
        "clear_drafts",
        "remove_draft",
        "update_item_qty",
        "update_item_notes",
        "send_to_production",
        "request_bill",
        "send_to_cashier",
        "release_table"
      ]
      mutations.forEach((m) => {
        if (!stationPos.includes(`runStationPosIdempotentRpc("${m}"`)) {
          throw new Error(`mutation ${m} must use runStationPosIdempotentRpc`)
        }
      })
      if (!uuidRe.test("a0000001-0000-4000-8000-000000000001")) throw new Error("uuid self-check")
    }
  },
  {
    name: "POS-22 idempotency store excludes secrets",
    run() {
      const idem = read("frontend/src/services/stationPosIdempotency.js")
      if (
        /intents\.push\(\{[^}]*(pin|session_token|operator_session)/i.test(idem)
      ) {
        throw new Error("do not store operator secrets in idempotency intents")
      }
    }
  }
]

let failed = 0
for (const t of tests) {
  try {
    t.run()
    console.log(`PASS ${t.name}`)
  } catch (e) {
    failed += 1
    console.error(`FAIL ${t.name}: ${e.message}`)
  }
}
if (failed) process.exit(1)
console.log(`operationalStationsPosShared.selftest: ${tests.length} passed`)
