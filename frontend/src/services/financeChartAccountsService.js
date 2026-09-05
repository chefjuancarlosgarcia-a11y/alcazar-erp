import { supabase } from "../lib/supabase"

const MIGRATION_HINT = "Aplica la migración 202_finance_accounting_chart_of_accounts.sql en Supabase."

function message(error) {
  return typeof error === "string" ? error : error?.message || "Error en catálogo contable."
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

export async function listFinanceChartAccounts(filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_chart_accounts", {
    p_search: filters.search || null,
    p_financial_type: filters.financialType || null,
    p_natural_balance: filters.naturalBalance || null,
    p_account_kind: filters.accountKind || null,
    p_is_active: typeof filters.isActive === "boolean" ? filters.isActive : null,
    p_include_inactive: filters.includeInactive !== false
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinanceChartAccount(payload) {
  const { data, error } = await supabase.rpc("create_finance_chart_account", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateFinanceChartAccount(id, payload) {
  const { data, error } = await supabase.rpc("update_finance_chart_account", {
    p_id: id,
    p_data: payload
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function setFinanceChartAccountActive(id, isActive) {
  const { data, error } = await supabase.rpc("set_finance_chart_account_active", {
    p_id: id,
    p_is_active: isActive
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function previewFinanceChartAccountsImport(rows) {
  const { data, error } = await supabase.rpc("preview_finance_chart_accounts_import", {
    p_rows: rows
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function importFinanceChartAccounts(rows) {
  const { data, error } = await supabase.rpc("import_finance_chart_accounts", {
    p_rows: rows
  })
  return result(data, error ? migrationHint(error) : null)
}
