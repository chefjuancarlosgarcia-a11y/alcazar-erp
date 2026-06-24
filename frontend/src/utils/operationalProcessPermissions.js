import { normalizeRole } from "./profilePermissions"

/** Roles that may see operational process groups (cards, detail, library tab). */
export const OPERATIONAL_PROCESS_VIEW_ROLES = Object.freeze([
  "admin",
  "gerente_general",
  "gerente",
  "recursos_humanos",
  "rrhh",
  "supervisor",
  "encargado_area"
])

/** Roles that may create/edit/deactivate process templates. */
export const OPERATIONAL_PROCESS_MANAGE_ROLES = Object.freeze([
  "admin",
  "gerente_general",
  "gerente",
  "recursos_humanos",
  "rrhh"
])

export function canViewOperationalProcessGroups(user) {
  const role = normalizeRole(user?.role)
  return OPERATIONAL_PROCESS_VIEW_ROLES.includes(role)
}

export function canManageOperationalProcesses(user) {
  const role = normalizeRole(user?.role)
  return OPERATIONAL_PROCESS_MANAGE_ROLES.includes(role)
}

export function canExecuteOperationalProcessManual(user) {
  const role = normalizeRole(user?.role)
  return ["admin", "gerente_general", "gerente", "supervisor", "recursos_humanos", "rrhh"].includes(role)
}
