import assert from "node:assert/strict"
import test from "node:test"
import { canAccessModule } from "./authModulePermissions.js"
import {
  resolveInventoryRouteGate,
  shouldRedirectInventoryRequisitionSection
} from "./requisitionRouteAccess.js"

test("legacy requisicion section redirects only with requisitions module", () => {
  assert.equal(shouldRedirectInventoryRequisitionSection("requisicion", true), true)
  assert.equal(shouldRedirectInventoryRequisitionSection("requisicion", false), false)
  assert.equal(shouldRedirectInventoryRequisitionSection("inventario", true), false)
})

test("barista uses redirect gate, not inventory guard, for legacy requisicion URL", () => {
  assert.equal(resolveInventoryRouteGate("requisicion", canAccessModule("barista", "requisitions")), "redirect-requisitions")
  assert.equal(resolveInventoryRouteGate("inventario", canAccessModule("barista", "requisitions")), "inventory-guard")
})

test("user without requisitions cannot enter via legacy requisicion section", () => {
  assert.equal(resolveInventoryRouteGate("requisicion", canAccessModule("bartender", "requisitions")), "inventory-guard")
  assert.equal(canAccessModule("bartender", "requisitions"), false)
})

test("redirect target is canonical and does not loop back to inventory", () => {
  assert.equal(resolveInventoryRouteGate("requisicion", true), "redirect-requisitions")
  assert.notEqual(resolveInventoryRouteGate("requisicion", true), "inventory-guard")
})
