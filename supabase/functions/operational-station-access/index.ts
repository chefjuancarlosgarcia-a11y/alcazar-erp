import {
  corsForbiddenResponse,
  corsHeadersForAllowedOrigin,
  corsOptionsResponse,
  evaluateCors,
  parseEnrollOrigins
} from "./cors.ts"
import { createClient } from "@supabase/supabase-js"

const MAX_BODY_BYTES = 4096

function json(body: Record<string, unknown>, status: number, allowedOrigin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeadersForAllowedOrigin(allowedOrigin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Pragma: "no-cache"
    }
  })
}

function genericDenied(allowedOrigin: string) {
  return json({ error: "PIN o acceso no valido." }, 400, allowedOrigin)
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

  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "No autorizado." }, 401, allowedOrigin)
  }

  const contentType = req.headers.get("content-type") || ""
  if (!contentType.toLowerCase().includes("application/json")) {
    return genericDenied(allowedOrigin)
  }

  const raw = await req.arrayBuffer()
  if (raw.byteLength > MAX_BODY_BYTES) return genericDenied(allowedOrigin)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  if (!supabaseUrl || !anonKey) {
    return json({ error: "Configuracion incompleta." }, 500, allowedOrigin)
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return genericDenied(allowedOrigin)
  }

  const action = String(payload.action || "")
  const idempotencyKey = (req.headers.get("x-idempotency-key") || String(payload.idempotency_key || "")).trim()

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  if (action === "verify_pin") {
    const pin = String(payload.pin || "")
    const module = String(payload.module || "cash")
    const { data, error } = await userClient.rpc("verify_operational_pin_for_device", {
      p_pin: pin,
      p_module: module,
      p_idempotency_key: idempotencyKey || null
    })
    if (error) return genericDenied(allowedOrigin)
    return json(data as Record<string, unknown>, 200, allowedOrigin)
  }

  if (action === "touch") {
    const sessionToken = String(payload.session_token || "")
    const { data, error } = await userClient.rpc("touch_operational_operator_session", {
      p_session_token: sessionToken
    })
    if (error) return genericDenied(allowedOrigin)
    return json((data || { ok: false }) as Record<string, unknown>, 200, allowedOrigin)
  }

  if (action === "lock") {
    const sessionToken = String(payload.session_token || "")
    const reason = String(payload.reason || "locked")
    const { data, error } = await userClient.rpc("lock_operational_operator_session", {
      p_session_token: sessionToken,
      p_reason: reason,
      p_idempotency_key: idempotencyKey || null
    })
    if (error) return genericDenied(allowedOrigin)
    return json((data || { ok: true }) as Record<string, unknown>, 200, allowedOrigin)
  }

  return genericDenied(allowedOrigin)
})
