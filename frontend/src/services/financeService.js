import { supabase } from "../lib/supabase"

const MIGRATION_HINT = "Aplica las migraciones 128_finance_phase1.sql y 130_finance_phase2_integrations.sql en Supabase."

function message(error) {
  return typeof error === "string" ? error : error?.message || "Error en finanzas."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

function migrationHint(error) {
  const text = message(error)
  if (/does not exist|Could not find the function|schema cache/i.test(text)) {
    return `${text} ${MIGRATION_HINT}`
  }
  return text
}

export async function getFinanceDashboard(filters = {}) {
  const { data, error } = await supabase.rpc("get_finance_dashboard", {
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null,
    p_bank_account_id: filters.bankAccountId || null
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function listFinanceBankAccounts() {
  const { data, error } = await supabase.rpc("list_finance_bank_accounts")
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function listFinanceBankTransactions(bankAccountId, filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_bank_transactions", {
    p_bank_account_id: bankAccountId,
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinanceBankAccount(payload) {
  const { data, error } = await supabase.rpc("create_finance_bank_account", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function createFinanceBankTransaction(payload) {
  const { data, error } = await supabase.rpc("create_finance_bank_transaction", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function listFinancePayables(filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_payables", {
    p_status: filters.status || null,
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinancePayable(payload) {
  const { data, error } = await supabase.rpc("create_finance_payable", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function recordFinancePayablePayment(payableId, payload) {
  const { data, error } = await supabase.rpc("record_finance_payable_payment", {
    p_payable_id: payableId,
    p_data: payload
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function listFinanceReceivables(filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_receivables", {
    p_status: filters.status || null,
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinanceReceivable(payload) {
  const { data, error } = await supabase.rpc("create_finance_receivable", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function recordFinanceReceivableCollection(receivableId, payload) {
  const { data, error } = await supabase.rpc("record_finance_receivable_collection", {
    p_receivable_id: receivableId,
    p_data: payload
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getFinanceCashFlow(filters = {}) {
  const { data, error } = await supabase.rpc("get_finance_cash_flow", {
    p_start_date: filters.startDate || null,
    p_end_date: filters.endDate || null
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function createOrGetFinanceReconciliation(bankAccountId, month, year) {
  const { data, error } = await supabase.rpc("create_or_get_finance_reconciliation", {
    p_bank_account_id: bankAccountId,
    p_month: month,
    p_year: year
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateFinanceReconciliationItem(itemId, isChecked) {
  const { data, error } = await supabase.rpc("update_finance_reconciliation_item", {
    p_item_id: itemId,
    p_is_checked: isChecked
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateFinanceReconciliationStatement(reconciliationId, payload) {
  const { data, error } = await supabase.rpc("update_finance_reconciliation_statement", {
    p_reconciliation_id: reconciliationId,
    p_data: payload
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function closeFinanceReconciliation(reconciliationId, force = false) {
  const { data, error } = await supabase.rpc("close_finance_reconciliation", {
    p_reconciliation_id: reconciliationId,
    p_force: force
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getFinanceIntegrationStatus(sourceModule, sourceId) {
  const { data, error } = await supabase.rpc("get_finance_integration_status", {
    p_source_module: sourceModule,
    p_source_id: String(sourceId)
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function createFinancePayableFromPurchase(purchaseOrderId) {
  const { data, error } = await supabase.rpc("create_finance_payable_from_purchase", {
    p_purchase_order_id: String(purchaseOrderId),
    p_auto: false
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function createFinanceReceivableFromCatering(cateringRequestId) {
  const { data, error } = await supabase.rpc("create_finance_receivable_from_catering", {
    p_catering_request_id: cateringRequestId,
    p_auto: false
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function createFinanceDepositFromCashClosing(cashClosingId, bankAccountId, amount, method = "cash") {
  const { data, error } = await supabase.rpc("create_finance_deposit_from_cash_closing", {
    p_cash_session_id: cashClosingId,
    p_bank_account_id: bankAccountId,
    p_amount: amount,
    p_method: method
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function getFinancePendingIntegrations() {
  const { data, error } = await supabase.rpc("get_finance_pending_integrations")
  return result(data, error ? migrationHint(error) : null)
}
