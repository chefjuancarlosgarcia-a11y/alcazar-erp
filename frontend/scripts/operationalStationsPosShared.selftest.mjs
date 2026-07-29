import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildStationCategoriesFromCatalogProducts,
  mapStationPosCatalogResponse,
  productCategoryIdForPos
} from "../src/utils/stationPosCatalogMapper.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const mig197 = read("supabase/schema/197_fix_operational_pin_module_station_type.sql")
const mig198 = read("supabase/schema/198_operational_station_pos_shared_foundation.sql")
const mig198test = read("supabase/schema/198_test_operational_station_pos_shared.sql")
const routes = read("frontend/src/routes/AppRoutes.jsx")
const posEntry = read("frontend/src/pages/StationPosEntry.jsx")
const facade = read("frontend/src/services/posOrdersFacade.js")
const portCtx = read("frontend/src/services/posOrdersPortContext.jsx")
const posFloorPlan = read("frontend/src/services/posFloorPlanService.js")
const stationPos = read("frontend/src/services/stationPosService.js")
const posPage = read("frontend/src/pages/POS.jsx")
const posTicket = read("frontend/src/components/PosTicketPanel.jsx")
const posClassic = read("frontend/src/components/PosClassicOperation.jsx")
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
      if (!/fetchFloorLayout/.test(facade)) throw new Error("facade exposes fetchFloorLayout")
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
  },
  {
    name: "POS-23 stationMode bypasses human POS role guard",
    run() {
      if (!/const canAccessPos = stationMode \|\| POS_ROLES\.includes\(user\?\.role\)/.test(posPage)) {
        throw new Error("stationMode must bypass human POS_ROLES guard")
      }
      if (!/if \(!canAccessPos\)/.test(posPage)) throw new Error("guard must use canAccessPos")
    }
  },
  {
    name: "POS-24 human /pos still requires POS_ROLES when stationMode absent",
    run() {
      if (!/module="pos"/.test(routes) || !/<POS \/>/.test(routes)) {
        throw new Error("human /pos route without stationMode prop")
      }
      if (!/POS_ROLES\.includes\(user\?\.role\)/.test(posPage)) {
        throw new Error("human role check must remain in POS")
      }
      if (!/stationMode = false/.test(posPage)) throw new Error("stationMode defaults false")
    }
  },
  {
    name: "POS-25 query params cannot enable stationMode",
    run() {
      if (/params\.get\(["']stationMode/.test(posPage)) {
        throw new Error("stationMode must not come from URL params")
      }
      if (/params\.get\(["']station/.test(posPage) && /stationMode/.test(posPage)) {
        throw new Error("no station query param for stationMode")
      }
      if (!/params\.get\("section"\)/.test(posPage)) throw new Error("URL params limited to section")
    }
  },
  {
    name: "POS-26 stationMode only from StationPosEntry prop",
    run() {
      if (!/<POS stationMode/.test(posEntry)) throw new Error("StationPosEntry must pass stationMode prop")
      if (/localStorage.*stationMode|getItem\([^)]*stationMode/.test(posPage)) {
        throw new Error("stationMode must not be read from storage")
      }
    }
  },
  {
    name: "POS-27 station floor uses port RPC not human get_pos_floor_layout",
    run() {
      if (!/stationMode\s*\?\s*await ordersPort\.fetchFloorLayout\(\)/.test(posPage)) {
        throw new Error("bootstrap/reload must call ordersPort.fetchFloorLayout in stationMode")
      }
      if (!/:\s*await getPosFloorLayout\(\)/.test(posPage)) {
        throw new Error("human path must keep getPosFloorLayout")
      }
      if (!/get_station_pos_floor_layout/.test(stationPos)) throw new Error("station RPC wrapper")
      if (!/get_pos_floor_layout/.test(posFloorPlan)) throw new Error("human floor service")
    }
  },
  {
    name: "POS-28 RPC floor errors are not treated as empty layout",
    run() {
      if (!/setFloorPlanLoadFailed\(true\)/.test(posPage)) {
        throw new Error("must flag floor load failure on RPC error")
      }
      if (!/remote\.error/.test(posPage) || !/floorPlanLoadFailed/.test(posClassic)) {
        throw new Error("surface load failure in classic operation UI")
      }
    }
  },
  {
    name: "POS-29 station facade adapter requires fetchFloorLayout",
    run() {
      if (!/typeof port\.fetchFloorLayout !== "function"/.test(stationPos)) {
        throw new Error("adapter must require fetchFloorLayout")
      }
      if (!/fetchFloorLayout:\s*\(\)\s*=>\s*port\.fetchFloorLayout\(\)/.test(stationPos)) {
        throw new Error("adapter must wire fetchFloorLayout")
      }
    }
  },
  {
    name: "POS-30 mapStationPosFloorResponse preserves zones tables coords",
    run() {
      if (!/export function mapStationPosFloorResponse/.test(stationPos)) {
        throw new Error("mapper export")
      }
      const fixture = {
        areas: [
          { id: "z1", name: "PRIMER NIVEL", sort_order: 1, width: 900, height: 520 },
          { id: "z2", name: "SEGUNDO NIVEL ENTRADA", sort_order: 2, width: 800, height: 480 },
          { id: "z3", name: "SEGUNDO NIVEL TERRAZA PRINCIPAL", sort_order: 3, width: 820, height: 500 }
        ],
        tables: [
          { id: "t1", zone_id: "z1", name: "M1", capacity: 4, x: 12, y: 18, manual_status: "disponible" },
          { id: "t2", zone_id: "z1", name: "M2", capacity: 2, x: 44, y: 22, manual_status: "disponible" }
        ],
        settings: { snap_to_grid: true, grid_size: 24, zoom: 1 },
        active_orders: []
      }
      const areas = (fixture.areas || []).map((z) => ({
        id: z.id,
        name: z.name,
        sortOrder: z.sort_order ?? 0,
        width: z.width ?? 800,
        height: z.height ?? 600
      }))
      const tables = (fixture.tables || []).map((t) => ({
        id: t.id,
        areaId: t.zone_id,
        name: t.name,
        x: t.x,
        y: t.y,
        capacity: t.capacity
      }))
      if (areas.length !== 3 || tables.length !== 2) throw new Error("fixture")
      const m1 = tables.find((t) => t.name === "M1")
      if (!m1 || m1.areaId !== "z1" || m1.x !== 12 || m1.capacity !== 4) throw new Error("M1 mapping")
      if (!/t\.areaId \|\| t\.zone_id/.test(stationPos)) throw new Error("mapper uses zone_id")
      if (!/x: t\.x/.test(stationPos) || !/capacity: t\.capacity/.test(stationPos)) {
        throw new Error("mapper preserves coords/capacity")
      }
    }
  },
  {
    name: "POS-31 station catalog uses get_station_pos_catalog not getPOSProducts",
    run() {
      if (!/get_station_pos_catalog/.test(stationPos)) throw new Error("station catalog RPC")
      if (!/if \(stationMode\)[\s\S]*stationPosPort\.fetchCatalog/.test(posPage)) {
        throw new Error("station catalog via port when stationMode")
      }
      if (!/getPOSProducts\(\)/.test(posPage)) throw new Error("human catalog path retained for /pos")
    }
  },
  {
    name: "POS-32 station catalog loads when user is null",
    run() {
      if (!/!user && !stationMode/.test(posPage)) throw new Error("human-only guard")
      if (!/if \(stationMode\)[\s\S]*stationPosPort\.fetchCatalog/.test(posPage)) {
        throw new Error("stationMode must fetch catalog without human user")
      }
    }
  },
  {
    name: "POS-33 stationMode never calls getPOSProducts in sale catalog effect",
    run() {
      const stationBlock = posPage.match(/if \(stationMode\) \{[\s\S]*?return \(\) => \{\s*mounted = false\s*\}/)
      if (!stationBlock) throw new Error("station catalog block")
      if (/getPOSProducts|getProductionAreas|getActiveRecipes|getPOSCatalogPage/.test(stationBlock[0])) {
        throw new Error("station catalog block must not call human catalog APIs")
      }
    }
  },
  {
    name: "POS-34 pos-products-updated refresh uses station port",
    run() {
      if (!/if \(stationMode\)[\s\S]*reloadStationSaleCatalog/.test(posPage)) {
        throw new Error("refresh must use reloadStationSaleCatalog in stationMode")
      }
    }
  },
  {
    name: "POS-35 station categories skip human localStorage persist",
    run() {
      if (!/if \(!stationMode\)[\s\S]*localStorage\.setItem\(POS_CATEGORIES_KEY/.test(posPage)) {
        throw new Error("station must not persist posCategories to localStorage")
      }
      if (!/buildStationCategoriesFromCatalogProducts/.test(posPage)) {
        throw new Error("station categories from RPC mapper")
      }
    }
  },
  {
    name: "POS-36 mapper fixture categories search and filter",
    run() {
      const fixture = {
        products: [
          { id: "p1", name: "Bruschetta", price: 45, category_id: "entradas", category_name: "Entradas", production_ready: true, product_type: "simple" },
          { id: "p2", name: "Margarita", price: 80, category_id: "pizzas", category_name: "Pizzas", production_ready: true, product_type: "pizza", variants: [{ id: "v1", size: "M", price: 80, is_active: true }] },
          { id: "p3", name: "Alitas combo", price: 95, category_id: "extras", category_name: "Extras", production_ready: true, product_type: "configurable", option_groups: [{ id: "g1", name: "Salsa" }] },
          { id: "p4", name: "Cappuccino", price: 28, category_id: "cafeteria", category_name: "Cafetería", production_ready: true, product_type: "simple" }
        ]
      }
      const products = mapStationPosCatalogResponse(fixture)
      const categories = buildStationCategoriesFromCatalogProducts(products)
      if (categories.length < 4) throw new Error("expected categories from fixture")
      const entradas = products.filter((p) => productCategoryIdForPos(p) === "entradas")
      if (entradas.length !== 1 || entradas[0].nombre !== "Bruschetta") throw new Error("category filter")
      const search = products.filter((p) => /marg/i.test(p.nombre || p.name))
      if (search.length !== 1 || !search[0].variants?.length) throw new Error("search + pizza variants")
      if (!products.every((p) => p.categoriaId && p.productionReady === true && p.estado === "activo")) {
        throw new Error("mapper aliases")
      }
    }
  },
  {
    name: "POS-37 incomplete station port fails closed on catalog",
    run() {
      if (!/!stationPosPort\?\.fetchCatalog/.test(posPage)) throw new Error("missing port guard")
      if (!/Puerto POS estación incompleto \(fetchCatalog\)/.test(posPage)) throw new Error("explicit port error")
    }
  },
  {
    name: "POS-38 obsolete categoriaActiva resets to first RPC category",
    run() {
      if (/if \(stationMode\) return undefined[\s\S]{0,120}localStorage\.setItem\(POS_CATEGORIES_KEY/.test(posPage)) {
        throw new Error("station must still normalize categoriaActiva, only skip localStorage write")
      }
      if (!/setCategoriaActiva\(activeCategories\[0\]\?\.id/.test(posPage)) {
        throw new Error("fallback to first active category")
      }
      const activeCategories = [
        { id: "entradas", name: "Entradas" },
        { id: "pizzas", name: "Pizzas" }
      ]
      let categoriaActiva = "obsolete-human-cache-id"
      if (!activeCategories.some((category) => category.id === categoriaActiva)) {
        categoriaActiva = activeCategories[0]?.id || ""
      }
      if (categoriaActiva !== "entradas") {
        throw new Error("expected first RPC category after obsolete selection")
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
