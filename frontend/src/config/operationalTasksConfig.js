export const OPERATIONAL_TASK_STATUSES = [
  { id: "pending", label: "Pendiente", board: true },
  { id: "in_progress", label: "En progreso", board: true },
  { id: "waiting", label: "Esperando", board: true },
  { id: "blocked", label: "Bloqueada", board: true, boardColumn: "waiting" },
  { id: "in_review", label: "En revisión", board: true },
  { id: "completed", label: "Completadas", board: true },
  { id: "cancelled", label: "Cancelada", board: false }
]

/** Estados de espera con etiqueta humana (selector en panel) */
export const OPERATIONAL_TASK_WAITING_STATUSES = [
  { status: "waiting", waitingReason: "vendor", label: "Esperando proveedor" },
  { status: "waiting", waitingReason: "approval", label: "Esperando aprobación" },
  { status: "waiting", waitingReason: "info", label: "Esperando información" },
  { status: "waiting", waitingReason: "collaborator", label: "Esperando colaborador" },
  { status: "waiting", waitingReason: "spare_part", label: "Esperando repuesto" },
  { status: "waiting", waitingReason: "date", label: "Esperando fecha" },
  { status: "blocked", waitingReason: "other", label: "Bloqueada" }
]

/** Columnas Kanban visibles (blocked se agrupa en Esperando vía boardColumn) */
export const OPERATIONAL_TASK_BOARD_COLUMNS = OPERATIONAL_TASK_STATUSES.filter(
  (row) => row.board && !row.boardColumn
)

export const OPERATIONAL_TASK_KANBAN_STATUSES = [
  "pending",
  "in_progress",
  "waiting",
  "in_review",
  "completed"
]

export const OPERATIONAL_TASK_PRIORITIES = [
  { id: "low", label: "Baja", tone: "muted" },
  { id: "medium", label: "Media", tone: "info" },
  { id: "high", label: "Alta", tone: "warning" },
  { id: "critical", label: "Crítica", tone: "danger" }
]

export const OPERATIONAL_TASK_WAITING_REASONS = [
  { id: "vendor", label: "Proveedor" },
  { id: "approval", label: "Aprobación" },
  { id: "info", label: "Información" },
  { id: "collaborator", label: "Colaborador" },
  { id: "spare_part", label: "Repuesto" },
  { id: "date", label: "Fecha" },
  { id: "other", label: "Otro" }
]

export const OPERATIONAL_TASK_LABEL_COLORS = {
  teal: { bg: "#134e4a", text: "#5eead4" },
  blue: { bg: "#1e3a5f", text: "#93c5fd" },
  green: { bg: "#14532d", text: "#86efac" },
  yellow: { bg: "#422006", text: "#fcd34d" },
  orange: { bg: "#431407", text: "#fdba74" },
  red: { bg: "#450a0a", text: "#fca5a5" },
  purple: { bg: "#3b0764", text: "#d8b4fe" },
  pink: { bg: "#500724", text: "#f9a8d4" },
  slate: { bg: "#1e293b", text: "#cbd5e1" }
}

export function labelColorStyle(colorKey) {
  const palette = OPERATIONAL_TASK_LABEL_COLORS[colorKey] || OPERATIONAL_TASK_LABEL_COLORS.teal
  return { backgroundColor: palette.bg, color: palette.text }
}

const BOARD_ROLES = new Set([
  "admin",
  "ceo",
  "gerente_general",
  "gerente",
  "supervisor",
  "recursos_humanos",
  "encargado_area"
])

const ASSIGN_ROLES = BOARD_ROLES

export function isOperationalTasksV2Enabled() {
  if (import.meta.env.VITE_ERP_TASKS_V2 === "true") return true
  try {
    return localStorage.getItem(OPERATIONAL_TASKS_V2_FLAG) === "true"
  } catch {
    return false
  }
}

export function canViewOperationalTaskBoard(role) {
  return BOARD_ROLES.has(String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
}

export function canAssignOperationalTasks(role) {
  return ASSIGN_ROLES.has(String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
}

const LABEL_ADMIN_ROLES = new Set([
  "admin",
  "ceo",
  "gerente_general",
  "gerente",
  "recursos_humanos"
])

export function canAdministerTaskLabels(role) {
  return LABEL_ADMIN_ROLES.has(String(role || "").trim().toLowerCase().replace(/[\s-]+/g, "_"))
}

export function labelForOperationalStatus(status) {
  return OPERATIONAL_TASK_STATUSES.find((row) => row.id === status)?.label || status
}

export function labelForOperationalPriority(priority) {
  return OPERATIONAL_TASK_PRIORITIES.find((row) => row.id === priority)?.label || priority
}

export function labelForOperationalWaitingReason(reason) {
  return OPERATIONAL_TASK_WAITING_REASONS.find((row) => row.id === reason)?.label || reason
}

export function boardColumnForOperationalStatus(status) {
  const row = OPERATIONAL_TASK_STATUSES.find((item) => item.id === status)
  return row?.boardColumn || status
}

export function waitingStatusKey(status, waitingReason) {
  if (status === "blocked") return "blocked:other"
  return `waiting:${waitingReason || "vendor"}`
}

export function parseWaitingStatusKey(key) {
  const row = OPERATIONAL_TASK_WAITING_STATUSES.find(
    (item) => waitingStatusKey(item.status, item.waitingReason) === key
  )
  return row || OPERATIONAL_TASK_WAITING_STATUSES[0]
}
