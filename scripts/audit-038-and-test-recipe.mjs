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

const RPC_NAMES = [
  "set_standard_recipe_output_inventory_item",
  "create_internal_production_output_item",
  "can_create_internal_production",
  "can_manage_internal_production",
  "next_production_batch_number",
  "create_internal_production_batch",
  "complete_internal_production_batch",
  "cancel_internal_production_batch"
]

function classifyRpcError(error) {
  if (!error) return "ok"
  const code = error.code || ""
  const message = error.message || ""
  if (code === "PGRST202" || /Could not find the function/i.test(message)) return "missing"
  return "present_or_auth"
}

async function probeRpc(name, params = {}) {
  const { error } = await supabase.rpc(name, params)
  return { name, status: classifyRpcError(error), code: error?.code || null, message: error?.message || null }
}

async function probeTable(table) {
  const { error } = await supabase.from(table).select("id", { count: "exact", head: true })
  if (!error) return { table, status: "present" }
  if (error.code === "PGRST205" || /Could not find the table/i.test(error.message || "")) {
    return { table, status: "missing", message: error.message }
  }
  return { table, status: "present_or_rls", message: error.message }
}

async function findMoisesProfile() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, username, role, status, area_id, area_name")
    .or("full_name.ilike.%mois%,username.ilike.%mois%,email.ilike.%mois%")
    .limit(5)
  return { data: data || [], error: error?.message || null }
}

async function probeRecipeSaveAsUser(email, password) {
  const client = createClient(url, anonKey)
  const { data: authData, error: authError } = await client.auth.signInWithPassword({ email, password })
  if (authError) {
    return { email, ok: false, stage: "auth", error: authError.message }
  }

  const userId = authData.user?.id
  const { data: profile } = await client
    .from("profiles")
    .select("id, email, full_name, role, status, area_id, area_name")
    .eq("id", userId)
    .maybeSingle()

  const { data: recipes, error: recipesError } = await client
    .from("standard_recipes")
    .select("id, name, production_area_id, output_inventory_item_id, active")
    .eq("active", true)
    .order("updated_at", { ascending: false })
    .limit(5)

  const recipe = recipes?.[0]
  if (!recipe?.id) {
    await client.auth.signOut()
    return { email, ok: false, stage: "no_recipe", profile, recipesError: recipesError?.message || null }
  }

  const { data: items } = await client
    .from("inventory_items")
    .select("id, name, active")
    .eq("active", true)
    .limit(1)

  const outputItemId = items?.[0]?.id || recipe.output_inventory_item_id || null
  const rpcResult = await client.rpc("set_standard_recipe_output_inventory_item", {
    p_recipe_id: recipe.id,
    p_output_inventory_item_id: outputItemId
  })

  await client.auth.signOut()

  return {
    email,
    ok: !rpcResult.error,
    stage: rpcResult.error ? "rpc" : "rpc_ok",
    profile,
    recipe: { id: recipe.id, name: recipe.name, area: recipe.production_area_id },
    outputItemId,
    rpcError: rpcResult.error?.message || null,
    rpcCode: rpcResult.error?.code || null
  }
}

async function main() {
  console.log("=== RPC probe (anon, pre-auth) ===")
  for (const name of RPC_NAMES) {
    const params = name === "can_create_internal_production"
      ? { p_area_id: null }
      : name === "cancel_internal_production_batch"
        ? { p_batch_id: "00000000-0000-0000-0000-000000000000", p_notes: null }
        : name === "set_standard_recipe_output_inventory_item"
          ? { p_recipe_id: "00000000-0000-0000-0000-000000000000", p_output_inventory_item_id: null }
          : name === "create_internal_production_output_item"
            ? { p_recipe_id: "00000000-0000-0000-0000-000000000000" }
            : name === "create_internal_production_batch"
              ? { p_batch: {}, p_inputs: [], p_outputs: [] }
              : {}
    const result = await probeRpc(name, params)
    console.log(JSON.stringify(result))
  }

  console.log("\n=== Table probe ===")
  for (const table of ["production_batches", "production_batch_inputs", "production_batch_outputs", "standard_recipes"]) {
    console.log(JSON.stringify(await probeTable(table)))
  }

  console.log("\n=== Moisés profile lookup (anon) ===")
  console.log(JSON.stringify(await findMoisesProfile()))

  const loginCandidates = [
    ["moises.santos@elgranalcazar.com", "admin"],
    ["moises@elgranalcazar.com", "admin"],
    ["mosantos@elgranalcazar.com", "admin"],
    ["claudia.barrios.07@gmail.com", "Claudia123!"]
  ]

  console.log("\n=== Recipe RPC test by user ===")
  for (const [email, password] of loginCandidates) {
    const result = await probeRecipeSaveAsUser(email, password)
    console.log(JSON.stringify(result))
    if (result.ok && /mois/i.test(result.profile?.full_name || result.profile?.email || email)) {
      break
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
