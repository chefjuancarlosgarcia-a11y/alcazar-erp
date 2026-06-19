import { supabase } from "../lib/supabase"

const BLOCKED_MESSAGE = "Demasiados intentos. Intenta de nuevo en 15 minutos."

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible completar la operacion de seguridad."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

let cachedClientIp = null
let cachedClientIpAt = 0

export async function getClientIpAddress() {
  const now = Date.now()
  if (cachedClientIp && now - cachedClientIpAt < 5 * 60 * 1000) {
    return cachedClientIp
  }
  try {
    const response = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4000) })
    if (!response.ok) return null
    const payload = await response.json()
    cachedClientIp = payload?.ip || null
    cachedClientIpAt = now
    return cachedClientIp
  } catch {
    return null
  }
}

export function getLoginUserAgent() {
  if (typeof navigator === "undefined") return null
  return navigator.userAgent || null
}

export async function checkLoginSecurity(email, ipAddress = null) {
  const { data, error } = await supabase.rpc("check_login_security", {
    p_email: email?.trim().toLowerCase() || "",
    p_ip: ipAddress || null
  })
  if (error) return result(null, error)
  return result(data || {})
}

export async function recordLoginAttempt({
  email,
  ipAddress = null,
  userAgent = null,
  success = false,
  failureReason = null,
  userId = null,
  captchaSessionId = null
}) {
  const { data, error } = await supabase.rpc("record_login_attempt", {
    p_email: email?.trim().toLowerCase() || "",
    p_ip: ipAddress || null,
    p_user_agent: userAgent || null,
    p_success: success,
    p_failure_reason: failureReason || null,
    p_user_id: userId || null,
    p_captcha_session_id: captchaSessionId || null
  })
  if (error) return result(null, error)
  return result(data || {})
}

export async function verifyLoginCaptcha({ token, email, ipAddress = null }) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return result(null, "Supabase no esta configurado.")
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/verify-login-captcha`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey
      },
      body: JSON.stringify({
        token,
        email: email?.trim().toLowerCase() || "",
        ip: ipAddress || null
      })
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return result(null, payload?.error || "Verificacion CAPTCHA fallida.")
    }
    return result(payload)
  } catch (error) {
    return result(null, error)
  }
}

export async function getSecurityLoginAttempts({
  limit = 100,
  offset = 0,
  email = null,
  success = null
} = {}) {
  const { data, error } = await supabase.rpc("get_security_login_attempts", {
    p_limit: limit,
    p_offset: offset,
    p_email: email || null,
    p_success: success
  })
  if (error) return result([], error)
  return result(Array.isArray(data) ? data : [], null)
}

export function isLoginBlocked(status) {
  return Boolean(status?.blocked)
}

export function isCaptchaRequired(status) {
  return Boolean(status?.captcha_required)
}

export function getBlockedMessage(status) {
  return status?.message || BLOCKED_MESSAGE
}

export { BLOCKED_MESSAGE }
