import { TRIAL_BALANCE_DEFAULT_PAGE_SIZE } from "./financeTrialBalanceConstants.js"
import { validateTrialBalanceQuery } from "./financeTrialBalanceUtils.js"
import {
  createGeneralJournalLoadController,
  resolveGeneralJournalSnapshotAt
} from "./financeGeneralJournalLoad.js"
import { withJournalListLoading } from "./financeJournalListLoad.js"

export { createGeneralJournalLoadController as createTrialBalanceLoadController }

export async function fetchTrialBalanceReport({
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

  const check = validateTrialBalanceQuery({
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
      pageSize: Number(filters.pageSize) || TRIAL_BALANCE_DEFAULT_PAGE_SIZE,
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
