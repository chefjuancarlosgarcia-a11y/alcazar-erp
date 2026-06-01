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
  if (!supabaseUrl || !serviceKey) return json({ error: "Funcion no configurada." }, 500)

  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
  if (!token) return json({ error: "No tienes permisos para eliminar este usuario." }, 401)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return json({ error: "No tienes permisos para eliminar este usuario." }, 401)

  const body = await req.json().catch(() => null)
  const targetId = String(body?.user_id || "")
  if (!targetId || targetId === authData.user.id) return json({ error: "No tienes permisos para eliminar este usuario." }, 403)

  const { data: rows, error: profileError } = await admin
    .from("profiles")
    .select("id, role, status")
    .in("id", [authData.user.id, targetId])
  if (profileError) return json({ error: "Error al guardar en la base de datos." }, 400)

  const actor = rows?.find((row) => row.id === authData.user.id)
  const target = rows?.find((row) => row.id === targetId)
  if (!actor || !target || actor.status !== "active" || !canDelete(actor.role, target.role)) {
    return json({ error: "No tienes permisos para eliminar este usuario." }, 403)
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId)
  if (deleteError) return json({ error: deleteError.message || "Error al guardar en la base de datos." }, 400)
  return json({ deleted: true })
})

const roleAliases: Record<string, string> = {
  "recursos humanos": "recursos_humanos",
  recursos_humanos: "recursos_humanos",
  rrhh: "recursos_humanos",
  "rr.hh.": "recursos_humanos",
  "gerente general": "gerente_general",
  gerente_general: "gerente_general"
}

function canDelete(actorRole: string, targetRole: string) {
  const actor = normalizeRole(actorRole)
  const target = normalizeRole(targetRole)
  if (actor === "admin") return true
  if (actor === "gerente_general") return target !== "admin"
  if (actor === "recursos_humanos") return target !== "admin" && target !== "gerente_general"
  return false
}

function normalizeRole(role: string) {
  const normalized = String(role || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  const spaced = normalized.replace(/[_-]+/g, " ").replace(/\s+/g, " ")
  const underscored = normalized.replace(/[\s-]+/g, "_")
  return roleAliases[underscored] || roleAliases[spaced] || underscored
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}
