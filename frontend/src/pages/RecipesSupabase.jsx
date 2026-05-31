import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import * as XLSX from "xlsx"
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
  preparationSteps: [],
  notes: "",
  active: true,
  ingredients: [],
  posProductId: "",
  availableInPOS: false,
  salePrice: ""
}

const RECIPE_UNITS = [
  "Gramos",
  "Kilogramos",
  "Libras",
  "Onzas",
  "Mililitros",
  "Litros",
  "Piezas",
  "Unidades"
]

const DEBUG = import.meta.env.DEV

function recipeDebug(label, payload) {
  if (DEBUG) console.log(`[Recipes Supabase] ${label}`, payload)
}

function RecipesSupabase() {
  const { user } = useAuth()
  const recipeImportInputRef = useRef(null)
  const [recipes, setRecipes] = useState([])
  const [areas, setAreas] = useState([])
  const [inventory, setInventory] = useState([])
  const [posProducts, setPosProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [form, setForm] = useState(null)
  const [detail, setDetail] = useState(null)
  const [importDraft, setImportDraft] = useState(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFileName, setImportFileName] = useState("")
  const [importReadError, setImportReadError] = useState("")
  const [importReading, setImportReading] = useState(false)
  const [importProgress, setImportProgress] = useState("")

  const manager = ["admin", "ceo", "gerente_general", "gerente"].includes(user?.role)
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
      ingredients: [],
      preparationSteps: []
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
      preparationSteps: normalizePreparationSteps(recipe.preparationSteps || recipe.preparation_steps || []),
      notes: recipe.notes || "",
      active: recipe.active,
      posProductId: product?.id || "",
      availableInPOS: Boolean(product),
      salePrice: String(product?.price || ""),
      ingredients: recipe.ingredients.map((ingredient) => ({
        inventoryItemId: ingredient.inventory_item_id,
        recipeQuantity: String(ingredient.recipe_quantity ?? ingredient.quantity),
        recipeUnit: ingredient.recipe_unit || ingredient.unit,
        inventoryQuantity: String(ingredient.inventory_quantity ?? ingredient.quantity),
        inventoryUnit: ingredient.inventory_unit || ingredient.unit,
        conversionFactor: Number(ingredient.conversion_factor || 1),
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

  async function handleRecipeImportFile(file) {
    if (!file) return
    setImportFileName(file.name)
    setImportReadError("")
    setImportDraft(null)
    setImportReading(true)
    setImportProgress("Leyendo archivo...")
    const extension = file.name.toLowerCase().split(".").pop()
    if (!["xlsx", "xls", "csv"].includes(extension)) {
      const message = "Sube un archivo .xlsx, .xls o .csv."
      setImportReadError(message)
      setError(message)
      setImportReading(false)
      setImportProgress("")
      return
    }
    try {
      const workbook = await withTimeout(readExcelRows(file), 45000, "El archivo tardo demasiado en leerse. Revisa que no este danado o divide el archivo en lotes.")
      const draft = await buildRecipeImportDraft({
        workbook,
        inventory,
        recipes,
        productionAreaId: user?.areaId || productionAreas[0]?.id || "",
        onProgress: setImportProgress,
        defaultYieldUnit: "porción"
      })
      setImportDraft({ ...draft, fileName: file.name, duplicateMode: "skip", importErrors: [], importedCount: 0, skippedCount: 0 })
      if (!draft.recipes.length) {
        setImportReadError("No se encontraron recetas válidas en el archivo.")
      }
      setError("")
    } catch (caught) {
      const message = caught?.message || "No se pudo leer el archivo."
      setImportReadError(message)
      setError(message)
    } finally {
      setImportReading(false)
      setImportProgress("")
      if (recipeImportInputRef.current) recipeImportInputRef.current.value = ""
    }
  }

  function updateImportIngredient(recipeIndex, ingredientIndex, inventoryItemId) {
    setImportDraft((current) => {
      if (!current) return current
      const nextRecipes = current.recipes.map((recipe, rIndex) => {
        if (rIndex !== recipeIndex) return recipe
        return {
          ...recipe,
          ingredients: recipe.ingredients.map((ingredient, iIndex) => {
            if (iIndex !== ingredientIndex) return ingredient
            const catalog = inventory.find((entry) => entry.id === inventoryItemId)
            const normalized = normalizeRecipeIngredient({
              ...ingredient,
              inventoryItemId,
              matched: Boolean(catalog),
              matchName: catalog?.name || ""
            }, catalog)
            return { ...normalized, rawName: ingredient.rawName }
          })
        }
      })
      return { ...current, recipes: nextRecipes }
    })
  }

  async function importRecipesFromDraft() {
    if (!importDraft || !getImportableRecipes(importDraft).length) return
    setImporting(true)
    const importErrors = []
    let importedCount = 0
    let skippedCount = 0
    for (const recipe of importDraft.recipes) {
      if (recipe.duplicateRecipeId && importDraft.duplicateMode === "skip") {
        skippedCount += 1
        continue
      }
      const payload = {
        id: recipe.duplicateRecipeId || undefined,
        name: recipe.name,
        recipeType: recipe.recipeType,
        posCategoryId: recipe.category,
        productionAreaId: recipe.productionAreaId,
        yieldQuantity: recipe.yieldQuantity,
        yieldUnit: recipe.yieldUnit,
        imageUrl: "",
        preparationSteps: recipe.preparationSteps,
        notes: "Importada desde Excel",
        active: true,
        ingredients: recipe.ingredients.map((ingredient) => {
          const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
          return normalizeRecipeIngredient({ ...ingredient, wastePercentage: ingredient.wastePercentage || "0" }, catalog)
        })
      }
      const validation = validateRecipe(payload, inventory)
      if (validation) {
        importErrors.push({ recipe: recipe.name, message: validation })
        continue
      }
      const result = recipe.duplicateRecipeId
        ? await updateRecipe(recipe.duplicateRecipeId, payload, payload.ingredients)
        : await createRecipe(payload, payload.ingredients)
      if (result.error) importErrors.push({ recipe: recipe.name, message: result.error.message })
      else importedCount += 1
    }
    localStorage.setItem("recipeImportErrors", JSON.stringify(importErrors))
    setImportDraft((current) => current ? { ...current, importErrors, importedCount, skippedCount } : current)
    setImporting(false)
    setMessage(`Importación finalizada: ${importedCount} receta(s) importadas, ${skippedCount} omitida(s), ${importErrors.length} error(es).`)
    await refresh()
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
          {canCreate && (
            <>
              <input
                ref={recipeImportInputRef}
                className="recipe-import-input"
                type="file"
                accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={(event) => handleRecipeImportFile(event.target.files?.[0])}
              />
              <button type="button" className="recipe-import-button" disabled={importReading} onClick={() => recipeImportInputRef.current?.click()}>
                {importReading ? "Procesando..." : "Importar Excel"}
              </button>
            </>
          )}
          {canCreate && <button type="button" className="primary" onClick={openNew}>Nueva receta</button>}
          <button type="button" onClick={refresh}>Actualizar</button>
        </div>
      </header>
      {(importFileName || importReadError) && (
        <div className={importReadError ? "recipes-error" : "recipes-success"}>
          {importFileName && <span>Archivo seleccionado: <strong>{importFileName}</strong></span>}
          {importReadError && <span>{importFileName ? " · " : ""}{importReadError}</span>}
        </div>
      )}
      {localRecipesExist && <div className="recipes-warning">Existen recetas locales antiguas. Las nuevas recetas oficiales serán Supabase.</div>}
      {importReading && (
        <div className="recipes-warning recipe-import-loading">
          <span>{importProgress || "Procesando archivo..."}</span>
        </div>
      )}
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
      {importDraft && <RecipeImportModal draft={importDraft} inventory={inventory} importing={importing} setDraft={setImportDraft} onIngredientChange={updateImportIngredient} onImport={importRecipesFromDraft} onClose={() => setImportDraft(null)} />}
      {form && <RecipeForm form={form} areas={productionAreas} inventory={inventory} posProducts={posProducts} saving={saving} onClose={() => setForm(null)} onSave={saveRecipe} />}
      {detail && <RecipeDetailV2 recipe={detail} areas={areas} onClose={() => setDetail(null)} />}
    </section>
  )
}

function RecipeForm({ form: initialForm, areas, inventory, posProducts, saving, onClose, onSave }) {
  const [form, setForm] = useState(initialForm)
  const [itemId, setItemId] = useState(inventory[0]?.id || "")
  const item = inventory.find((entry) => entry.id === itemId)
  const cost = form.ingredients.reduce((total, ingredient) => {
    const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
    return total + Number(ingredient.inventoryQuantity || 0) * Number(catalog?.cost_per_base_unit || 0)
  }, 0)

  function addIngredient() {
    if (!item || form.ingredients.some((ingredient) => ingredient.inventoryItemId === item.id)) return
    setForm({
      ...form,
      ingredients: [
        ...form.ingredients,
        normalizeRecipeIngredient({ inventoryItemId: item.id, recipeQuantity: "1", recipeUnit: item.base_unit, wastePercentage: "0", notes: "" }, item)
      ]
    })
  }

  function updateIngredient(id, updates) {
    setForm({
      ...form,
      ingredients: form.ingredients.map((ingredient) => {
        if (ingredient.inventoryItemId !== id) return ingredient
        const catalog = inventory.find((entry) => entry.id === id)
        return normalizeRecipeIngredient({ ...ingredient, ...updates }, catalog)
      })
    })
  }

  function handleImageUpload(event) {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      alert("Debes subir un archivo de imagen.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => setForm((current) => ({ ...current, imageUrl: reader.result || "" }))
    reader.readAsDataURL(file)
  }

  function addStep() {
    setForm({
      ...form,
      preparationSteps: [...normalizePreparationSteps(form.preparationSteps), { id: Date.now(), text: "" }]
    })
  }

  function updateStep(index, text) {
    setForm({
      ...form,
      preparationSteps: normalizePreparationSteps(form.preparationSteps).map((step, stepIndex) => (
        stepIndex === index ? { ...step, text } : step
      ))
    })
  }

  function removeStep(index) {
    setForm({
      ...form,
      preparationSteps: normalizePreparationSteps(form.preparationSteps).filter((_, stepIndex) => stepIndex !== index)
    })
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
          <Field label="Imagen de receta">
            <div className="recipe-image-upload">
              {form.imageUrl ? <img src={form.imageUrl} alt="" /> : <span>Sin imagen</span>}
              <div>
                <label className="recipe-upload-button">
                  Upload Image
                  <input type="file" accept="image/*" onChange={handleImageUpload} />
                </label>
                {form.imageUrl && <button type="button" className="danger" onClick={() => setForm({ ...form, imageUrl: "" })}>Quitar imagen</button>}
              </div>
            </div>
          </Field>
          {form.recipeType === "final_product" && <Field label="Producto POS existente"><select disabled={!form.availableInPOS} value={form.posProductId} onChange={(event) => setForm({ ...form, posProductId: event.target.value })}><option value="">Crear producto nuevo</option>{posProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field>}
          {form.recipeType === "final_product" && <Field label="Disponible en POS"><label className="recipe-checkbox"><input type="checkbox" checked={form.availableInPOS} onChange={(event) => setForm({ ...form, availableInPOS: event.target.checked })} />Crear o actualizar producto vendible</label></Field>}
          {form.recipeType === "final_product" && form.availableInPOS && <Field label="Precio de venta"><input type="number" min="0.01" step="0.01" value={form.salePrice} onChange={(event) => setForm({ ...form, salePrice: event.target.value })} /></Field>}
        </div>
        <Field label="Notas"><textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>
        <section className="recipe-steps-section">
          <div className="recipe-section-heading">
            <div>
              <h3>Proceso de preparación</h3>
              <p>Documenta los pasos en orden para mantener la receta estandarizada.</p>
            </div>
            <button type="button" className="primary" onClick={addStep}>Agregar paso</button>
          </div>
          <div className="recipe-steps-list">
            {normalizePreparationSteps(form.preparationSteps).map((step, index) => (
              <div className="recipe-step-row" key={step.id || index}>
                <span>Paso {index + 1}</span>
                <textarea value={step.text} onChange={(event) => updateStep(index, event.target.value)} placeholder="Describe este paso de la receta" />
                <button type="button" className="danger" onClick={() => removeStep(index)}>Eliminar</button>
              </div>
            ))}
            {!normalizePreparationSteps(form.preparationSteps).length && <p className="recipes-empty">Agrega los pasos de preparación de esta receta.</p>}
          </div>
        </section>
        <div className="recipe-picker">
          <select value={itemId} onChange={(event) => setItemId(event.target.value)}>{inventory.map((inventoryItem) => <option key={inventoryItem.id} value={inventoryItem.id}>{inventoryItem.name} ({inventoryItem.base_unit})</option>)}</select>
          <span>Costo base: <strong>Q{Number(item?.cost_per_base_unit || 0).toFixed(4)}</strong></span>
          <button type="button" className="primary" onClick={addIngredient}>Agregar ingrediente</button>
        </div>
        <div className="recipe-ingredients">
          <div className="recipe-ingredients-head"><span>Ingrediente</span><span>Cantidad receta</span><span>Equivalente inventario</span><span>Merma %</span><span>Subtotal</span><span /></div>
          {form.ingredients.map((ingredient) => {
            const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
            const normalized = normalizeRecipeIngredient(ingredient, catalog)
            const subtotal = Number(normalized.inventoryQuantity || 0) * Number(catalog?.cost_per_base_unit || 0)
            return <div className="recipe-ingredient-row" key={ingredient.inventoryItemId}>
              <strong>{catalog?.name || "Ingrediente"}</strong>
              <span className="recipe-quantity-control">
                <input type="number" min="0.001" step="any" value={normalized.recipeQuantity} onChange={(event) => updateIngredient(ingredient.inventoryItemId, { recipeQuantity: event.target.value })} />
                <select value={normalized.recipeUnit} onChange={(event) => updateIngredient(ingredient.inventoryItemId, { recipeUnit: event.target.value })}>
                  {unitOptionsFor(catalog).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </span>
              <span className={normalized.conversionError ? "recipe-conversion-error" : "recipe-conversion-ok"}>
                {normalized.conversionError || `${formatRecipeNumber(normalized.inventoryQuantity)} ${normalized.inventoryUnit || catalog?.base_unit || ""}`}
              </span>
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

function RecipeImportModal({ draft, inventory, importing, setDraft, onIngredientChange, onImport, onClose }) {
  const unresolved = draft.recipes.reduce((total, recipe) => total + recipe.ingredients.filter((ingredient) => !ingredient.inventoryItemId).length, 0)
  const duplicates = draft.recipes.filter((recipe) => recipe.duplicateRecipeId).length
  const errors = draft.recipes.flatMap((recipe) => recipe.errors.map((message) => ({ recipe: recipe.name, message })))
  const parseErrors = draft.parseErrors || []
  const importableCount = getImportableRecipes(draft).length
  return (
    <div className="recipes-backdrop">
      <section className="recipes-modal recipe-import-modal">
        <header>
          <div>
            <p className="recipes-eyebrow">Importación masiva</p>
            <h2>Validar recetas desde Excel</h2>
            {draft.fileName && <p className="recipes-muted">Archivo: <strong>{draft.fileName}</strong></p>}
            <p className="recipes-muted">{draft.recipes.length} receta(s), {draft.detectedIngredients || 0} ingrediente(s), {unresolved} sin coincidencia, {duplicates} duplicado(s).</p>
            <p className="recipes-muted">Formato detectado: {draft.sourceFormat === "block" ? "bloques por receta" : "tabla plana"}.</p>
          </div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>

        <div className="recipe-import-options">
          <label>Si la receta ya existe
            <select value={draft.duplicateMode} onChange={(event) => setDraft({ ...draft, duplicateMode: event.target.value })}>
              <option value="skip">Omitir existente</option>
              <option value="update">Actualizar existente</option>
            </select>
          </label>
          <div className={importableCount ? "recipe-import-status ok" : "recipe-import-status danger"}>
            {importableCount ? `${importableCount} receta(s) lista(s) para importar.` : "Aún no hay recetas listas para importar."}
          </div>
        </div>

        {errors.length > 0 && (
          <div className="recipe-import-errors">
            <strong>Errores detectados</strong>
            {errors.map((error, index) => <p key={`${error.recipe}-${index}`}>{error.recipe}: {error.message}</p>)}
          </div>
        )}

        {parseErrors.length > 0 && (
          <div className="recipe-import-errors">
            <strong>Filas ignoradas o advertencias</strong>
            {parseErrors.slice(0, 40).map((message, index) => <p key={`${message}-${index}`}>{message}</p>)}
            {parseErrors.length > 40 && <p>+{parseErrors.length - 40} advertencia(s) adicional(es).</p>}
          </div>
        )}

        <div className="recipe-import-list">
          {draft.recipes.map((recipe, recipeIndex) => (
            <article className="recipe-import-card" key={recipe.id}>
              <div className="recipe-import-card-head">
                <div>
                  <h3>{recipe.name}</h3>
                  <p>{recipe.ingredients.length} ingrediente(s) · Rendimiento {recipe.yieldQuantity} {recipe.yieldUnit}</p>
                </div>
                {recipe.duplicateRecipeId && <span className="recipe-import-badge">Ya existe</span>}
              </div>
              <div className="recipe-import-table">
                <div className="recipe-import-table-head"><span>Ingrediente Excel</span><span>Coincidencia inventario</span><span>Cantidad</span><span>Estado</span></div>
                {recipe.ingredients.map((ingredient, ingredientIndex) => {
                  const catalog = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
                  const normalized = normalizeRecipeIngredient(ingredient, catalog)
                  return (
                    <div className="recipe-import-row" key={`${ingredient.rawName}-${ingredientIndex}`}>
                      <strong>{ingredient.rawName}</strong>
                      <select value={ingredient.inventoryItemId || ""} onChange={(event) => onIngredientChange(recipeIndex, ingredientIndex, event.target.value)}>
                        <option value="">Seleccionar producto</option>
                        {inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.base_unit})</option>)}
                      </select>
                      <span>{ingredient.recipeQuantity} {ingredient.recipeUnit}</span>
                      <span className={!ingredient.inventoryItemId || normalized.conversionError ? "recipe-conversion-error" : "recipe-conversion-ok"}>
                        {!ingredient.inventoryItemId ? "No encontrado" : normalized.conversionError || `${formatRecipeNumber(normalized.inventoryQuantity)} ${normalized.inventoryUnit}`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </article>
          ))}
        </div>

        {draft.importErrors.length > 0 && (
          <div className="recipe-import-errors">
            <strong>Registro de errores de importación</strong>
            {draft.importErrors.map((error, index) => <p key={`${error.recipe}-${index}`}>{error.recipe}: {error.message}</p>)}
          </div>
        )}

        <div className="recipes-modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="button" className="primary" disabled={importing || !importableCount} onClick={onImport}>
            {importing ? "Importando..." : "Importar recetas validadas"}
          </button>
        </div>
      </section>
    </div>
  )
}

function RecipeDetailV2({ recipe, areas, onClose }) {
  const steps = normalizePreparationSteps(recipe.preparationSteps || recipe.preparation_steps)
  return <div className="recipes-backdrop"><section className="recipes-modal compact">
    <header><div><p className="recipes-eyebrow">Ficha tecnica</p><h2>{recipe.name}</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="recipes-muted">{areaName(areas, recipe.production_area_id)} - Rendimiento {recipe.yield_quantity} {recipe.yield_unit || ""}</p>
    {recipe.image_url && <img className="recipe-detail-image" src={recipe.image_url} alt="" />}
    <div className="recipe-detail-items">{recipe.ingredients.map((ingredient) => {
      const recipeQuantity = ingredient.recipe_quantity ?? ingredient.quantity
      const recipeUnit = ingredient.recipe_unit ?? ingredient.unit
      const inventoryQuantity = ingredient.inventory_quantity ?? ingredient.quantity
      const inventoryUnit = ingredient.inventory_unit ?? ingredient.unit
      return <div key={ingredient.id}>
        <strong>{ingredient.ingredient_name}</strong>
        <span>{recipeQuantity} {recipeUnit} receta</span>
        <span>Equivale a {formatRecipeNumber(inventoryQuantity)} {inventoryUnit}</span>
        <span>Merma: {ingredient.waste_percentage}%</span>
        <span>Q{ingredient.cost.toFixed(2)}</span>
      </div>
    })}</div>
    <section className="recipe-detail-steps">
      <h3>Proceso de preparacion</h3>
      {steps.length ? <ol>{steps.map((step, index) => <li key={step.id || index}>{step.text}</li>)}</ol> : <p className="recipes-muted">Sin pasos registrados.</p>}
    </section>
    <div className="recipe-total"><span>Costo total</span><strong>Q{recipe.estimatedCost.toFixed(2)}</strong><small>Q{recipe.costPerPortion.toFixed(2)} por porcion</small></div>
  </section></div>
}

function validateRecipe(recipe, inventory) {
  if (!recipe.name.trim()) return "El nombre de la receta es obligatorio."
  if (!recipe.productionAreaId) return "Selecciona un área de producción."
  if (Number(recipe.yieldQuantity) <= 0) return "El rendimiento debe ser mayor que cero."
  if (!recipe.ingredients.length) return "Agrega al menos un ingrediente."
  for (const ingredient of recipe.ingredients) {
    const item = inventory.find((entry) => entry.id === ingredient.inventoryItemId)
    const normalized = normalizeRecipeIngredient(ingredient, item)
    if (!item) return "La receta contiene un ingrediente inactivo o inexistente."
    if (Number(normalized.recipeQuantity) <= 0) return "La cantidad de cada ingrediente debe ser mayor que cero."
    if (normalized.conversionError) return normalized.conversionError
  }
  const emptyStep = normalizePreparationSteps(recipe.preparationSteps).some((step) => !step.text.trim())
  if (emptyStep) return "Completa o elimina los pasos de preparación vacíos."
  return ""
}

function getImportableRecipes(draft) {
  if (!draft?.recipes?.length) return []
  return draft.recipes.filter((recipe) => isImportableRecipe(recipe, draft.inventory || []))
}

function isImportableRecipe(recipe, inventory) {
  if (!recipe.name?.trim() || !recipe.productionAreaId || Number(recipe.yieldQuantity) <= 0 || !recipe.ingredients.length) return false
  return recipe.ingredients.every((ingredient) => {
    const catalog = inventory.find((item) => item.id === ingredient.inventoryItemId)
    if (!catalog) return false
    const normalized = normalizeRecipeIngredient(ingredient, catalog)
    return Number(normalized.recipeQuantity) > 0 && !normalized.conversionError
  })
}

function withTimeout(promise, milliseconds, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), milliseconds)
    })
  ])
}

function readExcelRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const extension = file.name.toLowerCase().split(".").pop()
    reader.onload = (event) => {
      try {
        const workbook = XLSX.read(event.target.result, { type: extension === "csv" ? "string" : "array" })
        const sheets = workbook.SheetNames.map((sheetName) => ({
          name: sheetName,
          rows: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" }).map((row) => ({ ...row, __sheet: sheetName })),
          matrix: XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", blankrows: false })
        }))
        const rowCount = sheets.reduce((total, sheet) => total + sheet.rows.length + sheet.matrix.length, 0)
        if (!rowCount) reject(new Error("El archivo no contiene filas para importar."))
        else resolve({ sheets })
      } catch (caught) {
        reject(caught)
      }
    }
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."))
    if (extension === "csv") reader.readAsText(file, "utf-8")
    else reader.readAsArrayBuffer(file)
  })
}

async function buildRecipeImportDraft({ workbook, inventory, recipes, productionAreaId, defaultYieldUnit, onProgress = () => {} }) {
  const blockDraft = await buildBlockRecipeImportDraft({ workbook, inventory, recipes, productionAreaId, defaultYieldUnit, onProgress })
  if (blockDraft.recipes.length) return blockDraft
  const rows = workbook.sheets.flatMap((sheet) => sheet.rows)
  return buildFlatRecipeImportDraft({ rows, inventory, recipes, productionAreaId, defaultYieldUnit })
}

async function buildBlockRecipeImportDraft({ workbook, inventory, recipes, productionAreaId, defaultYieldUnit, onProgress }) {
  const existingByName = new Map(recipes.map((recipe) => [normalizeText(recipe.name), recipe]))
  const recipeMarkers = workbook.sheets.flatMap((sheet) => sheet.matrix.filter(isRecipeMarkerRow))
  const importErrors = []
  const parsed = []
  let current = null
  let recipeCounter = 0
  let processedRows = 0
  const maxRows = 15000

  for (const sheet of workbook.sheets) {
    for (let index = 0; index < sheet.matrix.length; index += 1) {
      processedRows += 1
      if (processedRows > maxRows) {
        importErrors.push(`Se detuvo el analisis al llegar a ${maxRows} filas. Divide el archivo en lotes mas pequenos.`)
        break
      }
      const row = sheet.matrix[index] || []
      if (isEmptyMatrixRow(row) || isImportHeaderRow(row)) continue
      if (isRecipeMarkerRow(row)) {
        recipeCounter += 1
        const name = cellText(row[1])
        const recipeKey = normalizeText(name)
        current = {
          id: `${recipeKey}-${sheet.name}-${index}`,
          name,
          category: "importadas",
          recipeType: "subrecipe",
          productionAreaId,
          yieldQuantity: "1",
          yieldUnit: defaultYieldUnit,
          preparationSteps: [],
          duplicateRecipeId: existingByName.get(recipeKey)?.id || "",
          ingredients: [],
          errors: []
        }
        if (!productionAreaId) current.errors.push("Selecciona un area de produccion antes de importar.")
        parsed.push(current)
        onProgress(`Procesando receta ${recipeCounter} de ${recipeMarkers.length || "?"}`)
        await yieldToBrowser()
        continue
      }
      if (!current) {
        if (!isEmptyMatrixRow(row)) importErrors.push(`${sheet.name} fila ${index + 1}: fila ignorada porque aparece antes de una receta.`)
        continue
      }
      if (isTotalProductionRow(row)) {
        const yieldQuantity = parseNumberCell(row[9])
        const yieldUnit = normalizeRecipeUnit(row[10] || defaultYieldUnit)
        if (yieldQuantity > 0) current.yieldQuantity = String(yieldQuantity)
        if (yieldUnit) current.yieldUnit = yieldUnit
        current.totalProductionCost = parseNumberCell(row[11])
        continue
      }
      const ingredient = buildBlockIngredient(row, inventory, sheet.name, index)
      if (ingredient.error) {
        current.errors.push(ingredient.error)
        continue
      }
      if (ingredient.value) current.ingredients.push(ingredient.value)
      if (processedRows % 150 === 0) await yieldToBrowser()
    }
  }

  parsed.forEach((recipe) => {
    if (!recipe.ingredients.length) recipe.errors.push("No se detectaron ingredientes para esta receta.")
  })
  return {
    recipes: parsed,
    inventory,
    sourceFormat: "block",
    parseErrors: importErrors,
    detectedIngredients: parsed.reduce((total, recipe) => total + recipe.ingredients.length, 0)
  }
}

function buildBlockIngredient(row, inventory, sheetName, index) {
  const ingredientName = cellText(row[2])
  if (!ingredientName) return { value: null }
  const recipeQuantity = parseNumberCell(row[9])
  const recipeUnit = normalizeRecipeUnit(row[10])
  const inventoryQuantity = parseNumberCell(row[6])
  const inventoryUnit = normalizeRecipeUnit(row[7])
  const quantity = recipeQuantity || inventoryQuantity
  const unit = recipeQuantity ? recipeUnit : inventoryUnit
  if (!quantity) return { error: `${sheetName} fila ${index + 1}: cantidad invalida para ${ingredientName}.` }
  const match = findInventoryMatch(ingredientName, inventory)
  const catalog = match ? inventory.find((item) => item.id === match.id) : null
  const normalized = normalizeRecipeIngredient({
    rawName: ingredientName,
    inventoryItemId: match?.id || "",
    matched: Boolean(match),
    matchName: match?.name || "",
    recipeQuantity: String(quantity),
    recipeUnit: unit || "Unidades",
    wastePercentage: "0",
    supplier: cellText(row[1]),
    purchaseQuantity: cellText(row[3]),
    purchasePresentation: cellText(row[4]),
    purchaseCost: cellText(row[5]),
    inventoryBaseQuantity: inventoryQuantity ? String(inventoryQuantity) : "",
    inventoryBaseUnit: inventoryUnit || "",
    unitCost: cellText(row[8]),
    productionCost: cellText(row[11]),
    notes: [cellText(row[12]), `Importado desde Excel: ${ingredientName}`].filter(Boolean).join(" | ")
  }, catalog)
  return { value: normalized }
}

function buildFlatRecipeImportDraft({ rows, inventory, recipes, productionAreaId, defaultYieldUnit }) {
  const grouped = new Map()
  const existingByName = new Map(recipes.map((recipe) => [normalizeText(recipe.name), recipe]))
  let lastRecipeName = ""
  rows.forEach((row, index) => {
    const explicitRecipeName = valueFromRow(row, ["nombre receta", "receta", "recipe", "nombre"]).trim()
    const recipeName = explicitRecipeName || lastRecipeName
    const ingredientName = valueFromRow(row, ["ingrediente", "producto", "item", "insumo"]).trim()
    const quantity = valueFromRow(row, ["cantidad", "qty", "cantidad ingrediente", "cantidad usada"])
    const unit = normalizeRecipeUnit(valueFromRow(row, ["unidad", "unidad receta", "unit"]))
    const yieldQuantity = valueFromRow(row, ["rendimiento", "yield", "porciones"]) || "1"
    const yieldUnit = valueFromRow(row, ["unidad rendimiento", "yield unit"]) || defaultYieldUnit
    const category = valueFromRow(row, ["categoria", "categoría", "category"]) || "importadas"
    const type = valueFromRow(row, ["tipo", "type"])
    const step = valueFromRow(row, ["paso", "proceso", "preparacion", "preparación"])
    const errors = []
    if (!recipeName) errors.push(`Fila ${index + 2}: falta nombre de receta.`)
    if (!ingredientName) errors.push(`Fila ${index + 2}: falta ingrediente.`)
    if (!Number(quantity)) errors.push(`Fila ${index + 2}: cantidad inválida.`)
    if (!recipeName) return
    lastRecipeName = recipeName
    const recipeKey = normalizeText(recipeName)
    const existing = grouped.get(recipeKey) || {
      id: `${recipeKey}-${index}`,
      name: recipeName,
      category,
      recipeType: normalizeText(type).includes("final") ? "final_product" : "subrecipe",
      productionAreaId,
      yieldQuantity: String(yieldQuantity || 1),
      yieldUnit,
      preparationSteps: [],
      duplicateRecipeId: existingByName.get(recipeKey)?.id || "",
      ingredients: [],
      errors: []
    }
    existing.errors.push(...errors)
    if (step && !existing.preparationSteps.some((candidate) => candidate.text === step)) {
      existing.preparationSteps.push({ id: existing.preparationSteps.length + 1, text: step })
    }
    if (ingredientName) {
      const match = findInventoryMatch(ingredientName, inventory)
      const catalog = match ? inventory.find((item) => item.id === match.id) : null
      existing.ingredients.push(normalizeRecipeIngredient({
        rawName: ingredientName,
        inventoryItemId: match?.id || "",
        matched: Boolean(match),
        matchName: match?.name || "",
        recipeQuantity: String(quantity || 0),
        recipeUnit: unit,
        wastePercentage: "0",
        notes: `Importado desde Excel: ${ingredientName}`
      }, catalog))
    }
    grouped.set(recipeKey, existing)
  })
  return {
    recipes: [...grouped.values()],
    inventory,
    sourceFormat: "flat",
    parseErrors: [],
    detectedIngredients: [...grouped.values()].reduce((total, recipe) => total + recipe.ingredients.length, 0)
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function cellText(value) {
  return String(value ?? "").trim()
}

function parseNumberCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0
  const raw = cellText(value).replace(/[Q$]/g, "").replace(/\s+/g, "")
  const decimalFixed = raw.includes(",") && !raw.includes(".") ? raw.replace(",", ".") : raw.replace(/,/g, "")
  const number = Number(decimalFixed)
  return Number.isFinite(number) ? number : 0
}

function isEmptyMatrixRow(row) {
  return !row.some((cell) => cellText(cell))
}

function isRecipeMarkerRow(row) {
  const firstCell = cellText(row[0])
  return firstCell !== "" && Number.isFinite(Number(firstCell)) && cellText(row[1]).length > 1 && !isImportHeaderRow(row)
}

function isImportHeaderRow(row) {
  const text = normalizeText(row.join(" "))
  return [
    "proveedor",
    "ingredientes",
    "cantidad compra",
    "presentacion compra",
    "costo aprox",
    "cantidad produccion",
    "costo produccion"
  ].some((token) => text.includes(token))
}

function isTotalProductionRow(row) {
  return normalizeText(row.join(" ")).includes("total produccion")
}

function valueFromRow(row, aliases) {
  const entries = Object.entries(row)
  const normalizedAliases = aliases.map(normalizeText)
  const found = entries.find(([key]) => normalizedAliases.includes(normalizeText(key)))
  return String(found?.[1] ?? "")
}

function findInventoryMatch(name, inventory) {
  const target = normalizeText(name)
  const exact = inventory.find((item) => [item.name, item.sku, item.category].some((value) => normalizeText(value) === target))
  if (exact) return exact
  return inventory.find((item) => {
    const itemName = normalizeText(item.name)
    return itemName.includes(target) || target.includes(itemName)
  })
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

function normalizeRecipeUnit(unit) {
  const normalized = normalizeUnit(unit)
  const labels = { gramos: "Gramos", kilogramos: "Kilogramos", libras: "Libras", onzas: "Onzas", mililitros: "Mililitros", litros: "Litros", piezas: "Piezas", unidades: "Unidades" }
  return labels[normalized.key] || unit || "Unidades"
}

function normalizePreparationSteps(steps) {
  if (!Array.isArray(steps)) return []
  return steps.map((step, index) => {
    if (typeof step === "string") return { id: index + 1, text: step }
    return { id: step.id || index + 1, text: step.text || step.description || "" }
  })
}

function normalizeRecipeIngredient(ingredient, catalog) {
  const recipeQuantity = ingredient.recipeQuantity ?? ingredient.recipe_quantity ?? ingredient.quantity ?? "1"
  const recipeUnit = ingredient.recipeUnit || ingredient.recipe_unit || ingredient.unit || catalog?.base_unit || "Unidades"
  const inventoryUnit = catalog?.base_unit || ingredient.inventoryUnit || ingredient.inventory_unit || ingredient.unit || recipeUnit
  const conversion = convertRecipeQuantity(recipeQuantity, recipeUnit, inventoryUnit)
  return {
    ...ingredient,
    recipeQuantity: String(recipeQuantity),
    recipeUnit,
    inventoryQuantity: conversion.value === null ? "" : String(conversion.value),
    inventoryUnit,
    conversionFactor: conversion.factor || 1,
    conversionError: conversion.error
  }
}

function unitOptionsFor(catalog) {
  const baseUnit = catalog?.base_unit
  return Array.from(new Set([baseUnit, ...RECIPE_UNITS].filter(Boolean)))
}

function convertRecipeQuantity(quantity, fromUnit, toUnit) {
  const amount = Number(quantity || 0)
  if (!Number.isFinite(amount) || amount <= 0) return { value: amount, factor: 1, error: "" }
  const from = normalizeUnit(fromUnit)
  const to = normalizeUnit(toUnit)
  if (!from || !to || from.key === to.key) return { value: amount, factor: 1, error: "" }
  if (from.family !== to.family) {
    return {
      value: null,
      factor: 1,
      error: `No se puede convertir ${fromUnit} a ${toUnit}. Ajusta la unidad base del ingrediente o usa una unidad compatible.`
    }
  }
  const baseAmount = amount * from.toBase
  const converted = baseAmount / to.toBase
  return { value: converted, factor: converted / amount, error: "" }
}

function normalizeUnit(unit) {
  const key = String(unit || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
  const units = {
    g: { key: "gramos", family: "mass", toBase: 1 },
    gramo: { key: "gramos", family: "mass", toBase: 1 },
    gramos: { key: "gramos", family: "mass", toBase: 1 },
    kg: { key: "kilogramos", family: "mass", toBase: 1000 },
    kilogramo: { key: "kilogramos", family: "mass", toBase: 1000 },
    kilogramos: { key: "kilogramos", family: "mass", toBase: 1000 },
    lb: { key: "libras", family: "mass", toBase: 454 },
    libra: { key: "libras", family: "mass", toBase: 454 },
    libras: { key: "libras", family: "mass", toBase: 454 },
    oz: { key: "onzas", family: "mass", toBase: 28.375 },
    onza: { key: "onzas", family: "mass", toBase: 28.375 },
    onzas: { key: "onzas", family: "mass", toBase: 28.375 },
    ml: { key: "mililitros", family: "volume", toBase: 1 },
    mililitro: { key: "mililitros", family: "volume", toBase: 1 },
    mililitros: { key: "mililitros", family: "volume", toBase: 1 },
    l: { key: "litros", family: "volume", toBase: 1000 },
    litro: { key: "litros", family: "volume", toBase: 1000 },
    litros: { key: "litros", family: "volume", toBase: 1000 },
    pieza: { key: "piezas", family: "count", toBase: 1 },
    piezas: { key: "piezas", family: "count", toBase: 1 },
    unidad: { key: "unidades", family: "count", toBase: 1 },
    unidades: { key: "unidades", family: "count", toBase: 1 },
    "unidad/pieza": { key: "unidades", family: "count", toBase: 1 }
  }
  return units[key] || { key, family: "custom", toBase: 1 }
}

function formatRecipeNumber(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? String(number) : number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
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
