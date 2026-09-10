import assert from "node:assert/strict"
import test from "node:test"
import { normalizePaginationState } from "./pagination.js"
import {
  formatGeneralJournalSummary,
  mapGeneralJournalResponse,
  resolveGeneralJournalPageSize
} from "./financeGeneralJournalUtils.js"
import {
  createGeneralJournalLoadController,
  fetchGeneralJournalReport
} from "./financeGeneralJournalLoad.js"

const baseFilters = {
  fromDate: "2026-08-01",
  toDate: "2026-08-31",
  periodId: "",
  branchId: "",
  costCenterId: "",
  accountId: "",
  search: "",
  pageSize: 50
}

test("formatGeneralJournalSummary pluralizes lines and entries", () => {
  assert.equal(formatGeneralJournalSummary(0, 0), "0 líneas · 0 partidas")
  assert.equal(formatGeneralJournalSummary(1, 1), "1 línea · 1 partida")
  assert.equal(formatGeneralJournalSummary(2, 1), "2 líneas · 1 partida")
  assert.equal(formatGeneralJournalSummary(120, 60), "120 líneas · 60 partidas")
})

test("stage smoke: 2 lines and 1 entry hide pagination and show summary", () => {
  const report = mapGeneralJournalResponse({
    rows: [{ line_id: "l1" }, { line_id: "l2" }],
    total_rows: 2,
    total_entries: 1,
    total_debit: "100.00",
    total_credit: "100.00",
    difference: "0.00",
    page: 1,
    page_size: 50,
    total_pages: 1
  })

  const summary = formatGeneralJournalSummary(report.totalRows, report.totalEntries)
  const pagination = normalizePaginationState({
    page: 1,
    total: report.totalRows,
    pageSize: resolveGeneralJournalPageSize(report, baseFilters)
  })

  assert.equal(summary, "2 líneas · 1 partida")
  assert.equal(pagination.showControls, false)
  assert.ok(!summary.includes("NaN"))
})

test("mapGeneralJournalResponse fail-closed on invalid numeric metadata", () => {
  const mapped = mapGeneralJournalResponse({
    rows: [],
    total_rows: "bad",
    total_entries: "-3",
    page: 0,
    page_size: "0",
    total_pages: "NaN"
  })

  assert.equal(mapped.totalRows, 0)
  assert.equal(mapped.totalEntries, 0)
  assert.equal(mapped.page, 1)
  assert.equal(mapped.pageSize, 50)
  assert.equal(mapped.totalPages, 0)
  assert.ok(!Number.isNaN(mapped.totalRows))
  assert.ok(!Number.isNaN(mapped.page))
})

test("mapGeneralJournalResponse accepts numeric strings", () => {
  const mapped = mapGeneralJournalResponse({
    rows: [],
    total_rows: "120",
    total_entries: "60",
    page: "2",
    page_size: "50",
    total_pages: "3"
  })

  assert.equal(mapped.totalRows, 120)
  assert.equal(mapped.totalEntries, 60)
  assert.equal(mapped.page, 2)
  assert.equal(mapped.pageSize, 50)
  assert.equal(mapped.totalPages, 3)
})

test("general journal page change loads once with p_page 2 and snapshot reuse", async () => {
  const controller = createGeneralJournalLoadController()
  const calls = []

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport: async (params) => {
      calls.push(params)
      return {
        data: mapGeneralJournalResponse({
          rows: [],
          total_rows: 120,
          total_entries: 60,
          total_debit: "0",
          total_credit: "0",
          difference: "0",
          page: params.page,
          page_size: params.pageSize,
          total_pages: 3,
          snapshot_at: "SNAP-1"
        }),
        error: null
      }
    },
    setLoading: () => {},
    onSuccess: () => {}
  })

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 2,
    options: { reuseSnapshot: true },
    controller,
    fetchReport: async (params) => {
      calls.push(params)
      return {
        data: mapGeneralJournalResponse({
          rows: [],
          total_rows: 120,
          total_entries: 60,
          total_debit: "0",
          total_credit: "0",
          difference: "0",
          page: params.page,
          page_size: params.pageSize,
          total_pages: 3,
          snapshot_at: "SNAP-1"
        }),
        error: null
      }
    },
    setLoading: () => {},
    onSuccess: () => {}
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].page, 1)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(calls[1].page, 2)
  assert.equal(calls[1].snapshotAt, "SNAP-1")
})
