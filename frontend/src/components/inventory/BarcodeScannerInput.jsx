import { useRef } from "react"
import { normalizeBarcode } from "../../utils/barcodeUtils"
import "./BarcodeScannerInput.css"

export default function BarcodeScannerInput({
  value = "",
  onChange,
  onScan,
  placeholder = "Escanear o escribir código de barras...",
  disabled = false,
  autoFocus = false,
  inputId,
  inputClassName = "",
  label = "",
  hint = "Enfoca este campo y escanea. El lector envía el código y Enter.",
  showFocusButton = true,
  focusButtonLabel = "Escanear"
}) {
  const inputRef = useRef(null)

  function commitScan(rawValue) {
    const code = normalizeBarcode(rawValue ?? value)
    if (!code) return
    onChange?.(code)
    onScan?.(code)
  }

  function handleKeyDown(event) {
    if (event.key !== "Enter") return
    event.preventDefault()
    commitScan(event.currentTarget.value)
  }

  return (
    <div className="barcode-scanner-input">
      {label ? <label className="barcode-scanner-input__label" htmlFor={inputId}>{label}</label> : null}
      <div className="barcode-scanner-input__row">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={`barcode-scanner-input__field ${inputClassName}`.trim()}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
        />
        {showFocusButton && (
          <button
            type="button"
            className="barcode-scanner-input__focus-btn secondary"
            disabled={disabled}
            onClick={() => inputRef.current?.focus()}
          >
            {focusButtonLabel}
          </button>
        )}
      </div>
      {hint ? <small className="barcode-scanner-input__hint">{hint}</small> : null}
    </div>
  )
}
