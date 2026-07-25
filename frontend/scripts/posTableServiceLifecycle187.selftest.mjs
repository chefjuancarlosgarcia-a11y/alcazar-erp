/**
 * Offline static regression for 187 POS table service lifecycle.
 * Run: node frontend/scripts/posTableServiceLifecycle187.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const migration187 = readFileSync(resolve(root, "supabase/schema/187_pos_table_service_lifecycle.sql"), "utf8")
const serviceJs = readFileSync(resolve(root, "frontend/src/services/posOrdersService.js"), "utf8")
const posJsx = readFileSync(resolve(root, "frontend/src/pages/POS.jsx"), "utf8")
const ticketPanel = readFileSync(resolve(root, "frontend/src/components/PosTicketPanel.jsx"), "utf8")

function extractConfirmAddBlock(source) {
  const start = source.indexOf("async function confirmarAgregarItem")
  const end = source.indexOf("async function handleChangeQuantity", start)
  if (start < 0 || end < 0) return ""
  return source.slice(start, end)
}

const confirmAddBlock = extractConfirmAddBlock(posJsx)

const tests = [
  {
    name: "187 migration defines open_pos_table_service",
    run() {
      if (!/create or replace function public\.open_pos_table_service/i.test(migration187)) {
        throw new Error("missing open_pos_table_service")
      }
    }
  },
  {
    name: "187 migration defines release_pos_table_service",
    run() {
      if (!/create or replace function public\.release_pos_table_service/i.test(migration187)) {
        throw new Error("missing release_pos_table_service")
      }
    }
  },
  {
    name: "187 migration aborts on duplicate active orders",
    run() {
      if (!/duplicate active orders/i.test(migration187)) throw new Error("missing duplicate gate")
      if (!/raise exception/i.test(migration187)) throw new Error("missing abort")
    }
  },
  {
    name: "187 migration dependency order: active_statuses < predicate < gate < unique index",
    run() {
      const posActive = migration187.search(/create or replace function public\.pos_table_service_active_statuses/i)
      const posPredicate = migration187.search(/create or replace function public\.pos_dine_in_table_service_predicate/i)
      const posGate = migration187.search(/^do \$\$/im)
      const posIndex = migration187.search(/create unique index if not exists pos_orders_one_active_service_per_table/i)

      if (posActive < 0) throw new Error("missing pos_table_service_active_statuses create")
      if (posPredicate < 0) throw new Error("missing pos_dine_in_table_service_predicate create")
      if (posGate < 0) throw new Error("missing gate DO block")
      if (posIndex < 0) throw new Error("missing unique index create")

      if (!(posActive < posPredicate && posPredicate < posGate && posGate < posIndex)) {
        throw new Error(
          `expected active_statuses (${posActive}) < predicate (${posPredicate}) < gate (${posGate}) < index (${posIndex})`
        )
      }
    }
  },
  {
    name: "187 migration uses single BEGIN/COMMIT transaction",
    run() {
      const beginCount = (migration187.match(/^begin;$/gim) || []).length
      const commitCount = (migration187.match(/^commit;$/gim) || []).length
      if (beginCount !== 1) throw new Error(`expected exactly 1 BEGIN, found ${beginCount}`)
      if (commitCount !== 1) throw new Error(`expected exactly 1 COMMIT, found ${commitCount}`)
      const beginPos = migration187.search(/^begin;$/im)
      const commitPos = migration187.search(/^commit;$/im)
      if (beginPos >= commitPos) throw new Error("BEGIN must precede COMMIT")
    }
  },
  {
    name: "187 gate and index share dine_in predicate",
    run() {
      if (!/pos_dine_in_table_service_predicate\(o\.sales_channel, o\.table_id, o\.status\)/.test(migration187)) {
        throw new Error("gate must use pos_dine_in_table_service_predicate")
      }
      if (!/pos_dine_in_table_service_predicate\(sales_channel, table_id, status\)/.test(migration187)) {
        throw new Error("index must use pos_dine_in_table_service_predicate")
      }
    }
  },
  {
    name: "187 open_pos_table_service is dine_in only",
    run() {
      if (!/supports dine_in table service only/i.test(migration187)) {
        throw new Error("open must reject non-dine-in channels")
      }
    }
  },
  {
    name: "187 table helpers filter sales_channel dine_in",
    run() {
      const helpers = [
        "pos_table_is_zombie_open",
        "pos_table_has_reusable_active_order",
        "pos_table_has_billing_block"
      ]
      for (const name of helpers) {
        const block = migration187.slice(
          migration187.indexOf(`function public.${name}`),
          migration187.indexOf("$$;", migration187.indexOf(`function public.${name}`)) + 3
        )
        if (!/sales_channel = 'dine_in'/.test(block)) {
          throw new Error(`${name} must filter dine_in`)
        }
      }
    }
  },
  {
    name: "posOrdersService exports openPosTableService RPC wrapper",
    run() {
      if (!/export async function openPosTableService/.test(serviceJs)) throw new Error("missing openPosTableService")
      if (!/supabase\.rpc\("open_pos_table_service"/.test(serviceJs)) throw new Error("missing RPC call")
    }
  },
  {
    name: "posOrdersService exports releasePosTableService RPC wrapper",
    run() {
      if (!/export async function releasePosTableService/.test(serviceJs)) throw new Error("missing releasePosTableService")
    }
  },
  {
    name: "POS dine-in open uses RPC not legacy INSERT in confirmarAgregarItem",
    run() {
      if (!/salesChannel === "dine_in" && !ordenMesa\.isSalesChannel[\s\S]*openPosTableService/.test(confirmAddBlock)) {
        throw new Error("dine-in table path must call openPosTableService")
      }
    }
  },
  {
    name: "POS maps zombie state pendiente_cierre",
    run() {
      if (!/pendiente_cierre/.test(posJsx)) throw new Error("missing pendiente_cierre state")
      if (!/posOrderIsZombieOpen/.test(posJsx)) throw new Error("missing zombie helper")
    }
  },
  {
    name: "Salir de vista does not call release RPC",
    run() {
      const salir = posJsx.slice(posJsx.indexOf("function salirOrdenActual"), posJsx.indexOf("function etiquetaRolPos"))
      if (/releasePosTableService/.test(salir)) throw new Error("salirOrdenActual must not release")
    }
  },
  {
    name: "PosTicketPanel renamed exit control",
    run() {
      if (/Salir de mesa/.test(ticketPanel)) throw new Error('still says "Salir de mesa"')
      if (!/Salir de vista/.test(ticketPanel)) throw new Error('missing "Salir de vista"')
    }
  },
  {
    name: "187 scope excludes transfer/payment changes in POS.jsx",
    run() {
      if (/transfer_pos_order_table/.test(posJsx)) throw new Error("transfer RPC accidentally added")
      if (/create_pos_split_payment/.test(posJsx)) throw new Error("split payment touched in POS scope")
    }
  },
  {
    name: "owner reassignment not introduced in open flow",
    run() {
      if (/owner_profile_id\s*=/.test(confirmAddBlock)) throw new Error("confirm path mutates owner_profile_id")
    }
  }
]

let passed = 0
for (const test of tests) {
  try {
    test.run()
    passed += 1
    console.log(`OK ${test.name}`)
  } catch (error) {
    console.error(`FAIL ${test.name}: ${error.message}`)
    process.exitCode = 1
  }
}
console.log(`\n${passed}/${tests.length} passed`)
