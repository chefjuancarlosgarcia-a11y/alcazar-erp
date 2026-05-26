import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import { getActiveInventoryItems } from "../services/inventoryService"
import {
  createRecipe,
  deactivateRecipe,
  getRecipes,
  updateRecipe
} from "../services/recipesService"
import { createOrUpdatePOSProductFromRecipe, getPOSProducts } from "../services/posProductsService"
import "./RecipesSupabase.css"

const EMPTY_RECIPE = {
  name: "",
  recipeType: "subrecipe",
  posCategoryId: "",
  productionAreaId: "",
  yieldQuantity: "1",
  yieldUnit: "porción",
  imageUrl: "",
  notes: "",
  active: true,
  ingredients: [],
  posProductId: "",
  availableInPOS: false,
  salePrice: ""
}

const DEBUG = import.meta.env.DEV

function recipeDebug(label, payload) {
  if (DEBUG) console.log(`[Recipes Supabase] ${label}`, payload)
}

function RecipesSupabase() {
  const { user } = useAuth()
  const [recipes, setRecipes] = useState([])
  const [areas, setAreas] = useState([])
  const [inventory, setInventory] = useState([])
  const [posProducts, setPosProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const manager = ["admin", "gerente_general"].includes(user?.role)
  const canCreate = manager || (user?.role === "supervisor" && Boolean(user?.areaId))
  const productionAreas = areas.filter((area) => area.isProductionArea)
  const localRecipesExist = readArray("recetas").length > 0
  const refresh = useCallback(async () => {
    setLoading(true)
    const [recipesResult, areasResult, inventoryResult, posProductsResult] = await Promise.all([
      getRecipes(),
      getActiveAreas(),
      getActiveInventoryItems(),
      getPOSProducts()
    ])
    const loadError = recipesResult.error || areasResult.error || inventoryResult.error || posProductsResult.error
    if (loadError) setError(`No se pudieron cargar recetas: ${loadError.message}`)
    else {
      setRecipes(recipesResult.data)
      setAreas(areasResult.data)
      setInventory(inventoryResult.data)
      setPosProducts(posProductsResult.data)
      setError("")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(refresh, 0)
    return () => window.clearTimeout(timeoutId)
  }, [refresh])

  const filtered = useMemo(() => recipes.filter((recipe) => {
    if (typeFilter && recipe.recipe_type !== typeFilter) return false
    const term = query.trim().toLowerCase()
    return !term || [recipe.name, areaName(areas, recipe.production_area_id)].some((value) => String(value).toLowerCase().includes(term))
  }), [areas, query, recipes, typeFilter])

  function openNew() {
    setForm({
      ...EMPTY_RECIPE,
      productionAreaId: user?.areaId || productionAreas[0]?.id || "",
      ingredients: []
    })
  }

  function openEdit(recipe) {
    const product = posProducts.find((entry) => String(entry.recipeId) === String(recipe.id))
    setForm({
      id: recipe.id,
      name: recipe.name,
      recipeType: recipe.recipe_type,
      posCategoryId: recipe.pos_category_id || "",
      productionAreaId: recipe.production_area_id || "",
      yieldQuantity: String(recipe.yield_quantity || 1),
      yieldUnit: recipe.yield_unit || "",
      imageUrl: recipe.image_url || "",
      notes: recipe.notes || "",
      active: recipe.active,
      posProductId: product?.id || "",
      availableInPOS: Boolean(product),
      salePrice: String(product?.price || ""),
      ingredients: recipe.ingredients.map((ingredient) => ({
        inventoryItemId: ingredient.inventory_item_id,
        quantity: String(ingredient.quantity),
        unit: ingredient.unit,
        wastePercentage: String(ingredient.waste_percentage || 0),
        notes: ingredient.notes || ""
      }))
    })
  }

  async function saveRecipe(recipe) {
    const validation = validateRecipe(recipe, inventory)
    if (validation) {
      setError(validation)
      return
    }
    if (recipe.recipeType === "final_product" && recipe.availableInPOS && Number(recipe.salePrice) <= 0) {
      setError("Indica un precio de venta válido para publicar el producto en POS.")
      return
    }
    setSaving(true)
    setError("")
    recipeDebug("receta enviada", recipe)
    recipeDebug("ingredientes enviados", recipe.ingredients)
    const result = recipe.id
      ? await updateRecipe(recipe.id, recipe, recipe.ingredients)
      : await createRecipe(recipe, recipe.ingredients)
    recipeDebug("resultado guardado Supabase", result)
    if (result.error) {
      console.error("Supabase recipe save error:", result.error)
      setError(result.error.message)
      setSaving(false)
      return
    }
    const recipeId = recipe.id || result.data.id
    if (recipe.recipeType === "final_product" && recipe.availableInPOS) {
      const productResult = await createOrUpdatePOSProductFromRecipe({ ...recipe, id: recipeId }, recipe.posProductId || null)
      recipeDebug("resultado creación/actualización pos_products", productResult)
      if (productResult.error) {
        console.error("Supabase POS product publish error:", productResult.error)
        setError(`La receta se guardó, pero no se pudo publicar en POS: ${productResult.error.message}`)
        setSaving(false)
        await refresh()
        return
      }
      const areaValid = productionAreas.some((area) => area.id === recipe.productionAreaId)
      recipeDebug("verificación inmediata producto POS", { product: productResult.data, areaValid })
      if (!productResult.data?.productionReady || String(productResult.data?.recipeId) !== String(recipeId) || !areaValid) {
        setError("La receta se guardó, pero el producto POS no quedó listo para producción.")
        setSaving(false)
        await refresh()
        return
      }
      window.dispatchEvent(new Event("pos-products-updated"))
    }
    setSaving(false)
    setForm(null)
    setMessage("Receta guardada correctamente en Supabase.")
    await refresh()
  }

  async function disableRecipe(recipe) {
    if (!window.confirm(`¿Desactivar la receta "${recipe.name}"?`)) return
    const result = await deactivateRecipe(recipe.id)
    if (result.error) setError(result.error.message)
    else {
      setMessage("Receta desactivada.")
      await refresh()
    }
  }

  return (
    <section className="recipes-page">
      <header className="recipes-header">
        <div>
          <p className="recipes-eyebrow">Supabase Recipes</p>
          <h1>Recetas estandarizadas</h1>
          <p className="recipes-muted">Ingredientes reales, costos y consumo por comanda POS.</p>
        </div>
        <div className="recipes-actions">
          {canCreate && <button type="button" className="primary" onClick={openNew}>Nueva receta</button>}
          <button type="button" onClick={refresh}>Actualizar</button>
        </div>
      </header>
      {localRecipesExist && <div className="recipes-warning">Existen recetas locales antiguas. Las nuevas recetas oficiales serán Supabase.</div>}
      {message && <div className="recipes-success">{message}</div>}
      {error && <div className="recipes-error">{error}</div>}
      <div className="recipes-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar receta o área" />
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
          <option value="">Todos los tipos</option>
          <option value="subrecipe">Subreceta</option>
          <option value="final_product">Producto final</option>
        </select>
      </div>
      <div className="recipes-grid">
        {loading && <p className="recipes-empty">Cargando recetas...</p>}
        {!loading && filtered.map((recipe) => {
          const posProduct = posProducts.find((product) => String(product.recipeId) === String(recipe.id))
          return (
          <article className="recipe-card" key={recipe.id}>
            {recipe.image_url ? <img src={recipe.image_url} alt="" /> : <span className="recipe-placeholder">{initials(recipe.name)}</span>}
            <div className="recipe-card-body">
              <div className="recipe-title"><h2>{recipe.name}</h2><span className={`recipe-kind ${recipe.recipe_type}`}>{recipe.recipe_type === "final_product" ? "Producto final" : "Subreceta"}</span></div>
              <p>{areaName(areas, recipe.production_area_id)} · {recipe.ingredients.length} ingredientes</p>
              <div className="recipe-metrics">
                <span>Costo total<strong>Q{recipe.estimatedCost.toFixed(2)}</strong></span>
                <span>Por porción<strong>Q{recipe.costPerPortion.toFixed(2)}</strong></span>
              </div>
              {recipe.recipe_type === "final_product" && <small className={posProduct?.productionReady ? "linked" : ""}>{posProduct ? (posProduct.productionReady ? "Producto POS listo" : "Producto POS incompleto") : "Sin producto POS conectado"}</small>}
              <div className="recipe-buttons">
                <button type="button" onClick={() => setDetail(recipe)}>Ver detalle</button>
                {(manager || user?.areaId === recipe.production_area_id) && <button type="button" onClick={() => openEdit(recipe)}>Editar</button>}
                {manager && <button type="button" className="danger" onClick={() => disableRecipe(recipe)}>Desactivar</button>}
              </div>
            </div>
          </article>
          )
        })}
        {!loading && !filtered.length && <p className="recipes-empty">No hay recetas registradas para esta selección.</p>}
      </div>
      {form && <RecipeForm form={form} areas={productionAreas} inventory={inventory} posProducts={posProducts} saving={saving} onClose={() => setForm(null)} onSave={saveRecipe} />}
      {detail && <RecipeDetail recipe={detail} areas={areas} onClose={() => setDetail(null)} />}
    </section>
  )
}

function RecipeForm({ form: initialForm, areas, inventory, posProducts, saving, onClose, onSave }) {
  const [form, setForm] = useState(initialForm)
  const [itemId, setItemId] = useState(inventory[0]?.id || "")
  const item = inventory.find((entry) => entry.id === itemId)
  const cost = form.ingredients.reduce((total, ingredient) => {
    const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
    return total + Number(ingredient.quantity || 0) * Number(catalog?.cost_per_base_unit || 0)
  }, 0)

  function addIngredient() {
    if (!item || form.ingredients.some((ingredient) => ingredient.inventoryItemId === item.id)) return
    setForm({ ...form, ingredients: [...form.ingredients, { inventoryItemId: item.id, quantity: "1", unit: item.base_unit, wastePercentage: "0", notes: "" }] })
  }

  function updateIngredient(id, updates) {
    setForm({ ...form, ingredients: form.ingredients.map((ingredient) => ingredient.inventoryItemId === id ? { ...ingredient, ...updates } : ingredient) })
  }

  return (
    <div className="recipes-backdrop">
      <form className="recipes-modal" onSubmit={(event) => { event.preventDefault(); onSave(form) }}>
        <header><div><p className="recipes-eyebrow">Receta real</p><h2>{form.id ? "Editar receta" : "Nueva receta"}</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
        <div className="recipe-form-grid">
          <Field label="Nombre"><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Tipo"><select value={form.recipeType} onChange={(event) => setForm({ ...form, recipeType: event.target.value })}><option value="subrecipe">Subreceta</option><option value="final_product">Producto final</option></select></Field>
          <Field label="Área de producción"><select value={form.productionAreaId} onChange={(event) => setForm({ ...form, productionAreaId: event.target.value })}><option value="">Selecciona área</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
          <Field label="Categoría POS"><input value={form.posCategoryId} onChange={(event) => setForm({ ...form, posCategoryId: event.target.value })} placeholder="pizzas, barra..." /></Field>
          <Field label="Rendimiento"><input type="number" min="0.001" step="any" value={form.yieldQuantity} onChange={(event) => setForm({ ...form, yieldQuantity: event.target.value })} /></Field>
          <Field label="Unidad rendimiento"><input value={form.yieldUnit} onChange={(event) => setForm({ ...form, yieldUnit: event.target.value })} /></Field>
          <Field label="URL de imagen"><input value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://..." /></Field>
          {form.recipeType === "final_product" && <Field label="Producto POS existente"><select disabled={!form.availableInPOS} value={form.posProductId} onChange={(event) => setForm({ ...form, posProductId: event.target.value })}><option value="">Crear producto nuevo</option>{posProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>}
          {form.recipeType === "final_product" && <Field label="Disponible en POS"><label className="recipe-checkbox"><input type="checkbox" checked={form.availableInPOS} onChange={(event) => setForm({ ...form, availableInPOS: event.target.checked })} />Crear o actualizar producto vendible</label></Field>}
          {form.recipeType === "final_product" && form.availableInPOS && <Field label="Precio de venta"><input type="number" min="0.01" step="0.01" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} /></Field>}
        </div>
        <Field label="Notas"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        <div className="recipe-picker">
          <select value={itemId} onChange={(event) => setItemId(event.target.value)}>{inventory.map((inventoryItem) => <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} ({inventoryItem.base_unit})</option>)}</select>
          <span>Costo base: <strong>Q{Number(item?.cost_per_base_unit || 0).toFixed(4)}</strong></span>
          <button type="button" className="primary" onClick={addIngredient}>Agregar ingrediente</button>
        </div>
        <div className="recipe-ingredients">
          <div className="recipe-ingredients-head"><span>Ingrediente</span><span>Cantidad / unidad</span><span>Merma %</span><span>Subtotal</span><span /></div>
          {form.ingredients.map((ingredient) => {
            const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
            const subtotal = Number(ingredient.quantity || 0) * Number(catalog?.cost_per_base_unit || 0)
            return <div className="recipe-ingredient-row" key={ingredient.inventoryItemId}>
              <strong>{catalog?.name || "Ingrediente"}</strong>
              <span><input type="number" min="0.001" step="any" value={ingredient.quantity} onChange={(event) => updateIngredient(ingredient.inventoryItemId, { quantity: event.target.value })} /> {ingredient.unit}</span>
              <input type="number" min="0" max="100" step="any" value={ingredient.wastePercentage} onChange={(event) => updateIngredient(ingredient.inventoryItemId, { wastePercentage: event.target.value })} />
              <strong>Q{subtotal.toFixed(2)}</strong>
              <button type="button" className="danger" onClick={() => setForm({ ...form, ingredients: form.ingredients.filter((line) => line.inventoryItemId !== ingredient.inventoryItemId) })}>Quitar</button>
            </div>
          })}
          {!form.ingredients.length && <p className="recipes-empty">Agrega ingredientes del inventario real.</p>}
        </div>
        <div className="recipe-total"><span>Costo estimado total</span><strong>Q{cost.toFixed(2)}</strong><small>Q{(cost / Number(form.yieldQuantity || 1)).toFixed(2)} por porción</small></div>
        <div className="recipes-modal-actions"><button type="button" onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={saving}>Guardar receta</button></div>
      </form>
    </div>
  )
}

function RecipeDetail({ recipe, areas, onClose }) {
  return <div className="recipes-backdrop"><section className="recipes-modal compact">
    <header><div><p className="recipes-eyebrow">Ficha técnica</p><h2>{recipe.name}</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="recipes-muted">{areaName(areas, recipe.production_area_id)} · Rendimiento {recipe.yield_quantity} {recipe.yield_unit || ""}</p>
    <div className="recipe-detail-items">{recipe.ingredients.map((ingredient) => <div key={ingredient.id}><strong>{ingredient.ingredient_name}</strong><span>{ingredient.quantity} {ingredient.unit} lote · {(Number(ingredient.quantity) / Number(recipe.yield_quantity || 1)).toFixed(4)} / porción</span><span>Merma: {ingredient.waste_percentage}%</span><span>Q{ingredient.cost.toFixed(2)}</span></div>)}</div>
    <div className="recipe-total"><span>Costo total</span><strong>Q{recipe.estimatedCost.toFixed(2)}</strong><small>Q{recipe.costPerPortion.toFixed(2)} por porción</small></div>
  </section></div>
}

function Field({ label, children }) {
  return <label className="recipe-field"><span>{label}</span>{children}</label>
}

function validateRecipe(recipe, inventory) {
  if (!recipe.name.trim()) return "El nombre de la receta es obligatorio."
  if (!recipe.productionAreaId) return "Selecciona un área de producción."
  if (Number(recipe.yieldQuantity) <= 0) return "El rendimiento debe ser mayor que cero."
  if (!recipe.ingredients.length) return "Agrega al menos un ingrediente."
  for (const ingredient of recipe.ingredients) {
    const item = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
    if (!item || item.base_unit !== ingredient.unit) return "Los ingredientes deben usar la unidad base del inventario."
    if (Number(ingredient.quantity) <= 0) return "La cantidad de cada ingrediente debe ser mayor que cero."
  }
  return ""
}

function areaName(areas, areaId) {
  return areas.find((area) => area.id === areaId)?.name || areaId || "Sin área"
}

function initials(name) {
  return String(name || "R").split(" ").slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase()
}

function readArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export default RecipesSupabase
