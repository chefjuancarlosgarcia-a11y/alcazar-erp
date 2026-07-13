export function formatDueAt(value, options = {}) {
  if (!value) return options.emptyLabel || "Sin fecha"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return options.emptyLabel || "Sin fecha"
  if (options.dateOnly) {
    return date.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" })
  }
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  })
}

export function assigneeLabel(task) {
  const primary = task?.primary_assignee?.full_name
  if (primary) return primary
  const names = (task?.assignees || [])
    .map((row) => row.full_name)
    .filter(Boolean)
  if (!names.length) return "Sin asignar"
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
}

export function initialsForName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase()
}

export function computeSortPosition(columnTasks, dropIndex) {
  const sorted = [...columnTasks].sort(
    (a, b) => Number(a.sort_position || 0) - Number(b.sort_position || 0)
  )
  const before = sorted[dropIndex - 1]?.sort_position
  const after = sorted[dropIndex]?.sort_position
  if (before == null && after == null) return Date.now()
  if (before == null) return Number(after) / 2
  if (after == null) return Number(before) + 1024
  return (Number(before) + Number(after)) / 2
}

export function buildOperationalTaskLink(taskId, view = "mi-trabajo") {
  const base = view === "tablero" ? "/tasks/trabajo/tablero" : "/tasks/trabajo/mi-trabajo"
  const path = `${base}?task=${encodeURIComponent(taskId)}`
  if (typeof window === "undefined") return path
  return `${window.location.origin}${path}`
}

export function parseBoardFiltersFromParams(params) {
  const labelParam = params.get("labels") || ""
  const labelIds = labelParam
    ? labelParam.split(",").map((value) => value.trim()).filter(Boolean)
    : []
  return {
    areaId: params.get("area") || "",
    search: params.get("q") || "",
    labelIds,
    includeCancelled: params.get("cancelled") === "1",
    includeOldCompleted: params.get("oldCompleted") === "1"
  }
}

export function buildBoardSearchParams({ taskId = null, filters = {} } = {}) {
  const next = new URLSearchParams()
  if (taskId) next.set("task", taskId)
  if (filters.areaId) next.set("area", filters.areaId)
  if (filters.search) next.set("q", filters.search)
  if (filters.labelIds?.length) next.set("labels", filters.labelIds.join(","))
  if (filters.includeCancelled) next.set("cancelled", "1")
  if (filters.includeOldCompleted) next.set("oldCompleted", "1")
  return next
}

export async function copyOperationalTaskLink(taskId, view = "mi-trabajo") {
  const url = buildOperationalTaskLink(taskId, view)
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(url)
    return url
  }
  const input = document.createElement("textarea")
  input.value = url
  document.body.appendChild(input)
  input.select()
  document.execCommand("copy")
  document.body.removeChild(input)
  return url
}

export function groupTasksByStatus(tasks, columns, boardColumnForStatus) {
  const map = Object.fromEntries(columns.map((column) => [column.id, []]))
  const resolveColumn = boardColumnForStatus || ((status) => status)
  ;(tasks || []).forEach((task) => {
    const columnId = resolveColumn(task.status)
    if (map[columnId]) {
      map[columnId].push(task)
    }
  })
  Object.keys(map).forEach((status) => {
    map[status].sort(
      (a, b) => Number(a.sort_position || 0) - Number(b.sort_position || 0)
    )
  })
  return map
}

export function isMobileViewport() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(max-width: 767px)").matches
}

export function labelForActivityAction(action) {
  const labels = {
    created: "Creó la tarea",
    updated: "Actualizó la tarea",
    status_changed: "Cambió el estado",
    assignees_updated: "Actualizó participantes",
    watchers_updated: "Actualizó seguidores",
    watcher_added: "Comenzó a seguir la tarea",
    watcher_removed: "Dejó de seguir la tarea",
    moved: "Se reordenó la tarea",
    step_completed: "Completó un paso",
    step_uncompleted: "Marcó un paso como pendiente",
    step_list_created: "Creó una lista de pasos",
    step_list_deleted: "Eliminó una lista de pasos",
    attachment_added: "Agregó un adjunto",
    attachment_removed: "Eliminó un adjunto",
    comment_added: "Agregó un comentario",
    evidence_submitted: "Envió evidencia",
    step_converted: "Convirtió un paso en tarea",
    labels_updated: "Actualizó etiquetas",
    archived: "Archivó la tarea",
    restored: "Restauró la tarea",
  }
  return labels[action] || action
}

export function formatRelativeDays(days) {
  const value = Number(days) || 0
  if (value === 0) return "Hoy"
  if (value === 1) return "1 día"
  return `${value} días`
}

export function nextStepLabel(task) {
  const summary = task?.work_summary
  if (summary?.text) {
    const prefix = summary.list_title ? `${summary.list_title}: ` : ""
    return `${prefix}${summary.text}`
  }
  return null
}
