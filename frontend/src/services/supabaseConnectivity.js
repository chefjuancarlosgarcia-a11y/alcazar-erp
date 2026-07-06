const INVALID_API_KEY_PATTERN = /\binvalid api key\b/i
const MISSING_API_KEY_PATTERN = /\bno api key found\b/i

function normalizeErrorMessage(error) {
  if (!error) return ""
  if (typeof error === "string") return error
  const parts = [error.message, error.error_description, error.msg, error.hint, error.details]
    .filter(Boolean)
    .map(String)
  return parts.join(" ").trim()
}

/** Decodifica payload JWT legacy (eyJ...) sin verificar firma — solo metadatos locales. */
export function decodeSupabaseJwtPayload(token) {
  const trimmed = String(token || "").trim()
  if (!trimmed.startsWith("eyJ")) return null

  try {
    const payloadPart = trimmed.split(".")[1]
    if (!payloadPart) return null
    const base64 = payloadPart.replace(/-/g, "+").replace(/_/g, "/")
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}

/** Clasifica anon/publishable key sin asumir mismatch bloqueante. */
export function classifySupabaseAnonKey(anonKey) {
  const key = String(anonKey || "").trim()
  if (!key) {
    return { keyType: "missing", role: null, projectRef: null, claims: null }
  }
  if (key.startsWith("sb_publishable_")) {
    return { keyType: "publishable", role: "anon", projectRef: null, claims: null }
  }
  if (key.startsWith("eyJ")) {
    const claims = decodeSupabaseJwtPayload(key)
    return {
      keyType: "legacy_jwt",
      role: claims?.role || null,
      projectRef: claims?.ref || claims?.project_ref || null,
      claims
    }
  }
  return { keyType: "unknown", role: null, projectRef: null, claims: null }
}

export function extractSupabaseProjectRef(url) {
  return String(url || "").trim().match(/https:\/\/([^.]+)\.supabase\.co/i)?.[1] || ""
}

/** Fuente única para URL/key del cliente — siempre trim; detecta swap accidental en .env. */
export function resolveSupabaseClientConfig() {
  let url = String(import.meta.env.VITE_SUPABASE_URL || "").trim()
  let anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()

  if (url.startsWith("eyJ") && /^https?:\/\//i.test(anonKey)) {
    console.error(
      "[Supabase] VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY están intercambiados en el .env. Corrigiendo en memoria."
    )
    ;[url, anonKey] = [anonKey, url]
  }

  return { url, anonKey }
}

export function getSupabaseKeyType(anonKey) {
  const key = String(anonKey || "").trim()
  if (key.startsWith("sb_publishable_")) return "publishable"
  if (key.startsWith("eyJ")) return "legacy"
  return "unknown"
}

/** Logs DEV al crear el cliente — comparar env vs createClient vs instancia. */
export function logSupabaseClientBootstrap(resolved, clientInstance = null) {
  if (!import.meta.env.DEV) return
  const { url, anonKey } = resolved
  const envKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || "").trim()
  console.log("SUPABASE URL", url)
  console.log("SUPABASE KEY PREFIX", anonKey.slice(0, 20))
  console.log(
    "KEY TYPE",
    anonKey.startsWith("sb_publishable_")
      ? "publishable"
      : anonKey.startsWith("eyJ")
        ? "legacy"
        : "unknown"
  )
  console.log("[Supabase audit] import.meta.env.VITE_SUPABASE_ANON_KEY prefix:", envKey.slice(0, 20))
  console.log("[Supabase audit] resolved.anonKey === trim(env):", anonKey === envKey)
  console.log("[Supabase audit] createClient source: resolveSupabaseClientConfig() (frontend/src/lib/supabase.js)")
  if (clientInstance?.supabaseKey != null) {
    console.log("[Supabase audit] client.supabaseKey prefix:", String(clientInstance.supabaseKey).slice(0, 20))
    console.log("[Supabase audit] client.supabaseKey === resolved.anonKey:", clientInstance.supabaseKey === anonKey)
  }
  if (clientInstance?.supabaseUrl != null) {
    console.log("[Supabase audit] client.supabaseUrl:", clientInstance.supabaseUrl)
    console.log("[Supabase audit] client.supabaseUrl === resolved.url:", clientInstance.supabaseUrl === url)
  }
}

/** Interceptor DEV: muestra apikey/authorization real en cada /rest/v1/*. */
export function createDevRestFetchLogger() {
  if (!import.meta.env.DEV) return undefined
  const { anonKey: bootAnonPrefix } = resolveSupabaseClientConfig()
  return async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url || ""
    if (requestUrl.includes("/rest/v1/")) {
      const headers = new Headers(init?.headers || {})
      const apikey = headers.get("apikey") || headers.get("Apikey") || ""
      const authorization = headers.get("authorization") || headers.get("Authorization") || ""
      console.group(`[Supabase REST audit] ${requestUrl.replace(/^https?:\/\/[^/]+/, "")}`)
      console.log("apikey prefix:", apikey ? apikey.slice(0, 20) : "(missing)")
      console.log("apikey matches boot key:", apikey === bootAnonPrefix)
      console.log("authorization prefix:", authorization ? authorization.slice(0, 30) : "(missing)")
      console.log("authorization bearer is session JWT (not anon):", Boolean(authorization && !authorization.includes(bootAnonPrefix.slice(0, 12))))
      console.groupEnd()
    }
    return fetch(input, init)
  }
}

export function getSupabaseConfigStatus() {
  const { url, anonKey } = resolveSupabaseClientConfig()
  const projectRef = extractSupabaseProjectRef(url)
  const keyInfo = classifySupabaseAnonKey(anonKey)

  /** null = no se puede verificar con certeza (publishable/unknown). */
  let keyProjectMatch = null
  if (keyInfo.projectRef && projectRef) {
    keyProjectMatch = keyInfo.projectRef === projectRef
  }

  const devWarnings = []
  if (import.meta.env.DEV) {
    if (keyInfo.keyType === "legacy_jwt" && keyInfo.role && keyInfo.role !== "anon") {
      devWarnings.push(`[Supabase] La key JWT tiene role="${keyInfo.role}"; se esperaba "anon".`)
    }
    if (keyProjectMatch === false) {
      devWarnings.push(
        `[Supabase] JWT ref="${keyInfo.projectRef}" difiere de URL ref="${projectRef}" (aviso dev; Auth decide validez).`
      )
    }
    if (keyInfo.keyType === "publishable") {
      devWarnings.push("[Supabase] Publishable key detectada (sb_publishable_…); no se compara ref localmente.")
    }
  }

  return {
    configured: Boolean(url && anonKey),
    url,
    hasAnonKey: Boolean(anonKey),
    projectRef,
    keyType: keyInfo.keyType,
    keyRole: keyInfo.role,
    keyProjectRef: keyInfo.projectRef,
    keyProjectMatch,
    devWarnings
  }
}

export function logSupabaseConfigWarnings(config = getSupabaseConfigStatus()) {
  if (!import.meta.env.DEV || !config?.devWarnings?.length) return
  config.devWarnings.forEach((warning) => console.warn(warning))
}

export function isSupabaseNetworkError(error) {
  const message = normalizeErrorMessage(error).toLowerCase()
  return (
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("cors")
  )
}

/** Supabase respondió explícitamente que la API key es inválida. */
export function isInvalidSupabaseApiKeyError(error) {
  return INVALID_API_KEY_PATTERN.test(normalizeErrorMessage(error))
}

/** Petición sin apikey — no implica mismatch si .env sí tiene key. */
export function isMissingSupabaseApiKeyError(error) {
  return MISSING_API_KEY_PATTERN.test(normalizeErrorMessage(error))
}

/**
 * Mensaje para UI. Mismatch de key solo si Supabase Auth lo confirmó (fromAuth).
 * Probes/RPC nunca bloquean login por comparación local.
 */
export function describeSupabaseError(error, context = "Supabase", options = {}) {
  const { fromAuth = false, serverConfirmed = false } = options
  if (!error) return { userMessage: "", technical: null, isNetwork: false, isApiKeyMismatch: false }

  if (isSupabaseNetworkError(error)) {
    return {
      userMessage: `${context} no responde desde este navegador. Verifica internet, que el proyecto Supabase esté activo (no pausado) y revisa https://status.supabase.com/.`,
      technical: error,
      isNetwork: true,
      isApiKeyMismatch: false
    }
  }

  const message = normalizeErrorMessage(error)

  if (isMissingSupabaseApiKeyError(error)) {
    return {
      userMessage: import.meta.env.DEV
        ? `${context}: el servidor reportó ausencia de API key en la petición (revisa headers del probe).`
        : `${context} no respondió correctamente.`,
      technical: error,
      isNetwork: false,
      isApiKeyMismatch: false,
      devOnly: true
    }
  }

  if (isInvalidSupabaseApiKeyError(error) && (fromAuth || serverConfirmed)) {
    return {
      userMessage: "La clave VITE_SUPABASE_ANON_KEY no es válida para este proyecto Supabase.",
      technical: error,
      isNetwork: false,
      isApiKeyMismatch: true
    }
  }

  if (isInvalidSupabaseApiKeyError(error)) {
    return {
      userMessage: import.meta.env.DEV
        ? `${context} respondió "Invalid API key" (Auth confirmará si bloquea login).`
        : `${context} no respondió correctamente.`,
      technical: error,
      isNetwork: false,
      isApiKeyMismatch: false,
      devOnly: true
    }
  }

  if (/function.*does not exist|PGRST202/i.test(message)) {
    return {
      userMessage: "Falta desplegar funciones de seguridad en Supabase (check_login_security). Contacta administración.",
      technical: error,
      isNetwork: false,
      isApiKeyMismatch: false
    }
  }

  return {
    userMessage: message || `No fue posible contactar ${context}.`,
    technical: error,
    isNetwork: false,
    isApiKeyMismatch: false
  }
}

async function readJsonSafe(response) {
  try {
    return await response.json()
  } catch {
    return {}
  }
}

function errorFromProbeResponse(response, payload) {
  const message = payload?.message || payload?.error || payload?.error_description || payload?.hint || `HTTP ${response.status}`
  return { message, status: response.status, ...payload }
}

export async function probeSupabaseRest() {
  const config = getSupabaseConfigStatus()
  if (!config.configured) {
    return {
      ok: false,
      stage: "config",
      message: "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el frontend."
    }
  }

  const { anonKey } = resolveSupabaseClientConfig()
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.url}/rest/v1/`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      signal: AbortSignal.timeout(8000)
    })
    const payload = await readJsonSafe(response)
    if (response.ok) {
      return {
        ok: true,
        stage: "rest",
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: "REST API responde."
      }
    }

    const probeError = errorFromProbeResponse(response, payload)
    const described = describeSupabaseError(probeError, "REST API de Supabase", {
      serverConfirmed: isInvalidSupabaseApiKeyError(probeError)
    })
    return {
      ok: false,
      stage: "rest",
      status: response.status,
      latencyMs: Date.now() - startedAt,
      isNetwork: false,
      message: described.userMessage,
      technical: probeError
    }
  } catch (error) {
    const described = describeSupabaseError(error, "REST API de Supabase")
    return {
      ok: false,
      stage: "rest",
      latencyMs: Date.now() - startedAt,
      isNetwork: described.isNetwork,
      message: described.userMessage,
      technical: described.technical
    }
  }
}

/** Probe sin apikey — útil en dev para distinguir "No API key found" vs key inválida. */
export async function probeSupabaseRestWithoutKey() {
  const config = getSupabaseConfigStatus()
  if (!config.url) return { ok: false, stage: "config", message: "Falta VITE_SUPABASE_URL." }

  try {
    const response = await fetch(`${config.url}/rest/v1/`, {
      method: "GET",
      signal: AbortSignal.timeout(8000)
    })
    const payload = await readJsonSafe(response)
    return {
      ok: isMissingSupabaseApiKeyError(errorFromProbeResponse(response, payload)),
      stage: "rest_no_key",
      status: response.status,
      message: payload?.message || payload?.hint || `HTTP ${response.status}`
    }
  } catch (error) {
    return { ok: false, stage: "rest_no_key", message: normalizeErrorMessage(error) }
  }
}

export async function probeSupabaseAuthHealth() {
  const config = getSupabaseConfigStatus()
  if (!config.configured) {
    return {
      ok: false,
      stage: "config",
      message: "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el frontend."
    }
  }

  const startedAt = Date.now()
  const { anonKey } = resolveSupabaseClientConfig()
  try {
    const response = await fetch(`${config.url}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: anonKey },
      signal: AbortSignal.timeout(8000)
    })
    const payload = await readJsonSafe(response)
    if (response.ok) {
      return {
        ok: true,
        stage: "auth",
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: "Auth API responde."
      }
    }

    const probeError = errorFromProbeResponse(response, payload)
    const described = describeSupabaseError(probeError, "Auth de Supabase", {
      serverConfirmed: isInvalidSupabaseApiKeyError(probeError)
    })
    return {
      ok: false,
      stage: "auth",
      status: response.status,
      latencyMs: Date.now() - startedAt,
      message: described.userMessage,
      technical: probeError
    }
  } catch (error) {
    const described = describeSupabaseError(error, "Auth de Supabase")
    return {
      ok: false,
      stage: "auth",
      latencyMs: Date.now() - startedAt,
      isNetwork: described.isNetwork,
      message: described.userMessage,
      technical: described.technical
    }
  }
}

export async function probeSupabaseLoginSecurityRpc() {
  const config = getSupabaseConfigStatus()
  if (!config.configured) {
    return {
      ok: false,
      stage: "config",
      message: "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY en el frontend."
    }
  }

  const { anonKey } = resolveSupabaseClientConfig()
  const startedAt = Date.now()
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/check_login_security`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`
      },
      body: JSON.stringify({ p_email: "probe@example.com", p_ip: null }),
      signal: AbortSignal.timeout(8000)
    })
    const payload = await readJsonSafe(response)
    if (response.ok) {
      return {
        ok: true,
        stage: "rpc_check_login_security",
        status: response.status,
        latencyMs: Date.now() - startedAt,
        message: "RPC check_login_security responde.",
        payload
      }
    }

    const probeError = errorFromProbeResponse(response, payload)
    const described = describeSupabaseError(probeError, "RPC check_login_security", {
      serverConfirmed: isInvalidSupabaseApiKeyError(probeError)
    })
    return {
      ok: false,
      stage: "rpc_check_login_security",
      status: response.status,
      latencyMs: Date.now() - startedAt,
      message: described.userMessage,
      technical: probeError
    }
  } catch (error) {
    const described = describeSupabaseError(error, "RPC check_login_security")
    return {
      ok: false,
      stage: "rpc_check_login_security",
      latencyMs: Date.now() - startedAt,
      isNetwork: described.isNetwork,
      message: described.userMessage,
      technical: described.technical
    }
  }
}
