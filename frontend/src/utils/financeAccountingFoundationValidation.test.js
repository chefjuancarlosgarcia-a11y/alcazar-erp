import assert from "node:assert/strict"
import test from "node:test"
import {
  accountingPeriodBounds,
  countActiveMainBranches,
  defaultBranchDimensionRule,
  defaultCostCenterDimensionRule,
  hasDuplicateEntityCode,
  normalizeEntityCode,
  validateDimensionRule,
  validatePeriodStatusTransition,
  validateReopenReason,
  wouldCostCenterCycle
} from "./financeAccountingFoundationValidation.js"
import { DIMENSION_RULES } from "./financeAccountingFoundationConstants.js"

const FINANCE_VIEW_ROLES = ["admin", "gerente_general", "contador"]
const ACCOUNTING_STRUCTURE_MANAGE_ROLES = ["admin", "contador"]

function canManageAccountingStructure(userProfile) {
  if (!userProfile || userProfile.status !== "active") return false
  return ACCOUNTING_STRUCTURE_MANAGE_ROLES.includes(userProfile.role)
}

function canViewFinance(userProfile) {
  return FINANCE_VIEW_ROLES.includes(userProfile?.role)
}

test("exactly one active main branch is valid", () => {
  const branches = [
    { id: "1", code: "PRINCIPAL", is_main: true, is_active: true },
    { id: "2", code: "SUR", is_main: false, is_active: true }
  ]
  assert.equal(countActiveMainBranches(branches), 1)
})

test("zero or multiple active main branches are invalid states", () => {
  assert.equal(countActiveMainBranches([{ is_main: false, is_active: true }]), 0)
  assert.equal(
    countActiveMainBranches([
      { is_main: true, is_active: true },
      { is_main: true, is_active: true }
    ]),
    2
  )
})

test("duplicate entity codes are detected", () => {
  const rows = [{ id: "a", code: "CC-01" }, { id: "b", code: "CC-02" }]
  assert.equal(hasDuplicateEntityCode("CC-01", rows), true)
  assert.equal(hasDuplicateEntityCode("CC-01", rows, "a"), false)
  assert.equal(hasDuplicateEntityCode("CC-03", rows), false)
})

test("hierarchical cost center parent chain is preserved", () => {
  const rows = [
    { code: "ROOT", parent_code: null },
    { code: "OPS", parent_code: "ROOT" },
    { code: "KITCHEN", parent_code: "OPS" }
  ]
  assert.equal(wouldCostCenterCycle("KITCHEN", "OPS", rows), false)
  assert.equal(wouldCostCenterCycle("ROOT", "KITCHEN", rows), true)
})

test("cost center cycles are blocked", () => {
  const rows = [
    { code: "A", parent_code: "B" },
    { code: "B", parent_code: "A" }
  ]
  assert.equal(wouldCostCenterCycle("A", "B", rows), true)
})

test("calendar month bounds are correct", () => {
  assert.deepEqual(accountingPeriodBounds(2026, 2), {
    start_date: "2026-02-01",
    end_date: "2026-02-28"
  })
  assert.deepEqual(accountingPeriodBounds(2024, 2), {
    start_date: "2024-02-01",
    end_date: "2024-02-29"
  })
  assert.deepEqual(accountingPeriodBounds(2026, 8), {
    start_date: "2026-08-01",
    end_date: "2026-08-31"
  })
})

test("period status transitions enforce controlled reopen", () => {
  assert.equal(validatePeriodStatusTransition("open", "soft_closed").valid, true)
  assert.equal(validatePeriodStatusTransition("soft_closed", "closed").valid, true)
  assert.equal(validatePeriodStatusTransition("closed", "open").valid, false)
  assert.equal(validatePeriodStatusTransition("open", "open").valid, false)
})

test("reopen reason is mandatory", () => {
  assert.equal(validateReopenReason(""), false)
  assert.equal(validateReopenReason("   "), false)
  assert.equal(validateReopenReason("Ajuste autorizado por auditoría"), true)
})

test("dimension rules accept only canonical values", () => {
  for (const rule of DIMENSION_RULES) {
    assert.equal(validateDimensionRule(rule), true)
  }
  assert.equal(validateDimensionRule("mandatory"), false)
})

test("default dimension rules follow financial type policy", () => {
  assert.equal(defaultBranchDimensionRule("income"), "required")
  assert.equal(defaultBranchDimensionRule("cost"), "required")
  assert.equal(defaultBranchDimensionRule("expense"), "required")
  assert.equal(defaultBranchDimensionRule("asset"), "optional")
  assert.equal(defaultBranchDimensionRule("liability"), "optional")
  assert.equal(defaultBranchDimensionRule("equity"), "prohibited")
  assert.equal(defaultCostCenterDimensionRule("equity"), "prohibited")
  assert.equal(defaultCostCenterDimensionRule("expense"), "optional")
})

test("permissions: admin and contador manage structure; gerente reads", () => {
  const activeAdmin = { role: "admin", status: "active" }
  const activeContador = { role: "contador", status: "active" }
  const activeGerente = { role: "gerente_general", status: "active" }
  const inactiveContador = { role: "contador", status: "inactive" }

  assert.equal(canManageAccountingStructure(activeAdmin), true)
  assert.equal(canManageAccountingStructure(activeContador), true)
  assert.equal(canManageAccountingStructure(activeGerente), false)
  assert.equal(canManageAccountingStructure(inactiveContador), false)
  assert.equal(canViewFinance(activeGerente), true)
  assert.deepEqual(FINANCE_VIEW_ROLES.sort(), ["admin", "contador", "gerente_general"].sort())
  assert.deepEqual(ACCOUNTING_STRUCTURE_MANAGE_ROLES.sort(), ["admin", "contador"].sort())
})

test("entity codes are normalized as trimmed text", () => {
  assert.equal(normalizeEntityCode("  PRINCIPAL "), "PRINCIPAL")
  assert.equal(normalizeEntityCode(""), null)
})
