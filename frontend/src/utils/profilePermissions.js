export const PROFILE_ROLES = [
  "admin",
  "gerente_general",
  "encargado_almacen",
  "rrhh",
  "supervisor",
  "cajero",
  "mesero",
  "cocinero",
  "pizzero",
  "barista",
  "bartender",
  "repostero",
  "panadero",
  "colaborador"
]

export const PROFILE_STATUSES = ["active", "inactive", "suspended"]

export function canManageUsers(currentUser) {
  return ["admin", "gerente_general", "rrhh"].includes(currentUser?.role)
}

export function canEditUserRole(currentUser, targetUser) {
  if (currentUser?.role === "admin") return true
  return currentUser?.role === "gerente_general" && targetUser?.role !== "admin"
}

export function canAssignUserRole(currentUser, targetUser, nextRole) {
  if (!canEditUserRole(currentUser, targetUser)) return false
  if (currentUser?.role === "gerente_general" && nextRole === "admin") return false
  return true
}

export function canDeactivateUser(currentUser, targetUser) {
  if (!currentUser || !targetUser || String(currentUser.id) === String(targetUser.id)) return false
  if (currentUser.role === "admin") return true
  return currentUser.role === "gerente_general" && targetUser.role !== "admin"
}
