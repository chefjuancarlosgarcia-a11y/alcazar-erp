// Default roles for backward compatibility
// These should be kept in sync with the user_roles table
import { CACHE_KEYS } from "../services/cacheConfig"
import { invalidateQueryCache } from "../services/queryCache"

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
  "supervisor_panaderia",
  "cafeteria",
  "limpieza",
  "repartidor",
  "mantenimiento",
  "operativo",
  "colaborador"
]

export const PROFILE_STATUSES = ["active", "inactive", "suspended"]
export const PROTECTED_PROFILE_ROLES = ["admin", "gerente_general"]

// Dynamic roles cache (sync accessors; populated by loadDynamicRoles)
let cachedRoles = null

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
  supervisora: "supervisor",
  encargado_de_area: "encargado_area",
  encargado_area: "encargado_area",
  cajero: "caja",
  caja: "caja",
  pizzero: "pizzeria",
  pizzeria: "pizzeria",
  cocinero: "cocina",
  cocina: "cocina"
}

const HR_ASSIGNABLE_ROLES = new Set([
  "supervisor",
  "encargado_almacen",
  "caja",
  "mesero",
  "servicio",
  "cocina",
  "pizzeria",
  "barista",
  "bartender",
  "panadero",
  "repostero",
  "supervisor_panaderia",
  "limpieza",
  "repartidor",
  "mantenimiento",
  "operativo",
  "colaborador"
])

const ROLE_CATALOG_MANAGERS = new Set(["admin", "gerente_general"])

function stripAccents(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export function normalizeRole(role) {
  const normalized = stripAccents(role).replace(/[\s-]+/g, "_")
  const spaced = stripAccents(role).replace(/[_-]+/g, " ").replace(/\s+/g, " ")
  return ROLE_ALIASES[normalized] || ROLE_ALIASES[spaced] || normalized
}

/**
 * Load dynamic roles from the database
 * Caches the result to avoid repeated queries
 */
export async function loadDynamicRoles() {
  if (cachedRoles) return cachedRoles

  try {
    const { getUserRoles } = await import("../services/userRolesService.js")
    const rows = await getUserRoles()
    cachedRoles = {
      rows,
      keys: rows.map((r) => r.role_key),
      names: rows.reduce((acc, r) => {
        acc[r.role_key] = r.role_name
        return acc
      }, {}),
      meta: rows.reduce((acc, r) => {
        acc[r.role_key] = {
          hr_assignable: r.hr_assignable === true,
          is_deprecated: r.is_deprecated === true,
          is_system: r.is_system === true
        }
        return acc
      }, {})
    }
    return cachedRoles
  } catch (error) {
    console.error("Error loading dynamic roles:", error)
    cachedRoles = {
      keys: PROFILE_ROLES,
      names: {},
      rows: []
    }
    return cachedRoles
  }
}

/**
 * Clear the roles cache (useful for testing or after role updates)
 */
export function clearRolesCache() {
  cachedRoles = null
  invalidateQueryCache(CACHE_KEYS.ROLES_PREFIX)
}

/**
 * Get all available role keys
 * Tries to load from database, falls back to default list
 */
export async function getAllRoleKeys() {
  const roles = await loadDynamicRoles()
  return roles.keys || PROFILE_ROLES
}

/**
 * Get role display name by key
 */
export function getRoleDisplayName(roleKey) {
  if (!cachedRoles) return roleKey
  return cachedRoles.names[roleKey] || roleKey
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
  const roleMeta = cachedRoles?.meta || {}
  if (actorRole === "admin") return !roleMeta[nextRole]?.is_deprecated
  if (actorRole === "gerente_general") {
    return targetRole !== "admin" && nextRole !== "admin" && !roleMeta[nextRole]?.is_deprecated
  }
  if (actorRole === "recursos_humanos") {
    if (PROTECTED_PROFILE_ROLES.includes(targetRole)) return false
    if (PROTECTED_PROFILE_ROLES.includes(nextRole)) return false
    if (roleMeta[nextRole]?.is_deprecated) return false
    if (String(currentUser.id) === String(targetProfile.id) && PROTECTED_PROFILE_ROLES.includes(nextRole)) return false
    const meta = roleMeta[nextRole]
    if (meta && Object.prototype.hasOwnProperty.call(meta, "hr_assignable")) {
      return meta.hr_assignable === true
    }
    return HR_ASSIGNABLE_ROLES.has(nextRole)
  }
  return false
}

export function getAllowedAssignableRoles(currentUser) {
  const actorRole = normalizeRole(currentUser?.role)
  const availableRoles = cachedRoles?.keys || PROFILE_ROLES
  const roleMeta = cachedRoles?.meta || {}

  function isHrAssignable(roleKey) {
    const key = normalizeRole(roleKey)
    if (PROTECTED_PROFILE_ROLES.includes(key)) return false
    if (key === "recursos_humanos" || key === "rrhh" || key === "gerente") return false
    const meta = roleMeta[key]
    if (meta?.is_deprecated) return false
    if (meta && Object.prototype.hasOwnProperty.call(meta, "hr_assignable")) {
      return meta.hr_assignable === true
    }
    return HR_ASSIGNABLE_ROLES.has(key)
  }

  if (actorRole === "admin") {
    return availableRoles.filter((role) => !roleMeta[normalizeRole(role)]?.is_deprecated)
  }
  if (actorRole === "gerente_general") {
    return availableRoles.filter((role) => {
      const key = normalizeRole(role)
      return key !== "admin" && !roleMeta[key]?.is_deprecated
    })
  }
  if (actorRole === "recursos_humanos") {
    return availableRoles.filter((role) => isHrAssignable(role))
  }
  return []
}

export function canManageUsers(currentUser) {
  return canAccessUserManagement(currentUser)
}

export function canManageRoleCatalog(currentUser) {
  return ROLE_CATALOG_MANAGERS.has(normalizeRole(currentUser?.role))
}

export function canManageAreaCatalog(currentUser) {
  return canManageRoleCatalog(currentUser)
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
  const roleMeta = cachedRoles?.meta || {}
  if (actorRole === "admin") return !roleMeta[role]?.is_deprecated
  if (actorRole === "gerente_general") return role !== "admin" && !roleMeta[role]?.is_deprecated
  if (actorRole === "recursos_humanos") {
    if (PROTECTED_PROFILE_ROLES.includes(role)) return false
    if (roleMeta[role]?.is_deprecated) return false
    const meta = roleMeta[role]
    if (meta && Object.prototype.hasOwnProperty.call(meta, "hr_assignable")) {
      return meta.hr_assignable === true
    }
    return HR_ASSIGNABLE_ROLES.has(role)
  }
  return false
}

export function canDeactivateUser(currentUser, targetUser) {
  if (!currentUser || !targetUser || String(currentUser.id) === String(targetUser.id)) return false
  if (targetUser.status === "inactive") return false
  return canDeleteProfile(currentUser, targetUser)
}

export function canReactivateUser(currentUser, targetUser) {
  if (!currentUser || !targetUser || String(currentUser.id) === String(targetUser.id)) return false
  if (targetUser.status !== "inactive") return false
  return canDeleteProfile(currentUser, targetUser)
}

export function canHardDeleteUser(currentUser, targetUser) {
  if (!currentUser || !targetUser || String(currentUser.id) === String(targetUser.id)) return false
  return normalizeRole(currentUser.role) === "admin"
}

export const EDITABLE_PROFILE_STATUSES = ["active", "suspended"]

export function canManageAttendancePinForUser(currentUser, targetUser) {
  if (!canManageAttendancePin(currentUser)) return false
  return canEditProfile(currentUser, targetUser)
}
