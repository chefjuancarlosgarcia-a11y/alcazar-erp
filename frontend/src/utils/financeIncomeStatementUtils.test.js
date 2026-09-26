import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { filterPostableAccounts } from "./financeJournalValidation.js"
import { INCOME_STATEMENT_PROVISIONAL_LABEL, INCOME_STATEMENT_TAX_NOTE } from "./financeIncomeStatementConstants.js"
import {
  buildIncomeStatementCsv,
  mapIncomeStatementResponse,
  resolveIncomeStatementScreen,
  validateIncomeStatementQuery
} from "./financeIncomeStatementUtils.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

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
    cost_of_sales_total: 40,
    gross_profit: 60,
    selling_expenses_total: 10,
    administrative_expenses_total: 0,
    other_operating_expenses_total: 0,
    operating_expenses_total: 10,
    operating_profit: 50,
    other_income_total: 0,
    other_expense_total: 0,
    other_result: 0,
    profit_before_tax: 50,
    income_tax_total: 0,
    classified_net_result: 50,
    net_income: 50,
    net_result_label: "Utilidad neta",
    unclassified_debit: 0,
    unclassified_credit: 0,
    unclassified_net_movement: 0,
    unclassified_account_count: 0,
    account_count: 1,
    warnings: [INCOME_STATEMENT_TAX_NOTE],
    sections: [
      section("operating_income", "Ingresos operativos", 100, [{
        account_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        code: "4001",
        name: "Ventas",
        financial_type: "income",
        natural_balance: "credit",
        income_statement_section: "operating_income",
        is_active: true,
        period_debit: 0,
        period_credit: 100,
        amount: 100,
        contrary: false,
        movement_count: 1
      }]),
      section("sales_contra", "Devoluciones y descuentos sobre ventas"),
      section("cost_of_sales", "Costo de ventas", 40),
      section("operating_expense_selling", "Gastos de venta", 10),
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

test("rechaza metadatos incompletos y utilidad neta sin calificar", () => {
  assert.equal(mapIncomeStatementResponse({ report_complete: false, net_income: 10 }).ok, false)
  const incomplete = payload({
    report_complete: false,
    net_income: 50,
    net_result_label: INCOME_STATEMENT_PROVISIONAL_LABEL
  })
  assert.equal(mapIncomeStatementResponse(incomplete).ok, false)
  const missingNet = payload({ net_income: null })
  assert.equal(mapIncomeStatementResponse(missingNet).ok, false)
})

test("acepta reporte incompleto con resultado provisional y cuentas no clasificadas", () => {
  const mapped = mapIncomeStatementResponse(payload({
    report_complete: false,
    net_income: null,
    net_result_label: INCOME_STATEMENT_PROVISIONAL_LABEL,
    classified_net_result: 50,
    unclassified_debit: 7,
    unclassified_credit: 0,
    unclassified_net_movement: 7,
    unclassified_account_count: 1,
    account_count: 2,
    warnings: ["Hay cuentas de resultados con movimientos sin sección. El reporte está incompleto."],
    unclassified_accounts: [{
      account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      code: "IS-UNC",
      name: "Gasto sin clasificar",
      financial_type: "expense",
      natural_balance: "debit",
      is_active: true,
      period_debit: 7,
      period_credit: 0,
      movement_count: 1
    }]
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.netIncome, null)
  assert.equal(mapped.report.classifiedNetResult, 50)
  assert.equal(mapped.report.unclassifiedAccounts[0].code, "IS-UNC")
})

test("rechaza debe negativo y secciones fuera de orden", () => {
  const broken = payload()
  broken.sections[0].accounts[0].period_debit = -1
  assert.equal(mapIncomeStatementResponse(broken).ok, false)
  const swapped = payload()
  const first = swapped.sections[0]
  swapped.sections[0] = swapped.sections[1]
  swapped.sections[1] = first
  assert.equal(mapIncomeStatementResponse(swapped).ok, false)
})

test("la pantalla distingue carga, vacío, error e incompleto", () => {
  assert.equal(resolveIncomeStatementScreen({ canView: true, loading: true, error: "", report: null }).state, "loading")
  assert.equal(resolveIncomeStatementScreen({ canView: true, loading: false, error: "falló", report: null }).state, "error")
  const empty = mapIncomeStatementResponse(payload({
    operating_income_total: 0,
    net_revenue: 0,
    cost_of_sales_total: 0,
    gross_profit: 0,
    selling_expenses_total: 0,
    operating_expenses_total: 0,
    operating_profit: 0,
    profit_before_tax: 0,
    classified_net_result: 0,
    net_income: 0,
    net_result_label: "Utilidad neta",
    account_count: 0,
    sections: payload().sections.map((item) => ({ ...item, subtotal: 0, accounts: [] }))
  }))
  assert.equal(resolveIncomeStatementScreen({ canView: true, loading: false, error: "", report: empty.report }).state, "empty")
})

test("el CSV marca incompleto y neutraliza fórmulas", () => {
  const mapped = mapIncomeStatementResponse(payload({
    report_complete: false,
    net_income: null,
    net_result_label: INCOME_STATEMENT_PROVISIONAL_LABEL,
    unclassified_account_count: 1,
    unclassified_debit: 7,
    unclassified_net_movement: 7,
    account_count: 2,
    unclassified_accounts: [{
      account_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      code: "=cmd",
      name: "Gasto",
      financial_type: "expense",
      natural_balance: "debit",
      is_active: true,
      period_debit: 7,
      period_credit: 0,
      movement_count: 1
    }]
  }))
  const csv = buildIncomeStatementCsv(mapped.report)
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /INCOMPLETO/)
  assert.match(csv, /Resultado provisional de cuentas clasificadas/)
  assert.doesNotMatch(csv, /Utilidad neta/)
  assert.match(csv, /'=cmd/)
})

test("el CSV completo usa utilidad neta y la nota de impuesto", () => {
  const mapped = mapIncomeStatementResponse(payload())
  const csv = buildIncomeStatementCsv(mapped.report)
  assert.match(csv, /COMPLETO/)
  assert.match(csv, /Utilidad neta/)
  assert.match(csv, new RegExp(INCOME_STATEMENT_TAX_NOTE))
})

test("la ventana de fechas reutiliza la regla del mayor", () => {
  const inverted = validateIncomeStatementQuery({ fromDate: "2026-09-30", toDate: "2026-09-01" })
  assert.equal(inverted.ok, false)
  assert.match(inverted.message, /posterior/)
})

test("el contrato no altera Diario, Mayor, Balanza ni el selector de partidas", () => {
  const sql = readFileSync(join(root, "supabase/schema/217_finance_income_statement.sql"), "utf8")
  const reports = readFileSync(join(root, "frontend/src/modules/finance/FinanceAccountingReportsTab.jsx"), "utf8")
  const journal = readFileSync(join(root, "supabase/schema/208_finance_general_journal.sql"), "utf8")
  assert.match(sql, /get_finance_income_statement/)
  assert.match(sql, /income_statement_section/)
  assert.match(sql, /security definer/i)
  assert.match(sql, /search_path = ''/)
  assert.match(sql, /2000/)
  assert.doesNotMatch(sql, /get_finance_general_journal/)
  assert.match(journal, /get_finance_general_journal/)
  assert.match(reports, /FinanceIncomeStatementTab/)
  assert.match(reports, /estado-resultados/)
  assert.deepEqual(filterPostableAccounts([
    { id: "1", account_kind: "detail", accepts_entries: true, is_active: true },
    { id: "2", account_kind: "header", accepts_entries: false, is_active: true }
  ]).map((row) => row.id), ["1"])
})
