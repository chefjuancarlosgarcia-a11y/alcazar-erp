import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

test("RequisitionsPage renders shared RequisitionsSupabase only", () => {
  const source = readFileSync(join(root, "pages/RequisitionsPage.jsx"), "utf8")
  assert.match(source, /import RequisitionsSupabase from "\.\/RequisitionsSupabase"/)
  assert.doesNotMatch(source, /requisitionsService|create_requisition|Barista/i)
})

test("RequisitionsSupabase uses requisitionsService RPCs", () => {
  const page = readFileSync(join(root, "pages/RequisitionsSupabase.jsx"), "utf8")
  const service = readFileSync(join(root, "services/requisitionsService.js"), "utf8")
  assert.match(page, /from "\.\.\/services\/requisitionsService"/)
  assert.match(service, /create_requisition/)
  assert.match(service, /update_draft_requisition/)
  assert.match(service, /submit_requisition/)
  assert.doesNotMatch(page, /create_requisition_barista|barista_requisition/i)
})

test("AppRoutes protect requisitions and inventory separately", () => {
  const routes = readFileSync(join(root, "routes/AppRoutes.jsx"), "utf8")
  assert.match(routes, /path="\/requisitions"/)
  assert.match(routes, /module="requisitions"/)
  assert.match(routes, /path="\/inventory" element=\{<InventoryRoute \/\>/)
  assert.ok(!routes.includes('path="/requisitions" element={<ProtectedRoute module="inventory"'))
})
