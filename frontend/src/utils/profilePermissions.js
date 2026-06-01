export const PROFILE_ROLES = [
  "admin",
  "gerente_general",
  "gerente",
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
export const PROTECTED_PROFILE_ROLES = ["admin", "gerente_general"]

export function canManageUsers(currentUser) {
  return ["admin", "gerente_general", "rrhh"].includes(currentUser?.role)
}

export function canManageAttendancePin(currentUser) {
  return ["admin", "gerente_general", "rrhh"].includes(currentUser?.role)
}

export function isProtectedProfile(targetUser) {
  return PROTECTED_PROFILE_ROLES.includes(targetUser?.role)
}

export function canEditUser(currentUser, targetUser) {
  if (!currentUser || !targetUser) return false
  if (currentUser.role === "admin") return true
  if (currentUser.role === "gerente_general") return targetUser.role !== "admin"
  if (currentUser.role === "rrhh") {
    return !isProtectedProfile(targetUser) && String(currentUser.id) !== String(targetUser.id)
  }
  return false
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

export function canCreateUserRole(currentUser, nextRole) {
  if (currentUser?.role === "admin") return true
  if (currentUser?.role === "gerente_general") return nextRole !== "admin"
  if (currentUser?.role === "rrhh") return !PROTECTED_PROFILE_ROLES.includes(nextRole)
  return false
}

export function canDeactivateUser(currentUser, targetUser) {
  if (!currentUser || !targetUser || String(currentUser.id) === String(targetUser.id)) return false
  if (currentUser.role === "admin") return true
  return currentUser.role === "gerente_general" && targetUser.role !== "admin"
}

export function canManageAttendancePinForUser(currentUser, targetUser) {
  if (!canManageAttendancePin(currentUser)) return false
  if (currentUser.role === "admin") return true
  if (currentUser.role === "gerente_general") return targetUser?.role !== "admin"
  return currentUser.role === "rrhh" && canEditUser(currentUser, targetUser)
}
