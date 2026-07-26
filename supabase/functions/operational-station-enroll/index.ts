import { createClient } from "@supabase/supabase-js"
import {
  corsForbiddenResponse,
  corsHeadersForAllowedOrigin,
  corsOptionsResponse,
  evaluateCors,
  parseEnrollOrigins
} from "./cors.ts"

const MAX_BODY_BYTES = 32_768
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30
const rateBuckets = new Map<string, { count: number; resetAt: number }>()

function json(
  body: Record<string, unknown>,
  status = 200,
  allowedOrigin: string,
  extraHeaders: Record<string, string> = {}
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForAllowedOrigin(allowedOrigin),
      "Content-Type": "application/json",
      ...extraHeaders
    }
  })
}

function genericInvalid(allowedOrigin: string) {
  return json({ error: "Solicitud invalida." }, 400, allowedOrigin)
}

function requireIdempotencyKey(key: string, allowedOrigin: string) {
  if (!key || key.length > 128) return genericInvalid(allowedOrigin)
  return null
}

function rateLimit(clientKey: string, allowedOrigin: string) {
  const now = Date.now()
  const bucket = rateBuckets.get(clientKey)
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(clientKey, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return null
  }
  bucket.count += 1
  if (bucket.count > RATE_MAX) return json({ error: "Solicitud invalida." }, 429, allowedOrigin)
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
  const requestOrigin = req.headers.get("Origin")
  const allowlist = parseEnrollOrigins(Deno.env.get("OPERATIONAL_STATION_ENROLL_ORIGINS"))
  const corsDecision = evaluateCors(requestOrigin, allowlist)
  if (!corsDecision.ok) {
    return corsForbiddenResponse()
  }
  const allowedOrigin = corsDecision.origin

  if (req.method === "OPTIONS") {
    return corsOptionsResponse(allowedOrigin)
  }
  if (req.method !== "POST") {
    return json({ error: "Metodo no permitido." }, 405, allowedOrigin)
  }

  const contentType = req.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return genericInvalid(allowedOrigin)
  }

  const raw = await req.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) return genericInvalid(allowedOrigin)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return json({ error: "Configuracion incompleta." }, 500, allowedOrigin)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return genericInvalid(allowedOrigin)
  }

  const action = String(payload.action || "")
  const idempotencyKey = (
    req.headers.get("x-idempotency-key") || String(payload.idempotency_key || "")
  ).trim()

  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  if (action === "claim") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, allowedOrigin)
    if (invalidKey) return invalidKey
    const token = String(payload.token || "")
    const fingerprint = String(payload.client_fingerprint || "")
    const userAgent = String(payload.user_agent || "")
    const limited = rateLimit(clientRateKey(req, fingerprint || "claim"), allowedOrigin)
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
    if (error) return genericInvalid(allowedOrigin)
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
    return json(response, 200, allowedOrigin)
  }

  if (action === "status") {
    const deviceId = String(payload.device_id || "")
    const enrollmentId = String(payload.enrollment_id || "")
    const claimSecret = String(payload.device_claim_secret || "")
    if (!claimSecret) return genericInvalid(allowedOrigin)
    const limited = rateLimit(clientRateKey(req, `${enrollmentId}:status`), allowedOrigin)
    if (limited) return limited
    const claimSecretHash = await sha256Hex(claimSecret)
    const { data, error } = await adminClient.rpc("get_device_enrollment_status", {
      p_device_id: deviceId,
      p_enrollment_id: enrollmentId,
      p_claim_secret_hash: claimSecretHash
    })
    if (error) return genericInvalid(allowedOrigin)
    const status = String((data as Record<string, unknown>)?.status || "invalid")
    if (status === "invalid") return genericInvalid(allowedOrigin)
    return json({ ok: true, status }, 200, allowedOrigin)
  }

  if (action === "authorize") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, allowedOrigin)
    if (invalidKey) return invalidKey
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "No autorizado." }, 401, allowedOrigin)
    }
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) {
      return json({ error: "No autorizado." }, 401, allowedOrigin)
    }
    const { data: isAdmin, error: adminError } = await userClient.rpc(
      "is_operational_stations_admin"
    )
    if (adminError || !isAdmin) return json({ error: "No autorizado." }, 403, allowedOrigin)

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
      return json({ error: "No se pudo autorizar el dispositivo." }, 400, allowedOrigin)
    }
    return json({ ok: true, status: "authorized" }, 200, allowedOrigin)
  }

  if (action === "complete") {
    const invalidKey = requireIdempotencyKey(idempotencyKey, allowedOrigin)
    if (invalidKey) return invalidKey
    const enrollmentId = String(payload.enrollment_id || "")
    const deviceId = String(payload.device_id || "")
    let claimSecret = String(payload.device_claim_secret || "")
    if (!claimSecret) return genericInvalid(allowedOrigin)
    const limited = rateLimit(clientRateKey(req, `${enrollmentId}:complete`), allowedOrigin)
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
    if (gateError || gate?.status !== "authorized") return genericInvalid(allowedOrigin)

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
        return genericInvalid(allowedOrigin)
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
        return genericInvalid(allowedOrigin)
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
        return genericInvalid(allowedOrigin)
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
        allowedOrigin,
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

  return genericInvalid(allowedOrigin)
})
