export function mapStationCatalogProduct(p) {
  const categoryId = p.category_id || null
  return {
    id: p.id,
    productId: p.id,
    name: p.name,
    nombre: p.name,
    price: Number(p.price || 0),
    precio: Number(p.price || 0),
    category_id: categoryId,
    categoryId,
    categoriaId: categoryId,
    category_name: p.category_name,
    categoria: p.category_name || "",
    recipeId: p.recipe_id,
    recipe_id: p.recipe_id,
    productionAreaId: p.production_area_id,
    production_area_id: p.production_area_id,
    areaProduccion: p.production_area_id || "",
    productionReady: p.production_ready === true,
    production_ready: p.production_ready === true,
    product_type: p.product_type || "simple",
    productType: p.product_type || "simple",
    isTestItem: p.is_test_item === true,
    is_test_item: p.is_test_item === true,
    allow_kitchen_notes: p.allow_kitchen_notes,
    sort_order: p.sort_order,
    variants: p.variants || [],
    modifier_options: p.modifiers || [],
    modifiers: p.modifiers || [],
    optionGroups: p.option_groups || [],
    option_groups: p.option_groups || [],
    optionGroupsHydrated: true,
    active: true,
    estado: "activo"
  }
}

export function mapStationPosCatalogResponse(data) {
  return (data?.products || []).map(mapStationCatalogProduct)
}

export function buildStationCategoriesFromCatalogProducts(products = []) {
  const byId = new Map()
  products.forEach((product) => {
    const id = product.categoryId || product.categoriaId || product.category_id
    if (!id) return
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: product.category_name || product.categoria || id,
        description: "",
        productionAreaId: product.productionAreaId || product.production_area_id || "cocina",
        active: true,
        sortOrder: byId.size + 1,
        color: "#64748b",
        icon: "M"
      })
    }
  })
  return [...byId.values()].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
}

export function productCategoryIdForPos(product) {
  return product?.categoriaId || product?.categoryId || product?.category_id || ""
}
