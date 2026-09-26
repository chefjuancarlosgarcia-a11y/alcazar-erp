import { supabase } from "../lib/supabase"
import { normalizeBackendError } from "../utils/financeJournalValidation.js"
import {
  GENERAL_LEDGER_INVALID_METADATA_MESSAGE,
  GENERAL_LEDGER_MIGRATION_HINT,
  GENERAL_LEDGER_RPC_UNAVAILABLE
} from "../utils/financeGeneralLedgerConstants.js"
import {
  generalLedgerRpcParams,
  mapGeneralLedgerResponse
} from "../utils/financeGeneralLedgerUtils.js"

let rpcClient = null

export function __setGeneralLedgerRpcClientForTests(client) {
  rpcClient = client
}

export function __resetGeneralLedgerRpcClientForTests() {
  rpcClient = null
}

function resolveSupabaseRpcCall() {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error(GENERAL_LEDGER_RPC_UNAVAILABLE)
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
    return GENERAL_LEDGER_MIGRATION_HINT
  }
  return normalizeBackendError(raw)
}

export async function getFinanceGeneralLedger(filters = {}) {
  const { data, error } = await callRpc("get_finance_general_ledger", generalLedgerRpcParams(filters))
  if (error) return { data: null, error: userFacingError(error) }
  const mapped = mapGeneralLedgerResponse(data)
  if (!mapped.ok) return { data: null, error: mapped.message || GENERAL_LEDGER_INVALID_METADATA_MESSAGE }
  return { data: mapped.report, error: "" }
}
