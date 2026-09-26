import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { filterPostableAccounts } from "./financeJournalValidation.js"
import {
  applyLedgerSearch,
  buildGeneralLedgerCsv,
  buildLedgerBook,
  buildLedgerEntryHref,
  canExportGeneralLedger,
  compareLedgerRows,
  fetchAllGeneralLedgerRows,
  filterReportDetailAccounts,
  ledgerRowMatchesSearch,
  ledgerScopeLabel,
  ledgerViewState,
  mapGeneralLedgerResponse,
  paginateLedgerDisplay,
  presentLedgerBalance,
  reportAccountStatusMarks,
  resolveGeneralLedgerWindow,
  resolveLedgerScreen,
  signedLedgerCents,
  validateGeneralLedgerQuery
} from "./financeGeneralLedgerUtils.js"
import { GENERAL_LEDGER_MAX_EXPORT_ROWS } from "./financeGeneralLedgerConstants.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const proposalPath = join(root, "supabase/schema/215_finance_general_ledger.sql")

function movement(overrides) {
  return {
    lineId: "line-1",
    entryId: "entry-1",
    entryDate: "2026-09-10",
    entryNumber: "JE-2026-000010",
    entryReference: "REF",
    entryDescription: "Partida",
    lineNumber: 1,
    lineDescription: "Concepto",
    lineReference: "",
    debit: 0,
    credit: 0,
    ...overrides
  }
}

test("el selector de partidas sigue exigiendo cuenta activa de detalle que acepte movimientos", () => {
  const rows = [
    { id: "1", is_active: true, account_kind: "detail", accepts_entries: true },
    { id: "2", is_active: false, account_kind: "detail", accepts_entries: true },
    { id: "3", is_active: true, account_kind: "detail", accepts_entries: false },
    { id: "4", is_active: true, account_kind: "header", accepts_entries: false }
  ]
  assert.deepEqual(filterPostableAccounts(rows).map((row) => row.id), ["1"])
})

test("el selector de reportes incluye detalle inactiva o que ya no acepta movimientos", () => {
  const rows = [
    { id: "1", is_active: false, account_kind: "detail", accepts_entries: false },
    { id: "2", is_active: true, account_kind: "header", accepts_entries: false }
  ]
  assert.deepEqual(filterReportDetailAccounts(rows).map((row) => row.id), ["1"])
  assert.deepEqual(reportAccountStatusMarks(rows[0]), ["Inactiva", "No acepta movimientos"])
})

test("la intersección de periodo y fechas usa el tramo común", () => {
  const period = { id: "p1", start_date: "2026-09-01", end_date: "2026-09-30" }
  const window = resolveGeneralLedgerWindow({ fromDate: "2026-09-10", toDate: "2026-10-05", period })
  assert.equal(window.ok, true)
  assert.equal(window.effectiveFrom, "2026-09-10")
  assert.equal(window.effectiveTo, "2026-09-30")
})

test("una intersección vacía es un error de validación", () => {
  const period = { id: "p1", start_date: "2026-09-01", end_date: "2026-09-30" }
  const window = resolveGeneralLedgerWindow({ fromDate: "2026-10-01", toDate: "2026-10-31", period })
  assert.equal(window.ok, false)
  assert.match(window.message, /no se intersectan/)
})

test("la fecha inicial posterior a la final se rechaza", () => {
  const window = resolveGeneralLedgerWindow({ fromDate: "2026-09-20", toDate: "2026-09-01" })
  assert.equal(window.ok, false)
})

test("naturaleza deudora: saldo = débitos − créditos", () => {
  assert.equal(signedLedgerCents("debit", 100, 40), 6000n)
  const book = buildLedgerBook({
    naturalBalance: "debit",
    openingCents: 0,
    movements: [movement({ debit: 100, credit: 0 }), movement({ lineId: "line-2", lineNumber: 2, debit: 0, credit: 40 })]
  })
  assert.equal(book.closingBalance, 60)
  assert.equal(book.closingSide, "debit")
  assert.equal(book.closingContrary, false)
})

test("naturaleza acreedora: saldo = créditos − débitos", () => {
  const book = buildLedgerBook({
    naturalBalance: "credit",
    openingCents: 0,
    movements: [movement({ debit: 0, credit: 100 }), movement({ lineId: "line-2", lineNumber: 2, debit: 25, credit: 0 })]
  })
  assert.equal(book.closingBalance, 75)
  assert.equal(book.closingSide, "credit")
})

test("un saldo contrario a la naturaleza se muestra y no se oculta", () => {
  const presentation = presentLedgerBalance("debit", -1500)
  assert.equal(presentation.side, "credit")
  assert.equal(presentation.label, "Acreedor")
  assert.equal(presentation.contrary, true)
  assert.equal(presentation.signed, -15)
})

test("el saldo inicial anterior al rango entra al acumulado", () => {
  const book = buildLedgerBook({
    naturalBalance: "debit",
    openingCents: 5000,
    movements: [movement({ debit: 20, credit: 0 })]
  })
  assert.equal(book.openingBalance, 50)
  assert.equal(book.rows[0].runningBalance, 70)
  assert.equal(book.periodDebit, 20)
  assert.equal(book.periodCredit, 0)
})

test("el saldo acumulado de la página 2 incluye los movimientos de la página 1", () => {
  const movements = [1, 2, 3].map((line) => movement({
    lineId: `line-${line}`,
    lineNumber: line,
    entryNumber: `JE-2026-00000${line}`,
    debit: 10,
    credit: 0
  }))
  const book = buildLedgerBook({ naturalBalance: "debit", openingCents: 0, movements })
  const searched = applyLedgerSearch(book, "")
  const page = paginateLedgerDisplay(searched.displayRows, 2, 1)
  assert.equal(page.rows[0].entryNumber, "JE-2026-000002")
  assert.equal(page.rows[0].runningBalance, 20)
  assert.equal(book.closingBalance, 30)
})

test("varias líneas con la misma fecha conservan el orden de partida y línea", () => {
  const rows = [
    movement({ lineId: "b", entryNumber: "JE-2026-000002", lineNumber: 1 }),
    movement({ lineId: "a", entryNumber: "JE-2026-000001", lineNumber: 2 }),
    movement({ lineId: "c", entryNumber: "JE-2026-000001", lineNumber: 1 })
  ].sort(compareLedgerRows)
  assert.deepEqual(rows.map((row) => row.lineId), ["c", "a", "b"])
})

test("la búsqueda no cambia el saldo acumulado ni el saldo final", () => {
  const book = buildLedgerBook({
    naturalBalance: "debit",
    openingCents: 0,
    movements: [
      movement({ debit: 100, credit: 0, entryDescription: "Aporte" }),
      movement({ lineId: "line-2", lineNumber: 2, entryNumber: "JE-2026-000011", debit: 0, credit: 40, entryDescription: "Gasto" })
    ]
  })
  const searched = applyLedgerSearch(book, "Gasto")
  assert.equal(searched.matchCount, 1)
  assert.equal(searched.displayRows[0].runningBalance, 60)
  assert.equal(searched.closingBalance, 60)
  assert.equal(searched.periodDebit, 100)
  assert.equal(searched.periodCredit, 40)
  assert.equal(ledgerRowMatchesSearch(book.rows[0], "Gasto"), false)
})

test("una reversión permanece como movimiento propio", () => {
  const book = buildLedgerBook({
    naturalBalance: "debit",
    openingCents: 10000,
    movements: [
      movement({ debit: 100, credit: 0, isReversal: false }),
      movement({
        lineId: "rev",
        lineNumber: 1,
        entryNumber: "JE-2026-000099",
        entryDate: "2026-09-11",
        debit: 0,
        credit: 100,
        isReversal: true
      })
    ]
  })
  assert.equal(book.rows.length, 2)
  assert.equal(book.rows[1].isReversal, true)
  assert.equal(book.closingBalance, 100)
})

test("borradores y estados no contabilizados no entran al libro construido desde posted", () => {
  const postedOnly = [movement({ debit: 10, credit: 0, status: "posted" })]
    .filter((row) => row.status === "posted")
  const book = buildLedgerBook({ naturalBalance: "debit", openingCents: 0, movements: postedOnly })
  assert.equal(book.movementCount || book.rows.length, 1)
})

test("el enlace abre el detalle de la partida", () => {
  assert.equal(buildLedgerEntryHref("abc"), "/finance?tab=partidas&entry=abc")
})

test("la pantalla oculta el mayor anterior mientras carga otra cuenta", () => {
  const previous = { account: { id: "old" }, matchCount: 3, movementCount: 3, openingBalance: 10, closingBalance: 40 }
  const loading = resolveLedgerScreen({
    canView: true,
    accountId: "new",
    loading: true,
    error: "",
    report: previous
  })
  assert.equal(loading.state, "loading")
  assert.equal(loading.showReport, false)
  const stale = resolveLedgerScreen({
    canView: true,
    accountId: "new",
    loading: false,
    error: "",
    report: previous
  })
  assert.equal(stale.state, "stale")
  assert.equal(stale.showReport, false)
})

test("una cuenta sin movimientos conserva los saldos y no muestra filas", () => {
  const screen = resolveLedgerScreen({
    canView: true,
    accountId: "cash",
    loading: false,
    error: "",
    report: { account: { id: "cash" }, matchCount: 0, movementCount: 0, openingBalance: 12, closingBalance: 12 }
  })
  assert.equal(screen.state, "empty")
  assert.equal(screen.showBalances, true)
})

test("la exportación sin filas conserva el saldo final del alcance", () => {
  const csv = buildGeneralLedgerCsv({
    rows: [],
    report: {
      account: { code: "1.01", name: "Caja", natural_balance: "debit" },
      openingBalance: 12,
      periodDebit: 0,
      periodCredit: 0,
      closingBalance: 12,
      closingSide: "debit",
      openingSide: "debit",
      matchCount: 0
    },
    searchApplied: false
  })
  assert.match(csv, /Saldo final/)
  assert.match(csv, /12\.00/)
  assert.equal(canExportGeneralLedger(0).ok, true)
})

test("los estados de pantalla distinguen cuenta faltante, carga, vacío y error", () => {
  assert.equal(ledgerViewState({ canView: false }), "forbidden")
  assert.equal(ledgerViewState({ canView: true, accountId: "" }), "needs-account")
  assert.equal(ledgerViewState({ canView: true, accountId: "a", loading: true }), "loading")
  assert.equal(ledgerViewState({ canView: true, accountId: "a", error: "falló" }), "error")
  assert.equal(ledgerViewState({ canView: true, accountId: "a", rowCount: 0 }), "empty")
})

test("sucursal y centro de costo cambian la etiqueta de alcance", () => {
  assert.equal(ledgerScopeLabel({}), "Mayor global de la cuenta")
  assert.equal(ledgerScopeLabel({ branchId: "b" }), "Mayor por sucursal")
  assert.equal(ledgerScopeLabel({ costCenterId: "c" }), "Mayor por centro de costo")
  assert.equal(ledgerScopeLabel({ branchId: "b", costCenterId: "c" }), "Mayor por sucursal y centro de costo")
})

test("el CSV conserva el saldo real, el BOM y no usa las coincidencias como saldo final", () => {
  const book = buildLedgerBook({
    naturalBalance: "debit",
    openingCents: 0,
    movements: [
      movement({ debit: 80, credit: 0, entryDescription: "Visible", entryNumber: "=JE" }),
      movement({ lineId: "hidden", lineNumber: 2, entryNumber: "JE-2", debit: 20, credit: 0, entryDescription: "Oculta" })
    ]
  })
  const searched = applyLedgerSearch(book, "Visible")
  const csv = buildGeneralLedgerCsv({
    rows: searched.displayRows.map((row) => ({ ...row, accountCode: "1.01", accountName: "Caja" })),
    report: {
      ...searched,
      account: { code: "1.01", name: "Caja", natural_balance: "debit" },
      matchCount: 1
    },
    searchApplied: true
  })
  assert.equal(csv.charCodeAt(0), 0xfeff)
  assert.match(csv, /Filas filtradas por búsqueda/)
  assert.match(csv, /'=JE/)
  assert.match(csv, /Saldo final/)
  assert.match(csv, /100\.00/)
  assert.match(csv, /No es el saldo final/)
  assert.doesNotMatch(csv, /Oculta/)
})

test("el tope de exportación rechaza más de 10000 filas visibles", () => {
  const guard = canExportGeneralLedger(GENERAL_LEDGER_MAX_EXPORT_ROWS + 1)
  assert.equal(guard.ok, false)
})

test("la exportación multipágina reutiliza el snapshot y concatena páginas", async () => {
  const pages = {
    1: [{ lineId: "1", entryId: "e", runningBalance: 10, debit: 10, credit: 0, entryDate: "2026-09-01", entryNumber: "A", lineNumber: 1, balanceSideLabel: "Deudor", isReversal: false }],
    2: [{ lineId: "2", entryId: "e2", runningBalance: 30, debit: 20, credit: 0, entryDate: "2026-09-02", entryNumber: "B", lineNumber: 1, balanceSideLabel: "Deudor", isReversal: false }]
  }
  const outcome = await fetchAllGeneralLedgerRows(async (filters) => ({
    data: { rows: pages[filters.page], snapshotAt: "2026-09-25T00:00:00Z" },
    error: ""
  }), {}, 2, "2026-09-25T00:00:00Z", 1)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.rows.length, 2)
  assert.equal(outcome.rows[1].runningBalance, 30)
})

function ledgerPayload(overrides = {}) {
  return {
    account: {
      id: "acct",
      code: "STAGE_UI_SMOKE-CASH",
      name: "STAGE UI Smoke - Caja",
      natural_balance: "debit",
      is_active: true,
      accepts_entries: true,
      account_kind: "detail"
    },
    scope: "global",
    effective_from: "2026-09-01",
    effective_to: "2026-09-26",
    opening_balance: 0,
    opening_balance_side: "zero",
    opening_contrary: false,
    period_debit: 0,
    period_credit: 100,
    closing_balance: -100,
    closing_balance_side: "credit",
    closing_contrary: true,
    movement_count: 1,
    match_count: 1,
    search_applied: false,
    rows: [{
      line_id: "line-1",
      entry_id: "entry-1",
      entry_date: "2026-09-25",
      entry_number: "JE-1",
      entry_reference: "",
      entry_description: "smoke",
      line_number: 1,
      line_description: "",
      line_reference: "",
      debit: 0,
      credit: 100,
      running_balance: -100,
      balance_side: "credit",
      balance_side_label: "Acreedor",
      contrary_to_nature: true,
      is_reversal: false,
      reversal_of_entry_number: null
    }],
    page: 1,
    page_size: 50,
    total_pages: 1,
    snapshot_at: "2026-09-26T01:50:36.561863+00:00",
    ...overrides
  }
}

test("acepta el saldo contrario que devuelve el RPC", () => {
  const mapped = mapGeneralLedgerResponse(ledgerPayload())
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.closingBalance, -100)
  assert.equal(mapped.report.openingBalance, 0)
  assert.equal(mapped.report.periodDebit, 0)
  assert.equal(mapped.report.periodCredit, 100)
  assert.equal(mapped.report.rows[0].runningBalance, -100)
  assert.equal(mapped.report.rows[0].debit, 0)
  assert.equal(mapped.report.rows[0].credit, 100)
  assert.equal(mapped.report.closingContrary, true)
})

test("acepta importes firmados cuando llegan como texto", () => {
  const mapped = mapGeneralLedgerResponse(ledgerPayload({
    opening_balance: "0.00",
    period_debit: "0.00",
    period_credit: "100.00",
    closing_balance: "-100.00",
    movement_count: "1",
    match_count: "1",
    page: "1",
    page_size: "50",
    total_pages: "1",
    rows: [{
      ...ledgerPayload().rows[0],
      debit: "0.00",
      credit: "100.00",
      running_balance: "-100.00"
    }]
  }))
  assert.equal(mapped.ok, true)
  assert.equal(mapped.report.closingBalance, -100)
  assert.equal(mapped.report.rows[0].runningBalance, -100)
})

test("acepta página 1 sin movimientos y búsqueda sin coincidencias", () => {
  const empty = mapGeneralLedgerResponse(ledgerPayload({
    opening_balance: 0,
    period_debit: 0,
    period_credit: 0,
    closing_balance: 0,
    closing_contrary: false,
    movement_count: 0,
    match_count: 0,
    total_pages: 0,
    rows: []
  }))
  assert.equal(empty.ok, true)
  assert.equal(empty.report.totalPages, 0)
  assert.equal(empty.report.rows.length, 0)

  const searchMiss = mapGeneralLedgerResponse(ledgerPayload({
    movement_count: 2,
    match_count: 0,
    total_pages: 0,
    search_applied: true,
    rows: []
  }))
  assert.equal(searchMiss.ok, true)
  assert.equal(searchMiss.report.movementCount, 2)
  assert.equal(searchMiss.report.matchCount, 0)
})

test("rechaza metadatos incoherentes del mayor", () => {
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ page: -1 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ page: 0 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ page_size: 0 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ page_size: 501 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ page: 2, total_pages: 1 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ movement_count: -1 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ match_count: 2, movement_count: 1, total_pages: 1 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ snapshot_at: "" })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ snapshot_at: "t" })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({ period_debit: -1 })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({
    rows: [{ ...ledgerPayload().rows[0], debit: -5 }]
  })).ok, false)
  assert.equal(mapGeneralLedgerResponse(ledgerPayload({
    rows: [{ ...ledgerPayload().rows[0], line_id: "" }]
  })).ok, false)
})

test("metadatos inválidos cierran el reporte", () => {
  const mapped = mapGeneralLedgerResponse({ rows: [], opening_balance: "no", closing_balance: 0, period_debit: 0, period_credit: 0, page: 1, page_size: 50, total_pages: 0, match_count: 0, movement_count: 0, snapshot_at: "t" })
  assert.equal(mapped.ok, false)
})

test("la consulta exige cuenta antes de llamar al reporte", () => {
  const missing = validateGeneralLedgerQuery({ accountId: "", fromDate: "2026-09-01", toDate: "2026-09-30" })
  assert.equal(missing.ok, false)
})

test("la migración 215 conserva las reglas del Libro Mayor", () => {
  const sql = readFileSync(proposalPath, "utf8")
  assert.equal(proposalPath.endsWith(`${join("supabase", "schema", "215_finance_general_ledger.sql")}`), true)
  assert.match(sql, /215/)
  assert.doesNotMatch(sql, /NOT A MIGRATION/)
  assert.match(sql, /from public, anon, service_role/)
  assert.match(sql, /El periodo contable y el rango de fechas no se intersectan/)
  assert.match(sql, /rows between unbounded preceding and current row/)
  assert.match(sql, /v_search is null/)
  assert.match(sql, /account_kind <> 'detail'/)
  assert.doesNotMatch(sql, /is_active = true/)
  assert.match(sql, /can_view_accounting/)
  assert.match(sql, /je\.status = 'posted'/)
  assert.match(sql, /La página solicitada está fuera de rango/)
  assert.doesNotMatch(sql, /grant execute on function public\.finance_general_ledger_row_to_json/)
})
