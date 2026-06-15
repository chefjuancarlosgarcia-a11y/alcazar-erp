import { useEffect, useMemo, useState } from "react"
import { useBrandingContext } from "../../context/BrandingProvider"
import {
  createCateringQuote,
  getCateringQuoteDetail,
  updateCateringQuote,
  updateCateringQuoteStatus
} from "./cateringService"
import { downloadCateringQuotePdf } from "./cateringQuotePdf"
import {
  buildQuotePayload,
  calculateQuoteTotals,
  CATERING_QUOTE_TEMPLATES,
  createEmptyQuoteItem,
  defaultValidUntil,
  itemTypeLabel,
  normalizeQuoteItems,
  QUOTE_ITEM_TYPES,
  QUOTE_STATUS_LABELS
} from "./cateringQuoteTemplates"
import { formatDate, formatMoney } from "./cateringUtils"
import { CateringQuoteStatusBadge } from "./CateringQuoteKpis"

function mapItemsFromApi(items = []) {
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? index + 1
  }))
}

export default function CateringQuoteModal({
  open,
  request,
  quoteId = null,
  onClose,
  onSaved
}) {
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
  const [selectedTemplate, setSelectedTemplate] = useState("")

  const totals = useMemo(
    () => calculateQuoteTotals(items, discountAmount),
    [items, discountAmount]
  )

  const isDraft = !quote?.status || quote.status === "draft"
  const canEdit = isDraft

  useEffect(() => {
    if (!open) return
    setError("")
    setMessage("")
    setCurrentQuoteId(quoteId)
    if (quoteId) loadQuote(quoteId)
    else resetForm()
  }, [open, quoteId])

  function resetForm() {
    setQuote(null)
    setItems([createEmptyQuoteItem()])
    setDiscountAmount("0")
    setValidUntil(defaultValidUntil())
    setNotes("")
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
  }

  function handleTemplateChange(templateId) {
    setSelectedTemplate(templateId)
    const template = CATERING_QUOTE_TEMPLATES.find((item) => item.id === templateId)
    if (!template) return
    setItems(template.items.map((item, index) => ({
      ...item,
      sort_order: index + 1
    })))
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
    setItems((current) => {
      if (current.length <= 1) return current
      return current.filter((_, itemIndex) => itemIndex !== index)
    })
  }

  async function handleSave(event) {
    event?.preventDefault?.()
    const payload = buildQuotePayload(items, discountAmount, validUntil, notes)
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
    setMessage(currentQuoteId ? "Cotizacion actualizada." : "Cotizacion creada en borrador.")
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
    setMessage(`Cotizacion marcada como ${QUOTE_STATUS_LABELS[status] || status}.`)
    onSaved?.(result.data)
  }

  function handleGeneratePdf() {
    const quoteRow = quote || {
      quote_number: "BORRADOR",
      status: "draft",
      subtotal: totals.subtotal,
      discount_amount: totals.discount_amount,
      tax_amount: totals.tax_amount,
      total: totals.total,
      valid_until: validUntil,
      notes
    }
    const pdfItems = normalizeQuoteItems(items).map((item) => ({
      ...item,
      total_price: item.quantity * item.unit_price
    }))
    downloadCateringQuotePdf({
      quote: quoteRow,
      items: pdfItems,
      request,
      branding
    })
  }

  if (!open) return null

  return (
    <div className="catering-quote-backdrop" onClick={onClose}>
      <section
        className="catering-quote-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catering-quote-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="catering-quote-modal__header">
          <div>
            <p>Cotizacion de catering</p>
            <h2 id="catering-quote-title">
              {quote?.quote_number || "Nueva cotizacion"}
            </h2>
            <span>{request?.customer_name || "Cliente"}</span>
          </div>
          <div className="catering-quote-modal__badges">
            {quote?.status ? <CateringQuoteStatusBadge status={quote.status} label={QUOTE_STATUS_LABELS[quote.status]} /> : null}
            <button type="button" className="ghost" onClick={onClose}>Cerrar</button>
          </div>
        </header>

        {loading ? (
          <p className="catering-empty">Cargando cotizacion...</p>
        ) : (
          <form className="catering-quote-modal__body" onSubmit={handleSave}>
            <div className="catering-quote-toolbar">
              <label>
                Plantilla rapida
                <select
                  value={selectedTemplate}
                  disabled={!canEdit}
                  onChange={(event) => handleTemplateChange(event.target.value)}
                >
                  <option value="">Seleccionar plantilla</option>
                  {CATERING_QUOTE_TEMPLATES.map((template) => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Vigencia
                <input
                  type="date"
                  value={validUntil}
                  disabled={!canEdit}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </label>
              <label>
                Descuento (Q)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={discountAmount}
                  disabled={!canEdit}
                  onChange={(event) => setDiscountAmount(event.target.value)}
                />
              </label>
            </div>

            <div className="catering-table-wrap">
              <table className="catering-table catering-quote-editor-table">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th>Descripcion</th>
                    <th>Cantidad</th>
                    <th>Precio unit.</th>
                    <th>Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0)
                    return (
                      <tr key={`${index}-${item.sort_order}`}>
                        <td>
                          <select
                            value={item.item_type}
                            disabled={!canEdit}
                            onChange={(event) => updateItem(index, "item_type", event.target.value)}
                          >
                            {QUOTE_ITEM_TYPES.map((type) => (
                              <option key={type.value} value={type.value}>{type.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="text"
                            value={item.description}
                            disabled={!canEdit}
                            placeholder="Descripcion del servicio"
                            onChange={(event) => updateItem(index, "description", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={item.quantity}
                            disabled={!canEdit}
                            onChange={(event) => updateItem(index, "quantity", event.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price}
                            disabled={!canEdit}
                            onChange={(event) => updateItem(index, "unit_price", event.target.value)}
                          />
                        </td>
                        <td>{formatMoney(lineTotal)}</td>
                        <td>
                          {canEdit ? (
                            <button type="button" className="ghost" onClick={() => removeItem(index)}>
                              Quitar
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {canEdit ? (
              <div className="catering-actions">
                <button type="button" className="ghost" onClick={addItem}>Agregar linea</button>
              </div>
            ) : null}

            <div className="catering-quote-totals">
              <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
              <div><span>Descuento</span><strong>{formatMoney(totals.discount_amount)}</strong></div>
              <div><span>Impuestos (IVA 12%)</span><strong>{formatMoney(totals.tax_amount)}</strong></div>
              <div className="is-total"><span>Total</span><strong>{formatMoney(totals.total)}</strong></div>
            </div>

            <label>
              Notas
              <textarea
                rows={4}
                value={notes}
                disabled={!canEdit}
                placeholder="Condiciones comerciales, tiempos de entrega, etc."
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>

            {quote?.valid_until ? (
              <p className="catering-quote-meta">Vigencia actual: {formatDate(quote.valid_until)}</p>
            ) : null}

            {message ? <p className="catering-message success">{message}</p> : null}
            {error ? <p className="catering-message error">{error}</p> : null}

            <footer className="catering-quote-modal__footer">
              <button type="button" className="ghost" onClick={handleGeneratePdf}>
                Generar PDF
              </button>
              {canEdit ? (
                <button type="submit" className="primary" disabled={saving}>
                  {saving ? "Guardando..." : currentQuoteId ? "Guardar borrador" : "Crear cotizacion"}
                </button>
              ) : null}
              {currentQuoteId && quote?.status === "draft" ? (
                <button type="button" className="primary" disabled={saving} onClick={() => handleStatusChange("sent")}>
                  Marcar enviada
                </button>
              ) : null}
              {quote?.status === "sent" ? (
                <>
                  <button type="button" className="primary" disabled={saving} onClick={() => handleStatusChange("approved")}>
                    Cliente aprobo
                  </button>
                  <button type="button" className="ghost" disabled={saving} onClick={() => handleStatusChange("rejected")}>
                    Cliente rechazo
                  </button>
                  <button type="button" className="ghost" disabled={saving} onClick={() => handleStatusChange("expired")}>
                    Marcar vencida
                  </button>
                </>
              ) : null}
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
