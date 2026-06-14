export const PO_WORKFLOW_VIEWS = {
  AUTOMATIC: "automatic",
  MANUAL: "manual",
  TO_SEND: "to_send",
  RECEPTION: "reception",
  HISTORY: "history"
}

const PENDING_APPROVAL_STATUSES = new Set(["borrador", "pendiente", "pendiente_aprobacion"])
const TO_SEND_STATUSES = new Set(["aprobada"])
const RECEPTION_STATUSES = new Set(["enviada_proveedor", "en tránsito", "recibida_parcial", "parcialcompletada"])
const HISTORY_STATUSES = new Set(["recibida_completa", "recibida", "cancelada", "rechazada"])

export function normalizePurchaseOrderStatus(status) {
  return String(status || "").trim().toLowerCase()
}

export function getPurchaseOrderWorkflowView(status) {
  const normalized = normalizePurchaseOrderStatus(status)
  if (PENDING_APPROVAL_STATUSES.has(normalized)) return PO_WORKFLOW_VIEWS.MANUAL
  if (TO_SEND_STATUSES.has(normalized)) return PO_WORKFLOW_VIEWS.TO_SEND
  if (RECEPTION_STATUSES.has(normalized)) return PO_WORKFLOW_VIEWS.RECEPTION
  if (HISTORY_STATUSES.has(normalized)) return PO_WORKFLOW_VIEWS.HISTORY
  return PO_WORKFLOW_VIEWS.HISTORY
}

export function orderMatchesWorkflowView(order, view) {
  return getPurchaseOrderWorkflowView(order?.status) === view
}

export function filterOrdersForWorkflowView(orders, view, { testFlowFilter = "real" } = {}) {
  const scoped = (orders || []).filter((order) => {
    const test = Boolean(order?.is_test ?? order?.isTest)
    if (testFlowFilter === "test") return test
    if (testFlowFilter === "all") return true
    return !test
  })
  if (!view || view === "all") return scoped
  return scoped.filter((order) => orderMatchesWorkflowView(order, view))
}

export function resolvePurchaseOrderViewFromNotification({ notificationType, status } = {}) {
  if (notificationType === "purchase_order_pending") return PO_WORKFLOW_VIEWS.MANUAL
  if (notificationType === "purchase_order_approved") return PO_WORKFLOW_VIEWS.TO_SEND
  if (notificationType === "purchase_order_received" || notificationType === "purchase_order_partially_received") {
    return PO_WORKFLOW_VIEWS.HISTORY
  }
  if (notificationType === "purchase_order_sent" || notificationType === "purchase_order_ready_to_receive") {
    return PO_WORKFLOW_VIEWS.RECEPTION
  }
  return getPurchaseOrderWorkflowView(status)
}

export function buildInventoryUrl(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `/inventory?${query}` : "/inventory"
}

export function buildPurchaseOrderNotificationUrl(orderOrMeta = {}) {
  const status = orderOrMeta.status
  const notificationType = orderOrMeta.notificationType || orderOrMeta.type
  const view = orderOrMeta.view || resolvePurchaseOrderViewFromNotification({ notificationType, status })
  const isTest = Boolean(orderOrMeta.is_test ?? orderOrMeta.isTest)
  return buildInventoryUrl({
    section: "ordenes",
    view,
    order: orderOrMeta.entityId ?? orderOrMeta.id ?? "",
    testFlow: isTest ? "all" : "",
    focus: "1",
    action: orderOrMeta.action || ""
  })
}

export function buildRequisitionNotificationUrl(requisitionOrMeta = {}) {
  const status = requisitionOrMeta.status
  const isTest = Boolean(requisitionOrMeta.is_test ?? requisitionOrMeta.isTest)
  const id = requisitionOrMeta.entityId ?? requisitionOrMeta.id ?? ""
  const tab = status === "pending"
    ? "pending"
    : status === "approved"
      ? "approved"
      : status || "all"
  return buildInventoryUrl({
    section: "requisicion",
    tab,
    id,
    approve: status === "pending" ? id : "",
    testFlow: isTest ? "test" : "",
    focus: "1"
  })
}

export function resolveNotificationTarget(notification) {
  const entityType = notification?.entity_type
  const entityId = notification?.entity_id
  const notificationType = notification?.type

  if (entityType === "purchase_order") {
    return {
      url: notification?.action_url || buildPurchaseOrderNotificationUrl({
        entityId,
        notificationType,
        status: notification?.entity_status
      }),
      entityType
    }
  }

  if (entityType === "requisition") {
    return {
      url: notification?.action_url || buildRequisitionNotificationUrl({
        entityId,
        status: notification?.entity_status,
        is_test: notification?.entity_is_test
      }),
      entityType
    }
  }

  if (notification?.action_url?.startsWith("/")) {
    return { url: notification.action_url, entityType }
  }

  return null
}
