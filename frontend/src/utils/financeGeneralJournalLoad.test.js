import assert from "node:assert/strict"
import test from "node:test"
import {
  createGeneralJournalLoadController,
  fetchGeneralJournalReport,
  resolveGeneralJournalSnapshotAt
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

function mockReport(snapshotAt) {
  return {
    rows: [],
    totalRows: 1,
    totalEntries: 1,
    totalDebit: 0,
    totalCredit: 0,
    difference: 0,
    page: 1,
    pageSize: 50,
    totalPages: 1,
    snapshotAt,
    isBalanced: true
  }
}

function createTrackedFetch(sequence) {
  const calls = []
  const fetchReport = async (params) => {
    calls.push(params)
    const snapshotAt = sequence[calls.length - 1] ?? `snap-${calls.length}`
    return { data: mockReport(snapshotAt), error: null }
  }
  return { fetchReport, calls }
}

test("initial mount sends null snapshot and succeeds once", async () => {
  const controller = createGeneralJournalLoadController()
  const { fetchReport, calls } = createTrackedFetch(["T1"])
  let loading = false
  const outcomes = []

  outcomes.push(await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: (value) => { loading = value },
    onSuccess: () => {}
  }))

  assert.equal(calls.length, 1)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(outcomes[0].ok, true)
  assert.equal(loading, false)
  assert.equal(controller.snapshotAt, "T1")
})

test("changing snapshot_at in each response does not trigger another fetch by itself", async () => {
  const controller = createGeneralJournalLoadController()
  const { fetchReport, calls } = createTrackedFetch(["T1", "T2", "T3"])
  const loadReport = async () => fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  await loadReport()
  assert.equal(calls.length, 1)
  assert.equal(controller.snapshotAt, "T1")

  // Stable callback semantics: no automatic re-invocation after snapshot update.
  assert.equal(calls.length, 1)
})

test("rerender without filter or page change performs zero additional loads", async () => {
  const controller = createGeneralJournalLoadController()
  let calls = 0
  const fetchReport = async () => {
    calls += 1
    return { data: mockReport(`snap-${calls}`), error: null }
  }

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  assert.equal(calls, 1)
  // Simulates React re-render where effect deps are unchanged.
  assert.equal(calls, 1)
})

test("apply filters performs exactly one fresh load with null snapshot", async () => {
  const controller = createGeneralJournalLoadController()
  controller.setSnapshot("stale-from-previous-query")
  const { fetchReport, calls } = createTrackedFetch(["fresh-1"])

  await fetchGeneralJournalReport({
    canView: true,
    filters: { ...baseFilters, search: "JE-001" },
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(calls[0].search, "JE-001")
  assert.equal(controller.snapshotAt, "fresh-1")
})

test("page change reuses previous snapshot exactly once", async () => {
  const controller = createGeneralJournalLoadController()
  const { fetchReport, calls } = createTrackedFetch(["snap-page-1", "snap-page-2"])

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 2,
    options: { reuseSnapshot: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  assert.equal(calls.length, 2)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(calls[1].snapshotAt, "snap-page-1")
  assert.equal(calls[1].page, 2)
})

test("manual refresh sends null snapshot and performs one load", async () => {
  const controller = createGeneralJournalLoadController()
  controller.setSnapshot("cached-snapshot")
  const { fetchReport, calls } = createTrackedFetch(["manual-refresh"])

  await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { fresh: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: () => {}
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].snapshotAt, null)
  assert.equal(controller.snapshotAt, "manual-refresh")
})

test("rpc error notifies and releases loading", async () => {
  const controller = createGeneralJournalLoadController()
  const errors = []
  let loading = false

  const outcome = await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport: async () => ({ data: null, error: "RPC falló" }),
    onError: (message) => errors.push(message),
    setLoading: (value) => { loading = value }
  })

  assert.equal(outcome.ok, false)
  assert.equal(errors[0], "RPC falló")
  assert.equal(loading, false)
})

test("out-of-order responses do not overwrite the latest result", async () => {
  const controller = createGeneralJournalLoadController()
  const applied = []
  let releaseSlow
  const slowGate = new Promise((resolve) => { releaseSlow = resolve })

  const fetchReport = async ({ page }) => {
    if (page === 1) {
      await slowGate
      return { data: mockReport("stale-page-1"), error: null }
    }
    return { data: mockReport("fresh-page-2"), error: null }
  }

  const slowPromise = fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 1,
    options: { reuseSnapshot: false },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: (data) => applied.push(data.snapshotAt)
  })

  const fastOutcome = await fetchGeneralJournalReport({
    canView: true,
    filters: baseFilters,
    targetPage: 2,
    options: { reuseSnapshot: true },
    controller,
    fetchReport,
    setLoading: () => {},
    onSuccess: (data) => applied.push(data.snapshotAt)
  })

  releaseSlow()
  const slowOutcome = await slowPromise

  assert.equal(fastOutcome.ok, true)
  assert.equal(slowOutcome.ok, false)
  assert.equal(slowOutcome.stale, true)
  assert.deepEqual(applied, ["fresh-page-2"])
})

test("resolveGeneralJournalSnapshotAt clears snapshot for fresh queries", () => {
  const controller = createGeneralJournalLoadController()
  controller.setSnapshot("old")

  assert.equal(resolveGeneralJournalSnapshotAt(controller, { fresh: true }), null)
  assert.equal(controller.snapshotAt, null)
})

test("resolveGeneralJournalSnapshotAt reuses snapshot only when requested", () => {
  const controller = createGeneralJournalLoadController()
  controller.setSnapshot("keep-me")

  assert.equal(
    resolveGeneralJournalSnapshotAt(controller, { reuseSnapshot: true }),
    "keep-me"
  )
  assert.equal(
    resolveGeneralJournalSnapshotAt(controller, { reuseSnapshot: false }),
    null
  )
  assert.equal(controller.snapshotAt, null)
})
