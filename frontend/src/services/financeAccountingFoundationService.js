import { supabase } from "../lib/supabase"

const MIGRATION_HINT = "Aplica la migración 203_finance_accounting_multibranch_foundation.sql en Supabase."

function message(error) {
  return typeof error === "string" ? error : error?.message || "Error en estructura contable."
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

export async function listBranches(filters = {}) {
  const { data, error } = await supabase.rpc("list_branches", {
    p_search: filters.search || null,
    p_is_active: typeof filters.isActive === "boolean" ? filters.isActive : null,
    p_include_inactive: filters.includeInactive !== false
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createBranch(payload) {
  const { data, error } = await supabase.rpc("create_branch", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateBranch(id, payload) {
  const { data, error } = await supabase.rpc("update_branch", { p_id: id, p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function setBranchMain(id) {
  const { data, error } = await supabase.rpc("set_branch_main", { p_id: id })
  return result(data, error ? migrationHint(error) : null)
}

export async function setBranchActive(id, isActive) {
  const { data, error } = await supabase.rpc("set_branch_active", { p_id: id, p_is_active: isActive })
  return result(data, error ? migrationHint(error) : null)
}

export async function listFinanceCostCenters(filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_cost_centers", {
    p_search: filters.search || null,
    p_branch_id: filters.branchId || null,
    p_is_active: typeof filters.isActive === "boolean" ? filters.isActive : null,
    p_include_inactive: filters.includeInactive !== false
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinanceCostCenter(payload) {
  const { data, error } = await supabase.rpc("create_finance_cost_center", { p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function updateFinanceCostCenter(id, payload) {
  const { data, error } = await supabase.rpc("update_finance_cost_center", { p_id: id, p_data: payload })
  return result(data, error ? migrationHint(error) : null)
}

export async function setFinanceCostCenterActive(id, isActive) {
  const { data, error } = await supabase.rpc("set_finance_cost_center_active", {
    p_id: id,
    p_is_active: isActive
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function listFinanceAccountingPeriods(filters = {}) {
  const { data, error } = await supabase.rpc("list_finance_accounting_periods", {
    p_year: filters.year ? Number(filters.year) : null,
    p_status: filters.status || null
  })
  return result(Array.isArray(data) ? data : [], error ? migrationHint(error) : null)
}

export async function createFinanceAccountingPeriod(year, month) {
  const { data, error } = await supabase.rpc("create_finance_accounting_period", {
    p_year: Number(year),
    p_month: Number(month)
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function setFinanceAccountingPeriodStatus(id, status) {
  const { data, error } = await supabase.rpc("set_finance_accounting_period_status", {
    p_id: id,
    p_status: status
  })
  return result(data, error ? migrationHint(error) : null)
}

export async function reopenFinanceAccountingPeriod(id, reason) {
  const { data, error } = await supabase.rpc("reopen_finance_accounting_period", {
    p_id: id,
    p_reason: reason
  })
  return result(data, error ? migrationHint(error) : null)
}
