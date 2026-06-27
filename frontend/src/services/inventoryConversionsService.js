import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL, unitsItemCacheKey } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"

const RECIPE_GRAMS_UNIT = "Gramos"
const INVENTORY_PRODUCT_CONVERSION_NOTE = "Equivalencia creada desde producto de inventario"

function invalidateUnitConversionsCache(itemId) {
  invalidateQueryCache(CACHE_KEYS.UNITS_INVENTORY)
  if (itemId) invalidateQueryCache(unitsItemCacheKey(itemId))
}

export function getItemConversions(itemId) {
  if (!itemId) return Promise.resolve({ data: [], error: null })
  return cachedQuery(unitsItemCacheKey(itemId), async () => {
    const { data, error } = await supabase
      .from("inventory_item_unit_conversions")
      .select("*")
      .eq("inventory_item_id", itemId)
      .order("created_at", { ascending: false })
    return { data: data || [], error }
  }, CACHE_TTL.REFERENCE)
}

export async function upsertItemUnitToGramsConversion(itemId, fromUnit, gramsPerUnit) {
  const result = await supabase
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
  if (!result.error) invalidateUnitConversionsCache(itemId)
  return result
}

export async function deleteItemUnitToGramsConversion(itemId, fromUnit) {
  const result = await supabase
    .from("inventory_item_unit_conversions")
    .delete()
    .eq("inventory_item_id", itemId)
    .eq("from_unit", String(fromUnit || "").trim())
    .in("to_unit", [RECIPE_GRAMS_UNIT, "Gramo", "gramos", "gramo", "g", "G"])
  if (!result.error) invalidateUnitConversionsCache(itemId)
  return result
}
