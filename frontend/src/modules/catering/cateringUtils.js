export const CONVERSION_STATUS_OPTIONS = [
  { value: "lead", label: "Lead nuevo" },
  { value: "contacted", label: "Contactado" },
  { value: "quoted", label: "Cotizado" },
  { value: "negotiating", label: "Negociando" },
  { value: "approved", label: "Aprobado" },
  { value: "lost", label: "Perdido" },
  { value: "converted", label: "Convertido" }
]

export const OPERATIONAL_STATUS_OPTIONS = [
  { value: "new", label: "Nuevo" },
  { value: "reviewing", label: "En revision" },
  { value: "quoted", label: "Cotizado (interno)" },
  { value: "sent", label: "Enviado al cliente" },
  { value: "approved", label: "Aprobado" },
  { value: "rejected", label: "Rechazado" },
  { value: "converted", label: "Convertido" }
]

export const CONVERSION_STATUS_LABELS = Object.fromEntries(
  CONVERSION_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

export const OPERATIONAL_STATUS_LABELS = Object.fromEntries(
  OPERATIONAL_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

export function formatDate(value) {
  if (!value) return "—"
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("es-GT", { day: "2-digit", month: "short", year: "numeric" })
}

export function formatDateTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

export function formatTime(value) {
  if (!value) return "—"
  return String(value).slice(0, 5)
}

export function formatProducts(products) {
  if (!Array.isArray(products) || !products.length) return "—"
  return products.join(", ")
}

export function formatMoney(value) {
  if (value == null || value === "") return "—"
  return `Q${Number(value).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function matchesSearch(request, query) {
  const term = String(query || "").trim().toLowerCase()
  if (!term) return true
  const haystack = [
    request.customer_name,
    request.customer_phone,
    request.customer_email,
    request.event_location,
    request.event_type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  return haystack.includes(term)
}

export function matchesEventDate(request, eventDateFilter) {
  if (!eventDateFilter) return true
  if (!request.event_date) return false
  return String(request.event_date).slice(0, 10) === eventDateFilter
}

export function conversionStatusClass(status) {
  return `catering-status catering-status--${status || "lead"}`
}
