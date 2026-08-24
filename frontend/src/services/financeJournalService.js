import { entryFromRpc, entriesFromRpcList, normalizeBackendError } from "../utils/financeJournalValidation.js"

const MIGRATION_HINT = "Aplica la migración 204_finance_accounting_journal_engine.sql en Supabase."
export const RPC_UNAVAILABLE_MESSAGE = "Supabase no está configurado para partidas contables."

let rpcClient = null

export function __setRpcClientForTests(client) {
  rpcClient = client
}

export function __resetRpcClientForTests() {
  rpcClient = null
}

export function resolveJournalRpcInvoker() {
  if (!rpcClient) {
    throw new Error(RPC_UNAVAILABLE_MESSAGE)
  }
  return rpcClient
}

async function resolveSupabaseRpcCall() {
  const mod = await import("../lib/supabase")
  const client = mod.supabase
  if (!client || typeof client.rpc !== "function") {
    throw new Error(RPC_UNAVAILABLE_MESSAGE)
  }
  return client.rpc.bind(client)
}

/** @internal Test-only — delegates to resolveSupabaseRpcCall (same path as callRpc). */
export async function __resolveSupabaseRpcCallForTests() {
  return resolveSupabaseRpcCall()
}

async function callRpc(name, params) {
  try {
    const invoke = rpcClient ?? await resolveSupabaseRpcCall()
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
    return `${text} ${MIGRATION_HINT}`
  }
  return text
}

export async function listFinanceJournalEntries(filters = {}) {
  const { data, error } = await callRpc("list_finance_journal_entries", {
    p_status: filters.status || null,
    p_period_id: filters.periodId || null,
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_search: filters.search || null
  })
  return result(entriesFromRpcList(data), error ? migrationHint(error) : null)
}

export async function getFinanceJournalEntry(id) {
  const { data, error } = await callRpc("get_finance_journal_entry", { p_id: id })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function createFinanceJournalDraft(payload) {
  const { data, error } = await callRpc("create_finance_journal_draft", { p_data: payload })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function replaceFinanceJournalLines(entryId, lines) {
  const { data, error } = await callRpc("replace_finance_journal_lines", {
    p_entry_id: entryId,
    p_lines: lines
  })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function submitFinanceJournalEntry(id) {
  const { data, error } = await callRpc("submit_finance_journal_entry", { p_id: id })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function rejectFinanceJournalEntry(id, reason) {
  const { data, error } = await callRpc("reject_finance_journal_entry", {
    p_id: id,
    p_reason: reason
  })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function approveFinanceJournalEntry(id) {
  const { data, error } = await callRpc("approve_finance_journal_entry", { p_id: id })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function postFinanceJournalEntry(id) {
  const { data, error } = await callRpc("post_finance_journal_entry", { p_id: id })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}

export async function reverseFinanceJournalEntry(id, reason, reversalDate = null) {
  const { data, error } = await callRpc("reverse_finance_journal_entry", {
    p_id: id,
    p_reason: reason,
    p_entry_date: reversalDate || null
  })
  return result(entryFromRpc(data), error ? migrationHint(error) : null)
}
