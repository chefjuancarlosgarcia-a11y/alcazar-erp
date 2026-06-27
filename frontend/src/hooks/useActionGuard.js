import { useCallback, useRef, useState } from "react"
import { runGuardedAction } from "../utils/actionGuard"

export function useActionGuard() {
  const [busy, setBusy] = useState(false)
  const inFlightRef = useRef(false)

  const run = useCallback(
    (action) => runGuardedAction(inFlightRef, setBusy, action),
    []
  )

  return { busy, run, inFlightRef }
}
