import { GENERAL_JOURNAL_DEFAULT_PAGE_SIZE } from "./financeGeneralJournalConstants.js"
import { validateGeneralJournalDateRange } from "./financeGeneralJournalUtils.js"
import { withJournalListLoading } from "./financeJournalListLoad.js"

/**
 * Snapshot + request guard for Libro Diario loads (stable across report updates).
 */
export function createGeneralJournalLoadController() {
  return {
    snapshotAt: null,
    requestId: 0,
    nextRequestId() {
      this.requestId += 1
      return this.requestId
    },
    isLatestRequest(id) {
      return id === this.requestId
    },
    clearSnapshot() {
      this.snapshotAt = null
    },
    setSnapshot(value) {
      this.snapshotAt = value ?? null
    }
  }
}

/**
 * Resolves p_snapshot_at for the RPC and clears stale snapshot when starting a fresh query.
 */
export function resolveGeneralJournalSnapshotAt(controller, options = {}) {
  const reuseSnapshot = Boolean(options.reuseSnapshot && !options.fresh)
  if (options.fresh || !reuseSnapshot) {
    controller.clearSnapshot()
    return null
  }
  return controller.snapshotAt
}

function buildFetchFilters(filters, targetPage) {
  return {
    fromDate: filters.fromDate || null,
    toDate: filters.toDate || null,
    periodId: filters.periodId || null,
    branchId: filters.branchId || null,
    costCenterId: filters.costCenterId || null,
    accountId: filters.accountId || null,
    search: filters.search || null,
    page: targetPage,
    pageSize: Number(filters.pageSize) || GENERAL_JOURNAL_DEFAULT_PAGE_SIZE
  }
}

/**
 * Loads Libro Diario with loading guard, snapshot reuse and stale-response protection.
 */
export async function fetchGeneralJournalReport({
  canView,
  filters,
  targetPage = 1,
  options = {},
  controller,
  fetchReport,
  onError,
  setLoading,
  onSuccess
}) {
  if (!canView) {
    return { ok: false, skipped: true }
  }

  const dateCheck = validateGeneralJournalDateRange(filters.fromDate, filters.toDate)
  if (!dateCheck.ok) {
    onError?.(dateCheck.message)
    return { ok: false, error: dateCheck.message }
  }

  const requestId = controller.nextRequestId()
  const snapshotAt = resolveGeneralJournalSnapshotAt(controller, options)

  return withJournalListLoading(setLoading, async () => {
    const result = await fetchReport({
      ...buildFetchFilters(filters, targetPage),
      snapshotAt
    })

    if (!controller.isLatestRequest(requestId)) {
      return { ok: false, stale: true }
    }

    if (result.error) {
      onError?.(result.error)
      return { ok: false, error: result.error }
    }

    controller.setSnapshot(result.data?.snapshotAt)
    onSuccess?.(result.data, targetPage)
    return { ok: true, data: result.data, page: targetPage }
  })
}
