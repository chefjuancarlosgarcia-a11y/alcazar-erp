/**
 * Offline static regression for 186 clear draft items mixed order fix.
 * Run: node frontend/scripts/clearPosOrderDraftItems186.selftest.mjs
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const migrationPath = resolve(root, "supabase/schema/186_fix_clear_pos_order_draft_items_mixed_order.sql")
const posPath = resolve(root, "frontend/src/pages/POS.jsx")
const legacyPath = resolve(root, "supabase/schema/010_pos_orders.sql")

const sql186 = readFileSync(migrationPath, "utf8")
const posJsx = readFileSync(posPath, "utf8")
const sql010 = readFileSync(legacyPath, "utf8")

function extractHandleClearDraftItems(source) {
  const start = source.indexOf("async function handleClearDraftItems()")
  const end = source.indexOf("async function handleMarkServed", start)
  if (start < 0 || end < 0) return ""
  return source.slice(start, end)
}

const handlerBody = extractHandleClearDraftItems(posJsx)

const tests = [
  {
    name: "186 removes mixed-order rejection from RPC",
    run() {
      if (/productos enviados\. Para cancelar debes solicitar autorizacion/i.test(sql186)) {
        throw new Error("186 still contains sent-order block")
      }
    }
  },
  {
    name: "186 DELETE limited to status draft",
    run() {
      if (!/delete from public\.pos_order_items[\s\S]*status = 'draft'/i.test(sql186)) {
        throw new Error("186 must DELETE only draft rows")
      }
    }
  },
  {
    name: "186 preserves can_operate_pos_orders",
    run() {
      if (!/can_operate_pos_orders\(\)/.test(sql186)) throw new Error("missing permission gate")
    }
  },
  {
    name: "186 preserves draft_cleared event",
    run() {
      if (!/draft_cleared/.test(sql186)) throw new Error("missing audit event")
    }
  },
  {
    name: "186 does not touch production_tickets or owner/waiter",
    run() {
      if (/production_tickets|owner_profile_id|waiter_id/i.test(sql186)) {
        throw new Error("186 must not reference tickets/owner/waiter columns")
      }
    }
  },
  {
    name: "handleClearDraftItems has no sentItems guard",
    run() {
      if (/sentItems\.length\s*>\s*0/.test(handlerBody)) {
        throw new Error("handleClearDraftItems still blocks on sentItems")
      }
    }
  },
  {
    name: "handleClearDraftItems still requires drafts",
    run() {
      if (!/draftItems\.length\s*===?\s*0/.test(handlerBody)) {
        throw new Error("missing draftItems guard")
      }
    }
  },
  {
    name: "handleClearDraftItems still calls clearDraftItems",
    run() {
      if (!/clearDraftItems\(activeOrderId\)/.test(handlerBody)) {
        throw new Error("missing clearDraftItems call")
      }
    }
  },
  {
    name: "010 documents legacy sent-order block (regression anchor)",
    run() {
      if (!/productos enviados\. Para cancelar debes solicitar autorizacion/i.test(sql010)) {
        throw new Error("010 anchor missing legacy block")
      }
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
