import { supabase } from "../lib/supabase"
import { normalizeBackendError } from "../utils/financeJournalValidation.js"
import {
  GENERAL_JOURNAL_MIGRATION_HINT,
  GENERAL_JOURNAL_RPC_UNAVAILABLE
} from "../utils/financeGeneralJournalConstants.js"
import {
  generalJournalRpcParams,
  mapGeneralJournalResponse
} from "../utils/financeGeneralJournalUtils.js"

let rpcClient = null

export function __setGeneralJournalRpcClientForTests(client) {
  rpcClient = client
}

export function __resetGeneralJournalRpcClientForTests() {
  rpcClient = null
}

function resolveSupabaseRpcCall() {
  if (!supabase || typeof supabase.rpc !== "function") {
    throw new Error(GENERAL_JOURNAL_RPC_UNAVAILABLE)
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

function message(error) {
  return normalizeBackendError(typeof error === "string" ? error : error?.message)
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

function migrationHint(error) {
  const text = message(error)
  if (/does not exist|Could not find the function|schema cache|no está disponible/i.test(text)) {
    return `${text} ${GENERAL_JOURNAL_MIGRATION_HINT}`
  }
  return text
}

export async function getFinanceGeneralJournal(filters = {}) {
  const { data, error } = await callRpc("get_finance_general_journal", generalJournalRpcParams(filters))
  return result(mapGeneralJournalResponse(data), error ? migrationHint(error) : null)
}
