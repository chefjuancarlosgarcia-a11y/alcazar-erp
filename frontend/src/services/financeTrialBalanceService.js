import { supabase } from "../lib/supabase"
import { normalizeBackendError } from "../utils/financeJournalValidation.js"
import {
  TRIAL_BALANCE_INVALID_METADATA_MESSAGE,
  TRIAL_BALANCE_MIGRATION_HINT,
  TRIAL_BALANCE_RPC_UNAVAILABLE
} from "../utils/financeTrialBalanceConstants.js"
import {
  mapTrialBalanceResponse,
  trialBalanceRpcParams
} from "../utils/financeTrialBalanceUtils.js"

let rpcClient = null

export function __setTrialBalanceRpcClientForTests(client) {
  rpcClient = client
}

export function __resetTrialBalanceRpcClientForTests() {
  rpcClient = null
}

function resolveSupabaseRpcCall() {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error(TRIAL_BALANCE_RPC_UNAVAILABLE)
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
    return TRIAL_BALANCE_MIGRATION_HINT
  }
  return normalizeBackendError(raw)
}

export async function getFinanceTrialBalance(filters = {}) {
  const { data, error } = await callRpc("get_finance_trial_balance", trialBalanceRpcParams(filters))
  if (error) return { data: null, error: userFacingError(error) }
  const mapped = mapTrialBalanceResponse(data)
  if (!mapped.ok) return { data: null, error: mapped.message || TRIAL_BALANCE_INVALID_METADATA_MESSAGE }
  return { data: mapped.report, error: "" }
}
