import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { canAccessModule, MODULES } from "./authModulePermissions.js"

const MAIN_NAV_MODULES = [
  { module: "requisitions", label: "Requisiciones" },
  { module: "inventory", label: "Inventario" },
  { module: "production", label: "Producción" },
  { module: "hr", label: "Recursos Humanos" }
]

function mainNavLabelsForRole(role) {
  return MAIN_NAV_MODULES.filter((item) => canAccessModule(role, item.module)).map((item) => item.label)
}

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Mirrors RequisitionsSupabase elevation rules (non-requester UI capabilities). */
function requisitionApprovalCaps(role) {
  const manager = ["admin", "gerente_general"].includes(role)
  const isWarehouseManager = role === "encargado_almacen"
  const isElevated = manager || isWarehouseManager
  return { canApprove: isElevated, canComplete: isElevated, canFulfill: isElevated }
}

test("barista has requisitions module and not inventory", () => {
  assert.equal(canAccessModule("barista", "requisitions"), true)
  assert.equal(canAccessModule("barista", "inventory"), false)
})

test("barista sidebar shows Requisiciones and hides Inventario", () => {
  const labels = mainNavLabelsForRole("barista")
  assert.ok(labels.includes("Requisiciones"))
  assert.ok(!labels.includes("Inventario"))
})

test("inventory-capable requisition roles keep both modules where applicable", () => {
  for (const role of ["admin", "gerente_general", "supervisor", "cocina", "encargado_almacen", "encargado_area"]) {
    assert.equal(canAccessModule(role, "requisitions"), true, role)
    assert.equal(canAccessModule(role, "inventory"), true, role)
  }
})

test("barista cannot approve, reject workflow, fulfill or complete via elevated caps", () => {
  const caps = requisitionApprovalCaps("barista")
  assert.equal(caps.canApprove, false)
  assert.equal(caps.canComplete, false)
  assert.equal(caps.canFulfill, false)
})

test("barista uses shared RequisitionsSupabase entry (no parallel page)", () => {
  const pagePath = join(__dirname, "../pages/RequisitionsPage.jsx")
  const pageSource = readFileSync(pagePath, "utf8")
  assert.match(pageSource, /RequisitionsSupabase/)
  assert.doesNotMatch(pageSource, /BaristaRequisitions|Osman/i)
})

test("non-elevated requesters lock origin to warehouse area in shared component", () => {
  const componentPath = join(__dirname, "../pages/RequisitionsSupabase.jsx")
  const source = readFileSync(componentPath, "utf8")
  assert.match(source, /lockOperationalFields = !isElevated/)
  assert.match(source, /updates\.fromAreaId = warehouseArea\.id/)
})

test("canonical requisitions module path is registered", () => {
  assert.equal(MODULES.requisitions, "/requisitions")
})

test("bartender and cafeteria role are excluded from requisitions module by policy", () => {
  assert.equal(canAccessModule("bartender", "requisitions"), false)
  assert.equal(canAccessModule("cafeteria", "requisitions"), false)
})

test("inventory submenu config does not expose Requisiciones under Inventario", () => {
  const configPath = join(__dirname, "sidebarNavigationConfig.js")
  const source = readFileSync(configPath, "utf8")
  const submenuBlock = source.match(/export const inventorySubmenu = \[([\s\S]*?)\]\n\nfunction submenuAllowsRole/)?.[1] || ""
  assert.ok(!submenuBlock.includes("Requisiciones"))
})

test("protected route modules: barista passes requisitions only", () => {
  assert.equal(canAccessModule("barista", "requisitions"), true)
  assert.equal(canAccessModule("barista", "inventory"), false)
  assert.equal(canAccessModule("barista", "finance"), false)
  assert.equal(canAccessModule("barista", "pos"), false)
})

test("InventoryRoute redirects legacy requisicion section before inventory guard", () => {
  const routePath = join(__dirname, "../routes/InventoryRoute.jsx")
  const source = readFileSync(routePath, "utf8")
  assert.match(source, /section === "requisicion"/)
  assert.match(source, /canAccess\("requisitions"\)/)
  assert.match(source, /buildRequisitionUrlFromInventorySearchParams/)
})
