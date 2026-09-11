/**
 * Loads journal entries and maps service errors without throwing.
 * Used by FinanceJournalEntriesTab to avoid unhandled promise rejections.
 */
export async function loadJournalEntriesForList({ canView, fetchEntries, onError }) {
  if (!canView) {
    return { ok: false, skipped: true }
  }

  try {
    const result = await fetchEntries()
    if (result.error) {
      onError?.(result.error)
      return { ok: false, error: result.error }
    }
    return { ok: true, entries: result.data }
  } catch (error) {
    const message = error?.message || "Error al cargar partidas contables."
    onError?.(message)
    return { ok: false, error: message }
  }
}

/**
 * Ensures loading UI flags are cleared even when the async task rejects.
 */
export async function withJournalListLoading(setLoading, task) {
  setLoading(true)
  try {
    return await task()
  } finally {
    setLoading(false)
  }
}
