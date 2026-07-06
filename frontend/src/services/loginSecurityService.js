import { supabase } from "../lib/supabase"
import {
  describeSupabaseError,
  getSupabaseConfigStatus,
  isInvalidSupabaseApiKeyError,
  isSupabaseNetworkError,
  resolveSupabaseClientConfig
} from "./supabaseConnectivity"

const BLOCKED_MESSAGE = "Demasiados intentos. Intenta de nuevo en 15 minutos."

export const DEFAULT_LOGIN_SECURITY_STATUS = Object.freeze({
  allowed: true,
  blocked: false,
  captcha_required: false,
  message: null,
  email_failures: 0,
  ip_failures: 0
})

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible completar la operacion de seguridad."
}

function securityResult(data, error = null, meta = {}) {
  return {
    data,
    error: error ? message(error) : "",
    degraded: Boolean(meta.degraded),
    warning: meta.warning || "",
    technical: meta.technical || null
  }
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

function failOpenSecurityResult(error, context) {
  const described = describeSupabaseError(error, context)
  console.warn(`[login-security] ${context} no disponible; login continúa sin pre-chequeo.`, described.technical || error)
  return securityResult(DEFAULT_LOGIN_SECURITY_STATUS, null, {
    degraded: true,
    warning: described.isApiKeyMismatch ? "" : described.userMessage,
    technical: described.technical || error
  })
}

export async function checkLoginSecurity(email, ipAddress = null) {
  const config = getSupabaseConfigStatus()
  if (!config.configured) {
    return securityResult(DEFAULT_LOGIN_SECURITY_STATUS, null, {
      degraded: true,
      warning: "Supabase no está configurado en el frontend (.env)."
    })
  }

  try {
    const { data, error } = await supabase.rpc("check_login_security", {
      p_email: email?.trim().toLowerCase() || "",
      p_ip: ipAddress || null
    })
    if (error) {
      if (isSupabaseNetworkError(error) || isInvalidSupabaseApiKeyError(error)) {
        return failOpenSecurityResult(error, "RPC check_login_security")
      }
      console.warn("[login-security] check_login_security error; login continúa:", error)
      return failOpenSecurityResult(error, "RPC check_login_security")
    }
    return securityResult(data || {}, null)
  } catch (error) {
    return failOpenSecurityResult(error, "RPC check_login_security")
  }
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
  try {
    const { data, error } = await supabase.rpc("record_login_attempt", {
      p_email: email?.trim().toLowerCase() || "",
      p_ip: ipAddress || null,
      p_user_agent: userAgent || null,
      p_success: success,
      p_failure_reason: failureReason || null,
      p_user_id: userId || null,
      p_captcha_session_id: captchaSessionId || null
    })
    if (error) {
      if (isSupabaseNetworkError(error)) {
        console.warn("[login-security] record_login_attempt no disponible.", error)
        return securityResult({ recorded: false }, null, { degraded: true })
      }
      return securityResult(null, error)
    }
    return securityResult(data || {}, null)
  } catch (error) {
    if (isSupabaseNetworkError(error)) {
      console.warn("[login-security] record_login_attempt no disponible.", error)
      return securityResult({ recorded: false }, null, { degraded: true })
    }
    return securityResult(null, error)
  }
}

export async function verifyLoginCaptcha({ token, email, ipAddress = null }) {
  const config = getSupabaseConfigStatus()
  if (!config.configured) {
    return securityResult(null, "Supabase no esta configurado.")
  }

  try {
    const { url, anonKey } = resolveSupabaseClientConfig()
    const response = await fetch(`${url}/functions/v1/verify-login-captcha`, {
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
      }),
      signal: AbortSignal.timeout(10000)
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      return securityResult(null, payload?.error || "Verificacion CAPTCHA fallida.")
    }
    return securityResult(payload)
  } catch (error) {
    const described = describeSupabaseError(error, "Verificacion CAPTCHA")
    return securityResult(null, described.userMessage, { technical: described.technical || error })
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
  if (error) return securityResult([], error)
  return securityResult(Array.isArray(data) ? data : [], null)
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
