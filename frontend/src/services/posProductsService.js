import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"
import {
  serializeConfigurableGroupsForSave,
  validateConfigurableCatalogForm
} from "../utils/posConfigurableProduct"

const optionChoiceSelect = `
  id,
  group_id,
  name,
  sort_order,
  price_mode,
  price,
  recipe_id,
  is_active,
  created_at,
  updated_at,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active)
`

const productSelect = `
  *,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active),
  production_area:areas(id, name, active, is_production_area),
  variants:pos_product_variants(
    id,
    product_id,
    name,
    size,
    price,
    recipe_id,
    production_area_id,
    prep_time_minutes,
    is_active,
    sort_order,
    created_at,
    updated_at,
    recipe:standard_recipes(id, name, recipe_type, production_area_id, active)
  ),
  modifier_options:pos_product_modifiers(
    id,
    product_id,
    name,
    modifier_type,
    price_delta,
    is_active,
    sort_order,
    created_at,
    updated_at
  ),
  option_groups:pos_option_groups(
    id,
    product_id,
    name,
    sort_order,
    required,
    selection_mode,
    min_selections,
    max_selections,
    is_active,
    created_at,
    updated_at,
    choices:pos_option_choices(${optionChoiceSelect})
  )
`

function mapVariantFromSupabase(variant) {
  if (!variant) return null
  return {
    ...variant,
    price: Number(variant.price || 0),
    prep_time_minutes: Number(variant.prep_time_minutes || 0),
    prepTimeMinutes: Number(variant.prep_time_minutes || 0),
    recipeId: variant.recipe_id || "",
    productionAreaId: variant.production_area_id || "",
    is_active: variant.is_active === true,
    isActive: variant.is_active === true,
    recipe: variant.recipe || null
  }
}

function mapModifierFromSupabase(modifier) {
  if (!modifier) return null
  return {
    ...modifier,
    modifierType: modifier.modifier_type || "remove",
    price_delta: Number(modifier.price_delta || 0),
    priceDelta: Number(modifier.price_delta || 0),
    is_active: modifier.is_active !== false,
    isActive: modifier.is_active !== false
  }
}

function mapOptionChoiceFromSupabase(choice) {
  if (!choice) return null
  return {
    ...choice,
    price: Number(choice.price || 0),
    priceMode: choice.price_mode || "none",
    price_mode: choice.price_mode || "none",
    recipeId: choice.recipe_id || "",
    is_active: choice.is_active !== false,
    isActive: choice.is_active !== false,
    sortOrder: Number(choice.sort_order || 0)
  }
}

function mapOptionGroupFromSupabase(group) {
  if (!group) return null
  const choices = Array.isArray(group.choices)
    ? [...group.choices]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapOptionChoiceFromSupabase)
    : []
  return {
    ...group,
    selectionMode: group.selection_mode || "single",
    selection_mode: group.selection_mode || "single",
    minSelections: Number(group.min_selections ?? 0),
    maxSelections: group.max_selections ?? null,
    is_active: group.is_active !== false,
    isActive: group.is_active !== false,
    sortOrder: Number(group.sort_order || 0),
    choices
  }
}

export function mapPOSProductFromSupabase(row) {
  if (!row) return row
  const variants = Array.isArray(row.variants)
    ? [...row.variants]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapVariantFromSupabase)
    : []
  const modifierOptions = Array.isArray(row.modifier_options)
    ? [...row.modifier_options]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapModifierFromSupabase)
    : []
  const optionGroups = Array.isArray(row.option_groups)
    ? [...row.option_groups]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapOptionGroupFromSupabase)
    : []
  return {
    ...row,
    name: row.name,
    nombre: row.name,
    description: row.description || "",
    descripcion: row.description || "",
    price: Number(row.price || 0),
    precio: Number(row.price || 0),
    image: row.image_url || "",
    imagen: row.image_url || "",
    categoryId: row.category_id || "",
    categoriaId: row.category_id || "",
    categoryName: row.category_name || row.category_id || "",
    categoria: row.category_name || row.category_id || "",
    recipeId: row.recipe_id || "",
    productionAreaId: row.production_area_id || "",
    areaProduccion: row.production_area_id || "",
    active: row.active === true,
    estado: row.active === true ? "activo" : "inactivo",
    productionReady: row.production_ready === true,
    inventoryTrackingEnabled: row.inventory_tracking_enabled === true,
    inventory_tracking_enabled: row.inventory_tracking_enabled === true,
    recipeRequiredForSale: row.recipe_required_for_sale === true,
    recipe_required_for_sale: row.recipe_required_for_sale === true,
    recipeStatus: row.recipe_status || "missing",
    recipe_status: row.recipe_status || "missing",
    isTestItem: row.is_test_item === true,
    is_test_item: row.is_test_item === true,
    productType: row.product_type || "simple",
    product_type: row.product_type || "simple",
    allowKitchenNotes: row.allow_kitchen_notes === true,
    allow_kitchen_notes: row.allow_kitchen_notes === true,
    prepTimeMinutes: Number(row.prep_time_minutes || 0),
    prep_time_minutes: Number(row.prep_time_minutes || 0),
    recipe: row.recipe,
    productionArea: row.production_area,
    variants,
    modifierOptions,
    modifiers: modifierOptions,
    optionGroups,
    option_groups: optionGroups
  }
}

function serializeProduct(product) {
  return {
    name: String(product.name || product.nombre || "").trim(),
    description: String(product.description || product.descripcion || "").trim() || null,
    price: Number(product.price ?? product.precio ?? 0),
    image_url: product.image_url || product.image || product.imagen || null,
    category_id: product.categoryId || product.categoriaId || product.category_id || null,
    category_name: product.categoryName || product.categoria || product.category_name || null,
    recipe_id: product.recipeId || product.recipe_id || null,
    production_area_id: product.productionAreaId || product.areaProduccion || product.production_area_id || null,
    is_test_item: product.isTestItem === true || product.is_test_item === true,
    inventory_tracking_enabled: product.inventoryTrackingEnabled === true || product.inventory_tracking_enabled === true,
    recipe_required_for_sale: product.recipeRequiredForSale === true || product.recipe_required_for_sale === true,
    product_type: product.productType || product.product_type || "simple",
    allow_kitchen_notes: product.allowKitchenNotes === true || product.allow_kitchen_notes === true,
    prep_time_minutes: Number(product.prepTimeMinutes ?? product.prep_time_minutes ?? product.tiempoPreparacion ?? 0),
    active: product.active ?? product.estado === "activo",
    sort_order: Number(product.sortOrder ?? product.sort_order ?? 0)
  }
}

function serializeVariant(variant = {}, index = 0, fallbackName = "") {
  return {
    id: variant.id || null,
    name: String(variant.name || fallbackName || "").trim() || fallbackName || null,
    size: String(variant.size || "").trim().toLowerCase(),
    price: Number(variant.price ?? 0),
    recipe_id: variant.recipeId || variant.recipe_id || null,
    prep_time_minutes: Number(variant.prepTimeMinutes ?? variant.prep_time_minutes ?? 0),
    is_active: variant.isActive === true || variant.is_active === true,
    sort_order: Number(variant.sortOrder ?? variant.sort_order ?? index)
  }
}

function serializeModifier(modifier = {}, index = 0) {
  return {
    id: modifier.id || null,
    name: String(modifier.name || "").trim(),
    modifier_type: String(modifier.modifier_type || modifier.modifierType || "remove").trim().toLowerCase(),
    price_delta: Number(modifier.price_delta ?? modifier.priceDelta ?? 0),
    is_active: modifier.is_active !== false && modifier.isActive !== false,
    sort_order: Number(modifier.sortOrder ?? modifier.sort_order ?? index)
  }
}

async function queryProducts(filters = {}) {
  let query = supabase.from("pos_products").select(productSelect)
  if (filters.active) query = query.eq("active", true)
  if (filters.productionReady) query = query.eq("production_ready", true)
  const { data, error } = await query.order("sort_order", { ascending: true }).order("name", { ascending: true })
  return { data: (data || []).map(mapPOSProductFromSupabase), error }
}

export function invalidatePOSProductsCache() {
  invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX)
}

function invalidateAfterProductMutation(result) {
  if (!result?.error) invalidatePOSProductsCache()
  return result
}

export function getPOSProducts() {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, () => queryProducts(), CACHE_TTL.CATALOG)
}

export function getActivePOSProducts() {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_ACTIVE, () => queryProducts({ active: true }), CACHE_TTL.CATALOG)
}

export function getProductionReadyPOSProducts() {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_PRODUCTION, () => queryProducts({ active: true, productionReady: true }), CACHE_TTL.CATALOG)
}

export async function getPOSProductById(id) {
  const { data, error } = await supabase.from("pos_products").select(productSelect).eq("id", id).maybeSingle()
  return { data: mapPOSProductFromSupabase(data), error }
}

export async function createPOSProduct(product) {
  const result = await supabase.from("pos_products").insert(serializeProduct(product)).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function updatePOSProduct(id, updates) {
  const result = await supabase.from("pos_products").update(serializeProduct(updates)).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function deactivatePOSProduct(id) {
  const result = await supabase.from("pos_products").update({ active: false, production_ready: false }).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function activatePOSProduct(id) {
  const result = await supabase.from("pos_products").update({ active: true }).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function savePOSCatalogProduct(product, variants = [], modifiers = [], optionGroups = []) {
  const payload = serializeProduct(product)
  const productType = payload.product_type || "simple"
  const variantPayload = productType === "pizza"
    ? (Array.isArray(variants) ? variants : []).map((variant, index) => serializeVariant(variant, index, payload.name))
    : []
  const modifierPayload = productType === "pizza"
    ? (Array.isArray(modifiers) ? modifiers : []).map((modifier, index) => serializeModifier(modifier, index))
    : []
  const optionGroupPayload = productType === "configurable"
    ? serializeConfigurableGroupsForSave(optionGroups)
    : []
  const { data, error } = await supabase.rpc("save_pos_catalog_product", {
    p_product_id: product.id || product.productId || null,
    p_product: payload,
    p_variants: variantPayload,
    p_modifiers: modifierPayload,
    p_option_groups: optionGroupPayload
  })
  if (error) return { data: null, error }
  invalidatePOSProductsCache()
  const productId = data?.id || product.id || product.productId
  if (!productId) return { data: mapPOSProductFromSupabase(data), error: null }
  return getPOSProductById(productId)
}

export function validatePOSProduct(product, { strictRecipe = false } = {}) {
  const errors = []
  const productType = product.productType || product.product_type || "simple"
  const active = product.active ?? product.estado === "activo"
  if (!String(product.name || product.nombre || "").trim()) errors.push("Falta nombre.")
  if (Number(product.price ?? product.precio ?? 0) < 0) errors.push("El precio no es valido.")
  if (active && !(product.productionAreaId || product.production_area_id || product.areaProduccion)) errors.push("Falta area de produccion.")
  const recipeRequired = strictRecipe || product.recipeRequiredForSale === true || product.recipe_required_for_sale === true
  if (active && recipeRequired && !product.isTestItem && !product.is_test_item && productType !== "pizza" && productType !== "configurable" && !(product.recipeId || product.recipe_id)) {
    errors.push("Falta receta.")
  }
  if (active && productType === "pizza") {
    const activeVariants = (product.variants || []).filter((variant) => variant.isActive === true || variant.is_active === true)
    if (activeVariants.length === 0) {
      errors.push("Falta al menos una variante activa.")
    } else if (activeVariants.some((variant) => Number(variant.price || 0) <= 0 || (strictRecipe && !(variant.recipeId || variant.recipe_id)))) {
      errors.push("Hay variantes activas sin precio o receta.")
    }
  }
  if (active && productType === "configurable") {
    const { errors: configurableErrors } = validateConfigurableCatalog(product)
    errors.push(...configurableErrors)
  }
  return { valid: errors.length === 0, errors }
}

function validateConfigurableCatalog(product) {
  return validateConfigurableCatalogForm(product.optionGroups || product.option_groups || [], {
    active: product.active ?? product.estado === "activo"
  })
}

export async function createOrUpdatePOSProductFromRecipe(recipe, productId = null) {
  const payload = {
    name: recipe.name,
    description: recipe.description || recipe.notes || `Producto generado desde receta: ${recipe.name}`,
    price: Number(recipe.salePrice || recipe.price || 0),
    image_url: recipe.imageUrl || recipe.image_url || "",
    category_id: recipe.posCategoryId || recipe.pos_category_id || "extras",
    category_name: recipe.categoryName || recipe.posCategoryId || recipe.pos_category_id || "Extras",
    sort_order: Number(recipe.sortOrder || 0)
  }
  const { data, error } = await supabase.rpc("save_pos_product_from_recipe", {
    p_product_id: productId || null,
    p_recipe_id: recipe.id || recipe.recipeId,
    p_product: payload
  })
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(data), error })
}
