export const QUOTE_ITEM_TYPES = [
  { value: "food", label: "Alimentos" },
  { value: "beverage", label: "Bebidas" },
  { value: "staff", label: "Personal" },
  { value: "equipment", label: "Equipo" },
  { value: "transport", label: "Transporte" },
  { value: "other", label: "Otros" }
]

export const QUANTITY_UNITS = [
  { value: "personas", label: "personas" },
  { value: "platos", label: "platos" },
  { value: "pizzas", label: "pizzas" },
  { value: "unidades", label: "unidades" },
  { value: "horas", label: "horas" },
  { value: "servicios", label: "servicios" }
]

export const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Borrador", tone: "gray" },
  { value: "sent", label: "Enviada", tone: "blue" },
  { value: "approved", label: "Aprobada", tone: "green" },
  { value: "rejected", label: "Rechazada", tone: "red" },
  { value: "expired", label: "Vencida", tone: "orange" }
]

export const QUOTE_STATUS_LABELS = Object.fromEntries(
  QUOTE_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

/** TAX_RATE = 0.12 reservado para calculo interno futuro. Precios al cliente incluyen IVA. */
export const TAX_RATE = 0.12
export const PRICES_INCLUDE_VAT = true

export const DEFAULT_QUOTE_TERMS = `- Cotización válida hasta la fecha indicada.
- Reserva sujeta a disponibilidad de fecha y equipo.
- Para confirmar el evento se requiere anticipo.
- Cambios en menú, cantidad o locación están sujetos a disponibilidad y pueden ajustar el total.
- Precios incluyen IVA.
- Transporte fuera de Quetzaltenango (Xela) puede tener costo adicional.`

export function defaultValidUntil(days = 14) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function createEmptyQuoteItem(sortOrder = 1) {
  return {
    item_type: "food",
    description: "",
    quantity: 1,
    quantity_unit: "unidades",
    unit_price: 0,
    sort_order: sortOrder
  }
}

export function normalizeQuoteItems(items = []) {
  return items.map((item, index) => {
    const quantity = Number(item.quantity) || 0
    const unitPrice = Number(item.unit_price ?? item.unitPrice) || 0
    return {
      item_type: item.item_type || item.itemType || "other",
      description: String(item.description || "").trim(),
      quantity,
      quantity_unit: item.quantity_unit || item.quantityUnit || "unidades",
      unit_price: unitPrice,
      sort_order: item.sort_order ?? item.sortOrder ?? index + 1
    }
  })
}

export function calculateQuoteTotals(items = [], discountAmount = 0) {
  const subtotal = normalizeQuoteItems(items).reduce(
    (sum, item) => sum + roundMoney(item.quantity * item.unit_price),
    0
  )
  const discount = Math.max(Number(discountAmount) || 0, 0)
  const total = roundMoney(Math.max(subtotal - discount, 0))
  return {
    subtotal,
    discount_amount: discount,
    tax_amount: 0,
    tax_included: true,
    total
  }
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function quoteStatusClass(status) {
  return `catering-quote-status catering-quote-status--${status || "draft"}`
}

export function itemTypeLabel(value) {
  return QUOTE_ITEM_TYPES.find((item) => item.value === value)?.label || value || "—"
}

export function quantityUnitLabel(value) {
  return QUANTITY_UNITS.find((item) => item.value === value)?.label || value || "unidades"
}

export function formatQuantityLine(item) {
  const qty = Number(item.quantity) || 0
  const unit = quantityUnitLabel(item.quantity_unit)
  const price = Number(item.unit_price) || 0
  return `${qty.toLocaleString("es-GT")} ${unit} x Q${price.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function buildQuotePayload(items, discountAmount, validUntil, notes, terms) {
  return {
    items: normalizeQuoteItems(items).filter((item) => item.description),
    discountAmount: Number(discountAmount) || 0,
    validUntil: validUntil || null,
    notes: notes || null,
    terms: terms || null
  }
}

export function mapTemplateItemsToQuoteItems(items = []) {
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit || "unidades",
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? index + 1
  }))
}
