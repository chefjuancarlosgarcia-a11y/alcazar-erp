/**
 * Runs an async action once while a guard is active.
 * @returns {Promise<{ skipped?: boolean, value?: unknown }>}
 */
export async function runGuardedAction(inFlightRef, setBusy, action) {
  if (inFlightRef?.current) return { skipped: true }
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
