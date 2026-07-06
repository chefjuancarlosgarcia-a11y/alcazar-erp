export function isConfigurableCatalogState(state) {
  return (state?.productType || "simple") === "configurable"
}

/** Card/filter “listo” — distinto de saleAllowed (venta mesero). */
export function isCatalogCardReady(state) {
  if (!state?.active) return false
  if (isConfigurableCatalogState(state)) {
    return Boolean(state.productionReady)
  }
  return Boolean(state.saleAllowed || state.productionReady)
}

export function catalogStatusLabel(state) {
  if (!state?.active) return "Inactivo"
  if (isConfigurableCatalogState(state)) {
    if (!state?.area) return "Pendiente KDS"
    if (state.productionReady) return "Configurable · Fase 2"
    return "Configuración incompleta"
  }
  if (state.inventoryWillDeduct) return "Venta + inventario"
  if (state.saleAllowed || state.productionReady) return "Venta sin inventario"
  return "Pendiente KDS"
}

export function catalogStatusBadgeClass(state) {
  if (!state?.active) return "inactive"
  if (isConfigurableCatalogState(state)) {
    if (!state?.area) return "pending"
    if (state.productionReady) return "configurable"
    return "pending"
  }
  if (state.saleAllowed || state.productionReady) return "ready"
  return "pending"
}

export function matchesCatalogFilters(item, filters, getState) {
  const query = String(filters.query || "").trim().toLowerCase()
  const categoryId = filters.categoryId || ""
  const status = filters.status || "all"
  const state = getState(item)

  if (query && !`${item.nombre || item.name} ${item.categoria || item.category_name || ""}`.toLowerCase().includes(query)) {
    return false
  }
  if (categoryId && String(item.categoriaId || item.categoryId || item.category_id || "") !== String(categoryId)) {
    return false
  }
  if (status === "active" && !state.active) return false
  if (status === "inactive" && state.active) return false
  if (status === "ready" && !isCatalogCardReady(state)) return false
  if (status === "pending" && !(state.active && !isCatalogCardReady(state))) return false
  return true
}

function normalizeSearchQuery(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

function recipeIngredientNames(recipe) {
  return (recipe?.ingredients || recipe?.recipe_ingredients || [])
    .map((ingredient) => ingredient?.item?.name || ingredient?.inventory_item?.name || ingredient?.name || "")
    .filter(Boolean)
}

export function buildProductSearchHaystack(product, recipe = null) {
  return [
    product?.nombre,
    product?.name,
    product?.description,
    product?.descripcion,
    product?.categoria,
    product?.categoryName,
    product?.category_name,
    product?.sku,
    product?.codigo,
    product?.code,
    product?.id,
    ...recipeIngredientNames(recipe)
  ]
    .filter(Boolean)
    .join(" ")
}

export function matchesPosProductQuickSearch(product, query, recipe = null) {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return false
  const haystack = normalizeSearchQuery(buildProductSearchHaystack(product, recipe))
  return haystack.includes(normalizedQuery)
}

export function filterPosProductQuickSearch(items, query, getRecipe, limit = 12) {
  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) return []
  return items
    .filter((item) => matchesPosProductQuickSearch(item, normalizedQuery, getRecipe?.(item)))
    .slice(0, limit)
}
