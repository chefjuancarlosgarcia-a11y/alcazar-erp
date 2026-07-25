import { createClient } from "@supabase/supabase-js"

const MAX_BODY_BYTES = 32_768
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function corsHeaders(origin: string | null): Record<string, string> {
  const allowlist = (Deno.env.get("OPERATIONAL_STATION_ENROLL_ORIGINS") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const allowOrigin =
    origin && allowlist.includes(origin) ? origin : allowlist[0] || ""
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-idempotency-key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin"
  }
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin
  return headers
}

function json(
  body: Record<string, unknown>,
  status = 200,
  origin: string | null = null,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      ...extraHeaders
    }
  })
}

function genericInvalid(origin: string | null) {
  return json({ error: "Solicitud invalida." }, 400, origin)
}

function requireIdempotencyKey(key: string, origin: string | null) {
  if (!key || key.length > 128) return genericInvalid(origin)
  return null
}

function rateLimit(clientKey: string, origin: string | null) {
  const now = Date.now()
  const bucket = rateBuckets.get(clientKey)
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(clientKey, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return null
  }
  bucket.count += 1
  if (bucket.count > RATE_MAX) return json({ error: "Solicitud invalida." }, 429, origin)
  return null
}

function clientRateKey(req: Request, suffix: string) {
  const forwarded = req.headers.get("x-forwarded-for") || ""
  const ip = forwarded.split(",")[0]?.trim() || "unknown"
  return `${ip}:${suffix.slice(0, 64)}`
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

function newClaimSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function strongPassword() {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, "")
  return `${b64.slice(0, 20)}Aa1!Zz9@`
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin")
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) })
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo no permitido." }, 405, origin)
  }

  const contentType = req.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return genericInvalid(origin)
  }

  const raw = await req.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) return genericInvalid(origin)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Configuracion incompleta." }, 500, origin)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return genericInvalid(origin)
  }

  const action = String(payload.action || "")
  const idempotencyKey = (
    req.headers.get("x-idempotency-key") || String(payload.idempotency_key || "")
  ).trim()

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  if (action === "claim") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, origin)
    if (invalidKey) return invalidKey
    const token = String(payload.token || "")
    const fingerprint = String(payload.client_fingerprint || "")
    const userAgent = String(payload.user_agent || "")
    const limited = rateLimit(clientRateKey(req, fingerprint || "claim"), origin)
    if (limited) return limited

    let claimSecret = newClaimSecret()
    const claimSecretHash = await sha256Hex(claimSecret)

    const { data, error } = await adminClient.rpc("claim_station_enrollment", {
      p_token: token,
      p_claim_secret_hash: claimSecretHash,
      p_client_fingerprint: fingerprint,
      p_user_agent: userAgent,
      p_idempotency_key: idempotencyKey
    })
    if (error) return genericInvalid(origin)
    const row = data as Record<string, unknown>
    const response: Record<string, unknown> = {
      ok: true,
      enrollment_id: row.enrollment_id,
      device_id: row.device_id,
      confirmation_code: row.confirmation_code,
      status: row.status
    }
    if (row.claim_secret_issued === true && claimSecret) {
      response.device_claim_secret = claimSecret
    }
    return json(response, 200, origin)
  }

  if (action === "status") {
    const deviceId = String(payload.device_id || "")
    const enrollmentId = String(payload.enrollment_id || "")
    const claimSecret = String(payload.device_claim_secret || "")
    if (!claimSecret) return genericInvalid(origin)
    const limited = rateLimit(clientRateKey(req, `${enrollmentId}:status`), origin)
    if (limited) return limited
    const claimSecretHash = await sha256Hex(claimSecret)
    const { data, error } = await adminClient.rpc("get_device_enrollment_status", {
      p_device_id: deviceId,
      p_enrollment_id: enrollmentId,
      p_claim_secret_hash: claimSecretHash
    })
    if (error) return genericInvalid(origin)
    const status = String((data as Record<string, unknown>)?.status || "invalid")
    if (status === "invalid") return genericInvalid(origin)
    return json({ ok: true, status }, 200, origin)
  }

  if (action === "authorize") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, origin)
    if (invalidKey) return invalidKey
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "No autorizado." }, 401, origin)
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: "No autorizado." }, 401, origin)
    }
    const { data: isAdmin, error: adminError } = await userClient.rpc(
      "is_operational_stations_admin"
    )
    if (adminError || !isAdmin) return json({ error: "No autorizado." }, 403, origin)

    const deviceId = String(payload.device_id || "")
    const confirmationCode = String(payload.confirmation_code || "")
    const deviceLabel = String(payload.device_label || "Terminal operativa")
    const reason = String(payload.reason || "")

    const { error: authRpcError } = await userClient.rpc("authorize_station_device_enrollment", {
      p_device_id: deviceId,
      p_confirmation_code: confirmationCode,
      p_device_label: deviceLabel,
      p_reason: reason || null
    })
    if (authRpcError) {
      return json({ error: "No se pudo autorizar el dispositivo." }, 400, origin)
    }
    return json({ ok: true, status: "authorized" }, 200, origin)
  }

  if (action === "complete") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, origin)
    if (invalidKey) return invalidKey
    const enrollmentId = String(payload.enrollment_id || "")
    const deviceId = String(payload.device_id || "")
    let claimSecret = String(payload.device_claim_secret || "")
    if (!claimSecret) return genericInvalid(origin)
    const limited = rateLimit(clientRateKey(req, `${enrollmentId}:complete`), origin)
    if (limited) return limited

    const claimSecretHash = await sha256Hex(claimSecret)
    const { data: gate, error: gateError } = await adminClient.rpc(
      "get_device_enrollment_status",
      {
        p_device_id: deviceId,
        p_enrollment_id: enrollmentId,
        p_claim_secret_hash: claimSecretHash
      }
    )
    if (gateError || gate?.status !== "authorized") return genericInvalid(origin)

    const email = `station-device-${deviceId.replace(/-/g, "")}@stations.internal`
    let password = strongPassword()
    let authUserId: string | null = null

    try {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { operational_station_device: true, device_id: deviceId }
      })
      if (createError || !created.user) {
        await adminClient.rpc("fail_station_device_enrollment", {
          p_device_id: deviceId,
          p_enrollment_id: enrollmentId,
          p_reason: "auth_create_failed"
        })
        return genericInvalid(origin)
      }
      authUserId = created.user.id

      const anonClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      })
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email,
        password
      })
      password = ""

      if (signInError || !signInData.session) {
        await adminClient.auth.admin.deleteUser(authUserId).catch(() => {})
        await adminClient.rpc("fail_station_device_enrollment", {
          p_device_id: deviceId,
          p_enrollment_id: enrollmentId,
          p_reason: "sign_in_failed"
        })
        return genericInvalid(origin)
      }

      const { error: finalizeError } = await adminClient.rpc(
        "finalize_station_device_enrollment",
        {
          p_device_id: deviceId,
          p_enrollment_id: enrollmentId,
          p_auth_user_id: authUserId,
          p_claim_secret_hash: claimSecretHash,
          p_idempotency_key: idempotencyKey
        }
      )

      if (finalizeError) {
        await adminClient.auth.admin.deleteUser(authUserId).catch(() => {})
        await adminClient.rpc("fail_station_device_enrollment", {
          p_device_id: deviceId,
          p_enrollment_id: enrollmentId,
          p_reason: "finalize_failed"
        })
        return genericInvalid(origin)
      }

      claimSecret = ""

      return json(
        {
          ok: true,
          access_token: signInData.session.access_token,
          refresh_token: signInData.session.refresh_token,
          expires_in: signInData.session.expires_in,
          token_type: signInData.session.token_type
        },
        200,
        origin,
        {
          "Cache-Control": "no-store",
          Pragma: "no-cache"
        }
      )
    } finally {
      password = ""
      claimSecret = ""
    }
  }

  return genericInvalid(origin)
})
