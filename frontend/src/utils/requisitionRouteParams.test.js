import assert from "node:assert/strict"
import test from "node:test"
import {
  buildRequisitionUrl,
  buildRequisitionUrlFromInventorySearchParams,
  parseRequisitionRouteSearchParams
} from "./requisitionRouteParams.js"
import { TEST_FLOW_FILTER } from "./testFlowMode.js"

test("buildRequisitionUrl preserves deep link params", () => {
  assert.equal(
    buildRequisitionUrl({ id: "abc", tab: "pending", approve: "abc", testFlow: "test", focus: "1" }),
    "/requisitions?id=abc&tab=pending&approve=abc&testFlow=test&focus=1"
  )
})

test("legacy inventory search params map to canonical requisitions URL", () => {
  const params = new URLSearchParams("section=requisicion&id=9&tab=draft&approve=&testFlow=all&focus=1&action=open")
  assert.equal(
    buildRequisitionUrlFromInventorySearchParams(params),
    "/requisitions?id=9&tab=draft&testFlow=all&focus=1"
  )
})

test("action query param is not consumed by RequisitionsSupabase props", () => {
  const params = new URLSearchParams("id=1&action=open")
  assert.equal(Object.hasOwn(parseRequisitionRouteSearchParams(params), "initialAction"), false)
})

test("parseRequisitionRouteSearchParams matches Inventory requisition props", () => {
  const params = new URLSearchParams("id=42&tab=approved&approve=42&testFlow=test&focus=1")
  assert.deepEqual(parseRequisitionRouteSearchParams(params), {
    initialRequisitionId: "42",
    initialTab: "approved",
    initialApproveId: "42",
    initialTestFlowFilter: TEST_FLOW_FILTER.TEST,
    initialFocus: true
  })
})
