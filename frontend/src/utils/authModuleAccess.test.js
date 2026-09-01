import assert from "node:assert/strict"
import test from "node:test"
import { canAccessModule, permissionsForRole } from "./authModulePermissions.js"

test("ventas can access tasks and catering modules", () => {
  assert.equal(canAccessModule("ventas", "tasks"), true)
  assert.equal(canAccessModule("ventas", "catering"), true)
})

test("ventas cannot access finance or settings modules", () => {
  assert.equal(canAccessModule("ventas", "finance"), false)
  assert.equal(canAccessModule("ventas", "settings"), false)
  assert.equal(canAccessModule("ventas", "hr"), false)
  assert.equal(canAccessModule("ventas", "pos"), false)
})

test("colaborador remains blocked from catering", () => {
  assert.equal(canAccessModule("colaborador", "catering"), false)
  assert.deepEqual(permissionsForRole("colaborador"), ["hr"])
})

test("admin retains catering access", () => {
  assert.equal(canAccessModule("admin", "catering"), true)
})
