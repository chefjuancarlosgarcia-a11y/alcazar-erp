import { logPerformanceEvent } from "./performanceLogger"

/**
 * Runs an async action once while a guard is active.
 * @returns {Promise<{ skipped?: boolean, value?: unknown }>}
 */
export async function runGuardedAction(inFlightRef, setBusy, action) {
  if (inFlightRef?.current) {
    logPerformanceEvent({
      module: "guard",
      action: "duplicate_action",
      event_type: "guard_skipped",
      status: "skipped",
      severity: "warn",
      message: "Action skipped due to in-flight guard",
      metadata: { source: "actionGuard" }
    })
    return { skipped: true }
  }
  inFlightRef.current = true
  if (typeof setBusy === "function") setBusy(true)
  try {
    const value = await action()
    return { value }
  } finally {
    inFlightRef.current = false
    if (typeof setBusy === "function") setBusy(false)
  }
}
