import { validateBalanceSheetQuery } from "./financeBalanceSheetUtils.js"
import {
  createGeneralJournalLoadController,
  resolveGeneralJournalSnapshotAt
} from "./financeGeneralJournalLoad.js"
import { withJournalListLoading } from "./financeJournalListLoad.js"

export { createGeneralJournalLoadController as createBalanceSheetLoadController }

export async function fetchBalanceSheetReport({
  canView,
  filters,
  options = {},
  controller,
  fetchReport,
  onError,
  onStart,
  setLoading,
  onSuccess
}) {
  if (!canView) return { ok: false, skipped: true }

  const check = validateBalanceSheetQuery({ cutoffDate: filters.cutoffDate })
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
      snapshotAt
    })
    if (!controller.isLatestRequest(requestId)) return { ok: false, stale: true }
    if (result.error) {
      onError?.(result.error)
      return { ok: false, error: result.error }
    }
    controller.setSnapshot(result.data.snapshotAt)
    onSuccess?.(result.data)
    return { ok: true, data: result.data }
  })
}
