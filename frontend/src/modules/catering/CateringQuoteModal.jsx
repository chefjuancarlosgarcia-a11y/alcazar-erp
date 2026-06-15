import { useEffect, useMemo, useState } from "react"
import { useBrandingContext } from "../../context/BrandingProvider"
import {
  createCateringQuote,
  getCateringQuoteDetail,
  getCateringQuoteTemplateDetail,
  listCateringQuoteTemplates,
  saveCateringQuoteAsTemplate,
  updateCateringQuote,
  updateCateringQuoteStatus
} from "./cateringService"
import { getCateringQuoteSettings, mergeQuoteSettings } from "./cateringQuoteSettings"
import { repairCateringRequest } from "./cateringTextEncoding"
import { downloadCateringQuotePdf } from "./cateringQuotePdf"
import CateringQuotePreview from "./CateringQuotePreview"
import CateringQuoteSettingsPanel from "./CateringQuoteSettingsPanel"
import CateringQuoteTemplateManager from "./CateringQuoteTemplateManager"
import {
  buildQuotePayload,
  calculateQuoteTotals,
  createEmptyQuoteItem,
  DEFAULT_QUOTE_TERMS,
  formatQuantityLine,
  mapTemplateItemsToQuoteItems,
  normalizeQuoteItems,
  QUOTE_ITEM_TYPES,
  QUANTITY_UNITS,
  QUOTE_STATUS_LABELS,
  defaultValidUntil
} from "./cateringQuoteTemplates"
import { formatMoney } from "./cateringUtils"
import { CateringQuoteStatusBadge } from "./CateringQuoteKpis"

function mapItemsFromApi(items = []) {
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit || "unidades",
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? index + 1
  }))
}

export default function CateringQuoteModal({ open, request, quoteId = null, onClose, onSaved }) {
  const branding = useBrandingContext()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [currentQuoteId, setCurrentQuoteId] = useState(quoteId)
  const [quote, setQuote] = useState(null)
  const [items, setItems] = useState([createEmptyQuoteItem()])
  const [discountAmount, setDiscountAmount] = useState("0")
  const [validUntil, setValidUntil] = useState(defaultValidUntil())
  const [notes, setNotes] = useState("")
  const [terms, setTerms] = useState(DEFAULT_QUOTE_TERMS)
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState("")
  const [companySettings, setCompanySettings] = useState(null)
  const [showTemplateManager, setShowTemplateManager] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [mobileTab, setMobileTab] = useState("edit")

  const totals = useMemo(() => calculateQuoteTotals(items, discountAmount), [items, discountAmount])
  const safeRequest = useMemo(() => repairCateringRequest(request || {}), [request])
  const company = useMemo(
    () => mergeQuoteSettings(companySettings || {}, branding),
    [companySettings, branding]
  )

  const isDraft = !quote?.status || quote.status === "draft"
  const canEdit = isDraft

  useEffect(() => {
    if (!open) return
    setError("")
    setMessage("")
    setCurrentQuoteId(quoteId)
    setMobileTab("edit")
    loadBootstrap()
    if (quoteId) loadQuote(quoteId)
    else resetForm()
  }, [open, quoteId])

  async function loadBootstrap() {
    const [templatesResult, settingsResult] = await Promise.all([
      listCateringQuoteTemplates(false),
      getCateringQuoteSettings()
    ])
    if (!templatesResult.error) setTemplates(templatesResult.data || [])
    if (!settingsResult.error) {
      setCompanySettings(settingsResult.data)
      if (!quoteId) setTerms(settingsResult.data?.defaultTerms || DEFAULT_QUOTE_TERMS)
    }
  }

  function resetForm() {
    setQuote(null)
    setItems([createEmptyQuoteItem()])
    setDiscountAmount("0")
    setValidUntil(defaultValidUntil())
    setNotes("")
    setTerms(companySettings?.defaultTerms || DEFAULT_QUOTE_TERMS)
    setSelectedTemplate("")
  }

  async function loadQuote(id) {
    setLoading(true)
    setError("")
    const result = await getCateringQuoteDetail(id)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      return
    }
    const quoteRow = result.data?.quote || null
    setQuote(quoteRow)
    setItems(mapItemsFromApi(result.data?.items).length ? mapItemsFromApi(result.data?.items) : [createEmptyQuoteItem()])
    setDiscountAmount(String(quoteRow?.discount_amount ?? 0))
    setValidUntil(quoteRow?.valid_until ? String(quoteRow.valid_until).slice(0, 10) : defaultValidUntil())
    setNotes(quoteRow?.notes || "")
    setTerms(quoteRow?.terms || companySettings?.defaultTerms || DEFAULT_QUOTE_TERMS)
  }

  async function handleTemplateChange(templateId) {
    setSelectedTemplate(templateId)
    if (!templateId) return
    const result = await getCateringQuoteTemplateDetail(templateId)
    if (result.error) {
      setError(result.error)
      return
    }
    setItems(mapTemplateItemsToQuoteItems(result.data?.items))
  }

  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )))
  }

  function addItem() {
    setItems((current) => [...current, createEmptyQuoteItem(current.length + 1)])
  }

  function removeItem(index) {
    setItems((current) => (current.length <= 1 ? current : current.filter((_, itemIndex) => itemIndex !== index)))
  }

  async function handleSave(event) {
    event?.preventDefault?.()
    const payload = buildQuotePayload(items, discountAmount, validUntil, notes, terms)
    if (!payload.items.length) {
      setError("Agrega al menos una linea con descripcion.")
      return
    }

    setSaving(true)
    setError("")
    setMessage("")
    const result = currentQuoteId
      ? await updateCateringQuote(currentQuoteId, payload)
      : await createCateringQuote(request.id, payload)

    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }

    const savedQuote = result.data?.quote
    setQuote(savedQuote)
    setCurrentQuoteId(savedQuote?.id || currentQuoteId)
    setItems(mapItemsFromApi(result.data?.items))
    setMessage(currentQuoteId ? "Cotización actualizada." : "Cotización creada en borrador.")
    onSaved?.(result.data)
  }

  async function handleStatusChange(status) {
    if (!currentQuoteId) {
      setError("Guarda la cotizacion antes de cambiar el estado.")
      return
    }
    setSaving(true)
    setError("")
    setMessage("")
    const result = await updateCateringQuoteStatus(currentQuoteId, status)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setQuote(result.data?.quote || null)
    setMessage(`Cotización marcada como ${QUOTE_STATUS_LABELS[status] || status}.`)
    onSaved?.(result.data)
  }

  async function handleSaveAsTemplate() {
    if (!currentQuoteId) {
      setError("Guarda la cotizacion antes de crear una plantilla.")
      return
    }
    const name = window.prompt("Nombre de la plantilla:")
    if (!name?.trim()) return
    const result = await saveCateringQuoteAsTemplate(currentQuoteId, { name: name.trim(), category: "personalizada" })
    if (result.error) setError(result.error)
    else {
      setMessage("Plantilla guardada.")
      loadBootstrap()
    }
  }

  function handleGeneratePdf() {
    const quoteRow = quote || {
      quote_number: "BORRADOR",
      status: "draft",
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_amount: 0,
      total: totals.total,
      valid_until: validUntil,
      notes,
      terms
    }
    downloadCateringQuotePdf({
      quote: quoteRow,
      items: normalizeQuoteItems(items).map((item) => ({
        ...item,
        total_price: item.quantity * item.unit_price
      })),
      request: safeRequest,
      company
    })
  }

  if (!open) return null

  return (
    <>
      <div className="catering-quote-backdrop" onClick={onClose}>
        <section
          className="catering-quote-modal catering-quote-modal--split"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catering-quote-title"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="catering-quote-modal__header">
            <div>
              <p>Cotización de catering</p>
              <h2 id="catering-quote-title">{quote?.quote_number || "Nueva cotizacion"}</h2>
              <span>{safeRequest?.customer_name || "Cliente"}</span>
            </div>
            <div className="catering-quote-modal__badges">
              {quote?.status ? <CateringQuoteStatusBadge status={quote.status} label={QUOTE_STATUS_LABELS[quote.status]} /> : null}
              <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
            </div>
          </header>

          <div className="catering-quote-tabs">
            <button type="button" className={mobileTab === "edit" ? "is-active" : ""} onClick={() => setMobileTab("edit")}>Editar</button>
            <button type="button" className={mobileTab === "preview" ? "is-active" : ""} onClick={() => setMobileTab("preview")}>Vista previa</button>
          </div>

          {loading ? (
            <p className="catering-empty">Cargando cotizacion...</p>
          ) : (
            <div className="catering-quote-modal__split">
              <form className={`catering-quote-modal__body ${mobileTab === "preview" ? "is-hidden-mobile" : ""}`} onSubmit={handleSave}>
                <div className="catering-quote-toolbar">
                  <label>
                    Plantilla
                    <select value={selectedTemplate} disabled={!canEdit} onChange={(e) => handleTemplateChange(e.target.value)}>
                      <option value="">Seleccionar plantilla</option>
                      {templates.map((template) => (
                        <option key={template.id} value={template.id}>{template.name}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="ghost" onClick={() => setShowTemplateManager(true)}>Gestionar plantillas</button>
                  <button type="button" className="ghost" onClick={() => setShowSettings(true)}>Datos empresa</button>
                  <label>
                    Vigencia
                    <input type="date" value={validUntil} disabled={!canEdit} onChange={(e) => setValidUntil(e.target.value)} />
                  </label>
                  <label>
                    Descuento (Q)
                    <input type="number" min="0" step="0.01" value={discountAmount} disabled={!canEdit} onChange={(e) => setDiscountAmount(e.target.value)} />
                  </label>
                </div>

                <div className="catering-quote-lines">
                  <div className="catering-quote-lines__head">
                    <span>Tipo</span>
                    <span>Descripción</span>
                    <span>Cantidad</span>
                    <span>Unidad</span>
                    <span>Precio unit.</span>
                    <span>Total</span>
                    <span />
                  </div>
                  {items.map((item, index) => {
                    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
                    return (
                      <div key={`${index}-${item.sort_order}`} className="catering-quote-line">
                        <select value={item.item_type} disabled={!canEdit} onChange={(e) => updateItem(index, "item_type", e.target.value)}>
                          {QUOTE_ITEM_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
                        </select>
                        <input type="text" value={item.description} disabled={!canEdit} placeholder="Descripción" onChange={(e) => updateItem(index, "description", e.target.value)} />
                        <input type="number" min="0.01" step="0.01" value={item.quantity} disabled={!canEdit} onChange={(e) => updateItem(index, "quantity", e.target.value)} />
                        <select value={item.quantity_unit} disabled={!canEdit} onChange={(e) => updateItem(index, "quantity_unit", e.target.value)}>
                          {QUANTITY_UNITS.map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                        </select>
                        <input type="number" min="0" step="0.01" value={item.unit_price} disabled={!canEdit} onChange={(e) => updateItem(index, "unit_price", e.target.value)} />
                        <div className="catering-quote-line__total">
                          <strong>{formatMoney(lineTotal)}</strong>
                          <small>{formatQuantityLine(item)}</small>
                        </div>
                        {canEdit ? <button type="button" className="ghost" onClick={() => removeItem(index)}>×</button> : <span />}
                      </div>
                    )
                  })}
                </div>

                {canEdit ? (
                  <div className="catering-actions">
                    <button type="button" className="ghost" onClick={addItem}>Agregar linea</button>
                  </div>
                ) : null}

                <div className="catering-quote-totals">
                  <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
                  {totals.discount_amount > 0 ? <div><span>Descuento</span><strong>-{formatMoney(totals.discount_amount)}</strong></div> : null}
                  <div className="is-total"><span>Total</span><strong>{formatMoney(totals.total)}</strong></div>
                  <small className="catering-quote-preview__vat">Precios incluyen IVA</small>
                </div>

                <label>
                  Notas comerciales
                  <textarea rows={3} value={notes} disabled={!canEdit} placeholder="Mensaje comercial para el cliente" onChange={(e) => setNotes(e.target.value)} />
                </label>

                <label>
                  Términos y condiciones
                  <textarea rows={6} value={terms} disabled={!canEdit} onChange={(e) => setTerms(e.target.value)} />
                </label>

                {message ? <p className="catering-message success">{message}</p> : null}
                {error ? <p className="catering-message error">{error}</p> : null}

                <footer className="catering-quote-modal__footer">
                  <button type="button" className="ghost" onClick={handleGeneratePdf}>Generar PDF</button>
                  {currentQuoteId ? (
                    <button type="button" className="ghost" disabled={saving} onClick={handleSaveAsTemplate}>Guardar como plantilla</button>
                  ) : null}
                  {canEdit ? (
                    <button type="submit" className="primary" disabled={saving}>
                      {saving ? "Guardando..." : currentQuoteId ? "Guardar borrador" : "Crear cotizacion"}
                    </button>
                  ) : null}
                  {currentQuoteId && quote?.status === "draft" ? (
                    <button type="button" className="primary" disabled={saving} onClick={() => handleStatusChange("sent")}>Marcar enviada</button>
                  ) : null}
                  {quote?.status === "sent" ? (
                    <>
                      <button type="button" className="primary" disabled={saving} onClick={() => handleStatusChange("approved")}>Cliente aprobo</button>
                      <button type="button" className="ghost" disabled={saving} onClick={() => handleStatusChange("rejected")}>Cliente rechazo</button>
                      <button type="button" className="ghost" disabled={saving} onClick={() => handleStatusChange("expired")}>Marcar vencida</button>
                    </>
                  ) : null}
                </footer>
              </form>

              <div className={`catering-quote-modal__preview-wrap ${mobileTab === "edit" ? "is-hidden-mobile" : ""}`}>
                <CateringQuotePreview
                  quoteNumber={quote?.quote_number}
                  quoteStatus={quote?.status}
                  request={safeRequest}
                  items={items}
                  discountAmount={discountAmount}
                  validUntil={validUntil}
                  notes={notes}
                  terms={terms}
                  company={company}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <CateringQuoteTemplateManager
        open={showTemplateManager}
        onClose={() => setShowTemplateManager(false)}
        onTemplatesChanged={loadBootstrap}
      />
      <CateringQuoteSettingsPanel
        open={showSettings}
        onClose={() => setShowSettings(false)}
        onSaved={(data) => {
          setCompanySettings(data)
          if (!terms || terms === DEFAULT_QUOTE_TERMS) setTerms(data.defaultTerms || DEFAULT_QUOTE_TERMS)
        }}
      />
    </>
  )
}
