import {
  authenticateActor,
  canManageTarget,
  corsHeaders,
  createActorClient,
  createAdminClient,
  json,
  loadTargetProfile,
  safeErrorMessage
} from "../_shared/userLifecycle.ts"
import { executeDeactivateUser, lifecycleResultToResponse } from "../_shared/userLifecycleHandlers.ts"

const MIN_REASON_LENGTH = 3
const MAX_REASON_LENGTH = 500
const DENIED_MESSAGE = "No tienes permisos para dar de baja este usuario."

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405)

  const admin = await createAdminClient()
  if (!admin) return json({ error: "Funcion no configurada." }, 500)

  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
  const authResult = await authenticateActor(admin, token, DENIED_MESSAGE)
  if (authResult.error) return authResult.error

  const actorClient = createActorClient(authResult.token!)
  if (!actorClient) return json({ error: "Funcion no configurada." }, 500)

  const body = await req.json().catch(() => null)
  const targetId = String(body?.user_id || "").trim()
  const reason = String(body?.reason || "").trim()

  if (!targetId || targetId === authResult.authUserId) {
    return json({ error: DENIED_MESSAGE }, 403)
  }
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    return json({ error: "El motivo de baja es obligatorio (3 a 500 caracteres)." }, 400)
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

  const result = await executeDeactivateUser({
    admin,
    actorClient,
    actor,
    target,
    targetId,
    reason
  })

  return lifecycleResultToResponse(result)
})
