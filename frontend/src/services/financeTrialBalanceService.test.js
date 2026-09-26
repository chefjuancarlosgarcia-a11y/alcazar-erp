import assert from "node:assert/strict"
import test from "node:test"
import {
  closeFinanceJournalServiceTestServer,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"

let service = null

async function getService() {
  if (!service) {
    service = await loadFinanceJournalTestModule("/src/services/financeTrialBalanceService.js")
  }
  return service
}

test.before(async () => {
  await getService()
})

test.after(async () => {
  await closeFinanceJournalServiceTestServer()
})

function rpcPayload() {
  return {
    scope: "global",
    effective_from: "2026-09-01",
    effective_to: "2026-09-30",
    include_zero_accounts: false,
    opening_debit_total: 0,
    opening_credit_total: 0,
    period_debit_total: 100,
    period_credit_total: 100,
    closing_debit_total: 100,
    closing_credit_total: 100,
    opening_difference: 0,
    period_difference: 0,
    closing_difference: 0,
    is_square: true,
    account_count: 1,
    match_count: 1,
    search_applied: false,
    page: 1,
    page_size: 50,
    total_pages: 1,
    snapshot_at: "2026-09-26T01:50:36.561863+00:00",
    rows: [{
      account_id: "cash",
      code: "1101",
      name: "Caja",
      natural_balance: "debit",
      parent_id: null,
      parent_code: null,
      is_active: true,
      accepts_entries: true,
      opening_debit: 0,
      opening_credit: 0,
      period_debit: 100,
      period_credit: 0,
      closing_debit: 100,
      closing_credit: 0,
      opening_contrary: false,
      closing_contrary: false,
      movement_count: 1
    }]
  }
}

test("el servicio rechaza a quien el RPC declara sin permiso", async () => {
  const trial = await getService()
  trial.__setTrialBalanceRpcClientForTests(async () => ({
    data: null,
    error: { message: "No tienes permiso para consultar reportes contables." }
  }))
  try {
    const result = await trial.getFinanceTrialBalance({})
    assert.equal(result.data, null)
    assert.match(result.error, /No tienes permiso/)
    assert.doesNotMatch(result.error, /get_finance_trial_balance/)
  } finally {
    trial.__resetTrialBalanceRpcClientForTests()
  }
})

test("un RPC ausente no expone el nombre de la función", async () => {
  const trial = await getService()
  trial.__setTrialBalanceRpcClientForTests(async () => ({
    data: null,
    error: { message: "Could not find the function public.get_finance_trial_balance in the schema cache" }
  }))
  try {
    const result = await trial.getFinanceTrialBalance({})
    assert.equal(result.data, null)
    assert.match(result.error, /no está disponible/)
    assert.doesNotMatch(result.error, /get_finance_trial_balance|schema cache|PGRST202/)
  } finally {
    trial.__resetTrialBalanceRpcClientForTests()
  }
})

test("el servicio acepta columnas de saldo y rechaza un saldo duplicado", async () => {
  const trial = await getService()
  trial.__setTrialBalanceRpcClientForTests(async () => ({ data: rpcPayload(), error: null }))
  try {
    const result = await trial.getFinanceTrialBalance({})
    assert.equal(result.error, "")
    assert.equal(result.data.closingDebitTotal, 100)
    assert.equal(result.data.rows[0].closingDebit, 100)
    assert.equal(result.data.rows[0].closingCredit, 0)
  } finally {
    trial.__resetTrialBalanceRpcClientForTests()
  }

  const broken = structuredClone(rpcPayload())
  broken.rows[0].closing_debit = 10
  broken.rows[0].closing_credit = 10
  trial.__setTrialBalanceRpcClientForTests(async () => ({ data: broken, error: null }))
  try {
    const result = await trial.getFinanceTrialBalance({})
    assert.equal(result.data, null)
    assert.match(result.error, /metadatos/)
  } finally {
    trial.__resetTrialBalanceRpcClientForTests()
  }
})
