export const PRE_BILLS_KEY = "preBills"
export const PAYMENTS_KEY = "payments"
export const SPLIT_BILLS_KEY = "splitBills"
export const CASH_SESSIONS_KEY = "cashSessions"
export const CASH_MOVEMENTS_KEY = "cashMovements"
export const TIP_RECORDS_KEY = "tipRecords"
export const FINANCIAL_AUDIT_KEY = "financialAuditLog"
export const AUTHORIZATION_REQUESTS_KEY = "authorizationRequests"

const ORDERS_KEY = "posOrdenes"
const LAYOUT_KEY = "posLayout"
const LEGACY_LAYOUT_KEY = "posRestaurantAreas"
const NOTIFICATIONS_KEY = "notifications"

export const PAYMENT_METHODS = [
  { id: "cash", label: "Efectivo" },
  { id: "card", label: "Tarjeta" },
  { id: "transfer", label: "Transferencia" },
  { id: "qr", label: "QR" },
  { id: "gift_card", label: "Gift card" },
  { id: "accounts_receivable", label: "Cuenta por cobrar" },
  { id: "courtesy", label: "Cortesía autorizada" }
]

export const CASHIER_ROLES = ["admin", "gerente", "gerente_general", "supervisor", "cajero", "caja"]
export const FINANCE_AUTHORIZER_ROLES = ["admin", "gerente", "gerente_general", "supervisor"]

function parseArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function saveArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function money(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100
}

function actorId(user) {
  return user?.id || user?.username || "sistema"
}

function actorName(user) {
  return user?.name || user?.username || "Sistema"
}

function emit() {
  window.dispatchEvent(new Event("cashier-updated"))
}

export function canAccessCashier(user) {
  return CASHIER_ROLES.includes(String(user?.role || "").toLowerCase())
}

export function canAuthorizeFinance(user) {
  return FINANCE_AUTHORIZER_ROLES.includes(String(user?.role || "").toLowerCase())
}

export function loadOrders() {
  return parseArray(ORDERS_KEY)
}

export function loadPreBills() {
  return parseArray(PRE_BILLS_KEY)
}

export function loadPayments() {
  return parseArray(PAYMENTS_KEY)
}

export function loadSplitBills() {
  return parseArray(SPLIT_BILLS_KEY)
}

export function loadCashSessions() {
  return parseArray(CASH_SESSIONS_KEY)
}

export function loadCashMovements() {
  return parseArray(CASH_MOVEMENTS_KEY)
}

export function loadTipRecords() {
  return parseArray(TIP_RECORDS_KEY)
}

export function loadFinancialAudit() {
  return parseArray(FINANCIAL_AUDIT_KEY)
}

export function loadAuthorizationRequests() {
  return parseArray(AUTHORIZATION_REQUESTS_KEY)
}

function audit(action, entityType, entityId, before, after, user, reason = "", authorizedBy = "") {
  const logs = loadFinancialAudit()
  logs.unshift({
    id: id("audit"),
    action,
    entityType,
    entityId,
    before,
    after,
    performedBy: actorName(user),
    authorizedBy,
    reason,
    createdAt: new Date().toISOString()
  })
  saveArray(FINANCIAL_AUDIT_KEY, logs)
}

function addNotification(userId, type, title, message, relatedId) {
  if (!userId) return
  const notifications = parseArray(NOTIFICATIONS_KEY)
  notifications.unshift({
    id: id("notification"),
    userId,
    type,
    title,
    message,
    relatedTaskId: relatedId,
    read: false,
    createdAt: new Date().toISOString()
  })
  saveArray(NOTIFICATIONS_KEY, notifications)
  window.dispatchEvent(new Event("task-notifications-updated"))
  window.dispatchEvent(new Event("notifications-updated"))
}

function notifyCashiers(preBill) {
  const ids = new Set(["cajero", "caja", "admin", "gerente", "supervisor"])
  parseArray("users")
    .filter((user) => ["Cajero", "Caja", "Administrador", "Gerente General", "Supervisor"].includes(user.rol))
    .forEach((user) => ids.add(user.id || user.username))
  const title = preBill.salesChannel === "delivery" ? "Nuevo delivery por cobrar" : "Nueva solicitud de cobro"
  const message = preBill.salesChannel === "delivery"
    ? `${preBill.delivery?.customerName || preBill.tableName} · ${preBill.delivery?.paymentMethod || "Pago pendiente"} · Q${Number(preBill.total || 0).toFixed(2)}`
    : `${preBill.tableName} lista para cobro.`
  ids.forEach((userId) => addNotification(userId, "payment_request", title, message, preBill.id))
}

function notifyManagers(type, title, message, relatedId) {
  const ids = new Set(["admin", "gerente", "supervisor"])
  parseArray("users")
    .filter((user) => ["Administrador", "Gerente General", "Supervisor"].includes(user.rol))
    .forEach((user) => ids.add(user.id || user.username))
  ids.forEach((userId) => addNotification(userId, type, title, message, relatedId))
}

function updateOrder(orderId, updater) {
  let changed
  const orders = loadOrders().map((order) => {
    if (String(order.id) !== String(orderId)) return order
    changed = updater(order)
    return changed
  })
  saveArray(ORDERS_KEY, orders)
  return changed
}

function nonCancelledItems(order) {
  return (order?.items || []).filter((item) => item.status !== "cancelled")
}

function tableName(order) {
  return order?.mesa ? `Mesa ${order.mesa}` : order?.tipoOrden || "Orden"
}

export function getOrderPreBill(orderId) {
  return loadPreBills().find((preBill) => String(preBill.orderId) === String(orderId) && preBill.status !== "cancelled")
}

export function createPreBill(orderId, waiter) {
  const order = loadOrders().find((item) => String(item.id) === String(orderId))
  if (!order) return { ok: false, message: "Orden no encontrada." }
  if (order.status === "paid" || order.estado === "pagada") return { ok: false, message: "Esta mesa ya fue pagada." }
  const existing = getOrderPreBill(orderId)
  if (existing) return { ok: true, preBill: existing, existing: true }
  const items = nonCancelledItems(order)
  const subtotal = money(items.reduce((total, item) => total + (Number(item.precio) * Number(item.cantidad)), 0))
  const preBill = {
    id: id("prebill"),
    orderId: order.id,
    tableId: order.mesaId,
    tableName: tableName(order),
    waiterId: order.usuario || actorId(waiter),
    waiterName: order.usuarioNombre || actorName(waiter),
    items,
    subtotal,
    discounts: 0,
    taxes: 0,
    tipSuggested: money(subtotal * 0.1),
    total: subtotal,
    status: "draft",
    createdAt: new Date().toISOString(),
    printedAt: "",
    sentAt: ""
  }
  saveArray(PRE_BILLS_KEY, [preBill, ...loadPreBills()])
  const nextOrder = updateOrder(order.id, (current) => ({ ...current, status: "awaiting_bill", estado: "esperando cuenta", preBillId: preBill.id }))
  audit("create_prebill", "preBill", preBill.id, order, nextOrder, waiter)
  emit()
  return { ok: true, preBill }
}

function normalizePOSOrderForCashier(order, waiter) {
  const items = nonCancelledItems(order).map((item) => ({
    ...item,
    lineId: item.lineId || item.id,
    id: item.productId || item.product_id || item.id,
    nombre: item.nombre || item.productName || item.product_name,
    cantidad: Number(item.cantidad ?? item.quantity ?? 0),
    precio: Number(item.precio ?? item.unitPrice ?? item.unit_price ?? 0),
    status: item.status || "served"
  }))
  const subtotal = money(Number(order?.subtotal ?? order?.total ?? items.reduce((sum, item) => sum + item.precio * item.cantidad, 0)))
  return {
    id: order.id,
    areaId: order.areaId || order.area_id,
    mesaId: order.mesaId || order.tableId || order.table_id,
    mesa: order.mesa || order.tableName || order.table_name,
    tableName: order.tableName || order.table_name || tableName(order),
    usuario: order.waiterId || order.waiter_id || actorId(waiter),
    usuarioNombre: order.usuarioNombre || order.waiterName || order.waiter_name || actorName(waiter),
    status: order.status || "awaiting_bill",
    estado: order.estado || "esperando cuenta",
    subtotal,
    total: money(order.total ?? subtotal),
    items,
    salesChannel: order.salesChannel || order.sales_channel || "dine_in",
    delivery: order.delivery || null,
    deliveryNotes: order.deliveryNotes || order.delivery_notes || "",
    source: "supabase_pos",
    createdAt: order.created_at || order.createdAt || new Date().toISOString()
  }
}

export function createPreBillFromPOSOrder(order, waiter, options = {}) {
  if (!order?.id) return { ok: false, message: "Orden POS no encontrada." }
  const normalizedOrder = normalizePOSOrderForCashier(order, waiter)
  const existing = getOrderPreBill(normalizedOrder.id)
  const items = nonCancelledItems(normalizedOrder)
  const subtotal = money(items.reduce((total, item) => total + Number(item.precio) * Number(item.cantidad), 0))
  const base = {
    orderId: normalizedOrder.id,
    tableId: normalizedOrder.mesaId,
    tableName: normalizedOrder.tableName,
    waiterId: normalizedOrder.usuario,
    waiterName: normalizedOrder.usuarioNombre,
    items,
    subtotal,
    discounts: 0,
    taxes: 0,
    tipSuggested: money(subtotal * 0.1),
    total: subtotal,
    peopleCount: options.peopleCount || "",
    salesChannel: normalizedOrder.salesChannel,
    delivery: normalizedOrder.delivery,
    deliveryNotes: normalizedOrder.deliveryNotes,
    source: "supabase_pos"
  }
  const preBill = existing
    ? { ...existing, ...base, status: existing.status === "paid" ? existing.status : existing.status || "draft" }
    : { id: id("prebill"), ...base, status: "draft", createdAt: new Date().toISOString(), printedAt: "", sentAt: "" }
  saveArray(PRE_BILLS_KEY, [preBill, ...loadPreBills().filter((bill) => bill.id !== preBill.id)])
  const storedOrder = { ...normalizedOrder, status: preBill.status === "sent_to_cashier" ? "sent_to_cashier" : "awaiting_bill", estado: preBill.status === "sent_to_cashier" ? "en caja" : "esperando cuenta", preBillId: preBill.id }
  saveArray(ORDERS_KEY, [storedOrder, ...loadOrders().filter((item) => String(item.id) !== String(storedOrder.id))])
  audit(existing ? "sync_prebill" : "create_prebill", "preBill", preBill.id, existing || null, preBill, waiter)
  emit()
  return { ok: true, preBill, order: storedOrder, existing: Boolean(existing) }
}

export function printPreBill(preBillId, user) {
  let changed
  const bills = loadPreBills().map((preBill) => {
    if (String(preBill.id) !== String(preBillId)) return preBill
    changed = { ...preBill, status: preBill.status === "draft" ? "printed" : preBill.status, printedAt: new Date().toISOString() }
    return changed
  })
  saveArray(PRE_BILLS_KEY, bills)
  if (changed) audit("print_prebill", "preBill", changed.id, null, changed, user)
  emit()
  return changed
}

export function sendPreBillToCashier(preBillId, user) {
  let changed
  const bills = loadPreBills().map((preBill) => {
    if (String(preBill.id) !== String(preBillId)) return preBill
    changed = { ...preBill, status: "sent_to_cashier", sentAt: new Date().toISOString() }
    return changed
  })
  if (!changed) return { ok: false, message: "Precuenta no encontrada." }
  saveArray(PRE_BILLS_KEY, bills)
  const order = updateOrder(changed.orderId, (current) => ({ ...current, status: "sent_to_cashier", estado: "en caja" }))
  notifyCashiers(changed)
  audit("send_to_cashier", "preBill", changed.id, null, changed, user)
  emit()
  return { ok: true, preBill: changed, order }
}

export function beginPayment(preBillId, user) {
  const preBill = loadPreBills().find((bill) => String(bill.id) === String(preBillId))
  if (!preBill || preBill.status === "paid") return { ok: false, message: "Precuenta no disponible." }
  const order = updateOrder(preBill.orderId, (current) => ({ ...current, status: "payment_in_progress", estado: "pago en proceso" }))
  audit("begin_payment", "preBill", preBill.id, null, order, user)
  emit()
  return { ok: true, order }
}

export function registerSplitPaymentLocal({ preBillId, amount, methods, user, orderFullyPaid, paidByLabel = "", paymentNumber = null }) {
  const session = getOpenCashSession(user)
  if (!session) return { ok: false, message: "Debes abrir caja antes de cobrar." }
  const preBill = loadPreBills().find((bill) => String(bill.id) === String(preBillId))
  if (!preBill) return { ok: false, message: "Precuenta no encontrada." }

  const normalizedMethods = methods.filter((method) => Number(method.amount) > 0).map((method) => ({ ...method, amount: money(method.amount) }))
  const totalAmount = money(amount)
  const paidAmount = money(normalizedMethods.reduce((sum, method) => sum + method.amount, 0))
  if (!normalizedMethods.length || paidAmount < totalAmount) {
    return { ok: false, message: "El pago local esta incompleto." }
  }

  const excess = money(paidAmount - totalAmount)
  const cashPaid = money(normalizedMethods.filter((method) => method.method === "cash").reduce((sum, method) => sum + method.amount, 0))
  if (excess > 0 && cashPaid < excess) return { ok: false, message: "Solo el pago en efectivo puede generar vuelto." }

  const payment = {
    id: id("payment"),
    cashSessionId: session.id,
    orderId: preBill.orderId,
    tableId: preBill.tableId,
    cashierId: actorId(user),
    cashierName: actorName(user),
    waiterId: preBill.waiterId,
    waiterName: preBill.waiterName,
    totalAmount,
    paidAmount,
    changeGiven: excess,
    methods: normalizedMethods,
    tipAmount: 0,
    discountAmount: 0,
    splitId: "",
    splitPayment: true,
    paidByLabel,
    paymentNumber,
    status: "completed",
    createdAt: new Date().toISOString()
  }
  saveArray(PAYMENTS_KEY, [payment, ...loadPayments()])

  const saleMovements = normalizedMethods.map((method) => ({
    id: id("movement"),
    cashSessionId: session.id,
    type: "sale",
    amount: money(method.amount - (method.method === "cash" ? excess : 0)),
    method: method.method,
    reason: paidByLabel ? `Subcuenta ${preBill.tableName} · ${paidByLabel}` : `Subcuenta ${preBill.tableName}`,
    relatedOrderId: preBill.orderId,
    createdBy: actorName(user),
    createdAt: new Date().toISOString()
  }))
  saveArray(CASH_MOVEMENTS_KEY, [...saleMovements, ...loadCashMovements()])

  if (orderFullyPaid) {
    saveArray(PRE_BILLS_KEY, loadPreBills().map((bill) => bill.id === preBill.id ? { ...bill, status: "paid", paidAt: new Date().toISOString(), balanceDue: 0 } : bill))
    const order = updateOrder(preBill.orderId, (current) => ({
      ...current,
      status: "paid",
      estado: "pagada",
      paymentId: payment.id,
      pagadaEn: new Date().toISOString(),
      items: (current.items || []).map((item) => item.status === "cancelled" ? item : ({ ...item, status: "paid" }))
    }))
    if (order) releaseTable(order)
    addNotification(preBill.waiterId, "table_paid", "Mesa pagada", `${preBill.tableName} pagada.`, payment.id)
  } else {
    const balanceDue = money(Math.max(0, Number(preBill.total || 0) - loadPayments().filter((entry) => entry.orderId === preBill.orderId && entry.status === "completed").reduce((sum, entry) => sum + entry.totalAmount, 0)))
    saveArray(PRE_BILLS_KEY, loadPreBills().map((bill) => bill.id === preBill.id ? { ...bill, status: "partially_paid", balanceDue } : bill))
    updateOrder(preBill.orderId, (current) => ({ ...current, status: "partially_paid", estado: "pago parcial" }))
  }

  audit("split_payment", "payment", payment.id, null, payment, user, paidByLabel, "")
  emit()
  return { ok: true, payment, orderFullyPaid }
}

export async function syncSupabaseFullPayment(orderId, methods, paidByLabel = "Cuenta completa") {
  const { getPosOrderPaymentStatus, createPosSplitPayment } = await import("../services/posOrdersService")
  const statusResult = await getPosOrderPaymentStatus(orderId)
  if (statusResult.error) return { ok: false, message: statusResult.message || "No se pudo consultar el saldo de la orden." }

  const remainingItems = (statusResult.data?.items || [])
    .filter((item) => Number(item.quantity_remaining) > 0)
    .map((item) => ({ order_item_id: item.order_item_id, quantity_paid: Number(item.quantity_remaining) }))

  if (!remainingItems.length) {
    return { ok: true, orderFullyPaid: true, balanceDue: 0, data: statusResult.data }
  }

  const productTotal = money((statusResult.data?.items || [])
    .filter((item) => Number(item.quantity_remaining) > 0)
    .reduce((sum, item) => sum + Number(item.line_remaining || 0), 0))

  const paymentMethods = methodsForProductTotal(methods, productTotal)
  if (!paymentMethods.length) {
    return { ok: false, message: "Indica el monto del pago para los productos pendientes." }
  }

  const result = await createPosSplitPayment({ orderId, items: remainingItems, methods: paymentMethods, paidByLabel })
  if (result.error) return { ok: false, message: result.message || "No se pudo registrar el pago en Supabase." }

  return {
    ok: true,
    orderFullyPaid: money(result.data?.balance_due ?? 0) <= 0,
    balanceDue: money(result.data?.balance_due ?? 0),
    data: result.data
  }
}

function methodsForProductTotal(methods, productTotal) {
  const active = methods.filter((method) => Number(method.amount) > 0)
  const totalPaid = money(active.reduce((sum, method) => sum + Number(method.amount), 0))
  if (!active.length || productTotal <= 0) return []
  if (totalPaid <= productTotal) {
    return active.map((method) => ({ method: method.method, amount: money(method.amount), reference: method.reference || null }))
  }
  let remaining = productTotal
  return active.map((method, index) => {
    if (index === active.length - 1) {
      return { method: method.method, amount: remaining, reference: method.reference || null }
    }
    const share = money(productTotal * (Number(method.amount) / totalPaid))
    remaining = money(remaining - share)
    return { method: method.method, amount: share, reference: method.reference || null }
  })
}

export function returnPreBillToWaiter(preBillId, reason, user) {
  let changed
  const bills = loadPreBills().map((bill) => {
    if (String(bill.id) !== String(preBillId)) return bill
    changed = { ...bill, status: "draft", returnedAt: new Date().toISOString(), returnReason: reason }
    return changed
  })
  if (!changed) return { ok: false }
  saveArray(PRE_BILLS_KEY, bills)
  updateOrder(changed.orderId, (order) => ({ ...order, status: "awaiting_bill", estado: "esperando cuenta" }))
  addNotification(changed.waiterId, "bill_returned", "Cobro devuelto", `${changed.tableName}: revisa la precuenta. ${reason}`, changed.id)
  audit("return_prebill", "preBill", changed.id, null, changed, user, reason)
  emit()
  return { ok: true, preBill: changed }
}

export function markPreBillProblem(preBillId, reason, user) {
  if (!String(reason || "").trim()) return { ok: false, message: "Indica el problema." }
  let changed
  const bills = loadPreBills().map((bill) => {
    if (String(bill.id) !== String(preBillId)) return bill
    changed = { ...bill, problem: true, problemReason: reason.trim(), problemAt: new Date().toISOString() }
    return changed
  })
  if (!changed) return { ok: false, message: "Precuenta no encontrada." }
  saveArray(PRE_BILLS_KEY, bills)
  updateOrder(changed.orderId, (order) => ({ ...order, status: "problem", estado: "problema de cobro" }))
  notifyManagers("cashier_problem", "Problema en cobro", `${changed.tableName}: ${reason.trim()}`, changed.id)
  audit("report_payment_problem", "preBill", changed.id, null, changed, user, reason.trim())
  emit()
  return { ok: true, preBill: changed }
}

export function openCashSession(user, openingAmount) {
  if (getOpenCashSession(user)) return { ok: false, message: "Ya tienes una caja abierta." }
  const amount = money(openingAmount)
  if (amount < 0) return { ok: false, message: "El fondo inicial no es válido." }
  const session = {
    id: id("session"),
    cashierId: actorId(user),
    cashierName: actorName(user),
    openedAt: new Date().toISOString(),
    openingAmount: amount,
    status: "open",
    closedAt: "",
    expectedCash: amount,
    countedCash: "",
    cashCountDetail: null,
    billsSubtotal: null,
    coinsSubtotal: null,
    difference: "",
    notes: ""
  }
  saveArray(CASH_SESSIONS_KEY, [session, ...loadCashSessions()])
  audit("open_cash_session", "cashSession", session.id, null, session, user)
  emit()
  return { ok: true, session }
}

export function getOpenCashSession(user) {
  const sessions = loadCashSessions()
  const canViewAll = canAuthorizeFinance(user)
  return sessions.find((session) => session.status === "open" && (canViewAll || String(session.cashierId) === String(actorId(user)))) || null
}

function movementsForSession(sessionId) {
  return loadCashMovements().filter((movement) => String(movement.cashSessionId) === String(sessionId))
}

export function getCashSummary(session) {
  if (!session) return { sales: 0, cashSales: 0, cardSales: 0, transferSales: 0, qrSales: 0, tips: 0, discounts: 0, refunds: 0, manual: 0, expectedCash: 0 }
  const movements = movementsForSession(session.id)
  const sum = (items) => money(items.reduce((total, movement) => total + Number(movement.amount || 0), 0))
  const sales = movements.filter((item) => item.type === "sale")
  const refunds = sum(movements.filter((item) => item.type === "refund"))
  const cashRefunds = sum(movements.filter((item) => item.type === "refund" && item.method === "cash"))
  const cashSales = sum(sales.filter((item) => item.method === "cash"))
  const cashInputs = sum(movements.filter((item) => ["cash_in", "adjustment"].includes(item.type) && item.method === "cash"))
  const cashOutputs = sum(movements.filter((item) => ["cash_out", "expense", "tip_withdrawal"].includes(item.type) && item.method === "cash"))
  const tips = sum(loadTipRecords().filter((tip) => String(tip.cashSessionId) === String(session.id)))
  return {
    sales: money(sum(sales) - tips),
    cashSales,
    cardSales: sum(sales.filter((item) => item.method === "card")),
    transferSales: sum(sales.filter((item) => item.method === "transfer")),
    qrSales: sum(sales.filter((item) => item.method === "qr")),
    tips,
    discounts: sum(loadPayments().filter((payment) => String(payment.cashSessionId) === String(session.id)).map((payment) => ({ amount: payment.discountAmount }))),
    refunds,
    manual: money(cashInputs - cashOutputs),
    expectedCash: money(Number(session.openingAmount) + cashSales + cashInputs - cashOutputs - cashRefunds)
  }
}

export function registerCashMovement(sessionId, movement, user) {
  const session = loadCashSessions().find((entry) => String(entry.id) === String(sessionId) && entry.status === "open")
  if (!session) return { ok: false, message: "Debes abrir caja antes de registrar movimientos." }
  const amount = money(movement.amount)
  if (amount <= 0 || !movement.reason?.trim()) return { ok: false, message: "Ingresa monto y motivo del movimiento." }
  if (movement.type === "adjustment" && !canAuthorizeFinance(user) && !movement.authorizedBy) {
    return { ok: false, requiresAuthorization: true, message: "Todo ajuste requiere autorización." }
  }
  const created = {
    id: id("movement"),
    cashSessionId: session.id,
    type: movement.type,
    amount,
    method: movement.method || "cash",
    reason: movement.reason.trim(),
    relatedOrderId: movement.relatedOrderId || "",
    authorizedBy: movement.authorizedBy || "",
    createdBy: actorName(user),
    createdAt: new Date().toISOString()
  }
  saveArray(CASH_MOVEMENTS_KEY, [created, ...loadCashMovements()])
  audit("cash_movement", "cashMovement", created.id, null, created, user, created.reason, created.authorizedBy)
  emit()
  return { ok: true, movement: created }
}

export function createAuthorizationRequest(type, reason, value, user) {
  const request = {
    id: id("authorization"),
    type,
    requestedBy: actorName(user),
    requestedById: actorId(user),
    approvedBy: "",
    status: "pending",
    reason,
    value: money(value),
    createdAt: new Date().toISOString(),
    approvedAt: ""
  }
  saveArray(AUTHORIZATION_REQUESTS_KEY, [request, ...loadAuthorizationRequests()])
  notifyManagers("financial_authorization", "Autorización financiera solicitada", `${request.requestedBy} solicita autorización: ${type}.`, request.id)
  audit("request_authorization", "authorizationRequest", request.id, null, request, user, reason)
  emit()
  return request
}

export function approveAuthorization(requestId, user) {
  if (!canAuthorizeFinance(user)) return { ok: false, message: "No tienes permiso para autorizar." }
  let approved
  const updated = loadAuthorizationRequests().map((request) => {
    if (String(request.id) !== String(requestId)) return request
    approved = { ...request, status: "approved", approvedBy: actorName(user), approvedAt: new Date().toISOString() }
    return approved
  })
  saveArray(AUTHORIZATION_REQUESTS_KEY, updated)
  if (approved) audit("approve_authorization", "authorizationRequest", approved.id, null, approved, user)
  emit()
  return { ok: Boolean(approved), request: approved }
}

export function createSplitBill(preBillId, mode, configuration, user) {
  const preBill = loadPreBills().find((bill) => String(bill.id) === String(preBillId))
  if (!preBill) return { ok: false, message: "Precuenta no encontrada." }
  let splits
  if (mode === "equal") {
    const count = Math.max(2, Number(configuration.count) || 2)
    const base = money(preBill.total / count)
    splits = Array.from({ length: count }, (_, index) => ({
      id: id("split-part"),
      name: `Persona ${index + 1}`,
      items: [],
      subtotal: index === count - 1 ? money(preBill.total - (base * (count - 1))) : base,
      tip: 0,
      total: index === count - 1 ? money(preBill.total - (base * (count - 1))) : base,
      paid: false,
      paymentId: ""
    }))
  } else if (mode === "products") {
    splits = preBill.items.map((item, index) => ({
      id: id("split-part"),
      name: `Persona ${index + 1}`,
      items: [item],
      subtotal: money(item.precio * item.cantidad),
      tip: 0,
      total: money(item.precio * item.cantidad),
      paid: false,
      paymentId: ""
    }))
  } else {
    const amounts = (configuration.amounts || []).map(Number).filter((amount) => amount > 0)
    if (!amounts.length || money(amounts.reduce((sum, amount) => sum + amount, 0)) !== money(preBill.total)) {
      return { ok: false, message: "Los montos personalizados deben sumar el total de la precuenta." }
    }
    splits = amounts.map((amount, index) => ({ id: id("split-part"), name: `Persona ${index + 1}`, items: [], subtotal: money(amount), tip: 0, total: money(amount), paid: false, paymentId: "" }))
  }
  const splitBill = { id: id("split"), orderId: preBill.orderId, preBillId, mode, splits, createdAt: new Date().toISOString() }
  saveArray(SPLIT_BILLS_KEY, [splitBill, ...loadSplitBills().filter((item) => String(item.preBillId) !== String(preBillId))])
  audit("split_bill", "splitBill", splitBill.id, null, splitBill, user)
  emit()
  return { ok: true, splitBill }
}

function releaseTable(order) {
  function updateAreas(areas) {
    return areas.map((area) => String(area.id) !== String(order.areaId) ? area : ({
      ...area,
      mesas: (area.mesas || []).map((table) => String(table.id) !== String(order.mesaId) ? table : ({ ...table, estado: "disponible", status: "disponible" }))
    }))
  }
  try {
    const layout = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null")
    if (layout?.areas) {
      const tables = Array.isArray(layout.tables)
        ? layout.tables.map((table) => String(table.areaId) === String(order.areaId) && String(table.id) === String(order.mesaId) ? { ...table, estado: "disponible", status: "disponible" } : table)
        : layout.tables
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...layout, areas: updateAreas(layout.areas), tables }))
    }
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LAYOUT_KEY) || "[]")
    if (Array.isArray(legacy)) localStorage.setItem(LEGACY_LAYOUT_KEY, JSON.stringify(updateAreas(legacy)))
  } catch {
    // Orders remain paid even if an old malformed floor-plan payload cannot be repaired.
  }
}

export function confirmPayment(data, user) {
  const session = getOpenCashSession(user)
  if (!session) return { ok: false, message: "Debes abrir caja antes de cobrar." }
  const preBill = loadPreBills().find((bill) => String(bill.id) === String(data.preBillId))
  if (!preBill || preBill.status === "paid") return { ok: false, message: "La precuenta no está disponible para cobro." }
  const order = loadOrders().find((entry) => String(entry.id) === String(preBill.orderId))
  const legacyReady = ["preparada", "entregada"].includes(order?.estado)
  const unfinished = order?.source === "supabase_pos" ? false : (order?.items || []).some((item) => !["prepared", "served", "paid", "cancelled"].includes(item.status) && !legacyReady)
  if (unfinished) return { ok: false, message: "No puedes cobrar: hay productos que aún no están preparados o servidos." }
  const splitBill = loadSplitBills().find((split) => String(split.preBillId) === String(preBill.id))
  const splitPart = data.splitId ? splitBill?.splits.find((split) => String(split.id) === String(data.splitId)) : null
  const subtotal = money(data.productSubtotalOverride ?? splitPart?.subtotal ?? preBill.subtotal)
  const discount = money(data.discountAmount)
  const approvedRequest = data.authorizationId
    ? loadAuthorizationRequests().find((request) => request.id === data.authorizationId && request.status === "approved" && !request.usedAt)
    : null
  if (discount > subtotal * 0.1 && !approvedRequest && !canAuthorizeFinance(user)) {
    return { ok: false, requiresAuthorization: true, message: "Un descuento mayor al 10% requiere autorización." }
  }
  if (data.methods.some((method) => method.method === "courtesy") && !approvedRequest && !canAuthorizeFinance(user)) {
    return { ok: false, requiresAuthorization: true, message: "Toda cortesía requiere autorización." }
  }
  const tipAmount = money(data.tipAmount)
  const totalAmount = money(subtotal - discount + tipAmount)
  const methods = data.methods.filter((method) => Number(method.amount) > 0).map((method) => ({ ...method, amount: money(method.amount) }))
  const paidAmount = money(methods.reduce((total, method) => total + method.amount, 0))
  if (!methods.length || paidAmount < totalAmount) return { ok: false, message: "El pago está incompleto." }
  const cashPaid = money(methods.filter((method) => method.method === "cash").reduce((total, method) => total + method.amount, 0))
  const excess = money(paidAmount - totalAmount)
  if (excess > 0 && cashPaid < excess) return { ok: false, message: "Solo el pago en efectivo puede generar vuelto." }
  const payment = {
    id: id("payment"),
    cashSessionId: session.id,
    orderId: preBill.orderId,
    tableId: preBill.tableId,
    cashierId: actorId(user),
    cashierName: actorName(user),
    waiterId: preBill.waiterId,
    waiterName: preBill.waiterName,
    totalAmount,
    paidAmount,
    changeGiven: excess,
    methods,
    tipAmount,
    discountAmount: discount,
    splitId: splitPart?.id || "",
    status: "completed",
    createdAt: new Date().toISOString()
  }
  saveArray(PAYMENTS_KEY, [payment, ...loadPayments()])
  if (approvedRequest) {
    saveArray(AUTHORIZATION_REQUESTS_KEY, loadAuthorizationRequests().map((request) => request.id === approvedRequest.id ? { ...request, usedAt: new Date().toISOString(), entityId: payment.id } : request))
  }
  const saleMovements = methods.map((method) => ({
    id: id("movement"),
    cashSessionId: session.id,
    type: "sale",
    amount: money(method.amount - (method.method === "cash" ? excess : 0)),
    method: method.method,
    reason: `Cobro ${preBill.tableName}`,
    relatedOrderId: preBill.orderId,
    createdBy: actorName(user),
    createdAt: new Date().toISOString()
  }))
  saveArray(CASH_MOVEMENTS_KEY, [...saleMovements, ...loadCashMovements()])
  if (tipAmount > 0) {
    const tipMethod = methods.find((method) => method.method === "cash")?.method || methods[0]?.method || "cash"
    saveArray(TIP_RECORDS_KEY, [{
      id: id("tip"),
      cashSessionId: session.id,
      orderId: preBill.orderId,
      waiterId: preBill.waiterId,
      cashierId: actorId(user),
      amount: tipAmount,
      method: tipMethod,
      createdAt: new Date().toISOString()
    }, ...loadTipRecords()])
  }
  let allPaid = true
  if (splitPart) {
    const updatedSplits = splitBill.splits.map((part) => part.id === splitPart.id ? { ...part, paid: true, paymentId: payment.id, tip: tipAmount, total: totalAmount } : part)
    allPaid = updatedSplits.every((part) => part.paid)
    saveArray(SPLIT_BILLS_KEY, loadSplitBills().map((split) => split.id === splitBill.id ? { ...split, splits: updatedSplits } : split))
  }
  if (allPaid) {
    saveArray(PRE_BILLS_KEY, loadPreBills().map((bill) => bill.id === preBill.id ? { ...bill, status: "paid", paidAt: new Date().toISOString() } : bill))
    const order = updateOrder(preBill.orderId, (current) => ({
      ...current,
      status: "paid",
      estado: "pagada",
      paymentId: payment.id,
      pagadaEn: new Date().toISOString(),
      items: (current.items || []).map((item) => item.status === "cancelled" ? item : ({ ...item, status: "paid" }))
    }))
    if (order) releaseTable(order)
    addNotification(preBill.waiterId, "table_paid", "Mesa pagada", `${preBill.tableName} pagada.`, payment.id)
  }
  audit("complete_payment", "payment", payment.id, null, payment, user, data.notes || "", data.authorizedBy || "")
  emit()
  return { ok: true, payment, allPaid }
}

export function refundPayment(paymentId, amount, method, reason, user) {
  if (!canAuthorizeFinance(user)) return { ok: false, message: "No tienes autorización para reembolsar." }
  const payments = loadPayments()
  const payment = payments.find((item) => String(item.id) === String(paymentId) && item.status !== "refunded")
  const refundAmount = money(amount)
  if (!payment || refundAmount <= 0 || refundAmount > payment.totalAmount || !String(reason || "").trim()) {
    return { ok: false, message: "Reembolso inválido o sin motivo." }
  }
  const fullRefund = refundAmount === payment.totalAmount
  const refunded = { ...payment, status: fullRefund ? "refunded" : payment.status, refundedAmount: money((payment.refundedAmount || 0) + refundAmount), refundReason: reason.trim() }
  saveArray(PAYMENTS_KEY, payments.map((item) => item.id === payment.id ? refunded : item))
  const movement = {
    id: id("movement"),
    cashSessionId: payment.cashSessionId,
    type: "refund",
    amount: refundAmount,
    method: method || payment.methods[0]?.method || "cash",
    reason: reason.trim(),
    relatedOrderId: payment.orderId,
    authorizedBy: actorName(user),
    createdBy: actorName(user),
    createdAt: new Date().toISOString()
  }
  saveArray(CASH_MOVEMENTS_KEY, [movement, ...loadCashMovements()])
  audit("refund_payment", "payment", payment.id, payment, refunded, user, reason.trim(), actorName(user))
  emit()
  return { ok: true, payment: refunded, movement }
}

export function closeCashSession(sessionId, countedCash, notes, user) {
  const sessions = loadCashSessions()
  const session = sessions.find((item) => String(item.id) === String(sessionId) && item.status === "open")
  if (!session) return { ok: false, message: "Caja abierta no encontrada." }
  if (String(session.cashierId) !== String(actorId(user)) && !canAuthorizeFinance(user)) return { ok: false, message: "No puedes cerrar la caja de otro usuario." }
  const summary = getCashSummary(session)
  const cashCountDetail = typeof countedCash === "object" && countedCash !== null ? countedCash : null
  const counted = money(cashCountDetail?.total ?? countedCash)
  const difference = money(counted - summary.expectedCash)
  if (difference !== 0 && !String(notes || "").trim()) return { ok: false, message: "La diferencia requiere una observación obligatoria." }
  const closed = {
    ...session,
    status: "closed",
    closedAt: new Date().toISOString(),
    expectedCash: summary.expectedCash,
    countedCash: counted,
    cashCountDetail: cashCountDetail?.denominations || null,
    billsSubtotal: cashCountDetail ? money(cashCountDetail.billsSubtotal) : null,
    coinsSubtotal: cashCountDetail ? money(cashCountDetail.coinsSubtotal) : null,
    difference,
    notes: String(notes || "").trim(),
    summary
  }
  saveArray(CASH_SESSIONS_KEY, sessions.map((item) => item.id === session.id ? closed : item))
  if (difference !== 0) notifyManagers("cash_difference", "Diferencia de caja", `${closed.cashierName}: diferencia de Q${difference.toFixed(2)}.`, closed.id)
  audit("close_cash_session", "cashSession", closed.id, session, closed, user, closed.notes)
  emit()
  return { ok: true, session: closed }
}
