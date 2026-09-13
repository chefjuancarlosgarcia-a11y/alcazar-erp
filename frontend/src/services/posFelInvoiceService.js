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
  buildConsumerFinalFelRpcParams,
  buildFelInvoiceEligibilityInput,
  felDocumentPendingUiLabel,
  felDocumentStatusLabel,
  isFelInvoiceRequestEligible,
  isSupabasePosOrderId,
  mapFelInvoiceRequestError,
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
