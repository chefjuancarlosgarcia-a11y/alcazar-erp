import assert from "node:assert/strict"
import test from "node:test"
import {
  closeFinanceJournalServiceTestServer,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"

let service = null

async function getService() {
  if (service) return service
  service = await loadFinanceJournalTestModule("/src/services/financeGeneralJournalService.js")
  return service
}

function mockRpc(handler) {
  return async (name, params) => handler(name, params)
}

test.before(async () => {
  await getService()
})

test.after(async () => {
  await closeFinanceJournalServiceTestServer()
})

test.afterEach(() => {
  service.__resetGeneralJournalRpcClientForTests()
})

test("get_finance_general_journal contract", async () => {
  const calls = []
  service.__setGeneralJournalRpcClientForTests(mockRpc(async (name, params) => {
    calls.push({ name, params })
    return {
      data: {
        rows: [{
          line_id: "l1",
          entry_id: "e1",
          entry_date: "2026-08-01",
          entry_number: "JE-2026-0001",
          entry_reference: "",
          entry_description: "Test",
          line_number: 1,
          account_id: "a1",
          account_code: "1.01",
          account_name: "Caja",
          line_description: "",
          line_reference: "",
          debit: "10.00",
          credit: "0.00",
          is_reversal: false
        }],
        total_rows: 1,
        total_entries: 1,
        total_debit: "10.00",
        total_credit: "10.00",
        difference: "0.00",
        page: 1,
        page_size: 50,
        total_pages: 1
      },
      error: null
    }
  }))

  const result = await service.getFinanceGeneralJournal({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    search: "JE",
    page: 1,
    pageSize: 50
  })

  assert.equal(calls[0].name, "get_finance_general_journal")
  assert.equal(calls[0].params.p_from_date, "2026-08-01")
  assert.equal(calls[0].params.p_search, "JE")
  assert.equal(result.data.rows[0].entryNumber, "JE-2026-0001")
  assert.equal(result.data.isBalanced, true)
  assert.equal(result.error, "")
})

test("get_finance_general_journal surfaces migration hint", async () => {
  service.__setGeneralJournalRpcClientForTests(mockRpc(async () => ({
    data: null,
    error: { message: "Could not find the function public.get_finance_general_journal" }
  })))
  const result = await service.getFinanceGeneralJournal({})
  assert.match(result.error, /208_finance_general_journal/)
})
