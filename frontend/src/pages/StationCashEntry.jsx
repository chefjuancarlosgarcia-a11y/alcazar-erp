import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import CashManagement from "./CashManagement"
import {
  clearOperatorSession,
  loadOperatorSessionMeta,
  loadOperatorSessionToken,
  lockOperatorSession,
  saveOperatorSession,
  touchOperatorSession,
  verifyOperationalPin
} from "../services/operationalStationAccessService"
import { createStationCashPort } from "../services/stationCashService"
import {
  isOperatorSessionExpired,
  OPERATOR_IDLE_DEBOUNCE_MS,
  shouldSendOperatorTouch
} from "../services/operationalOperatorIdle"
import { useAuth } from "../context/AuthContext"
import "./StationCashEntry.css"

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "enter"]

export default function StationCashEntry() {
  const { stationDeviceContext } = useAuth()
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [operatorMeta, setOperatorMeta] = useState(() => loadOperatorSessionMeta())
  const [sessionToken, setSessionToken] = useState(() => loadOperatorSessionToken())
  const activityPendingRef = useRef(false)
  const lastTouchSentAtRef = useRef(0)
  const touchInFlightRef = useRef(false)

  const stationName = stationDeviceContext?.station_name || "Caja Principal"
  const isCashStation = stationDeviceContext?.station_type === "cash"

  const handleOperatorLocked = useCallback((message) => {
    clearOperatorSession()
    setSessionToken("")
    setOperatorMeta(null)
    setPin("")
    activityPendingRef.current = false
    setError(message || "Estación bloqueada. Ingrese su PIN para continuar.")
  }, [])

  const syncIdleFromMeta = useCallback(() => {
    const meta = loadOperatorSessionMeta()
    if (meta) setOperatorMeta(meta)
    return meta
  }, [])

  const checkLocalExpiry = useCallback(() => {
    const meta = loadOperatorSessionMeta()
    if (!sessionToken || !meta?.idleExpiresAt) return
    if (isOperatorSessionExpired(meta.idleExpiresAt)) {
      handleOperatorLocked("Sesión operativa expirada. Ingrese su PIN.")
    }
  }, [sessionToken, handleOperatorLocked])

  const flushOperatorTouch = useCallback(async () => {
    if (!sessionToken || touchInFlightRef.current) return
    const nowMs = Date.now()
    if (
      !shouldSendOperatorTouch({
        activityPending: activityPendingRef.current,
        lastTouchSentAt: lastTouchSentAtRef.current,
        nowMs,
        debounceMs: OPERATOR_IDLE_DEBOUNCE_MS
      })
    ) {
      return
    }
    const meta = loadOperatorSessionMeta()
    if (isOperatorSessionExpired(meta?.idleExpiresAt, nowMs)) {
      handleOperatorLocked("Sesión operativa expirada. Ingrese su PIN.")
      return
    }
    touchInFlightRef.current = true
    const { data } = await touchOperatorSession(sessionToken)
    touchInFlightRef.current = false
    if (!data?.ok) {
      handleOperatorLocked("Sesión operativa expirada. Ingrese su PIN.")
      return
    }
    activityPendingRef.current = false
    lastTouchSentAtRef.current = nowMs
    if (data.idle_expires_at) {
      saveOperatorSession(sessionToken, {
        ...meta,
        idleExpiresAt: data.idle_expires_at
      })
    }
    syncIdleFromMeta()
  }, [sessionToken, handleOperatorLocked, syncIdleFromMeta])

  const markHumanActivity = useCallback(() => {
    activityPendingRef.current = true
    void flushOperatorTouch()
  }, [flushOperatorTouch])

  /* eslint-disable react-hooks/refs -- port callbacks invoked only from async RPC/UI handlers */
  const cashPort = useMemo(() => {
    if (!sessionToken) return null
    return createStationCashPort(sessionToken, {
      onOperatorLocked: () => handleOperatorLocked(),
      onContextLoaded: (idleExpiresAt) => {
        if (idleExpiresAt) {
          const meta = loadOperatorSessionMeta()
          saveOperatorSession(sessionToken, { ...meta, idleExpiresAt })
          syncIdleFromMeta()
        }
      }
    })
  }, [sessionToken, handleOperatorLocked, syncIdleFromMeta])
  /* eslint-enable react-hooks/refs */

  useEffect(() => {
    if (!sessionToken) return undefined
    const expiryTimer = setInterval(checkLocalExpiry, 1000)
    return () => clearInterval(expiryTimer)
  }, [sessionToken, checkLocalExpiry])

  useEffect(() => {
    if (!sessionToken) return undefined
    const onPointer = (event) => {
      if (event.isTrusted) markHumanActivity()
    }
    const onKey = (event) => {
      if (event.isTrusted) markHumanActivity()
    }
    window.addEventListener("pointerdown", onPointer)
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onPointer)
      window.removeEventListener("keydown", onKey)
    }
  }, [sessionToken, markHumanActivity])

  if (!isCashStation) {
    return (
      <section className="erp-page-shell station-cash-entry">
        <p>Esta terminal no es una estación tipo Caja.</p>
      </section>
    )
  }

  async function submitPin(nextPin) {
    if (nextPin.length !== 4) return
    setBusy(true)
    setError("")
    const { data, error: verifyError } = await verifyOperationalPin({ pin: nextPin, module: "cash" })
    setBusy(false)
    if (verifyError || !data?.ok) {
      setPin("")
      setError("PIN o acceso no válido.")
      return
    }
    const token = loadOperatorSessionToken()
    setSessionToken(token)
    setOperatorMeta(loadOperatorSessionMeta())
    activityPendingRef.current = false
    lastTouchSentAtRef.current = 0
    setPin("")
  }

  function onKey(key) {
    if (busy) return
    if (key === "clear") {
      setPin("")
      setError("")
      return
    }
    if (key === "enter") {
      submitPin(pin)
      return
    }
    if (pin.length >= 4) return
    const next = pin + key
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  async function handleLock() {
    await lockOperatorSession("manual_lock")
    handleOperatorLocked()
  }

  if (sessionToken && operatorMeta?.operatorName && cashPort) {
    return (
      <section className="erp-page-shell station-cash-entry station-cash-entry--active">
        <header className="station-cash-entry-header erp-section-stack">
          <div>
            <p className="station-cash-entry-eyebrow">Estación operativa</p>
            <h1>{stationName}</h1>
            <p className="station-cash-entry-operator">Operando como {operatorMeta.operatorName}</p>
          </div>
          <button type="button" className="station-cash-entry-lock" onClick={handleLock}>
            Bloquear estación
          </button>
        </header>
        <CashManagement
          cashPort={cashPort}
          uiConfig={{
            title: stationName,
            eyebrow: "Caja en estación",
            operatorBanner: `Operando como ${operatorMeta.operatorName}`,
            onOperatorLocked: () => handleOperatorLocked(),
            onHumanActivity: markHumanActivity,
            onFunctionalCashAction: markHumanActivity
          }}
        />
      </section>
    )
  }

  return (
    <section className="erp-page-shell station-cash-entry">
      <header className="station-cash-entry-header">
        <h1>{stationName} — Ingrese su PIN</h1>
        <p className="station-cash-entry-muted">Acceso operativo individual (4 dígitos)</p>
      </header>
      {error && <p className="station-cash-entry-error">{error}</p>}
      <div className="station-cash-pin-display" aria-live="polite">
        {pin.padEnd(4, "•").slice(0, 4).replace(/\d/g, "•")}
      </div>
      <div className="station-cash-pin-pad">
        {PIN_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`station-cash-pin-key station-cash-pin-key--${key}`}
            disabled={busy}
            onClick={() => onKey(key === "enter" ? "enter" : key === "clear" ? "clear" : key)}
          >
            {key === "enter" ? "OK" : key === "clear" ? "⌫" : key}
          </button>
        ))}
      </div>
    </section>
  )
}
