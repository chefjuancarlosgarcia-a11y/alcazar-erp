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
  if (status === "ready" && !(state.saleAllowed ?? state.productionReady)) return false
  if (status === "pending" && !(state.active && !(state.saleAllowed ?? state.productionReady))) return false
  return true
}

export function catalogStatusLabel(state) {
  if (!state.active) return "Inactivo"
  if (state.inventoryWillDeduct) return "Venta + inventario"
  if (state.saleAllowed ?? state.productionReady) return "Venta sin inventario"
  return "Pendiente KDS"
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
