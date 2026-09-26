import { GENERAL_LEDGER_DEFAULT_PAGE_SIZE } from "./financeGeneralLedgerConstants.js"
import { validateGeneralLedgerQuery } from "./financeGeneralLedgerUtils.js"
import {
  createGeneralJournalLoadController,
  resolveGeneralJournalSnapshotAt
} from "./financeGeneralJournalLoad.js"
import { withJournalListLoading } from "./financeJournalListLoad.js"

export { createGeneralJournalLoadController as createGeneralLedgerLoadController }

export async function fetchGeneralLedgerReport({
  canView,
  filters,
  period = null,
  targetPage = 1,
  options = {},
  controller,
  fetchReport,
  onError,
  onStart,
  setLoading,
  onSuccess
}) {
  if (!canView) return { ok: false, skipped: true }

  const check = validateGeneralLedgerQuery({
    accountId: filters.accountId,
    fromDate: filters.fromDate,
    toDate: filters.toDate,
    period
  })
  if (!check.ok) {
    onError?.(check.message)
    return { ok: false, error: check.message }
  }

  const requestId = controller.nextRequestId()
  const snapshotAt = resolveGeneralJournalSnapshotAt(controller, options)
  onStart?.()

  return withJournalListLoading(setLoading, async () => {
    const result = await fetchReport({
      ...filters,
      page: targetPage,
      pageSize: Number(filters.pageSize) || GENERAL_LEDGER_DEFAULT_PAGE_SIZE,
      snapshotAt
    })
    if (!controller.isLatestRequest(requestId)) return { ok: false, stale: true }
    if (result.error) {
      onError?.(result.error)
      return { ok: false, error: result.error }
    }
    controller.setSnapshot(result.data.snapshotAt)
    onSuccess?.(result.data, targetPage)
    return { ok: true, data: result.data }
  })
}
