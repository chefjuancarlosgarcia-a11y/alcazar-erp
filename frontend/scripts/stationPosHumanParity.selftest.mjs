/**
 * Static regression for station POS human parity (199 + canonical DTO).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  buildStationCategoriesFromCatalogProducts,
  normalizeStationPosCatalogResponse
} from "../src/utils/posCatalogCanonical.js"
import { DEFAULT_POS_CATEGORIES } from "../src/constants/posDefaultCategories.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8")

const mig199 = read("supabase/schema/199_fix_operational_station_pos_catalog_parity.sql")
const posPage = read("frontend/src/pages/POS.jsx")
const stationPos = read("frontend/src/services/stationPosService.js")

const tests = [
  {
    name: "PARITY-199-single-commit",
    run() {
      if (!/^begin;/im.test(mig199) || !/^commit;/im.test(mig199)) throw new Error("BEGIN/COMMIT required")
    }
  },
  {
    name: "PARITY-199-no-get_pos_product_image_url",
    run() {
      if (/get_pos_product_image_url/.test(mig199)) throw new Error("no N+1 image RPC in SQL")
    }
  },
  {
    name: "PARITY-canonical-shared-path",
    run() {
      if (!/mapPOSProductFromSupabase/.test(read("frontend/src/utils/posCatalogCanonical.js"))) {
        throw new Error("canonical mapper")
      }
      if (/buildStationCategoriesFromCatalogProducts[\s\S]*icon: \"M\"/.test(
        read("frontend/src/utils/posCatalogCanonical.js")
      )) {
        throw new Error("no default M icon in category builder")
      }
    }
  },
  {
    name: "PARITY-DTO-imagen-from-batch",
    run() {
      const products = normalizeStationPosCatalogResponse({
        products: [{
          id: "x",
          name: "Test",
          price: 1,
          category_id: "entradas",
          image_url: "https://cdn.test/p.png",
          production_ready: true
        }]
      })
      if (products[0].imagen !== "https://cdn.test/p.png") throw new Error("imagen")
    }
  },
  {
    name: "PARITY-no-service_role-frontend",
    run() {
      for (const rel of [
        "frontend/src/services/stationPosService.js",
        "frontend/src/utils/posCatalogCanonical.js",
        "frontend/src/pages/POS.jsx"
      ]) {
        if (/service_role/.test(read(rel))) throw new Error(`service_role in ${rel}`)
      }
    }
  },
  {
    name: "PARITY-station-no-human-catalog-direct",
    run() {
      const block = posPage.match(/if \(stationMode\) \{[\s\S]*?return \(\) => \{\s*mounted = false\s*\}/)
      if (!block) throw new Error("station block")
      if (/getPOSProducts|getProductionAreas/.test(block[0])) throw new Error("human APIs in station block")
    }
  },
  {
    name: "PARITY-production-areas-derived",
    run() {
      if (!/deriveProductionAreasFromCatalogProducts/.test(posPage)) throw new Error("derive areas in station load")
    }
  },
  {
    name: "PARITY-categories-default-merge",
    run() {
      if (!/DEFAULT_POS_CATEGORIES/.test(posPage)) throw new Error("DEFAULT_POS_CATEGORIES in POS")
      const cats = buildStationCategoriesFromCatalogProducts(
        normalizeStationPosCatalogResponse({
          products: [{ id: "1", name: "A", category_id: "barra", production_ready: true }]
        }),
        DEFAULT_POS_CATEGORIES
      )
      if (cats[0]?.icon !== "🍹") throw new Error("barra icon")
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
console.log(`stationPosHumanParity.selftest: ${tests.length} passed`)
