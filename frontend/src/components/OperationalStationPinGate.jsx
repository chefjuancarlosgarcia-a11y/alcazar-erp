import { useCallback, useEffect, useRef, useState } from "react"
import { verifyOperationalPin } from "../services/operationalStationAccessService"
import "./OperationalStationPinGate.css"

const PIN_LENGTH = 4
const GENERIC_PIN_ERROR = "PIN o acceso no válido."
const PIN_KEYPAD_ROWS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["backspace", "0", "clear"]
]

function normalizePinDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, PIN_LENGTH)
}

export default function OperationalStationPinGate({
  accessTitle,
  subtitle = "Ingresa tu PIN operativo de 4 dígitos",
  module = "cash",
  monogram,
  logoUrl,
  onVerified,
  autoFocus = true
}) {
  const [pin, setPin] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const pinInputRef = useRef(null)
  const pinDigitCount = pin.length
  const canSubmitPin = pinDigitCount === PIN_LENGTH && !busy

  const focusPinInput = useCallback(() => {
    pinInputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!autoFocus) return undefined
    focusPinInput()
    return undefined
  }, [autoFocus, focusPinInput])

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

  async function submitPin(nextPin) {
    if (nextPin.length !== PIN_LENGTH || busy) return
    setBusy(true)
    setError("")
    const { data, error: verifyError } = await verifyOperationalPin({ pin: nextPin, module })
    setBusy(false)
    if (verifyError || !data?.ok) {
      setPin("")
      setError(GENERIC_PIN_ERROR)
      requestAnimationFrame(() => focusPinInput())
      return
    }
    setPin("")
    onVerified?.(data)
  }

  function handlePinFormSubmit(event) {
    event.preventDefault()
    if (canSubmitPin) void submitPin(pin)
  }

  return (
    <div className="operational-station-pin-card">
      <header className="operational-station-pin-header">
        {logoUrl ? (
          <img className="operational-station-pin-logo" src={logoUrl} alt="" />
        ) : (
          <span className="operational-station-pin-mark" aria-hidden="true">
            {monogram || "GA"}
          </span>
        )}
        <h1 className="operational-station-pin-title">{accessTitle}</h1>
        <p className="operational-station-pin-subtitle">{subtitle}</p>
      </header>
      <form className="operational-station-pin-form" onSubmit={handlePinFormSubmit} noValidate>
        <div className="operational-station-pin-field" role="presentation" onPointerDown={() => focusPinInput()}>
          <div className="operational-station-pin-cells">
            {Array.from({ length: PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                className={
                  pin[index]
                    ? "operational-station-pin-cell operational-station-pin-cell--filled"
                    : "operational-station-pin-cell"
                }
                aria-hidden="true"
              >
                {pin[index] ? "●" : ""}
              </span>
            ))}
          </div>
          <input
            ref={pinInputRef}
            className="operational-station-pin-input"
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={PIN_LENGTH}
            autoComplete="off"
            enterKeyHint="go"
            aria-label="PIN operativo de 4 dígitos"
            aria-describedby="operational-station-pin-progress operational-station-pin-message"
            value={pin}
            onChange={(event) => applyPinUpdate(event.target.value)}
            onPaste={(event) => {
              event.preventDefault()
              if (busy) return
              applyPinUpdate(event.clipboardData.getData("text"))
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              if (canSubmitPin) void submitPin(pin)
            }}
            disabled={busy}
          />
        </div>
        <div id="operational-station-pin-message" className="operational-station-pin-message">
          {error ? (
            <p className="operational-station-pin-error" role="alert">
              {error}
            </p>
          ) : (
            <span className="operational-station-pin-message-placeholder" aria-hidden="true">
              {" "}
            </span>
          )}
        </div>
        <p id="operational-station-pin-progress" className="operational-station-pin-sr-progress" aria-live="polite">
          {busy ? "Validando PIN operativo" : `${pinDigitCount} de 4 dígitos ingresados`}
        </p>
        <div className="operational-station-pin-keypad">
          {PIN_KEYPAD_ROWS.flat().map((key) => {
            if (key === "backspace") {
              return (
                <button
                  key={key}
                  type="button"
                  className="operational-station-pin-key operational-station-pin-key--action"
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
                  className="operational-station-pin-key operational-station-pin-key--action"
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
                className="operational-station-pin-key"
                aria-label={`Dígito ${key}`}
                disabled={busy || pin.length >= PIN_LENGTH}
                onClick={() => appendPinDigit(key)}
              >
                {key}
              </button>
            )
          })}
        </div>
        <button type="submit" className="operational-station-pin-submit" disabled={!canSubmitPin} aria-busy={busy}>
          {busy ? "Validando…" : "Entrar"}
        </button>
      </form>
    </div>
  )
}
