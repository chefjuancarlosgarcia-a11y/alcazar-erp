import { supabase } from "../lib/supabase"
import { normalizeBackendError } from "../utils/financeJournalValidation.js"
import {
  INCOME_STATEMENT_INVALID_METADATA_MESSAGE,
  INCOME_STATEMENT_MIGRATION_HINT,
  INCOME_STATEMENT_RPC_UNAVAILABLE
} from "../utils/financeIncomeStatementConstants.js"
import {
  incomeStatementRpcParams,
  mapIncomeStatementResponse
} from "../utils/financeIncomeStatementUtils.js"

let rpcClient = null

export function __setIncomeStatementRpcClientForTests(client) {
  rpcClient = client
}

export function __resetIncomeStatementRpcClientForTests() {
  rpcClient = null
}

function resolveSupabaseRpcCall() {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error(INCOME_STATEMENT_RPC_UNAVAILABLE)
  }
  return supabase.rpc.bind(supabase)
}

async function callRpc(name, params) {
  try {
    const invoke = rpcClient ?? resolveSupabaseRpcCall()
    return await invoke(name, params)
  } catch (err) {
    return { data: null, error: { message: err.message } }
  }
}

function userFacingError(error) {
  const raw = String(typeof error === "string" ? error : error?.message || "")
  if (/does not exist|Could not find the function|schema cache|PGRST202|no está disponible|Supabase no está/i.test(raw)) {
    return INCOME_STATEMENT_MIGRATION_HINT
  }
  return normalizeBackendError(raw)
}

export async function getFinanceIncomeStatement(filters = {}) {
  const { data, error } = await callRpc("get_finance_income_statement", incomeStatementRpcParams(filters))
  if (error) return { data: null, error: userFacingError(error) }
  const mapped = mapIncomeStatementResponse(data)
  if (!mapped.ok) return { data: null, error: mapped.message || INCOME_STATEMENT_INVALID_METADATA_MESSAGE }
  return { data: mapped.report, error: "" }
}
