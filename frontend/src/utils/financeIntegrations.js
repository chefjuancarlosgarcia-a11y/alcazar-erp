import {
  createFinanceDepositFromCashClosing,
  createFinancePayableFromPurchase,
  createFinanceReceivableFromCatering,
  getFinanceIntegrationStatus as fetchFinanceIntegrationStatus,
  getFinancePendingIntegrations
} from "../services/financeService"

function wrap(result) {
  return { data: result.data, error: result.error || "" }
}

export async function createPayableFromPurchase(purchaseOrderId) {
  const result = await createFinancePayableFromPurchase(purchaseOrderId)
  return wrap(result)
}

export async function createReceivableFromCatering(cateringRequestId) {
  const result = await createFinanceReceivableFromCatering(cateringRequestId)
  return wrap(result)
}

export async function createDepositFromCashClosing(cashClosingId, bankAccountId, amount, method = "cash") {
  const result = await createFinanceDepositFromCashClosing(cashClosingId, bankAccountId, amount, method)
  return wrap(result)
}

export async function getFinanceIntegrationStatus(sourceModule, sourceId) {
  const result = await fetchFinanceIntegrationStatus(sourceModule, sourceId)
  return wrap(result)
}

export async function listFinancePendingIntegrations() {
  const result = await getFinancePendingIntegrations()
  return wrap(result)
}

/** @deprecated use createPayableFromPurchase */
export async function maybeCreatePayableFromPurchase(purchaseOrderId) {
  return createPayableFromPurchase(purchaseOrderId)
}

/** @deprecated use createReceivableFromCatering */
export async function maybeCreateReceivableFromCatering(cateringRequestId) {
  return createReceivableFromCatering(cateringRequestId)
}

/** @deprecated use createDepositFromCashClosing */
export async function maybeCreateBankMovementFromCashClose(cashClosingId, bankAccountId, amount, method) {
  return createDepositFromCashClosing(cashClosingId, bankAccountId, amount, method)
}

export async function maybeSyncPosDailySummary() {
  return { synced: false, reason: "phase_3_pos_summary" }
}
