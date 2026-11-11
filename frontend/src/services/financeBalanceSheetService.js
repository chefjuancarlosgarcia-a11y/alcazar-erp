import { supabase } from "../lib/supabase"
import { normalizeBackendError } from "../utils/financeJournalValidation.js"
import {
  BALANCE_SHEET_INVALID_METADATA_MESSAGE,
  BALANCE_SHEET_MIGRATION_HINT,
  BALANCE_SHEET_RPC_UNAVAILABLE
} from "../utils/financeBalanceSheetConstants.js"
import {
  balanceSheetRpcParams,
  mapBalanceSheetResponse
} from "../utils/financeBalanceSheetUtils.js"

let rpcClient = null

export function __setBalanceSheetRpcClientForTests(client) {
  rpcClient = client
}

export function __resetBalanceSheetRpcClientForTests() {
  rpcClient = null
}

function resolveSupabaseRpcCall() {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error(BALANCE_SHEET_RPC_UNAVAILABLE)
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
    return BALANCE_SHEET_MIGRATION_HINT
  }
  return normalizeBackendError(raw)
}

export async function getFinanceBalanceSheet(filters = {}) {
  const { data, error } = await callRpc("get_finance_balance_sheet", balanceSheetRpcParams(filters))
  if (error) return { data: null, error: userFacingError(error) }
  const mapped = mapBalanceSheetResponse(data)
  if (!mapped.ok) return { data: null, error: mapped.message || BALANCE_SHEET_INVALID_METADATA_MESSAGE }
  return { data: mapped.report, error: "" }
}
