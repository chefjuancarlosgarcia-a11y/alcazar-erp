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
import { BRANDING } from "../branding"
import "./StationCashEntry.css"

const PIN_LENGTH = 4
const GENERIC_PIN_ERROR = "PIN o acceso no válido."

function normalizePinDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, PIN_LENGTH)
}

const PIN_KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["backspace", "0", "clear"]
]

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

  const applyPinUpdate = useCallback((nextValue) => {
    if (busy) return
    setPin(normalizePinDigits(nextValue))
    if (error) setError("")
  }, [busy, error])

  function appendPinDigit(digit) {
    if (busy || pin.length >= PIN_LENGTH) return
    applyPinUpdate(`${pin}${digit}`)
  }

  function removeLastPinDigit() {
    if (busy || !pin.length) return
    applyPinUpdate(pin.slice(0, -1))
  }

  function clearPinDigits() {
    if (busy) return
    applyPinUpdate("")
  }

  function handlePinChange(event) {
    applyPinUpdate(event.target.value)
  }

  function handlePinPaste(event) {
    event.preventDefault()
    if (busy) return
    applyPinUpdate(event.clipboardData.getData("text"))
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
    <section className="erp-page-shell station-cash-entry station-cash-entry--pin-gate">
      <div className="station-cash-access-card">
        <header className="station-cash-access-header">
          {BRANDING.logoUrl ? (
            <img
              className="station-cash-access-logo"
              src={BRANDING.logoUrl}
              alt=""
            />
          ) : (
            <span className="station-cash-access-mark" aria-hidden="true">
              {BRANDING.monogram}
            </span>
          )}
          <h1 className="station-cash-access-title">Acceso a {stationName}</h1>
          <p className="station-cash-access-subtitle">Ingresa tu PIN operativo de 4 dígitos</p>
        </header>

        <form className="station-cash-pin-form" onSubmit={handlePinFormSubmit} noValidate>
          <div
            className="station-cash-pin-field"
            role="presentation"
            onPointerDown={() => focusPinInput()}
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
              aria-describedby="station-cash-pin-progress station-cash-pin-message"
              value={pin}
              onChange={handlePinChange}
              onPaste={handlePinPaste}
              onKeyDown={handlePinKeyDown}
              disabled={busy}
            />
          </div>

          <div id="station-cash-pin-message" className="station-cash-pin-message">
            {error ? (
              <p className="station-cash-entry-error" role="alert">
                {error}
              </p>
            ) : (
              <span className="station-cash-pin-message-placeholder" aria-hidden="true">
                {" "}
              </span>
            )}
          </div>

          <p id="station-cash-pin-progress" className="station-cash-pin-sr-progress" aria-live="polite">
            {busy ? "Validando PIN operativo" : `${pinDigitCount} de 4 dígitos ingresados`}
          </p>

          <div className="station-cash-pin-keypad">
            {PIN_KEYPAD_ROWS.flatMap((row) => row).map((key) => {
              if (key === "backspace") {
                return (
                  <button
                    key={key}
                    type="button"
                    className="station-cash-pin-key station-cash-pin-key--action"
                    aria-label="Borrar último dígito"
                    disabled={busy || pin.length === 0}
                    onClick={removeLastPinDigit}
                  >
                    Borrar
                  </button>
                )
              }
              if (key === "clear") {
                return (
                  <button
                    key={key}
                    type="button"
                    className="station-cash-pin-key station-cash-pin-key--action"
                    aria-label="Limpiar PIN"
                    disabled={busy || pin.length === 0}
                    onClick={clearPinDigits}
                  >
                    Limpiar
                  </button>
                )
              }
              return (
                <button
                  key={key}
                  type="button"
                  className="station-cash-pin-key"
                  aria-label={`Dígito ${key}`}
                  disabled={busy || pin.length >= PIN_LENGTH}
                  onClick={() => appendPinDigit(key)}
                >
                  {key}
                </button>
              )
            })}
          </div>

          <button
            type="submit"
            className="station-cash-pin-submit"
            disabled={!canSubmitPin}
            aria-busy={busy}
          >
            {busy ? "Validando…" : "Entrar"}
          </button>
        </form>
      </div>
    </section>
  )
}
