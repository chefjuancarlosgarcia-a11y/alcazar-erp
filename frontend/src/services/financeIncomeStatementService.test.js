import assert from "node:assert/strict"
import test from "node:test"
import {
  closeFinanceJournalServiceTestServer,
  loadFinanceJournalTestModule
} from "./financeJournalServiceTestHarness.js"
import { INCOME_STATEMENT_PROVISIONAL_LABEL, INCOME_STATEMENT_TAX_NOTE } from "../utils/financeIncomeStatementConstants.js"

let service = null

async function getService() {
  if (!service) {
    service = await loadFinanceJournalTestModule("/src/services/financeIncomeStatementService.js")
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

function section(key, label, subtotal = 0, accounts = []) {
  return { key, label, subtotal, accounts }
}

function payload(overrides = {}) {
  return {
    scope: "global",
    effective_from: "2026-09-01",
    effective_to: "2026-09-30",
    include_zero_accounts: false,
    snapshot_at: "2026-09-30T12:00:00.000Z",
    report_complete: true,
    income_tax_classified: false,
    operating_income_total: 100,
    sales_contra_total: 0,
    net_revenue: 100,
    cost_of_sales_total: 0,
    gross_profit: 100,
    selling_expenses_total: 0,
    administrative_expenses_total: 0,
    other_operating_expenses_total: 0,
    operating_expenses_total: 0,
    operating_profit: 100,
    other_income_total: 0,
    other_expense_total: 0,
    other_result: 0,
    profit_before_tax: 100,
    income_tax_total: 0,
    classified_net_result: 100,
    net_income: 100,
    net_result_label: "Utilidad neta",
    unclassified_debit: 0,
    unclassified_credit: 0,
    unclassified_net_movement: 0,
    unclassified_account_count: 0,
    account_count: 0,
    warnings: [INCOME_STATEMENT_TAX_NOTE],
    sections: [
      section("operating_income", "Ingresos operativos", 100),
      section("sales_contra", "Devoluciones y descuentos sobre ventas"),
      section("cost_of_sales", "Costo de ventas"),
      section("operating_expense_selling", "Gastos de venta"),
      section("operating_expense_admin", "Gastos administrativos"),
      section("operating_expense_other", "Otros gastos operativos"),
      section("other_income", "Otros ingresos"),
      section("other_expense", "Otros gastos"),
      section("income_tax", "Impuesto sobre la renta")
    ],
    unclassified_accounts: [],
    ...overrides
  }
}

test("el servicio mapea un reporte completo", async () => {
  const current = await getService()
  current.__setIncomeStatementRpcClientForTests(async () => ({ data: payload(), error: null }))
  const result = await current.getFinanceIncomeStatement({ fromDate: "2026-09-01", toDate: "2026-09-30" })
  assert.equal(result.error, "")
  assert.equal(result.data.netIncome, 100)
  assert.equal(result.data.reportComplete, true)
  current.__resetIncomeStatementRpcClientForTests()
})

test("el servicio rechaza una utilidad neta cuando el reporte está incompleto", async () => {
  const current = await getService()
  current.__setIncomeStatementRpcClientForTests(async () => ({
    data: payload({
      report_complete: false,
      net_income: 100,
      net_result_label: INCOME_STATEMENT_PROVISIONAL_LABEL
    }),
    error: null
  }))
  const result = await current.getFinanceIncomeStatement({})
  assert.match(result.error, /inválidos/)
  assert.equal(result.data, null)
  current.__resetIncomeStatementRpcClientForTests()
})

test("un reporte ausente se explica sin nombrar la función", async () => {
  const current = await getService()
  current.__setIncomeStatementRpcClientForTests(async () => ({
    data: null,
    error: { message: "Could not find the function public.get_finance_income_statement" }
  }))
  const result = await current.getFinanceIncomeStatement({})
  assert.match(result.error, /no está disponible/)
  assert.doesNotMatch(result.error, /get_finance_income_statement/)
  assert.doesNotMatch(result.error, /217/)
  current.__resetIncomeStatementRpcClientForTests()
})
