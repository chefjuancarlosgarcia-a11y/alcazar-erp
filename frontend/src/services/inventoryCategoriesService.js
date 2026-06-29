import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"

function normalizeCategory(row) {
  return row
    ? {
        id: row.id,
        code: row.code,
        name: row.name,
        isActive: row.is_active !== false,
        sortOrder: Number(row.sort_order || 0)
      }
    : row
}

async function fetchCategories(activeOnly = false) {
  let query = supabase.from("inventory_categories").select("*")
  if (activeOnly) query = query.eq("is_active", true)
  const { data, error } = await query
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
  return { data: (data || []).map(normalizeCategory), error }
}

export function getInventoryCategories() {
  return cachedQuery(
    CACHE_KEYS.INVENTORY_CATEGORIES_ALL,
    () => fetchCategories(false),
    CACHE_TTL.CATALOG
  )
}

export function getActiveInventoryCategories() {
  return cachedQuery(
    CACHE_KEYS.INVENTORY_CATEGORIES_ACTIVE,
    () => fetchCategories(true),
    CACHE_TTL.CATALOG
  )
}

export function invalidateInventoryCategoriesCache() {
  invalidateQueryCache(CACHE_KEYS.INVENTORY_CATEGORIES_PREFIX)
}
