import { useEffect, useState } from "react"

export const TASK_BOARD_SKELETON_DELAY_MS = 200

export function resolveTaskBoardViewState({
  loading = false,
  refreshing = false,
  error = "",
  requestCompleted = false,
  tasks = [],
  itemCount = null,
  hasCachedData = false
} = {}) {
  const count = itemCount ?? tasks.length
  const hasError = Boolean(error)

  if (hasError && hasCachedData) return "error-with-cache"
  if (hasError && requestCompleted && !hasCachedData) return "error-without-cache"
  if (loading && !hasCachedData) return "initial-loading"
  if (refreshing && hasCachedData) return "background-refresh"
  if (
    requestCompleted
    && !loading
    && !refreshing
    && !hasError
    && count === 0
  ) {
    return "success-empty"
  }
  if (hasCachedData || count > 0) return "success-with-data"
  return "initial-loading"
}

export function useDelayedSkeleton(active, delayMs = TASK_BOARD_SKELETON_DELAY_MS) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!active) {
      setShow(false)
      return undefined
    }
    const timer = window.setTimeout(() => setShow(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [active, delayMs])

  return show
}

export function shouldShowTaskBoardContent(viewState) {
  return [
    "success-with-data",
    "background-refresh",
    "error-with-cache"
  ].includes(viewState)
}

export function shouldShowTaskBoardEmpty(viewState) {
  return viewState === "success-empty"
}
