import { supabase } from "../lib/supabase"

const RECIPE_GRAMS_UNIT = "Gramos"
const INVENTORY_PRODUCT_CONVERSION_NOTE = "Equivalencia creada desde producto de inventario"

export async function getItemConversions(itemId) {
  if (!itemId) return { data: [], error: null }
  const { data, error } = await supabase
    .from("inventory_item_unit_conversions")
    .select("*")
    .eq("inventory_item_id", itemId)
    .order("created_at", { ascending: false })
  return { data: data || [], error }
}

export function upsertItemUnitToGramsConversion(itemId, fromUnit, gramsPerUnit) {
  return supabase
    .from("inventory_item_unit_conversions")
    .upsert({
      inventory_item_id: itemId,
      from_unit: String(fromUnit || "").trim(),
      to_unit: RECIPE_GRAMS_UNIT,
      factor: Number(gramsPerUnit || 0),
      notes: INVENTORY_PRODUCT_CONVERSION_NOTE
    }, { onConflict: "inventory_item_id,from_unit,to_unit" })
    .select("*")
    .single()
}

export function deleteItemUnitToGramsConversion(itemId, fromUnit) {
  return supabase
    .from("inventory_item_unit_conversions")
    .delete()
    .eq("inventory_item_id", itemId)
    .eq("from_unit", String(fromUnit || "").trim())
    .in("to_unit", [RECIPE_GRAMS_UNIT, "Gramo", "gramos", "gramo", "g", "G"])
}
