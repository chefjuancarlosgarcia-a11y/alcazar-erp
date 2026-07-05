import { supabase } from "../lib/supabase"

const MIGRATION_HINT = "Aplica la migración 157_pos_implementation_mode.sql en Supabase."

function migrationHint(error) {
  const text = typeof error === "string" ? error : error?.message || "Error en modo de inventario POS."
  if (/does not exist|Could not find the function|schema cache/i.test(text)) {
    return `${text} ${MIGRATION_HINT}`
  }
  return text
}

export async function getInventoryDeductionModeSetting() {
  const { data, error } = await supabase.rpc("get_inventory_deduction_mode_setting")
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function setInventoryDeductionMode(mode, notes = null) {
  const { data, error } = await supabase.rpc("set_inventory_deduction_mode", {
    p_mode: mode,
    p_notes: notes || null
  })
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function getPosImplementationDashboard() {
  const { data, error } = await supabase.rpc("get_pos_implementation_dashboard")
  return { data: data || null, error: error ? migrationHint(error) : "" }
}

export async function updatePosProductImplementationFlags(productId, flags = {}) {
  const update = {}
  if (flags.inventoryTrackingEnabled !== undefined) {
    update.inventory_tracking_enabled = Boolean(flags.inventoryTrackingEnabled)
  }
  if (flags.recipeRequiredForSale !== undefined) {
    update.recipe_required_for_sale = Boolean(flags.recipeRequiredForSale)
  }
  if (!productId) {
    return { data: null, error: "Producto no encontrado." }
  }
  const { data, error } = await supabase
    .from("pos_products")
    .update(update)
    .eq("id", productId)
    .select("*")
    .single()
  return { data, error: error ? migrationHint(error) : "" }
}
