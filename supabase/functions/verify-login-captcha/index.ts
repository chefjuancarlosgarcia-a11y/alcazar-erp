import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY")

  if (!supabaseUrl || !serviceKey) return json({ error: "Funcion no configurada." }, 500)
  if (!turnstileSecret) return json({ error: "CAPTCHA no configurado en el servidor." }, 503)

  const body = await req.json().catch(() => null)
  const token = String(body?.token || "").trim()
  const email = String(body?.email || "").trim().toLowerCase()
  const ip = String(body?.ip || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "").trim()

  if (!token || !email) return json({ error: "Token o correo invalido." }, 400)

  const verifyResponse = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: turnstileSecret,
      response: token,
      remoteip: ip || undefined
    })
  })

  const verifyResult = await verifyResponse.json().catch(() => null)
  if (!verifyResult?.success) {
    return json({ error: "Verificacion CAPTCHA fallida." }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: sessionId, error } = await admin.rpc("create_login_captcha_session", {
    p_email: email,
    p_ip: ip || null
  })

  if (error || !sessionId) {
    return json({ error: error?.message || "No se pudo registrar la verificacion CAPTCHA." }, 500)
  }

  return json({ captcha_session_id: sessionId })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}
