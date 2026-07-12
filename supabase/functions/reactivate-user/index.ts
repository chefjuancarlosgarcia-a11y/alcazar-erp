import {
  authenticateActor,
  canManageTarget,
  corsHeaders,
  createAdminClient,
  json,
  loadTargetProfile,
  safeErrorMessage
} from "../_shared/userLifecycle.ts"

const DENIED_MESSAGE = "No tienes permisos para reactivar este usuario."

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405)

  const admin = await createAdminClient()
  if (!admin) return json({ error: "Funcion no configurada." }, 500)

  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
  const authResult = await authenticateActor(admin, token, DENIED_MESSAGE)
  if (authResult.error) return authResult.error

  const body = await req.json().catch(() => null)
  const targetId = String(body?.user_id || "").trim()
  if (!targetId || targetId === authResult.authUserId) {
    return json({ error: DENIED_MESSAGE }, 403)
  }

  const targetResult = await loadTargetProfile(admin, targetId)
  if (targetResult.error) {
    return json({ error: safeErrorMessage(targetResult.error) }, 400)
  }

  const actor = authResult.actor!
  const target = targetResult.target!
  if (!canManageTarget(actor.role, target.role)) {
    return json({ error: DENIED_MESSAGE }, 403)
  }

  if (target.status === "active") {
    return json({
      reactivated: true,
      already_active: true,
      user_id: targetId,
      message: "El usuario ya estaba activo. Las credenciales de asistencia deben regenerarse manualmente."
    })
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      status: "active",
      reactivated_at: new Date().toISOString(),
      reactivated_by: actor.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", targetId)

  if (updateError) {
    return json({ error: safeErrorMessage(updateError) }, 400)
  }

  return json({
    reactivated: true,
    user_id: targetId,
    message: "Usuario reactivado. Regenera o habilita el PIN de asistencia de forma explicita."
  })
})
