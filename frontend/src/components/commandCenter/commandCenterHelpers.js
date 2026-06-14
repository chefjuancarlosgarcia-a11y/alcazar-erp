export const ALERT_PRIORITY = { critical: 0, high: 1, medium: 2, low: 3 }
export const TIMEZONE = "America/Guatemala"

export const ALERT_ROUTES = {
  "Stock agotado": "/reports?tab=inventory",
  "Stock bajo": "/reports?tab=inventory",
  "KDS atrasado": "/production",
  Requisiciones: "/inventory?section=requisicion",
  "Producto POS incompleto": "/pos?section=agregar-item",
  "Receta sin costo": "/inventory?section=recetas",
  "Rendimiento bajo mínimo": "/reports?tab=yields"
}

export const ALERT_ICONS = {
  "Stock agotado": "📦",
  "Stock bajo": "⚠️",
  "KDS atrasado": "👨‍🍳",
  Requisiciones: "📋",
  "Producto POS incompleto": "🛒",
  "Receta sin costo": "📊",
  "Rendimiento bajo mínimo": "📉"
}

export const MOVEMENT_LABELS = {
  purchase: "Recepción de inventario",
  transfer: "Traslado de inventario",
  consumption: "Consumo de inventario",
  waste: "Registro de merma",
  adjustment: "Ajuste de inventario",
  production_input: "Entrada de producción",
  production_output: "Salida de producción"
}

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE })
}

export function formatDateLabel(date = new Date()) {
  return date.toLocaleDateString("es-GT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TIMEZONE })
}

export function formatEventTime(iso) {
  if (!iso) return "--:--"
  return new Date(iso).toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE })
}

export function money(value) {
  return `Q${Number(value || 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function mapAttendanceMarks(marks = []) {
  return marks.map((mark) => {
    const markedDate = new Date(mark.marked_at)
    return {
      id: mark.id,
      colaboradorId: mark.employee_id,
      colaboradorNombre: mark.employee_name,
      fecha: markedDate.toLocaleDateString("en-CA", { timeZone: TIMEZONE }),
      hora: markedDate.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIMEZONE }),
      fechaHoraISO: mark.marked_at,
      tipo: mark.mark_type
    }
  })
}

export function mapAttendanceProfiles(profiles = []) {
  return profiles.map((profile) => ({ id: profile.id, nombre: profile.full_name || "Sin nombre", activo: true }))
}

export function normalizeLateRows(rows = []) {
  return rows.map((row, index) => ({
    ...row,
    colaboradorNombre: row.colaboradorNombre || row.employee_name || row.full_name || "Colaborador",
    id: row.id || `late-${index}`
  }))
}

export function summarizeAlerts(alerts) {
  const safe = alerts || []
  return {
    total: safe.length,
    critical: safe.filter((alert) => alert.priority === "critical").length,
    high: safe.filter((alert) => alert.priority === "high").length,
    medium: safe.filter((alert) => alert.priority === "medium").length,
    low: safe.filter((alert) => alert.priority === "low").length,
    top: safe[0] || null
  }
}

const PRIORITY_LABELS = {
  critical: "Crítica",
  high: "Alta",
  medium: "Media",
  low: "Baja"
}

export function alertPriorityLabel(priority) {
  return PRIORITY_LABELS[priority] || "Media"
}

export function buildAlertList(operationalAlerts, yieldAlerts) {
  const ops = operationalAlerts || []
  const yields = yieldAlerts || []
  return [
    ...ops.map((alert, index) => ({
      id: `ops-${index}`,
      priority: alert.priority || "medium",
      title: alert.type,
      description: alert.detail,
      area: alert.area || "General",
      icon: ALERT_ICONS[alert.type] || "🔔",
      to: ALERT_ROUTES[alert.type] || "/dashboard"
    })),
    ...yields.map((alert, index) => ({
      id: `yield-${index}`,
      priority: "high",
      title: "Rendimiento bajo mínimo",
      description: alert.message,
      area: "Rendimientos",
      icon: ALERT_ICONS["Rendimiento bajo mínimo"],
      to: ALERT_ROUTES["Rendimiento bajo mínimo"]
    }))
  ]
    .sort((a, b) => (ALERT_PRIORITY[a.priority] ?? 9) - (ALERT_PRIORITY[b.priority] ?? 9))
    .slice(0, 10)
}

export function resolveOverallStatus(alerts, semaphores) {
  const safeAlerts = alerts || []
  const safeSemaphores = semaphores || {}
  if (safeAlerts.some((alert) => alert.priority === "critical")) {
    return { level: "red", label: "Situación crítica", emoji: "🔴" }
  }
  if (
    safeAlerts.some((alert) => alert.priority === "high")
    || Object.values(safeSemaphores).some((level) => level === "yellow" || level === "red")
  ) {
    return { level: "yellow", label: "Atención requerida", emoji: "🟡" }
  }
  return { level: "green", label: "Operación estable", emoji: "🟢" }
}

export function buildActivityTimeline(production, inventory, tasks = []) {
  const events = []

  ;(production?.recent || []).slice(0, 6).forEach((ticket) => {
    const served = ticket.status === "served"
    events.push({
      id: `ticket-${ticket.id}`,
      at: ticket.updated_at || ticket.created_at,
      title: served
        ? `Ticket completado · ${ticket.table_name || "Mesa"}`
        : `Pedido enviado a ${ticket.area_name || "producción"} · ${ticket.table_name || "Mesa"}`,
      area: ticket.area_name || "Producción",
      to: served ? "/production" : "/production"
    })
  })

  ;(inventory?.movements || []).slice(0, 6).forEach((movement) => {
    events.push({
      id: `mov-${movement.id}`,
      at: movement.created_at,
      title: `${MOVEMENT_LABELS[movement.movement_type] || "Movimiento de inventario"} · ${movement.item?.name || "Producto"}`,
      area: movement.to_area?.name || movement.from_area?.name || "Inventario",
      to: "/inventory"
    })
  })

  tasks
    .filter((task) => task.status === "completed" && task.completedAt)
    .slice(0, 4)
    .forEach((task) => {
      events.push({
        id: `task-${task.id}`,
        at: task.completedAt,
        title: `Tarea completada · ${task.title}`,
        area: task.areaName || "Operaciones",
        to: "/tasks"
      })
    })

  return events
    .filter((event) => event.at)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, 8)
    .map((event) => ({ ...event, time: formatEventTime(event.at) }))
}

export function productionTraffic(summary) {
  const safe = summary || {}
  const late = Number(safe.late || 0)
  if (late >= 6) return "red"
  if (late >= 3) return "yellow"
  return "green"
}

export function inventoryTraffic(inventory) {
  const safe = inventory || {}
  const out = (safe.out || []).length
  const low = (safe.low || []).length
  if (out > 0) return "red"
  if (low > 0) return "yellow"
  return "green"
}

export function hrTraffic(late = 0, absences = 0) {
  if (absences > 0) return "red"
  if (late >= 3) return "yellow"
  return "green"
}

export function costsTraffic(costs) {
  const safe = costs || {}
  const financialImpact = Number(safe.financialImpact || 0)
  const zeroCostRecipes = Number(safe.zeroCostRecipes || 0)
  const yieldBelowMinimum = Number(safe.yieldBelowMinimum || 0)
  const avgFoodCost = Number(safe.avgFoodCost || 0)
  const criticalMerma = financialImpact >= 500
  const foodCostOutOfTarget = avgFoodCost >= 35
  if (criticalMerma || foodCostOutOfTarget) return "red"
  if (yieldBelowMinimum > 0 || zeroCostRecipes > 0) return "yellow"
  return "green"
}

export function trafficLevel(productionSummary, inventory, hr, costs) {
  const safeHr = hr || {}
  return {
    production: productionTraffic(productionSummary),
    inventory: inventoryTraffic(inventory),
    hr: hrTraffic(safeHr.late, safeHr.absences),
    costs: costsTraffic(costs)
  }
}
