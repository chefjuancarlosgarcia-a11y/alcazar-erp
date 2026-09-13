import { CASH_OPERATOR_ROLES } from "./constants.ts"
import type { ActorProfile } from "./types.ts"

export function normalizeProfileRole(role: string): string {
  const normalized = String(role || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s-]+/g, "_")

  // Mirrors public.normalize_profile_role: fixes a false denial for the
  // historical administrator alias without expanding canonical operators.
  return normalized === "administrador" ? "admin" : normalized
}

export function isCashOperator(profile: ActorProfile | null | undefined): boolean {
  if (!profile || profile.status !== "active") return false
  return CASH_OPERATOR_ROLES.has(normalizeProfileRole(profile.role))
}

export function assertCashOperator(profile: ActorProfile | null | undefined): string | null {
  if (!profile) return "FEL_UNAUTHORIZED"
  if (profile.status !== "active") return "FEL_UNAUTHORIZED"
  if (!isCashOperator(profile)) return "FEL_UNAUTHORIZED"
  return null
}
