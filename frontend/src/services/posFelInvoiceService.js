import { supabase } from "../lib/supabase"
import { withTimeout } from "./productionTicketsService"
import {
  buildConsumerFinalFelRpcParams,
  felDocumentPendingUiLabel,
  felDocumentStatusLabel,
  isFelInvoiceRequestEligible,
  isSupabasePosOrderId,
  mapFelInvoiceRequestError,
} from "./posFelInvoiceRequestPure.js"

export {
  assertFelInvoiceCandidateRowSanitized,
  buildConsumerFinalFelRpcParams,
  buildFelInvoiceEligibilityInput,
  felDocumentPendingUiLabel,
  felDocumentStatusLabel,
  FEL_PILOT_ORDER_ID,
  isFelInvoiceRequestEligible,
  isSupabasePosOrderId,
  mapFelInvoiceRequestError,
  partitionPosFelInvoiceCandidates,
  resolveFelInvoiceSalesChannel,
  shouldAutoOpenFelInvoiceModalAfterPayment,
} from "./posFelInvoiceRequestPure.js"

export async function fetchPosFelDocumentStatus(orderId) {
  const { data, error } = await withTimeout(
    supabase.rpc("get_pos_fel_document_status", { p_order_id: orderId }),
    10000,
    "consultar estado FEL"
  )
  if (error) {
    return { data: null, error, message: mapFelInvoiceRequestError(error) }
  }
  return { data: data || null, error: null, message: "" }
}

export async function fetchPosFelInvoiceCandidates({
  limit = 15,
  paidWithinDays = 30,
  orderId = null,
} = {}) {
  const params = {
    p_limit: limit,
    p_paid_within_days: paidWithinDays,
    p_order_id: orderId,
  }
  const { data, error } = await withTimeout(
    supabase.rpc("list_pos_fel_invoice_candidates", params),
    15000,
    "listar candidatos FEL"
  )
  if (error) {
    return { data: null, error, message: mapFelInvoiceRequestError(error) }
  }
  const payload = data && typeof data === "object" ? data : { items: [], meta: {} }
  return {
    data: {
      items: Array.isArray(payload.items) ? payload.items : [],
      meta: payload.meta || {},
    },
    error: null,
    message: "",
  }
}

export async function requestPosFelCertificationConsumerFinal(orderId) {
  const params = buildConsumerFinalFelRpcParams(orderId)
  const { data, error } = await withTimeout(
    supabase.rpc("request_pos_fel_certification", params),
    15000,
    "solicitar factura FEL"
  )
  if (error) {
    return { data: null, error, message: mapFelInvoiceRequestError(error) }
  }
  return { data: data || null, error: null, message: "" }
}
