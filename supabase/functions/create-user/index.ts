import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
}

const protectedRoles = ["admin", "gerente_general"]
const validRoles = [
  "admin",
  "gerente_general",
  "gerente",
  "encargado_almacen",
  "rrhh",
  "supervisor",
  "cajero",
  "mesero",
  "cocinero",
  "pizzero",
  "barista",
  "bartender",
  "repostero",
  "panadero",
  "colaborador"
]

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Metodo no permitido." }, 405)

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceKey) return json({ error: "Funcion no configurada." }, 500)

  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
  if (!token) return json({ error: "No tienes permisos para crear usuarios." }, 401)

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: authData, error: authError } = await admin.auth.getUser(token)
  if (authError || !authData.user) return json({ error: "No tienes permisos para crear usuarios." }, 401)

  const { data: actor, error: actorError } = await admin
    .from("profiles")
    .select("id, role, status")
    .eq("id", authData.user.id)
    .single()
  if (actorError || !actor || actor.status !== "active") return json({ error: "No tienes permisos para crear usuarios." }, 403)

  const body = await req.json().catch(() => null)
  const email = String(body?.email || "").trim()
  const password = String(body?.password || "")
  const profile = body?.profile || {}
  const role = validRoles.includes(profile.role) ? profile.role : "colaborador"

  if (!email || !password || !String(profile.full_name || "").trim() || !String(profile.username || "").trim()) {
    return json({ error: "Faltan campos obligatorios." }, 400)
  }
  if (!canCreateRole(actor.role, role)) return json({ error: "No tienes permisos para asignar ese rol." }, 403)

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: String(profile.full_name).trim(),
      username: String(profile.username).trim(),
      role
    }
  })
  if (createError || !created.user) return json({ error: createError?.message || "Error al guardar en la base de datos." }, 400)

  const { error: profileError } = await admin
    .from("profiles")
    .upsert({
      id: created.user.id,
      email,
      full_name: String(profile.full_name).trim(),
      username: String(profile.username).trim(),
      role,
      area_id: profile.area_id || null,
      area_name: profile.area_name || null,
      employee_id: profile.employee_id || null,
      phone: profile.phone || null,
      status: validStatus(profile.status),
      updated_at: new Date().toISOString()
    })
  if (profileError) {
    await admin.auth.admin.deleteUser(created.user.id)
    return json({ error: profileError.message || "Error al guardar en la base de datos." }, 400)
  }

  return json({ user_id: created.user.id })
})

function canCreateRole(actorRole: string, nextRole: string) {
  if (actorRole === "admin") return true
  if (actorRole === "gerente_general") return nextRole !== "admin"
  if (actorRole === "rrhh") return !protectedRoles.includes(nextRole)
  return false
}

function validStatus(status: string) {
  return ["active", "inactive", "suspended"].includes(status) ? status : "active"
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  })
}
