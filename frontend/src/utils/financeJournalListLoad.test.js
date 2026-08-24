import assert from "node:assert/strict"
import test from "node:test"
import {
  __resetRpcClientForTests,
  __setRpcClientForTests,
  listFinanceJournalEntries,
  resolveJournalRpcInvoker,
  RPC_UNAVAILABLE_MESSAGE
} from "../services/financeJournalService.js"
import { loadJournalEntriesForList, withJournalListLoading } from "./financeJournalListLoad.js"

function mockRpc(handler) {
  return async (name, params) => handler(name, params)
}

test.afterEach(() => {
  __resetRpcClientForTests()
})

test("resolveJournalRpcInvoker uses injected rpc client with exact signature", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: [], error: null }
  }))

  const invoke = resolveJournalRpcInvoker()
  await invoke("list_finance_journal_entries", { p_status: null })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, "list_finance_journal_entries")
})

test("resolveJournalRpcInvoker rejects when no injected client in tests", () => {
  __resetRpcClientForTests()
  assert.throws(
    () => resolveJournalRpcInvoker(),
    (err) => err.message === RPC_UNAVAILABLE_MESSAGE
  )
})

test("listFinanceJournalEntries returns controlled error when rpc invoke fails", async () => {
  __setRpcClientForTests(async () => {
    throw new Error(RPC_UNAVAILABLE_MESSAGE)
  })
  const result = await listFinanceJournalEntries({})
  assert.match(result.error, /no está configurado/i)
  assert.deepEqual(result.data, [])
})

test("loadJournalEntriesForList success does not throw", async () => {
  const errors = []
  const outcome = await loadJournalEntriesForList({
    canView: true,
    fetchEntries: async () => ({ data: [{ id: "e1" }], error: "" }),
    onError: (message) => errors.push(message)
  })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.entries.length, 1)
  assert.equal(errors.length, 0)
})

test("loadJournalEntriesForList maps service error without throwing", async () => {
  const errors = []
  const outcome = await loadJournalEntriesForList({
    canView: true,
    fetchEntries: async () => ({ data: [], error: "RPC falló" }),
    onError: (message) => errors.push(message)
  })

  assert.equal(outcome.ok, false)
  assert.equal(errors[0], "RPC falló")
})

test("loadJournalEntriesForList catches rejected fetch without unhandled promise", async () => {
  const errors = []
  const outcome = await loadJournalEntriesForList({
    canView: true,
    fetchEntries: async () => {
      throw new Error("Cannot read properties of undefined (reading 'rpc')")
    },
    onError: (message) => errors.push(message)
  })

  assert.equal(outcome.ok, false)
  assert.match(errors[0], /rpc/i)
})

test("withJournalListLoading always releases loading flag", async () => {
  let loading = false
  const setLoading = (value) => {
    loading = value
  }

  const rejected = await withJournalListLoading(setLoading, async () => {
    assert.equal(loading, true)
    throw new Error("fallo simulado")
  }).catch((error) => error)

  assert.equal(rejected.message, "fallo simulado")
  assert.equal(loading, false)
})

test("withJournalListLoading releases loading after success", async () => {
  let loading = false
  const setLoading = (value) => {
    loading = value
  }

  const value = await withJournalListLoading(setLoading, async () => "ok")

  assert.equal(value, "ok")
  assert.equal(loading, false)
})
