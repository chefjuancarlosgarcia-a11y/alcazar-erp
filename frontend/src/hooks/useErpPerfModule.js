import { useEffect, useRef } from "react"
import { useLocation } from "react-router-dom"
import {
  isErpPerfDebugEnabled,
  markErpPerfInteractive,
  markErpPerfRender,
  startErpPerfModule,
  summarizeErpPerfSession
} from "../utils/erpPerf"

/**
 * Dev-only module performance probe.
 * Does not alter data loading — only records mount/render/interactive timings.
 */
export function useErpPerfModule(module, { ready = null } = {}) {
  const location = useLocation()
  const sessionRef = useRef(null)
  const markedInteractiveRef = useRef(false)

  if (isErpPerfDebugEnabled() && !sessionRef.current) {
    sessionRef.current = startErpPerfModule({
      module,
      route: `${location.pathname}${location.search || ""}`
    })
  }

  markErpPerfRender(sessionRef.current?.sessionId)

  useEffect(() => {
    if (!isErpPerfDebugEnabled() || !sessionRef.current?.sessionId) return undefined

    const sessionId = sessionRef.current.sessionId

    return () => {
      summarizeErpPerfSession(sessionId)
    }
  }, [location.pathname, location.search, module])

  useEffect(() => {
    if (!isErpPerfDebugEnabled() || markedInteractiveRef.current) return
    if (ready !== true) return

    markedInteractiveRef.current = true
    const sessionId = sessionRef.current?.sessionId
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        markErpPerfInteractive(sessionId)
      })
    })
  }, [ready, location.pathname, location.search])

  return sessionRef.current
}
