import { normalizeRole } from "./profilePermissions"

const MANAGE_ROLES = new Set(["admin", "gerente_general"])
const VIEW_ROLES = new Set([...MANAGE_ROLES, "contador"])

export function canManageBillingSettings(user) {
  return MANAGE_ROLES.has(normalizeRole(user?.role))
}

export function canViewBillingSettings(user) {
  return VIEW_ROLES.has(normalizeRole(user?.role))
}
