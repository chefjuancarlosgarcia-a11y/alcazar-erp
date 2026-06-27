import { normalizeRole } from "./profilePermissions"

export function canAccessOperationsCenter(user) {
  return normalizeRole(user?.role) === "admin"
}
