export const PROFILE_ROLES = [
  "admin",
  "gerente_general",
  "gerente",
  "rrhh",
  "encargado_almacen",
  "supervisor",
  "cajero",
  "caja",
  "mesero",
  "cocinero",
  "cocina",
  "servicio",
  "pizzero",
  "pizzeria",
  "barista",
  "bartender",
  "repostero",
  "panadero",
  "cafeteria",
  "limpieza",
  "repartidor",
  "mantenimiento",
  "operativo",
  "colaborador"
]

export const PROFILE_STATUSES = ["active", "inactive", "suspended"]
export const PROTECTED_PROFILE_ROLES = ["admin", "gerente_general"]

const ROLE_ALIASES = {
  administrador: "admin",
  admin: "admin",
  "gerente general": "gerente_general",
  gerente_general: "gerente_general",
  rrhh: "recursos_humanos",
  "rr.hh.": "recursos_humanos",
  "rr. hh.": "recursos_humanos",
  "recursos humanos": "recursos_humanos",
  recursos_humanos: "recursos_humanos",
  "encargado almacen": "encargado_almacen",
  "encargado de almacen": "encargado_almacen",
  encargado_almacen: "encargado_almacen",
  supervisores: "supervisor",
  supervisor: "supervisor",
  cajero: "caja",
  caja: "caja",
  pizzero: "pizzeria",
  pizzeria: "pizzeria",
  cocinero: "cocina",
  cocina: "cocina"
}

const HR_ASSIGNABLE_ROLES = new Set([
  "recursos_humanos",
  "encargado_almacen",
  "supervisor",
  "bartender",
  "barista",
  "cocina",
  "servicio",
  "pizzeria",
  "cafeteria",
  "limpieza",
  "caja",
  "operativo",
  "mesero",
  "repartidor",
  "mantenimiento",
  "colaborador",
  "repostero",
  "panadero"
])

function stripAccents(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export function normalizeRole(role) {
  const normalized = stripAccents(role).replace(/[\s-]+/g, "_")
  const spaced = stripAccents(role).replace(/[_-]+/g, " ").replace(/\s+/g, " ")
  return ROLE_ALIASES[normalized] || ROLE_ALIASES[spaced] || normalized
}

export function canAccessUserManagement(currentUser) {
  return ["admin", "gerente_general", "recursos_humanos"].includes(normalizeRole(currentUser?.role))
}

export function canViewProfile(currentUser, targetProfile) {
  return canAccessUserManagement(currentUser) && Boolean(targetProfile)
}

export function isProtectedProfile(targetProfile) {
  return PROTECTED_PROFILE_ROLES.includes(normalizeRole(targetProfile?.role))
}

export function canEditProfile(currentUser, targetProfile) {
  if (!currentUser || !targetProfile) return false
  const actorRole = normalizeRole(currentUser.role)
  const targetRole = normalizeRole(targetProfile.role)
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return targetRole !== "admin"
  if (actorRole === "recursos_humanos") return !PROTECTED_PROFILE_ROLES.includes(targetRole)
  return false
}

export function canDeleteProfile(currentUser, targetProfile) {
  if (!currentUser || !targetProfile || String(currentUser.id) === String(targetProfile.id)) return false
  const actorRole = normalizeRole(currentUser.role)
  const targetRole = normalizeRole(targetProfile.role)
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return targetRole !== "admin"
  if (actorRole === "recursos_humanos") return !PROTECTED_PROFILE_ROLES.includes(targetRole)
  return false
}

export function canCreateProfile(currentUser) {
  return canAccessUserManagement(currentUser)
}

export function canChangeRole(currentUser, targetProfile, newRole) {
  if (!currentUser || !targetProfile) return false
  const actorRole = normalizeRole(currentUser.role)
  const targetRole = normalizeRole(targetProfile.role)
  const nextRole = normalizeRole(newRole)
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return targetRole !== "admin" && nextRole !== "admin"
  if (actorRole === "recursos_humanos") {
    if (PROTECTED_PROFILE_ROLES.includes(targetRole)) return false
    if (PROTECTED_PROFILE_ROLES.includes(nextRole)) return false
    if (String(currentUser.id) === String(targetProfile.id) && PROTECTED_PROFILE_ROLES.includes(nextRole)) return false
    return HR_ASSIGNABLE_ROLES.has(nextRole)
  }
  return false
}

export function getAllowedAssignableRoles(currentUser) {
  const actorRole = normalizeRole(currentUser?.role)
  if (actorRole === "admin") return PROFILE_ROLES
  if (actorRole === "gerente_general") return PROFILE_ROLES.filter((role) => normalizeRole(role) !== "admin")
  if (actorRole === "recursos_humanos") return PROFILE_ROLES.filter((role) => HR_ASSIGNABLE_ROLES.has(normalizeRole(role)))
  return []
}

export function canManageUsers(currentUser) {
  return canAccessUserManagement(currentUser)
}

export function canManageAttendancePin(currentUser) {
  return canAccessUserManagement(currentUser)
}

export function canEditUser(currentUser, targetUser) {
  return canEditProfile(currentUser, targetUser)
}

export function canEditUserRole(currentUser, targetUser) {
  if (!currentUser || !targetUser) return false
  const actorRole = normalizeRole(currentUser.role)
  const targetRole = normalizeRole(targetUser.role)
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return targetRole !== "admin"
  if (actorRole === "recursos_humanos") return !PROTECTED_PROFILE_ROLES.includes(targetRole)
  return false
}

export function canAssignUserRole(currentUser, targetUser, nextRole) {
  return canChangeRole(currentUser, targetUser, nextRole)
}

export function canCreateUserRole(currentUser, nextRole) {
  const actorRole = normalizeRole(currentUser?.role)
  const role = normalizeRole(nextRole)
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return role !== "admin"
  if (actorRole === "recursos_humanos") return HR_ASSIGNABLE_ROLES.has(role) && !PROTECTED_PROFILE_ROLES.includes(role)
  return false
}

export function canDeactivateUser(currentUser, targetUser) {
  return canDeleteProfile(currentUser, targetUser)
}

export function canManageAttendancePinForUser(currentUser, targetUser) {
  if (!canManageAttendancePin(currentUser)) return false
  return canEditProfile(currentUser, targetUser)
}
