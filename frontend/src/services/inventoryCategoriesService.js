import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"
import {
  isValidInventoryCategoryCode,
  normalizeInventoryCategoryLabel,
  slugifyInventoryCategoryCode
} from "../utils/inventoryCategoryUtils"

function normalizeCategory(row) {
  return row
    ? {
        id: row.id,
        code: row.code,
        name: row.name,
        isActive: row.is_active !== false,
        sortOrder: Number(row.sort_order || 0),
        createdAt: row.created_at,
        updatedAt: row.updated_at
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

function mapSupabaseError(error, fallbackMessage) {
  if (!error) return null
  const message = String(error.message || "")
  if (message.includes("inventory_categories_code_key") || message.includes("duplicate key") && message.includes("code")) {
    return "Ya existe una categoría con ese código."
  }
  if (message.includes("inventory_categories_name_key") || message.includes("duplicate key") && message.includes("name")) {
    return "Ya existe una categoría con ese nombre."
  }
  return message || fallbackMessage
}

async function fetchCategoryUsageCountsMap() {
  const { data, error } = await supabase.rpc("get_inventory_category_product_counts")
  if (!error && data && typeof data === "object") {
    return { data, error: null }
  }

  const { data: items, error: itemsError } = await supabase.from("inventory_items").select("category")
  if (itemsError) return { data: {}, error: itemsError }

  const counts = {}
  for (const item of items || []) {
    const key = normalizeInventoryCategoryLabel(item.category)
    if (!key) continue
    counts[key] = (counts[key] || 0) + 1
  }
  return { data: counts, error: null }
}

function resolveUsageCount(category, usageMap = {}) {
  const normalizedName = normalizeInventoryCategoryLabel(category?.name)
  const normalizedCode = normalizeInventoryCategoryLabel(category?.code)
  return Number(usageMap[normalizedName] || usageMap[normalizedCode] || 0)
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

export async function listInventoryCategories({ includeInactive = false } = {}) {
  const result = includeInactive
    ? await getInventoryCategories()
    : await getActiveInventoryCategories()
  return result
}

export async function getInventoryCategoryUsage({ id, code, name, category, categories = [] } = {}) {
  let targetName = name || category?.name || ""
  let targetCode = code || category?.code || ""

  if (!targetName && id) {
    const match = categories.find((entry) => entry.id === id)
    targetName = match?.name || ""
    targetCode = match?.code || targetCode
  }

  const { data: usageMap, error } = await fetchCategoryUsageCountsMap()
  if (error) return { count: 0, error }

  if (targetName) {
    return { count: Number(usageMap[normalizeInventoryCategoryLabel(targetName)] || 0), error: null }
  }
  if (targetCode) {
    return { count: Number(usageMap[normalizeInventoryCategoryLabel(targetCode)] || 0), error: null }
  }
  return { count: 0, error: null }
}

export async function listInventoryCategoriesWithUsage({ includeInactive = true } = {}) {
  const [categoriesResult, usageResult] = await Promise.all([
    listInventoryCategories({ includeInactive }),
    fetchCategoryUsageCountsMap()
  ])

  if (categoriesResult.error) {
    return { data: [], error: categoriesResult.error }
  }
  if (usageResult.error) {
    return { data: categoriesResult.data || [], error: usageResult.error }
  }

  const data = (categoriesResult.data || []).map((category) => ({
    ...category,
    productCount: resolveUsageCount(category, usageResult.data)
  }))
  return { data, error: null }
}

function validateCategoryPayload(payload, { editing = false, lockCode = false } = {}) {
  const name = String(payload.name || "").trim()
  if (!name) {
    return { error: "El nombre es obligatorio." }
  }

  let code = String(payload.code || "").trim().toLowerCase()
  if (!code) code = slugifyInventoryCategoryCode(name)
  if (!code) {
    return { error: "No se pudo generar un código válido para la categoría." }
  }
  if (!isValidInventoryCategoryCode(code)) {
    return { error: "El código solo puede contener letras minúsculas, números, guiones o guiones bajos." }
  }
  if (lockCode && payload.code && payload.code !== code) {
    return { error: "No puedes cambiar el código porque hay productos usando esta categoría." }
  }

  const sortOrder = payload.sortOrder === "" || payload.sortOrder == null
    ? 0
    : Number(payload.sortOrder)
  if (!Number.isFinite(sortOrder)) {
    return { error: "El orden debe ser un número válido." }
  }

  return {
    data: {
      name,
      code,
      sort_order: Math.trunc(sortOrder),
      is_active: payload.isActive !== false
    }
  }
}

export async function createInventoryCategory(payload, { existingCategories = [] } = {}) {
  const validated = validateCategoryPayload(payload)
  if (validated.error) return { data: null, error: { message: validated.error } }

  const normalizedName = normalizeInventoryCategoryLabel(validated.data.name)
  const duplicateName = existingCategories.find(
    (category) => normalizeInventoryCategoryLabel(category.name) === normalizedName
  )
  if (duplicateName) {
    return { data: null, error: { message: `Ya existe una categoría similar: "${duplicateName.name}".` } }
  }

  const duplicateCode = existingCategories.find((category) => category.code === validated.data.code)
  if (duplicateCode) {
    return { data: null, error: { message: "Ya existe una categoría con ese código." } }
  }

  const { data, error } = await supabase
    .from("inventory_categories")
    .insert(validated.data)
    .select("*")
    .single()

  invalidateInventoryCategoriesCache()
  return { data: normalizeCategory(data), error: error ? { message: mapSupabaseError(error, "No se pudo crear la categoría.") } : null }
}

export async function updateInventoryCategory(id, payload, { existingCategories = [], productCount = 0 } = {}) {
  const lockCode = productCount > 0
  const validated = validateCategoryPayload(payload, { editing: true, lockCode })
  if (validated.error) return { data: null, error: { message: validated.error } }

  const current = existingCategories.find((category) => category.id === id)
  if (!current) {
    return { data: null, error: { message: "Categoría no encontrada." } }
  }

  if (lockCode && validated.data.code !== current.code) {
    return { data: null, error: { message: "No puedes cambiar el código porque hay productos usando esta categoría." } }
  }

  const normalizedName = normalizeInventoryCategoryLabel(validated.data.name)
  const duplicateName = existingCategories.find(
    (category) => category.id !== id && normalizeInventoryCategoryLabel(category.name) === normalizedName
  )
  if (duplicateName) {
    return { data: null, error: { message: `Ya existe una categoría similar: "${duplicateName.name}".` } }
  }

  const duplicateCode = existingCategories.find(
    (category) => category.id !== id && category.code === validated.data.code
  )
  if (duplicateCode) {
    return { data: null, error: { message: "Ya existe otra categoría con ese código." } }
  }

  const { data, error } = await supabase
    .from("inventory_categories")
    .update(validated.data)
    .eq("id", id)
    .select("*")
    .single()

  invalidateInventoryCategoriesCache()
  return { data: normalizeCategory(data), error: error ? { message: mapSupabaseError(error, "No se pudo actualizar la categoría.") } : null }
}

export async function deactivateInventoryCategory(id) {
  const { data, error } = await supabase
    .from("inventory_categories")
    .update({ is_active: false })
    .eq("id", id)
    .select("*")
    .single()

  invalidateInventoryCategoriesCache()
  return { data: normalizeCategory(data), error }
}

export async function reactivateInventoryCategory(id) {
  const { data, error } = await supabase
    .from("inventory_categories")
    .update({ is_active: true })
    .eq("id", id)
    .select("*")
    .single()

  invalidateInventoryCategoriesCache()
  return { data: normalizeCategory(data), error }
}

export function invalidateInventoryCategoriesCache() {
  invalidateQueryCache(CACHE_KEYS.INVENTORY_CATEGORIES_PREFIX)
}
