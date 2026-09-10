import { isQuoteOptionLine, normalizeQuoteItems } from "./cateringQuoteTemplates.js"

export const MOBILE_SECTIONS = [
  { id: "datos", label: "Datos" },
  { id: "productos", label: "Productos" },
  { id: "cierre", label: "Cierre" }
]

export const UNSAVED_CLOSE_MESSAGE =
  "Tienes cambios sin guardar. ¿Deseas cerrar y descartarlos?"

export const UNSAVED_STATUS_CHANGE_MESSAGE =
  "Guarda los cambios antes de cambiar el estado de la cotización."

export function getQuoteEditorLineKey(index) {
  return `quote-line-${index}`
}

export function getStatusChangeBlockedReason({ isDirty = false, currentQuoteId = null } = {}) {
  if (!currentQuoteId) {
    return "Guarda la cotizacion antes de cambiar el estado."
  }
  if (isDirty) {
    return UNSAVED_STATUS_CHANGE_MESSAGE
  }
  return null
}

export function getQuoteDownloadActionLabel(isDraft = false) {
  return isDraft ? "Descargar borrador" : "Descargar PDF"
}

export function getQuoteEmitActionLabel(emitting = false) {
  return emitting ? "Emitiendo…" : "Emitir y descargar PDF"
}

export function getQuoteEditorSnapshot({
  items = [],
  discountAmount = "0",
  validUntil = "",
  notes = "",
  terms = ""
}) {
  const normalized = normalizeQuoteItems(items)
  const withDescription = normalized.filter((item) => item.description)
  const snapshotItems = withDescription.length ? withDescription : normalized.slice(0, 1)

  return {
    items: snapshotItems.map((item) => ({
      item_type: item.item_type,
      description: item.description,
      quantity: Number(item.quantity) || 0,
      quantity_unit: item.quantity_unit || "unidades",
      unit_price: Number(item.unit_price) || 0,
      sort_order: Number(item.sort_order) || 0,
      line_kind: item.line_kind || "normal",
      option_group_name: item.option_group_name || "",
      option_label: item.option_label || "",
      is_selected_option: Boolean(item.is_selected_option),
      source_template_id: item.source_template_id || null,
      source_template_name: item.source_template_name || "",
      section_name: item.section_name || "",
      section_order: Number(item.section_order) || 0
    })),
    discountAmount: String(Number(discountAmount) || 0),
    validUntil: validUntil || "",
    notes: notes || "",
    terms: terms || ""
  }
}

export function areQuoteEditorSnapshotsEqual(left, right) {
  if (!left || !right) return false
  return JSON.stringify(left) === JSON.stringify(right)
}

export function duplicateQuoteItemAtIndex(items = [], index) {
  const source = items[index]
  if (!source) return items

  const copy = {
    ...source,
    description: source.description,
    sort_order: Number(source.sort_order) || index + 1,
    ...(isQuoteOptionLine(source) ? { is_selected_option: false } : {})
  }

  const next = [
    ...items.slice(0, index + 1),
    copy,
    ...items.slice(index + 1)
  ]

  return next.map((item, itemIndex) => ({
    ...item,
    sort_order: itemIndex + 1
  }))
}

export function getSaveValidationError(items = []) {
  const payloadItems = normalizeQuoteItems(items).filter((item) => item.description)
  if (!payloadItems.length) {
    return {
      message: "Agrega al menos una linea con descripcion.",
      section: "productos"
    }
  }
  return null
}

export function isDraftQuoteStatus(status) {
  return !status || status === "draft"
}

export function shouldPersistBeforeEmit({ currentQuoteId = null, isDirty = false } = {}) {
  return !currentQuoteId || isDirty
}

export function buildQuotePdfRow({
  quote = {},
  totals = {},
  validUntil,
  notes,
  terms,
  statusOverride
} = {}) {
  const status = statusOverride ?? quote.status ?? "draft"
  return {
    ...quote,
    quote_number: quote.quote_number || "BORRADOR",
    status,
    subtotal: totals.subtotal ?? quote.subtotal,
    discount_amount: totals.discount_amount ?? quote.discount_amount,
    tax_amount: quote.tax_amount ?? 0,
    total: totals.total ?? quote.total,
    valid_until: validUntil ?? quote.valid_until,
    notes: notes ?? quote.notes,
    terms: terms ?? quote.terms
  }
}

export async function persistCateringQuoteDraft({
  currentQuoteId = null,
  requestId,
  payload,
  createQuote,
  updateQuote
}) {
  const result = currentQuoteId
    ? await updateQuote(currentQuoteId, payload)
    : await createQuote(requestId, payload)

  if (result?.error) {
    return { ok: false, error: result.error }
  }

  return { ok: true, data: result.data }
}

export async function emitCateringQuoteDraft({
  currentQuoteId = null,
  requestId,
  isDirty = false,
  payload,
  createQuote,
  updateQuote,
  updateStatus
}) {
  let quoteId = currentQuoteId
  let detail = null

  if (shouldPersistBeforeEmit({ currentQuoteId, isDirty })) {
    const saved = await persistCateringQuoteDraft({
      currentQuoteId,
      requestId,
      payload,
      createQuote,
      updateQuote
    })
    if (!saved.ok) {
      return { ok: false, stage: "save", error: saved.error }
    }
    detail = saved.data
    quoteId = detail?.quote?.id || quoteId
  }

  if (!quoteId) {
    return { ok: false, stage: "save", error: "No se pudo obtener el identificador de la cotización." }
  }

  const sent = await updateStatus(quoteId, "sent")
  if (sent?.error) {
    return { ok: false, stage: "status", error: sent.error, quoteId, detail }
  }

  return { ok: true, stage: "ok", detail: sent.data, quoteId }
}
