import { getProductionAreaName, normalizeProductionArea, recordWasteForCancelledItem, reverseInventoryConsumption } from "./posProduction.js"

export const PRODUCTION_TICKETS_KEY = "productionTickets"
const ORDERS_KEY = "posOrdenes"
const NOTIFICATIONS_KEY = "notifications"

const DEFAULT_MINUTES = {
  pizzeria: 15,
  cocina: 18,
  barra: 8,
  cafeteria: 7,
  reposteria: 10,
  panaderia: 12
}

export const KDS_MANAGEMENT_ROLES = ["admin", "gerente", "gerente_general", "supervisor", "gerente_operaciones"]
export const KDS_AREA_MANAGER_ROLES = ["encargado_area"]
export const KDS_OPERATIONAL_ROLES = ["barista", "bartender", "cocinero", "cocina", "pizzero", "repostero", "panadero"]

function parseArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function normalizedRole(user) {
  return String(user?.role || "").trim().toLowerCase()
}

function resolveCurrentArea(user) {
  if (user?.areaId) return normalizeProductionArea(user.areaId)
  if (user?.id) {
    const managed = parseArray("users").find((entry) => String(entry.id) === String(user.id))
    if (managed?.areaId || managed?.departamento) return normalizeProductionArea(managed.areaId || managed.departamento)
  }
  return {
    barista: "cafeteria",
    bartender: "barra",
    cocinero: "cocina",
    cocina: "cocina",
    pizzero: "pizzeria",
    repostero: "reposteria",
    panadero: "panaderia"
  }[normalizedRole(user)] || ""
}

export function canSelectKDSArea(user) {
  return KDS_MANAGEMENT_ROLES.includes(normalizedRole(user))
}

export function canAccessKDS(user) {
  return canSelectKDSArea(user) || KDS_AREA_MANAGER_ROLES.includes(normalizedRole(user)) || KDS_OPERATIONAL_ROLES.includes(normalizedRole(user))
}

export function getDefaultKDSArea(currentUser, areas) {
  const assigned = resolveCurrentArea(currentUser)
  if (assigned && areas.some((area) => area.id === assigned)) return assigned
  if (canSelectKDSArea(currentUser)) return areas[0]?.id || ""
  return ""
}

function normalizeTicketItem(item) {
  return {
    ...item,
    id: item.id || item.lineId || item.orderItemId,
    orderItemId: item.orderItemId || item.lineId || item.id,
    productId: item.productId || item.id,
    productName: item.productName || item.nombre || "Producto",
    quantity: Number(item.quantity ?? item.cantidad ?? 1),
    notes: item.notes || item.modificaciones || "",
    modifiers: Array.isArray(item.modifiers) ? item.modifiers : item.modificaciones ? [item.modificaciones] : [],
    status: item.status === "sent_to_production" ? "pending" : item.status || "pending"
  }
}

export function normalizeProductionTicket(ticket) {
  const areaId = normalizeProductionArea(ticket.areaId)
  return {
    ...ticket,
    tableName: ticket.tableName || (ticket.tableId ? `Mesa ${ticket.tableId}` : "Orden"),
    areaId,
    areaName: ticket.areaName || getProductionAreaName(areaId),
    waiterId: ticket.waiterId || "",
    waiterName: ticket.waiterName || "POS",
    status: ticket.status || "pending",
    priority: ticket.priority || "normal",
    items: (ticket.items || []).map(normalizeTicketItem),
    createdAt: ticket.createdAt || new Date().toISOString(),
    estimatedMinutes: Number(ticket.estimatedMinutes) || DEFAULT_MINUTES[areaId] || 15,
    problemReason: ticket.problemReason || "",
    assignedTo: ticket.assignedTo || ""
  }
}

function createMockTickets() {
  const now = Date.now()
  return [
    ["mock-pizza", "pizzeria", "Pizzería", "Mesa 4", "Pizza Pepperoni", 1, 5],
    ["mock-barra", "barra", "Barra", "Mesa 8", "Mojito", 2, 3],
    ["mock-cafe", "cafeteria", "Cafetería", "Mesa 2", "Latte", 1, 2]
  ].map(([id, areaId, areaName, tableName, productName, quantity, minutes]) => ({
    id,
    orderId: "",
    tableId: "",
    tableName,
    areaId,
    areaName,
    waiterId: "mesero",
    waiterName: "Mesero",
    status: "pending",
    priority: "normal",
    items: [{ id: `${id}-item`, orderItemId: "", productName, quantity, notes: "", modifiers: [], status: "pending" }],
    createdAt: new Date(now - (minutes * 60000)).toISOString(),
    estimatedMinutes: DEFAULT_MINUTES[areaId],
    isDemo: true
  }))
}

export function loadProductionTickets() {
  const stored = parseArray(PRODUCTION_TICKETS_KEY)
  if (stored.length) return stored.map(normalizeProductionTicket)
  const mocks = createMockTickets()
  localStorage.setItem(PRODUCTION_TICKETS_KEY, JSON.stringify(mocks))
  return mocks.map(normalizeProductionTicket)
}

export function saveProductionTickets(tickets) {
  localStorage.setItem(PRODUCTION_TICKETS_KEY, JSON.stringify(tickets))
  window.dispatchEvent(new Event("production-tickets-updated"))
}

export function getTicketElapsedMinutes(ticket, now = Date.now()) {
  return Math.max(0, Math.floor((now - new Date(ticket.createdAt).getTime()) / 60000))
}

export function getTicketTimeStatus(ticket, now = Date.now()) {
  if (["served", "cancelled"].includes(ticket.status)) return "normal"
  const elapsed = getTicketElapsedMinutes(ticket, now)
  const estimated = Number(ticket.estimatedMinutes) || DEFAULT_MINUTES[ticket.areaId] || 15
  if (elapsed >= estimated) return "late"
  if (elapsed >= Math.ceil(estimated * 0.7)) return "warning"
  return "normal"
}

function addNotification(userId, type, title, message, relatedTicketId) {
  if (!userId) return
  const notifications = parseArray(NOTIFICATIONS_KEY)
  notifications.unshift({
    id: makeId("notification"),
    userId,
    type,
    title,
    message,
    relatedTaskId: relatedTicketId,
    relatedTicketId,
    read: false,
    createdAt: new Date().toISOString()
  })
  localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications))
  window.dispatchEvent(new Event("task-notifications-updated"))
}

function notifyManagers(type, title, message, ticketId) {
  const managerIds = new Set(["admin", "gerente", "supervisor"])
  parseArray("users")
    .filter((user) => ["Administrador", "Gerente General", "Supervisor"].includes(user.rol))
    .forEach((user) => managerIds.add(user.id || user.username))
  managerIds.forEach((id) => addNotification(id, type, title, message, ticketId))
}

export function requestKDSAreaAssignment(user) {
  notifyManagers(
    "kds_area_assignment_request",
    "Área de producción requerida",
    `${user?.name || user?.username || "Un colaborador"} solicita asignación de área para acceder a Producción.`,
    ""
  )
}

function resolveWaiterId(ticket) {
  const managedWaiter = parseArray("users").find((user) => String(user.username || user.auth?.username) === String(ticket.waiterId))
  return managedWaiter?.id || ticket.waiterId
}

function orderItemStatus(status) {
  return {
    pending: "sent_to_production",
    in_production: "in_production",
    ready: "prepared",
    served: "served",
    cancelled: "cancelled",
    problem: "problem"
  }[status] || status
}

function synchronizeOrderItems(ticket, status) {
  if (!ticket.orderId) return
  const itemIds = new Set(ticket.items.map((item) => String(item.orderItemId || item.id)))
  const orders = parseArray(ORDERS_KEY).map((order) => {
    if (String(order.id) !== String(ticket.orderId)) return order
    const items = (order.items || []).map((item) => itemIds.has(String(item.lineId || item.id)) ? { ...item, status: orderItemStatus(status) } : item)
    const orderStatus = status === "served" && items.every((item) => ["served", "cancelled"].includes(item.status)) ? "served" : order.status
    return { ...order, items, status: orderStatus, estado: orderStatus === "served" ? "entregada" : order.estado }
  })
  localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
}

export function updateProductionTicketStatus(ticketId, status, actor, details = {}) {
  let changedTicket = null
  const now = new Date().toISOString()
  const tickets = loadProductionTickets().map((ticket) => {
    if (String(ticket.id) !== String(ticketId)) return ticket
    changedTicket = {
      ...ticket,
      status,
      items: ticket.items.map((item) => ({ ...item, status })),
      startedAt: status === "in_production" ? ticket.startedAt || now : ticket.startedAt,
      readyAt: status === "ready" ? now : ticket.readyAt,
      servedAt: status === "served" ? now : ticket.servedAt,
      completedAt: status === "served" ? now : ticket.completedAt,
      problemReason: status === "problem" ? details.problemReason : ticket.problemReason,
      problemReportedBy: status === "problem" ? actor?.name || actor?.username : ticket.problemReportedBy,
      cancellationReason: status === "cancelled" ? details.reason || ticket.cancellationReason : ticket.cancellationReason,
      cancelledBy: status === "cancelled" ? actor?.name || actor?.username : ticket.cancelledBy,
      updatedAt: now
    }
    return changedTicket
  })
  if (!changedTicket) return { ok: false, tickets }
  saveProductionTickets(tickets)
  synchronizeOrderItems(changedTicket, status)
  if (status === "ready") {
    addNotification(resolveWaiterId(changedTicket), "kds_ready", "Productos listos", `${changedTicket.tableName}: productos listos en ${changedTicket.areaName}.`, changedTicket.id)
  }
  if (status === "problem") {
    notifyManagers("kds_problem", "Problema en producción", `Problema en ticket ${changedTicket.tableName} - ${changedTicket.areaName}.`, changedTicket.id)
  }
  return { ok: true, tickets, ticket: changedTicket }
}

export function requestTicketCancellation(ticketId, reason, actor) {
  const tickets = loadProductionTickets().map((ticket) => String(ticket.id) !== String(ticketId) ? ticket : ({
    ...ticket,
    cancellationRequested: true,
    cancellationReason: reason,
    cancellationRequestedBy: actor?.name || actor?.username,
    cancellationRequestedAt: new Date().toISOString()
  }))
  saveProductionTickets(tickets)
  const ticket = tickets.find((entry) => String(entry.id) === String(ticketId))
  notifyManagers("kds_cancellation_request", "Cancelación solicitada", `${ticket?.tableName || "Ticket"} - ${ticket?.areaName || "Producción"} solicita cancelación.`, ticketId)
  return tickets
}

export function cancelProductionTicket(ticketId, reason, actor) {
  const ticket = loadProductionTickets().find((entry) => String(entry.id) === String(ticketId))
  if (!ticket) return { ok: false, tickets: loadProductionTickets() }
  if (ticket.orderId) {
    ticket.items.filter((item) => item.orderItemId).forEach((item) => {
      if (ticket.status === "pending") {
        reverseInventoryConsumption(ticket.orderId, item.orderItemId, reason, actor?.username || actor?.name)
      } else {
        recordWasteForCancelledItem(ticket.orderId, item.orderItemId, reason, actor?.username || actor?.name)
      }
    })
  }
  return updateProductionTicketStatus(ticketId, "cancelled", actor, { reason })
}
