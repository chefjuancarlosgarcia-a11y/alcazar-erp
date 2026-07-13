import { useEffect, useRef } from "react"

const FOCUS_DEBOUNCE_MS = 2500
const FOCUS_SETTLE_MS = 400

export function formatLastSyncedAt(value) {
  if (!value) return "Sin sincronizar"
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin sincronizar"
  return date.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

export function isServerTaskNewer(serverUpdatedAt, baselineUpdatedAt) {
  if (!serverUpdatedAt || !baselineUpdatedAt) return false
  const serverMs = new Date(serverUpdatedAt).getTime()
  const baselineMs = new Date(baselineUpdatedAt).getTime()
  if (Number.isNaN(serverMs) || Number.isNaN(baselineMs)) return false
  return serverMs > baselineMs
}

/**
 * Debounced refetch when the browser tab becomes visible again.
 */
export function useTaskFocusRefresh({
  enabled = true,
  onRefresh,
  hasUnsavedEdits
}) {
  const lastRunRef = useRef(0)
  const timerRef = useRef(null)
  const mountedRef = useRef(true)
  const onRefreshRef = useRef(onRefresh)
  const hasUnsavedRef = useRef(hasUnsavedEdits)

  useEffect(() => {
    onRefreshRef.current = onRefresh
  }, [onRefresh])

  useEffect(() => {
    hasUnsavedRef.current = hasUnsavedEdits
  }, [hasUnsavedEdits])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined

    function runRefresh() {
      if (!mountedRef.current) return
      if (hasUnsavedRef.current?.()) return
      const now = Date.now()
      if (now - lastRunRef.current < FOCUS_DEBOUNCE_MS) return
      lastRunRef.current = now
      onRefreshRef.current?.({ source: "focus" })
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") return
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(runRefresh, FOCUS_SETTLE_MS)
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
      if (timerRef.current) window.clearTimeout(timerRef.current)
    }
  }, [enabled])
}

/**
 * After a mutation: apply optimistic/local data, then confirm with server refetch.
 */
export async function confirmOperationalMutation({
  applyLocal,
  mutate,
  refreshList,
  refreshDetail,
  onError
}) {
  let snapshot = null
  if (applyLocal) {
    snapshot = applyLocal()
  }

  const result = await mutate()
  if (result?.error) {
    applyLocal?.(snapshot, { rollback: true })
    onError?.(result.error)
    return result
  }

  if (result?.data && applyLocal) {
    applyLocal(result.data, { commit: true })
  }

  if (refreshList) {
    await refreshList({ background: true })
  }
  if (refreshDetail) {
    await refreshDetail({ background: true, mutationResult: result.data })
  }

  return result
}
