import assert from "node:assert/strict"
import test from "node:test"
import {
  canAccessModule,
  ROLE_PERMISSIONS,
  ROLES_WITH_REQUISITIONS_MODULE,
  roleHasRequisitionsModule
} from "./authModulePermissions.js"

const LEGACY_SUBMENU_ROLES = [
  "admin",
  "gerente",
  "gerente_general",
  "supervisor",
  "encargado_area",
  "encargado_almacen",
  "cocina"
]

test("exact requisitions module role list matches approved set", () => {
  assert.deepEqual([...ROLES_WITH_REQUISITIONS_MODULE].sort(), [...LEGACY_SUBMENU_ROLES, "barista"].sort())
})

test("legacy submenu roles retain requisitions module", () => {
  for (const role of LEGACY_SUBMENU_ROLES) {
    assert.equal(roleHasRequisitionsModule(role), true, role)
    assert.equal(canAccessModule(role, "requisitions"), true, role)
  }
})

test("barista is the only new role beyond legacy submenu", () => {
  const onlyBarista = ROLES_WITH_REQUISITIONS_MODULE.filter((role) => !LEGACY_SUBMENU_ROLES.includes(role))
  assert.deepEqual(onlyBarista, ["barista"])
})

test("cocinero was not in legacy submenu and does not receive requisitions module", () => {
  assert.equal(canAccessModule("cocinero", "requisitions"), false)
  assert.equal(canAccessModule("cocinero", "inventory"), true)
})

test("bartender and cafeteria are excluded", () => {
  assert.equal(canAccessModule("bartender", "requisitions"), false)
  assert.equal(canAccessModule("cafeteria", "requisitions"), false)
})

test("no role outside approved list has requisitions module", () => {
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const has = perms.includes("requisitions")
    const expected = ROLES_WITH_REQUISITIONS_MODULE.includes(role)
    assert.equal(has, expected, `role ${role}`)
  }
})
