import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import { getActiveInventoryItems } from "../services/inventoryService"
import { getActiveRecipes } from "../services/recipesService"
import {
  cancelProductionBatch,
  completeProductionBatch,
  createProductionOutputItem,
  createProductionBatch,
  getProductionBatches
} from "../services/internalProductionService"
import "./InventoryBase.css"

const EMPTY_FORM = {
  productionAreaId: "",
  recipeId: "",
  outputInventoryItemId: "",
  batchMultiplier: "1",
  expectedOutputQuantity: "",
  actualOutputQuantity: "",
  yieldQuantity: "",
  yieldUnit: "",
  notes: ""
}

const PRODUCER_ROLES = ["admin", "gerente_general", "gerente", "supervisor", "cocina", "pizzeria", "panadero", "repostero"]
const MANAGER_ROLES = ["admin", "gerente_general", "gerente", "supervisor"]

function InternalProduction() {
  const { user } = useAuth()
  const canCreate = PRODUCER_ROLES.includes(user?.role)
  const canManage = MANAGER_ROLES.includes(user?.role)
  const [areas, setAreas] = useState([])
  const [items, setItems] = useState([])
  const [recipes, setRecipes] = useState([])
  const [batches, setBatches] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [inputs, setInputs] = useState([])
  const [manualMode, setManualMode] = useState(false)
  const [tab, setTab] = useState("new")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creatingOutput, setCreatingOutput] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    const [areasResult, itemsResult, recipesResult, batchesResult] = await Promise.all([
      getActiveAreas(),
      getActiveInventoryItems(),
      getActiveRecipes(),
      getProductionBatches()
    ])
    const loadError = areasResult.error || itemsResult.error || recipesResult.error || batchesResult.error
    if (loadError) setError(loadError.message || "No se pudo cargar produccion interna.")
    else {
      setAreas(areasResult.data || [])
      setItems(itemsResult.data || [])
      setRecipes((recipesResult.data || []).filter((recipe) => recipe.recipe_type === "subrecipe"))
      setBatches(batchesResult.data || [])
      setError("")
    }
    setLoading(false)
  }

  const productionAreas = areas.filter((area) => area.isProductionArea || ["cocina", "pizzeria", "panaderia", "reposteria"].includes(area.id))
  const selectedRecipe = recipes.find((recipe) => recipe.id === form.recipeId)
  const selectedOutput = items.find((item) => item.id === form.outputInventoryItemId)
  const recipeMissingOutput = Boolean(selectedRecipe && !selectedRecipe.output_inventory_item_id)
  const batchMultiplier = Number(form.batchMultiplier || 0)
  const yieldQuantity = Number(selectedRecipe?.yield_quantity || form.yieldQuantity || 0)
  const expectedOutputQuantity = selectedRecipe ? yieldQuantity * batchMultiplier : Number(form.expectedOutputQuantity || 0)
  const actualOutputQuantity = Number(form.actualOutputQuantity || expectedOutputQuantity || 0)
  const wasteQuantity = Math.max(0, expectedOutputQuantity - actualOutputQuantity)
  const openBatches = batches.filter((batch) => ["draft", "in_progress"].includes(batch.status))
  const completedToday = batches.filter((batch) => batch.status === "completed" && String(batch.completed_at || batch.created_at || "").slice(0, 10) === new Date().toISOString().slice(0, 10))

  const totals = useMemo(() => {
    const costPerBatch = inputs.reduce((sum, input) => {
      const item = items.find((entry) => entry.id === input.inventoryItemId)
      return sum + Number(input.quantity || 0) * Number(item?.cost_per_base_unit || 0)
    }, 0)
    const cost = costPerBatch * (manualMode ? 1 : batchMultiplier || 0)
    const qty = actualOutputQuantity
    return { costPerBatch, cost, unit: qty > 0 ? cost / qty : 0 }
  }, [actualOutputQuantity, batchMultiplier, inputs, items, manualMode])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function selectRecipe(recipeId) {
    const recipe = recipes.find((entry) => entry.id === recipeId)
    const batches = Number(form.batchMultiplier || 1)
    const expected = recipe ? Number(recipe.yield_quantity || 0) * batches : 0
    setManualMode(false)
    setForm((current) => ({
      ...current,
      recipeId,
      productionAreaId: recipe?.production_area_id || current.productionAreaId || productionAreas[0]?.id || "",
      outputInventoryItemId: recipe?.output_inventory_item_id || "",
      yieldQuantity: recipe ? String(recipe.yield_quantity || 1) : "",
      yieldUnit: recipe?.yield_unit || "",
      expectedOutputQuantity: recipe ? String(expected) : "",
      actualOutputQuantity: recipe ? String(expected) : ""
    }))
    setInputs((recipe?.ingredients || []).map((ingredient) => ({
      inventoryItemId: ingredient.inventory_item_id,
      quantity: String(ingredient.inventory_quantity ?? ingredient.quantity ?? 0)
    })))
  }

  function updateBatchMultiplier(value) {
    const nextBatches = value
    const nextExpected = selectedRecipe ? Number(selectedRecipe.yield_quantity || 0) * Number(nextBatches || 0) : Number(form.expectedOutputQuantity || 0)
    setForm((current) => ({
      ...current,
      batchMultiplier: nextBatches,
      expectedOutputQuantity: selectedRecipe ? String(nextExpected) : current.expectedOutputQuantity,
      actualOutputQuantity: selectedRecipe ? String(nextExpected) : current.actualOutputQuantity
    }))
  }

  function startManualProduction() {
    if (manualMode) {
      setManualMode(false)
      setForm(EMPTY_FORM)
      setInputs([])
      return
    }
    setManualMode(true)
    setForm({ ...EMPTY_FORM, productionAreaId: productionAreas[0]?.id || "", actualOutputQuantity: "1", expectedOutputQuantity: "1" })
    setInputs([])
  }

  function updateInput(index, field, value) {
    setInputs((current) => current.map((input, inputIndex) => inputIndex === index ? { ...input, [field]: value } : input))
  }

  function addInput() {
    setInputs((current) => [...current, { inventoryItemId: items[0]?.id || "", quantity: "0" }])
  }

  async function createOutputForRecipe() {
    if (!selectedRecipe) return
    setCreatingOutput(true)
    setError("")
    const result = await createProductionOutputItem(selectedRecipe.id)
    if (result.error) {
      setError(result.error.message || "No se pudo crear el producto terminado.")
    } else {
      setMessage("Producto terminado creado y asociado a la receta.")
      const [itemsResult, recipesResult] = await Promise.all([getActiveInventoryItems(), getActiveRecipes()])
      if (!itemsResult.error) setItems(itemsResult.data || [])
      if (!recipesResult.error) setRecipes((recipesResult.data || []).filter((recipe) => recipe.recipe_type === "subrecipe"))
      setForm((current) => ({ ...current, outputInventoryItemId: result.data?.id || "" }))
    }
    setCreatingOutput(false)
  }

  async function submit(event) {
    event.preventDefault()
    if (!canCreate) return setError("No tienes permiso para crear produccion interna.")
    if (!manualMode && !selectedRecipe) return setError("Selecciona una receta estandarizada.")
    if (Number(form.batchMultiplier || 0) <= 0) return setError("Las tandas a producir deben ser mayores que cero.")
    if (actualOutputQuantity <= 0) return setError("La produccion real debe ser mayor que cero.")
    if (selectedRecipe && !selectedRecipe.output_inventory_item_id) {
      return setError("La receta seleccionada no tiene producto terminado configurado.")
    }
    if (!form.productionAreaId || !form.outputInventoryItemId) {
      return setError("Selecciona area y producto terminado.")
    }
    if (!inputs.length) return setError("Agrega al menos un insumo.")
    setSaving(true)
    setError("")
    const result = await createProductionBatch(form, inputs, [{
      inventoryItemId: form.outputInventoryItemId,
      quantity: actualOutputQuantity
    }])
    if (result.error) setError(result.error.message || "No se pudo crear la produccion.")
    else {
      setMessage("Produccion creada en proceso. Puedes completarla cuando confirmes el stock.")
      setForm(EMPTY_FORM)
      setInputs([])
      setManualMode(false)
      setTab("open")
      await refresh()
    }
    setSaving(false)
  }

  async function complete(id) {
    const result = await completeProductionBatch(id)
    if (result.error) setError(result.error.message || "No se pudo completar la produccion.")
    else {
      setMessage("Produccion completada. Inventario interno actualizado.")
      await refresh()
    }
  }

  async function cancel(id) {
    const reason = window.prompt("Motivo de cancelacion") || ""
    const result = await cancelProductionBatch(id, reason)
    if (result.error) setError(result.error.message || "No se pudo cancelar la produccion.")
    else {
      setMessage("Produccion cancelada.")
      await refresh()
    }
  }

  return (
    <section className="inventory-base">
      <header className="inventory-base-header">
        <div>
          <p className="inventory-base-eyebrow">Inventario</p>
          <h1>Produccion interna</h1>
          <p className="inventory-base-muted">Transforma materia prima del area en preparaciones listas para recetas finales.</p>
        </div>
      </header>

      {message && <div className="inventory-base-success">{message}</div>}
      {error && <div className="inventory-base-error">{error}</div>}

      <nav className="inventory-area-tabs">
        <button type="button" className={tab === "new" ? "active" : ""} onClick={() => setTab("new")}>Nueva produccion</button>
        <button type="button" className={tab === "open" ? "active" : ""} onClick={() => setTab("open")}>En proceso</button>
        <button type="button" className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>Historial</button>
        <button type="button" className={tab === "preps" ? "active" : ""} onClick={() => setTab("preps")}>Preparaciones disponibles</button>
      </nav>

      {loading && <p className="inventory-empty">Cargando produccion interna...</p>}

      {!loading && tab === "new" && (
        <form className="inventory-panel-grid" onSubmit={submit}>
          <article className="inventory-area-selected">
            <header><div><h2>Nueva produccion</h2><p className="inventory-base-muted">Selecciona una receta o arma la transformacion manualmente.</p></div></header>
            {selectedRecipe && (
              <div className="inventory-production-summary">
                <span>Produccion<strong>{selectedRecipe.name}</strong></span>
                <span>Producto terminado<strong>{selectedOutput?.name || "Sin producto asociado"}</strong></span>
                <span>Yield estandar<strong>{formatHumanQuantity(selectedRecipe.yield_quantity, selectedRecipe.yield_unit || selectedOutput?.base_unit)}</strong></span>
                <span>Tandas<strong>{formatQuantityNumber(batchMultiplier || 0)}</strong></span>
                <span>Produccion esperada<strong>{formatHumanQuantity(expectedOutputQuantity, selectedRecipe.yield_unit || selectedOutput?.base_unit)}</strong></span>
                <span>Produccion real<strong>{formatHumanQuantity(actualOutputQuantity, selectedRecipe.yield_unit || selectedOutput?.base_unit)}</strong></span>
                <span>Merma<strong>{formatHumanQuantity(wasteQuantity, selectedRecipe.yield_unit || selectedOutput?.base_unit)}</strong></span>
                <span>Costo total<strong>Q{totals.cost.toFixed(2)}</strong></span>
                <span>Costo unitario real<strong>Q{totals.unit.toFixed(2)}</strong></span>
              </div>
            )}
            {recipeMissingOutput && (
              <div className="inventory-base-warning">
                <span>Esta receta no tiene producto terminado asociado.</span>
                <button type="button" onClick={createOutputForRecipe} disabled={creatingOutput}>{creatingOutput ? "Creando..." : "Crear producto terminado"}</button>
              </div>
            )}
            <div className="inventory-production-form">
              <Field label="Area productora"><select value={form.productionAreaId} onChange={(event) => update("productionAreaId", event.target.value)}><option value="">Seleccionar</option>{productionAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
              <Field label="Receta / preparacion"><select value={form.recipeId} onChange={(event) => selectRecipe(event.target.value)} disabled={manualMode}><option value="">Seleccionar receta</option>{recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></Field>
              <Field label="Producto terminado">
                {selectedRecipe ? (
                  <input value={selectedOutput ? `${selectedOutput.name} (${selectedOutput.base_unit})` : "Sin producto terminado asociado"} disabled />
                ) : (
                  <select value={form.outputInventoryItemId} onChange={(event) => update("outputInventoryItemId", event.target.value)}><option value="">Seleccionar item</option>{items.filter(isPreparationItem).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.base_unit}</option>)}</select>
                )}
              </Field>
              <Field label="Yield estandar"><input value={selectedRecipe ? formatHumanQuantity(selectedRecipe.yield_quantity, selectedRecipe.yield_unit) : form.yieldQuantity} onChange={(event) => update("yieldQuantity", event.target.value)} disabled={Boolean(selectedRecipe)} /></Field>
              <Field label="Tandas / batches a producir"><input type="number" min="0.001" step="any" value={form.batchMultiplier} onChange={(event) => updateBatchMultiplier(event.target.value)} /></Field>
              <Field label="Produccion esperada"><input value={formatHumanQuantity(expectedOutputQuantity, selectedRecipe?.yield_unit || selectedOutput?.base_unit)} disabled /></Field>
              <Field label="Produccion real"><input type="number" min="0.001" step="any" value={form.actualOutputQuantity} onChange={(event) => update("actualOutputQuantity", event.target.value)} /></Field>
              <Field label="Responsable"><input value={user?.name || user?.full_name || user?.username || ""} disabled /></Field>
              <Field label="Notas"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
            </div>
            <div className="inventory-modal-actions"><button type="button" onClick={startManualProduction}>{manualMode ? "Volver a recetas" : "Crear produccion manual"}</button></div>
          </article>

          <article className="inventory-area-selected">
            <header>
              <div><h2>Insumos requeridos</h2><p className="inventory-base-muted">Costo estimado Q{totals.cost.toFixed(2)} · Q{totals.unit.toFixed(2)} por {selectedOutput?.base_unit || "unidad"}</p></div>
              <button type="button" onClick={addInput}>Agregar insumo</button>
            </header>
            <div className="inventory-production-inputs">
              {inputs.map((input, index) => {
                const item = items.find((entry) => entry.id === input.inventoryItemId)
                const stock = Number(item?.stockByArea?.[form.productionAreaId] || 0)
                const quantity = Number(input.quantity || 0) * (manualMode ? 1 : batchMultiplier || 0)
                const short = form.productionAreaId && stock < quantity
                return (
                  <div className="inventory-production-line" key={`${input.inventoryItemId}-${index}`}>
                    <select value={input.inventoryItemId} onChange={(event) => updateInput(index, "inventoryItemId", event.target.value)}>{items.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
                    <input type="number" min="0" step="any" value={formatInputQuantity(input.quantity)} onChange={(event) => updateInput(index, "quantity", event.target.value)} />
                    <span>{item?.base_unit || "unidad"}</span>
                    <small className={short ? "inventory-short-stock" : ""}>Requiere {formatHumanQuantity(quantity, item?.base_unit)} · Stock area: {formatHumanQuantity(stock, item?.base_unit)}{short ? " · insuficiente" : ""}</small>
                  </div>
                )
              })}
              {!inputs.length && <p className="inventory-empty">Selecciona una receta o agrega insumos manualmente.</p>}
            </div>
            <div className="inventory-modal-actions">
              <button type="submit" className="primary" disabled={saving || recipeMissingOutput}>{saving ? "Guardando..." : "Guardar produccion"}</button>
            </div>
          </article>
        </form>
      )}

      {!loading && tab === "open" && <BatchList batches={openBatches} canManage={canManage} onComplete={complete} onCancel={cancel} />}
      {!loading && tab === "history" && <BatchList batches={batches} canManage={false} onComplete={complete} onCancel={cancel} showAll />}
      {!loading && tab === "preps" && <Preparations items={items} recipes={recipes} areas={areas} completedToday={completedToday} />}
    </section>
  )
}

function BatchList({ batches, canManage, onComplete, onCancel, showAll = false }) {
  return (
    <div className="inventory-production-list">
      {batches.map((batch) => (
        <article className="inventory-area-selected" key={batch.id}>
          <header>
            <div>
              <h2>{batch.batch_number || "Produccion"}</h2>
              <p className="inventory-base-muted">{batch.output_name} · {formatHumanQuantity(batch.output_quantity, batch.output_unit)} · {batch.production_area_name || batch.production_area_id}</p>
            </div>
            <span className={`inventory-stock-badge ${batch.status === "completed" ? "ok" : batch.status === "cancelled" ? "inactive" : "low"}`}>{statusLabel(batch.status)}</span>
          </header>
          <div className="inventory-area-metrics">
            <span>Tandas<strong>{formatQuantityNumber(Number(batch.batch_multiplier || 1))}</strong></span>
            <span>Esperada<strong>{formatHumanQuantity(batch.expected_output_quantity ?? batch.expected_quantity, batch.yield_unit || batch.output_unit)}</strong></span>
            <span>Real<strong>{formatHumanQuantity(batch.actual_output_quantity ?? batch.output_quantity, batch.output_unit)}</strong></span>
            <span>Costo batch<strong>Q{Number(batch.total_cost || 0).toFixed(2)}</strong></span>
            <span>Costo unitario<strong>Q{Number(batch.actual_unit_cost || batch.unit_cost || 0).toFixed(2)}</strong></span>
            <span>Merma<strong>{formatHumanQuantity(batch.waste_quantity, batch.output_unit)}</strong></span>
          </div>
          <div className="inventory-production-columns">
            <div><strong>Insumos</strong>{(batch.inputs || []).map((input) => <small key={input.id}>{input.item_name}: {formatHumanQuantity(input.quantity, input.unit)}</small>)}</div>
            <div><strong>Salida</strong>{(batch.outputs || []).map((output) => <small key={output.id}>{output.item_name}: {formatHumanQuantity(output.quantity, output.unit)}</small>)}</div>
          </div>
          {!showAll && canManage && <div className="inventory-row-actions"><button type="button" className="primary" onClick={() => onComplete(batch.id)}>Completar produccion</button><button type="button" className="danger" onClick={() => onCancel(batch.id)}>Cancelar</button></div>}
        </article>
      ))}
      {!batches.length && <p className="inventory-empty">No hay producciones para mostrar.</p>}
    </div>
  )
}

function Preparations({ items, recipes, areas, completedToday }) {
  const preparationItems = items.filter((item) => String(item.category || "").toLowerCase().includes("prepar"))
  return (
    <div className="inventory-production-list">
      <article className="inventory-area-selected">
        <header><div><h2>Reporte rapido</h2><p className="inventory-base-muted">Producciones completadas hoy: {completedToday.length}</p></div></header>
        <div className="inventory-area-metrics">
          <span>Cantidad producida<strong>{formatHumanQuantity(completedToday.reduce((sum, batch) => sum + Number(batch.output_quantity || 0), 0), completedToday[0]?.output_unit || "Unidad")}</strong></span>
          <span>Costo total<strong>Q{completedToday.reduce((sum, batch) => sum + Number(batch.total_cost || 0), 0).toFixed(2)}</strong></span>
          <span>Merma<strong>{formatHumanQuantity(completedToday.reduce((sum, batch) => sum + Number(batch.waste_quantity || 0), 0), completedToday[0]?.output_unit || "Unidad")}</strong></span>
        </div>
      </article>
      {preparationItems.map((item) => (
        <article className="inventory-area-selected" key={item.id}>
          <header><div><h2>{item.name}</h2><p className="inventory-base-muted">{item.category || "Preparacion"} · Q{Number(item.cost_per_base_unit || 0).toFixed(2)} / {item.base_unit}</p></div></header>
          <div className="inventory-area-metrics">{areas.slice(0, 4).map((area) => <span key={area.id}>{area.name}<strong>{formatHumanQuantity(item.stockByArea?.[area.id] || 0, item.base_unit)}</strong></span>)}</div>
        </article>
      ))}
      {!preparationItems.length && <p className="inventory-empty">No hay items con categoria Preparaciones. Crea el producto terminado en inventario para producirlo.</p>}
      <article className="inventory-area-selected">
        <header><div><h2>Recetas de preparacion</h2><p className="inventory-base-muted">{recipes.length} subrecetas disponibles para producir.</p></div></header>
      </article>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="inventory-field"><span>{label}</span>{children}</label>
}

function isPreparationItem(item) {
  return String(item?.category || "").toLowerCase().includes("prepar")
}

function formatInputQuantity(value) {
  const number = Number(value || 0)
  if (!Number.isFinite(number)) return ""
  return formatQuantityNumber(number)
}

function formatHumanQuantity(value, unit = "") {
  let number = Number(value || 0)
  if (!Number.isFinite(number)) number = 0
  const normalized = normalizeUnitKey(unit)
  if (["kilogramos", "kg"].includes(normalized) && Math.abs(number) < 0.01) {
    return `${formatQuantityNumber(number * 1000)} g`
  }
  if (["gramos", "g"].includes(normalized) && Math.abs(number) >= 1000) {
    return `${formatQuantityNumber(number / 1000)} kg`
  }
  if (["litros", "l"].includes(normalized) && Math.abs(number) < 0.01) {
    return `${formatQuantityNumber(number * 1000)} ml`
  }
  if (["mililitros", "ml"].includes(normalized) && Math.abs(number) >= 1000) {
    return `${formatQuantityNumber(number / 1000)} l`
  }
  return `${formatQuantityNumber(number)} ${friendlyUnit(unit)}`.trim()
}

function formatQuantityNumber(number) {
  const absolute = Math.abs(number)
  const decimals = absolute >= 1 ? 2 : 3
  return number.toFixed(decimals)
}

function normalizeUnitKey(unit) {
  return String(unit || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function friendlyUnit(unit) {
  const normalized = normalizeUnitKey(unit)
  const labels = {
    kilogramos: "kg",
    kilogramo: "kg",
    kg: "kg",
    gramos: "g",
    gramo: "g",
    g: "g",
    litros: "l",
    litro: "l",
    l: "l",
    mililitros: "ml",
    mililitro: "ml",
    ml: "ml",
    unidades: "unidades",
    unidad: "unidad",
    piezas: "piezas",
    pieza: "pieza"
  }
  return labels[normalized] || unit || ""
}

function statusLabel(status) {
  return { draft: "Borrador", in_progress: "En proceso", completed: "Completada", cancelled: "Cancelada" }[status] || status
}

export default InternalProduction
