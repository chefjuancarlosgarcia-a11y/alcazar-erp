import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildStationCategoriesFromCatalogProducts,
  mapStationPosCatalogResponse,
  normalizeStationPosCatalogResponse,
  productCategoryIdForPos
} from "../src/utils/posCatalogCanonical.js"
import { DEFAULT_POS_CATEGORIES } from "../src/constants/posDefaultCategories.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const mig197 = read("supabase/schema/197_fix_operational_pin_module_station_type.sql")
const mig198 = read("supabase/schema/198_operational_station_pos_shared_foundation.sql")
const canonical = read("frontend/src/utils/posCatalogCanonical.js")
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
const posDishCatalog = read("frontend/src/components/PosDishCatalog.jsx")
const posServiceTerminal = read("frontend/src/components/PosServiceTerminal.jsx")
const posQuickSearch = read("frontend/src/components/PosProductQuickSearch.jsx")
const stationPosEntryCss = read("frontend/src/pages/StationPosEntry.css")
const posCss = read("frontend/src/pages/POS.css")
const access = read("frontend/src/components/OperationalAccessSection.jsx")

function stripSourceComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n\r]*/g, "")
}

function collectComponentImports(source) {
  const imports = new Set()
  const defaultRe = /import\s+([A-Z][A-Za-z0-9]*)\s+from\s+["']([^"']+)["']/g
  const namedRe = /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g
  let match
  while ((match = defaultRe.exec(source))) imports.add(match[1])
  while ((match = namedRe.exec(source))) {
    match[1].split(",").forEach((part) => {
      const name = part.trim().split(/\s+as\s+/)[0].trim()
      if (/^[A-Z]/.test(name)) imports.add(name)
    })
  }
  return imports
}

function collectLocalFunctionComponents(source) {
  const names = new Set()
  const re = /function\s+([A-Z][A-Za-z0-9]*)\s*\(/g
  let match
  while ((match = re.exec(source))) names.add(match[1])
  return names
}

function collectJsxComponentTags(source) {
  const tags = new Set()
  const re = /<([A-Z][A-Za-z0-9]*)\b/g
  let match
  while ((match = re.exec(source))) tags.add(match[1])
  return tags
}

const EXTRACTED_POS_COMPONENTS = [
  { tag: "PosClassicOperation", importPath: "../components/PosClassicOperation", file: posClassic },
  { tag: "PosDishCatalog", importPath: "../components/PosDishCatalog", file: posDishCatalog },
  { tag: "ToastContainer", importPath: "../components/ToastContainer", file: read("frontend/src/components/ToastContainer.jsx") }
]

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
      const products = normalizeStationPosCatalogResponse(fixture)
      const categories = buildStationCategoriesFromCatalogProducts(products, DEFAULT_POS_CATEGORIES)
      if (categories.length < 4) throw new Error("expected categories from fixture")
      if (categories.find((c) => c.id === "pizzas")?.icon !== "🍕") {
        throw new Error("canonical category icon expected for pizzas")
      }
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
  },
  {
    name: "POS-39 parity A station catalog RPC",
    run() {
      if (!/get_station_pos_catalog/.test(stationPos)) throw new Error("station catalog RPC")
    }
  },
  {
    name: "POS-40 parity B obsolete category normalizes",
    run() {
      if (!/setCategoriaActiva\(activeCategories\[0\]\?\.id/.test(posPage)) throw new Error("normalize categoriaActiva")
    }
  },
  {
    name: "POS-41 parity C station never writes POS_CATEGORIES_KEY",
    run() {
      if (!/if \(!stationMode\)[\s\S]*localStorage\.setItem\(POS_CATEGORIES_KEY/.test(posPage)) {
        throw new Error("localStorage guard")
      }
      const stationBlock = posPage.match(/if \(stationMode\) \{[\s\S]*?return \(\) => \{\s*mounted = false\s*\}/)
      if (stationBlock && /localStorage\.setItem\(POS_CATEGORIES_KEY/.test(stationBlock[0])) {
        throw new Error("station must not write POS_CATEGORIES_KEY")
      }
    }
  },
  {
    name: "POS-42 parity D image_url maps to imagen",
    run() {
      const row = normalizeStationPosCatalogResponse({
        products: [{ id: "p1", name: "Taco", price: 10, category_id: "entradas", image_url: "https://x.test/t.jpg", production_ready: true }]
      })
      if (row[0].imagen !== "https://x.test/t.jpg") throw new Error("imagen missing")
    }
  },
  {
    name: "POS-43 parity E monogram only without image",
    run() {
      const row = normalizeStationPosCatalogResponse({
        products: [{ id: "p2", name: "Agua", price: 5, category_id: "barra", production_ready: true }]
      })
      if (row[0].imagen) throw new Error("imagen must be empty without image_url")
    }
  },
  {
    name: "POS-44 parity F mesa selection no server open claim",
    run() {
      if (!/Mesa disponible\. Agrega productos/.test(posPage)) throw new Error("empty mesa copy")
      if (/Mesa en servicio/.test(posPage) && /seleccionarMesaOperacion[\s\S]{0,800}Mesa en servicio/.test(posPage)) {
        throw new Error("must not claim server open on select alone")
      }
    }
  },
  {
    name: "POS-45 parity G add uses confirmed order_id",
    run() {
      if (!/openPosTableService/.test(posPage)) throw new Error("open before add")
      if (!/resolvePosOpenOrderId\(created\)/.test(posPage)) throw new Error("resolve order_id from open response")
      if (!/orderId = resolvedOrderId/.test(posPage)) throw new Error("assign resolved order id")
    }
  },
  {
    name: "POS-46 parity H owner mismatch message",
    run() {
      if (!/Esta mesa está siendo atendida por otro mesero/.test(posPage)) throw new Error("owner message")
      if (!/STATION_POS_ORDER_OWNER_MISMATCH/.test(read("frontend/src/services/posOrdersService.js"))) {
        throw new Error("error code mapping")
      }
    }
  },
  {
    name: "POS-47 parity I human catalog unchanged",
    run() {
      if (!/getPOSProducts\(\)/.test(posPage)) throw new Error("human getPOSProducts")
      if (!/from \"\.\.\/utils\/posCatalogCanonical\"/.test(read("frontend/src/services/posProductsService.js"))) {
        throw new Error("human reuses canonical mapper")
      }
    }
  },
  {
    name: "POS-48 parity J no payments in stationMode",
    run() {
      if (/create_pos_split_payment/.test(stationPos)) throw new Error("no split in station service")
      if (!/!stationMode/.test(posTicket)) throw new Error("ticket hides payments in station")
    }
  },
  {
    name: "POS-49 parity K canonical category colors",
    run() {
      const categories = buildStationCategoriesFromCatalogProducts(
        normalizeStationPosCatalogResponse({
          products: [{ id: "p1", name: "X", category_id: "pizzas", production_ready: true }]
        }),
        DEFAULT_POS_CATEGORIES
      )
      const pizzas = categories.find((c) => c.id === "pizzas")
      if (!pizzas || pizzas.color !== "#f97316" || pizzas.icon !== "🍕") throw new Error("canonical pizza tab")
      if (pizzas.icon === "M") throw new Error("no artificial M icon")
    }
  },
  {
    name: "POS-52 parity N open error blocks add",
    run() {
      if (!/if \(created\.error\) throw new Error\(formatStationPosRpcError/.test(posPage)) {
        throw new Error("open error throws before add")
      }
    }
  },
  {
    name: "POS-53 parity O idempotency key ref",
    run() {
      if (!/tableOpenIdempotencyRef/.test(posPage)) throw new Error("table open idempotency ref")
      if (!/createPosRpcIdempotencyKey/.test(posPage)) throw new Error("UUID idempotency key")
    }
  },
  {
    name: "POS-54 POS imports PosClassicOperation default",
    run() {
      if (!/import\s+PosClassicOperation\s+from\s+["']\.\.\/components\/PosClassicOperation["']/.test(posPage)) {
        throw new Error("missing PosClassicOperation default import")
      }
      if (!/export default function PosClassicOperation/.test(posClassic)) {
        throw new Error("PosClassicOperation.jsx must export default")
      }
    }
  },
  {
    name: "POS-55 POS imports PosDishCatalog default",
    run() {
      if (!/import\s+PosDishCatalog\s+from\s+["']\.\.\/components\/PosDishCatalog["']/.test(posPage)) {
        throw new Error("missing PosDishCatalog default import")
      }
      if (!/export default function PosDishCatalog/.test(posDishCatalog)) {
        throw new Error("PosDishCatalog.jsx must export default")
      }
    }
  },
  {
    name: "POS-56 POS extracted JSX components have import or local definition",
    run() {
      const executable = stripSourceComments(posPage)
      const imports = collectComponentImports(posPage)
      const localFns = collectLocalFunctionComponents(posPage)
      const jsxTags = collectJsxComponentTags(executable)
      for (const { tag, importPath } of EXTRACTED_POS_COMPONENTS) {
        if (!jsxTags.has(tag)) continue
        if (!imports.has(tag)) throw new Error(`${tag} used in JSX but not imported`)
        if (!posPage.includes(`from "${importPath}"`) && !posPage.includes(`from '${importPath}'`)) {
          throw new Error(`${tag} import path must be ${importPath}`)
        }
      }
      for (const tag of jsxTags) {
        if (EXTRACTED_POS_COMPONENTS.some((row) => row.tag === tag)) continue
        if (imports.has(tag) || localFns.has(tag)) continue
        throw new Error(`${tag} JSX tag without import or local function definition`)
      }
    }
  },
  {
    name: "POS-57 interaction scroll station entry overflow",
    run() {
      if (!/station-pos-entry--active[\s\S]*overflow-y:\s*auto/.test(stationPosEntryCss)) {
        throw new Error("station entry allows vertical scroll")
      }
      if (!/station-pos-entry--active[\s\S]*min-height:\s*0/.test(stationPosEntryCss)) {
        throw new Error("station entry flex min-height chain")
      }
    }
  },
  {
    name: "POS-58 interaction workspace body scroll in station",
    run() {
      if (!/height:\s*100dvh/.test(stationPosEntryCss)) throw new Error("station shell scroll height")
      if (!/overflow-y:\s*auto/.test(stationPosEntryCss)) throw new Error("station shell scroll")
      const stationWorkspace = posCss.match(/\.station-pos-entry--active \.pos-classic-workspace-body\s*\{[^}]+\}/)
      if (!stationWorkspace) throw new Error("station workspace rule missing")
      if (/overflow-y:\s*auto/.test(stationWorkspace[0])) {
        throw new Error("nested workspace scroll must not compete with shell")
      }
      if (!/overflow:\s*visible/.test(stationWorkspace[0])) {
        throw new Error("workspace body in document flow")
      }
    }
  },
  {
    name: "POS-59 interaction no global wheel lock in POS",
    run() {
      if (/addEventListener\(["']wheel["']/.test(posPage)) throw new Error("global wheel listener")
      if (/document\.body\.style\.overflow\s*=\s*["']hidden["']/.test(posPage)) throw new Error("body scroll lock in POS")
    }
  },
  {
    name: "POS-60 interaction quick search keydown repeat guard",
    run() {
      if (!/event\.repeat/.test(posQuickSearch)) throw new Error("repeat guard")
      if (!/removeEventListener\(["']mousedown["']/.test(posQuickSearch)) throw new Error("mousedown cleanup")
    }
  },
  {
    name: "POS-61 interaction port provider cleanup on unmount",
    run() {
      if (!/useEffect\(\(\) => \(\) => clearStationPosOrdersDelegate\(\)/.test(posEntry)) throw new Error("delegate cleanup")
      if (!/return setStationPosOrdersDelegate\(port\)/.test(portCtx)) throw new Error("provider registers delegate once")
    }
  },
  {
    name: "POS-62 interaction grid passes agregarAOrden",
    run() {
      if (!/onAddProduct=\{agregarAOrden\}/.test(posClassic)) throw new Error("grid callback")
    }
  },
  {
    name: "POS-63 interaction simple product skips config modal",
    run() {
      if (!/if \(!productNeedsQuickConfiguration\(item\)\)/.test(posPage)) throw new Error("simple product fast path")
      if (!/void confirmarAgregarItem\(item, 1\)/.test(posPage)) throw new Error("direct add for simple product")
    }
  },
  {
    name: "POS-64 interaction open before add when no order",
    run() {
      if (!/if \(!orderId\)/.test(posPage)) throw new Error("open guard")
      if (!/await openPosTableService/.test(posPage)) throw new Error("openPosTableService call")
    }
  },
  {
    name: "POS-65 interaction open failure blocks add",
    run() {
      if (!/if \(created\.error\) throw new Error\(formatStationPosRpcError/.test(posPage)) {
        throw new Error("open error throws")
      }
    }
  },
  {
    name: "POS-66 interaction double add guard",
    run() {
      if (!/productAddInFlightRef/.test(posPage)) throw new Error("in-flight guard ref")
      if (!/productAddInFlightRef\.current = false/.test(posPage)) throw new Error("guard reset")
    }
  },
  {
    name: "POS-67 interaction visible add error message",
    run() {
      if (!/formatStationPosAddError/.test(posPage)) throw new Error("add error formatter")
      if (!/setOrdenError\(formatStationPosAddError/.test(posPage)) throw new Error("stable add error")
    }
  },
  {
    name: "POS-68 interaction station terminal class",
    run() {
      if (!/stationMode=\{stationMode\}/.test(posClassic)) throw new Error("stationMode passed to terminal")
      if (!/pos-classic-terminal--station/.test(posServiceTerminal)) throw new Error("station terminal class")
    }
  },
  {
    name: "POS-69 interaction human POS unchanged entry",
    run() {
      if (!/path="\/pos"/.test(routes)) throw new Error("/pos route")
      if (!/<POS\s*\/>/.test(routes)) throw new Error("human POS route element")
      if (/stationMode/.test(routes)) throw new Error("human route must not pass stationMode")
    }
  },
  {
    name: "POS-70 interaction station no payments",
    run() {
      if (!/stationMode/.test(posPage)) throw new Error("stationMode")
      if (/create_pos_split_payment/.test(stationPos)) throw new Error("no split payment")
    }
  },
  {
    name: "POS-71 interaction mesa select no auto open",
    run() {
      if (!/Mesa disponible\. Agrega productos/.test(posPage)) throw new Error("no auto open copy")
    }
  },
  {
    name: "POS-72 interaction search not overwritten by hotkeys",
    run() {
      if (/window\.addEventListener\(["']keydown["']/.test(posPage)) throw new Error("global keydown in POS")
      if (/document\.addEventListener\(["']keydown["']/.test(posPage)) throw new Error("document keydown in POS")
    }
  },
  {
    name: "POS-73 interaction openMeta order_id fallback",
    run() {
      if (!/created\?\.openMeta\?\.order_id/.test(posPage)) throw new Error("openMeta fallback")
    }
  },
  {
    name: "POS-74 interaction cargar mesa after add",
    run() {
      if (!/await cargarMesaDesdeSupabase\(ordenMesa, orderId\)/.test(posPage)) throw new Error("refresh ticket after add")
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
