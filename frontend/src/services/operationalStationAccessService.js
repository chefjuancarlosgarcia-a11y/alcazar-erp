import { isSupabaseClientConfigured, supabase } from "../lib/supabase"

export const OPERATOR_SESSION_STORAGE_KEY = "os2-operator-session-token"
export const OPERATOR_SESSION_META_KEY = "os2-operator-session-meta"

const ACCESS_FUNCTION = "operational-station-access"

function makeIdempotencyKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`
}

function rpcUnavailable(message = "Cliente Supabase no configurado.") {
  return { data: null, error: { message } }
}

function ensureRpcClient() {
  if (!isSupabaseClientConfigured || !supabase?.rpc) {
    return rpcUnavailable()
  }
  return null
}

export function loadOperatorSessionToken() {
  if (typeof sessionStorage === "undefined") return ""
  return sessionStorage.getItem(OPERATOR_SESSION_STORAGE_KEY) || ""
}

export function saveOperatorSession(token, meta) {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.setItem(OPERATOR_SESSION_STORAGE_KEY, token)
  sessionStorage.setItem(OPERATOR_SESSION_META_KEY, JSON.stringify(meta || {}))
}

export function clearOperatorSession() {
  if (typeof sessionStorage === "undefined") return
  sessionStorage.removeItem(OPERATOR_SESSION_STORAGE_KEY)
  sessionStorage.removeItem(OPERATOR_SESSION_META_KEY)
}

export function loadOperatorSessionMeta() {
  if (typeof sessionStorage === "undefined") return null
  try {
    return JSON.parse(sessionStorage.getItem(OPERATOR_SESSION_META_KEY) || "null")
  } catch {
    return null
  }
}

async function invokeAccess(body, idempotencyKeyHeader) {
  if (!isSupabaseClientConfigured || !supabase?.functions?.invoke) {
    return { data: null, error: new Error("Cliente Supabase no configurado.") }
  }
  return supabase.functions.invoke(ACCESS_FUNCTION, {
    body,
    headers: idempotencyKeyHeader ? { "x-idempotency-key": idempotencyKeyHeader } : undefined
  })
}

export async function verifyOperationalPin({ pin, module = "cash", idempotencyKey }) {
  const key = idempotencyKey || makeIdempotencyKey("verify-pin")
  const { data, error } = await invokeAccess(
    { action: "verify_pin", pin, module },
    key
  )
  if (error) return { data: null, error: { message: "PIN o acceso no valido." } }
  const body = data
  if (!body?.ok) return { data: null, error: { message: "PIN o acceso no valido." } }
  if (body.session_token) {
    saveOperatorSession(body.session_token, {
      operatorName: body.operator_name,
      operatorProfileId: body.operator_profile_id,
      idleExpiresAt: body.idle_expires_at
    })
  }
  return { data: body, error: null }
}

export async function touchOperatorSession(sessionToken) {
  const token = sessionToken || loadOperatorSessionToken()
  if (!token) return { data: { ok: false }, error: null }
  const { data, error } = await invokeAccess({ action: "touch", session_token: token }, null)
  if (error) return { data: { ok: false }, error }
  if (data?.idle_expires_at) {
    const meta = loadOperatorSessionMeta() || {}
    saveOperatorSession(token, { ...meta, idleExpiresAt: data.idle_expires_at })
  }
  return { data, error: null }
}

export async function lockOperatorSession(reason = "locked") {
  const token = loadOperatorSessionToken()
  if (!token) return { data: { ok: true }, error: null }
  const { data, error } = await invokeAccess(
    { action: "lock", session_token: token, reason },
    makeIdempotencyKey("lock")
  )
  clearOperatorSession()
  return { data, error }
}

export async function adminSetOperationalPin(profileId, pin) {
  const blocked = ensureRpcClient()
  if (blocked) return blocked
  if (!profileId) return rpcUnavailable("Seleccione un colaborador.")
  if (!pin) return rpcUnavailable("PIN operativo inválido.")
  try {
    return await supabase.rpc("admin_set_operational_pin", {
      p_profile_id: profileId,
      p_pin: pin
    })
  } catch (err) {
    return { data: null, error: { message: err?.message || "Error al guardar PIN operativo." } }
  }
}

export async function adminAssignOperationalStation(profileId, stationId, active = true) {
  const blocked = ensureRpcClient()
  if (blocked) return blocked
  if (!profileId || !stationId) return rpcUnavailable("Colaborador y estación requeridos.")
  try {
    return await supabase.rpc("admin_assign_operational_station", {
      p_profile_id: profileId,
      p_station_id: stationId,
      p_active: active
    })
  } catch (err) {
    return { data: null, error: { message: err?.message || "Error al asignar estación." } }
  }
}

export async function adminGetOperationalAccessSummary(profileId) {
  const blocked = ensureRpcClient()
  if (blocked) return blocked
  if (!profileId) return rpcUnavailable("Seleccione un colaborador.")
  try {
    return await supabase.rpc("admin_get_operational_access_summary", {
      p_profile_id: profileId
    })
  } catch (err) {
    return { data: null, error: { message: err?.message || "Error al cargar acceso operativo." } }
  }
}
