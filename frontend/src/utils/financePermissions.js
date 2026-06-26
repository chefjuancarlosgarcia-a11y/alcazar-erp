import { normalizeRole } from "./profilePermissions"

export const FINANCE_VIEW_ROLES = ["admin", "gerente_general", "contador"]
export const FINANCE_MANAGE_ROLES = ["admin", "contador"]
export const FINANCE_RECONCILE_ROLES = ["admin", "contador"]

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
