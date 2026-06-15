export const QUOTE_ITEM_TYPES = [
  { value: "food", label: "Alimentos" },
  { value: "beverage", label: "Bebidas" },
  { value: "staff", label: "Personal" },
  { value: "equipment", label: "Equipo" },
  { value: "transport", label: "Transporte" },
  { value: "other", label: "Otros" }
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

export const CATERING_QUOTE_TEMPLATES = [
  {
    id: "pizza_party",
    label: "Pizza Party",
    items: [
      { item_type: "food", description: "Pizza mediana surtida", quantity: 10, unit_price: 85 },
      { item_type: "food", description: "Pizza grande premium", quantity: 5, unit_price: 120 },
      { item_type: "beverage", description: "Refresco 2L", quantity: 8, unit_price: 18 },
      { item_type: "equipment", description: "Servicio de mesas y sillas", quantity: 1, unit_price: 350 }
    ]
  },
  {
    id: "corporate_event",
    label: "Evento Corporativo",
    items: [
      { item_type: "food", description: "Menu ejecutivo (entrada, plato fuerte, postre)", quantity: 50, unit_price: 95 },
      { item_type: "beverage", description: "Coffee break (cafe, te, pasteles)", quantity: 50, unit_price: 35 },
      { item_type: "staff", description: "Mesero / servicio", quantity: 4, unit_price: 250 },
      { item_type: "equipment", description: "Montaje salon y vajilla", quantity: 1, unit_price: 800 }
    ]
  },
  {
    id: "wedding",
    label: "Boda",
    items: [
      { item_type: "food", description: "Banquete nupcial por persona", quantity: 120, unit_price: 185 },
      { item_type: "beverage", description: "Barra de bebidas por persona", quantity: 120, unit_price: 45 },
      { item_type: "staff", description: "Brigada de servicio", quantity: 8, unit_price: 300 },
      { item_type: "equipment", description: "Montaje y decoracion basica", quantity: 1, unit_price: 2500 },
      { item_type: "transport", description: "Traslado de equipo", quantity: 1, unit_price: 600 }
    ]
  },
  {
    id: "birthday",
    label: "Cumpleanos",
    items: [
      { item_type: "food", description: "Buffet infantil / familiar", quantity: 30, unit_price: 75 },
      { item_type: "food", description: "Pastel personalizado", quantity: 1, unit_price: 450 },
      { item_type: "beverage", description: "Bebidas surtidas", quantity: 30, unit_price: 15 },
      { item_type: "equipment", description: "Decoracion tematica basica", quantity: 1, unit_price: 500 }
    ]
  },
  {
    id: "coffee_break",
    label: "Coffee Break",
    items: [
      { item_type: "food", description: "Canapes y bocadillos", quantity: 25, unit_price: 28 },
      { item_type: "beverage", description: "Cafe, te y jugos", quantity: 25, unit_price: 18 },
      { item_type: "equipment", description: "Estacion de coffee break", quantity: 1, unit_price: 300 }
    ]
  }
]

/** TAX_RATE = 0.12 (IVA Guatemala). Future: read from app_settings/branding. */
export const DEFAULT_TAX_RATE = 0.12

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
      unit_price: unitPrice,
      sort_order: item.sort_order ?? item.sortOrder ?? index + 1
    }
  })
}

export function calculateQuoteTotals(items = [], discountAmount = 0, taxRate = DEFAULT_TAX_RATE) {
  const subtotal = normalizeQuoteItems(items).reduce(
    (sum, item) => sum + roundMoney(item.quantity * item.unit_price),
    0
  )
  const discount = Math.max(Number(discountAmount) || 0, 0)
  const taxable = Math.max(subtotal - discount, 0)
  const tax = roundMoney(taxable * (Number(taxRate) || 0))
  const total = roundMoney(taxable + tax)
  return { subtotal, discount_amount: discount, tax_amount: tax, total }
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

export function buildQuotePayload(items, discountAmount, validUntil, notes) {
  return {
    items: normalizeQuoteItems(items).filter((item) => item.description),
    discountAmount: Number(discountAmount) || 0,
    validUntil: validUntil || null,
    notes: notes || null
  }
}
