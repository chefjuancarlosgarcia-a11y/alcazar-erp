import { supabase } from "../lib/supabase"

const DEBUG = import.meta.env.DEV

function debugRecipe(label, payload) {
  if (DEBUG) console.log(`[recipesService] ${label}`, payload)
}

const recipeSelect = `
  *,
  recipe_ingredients(
    *,
    inventory_item:inventory_items(id, name, base_unit, cost_per_base_unit, image_url)
  ),
  pos_recipe_links(*)
`

function normalizeRecipe(recipe) {
  const ingredients = (recipe?.recipe_ingredients || []).map((ingredient) => ({
    ...ingredient,
    item: ingredient.inventory_item,
    cost: Number(ingredient.quantity || 0) * Number(ingredient.inventory_item?.cost_per_base_unit || 0)
  }))
  return recipe ? {
    ...recipe,
    ingredients,
    links: recipe.pos_recipe_links || [],
    estimatedCost: Number(recipe.estimated_cost || 0),
    costPerPortion: Number(recipe.estimated_cost || 0) / Number(recipe.yield_quantity || 1)
  } : recipe
}

function serializeRecipe(recipe) {
  return {
    name: recipe.name,
    recipe_type: recipe.recipeType || recipe.recipe_type || "subrecipe",
    pos_category_id: recipe.posCategoryId || recipe.pos_category_id || "",
    production_area_id: recipe.productionAreaId || recipe.production_area_id || "",
    yield_quantity: Number(recipe.yieldQuantity ?? recipe.yield_quantity ?? 1),
    yield_unit: recipe.yieldUnit || recipe.yield_unit || "",
    image_url: recipe.imageUrl || recipe.image_url || "",
    notes: recipe.notes || "",
    active: recipe.active !== false
  }
}

function serializeIngredients(ingredients) {
  return ingredients.map((ingredient) => ({
    inventory_item_id: ingredient.inventoryItemId || ingredient.inventory_item_id,
    quantity: Number(ingredient.quantity || 0),
    unit: ingredient.unit,
    waste_percentage: Number(ingredient.wastePercentage ?? ingredient.waste_percentage ?? 0),
    notes: ingredient.notes || ""
  }))
}

async function queryRecipes(activeOnly = false) {
  let query = supabase.from("standard_recipes").select(recipeSelect)
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.order("name", { ascending: true })
  return { data: (data || []).map(normalizeRecipe), error }
}

export function getRecipes() {
  return queryRecipes()
}

export function getActiveRecipes() {
  return queryRecipes(true)
}

export async function getRecipeById(id) {
  const { data, error } = await supabase.from("standard_recipes").select(recipeSelect).eq("id", id).single()
  return { data: normalizeRecipe(data), error }
}

export async function createRecipe(recipe, ingredients) {
  const payload = {
    p_recipe_id: null,
    p_recipe: serializeRecipe(recipe),
    p_ingredients: serializeIngredients(ingredients)
  }
  debugRecipe("create standard_recipes/recipe_ingredients request", payload)
  const result = await supabase.rpc("save_standard_recipe", payload)
  debugRecipe("create standard_recipes/recipe_ingredients response", result)
  if (result.error) console.error("Supabase recipe create error:", result.error)
  return result
}

export async function updateRecipe(id, recipe, ingredients) {
  const payload = {
    p_recipe_id: id,
    p_recipe: serializeRecipe(recipe),
    p_ingredients: serializeIngredients(ingredients)
  }
  debugRecipe("update standard_recipes/recipe_ingredients request", payload)
  const result = await supabase.rpc("save_standard_recipe", payload)
  debugRecipe("update standard_recipes/recipe_ingredients response", result)
  if (result.error) console.error("Supabase recipe update error:", result.error)
  return result
}

export function deactivateRecipe(id) {
  return supabase.rpc("deactivate_standard_recipe", { p_recipe_id: id })
}

export async function calculateRecipeCost(recipeId) {
  const { data, error } = await getRecipeById(recipeId)
  if (error) return { data: null, error }
  return {
    data: {
      estimatedCost: data.ingredients.reduce((total, ingredient) => total + ingredient.cost, 0),
      costPerPortion: data.ingredients.reduce((total, ingredient) => total + ingredient.cost, 0) / Number(data.yield_quantity || 1)
    },
    error: null
  }
}

export async function linkRecipeToPOS(posProductId, recipeId) {
  const payload = {
    p_pos_product_id: String(posProductId),
    p_recipe_id: recipeId
  }
  debugRecipe("link POS request", payload)
  const result = await supabase.rpc("link_recipe_to_pos", payload)
  debugRecipe("link POS response", result)
  if (result.error) console.error("Supabase recipe POS link error:", result.error)
  return result
}

export async function getPOSRecipeLink(posProductId) {
  const result = await supabase
    .from("pos_recipe_links")
    .select(`
      *,
      recipe:standard_recipes(
        id,
        name,
        recipe_type,
        production_area_id,
        active
      )
    `)
    .eq("pos_product_id", String(posProductId))
    .maybeSingle()
  debugRecipe("verify POS link response", { posProductId, result })
  if (result.error) console.error("Supabase POS recipe verification error:", result.error)
  return result
}

export async function consumeRecipeInventory(orderItemId, posProductId, quantity) {
  const payload = {
    p_order_item_id: String(orderItemId),
    p_pos_product_id: String(posProductId),
    p_quantity: Number(quantity || 1)
  }
  debugRecipe("inventory consumption request", payload)
  const result = await supabase.rpc("consume_recipe_inventory", payload)
  debugRecipe("inventory consumption response", result)
  if (result.error) console.error("Supabase recipe consumption error:", result.error)
  return result
}
