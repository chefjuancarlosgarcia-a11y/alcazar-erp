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

const PIN_LENGTH = 4
const GENERIC_PIN_ERROR = "PIN o acceso no válido."

function normalizePinDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, PIN_LENGTH)
}

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
  const pinInputRef = useRef(null)

  const stationName = stationDeviceContext?.station_name || "Caja Principal"
  const isCashStation = stationDeviceContext?.station_type === "cash"
  const pinDigitCount = pin.length
  const canSubmitPin = pinDigitCount === PIN_LENGTH && !busy

  const focusPinInput = useCallback(() => {
    pinInputRef.current?.focus()
  }, [])

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

  const submitPin = useCallback(async (nextPin) => {
    if (nextPin.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError("")
    const { data, error: verifyError } = await verifyOperationalPin({ pin: nextPin, module: "cash" })
    setBusy(false)
    if (verifyError || !data?.ok) {
      setPin("")
      setError(GENERIC_PIN_ERROR)
      requestAnimationFrame(() => focusPinInput())
      return
    }
    const token = loadOperatorSessionToken()
    setSessionToken(token)
    setOperatorMeta(loadOperatorSessionMeta())
    activityPendingRef.current = false
    lastTouchSentAtRef.current = 0
    setPin("")
  }, [busy, focusPinInput])

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

  useEffect(() => {
    if (sessionToken || !isCashStation) return undefined
    focusPinInput()
    return undefined
  }, [sessionToken, isCashStation, focusPinInput])

  function handlePinChange(event) {
    if (busy) return
    setPin(normalizePinDigits(event.target.value))
    if (error) setError("")
  }

  function handlePinPaste(event) {
    event.preventDefault()
    if (busy) return
    setPin(normalizePinDigits(event.clipboardData.getData("text")))
    if (error) setError("")
  }

  function handlePinKeyDown(event) {
    if (event.key !== "Enter") return
    event.preventDefault()
    if (canSubmitPin) void submitPin(pin)
  }

  function handlePinFormSubmit(event) {
    event.preventDefault()
    if (canSubmitPin) void submitPin(pin)
  }

  async function handleLock() {
    await lockOperatorSession("manual_lock")
    handleOperatorLocked()
  }

  if (!isCashStation) {
    return (
      <section className="erp-page-shell station-cash-entry">
        <p>Esta terminal no es una estación tipo Caja.</p>
      </section>
    )
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
      {error && (
        <p className="station-cash-entry-error" role="alert">
          {error}
        </p>
      )}
      <form className="station-cash-pin-form" onSubmit={handlePinFormSubmit} noValidate>
        <div
          className="station-cash-pin-field"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget || event.target.closest(".station-cash-pin-cell")) {
              focusPinInput()
            }
          }}
        >
          <div className="station-cash-pin-cells">
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                className={
                  pin[index]
                    ? "station-cash-pin-cell station-cash-pin-cell--filled"
                    : "station-cash-pin-cell"
                }
                aria-hidden="true"
              >
                {pin[index] ? "●" : ""}
              </span>
            ))}
          </div>
          <input
            ref={pinInputRef}
            id="station-operational-pin"
            name="station-operational-pin"
            className="station-cash-pin-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            enterKeyHint="go"
            aria-label="PIN operativo de 4 dígitos"
            aria-describedby="station-cash-pin-progress"
            value={pin}
            onChange={handlePinChange}
            onPaste={handlePinPaste}
            onKeyDown={handlePinKeyDown}
            disabled={busy}
          />
        </div>
        <p id="station-cash-pin-progress" className="station-cash-pin-progress" aria-live="polite">
          {busy ? "Validando…" : `${pinDigitCount} de 4 dígitos ingresados`}
        </p>
        <button
          type="submit"
          className="station-cash-pin-submit"
          disabled={!canSubmitPin}
        >
          Entrar
        </button>
      </form>
    </section>
  )
}
