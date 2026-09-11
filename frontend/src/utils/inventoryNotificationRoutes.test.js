import assert from "node:assert/strict"
import test from "node:test"
import {
  buildLegacyInventoryRequisitionUrl,
  buildRequisitionNotificationUrl
} from "./inventoryNotificationRoutes.js"

test("requisition notifications use canonical /requisitions path", () => {
  const url = buildRequisitionNotificationUrl({ id: "req-1", status: "pending", is_test: false })
  assert.ok(url.startsWith("/requisitions?"))
  assert.ok(url.includes("id=req-1"))
  assert.ok(url.includes("tab=pending"))
  assert.ok(url.includes("focus=1"))
  assert.ok(!url.includes("section=requisicion"))
})

test("legacy inventory requisition URL still encodes section for redirect", () => {
  const url = buildLegacyInventoryRequisitionUrl({ id: "x", tab: "all" })
  assert.equal(url, "/inventory?section=requisicion&id=x&tab=all")
})
