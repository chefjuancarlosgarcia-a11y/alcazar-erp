import assert from "node:assert/strict"
import test from "node:test"
import {
  closeFinanceJournalServiceTestServer,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"
import {
  BALANCE_SHEET_COMPLETE_LABEL,
  BALANCE_SHEET_MIGRATION_HINT,
  BALANCE_SHEET_PROVISIONAL_LABEL,
  BALANCE_SHEET_SECTION_LABELS,
  BALANCE_SHEET_SECTION_ORDER
} from "../utils/financeBalanceSheetConstants.js"

let service = null

async function getService() {
  if (!service) {
    service = await loadFinanceJournalTestModule("/src/services/financeBalanceSheetService.js")
  }
  return service
}

test.before(async () => {
  await getService()
})

test.after(async () => {
  await closeFinanceJournalServiceTestServer()
  service = null
})

function sections(subtotals = {}) {
  return BALANCE_SHEET_SECTION_ORDER.map((key) => ({
    key,
    label: BALANCE_SHEET_SECTION_LABELS[key],
    subtotal: subtotals[key] ?? 0,
    accounts: []
  }))
}

function payload(overrides = {}) {
  return {
    cutoff_date: "2097-04-30",
    snapshot_at: "2097-04-30T12:00:00.000Z",
    scope: "global",
    include_zero_accounts: false,
    dimensional_filter: false,
    report_complete: true,
    report_label: BALANCE_SHEET_COMPLETE_LABEL,
    balance_status: "Cuadrado",
    is_square: true,
    current_assets_total: 100,
    noncurrent_assets_total: 0,
    classified_total_assets: 100,
    current_liabilities_total: 0,
    noncurrent_liabilities_total: 0,
    classified_total_liabilities: 0,
    classified_registered_equity: 70,
    accumulated_result: 30,
    classified_total_equity: 100,
    classified_total_liabilities_and_equity: 100,
    classified_difference: 0,
    unclassified_asset_amount: 0,
    unclassified_liability_amount: 0,
    unclassified_equity_amount: 0,
    control_total_assets: 100,
    control_total_liabilities: 0,
    control_registered_equity: 70,
    control_total_equity: 100,
    control_total_liabilities_and_equity: 100,
    difference: 0,
    unclassified_debit: 0,
    unclassified_credit: 0,
    unclassified_account_count: 0,
    account_count: 0,
    warnings: [],
    sections: sections({ current_asset: 100, equity: 70 }),
    unclassified_accounts: [],
    ...overrides
  }
}

test("el servicio mapea un balance completo", async () => {
  const current = await getService()
  current.__setBalanceSheetRpcClientForTests(async () => ({ data: payload(), error: null }))
  const result = await current.getFinanceBalanceSheet({ cutoffDate: "2097-04-30" })
  assert.equal(result.error, "")
  assert.equal(result.data.reportComplete, true)
  assert.equal(result.data.controlTotalAssets, 100)
  assert.equal(result.data.classifiedDifference, 0)
  current.__resetBalanceSheetRpcClientForTests()
})

test("el servicio rechaza metadatos que confunden totales clasificados con la ecuación de control", async () => {
  const current = await getService()
  current.__setBalanceSheetRpcClientForTests(async () => ({
    data: payload({
      report_complete: false,
      report_label: BALANCE_SHEET_PROVISIONAL_LABEL,
      classified_difference: 0,
      difference: 0,
      is_square: true,
      unclassified_account_count: 1
    }),
    error: null
  }))
  const result = await current.getFinanceBalanceSheet({ cutoffDate: "2097-04-30" })
  assert.match(result.error, /inválidos/)
  assert.equal(result.data, null)
  current.__resetBalanceSheetRpcClientForTests()
})

test("un reporte ausente se explica sin nombrar la función ni la migración", async () => {
  const current = await getService()
  current.__setBalanceSheetRpcClientForTests(async () => ({
    data: null,
    error: { message: "Could not find the function public.get_finance_balance_sheet" }
  }))
  const result = await current.getFinanceBalanceSheet({ cutoffDate: "2097-04-30" })
  assert.equal(result.error, BALANCE_SHEET_MIGRATION_HINT)
  assert.doesNotMatch(result.error, /get_finance_balance_sheet/)
  assert.doesNotMatch(result.error, /218/)
  current.__resetBalanceSheetRpcClientForTests()
})
