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
  if (status === "ready" && !state.productionReady) return false
  if (status === "pending" && !(state.active && !state.productionReady)) return false
  return true
}

export function catalogStatusLabel(state) {
  if (!state.active) return "Inactivo"
  if (state.productionReady) return "Listo KDS"
  return "Pendiente KDS"
}
