export const CONVERSION_STATUS_OPTIONS = [
  { value: "lead", label: "Nuevo", color: "blue" },
  { value: "contacted", label: "Contactado", color: "yellow" },
  { value: "quoted", label: "Cotizando", color: "orange" },
  { value: "negotiating", label: "Negociacion", color: "purple" },
  { value: "approved", label: "Aprobado", color: "green" },
  { value: "lost", label: "Perdido", color: "red" },
  { value: "converted", label: "Convertido", color: "teal" }
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

export const DEFAULT_WIN_PROBABILITY = {
  lead: 10,
  contacted: 25,
  quoted: 50,
  negotiating: 75,
  approved: 100,
  converted: 100,
  lost: 0
}

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

export function formatMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) return "—"
  if (minutes < 60) return `${Math.round(minutes)} min`
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function effectiveWinProbability(request) {
  if (request?.win_probability != null && request.win_probability !== "") {
    return Number(request.win_probability)
  }
  return DEFAULT_WIN_PROBABILITY[request?.conversion_status] ?? 10
}

export function weightedPipelineValue(request) {
  const estimated = Number(request?.estimated_value || 0)
  if (!estimated) return 0
  return estimated * (effectiveWinProbability(request) / 100)
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

export function getSlaState(request) {
  if (request?.last_contact_at) {
    return { level: "responded", label: "Contactado", minutes: 0 }
  }
  const createdAt = new Date(request?.created_at || 0)
  if (Number.isNaN(createdAt.getTime())) {
    return { level: "unknown", label: "—", minutes: 0 }
  }
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 60000))
  if (minutes <= 15) return { level: "green", label: formatMinutes(minutes), minutes }
  if (minutes <= 60) return { level: "yellow", label: formatMinutes(minutes), minutes }
  if (minutes <= 240) return { level: "orange", label: formatMinutes(minutes), minutes }
  return { level: "red", label: formatMinutes(minutes), minutes }
}

export function slaClass(level) {
  return `catering-sla catering-sla--${level || "unknown"}`
}

export function getFollowUpAlert(request) {
  if (!request?.follow_up_date) return null
  const today = new Date().toISOString().slice(0, 10)
  const followUp = String(request.follow_up_date).slice(0, 10)
  if (followUp < today) return { level: "overdue", label: "Seguimiento vencido" }
  if (followUp === today) return { level: "today", label: "Seguimiento hoy" }
  return null
}

export function followUpAlertClass(level) {
  return `catering-followup-alert catering-followup-alert--${level}`
}

export const ACTIVITY_TYPE_LABELS = {
  lead_received: "Lead recibido",
  lead_assigned: "Lead asignado",
  status_changed: "Estado cambiado",
  followup_recorded: "Seguimiento registrado",
  contact_made: "Cliente contactado",
  quote_created: "Cotizacion creada",
  quote_sent: "Cotizacion enviada",
  quote_approved: "Cotizacion aprobada",
  quote_rejected: "Cotizacion rechazada",
  quote_expired: "Cotizacion vencida"
}
