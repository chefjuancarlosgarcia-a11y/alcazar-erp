import { normalizeRole } from "./profilePermissions"

export const FINANCE_VIEW_ROLES = ["admin", "gerente_general", "contador"]
export const FINANCE_MANAGE_ROLES = ["admin", "contador"]
export const FINANCE_RECONCILE_ROLES = ["admin", "contador"]
export const ACCOUNTING_CATALOG_MANAGE_ROLES = ["admin", "contador"]

function roleKey(userProfile) {
  return normalizeRole(userProfile?.role || userProfile)
}

export function canViewFinance(userProfile) {
  return FINANCE_VIEW_ROLES.includes(roleKey(userProfile))
}

export function canManageFinance(userProfile) {
  return FINANCE_MANAGE_ROLES.includes(roleKey(userProfile))
}

export function canReconcileBanks(userProfile) {
  return FINANCE_RECONCILE_ROLES.includes(roleKey(userProfile)) || canViewFinance(userProfile)
}

export function canManageAccountingCatalog(userProfile) {
  if (!userProfile || userProfile.status !== "active") return false
  return ACCOUNTING_CATALOG_MANAGE_ROLES.includes(roleKey(userProfile))
}

export function canManageAccountingStructure(userProfile) {
  return canManageAccountingCatalog(userProfile)
}

export function canManageAccountingPeriods(userProfile) {
  return canManageAccountingCatalog(userProfile)
}

export function canCloseAccountingPeriod(userProfile) {
  return canManageAccountingCatalog(userProfile)
}

export function canReopenAccountingPeriod(userProfile) {
  if (!userProfile || userProfile.status !== "active") return false
  const role = roleKey(userProfile)
  return ["admin", "contador", "gerente_general"].includes(role)
}
