export const FEL_INVOICE_PILOT_SALES_CHANNELS = new Set(["dine_in", "takeout"])

export const FEL_INVOICE_CANDIDATE_PUBLIC_KEYS = new Set([
  "order_id",
  "sales_channel",
  "order_total",
  "paid_at",
  "display_label",
  "fel_status",
  "can_request",
])

export const FEL_INVOICE_CHANNEL_DISPLAY_LABELS = {
  dine_in: "En mesa",
  takeout: "Para llevar",
}

export const FEL_PILOT_ORDER_ID = "ecd90058-9fc7-4c7b-8f1b-a98c6f8bff45"

const FEL_RPC_ERROR_PATTERN = /FEL_[A-Z0-9_]+/g

export function extractFelRpcErrorCode(message = "") {
  const match = String(message || "").match(FEL_RPC_ERROR_PATTERN)
  return match?.[0] || null
}

export function mapFelInvoiceRequestError(error) {
  const raw = String(error?.message || error || "").trim()
  const code = extractFelRpcErrorCode(raw)
  const messages = {
    FEL_EMISSION_DISABLED: "La emisión FEL está deshabilitada. Contacta al administrador.",
    FEL_ENVIRONMENT_NOT_STAGE: "La certificación FEL no está disponible en este entorno.",
    FEL_ORDER_NOT_PAID: "La orden debe estar pagada completamente.",
    FEL_PAYMENT_MISMATCH: "Los pagos no concilian con el total de la orden.",
    FEL_BALANCE_DUE: "Existe saldo pendiente en la orden.",
    FEL_DISCOUNT_NOT_AUTHORITATIVE: "No se pueden solicitar descuentos no registrados en la orden.",
    FEL_CONTINGENCY_NOT_SUPPORTED: "Contingencia FEL no habilitada.",
    FEL_RECEIVER_NAME_REQUIRED: "Indica el nombre del receptor para factura con NIT.",
    FEL_RECEIVER_NIT_TOO_LONG: "El NIT excede la longitud permitida.",
    FEL_SALES_CHANNEL_NOT_SUPPORTED: "Este canal de venta no admite solicitud FEL en caja.",
    FEL_LIST_PARAM_LIMIT_OUT_OF_RANGE: "Parámetro de listado inválido. Intenta de nuevo.",
    FEL_LIST_PARAM_DAYS_OUT_OF_RANGE: "Parámetro de listado inválido. Intenta de nuevo.",
  }
  if (code && messages[code]) return messages[code]
  if (/permiso/i.test(raw)) return "No tienes permiso para solicitar factura FEL."
  if (code) return "No fue posible registrar la solicitud. Verifica la orden e intenta de nuevo."
  return "No fue posible registrar la solicitud. Intenta de nuevo."
}

export function isFelInvoiceRequestEligible({
  isSupabaseOrder = false,
  orderStatus = "",
  salesChannel = "",
  isFullyPaid = null,
  balanceDue = null,
}) {
  if (!isSupabaseOrder) return false
  if (orderStatus !== "paid") return false
  if (!FEL_INVOICE_PILOT_SALES_CHANNELS.has(salesChannel)) return false
  if (isFullyPaid === false) return false
  if (balanceDue != null && Number(balanceDue) > 0.009) return false
  return true
}

export function buildConsumerFinalFelRpcParams(orderId) {
  return {
    p_order_id: orderId,
    p_receiver_nit: "CF",
    p_receiver_name: null,
    p_receiver_address: null,
    p_receiver_email: null,
    p_discount_total: 0,
  }
}

export function felDocumentStatusLabel(status) {
  switch (status) {
    case "pending_certification":
      return "Factura solicitada — pendiente"
    case "processing":
      return "Certificación en proceso"
    case "certified":
      return "Factura certificada"
    case "failed":
      return "Certificación fallida — requiere revisión"
    case "cancelled":
      return "Documento FEL cancelado"
    case "contingency_pending":
    case "contingency_certified":
      return "Contingencia FEL — requiere revisión"
    default:
      return status ? `Estado FEL: ${status}` : ""
  }
}

export function felDocumentPendingUiLabel(status) {
  if (status === "pending_certification") return "Pendiente de certificación"
  return felDocumentStatusLabel(status)
}

export function isSupabasePosOrderId(orderId) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(orderId || ""))
}

/** Post-payment auto-modal: only explicit pilot channels; fail-closed if channel missing. */
export function shouldAutoOpenFelInvoiceModalAfterPayment(felContext) {
  if (!felContext?.orderId || !isSupabasePosOrderId(felContext.orderId)) return false
  if (felContext.orderStatus && felContext.orderStatus !== "paid") return false
  const channel = String(felContext.salesChannel || "").trim()
  if (!FEL_INVOICE_PILOT_SALES_CHANNELS.has(channel)) return false
  return isFelInvoiceRequestEligible({
    isSupabaseOrder: true,
    orderStatus: "paid",
    salesChannel: channel,
    isFullyPaid: true,
    balanceDue: 0,
  })
}

export function resolveFelInvoiceSalesChannel(contextChannel, order) {
  const fromContext = String(contextChannel || "").trim()
  if (fromContext) return fromContext
  return String(order?.sales_channel || order?.salesChannel || "").trim()
}

export function assertFelInvoiceCandidateRowSanitized(row) {
  if (!row || typeof row !== "object") return false
  const keys = Object.keys(row)
  if (!keys.every((key) => FEL_INVOICE_CANDIDATE_PUBLIC_KEYS.has(key))) return false
  const forbidden = /receiver|customer|snapshot|external_id|fel_uuid|email|phone|nit|notes/i
  if (forbidden.test(JSON.stringify(row))) return false
  return true
}

export function partitionPosFelInvoiceCandidates(items = []) {
  const available = []
  const existing = []
  for (const row of items) {
    if (!assertFelInvoiceCandidateRowSanitized(row)) continue
    const status = row.fel_status ?? null
    if (status == null && row.can_request === true) {
      available.push(row)
    } else if (status != null && status !== "") {
      existing.push(row)
    }
  }
  return { available, existing }
}

export function buildFelInvoiceEligibilityInput({ orderId, orderStatus, salesChannel, payment = {} }) {
  return {
    isSupabaseOrder: isSupabasePosOrderId(orderId),
    orderStatus: orderStatus || payment.order_status || "",
    salesChannel: String(salesChannel || "").trim(),
    isFullyPaid: payment.is_fully_paid ?? payment.isFullyPaid ?? null,
    balanceDue: payment.balance_due ?? payment.balanceDue ?? null,
  }
}
