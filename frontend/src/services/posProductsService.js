import { supabase } from "../lib/supabase"

const productSelect = `
  *,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active),
  production_area:areas(id, name, active, is_production_area)
`

export function mapPOSProductFromSupabase(row) {
  if (!row) return row
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
    recipe: row.recipe,
    productionArea: row.production_area
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
    active: product.active ?? product.estado === "activo",
    sort_order: Number(product.sortOrder ?? product.sort_order ?? 0)
  }
}

async function queryProducts(filters = {}) {
  let query = supabase.from("pos_products").select(productSelect)
  if (filters.active) query = query.eq("active", true)
  if (filters.productionReady) query = query.eq("production_ready", true)
  const { data, error } = await query.order("sort_order", { ascending: true }).order("name", { ascending: true })
  return { data: (data || []).map(mapPOSProductFromSupabase), error }
}

export function getPOSProducts() {
  return queryProducts()
}

export function getActivePOSProducts() {
  return queryProducts({ active: true })
}

export function getProductionReadyPOSProducts() {
  return queryProducts({ active: true, productionReady: true })
}

export async function getPOSProductById(id) {
  const { data, error } = await supabase.from("pos_products").select(productSelect).eq("id", id).maybeSingle()
  return { data: mapPOSProductFromSupabase(data), error }
}

export async function createPOSProduct(product) {
  const { data, error } = await supabase.from("pos_products").insert(serializeProduct(product)).select(productSelect).single()
  return { data: mapPOSProductFromSupabase(data), error }
}

export async function updatePOSProduct(id, updates) {
  const { data, error } = await supabase.from("pos_products").update(serializeProduct(updates)).eq("id", id).select(productSelect).single()
  return { data: mapPOSProductFromSupabase(data), error }
}

export async function deactivatePOSProduct(id) {
  const { data, error } = await supabase.from("pos_products").update({ active: false, production_ready: false }).eq("id", id).select(productSelect).single()
  return { data: mapPOSProductFromSupabase(data), error }
}

export function validatePOSProduct(product) {
  const errors = []
  if (!String(product.name || product.nombre || "").trim()) errors.push("Falta nombre.")
  if (Number(product.price ?? product.precio ?? 0) < 0) errors.push("El precio no es válido.")
  if ((product.active ?? product.estado === "activo") && !(product.recipeId || product.recipe_id)) errors.push("Falta receta.")
  if ((product.active ?? product.estado === "activo") && !(product.productionAreaId || product.production_area_id || product.areaProduccion)) errors.push("Falta área de producción.")
  return { valid: errors.length === 0, errors }
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
  return { data: mapPOSProductFromSupabase(data), error }
}

