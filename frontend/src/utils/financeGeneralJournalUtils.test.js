import assert from "node:assert/strict"
import test from "node:test"
import {
  buildGeneralJournalCsv,
  canExportGeneralJournal,
  escapeCsvCell,
  fetchAllGeneralJournalRows,
  generalJournalRpcParams,
  groupGeneralJournalRows,
  mapGeneralJournalResponse,
  mapGeneralJournalRow,
  neutralizeCsvFormula,
  resolveGeneralJournalPageSize,
  validateGeneralJournalDateRange
} from "./financeGeneralJournalUtils.js"
import { GENERAL_JOURNAL_MAX_EXPORT_ROWS } from "./financeGeneralJournalConstants.js"

const sampleRow = {
  line_id: "l1",
  entry_id: "e1",
  entry_date: "2026-08-01",
  entry_number: "JE-2026-0001",
  entry_reference: "REF-1",
  entry_description: "Prueba",
  line_number: 1,
  account_id: "a1",
  account_code: "1.01",
  account_name: "Caja",
  line_description: "Detalle",
  line_reference: "",
  branch_id: null,
  branch_code: "",
  branch_name: "",
  cost_center_id: null,
  cost_center_code: "",
  cost_center_name: "",
  debit: "100.00",
  credit: "0.00",
  is_reversal: false,
  reversal_of_id: null,
  reversal_of_entry_number: "",
  reversed_by_entry_id: null
}

test("validateGeneralJournalDateRange rejects inverted range", () => {
  const result = validateGeneralJournalDateRange("2026-08-31", "2026-08-01")
  assert.equal(result.ok, false)
})

test("generalJournalRpcParams maps filters to RPC contract", () => {
  const params = generalJournalRpcParams({
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    periodId: "p1",
    branchId: "b1",
    costCenterId: "c1",
    accountId: "a1",
    search: "JE",
    page: 2,
    pageSize: 50,
    snapshotAt: "2026-08-01T12:00:00Z"
  })
  assert.equal(params.p_from_date, "2026-08-01")
  assert.equal(params.p_page, 2)
  assert.equal(params.p_page_size, 50)
  assert.equal(params.p_snapshot_at, "2026-08-01T12:00:00Z")
})

test("mapGeneralJournalResponse maps totals and rows", () => {
  const mapped = mapGeneralJournalResponse({
    rows: [sampleRow],
    total_rows: 1,
    total_entries: 1,
    total_debit: "100.00",
    total_credit: "100.00",
    difference: "0.00",
    page: 1,
    page_size: 50,
    total_pages: 1,
    snapshot_at: "2026-08-01T12:00:00Z"
  })
  assert.equal(mapped.rows.length, 1)
  assert.equal(mapped.totalRows, 1)
  assert.equal(mapped.totalPages, 1)
  assert.equal(mapped.pageSize, 50)
  assert.equal(mapped.totalDebit, 100)
  assert.equal(mapped.isBalanced, true)
  assert.equal(mapped.snapshotAt, "2026-08-01T12:00:00Z")
})

test("resolveGeneralJournalPageSize prefers applied filters over report", () => {
  const report = mapGeneralJournalResponse({ rows: [], page_size: 50 })
  assert.equal(resolveGeneralJournalPageSize(report, { pageSize: 100 }), 100)
  assert.equal(resolveGeneralJournalPageSize(report, {}), 50)
})

test("mapGeneralJournalRow identifies reversal metadata", () => {
  const mapped = mapGeneralJournalRow({
    ...sampleRow,
    is_reversal: true,
    reversal_of_entry_number: "JE-2026-0000"
  })
  assert.equal(mapped.isReversal, true)
  assert.equal(mapped.reversalOfEntryNumber, "JE-2026-0000")
})

test("groupGeneralJournalRows groups by entry", () => {
  const rowA = mapGeneralJournalRow({ ...sampleRow, line_id: "l1", line_number: 1 })
  const rowB = mapGeneralJournalRow({ ...sampleRow, line_id: "l2", line_number: 2, debit: "0.00", credit: "100.00" })
  const groups = groupGeneralJournalRows([rowA, rowB])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].lines.length, 2)
})

test("escapeCsvCell escapes commas and quotes", () => {
  assert.equal(escapeCsvCell('a,"b"'), '"a,""b"""')
})

test("neutralizeCsvFormula prefixes dangerous values", () => {
  assert.equal(neutralizeCsvFormula("=1+1"), "'=1+1")
  assert.equal(neutralizeCsvFormula("-100"), "'-100")
})

test("buildGeneralJournalCsv includes BOM and totals", () => {
  const row = mapGeneralJournalRow(sampleRow)
  const csv = buildGeneralJournalCsv([row], {
    totalDebit: 100,
    totalCredit: 100,
    difference: 0,
    isBalanced: true
  })
  assert.ok(csv.startsWith("\uFEFF"))
  assert.match(csv, /Totales/)
  assert.match(csv, /Cuadrado/)
})

test("canExportGeneralJournal blocks above limit", () => {
  const result = canExportGeneralJournal(GENERAL_JOURNAL_MAX_EXPORT_ROWS + 1)
  assert.equal(result.ok, false)
})

test("fetchAllGeneralJournalRows reuses snapshot and returns matching totals", async () => {
  const calls = []
  const fetchPage = async (filters) => {
    calls.push(filters)
    const page = filters.page
    return {
      data: {
        rows: page === 1 ? [mapGeneralJournalRow(sampleRow)] : [],
        totalRows: 1,
        totalDebit: 100,
        totalCredit: 100,
        difference: 0,
        isBalanced: true,
        snapshotAt: "2026-08-01T12:00:00Z"
      },
      error: ""
    }
  }
  const outcome = await fetchAllGeneralJournalRows(fetchPage, { search: "JE" }, 1)
  assert.equal(outcome.ok, true)
  assert.equal(outcome.rows.length, 1)
  assert.equal(outcome.snapshotAt, "2026-08-01T12:00:00Z")
  assert.equal(outcome.totals.totalDebit, 100)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].snapshotAt, null)
})
