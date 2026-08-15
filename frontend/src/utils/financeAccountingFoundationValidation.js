import { DIMENSION_RULES } from "./financeAccountingFoundationConstants.js"

export function normalizeEntityCode(value) {
  const text = value == null ? "" : String(value)
  const trimmed = text.trim()
  return trimmed || null
}

export function accountingPeriodBounds(year, month) {
  const start = new Date(Date.UTC(year, month - 1, 1))
  const end = new Date(Date.UTC(year, month, 0))
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10)
  }
}

export function validateDimensionRule(value) {
  return DIMENSION_RULES.includes(String(value || "").trim().toLowerCase())
}

export function defaultBranchDimensionRule(financialType) {
  if (["income", "cost", "expense"].includes(financialType)) return "required"
  if (financialType === "equity") return "prohibited"
  return "optional"
}

export function defaultCostCenterDimensionRule(financialType) {
  if (financialType === "equity") return "prohibited"
  return "optional"
}

export function wouldCostCenterCycle(code, parentCode, rows) {
  if (!code || !parentCode) return false
  let current = parentCode
  const guard = new Set()
  while (current && guard.size < 64) {
    if (current === code) return true
    guard.add(current)
    const parentRow = rows.find((row) => normalizeEntityCode(row.code) === current)
    current = parentRow ? normalizeEntityCode(parentRow.parent_code) : null
  }
  return false
}

export function countActiveMainBranches(branches) {
  return branches.filter((branch) => branch.is_main && branch.is_active).length
}

export function hasDuplicateEntityCode(code, rows, excludeId = null) {
  const normalized = normalizeEntityCode(code)
  if (!normalized) return false
  return rows.some((row) => normalizeEntityCode(row.code) === normalized && row.id !== excludeId)
}

export function validatePeriodStatusTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    return { valid: false, message: "El periodo ya está en ese estado." }
  }
  if (currentStatus === "closed" && nextStatus !== "closed") {
    return { valid: false, message: "Un periodo cerrado debe reabrirse con motivo." }
  }
  if (!["open", "soft_closed", "closed"].includes(nextStatus)) {
    return { valid: false, message: "Estado inválido." }
  }
  return { valid: true, message: "" }
}

export function validateReopenReason(reason) {
  const text = String(reason ?? "").trim()
  return text.length > 0
}
