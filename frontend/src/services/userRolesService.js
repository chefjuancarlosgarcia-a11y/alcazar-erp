import { supabase } from "../lib/supabase"
import { clearRolesCache } from "../utils/profilePermissions"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery } from "./queryCache"

export const PROTECTED_ROLE_KEYS = new Set(["admin", "gerente_general"])
export const RESERVED_CREATE_ROLE_KEYS = new Set(["admin", "gerente_general"])

/**
 * Normalize a display name into a role_key (lowercase snake_case, no accents).
 */
export function normalizeRoleName(name) {
  if (!name || typeof name !== "string") return ""

  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
}

export function formatRoleKey(roleKey) {
  if (!roleKey) return ""
  return roleKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function isProtectedRoleKey(roleKey) {
  return PROTECTED_ROLE_KEYS.has(String(roleKey || "").trim())
}

export function isDeprecatedRole(role) {
  if (!role) return false
  if (role.is_deprecated === true) return true
  return /deprecated/i.test(String(role.role_name || ""))
}

function invalidateRoleCaches() {
  clearRolesCache()
}

function mapRoleError(error) {
  if (!error) return "Error desconocido"
  return error.message || error.details || "Error al procesar el rol"
}

export async function getUserRoles() {
  return cachedQuery(CACHE_KEYS.ROLES_ACTIVE, async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .eq("is_active", true)
      .eq("is_deprecated", false)
      .order("role_name", { ascending: true })

    if (error) throw new Error(mapRoleError(error))
    return data || []
  }, CACHE_TTL.REFERENCE)
}

export async function getAllUserRoles() {
  return cachedQuery(CACHE_KEYS.ROLES_ALL, async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .order("is_system", { ascending: false })
      .order("role_name", { ascending: true })

    if (error) throw new Error(mapRoleError(error))
    return data || []
  }, CACHE_TTL.REFERENCE)
}

export async function getUserRole(roleId) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("id", roleId)
    .single()

  if (error) throw new Error(mapRoleError(error))
  return data
}

export async function getUserRoleByKey(roleKey) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("*")
    .eq("role_key", roleKey)
    .single()

  if (error) throw new Error(mapRoleError(error))
  return data
}

export async function countProfilesWithRole(roleKey) {
  const { data, error } = await supabase.rpc("count_profiles_with_role", {
    p_role_key: roleKey
  })

  if (error) throw new Error(mapRoleError(error))
  return Number(data || 0)
}

export async function createUserRole(payload) {
  const roleName = String(payload.role_name || "").trim()
  if (!roleName) throw new Error("El nombre del rol es obligatorio")

  const roleKey = payload.role_key ? normalizeRoleName(payload.role_key) : normalizeRoleName(roleName)
  if (!roleKey) throw new Error("No se pudo generar una clave válida para el rol")
  if (RESERVED_CREATE_ROLE_KEYS.has(roleKey)) {
    throw new Error("No se pueden crear roles reservados como admin o gerente_general")
  }

  const { data, error } = await supabase.rpc("create_user_role", {
    p_role_name: roleName,
    p_description: payload.description || "",
    p_is_active: payload.is_active !== false,
    p_hr_assignable: payload.hr_assignable === true
  })

  if (error) throw new Error(mapRoleError(error))
  invalidateRoleCaches()
  return data
}

export async function updateUserRole(roleId, payload) {
  const { data, error } = await supabase.rpc("update_user_role", {
    p_role_id: roleId,
    p_role_name: payload.role_name !== undefined ? String(payload.role_name).trim() : null,
    p_description: payload.description !== undefined ? payload.description : null,
    p_is_active: payload.is_active !== undefined ? payload.is_active : null,
    p_hr_assignable: payload.hr_assignable !== undefined ? payload.hr_assignable : null
  })

  if (error) throw new Error(mapRoleError(error))
  invalidateRoleCaches()
  return data
}

export async function deactivateUserRole(roleId, roleKey) {
  if (isProtectedRoleKey(roleKey)) {
    throw new Error("Los roles admin y gerente_general no se pueden desactivar")
  }

  const profileCount = await countProfilesWithRole(roleKey)
  if (profileCount > 0) {
    throw new Error(
      `Este rol está asignado a ${profileCount} colaborador${profileCount === 1 ? "" : "es"}. Reasigna esos colaboradores antes de desactivarlo.`
    )
  }

  return updateUserRole(roleId, { is_active: false })
}

export async function activateUserRole(roleId) {
  return updateUserRole(roleId, { is_active: true })
}

export async function getRolesByCategory(category) {
  return cachedQuery(`${CACHE_KEYS.ROLES_PREFIX}category:${category}`, async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("*")
      .eq("category", category)
      .eq("is_active", true)
      .eq("is_deprecated", false)
      .order("role_name", { ascending: true })

    if (error) throw new Error(mapRoleError(error))
    return data || []
  }, CACHE_TTL.REFERENCE)
}

export async function getRoleCategories() {
  return cachedQuery(CACHE_KEYS.ROLES_CATEGORIES, async () => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("category")
      .eq("is_active", true)
      .order("category", { ascending: true })

    if (error) throw new Error(mapRoleError(error))
    return [...new Set((data || []).map((row) => row.category))].filter(Boolean)
  }, CACHE_TTL.REFERENCE)
}

export async function roleExists(roleKey) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("id")
    .eq("role_key", roleKey)
    .eq("is_active", true)
    .maybeSingle()

  if (error && error.code !== "PGRST116") throw new Error(mapRoleError(error))
  return Boolean(data)
}

export default {
  PROTECTED_ROLE_KEYS,
  RESERVED_CREATE_ROLE_KEYS,
  getUserRoles,
  getAllUserRoles,
  getUserRole,
  getUserRoleByKey,
  countProfilesWithRole,
  createUserRole,
  updateUserRole,
  deactivateUserRole,
  activateUserRole,
  normalizeRoleName,
  formatRoleKey,
  isProtectedRoleKey,
  isDeprecatedRole,
  getRolesByCategory,
  getRoleCategories,
  roleExists
}
