import { normalizeRole } from "../../utils/profilePermissions"

export const EXPEDIENTE_ACCESS_ROLES = [
  "admin",
  "gerente_general",
  "recursos_humanos",
  "rrhh"
]

export const EXPEDIENTE_WRITE_ROLES = [
  "admin",
  "gerente_general",
  "recursos_humanos",
  "rrhh"
]

export const EXPEDIENTE_ACCESS_DENIED_MESSAGE =
  "No tienes permisos para acceder a Expedientes de Colaboradores."

export const EXPEDIENTE_STATUS = {
  complete: { label: "Expediente completo", tone: "green" },
  incomplete: { label: "Expediente incompleto", tone: "yellow" },
  expired: { label: "Documentos vencidos", tone: "red" }
}

export const DOCUMENT_STATUS = {
  missing: { label: "Faltante", tone: "red" },
  empty: { label: "Sin cargar", tone: "neutral" },
  valid: { label: "Vigente", tone: "green" },
  warning: { label: "Por vencer", tone: "yellow" },
  orange: { label: "Por vencer", tone: "orange" },
  expired: { label: "Vencido", tone: "red" },
  none: { label: "Sin vencimiento", tone: "neutral" }
}

export const EXPIRY_STATUS = DOCUMENT_STATUS

export const TAB_ITEMS = [
  { id: "general", label: "Informacion general" },
  { id: "legal", label: "Documentos legales" },
  { id: "recruitment", label: "Reclutamiento" },
  { id: "background", label: "Antecedentes" },
  { id: "health", label: "Salud" },
  { id: "discipline", label: "Disciplina e Incidentes" },
  { id: "history", label: "Historial laboral" }
]

export const FILE_TYPES_BY_TAB = {
  legal: ["dpi_front", "dpi_back", "nit", "labor_contract", "internal_rules"],
  recruitment: ["cv", "recommendation", "id_photo"],
  background: ["criminal_record", "police_record"],
  health: ["medical_certificate", "health_card", "food_handling"]
}

export const INCIDENT_CATEGORIES = {
  attendance: "Asistencia",
  conduct: "Conducta",
  performance: "Desempeno",
  safety: "Seguridad",
  policy: "Politicas internas",
  other: "Otro"
}

export const INCIDENT_SEVERITIES = {
  low: { label: "Baja", tone: "neutral" },
  medium: { label: "Media", tone: "yellow" },
  high: { label: "Alta", tone: "orange" },
  critical: { label: "Critica", tone: "red" }
}

export const INCIDENT_STATUSES = {
  open: { label: "Abierto", tone: "red" },
  under_review: { label: "En revision", tone: "yellow" },
  closed: { label: "Cerrado", tone: "neutral" }
}

export const DISCIPLINARY_ACTION_TYPES = {
  verbal_warning: { label: "Llamada de atencion", tone: "yellow" },
  memorandum: { label: "Memorandum", tone: "orange" },
  suspension: { label: "Suspension", tone: "red" },
  other: { label: "Otra accion", tone: "neutral" }
}

export const DISCIPLINARY_ACTION_STATUSES = {
  active: { label: "Activa", tone: "red" },
  completed: { label: "Completada", tone: "green" },
  revoked: { label: "Revocada", tone: "neutral" }
}

export function incidentStatusClass(status) {
  return `expediente-status expediente-status--${INCIDENT_STATUSES[status]?.tone || "neutral"}`
}

export function actionTypeClass(type) {
  return `expediente-doc-badge expediente-doc-badge--${DISCIPLINARY_ACTION_TYPES[type]?.tone || "neutral"}`
}

export function canAccessExpedientes(role) {
  return EXPEDIENTE_ACCESS_ROLES.includes(normalizeRole(role))
}

export function canWriteExpedientes(role) {
  return EXPEDIENTE_WRITE_ROLES.includes(normalizeRole(role))
}

export function formatDate(value) {
  if (!value) return "—"
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString("es-GT", { day: "2-digit", month: "short", year: "numeric" })
}

export function statusClass(status) {
  return `expediente-status expediente-status--${EXPEDIENTE_STATUS[status]?.tone || "neutral"}`
}

export function expiryClass(status) {
  return `expediente-doc-badge expediente-doc-badge--${DOCUMENT_STATUS[status]?.tone || "neutral"}`
}

export function isDocumentTypeRequired(type, requiresFoodHandling = false) {
  if (!type) return false
  if (type.is_required) return true
  if (type.is_conditional && type.completeness_slot === "food_handling") {
    return requiresFoodHandling
  }
  return false
}

export function getDocumentDisplayStatus({ type, entry, requiresFoodHandling = false }) {
  const current = entry?.current_version
  if (!current) {
    return isDocumentTypeRequired(type, requiresFoodHandling) ? "missing" : "empty"
  }
  if (current.no_expires) return "none"
  const expiry = entry?.expiry_status || "none"
  if (expiry === "none" && !type?.requires_expiry) return "none"
  if (expiry === "none" && type?.requires_expiry && !current.expires_at) return "none"
  return expiry
}

export function findFileEntry(files, code) {
  return (files || []).find((entry) => entry.file?.file_type_code === code || entry.type?.code === code) || null
}

export function getTypeLabel(types, code) {
  return types?.find((item) => item.code === code)?.label || code
}
