import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret"
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const cronSecret = Deno.env.get("CRON_SECRET")

  if (!supabaseUrl || !serviceKey) return json({ error: "Funcion no configurada." }, 500)

  const headerSecret = req.headers.get("x-cron-secret")
  const authHeader = req.headers.get("Authorization") || ""
  const bearer = authHeader.replace("Bearer ", "")

  const authorizedByCronSecret = Boolean(cronSecret && headerSecret === cronSecret)
  const authorizedByServiceRole = bearer === serviceKey

  if (!authorizedByCronSecret && !authorizedByServiceRole) {
    return json({ error: "No autorizado." }, 401)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data, error } = await admin.rpc("purge_old_security_login_logs")
  if (error) return json({ error: error.message || "No se pudo purgar logs." }, 500)

  return json({ ok: true, result: data })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}
