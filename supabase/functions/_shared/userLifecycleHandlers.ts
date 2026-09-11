import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  deleteAttendanceCredentials,
  json,
  ProfileRow,
  revokeUserSessions,
  safeErrorMessage
} from "./userLifecycle.ts"

export type LifecycleResult =
  | { ok: true; body: Record<string, unknown>; status: number }
  | { ok: false; body: { error: string }; status: number }

export async function executeDeactivateUser(params: {
  admin: SupabaseClient
  actorClient: SupabaseClient
  actor: ProfileRow
  target: ProfileRow
  targetId: string
  reason: string
}): Promise<LifecycleResult> {
  const { admin, actorClient, actor, target, targetId, reason } = params
  const alreadyInactive = target.status === "inactive"

  if (!alreadyInactive) {
    const { error: updateError } = await actorClient
      .from("profiles")
      .update({
        status: "inactive",
        termination_date: new Date().toISOString(),
        termination_reason: reason,
        terminated_by: actor.id,
        authorized_attendance_device: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", targetId)

    if (updateError) {
      return { ok: false, body: { error: safeErrorMessage(updateError) }, status: 400 }
    }
  }

  const sessionError = await revokeUserSessions(admin, targetId)
  if (sessionError) {
    return { ok: false, body: { error: safeErrorMessage(sessionError) }, status: 400 }
  }

  const credentialsError = await deleteAttendanceCredentials(admin, targetId)
  if (credentialsError) {
    return { ok: false, body: { error: safeErrorMessage(credentialsError) }, status: 400 }
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      deactivated: true,
      already_inactive: alreadyInactive,
      user_id: targetId
    }
  }
}

export async function executeReactivateUser(params: {
  actorClient: SupabaseClient
  actor: ProfileRow
  target: ProfileRow
  targetId: string
}): Promise<LifecycleResult> {
  const { actorClient, actor, target, targetId } = params

  if (target.status === "active") {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        reactivated: true,
        already_active: true,
        user_id: targetId,
        message: "El usuario ya estaba activo. Las credenciales de asistencia deben regenerarse manualmente."
      }
    }
  }

  const { error: updateError } = await actorClient
    .from("profiles")
    .update({
      status: "active",
      reactivated_at: new Date().toISOString(),
      reactivated_by: actor.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", targetId)

  if (updateError) {
    return { ok: false, body: { error: safeErrorMessage(updateError) }, status: 400 }
  }

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      reactivated: true,
      user_id: targetId,
      message: "Usuario reactivado. Regenera o habilita el PIN de asistencia de forma explicita."
    }
  }
}

export function lifecycleResultToResponse(result: LifecycleResult) {
  return json(result.body, result.status)
}
