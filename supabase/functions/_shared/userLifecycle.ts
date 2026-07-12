import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

const roleAliases: Record<string, string> = {
  "recursos humanos": "recursos_humanos",
  recursos_humanos: "recursos_humanos",
  rrhh: "recursos_humanos",
  "rr.hh.": "recursos_humanos",
  "gerente general": "gerente_general",
  gerente_general: "gerente_general"
}

export type ProfileRow = {
  id: string
  role: string
  status: string
}

export function normalizeRole(role: string) {
  const normalized = String(role || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const spaced = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ")
  const underscored = normalized.replace(/[\s-]+/g, "_")
  return roleAliases[underscored] || roleAliases[spaced] || underscored
}

export function canManageTarget(actorRole: string, targetRole: string) {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (actor === "admin") return true
  if (actor === "gerente_general") return target !== "admin"
  if (actor === "recursos_humanos") return target !== "admin" && target !== "gerente_general"
  return false
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}

export function safeErrorMessage(error: unknown, fallback = "Error al guardar en la base de datos.") {
  const message = String((error as { message?: string })?.message || "").trim()
  if (!message) return fallback
  const lowered = message.toLowerCase()
  if (lowered.includes("service_role") || lowered.includes("jwt") || lowered.includes("secret")) {
    return fallback
  }
  return message
}

export async function createAdminClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return null
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
}

export async function authenticateActor(
  admin: SupabaseClient,
  token: string | undefined,
  deniedMessage: string
) {
  if (!token) return { error: json({ error: deniedMessage }, 401) }

  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return { error: json({ error: deniedMessage }, 401) }

  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", authData.user.id)
    .single()

  if (actorError || !actor || actor.status !== "active") {
    return { error: json({ error: deniedMessage }, 403) }
  }

  return { actor: actor as ProfileRow, authUserId: authData.user.id }
}

export async function loadTargetProfile(admin: SupabaseClient, targetId: string) {
  const { data: target, error } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", targetId)
    .maybeSingle()
  if (error) return { error }
  if (!target) return { error: new Error("Usuario no encontrado.") }
  return { target: target as ProfileRow }
}

/**
 * Revokes all refresh tokens and sessions for a user.
 *
 * @supabase/supabase-js admin.signOut(jwt, scope) requires the target user's JWT,
 * which we do not have when an admin deactivates another account. This RPC mirrors
 * GoTrue's models.Logout(user_id) using service_role.
 */
export async function revokeUserSessions(admin: SupabaseClient, userId: string) {
  const { error } = await admin.rpc("revoke_user_auth_sessions", { p_user_id: userId })
  return error
}

export async function invalidateAttendanceAccess(admin: SupabaseClient, userId: string) {
  await admin.from("attendance_credentials").delete().eq("employee_id", userId)
  await admin
    .from("profiles")
    .update({
      authorized_attendance_device: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
}
