/** Pure idle/touch policy for OS2 operator sessions (browser tests + reuse). */

export const OPERATOR_IDLE_DEBOUNCE_MS = 18000

export function isOperatorSessionExpired(idleExpiresAt, nowMs = Date.now()) {
  if (!idleExpiresAt) return true
  const exp = new Date(idleExpiresAt).getTime()
  if (Number.isNaN(exp)) return true
  return nowMs >= exp
}

export function shouldSendOperatorTouch({ activityPending, lastTouchSentAt, nowMs, debounceMs }) {
  if (!activityPending) return false
  if (nowMs - lastTouchSentAt < debounceMs) return false
  return true
}

export function afterSuccessfulOperatorTouch(state) {
  return {
    ...state,
    activityPending: false,
    lastTouchSentAt: state.nowMs
  }
}

export function onHumanOperatorActivity(state) {
  return { ...state, activityPending: true }
}
