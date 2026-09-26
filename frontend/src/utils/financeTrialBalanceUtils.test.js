import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { filterPostableAccounts } from "./financeJournalValidation.js"
import { TRIAL_BALANCE_MAX_EXPORT_ROWS } from "./financeTrialBalanceConstants.js"
import {
  buildTrialBalanceCsv,
  canExportTrialBalance,
  fetchAllTrialBalanceRows,
  mapTrialBalanceResponse,
  resolveTrialBalanceScreen,
  validateTrialBalanceQuery
} from "./financeTrialBalanceUtils.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

function payload(overrides = {}, rowOverrides = {}) {
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
    account_count: 2,
    match_count: 2,
    search_applied: false,
    page: 1,
    page_size: 50,
    total_pages: 1,
    snapshot_at: "2026-09-26T01:50:36.561863+00:00",
    rows: [
      {
        account_id: "debit-1",
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
      },
      {
        account_id: "credit-1",
        code: "2101",
        name: "Proveedores",
        natural_balance: "credit",
        parent_id: null,
        parent_code: null,
        is_active: true,
        accepts_entries: true,
        opening_debit: 0,
        opening_credit: 0,
        period_debit: 0,
        period_credit: 100,
        closing_debit: 0,
        closing_credit: 100,
        opening_contrary: false,
        closing_contrary: false,
        movement_count: 1
      }
    ],
    ...overrides,
    rows: overrides.rows || [
      {
        account_id: "debit-1",
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
        movement_count: 1,
        ...rowOverrides
      }
    ]
  }
}

test("el selector de partidas no cambia con la balanza", () => {
  const rows = [
    { id: "1", is_active: true, account_kind: "detail", accepts_entries: true },
    { id: "2", is_active: false, account_kind: "detail", accepts_entries: true },
    { id: "3", is_active: true, account_kind: "header", accepts_entries: false }
  ]
  assert.deepEqual(filterPostableAccounts(rows).map((row) => row.id), ["1"])
})

test("mapea una balanza cuadrada y conserva los totales de control", () => {
  const searched = payload({
    search_applied: true,
    match_count: 1,
    account_count: 2,
    period_debit_total: "100.00",
    period_credit_total: "100.00"
  })
  const mapped = mapTrialBalanceResponse(searched)
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.periodDebitTotal, 100)
  assert.equal(mapped.report.periodCreditTotal, 100)
  assert.equal(mapped.report.matchCount, 1)
  assert.equal(mapped.report.accountCount, 2)
  assert.equal(mapped.report.isSquare, true)
  assert.equal(mapped.report.rows[0].closingDebit, 100)
  assert.equal(mapped.report.rows[0].closingCredit, 0)
})

test("acepta un saldo contrario en una sola columna", () => {
  const mapped = mapTrialBalanceResponse(payload({}, {
    opening_debit: 0,
    opening_credit: 0,
    period_debit: 0,
    period_credit: 15,
    closing_debit: 0,
    closing_credit: 15,
    closing_contrary: true,
    natural_balance: "debit"
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.rows[0].closingDebit, 0)
  assert.equal(mapped.report.rows[0].closingCredit, 15)
  assert.equal(mapped.report.rows[0].closingContrary, true)
  assert.equal(mapped.report.rows[0].periodDebit, 0)
  assert.equal(mapped.report.rows[0].periodCredit, 15)
})

test("permite debe y haber del periodo en la misma cuenta", () => {
  const mapped = mapTrialBalanceResponse(payload({}, {
    period_debit: 80,
    period_credit: 80,
    closing_debit: 0,
    closing_credit: 0,
    movement_count: 2
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.rows[0].periodDebit, 80)
  assert.equal(mapped.report.rows[0].periodCredit, 80)
  assert.equal(mapped.report.rows[0].movementCount, 2)
})

test("rechaza el mismo saldo en ambas columnas y los importes negativos", () => {
  const both = mapTrialBalanceResponse(payload({}, {
    closing_debit: 10,
    closing_credit: 10
  }))
  assert.equal(both.ok, false)
  const negative = mapTrialBalanceResponse(payload({}, { period_debit: -5 }))
  assert.equal(negative.ok, false)
})

test("acepta una consulta vacía en la página 1 y una balanza descuadrada", () => {
  const empty = mapTrialBalanceResponse(payload({
    match_count: 0,
    account_count: 0,
    total_pages: 0,
    is_square: true,
    period_debit_total: 0,
    period_credit_total: 0,
    closing_debit_total: 0,
    closing_credit_total: 0,
    rows: []
  }))
  assert.equal(empty.ok, true)
  assert.equal(empty.report.rows.length, 0)
  const unbalanced = mapTrialBalanceResponse(payload({
    is_square: false,
    period_debit_total: 40,
    period_credit_total: 0,
    closing_debit_total: 40,
    closing_credit_total: 0,
    period_difference: 40,
    closing_difference: 40,
    scope: "branch"
  }))
  assert.equal(unbalanced.ok, true)
  assert.equal(unbalanced.report.isSquare, false)
  assert.equal(unbalanced.report.periodDifference, 40)
})

test("valida fechas, intersección vacía y pantallas de carga, vacío, error y descuadre", () => {
  assert.equal(validateTrialBalanceQuery({
    fromDate: "2026-09-30",
    toDate: "2026-09-01"
  }).ok, false)
  assert.match(validateTrialBalanceQuery({
    fromDate: "2026-09-30",
    toDate: "2026-09-01"
  }).message, /posterior/)
  assert.equal(validateTrialBalanceQuery({
    fromDate: "2026-10-01",
    toDate: "2026-10-15",
    period: { id: "p", start_date: "2026-09-01", end_date: "2026-09-30" }
  }).ok, false)
  assert.equal(resolveTrialBalanceScreen({ canView: true, loading: true, error: "", report: null }).state, "loading")
  assert.equal(resolveTrialBalanceScreen({ canView: true, loading: false, error: "fallo", report: null }).state, "error")
  assert.equal(resolveTrialBalanceScreen({
    canView: true,
    loading: false,
    error: "",
    report: { matchCount: 0, isSquare: true }
  }).state, "empty")
  assert.equal(resolveTrialBalanceScreen({
    canView: true,
    loading: false,
    error: "",
    report: { matchCount: 2, isSquare: false }
  }).state, "unbalanced")
})

test("el CSV lleva BOM, escapa fórmulas y rotula los totales del alcance completo", () => {
  const mapped = mapTrialBalanceResponse(payload({
    search_applied: true,
    match_count: 1,
    account_count: 2
  }, {
    code: "=1101",
    name: 'Caja, "principal"'
  }))
  const csv = buildTrialBalanceCsv({ rows: mapped.report.rows, report: mapped.report })
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /'=1101/)
  assert.match(csv, /"Caja, ""principal"""/)
  assert.match(csv, /Totales del alcance completo/)
  assert.match(csv, /alcance completo, no a la suma de las coincidencias/)
  assert.match(csv, /Deudora/)
  assert.doesNotMatch(csv, /get_finance_trial_balance/)
})

test("la exportación aborta por encima de 10000 cuentas y no entrega un archivo parcial si cambia el corte", async () => {
  const over = canExportTrialBalance(TRIAL_BALANCE_MAX_EXPORT_ROWS + 1)
  assert.equal(over.ok, false)
  const pages = []
  const outcome = await fetchAllTrialBalanceRows(async (filters) => {
    pages.push(filters.page)
    return {
      data: {
        snapshotAt: filters.page === 1 ? "T1" : "T2",
        rows: [{ accountId: `a-${filters.page}`, code: "1" }]
      },
      error: ""
    }
  }, {}, 600, "T1")
  assert.equal(outcome.ok, false)
  assert.deepEqual(outcome.rows, [])
  assert.match(outcome.error, /corte/)
})

test("la exportación multipágina conserva el mismo snapshot y junta las cuentas filtradas", async () => {
  const calls = []
  const outcome = await fetchAllTrialBalanceRows(async (filters) => {
    calls.push({ page: filters.page, snapshotAt: filters.snapshotAt, pageSize: filters.pageSize })
    return {
      data: {
        snapshotAt: "T1",
        rows: [{ accountId: `a-${filters.page}` }]
      },
      error: ""
    }
  }, { search: "caja" }, 600, "T1")
  assert.equal(outcome.ok, true)
  assert.equal(outcome.rows.length, 2)
  assert.deepEqual(calls.map((call) => call.snapshotAt), ["T1", "T1"])
  assert.deepEqual(calls.map((call) => call.page), [1, 2])
  assert.equal(calls[0].pageSize, 500)
})

test("el contrato SQL de la balanza no altera Diario ni Mayor", () => {
  const trial = readFileSync(join(root, "supabase/schema/216_finance_trial_balance.sql"), "utf8")
  const journal = readFileSync(join(root, "supabase/schema/208_finance_general_journal.sql"), "utf8")
  const ledger = readFileSync(join(root, "supabase/schema/215_finance_general_ledger.sql"), "utf8")
  const reports = readFileSync(join(root, "frontend/src/modules/finance/FinanceAccountingReportsTab.jsx"), "utf8")
  assert.match(trial, /get_finance_trial_balance/)
  assert.match(trial, /security definer/i)
  assert.match(trial, /search_path = ''/)
  assert.match(trial, /revoke all on function public\.get_finance_trial_balance/)
  assert.match(trial, /from public, anon, service_role/)
  assert.match(trial, /grant execute on function public\.get_finance_trial_balance/)
  assert.match(trial, /to authenticated/)
  assert.match(journal, /get_finance_general_journal/)
  assert.match(ledger, /get_finance_general_ledger/)
  assert.match(reports, /libro-diario/)
  assert.match(reports, /libro-mayor/)
  assert.match(reports, /balanza/)
  assert.match(reports, /FinanceTrialBalanceTab/)
})
