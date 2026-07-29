/**
 * Canonical POS sale-product DTO consumed by POS.jsx, PosClassicOperation, PosProductGrid, ticket flows.
 * Human catalog rows and station RPC rows normalize to the same shape via mapPOSProductFromSupabase.
 */

export function mapVariantFromSupabase(variant) {
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

export function mapModifierFromSupabase(modifier) {
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

export function mapOptionChoiceFromSupabase(choice) {
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

export function mapOptionGroupFromSupabase(group) {
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
    : Array.isArray(row.modifiers)
      ? [...row.modifiers]
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
          .map(mapModifierFromSupabase)
      : []
  const optionGroups = Array.isArray(row.option_groups)
    ? [...row.option_groups]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapOptionGroupFromSupabase)
    : []
  const productionArea = row.production_area || (
    row.production_area_name
      ? {
          id: row.production_area_id || "",
          name: row.production_area_name,
          active: true,
          is_production_area: true
        }
      : null
  )
  return {
    ...row,
    id: row.id,
    productId: row.productId || row.id,
    name: row.name,
    nombre: row.name,
    description: row.description || "",
    descripcion: row.description || "",
    price: Number(row.price || 0),
    precio: Number(row.price || 0),
    basePrice: Number(row.price || 0),
    image: row.image_url || row.image || "",
    imagen: row.image_url || row.image || row.imagen || "",
    categoryId: row.category_id || "",
    categoriaId: row.category_id || "",
    categoryName: row.category_name || row.category_id || "",
    categoria: row.category_name || row.category_id || "",
    recipeId: row.recipe_id || "",
    productionAreaId: row.production_area_id || "",
    areaProduccion: row.production_area_id || "",
    productionArea,
    active: row.active !== false,
    available: row.active !== false && row.production_ready !== false,
    estado: row.active !== false ? "activo" : "inactivo",
    productionReady: row.production_ready === true,
    production_ready: row.production_ready === true,
    activeOptionGroupsCount: row.active_option_groups_count != null ? Number(row.active_option_groups_count) : null,
    active_option_groups_count: row.active_option_groups_count != null ? Number(row.active_option_groups_count) : null,
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
    variants,
    modifierOptions,
    modifiers: modifierOptions,
    modifierGroups: modifierOptions,
    optionGroups,
    option_groups: optionGroups,
    optionGroupsHydrated: true,
    optionSelections: row.optionSelections || row.option_selections || {},
    sort_order: row.sort_order,
    sortOrder: row.sort_order
  }
}

/** Adapt get_station_pos_catalog product row to the human Supabase row shape, then canonical DTO. */
export function normalizeStationCatalogProduct(stationRow) {
  if (!stationRow) return stationRow
  return mapPOSProductFromSupabase({
    ...stationRow,
    active: stationRow.active !== false,
    modifier_options: stationRow.modifiers || stationRow.modifier_options || [],
    image_url: stationRow.image_url || "",
    description: stationRow.description || ""
  })
}

export function normalizeStationPosCatalogResponse(data) {
  return (data?.products || []).map(normalizeStationCatalogProduct)
}

/** @deprecated Use normalizeStationPosCatalogResponse */
export function mapStationPosCatalogResponse(data) {
  return normalizeStationPosCatalogResponse(data)
}

export function productCategoryIdForPos(product) {
  return product?.categoriaId || product?.categoryId || product?.category_id || ""
}

export function deriveProductionAreasFromCatalogProducts(products = []) {
  const byId = new Map()
  products.forEach((product) => {
    const id = product.productionAreaId || product.production_area_id || product.areaProduccion
    if (!id) return
    const name = product.productionArea?.name
      || product.production_area?.name
      || product.production_area_name
      || id
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name,
        active: true,
        isProductionArea: true,
        is_production_area: true
      })
    }
  })
  return [...byId.values()]
}

/**
 * Merge RPC-derived category ids with DEFAULT_POS_CATEGORIES metadata (no localStorage).
 * Custom human-only categories in localStorage are intentionally excluded from station.
 */
export function buildStationCategoriesFromCatalogProducts(products = [], defaultCategories = []) {
  const catalogIds = new Set()
  products.forEach((product) => {
    const id = productCategoryIdForPos(product)
    if (id) catalogIds.add(id)
  })
  const defaultsById = new Map(defaultCategories.map((category) => [category.id, category]))
  const merged = []
  defaultCategories.forEach((def) => {
    if (catalogIds.has(def.id)) {
      merged.push({ ...def, active: true })
    }
  })
  catalogIds.forEach((id) => {
    if (defaultsById.has(id)) return
    const sample = products.find((product) => productCategoryIdForPos(product) === id)
    merged.push({
      id,
      name: sample?.categoryName || sample?.categoria || sample?.category_name || id,
      description: "",
      productionAreaId: sample?.productionAreaId || sample?.production_area_id || "cocina",
      active: true,
      sortOrder: merged.length + 1,
      color: "#64748b",
      icon: "📦"
    })
  })
  return merged.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
}

export function isStationOrderOwnedByOperator(order, operatorProfileId) {
  if (!order || !operatorProfileId) return true
  const ownerId = order.ownerProfileId || order.owner_profile_id || order.waiterId || order.waiter_id
  if (!ownerId) return true
  return String(ownerId) === String(operatorProfileId)
}
