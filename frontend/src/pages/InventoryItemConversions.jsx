import { useCallback, useEffect, useState } from "react"
import { getActiveInventoryItems } from "../services/inventoryService"
import {
  deleteInventoryItemUnitConversion,
  getInventoryItemUnitConversions,
  upsertInventoryItemUnitConversion
} from "../services/recipesService"
import "./InventoryItemConversions.css"

const EMPTY_FORM = {
  inventoryItemId: "",
  fromUnit: "",
  toUnit: "Gramos",
  factor: "",
  notes: ""
}

function InventoryItemConversions() {
  const [items, setItems] = useState([])
  const [conversions, setConversions] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const loadData = useCallback(async () => {
    const [itemsResult, conversionsResult] = await Promise.all([
      getActiveInventoryItems(),
      getInventoryItemUnitConversions()
    ])
    if (itemsResult.error || conversionsResult.error) {
      setError(itemsResult.error?.message || conversionsResult.error?.message || "No se pudieron cargar conversiones.")
      return
    }
    setItems(itemsResult.data)
    setConversions(conversionsResult.data)
    setError("")
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(loadData, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  function selectItem(id) {
    const item = items.find((entry) => entry.id === id)
    setForm({ ...form, inventoryItemId: id, fromUnit: item?.base_unit || "" })
  }

  async function saveConversion(event) {
    event.preventDefault()
    if (!form.inventoryItemId || !form.fromUnit.trim() || !form.toUnit.trim() || Number(form.factor) <= 0) {
      setError("Completa producto, unidades y factor mayor que cero.")
      return
    }
    setSaving(true)
    const result = await upsertInventoryItemUnitConversion(form)
    setSaving(false)
    if (result.error) {
      setError(result.error.message || "No se pudo guardar la equivalencia.")
      return
    }
    setMessage("Equivalencia guardada.")
    setError("")
    setForm(EMPTY_FORM)
    await loadData()
  }

  async function removeConversion(id) {
    if (!window.confirm("¿Eliminar esta equivalencia?")) return
    const result = await deleteInventoryItemUnitConversion(id)
    if (result.error) {
      setError(result.error.message || "No se pudo eliminar la equivalencia.")
      return
    }
    setMessage("Equivalencia eliminada.")
    await loadData()
  }

  function editConversion(conversion) {
    setForm({
      inventoryItemId: conversion.inventory_item_id,
      fromUnit: conversion.from_unit,
      toUnit: conversion.to_unit,
      factor: String(conversion.factor),
      notes: conversion.notes || ""
    })
  }

  return (
    <section className="item-conversions-page">
      <header className="item-conversions-header">
        <div>
          <p className="item-conversions-eyebrow">Inventario</p>
          <h1>Conversiones por producto</h1>
          <p>Equivalencias culinarias para usar productos por pieza/unidad en recetas por gramos, libras u otras unidades.</p>
        </div>
        <button type="button" onClick={loadData}>Actualizar</button>
      </header>

      {message && <div className="item-conversions-success">{message}</div>}
      {error && <div className="item-conversions-error">{error}</div>}

      <form className="item-conversions-form" onSubmit={saveConversion}>
        <label>Producto
          <select value={form.inventoryItemId} onChange={(event) => selectItem(event.target.value)}>
            <option value="">Selecciona producto</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.base_unit})</option>)}
          </select>
        </label>
        <label>Unidad inventario
          <input value={form.fromUnit} onChange={(event) => setForm({ ...form, fromUnit: event.target.value })} placeholder="Unidad/Pieza" />
        </label>
        <label>Unidad receta
          <input value={form.toUnit} onChange={(event) => setForm({ ...form, toUnit: event.target.value })} placeholder="Gramos" />
        </label>
        <label>Equivalencia
          <input type="number" min="0.0001" step="any" value={form.factor} onChange={(event) => setForm({ ...form, factor: event.target.value })} placeholder="100" />
        </label>
        <label>Notas
          <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="1 unidad = 100 gramos" />
        </label>
        <button type="submit" className="primary" disabled={saving}>{saving ? "Guardando..." : "Guardar equivalencia"}</button>
      </form>

      <div className="item-conversions-table">
        <div><strong>Producto</strong><strong>Equivalencia</strong><strong>Notas</strong><strong>Acciones</strong></div>
        {conversions.map((conversion) => (
          <div key={conversion.id}>
            <span>{conversion.inventory_item?.name || conversion.inventory_item_id}</span>
            <span>1 {conversion.from_unit} = {conversion.factor} {conversion.to_unit}</span>
            <span>{conversion.notes || "-"}</span>
            <span>
              <button type="button" onClick={() => editConversion(conversion)}>Editar</button>
              <button type="button" className="danger" onClick={() => removeConversion(conversion.id)}>Eliminar</button>
            </span>
          </div>
        ))}
        {!conversions.length && <p>No hay equivalencias configuradas.</p>}
      </div>
    </section>
  )
}

export default InventoryItemConversions
