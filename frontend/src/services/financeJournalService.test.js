import assert from "node:assert/strict"
import test from "node:test"
import {
  __resetRpcClientForTests,
  __setRpcClientForTests,
  approveFinanceJournalEntry,
  createFinanceJournalDraft,
  getFinanceJournalEntry,
  listFinanceJournalEntries,
  postFinanceJournalEntry,
  rejectFinanceJournalEntry,
  replaceFinanceJournalLines,
  reverseFinanceJournalEntry,
  submitFinanceJournalEntry
} from "./financeJournalService.js"

const sampleEntry = {
  id: "e1",
  entry_date: "2026-08-01",
  status: "draft",
  currency: "GTQ",
  lines: [{ line_number: 1, debit: "100.00", credit: "0.00" }]
}

function mockRpc(handler) {
  return async (name, params) => handler(name, params)
}

test.afterEach(() => {
  __resetRpcClientForTests()
})

test("list_finance_journal_entries contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: [sampleEntry], error: null }
  }))
  const result = await listFinanceJournalEntries({
    status: "draft",
    periodId: "p1",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    search: "test"
  })
  assert.equal(calls[0].name, "list_finance_journal_entries")
  assert.deepEqual(calls[0].params, {
    p_status: "draft",
    p_period_id: "p1",
    p_from_date: "2026-08-01",
    p_to_date: "2026-08-31",
    p_search: "test"
  })
  assert.equal(result.data.length, 1)
  assert.equal(result.data[0].lines[0].debit, 100)
})

test("create_finance_journal_draft contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: sampleEntry, error: null }
  }))
  const payload = { entry_date: "2026-08-01", description: "Test", reference: "R1", currency: "GTQ" }
  const result = await createFinanceJournalDraft(payload)
  assert.equal(calls[0].name, "create_finance_journal_draft")
  assert.deepEqual(calls[0].params, { p_data: payload })
  assert.equal(result.data.id, "e1")
})

test("replace_finance_journal_lines contract", async () => {
  const lines = [{
    line_number: 1,
    account_id: "a1",
    branch_id: null,
    cost_center_id: null,
    description: "",
    reference: "",
    debit: "10.00",
    credit: "0.00"
  }]
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: sampleEntry, error: null }
  }))
  await replaceFinanceJournalLines("e1", lines)
  assert.equal(calls[0].name, "replace_finance_journal_lines")
  assert.deepEqual(calls[0].params, { p_entry_id: "e1", p_lines: lines })
})

test("submit_finance_journal_entry contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: { ...sampleEntry, status: "pending_approval" }, error: null }
  }))
  const result = await submitFinanceJournalEntry("e1")
  assert.deepEqual(calls[0].params, { p_id: "e1" })
  assert.equal(result.data.status, "pending_approval")
})

test("reject_finance_journal_entry contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: { ...sampleEntry, status: "draft" }, error: null }
  }))
  await rejectFinanceJournalEntry("e1", "Motivo")
  assert.deepEqual(calls[0].params, { p_id: "e1", p_reason: "Motivo" })
})

test("approve_finance_journal_entry contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: { ...sampleEntry, status: "approved" }, error: null }
  }))
  await approveFinanceJournalEntry("e1")
  assert.deepEqual(calls[0].params, { p_id: "e1" })
})

test("post_finance_journal_entry contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: { ...sampleEntry, status: "posted", entry_number: "2026-0001" }, error: null }
  }))
  await postFinanceJournalEntry("e1")
  assert.deepEqual(calls[0].params, { p_id: "e1" })
})

test("reverse_finance_journal_entry contract with null date", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: { ...sampleEntry, status: "posted", reversal_of_id: "e1" }, error: null }
  }))
  await reverseFinanceJournalEntry("e1", "Error contable")
  assert.deepEqual(calls[0].params, {
    p_id: "e1",
    p_reason: "Error contable",
    p_entry_date: null
  })
})

test("reverse_finance_journal_entry contract with explicit date", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: sampleEntry, error: null }
  }))
  await reverseFinanceJournalEntry("e1", "Error contable", "2026-08-15")
  assert.equal(calls[0].params.p_entry_date, "2026-08-15")
})

test("get_finance_journal_entry contract", async () => {
  const calls = []
  __setRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return { data: sampleEntry, error: null }
  }))
  await getFinanceJournalEntry("e1")
  assert.deepEqual(calls[0].params, { p_id: "e1" })
})

test("RPC errors normalized with migration hint when function missing", async () => {
  __setRpcClientForTests(mockRpc(async () => ({
    data: null,
    error: { message: "Could not find the function public.create_finance_journal_draft" }
  })))
  const result = await createFinanceJournalDraft({ entry_date: "2026-08-01" })
  assert.match(result.error, /204_finance_accounting_journal_engine/)
})

test("numeric strings from RPC normalize to numbers in lines", async () => {
  __setRpcClientForTests(mockRpc(async () => ({
    data: {
      id: "e1",
      lines: [{ debit: "0.10", credit: "0.00" }]
    },
    error: null
  })))
  const result = await getFinanceJournalEntry("e1")
  assert.equal(result.data.lines[0].debit, 0.1)
})
