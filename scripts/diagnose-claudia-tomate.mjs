import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(resolve(__dirname, "../frontend/package.json"))
const { createClient } = require("@supabase/supabase-js")

const envPath = resolve(__dirname, "../frontend/.env")
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=")
      return [line.slice(0, index), line.slice(index + 1)]
    })
)

const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const supabase = createClient(url, anonKey)

const CANDIDATES = [
  ["claudia.barrios.07@gmail.com", "Claudia123!"],
  ["claudia.barrios.07@gmail.com", "admin"],
  ["claudia@example.com", "admin"]
]

const MANAGER_ROLES = new Set(["admin", "gerente_general", "encargado_almacen"])

async function diagnoseSession(email, password) {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) {
    return { email, ok: false, stage: "auth", error: authError.message }
  }

  const userId = authData.user?.id
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, email, full_name, username, role, status, area_id")
    .eq("id", userId)
    .maybeSingle()

  const { data: allVisibleItems, error: listError } = await supabase
    .from("inventory_items")
    .select("id, name, sku, category, active, created_at, updated_at, area_inventory(area_id, quantity)")
    .order("name", { ascending: true })

  const tomateMatches = (allVisibleItems || []).filter((item) => /tomate/i.test(item.name || ""))

  const { data: created, error: createError } = await supabase
    .from("inventory_items")
    .insert({
      name: `__probe_readonly__ ${Date.now()}`,
      sku: `probe-${Date.now()}`,
      category: "Vegetales",
      purchase_unit: "Unidad/Pieza",
      base_unit: "Unidad/Pieza",
      conversion_factor: 1,
      cost_per_base_unit: 0,
      active: true
    })
    .select("id, name")
    .single()

  let insertProbe = { attempted: true, ok: Boolean(created?.id), error: createError?.message || null }
  if (created?.id) {
    await supabase.from("inventory_items").update({ active: false, notes: "probe cleanup" }).eq("id", created.id)
  }

  await supabase.auth.signOut()

  const role = profile?.role || ""
  const status = profile?.status || ""
  const uiCanManage = MANAGER_ROLES.has(role)
  const dbCanManage = uiCanManage && status === "active"

  return {
    email,
    ok: true,
    userId,
    profile: profileError ? { error: profileError.message } : profile,
    access: {
      uiCanManage,
      dbCanManage,
      role,
      status,
      mismatch: uiCanManage !== dbCanManage
    },
    insertProbe,
    inventoryVisibleCount: allVisibleItems?.length ?? 0,
    tomateMatches,
    listError: listError?.message || null
  }
}

async function main() {
  console.log("Supabase URL:", url)
  for (const [email, password] of CANDIDATES) {
    const result = await diagnoseSession(email, password)
    console.log(JSON.stringify(result, null, 2))
    if (result.ok) break
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
