import { useEffect, useState } from "react"
import {
  deleteCateringQuoteTemplate,
  duplicateCateringQuoteTemplate,
  getCateringQuoteTemplateDetail,
  listCateringQuoteTemplates,
  upsertCateringQuoteTemplate
} from "./cateringService"
import {
  createEmptyQuoteItem,
  mapTemplateItemsToQuoteItems,
  normalizeQuoteItems,
  QUOTE_ITEM_TYPES,
  QUANTITY_UNITS
} from "./cateringQuoteTemplates"

const EMPTY_TEMPLATE = {
  id: null,
  name: "",
  description: "",
  category: "general",
  isActive: true,
  items: [createEmptyQuoteItem()]
}

export default function CateringQuoteTemplateManager({ open, onClose, onTemplatesChanged }) {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [draft, setDraft] = useState(EMPTY_TEMPLATE)

  useEffect(() => {
    if (!open) return
    loadTemplates()
    setDraft(EMPTY_TEMPLATE)
    setError("")
  }, [open])

  async function loadTemplates() {
    setLoading(true)
    const result = await listCateringQuoteTemplates(true)
    setLoading(false)
    if (!result.error) setTemplates(result.data || [])
  }

  async function handleEdit(templateId) {
    setLoading(true)
    const result = await getCateringQuoteTemplateDetail(templateId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const template = result.data?.template
    setDraft({
      id: template.id,
      name: template.name,
      description: template.description || "",
      category: template.category || "general",
      isActive: template.is_active !== false,
      items: mapTemplateItemsToQuoteItems(result.data?.items).length
        ? mapTemplateItemsToQuoteItems(result.data?.items)
        : [createEmptyQuoteItem()]
    })
  }

  function updateItem(index, field, value) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [field]: value } : item
      ))
    }))
  }

  async function handleSave(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    const result = await upsertCateringQuoteTemplate({
      id: draft.id,
      name: draft.name,
      description: draft.description,
      category: draft.category,
      isActive: draft.isActive,
      items: normalizeQuoteItems(draft.items).filter((item) => item.description)
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    await loadTemplates()
    onTemplatesChanged?.()
    setDraft(EMPTY_TEMPLATE)
  }

  async function handleDuplicate(templateId) {
    setSaving(true)
    const result = await duplicateCateringQuoteTemplate(templateId)
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      await loadTemplates()
      onTemplatesChanged?.()
    }
  }

  async function handleDelete(templateId) {
    if (!window.confirm("Eliminar esta plantilla?")) return
    setSaving(true)
    const result = await deleteCateringQuoteTemplate(templateId)
    setSaving(false)
    if (result.error) setError(result.error)
    else {
      await loadTemplates()
      onTemplatesChanged?.()
      if (draft.id === templateId) setDraft(EMPTY_TEMPLATE)
    }
  }

  if (!open) return null

  return (
    <div className="catering-quote-backdrop catering-quote-backdrop--nested" onClick={onClose}>
      <section className="catering-quote-modal catering-quote-modal--wide" onClick={(event) => event.stopPropagation()}>
        <header className="catering-quote-modal__header">
          <div>
            <p>Catalogo</p>
            <h2>Plantillas de cotizacion</h2>
          </div>
          <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
        </header>

        <div className="catering-template-manager">
          <aside className="catering-template-manager__list">
            <button type="button" className="primary" onClick={() => setDraft(EMPTY_TEMPLATE)}>Nueva plantilla</button>
            {loading ? <p className="catering-empty">Cargando...</p> : null}
            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                className={`catering-template-card ${draft.id === template.id ? "is-active" : ""}`}
                onClick={() => handleEdit(template.id)}
              >
                <strong>{template.name}</strong>
                <small>{template.category} · {template.item_count ?? 0} lineas</small>
                {!template.is_active ? <span className="catering-quote-status catering-quote-status--expired">Inactiva</span> : null}
              </button>
            ))}
          </aside>

          <form className="catering-template-manager__editor" onSubmit={handleSave}>
            <label>Nombre<input value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} required /></label>
            <label>Descripcion<input value={draft.description} onChange={(e) => setDraft((c) => ({ ...c, description: e.target.value }))} /></label>
            <label>Categoria<input value={draft.category} onChange={(e) => setDraft((c) => ({ ...c, category: e.target.value }))} /></label>
            <label className="catering-checkbox">
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft((c) => ({ ...c, isActive: e.target.checked }))} />
              Plantilla activa
            </label>

            <div className="catering-quote-lines">
              <div className="catering-quote-lines__head">
                <span>Tipo</span><span>Descripcion</span><span>Cant.</span><span>Unidad</span><span>Precio</span><span />
              </div>
              {draft.items.map((item, index) => (
                <div key={index} className="catering-quote-line">
                  <select value={item.item_type} onChange={(e) => updateItem(index, "item_type", e.target.value)}>
                    {QUOTE_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                  </select>
                  <input value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} placeholder="Descripcion" />
                  <input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, "quantity", e.target.value)} />
                  <select value={item.quantity_unit} onChange={(e) => updateItem(index, "quantity_unit", e.target.value)}>
                    {QUANTITY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                  </select>
                  <input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItem(index, "unit_price", e.target.value)} />
                  <button type="button" className="ghost" onClick={() => setDraft((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))}>×</button>
                </div>
              ))}
            </div>
            <button type="button" className="ghost" onClick={() => setDraft((c) => ({ ...c, items: [...c.items, createEmptyQuoteItem(c.items.length + 1)] }))}>
              Agregar linea
            </button>

            {error ? <p className="catering-message error">{error}</p> : null}

            <footer className="catering-quote-modal__footer">
              {draft.id ? (
                <>
                  <button type="button" className="ghost" disabled={saving} onClick={() => handleDuplicate(draft.id)}>Duplicar</button>
                  <button type="button" className="ghost" disabled={saving} onClick={() => handleDelete(draft.id)}>Eliminar</button>
                </>
              ) : null}
              <button type="submit" className="primary" disabled={saving}>{saving ? "Guardando..." : "Guardar plantilla"}</button>
            </footer>
          </form>
        </div>
      </section>
    </div>
  )
}
