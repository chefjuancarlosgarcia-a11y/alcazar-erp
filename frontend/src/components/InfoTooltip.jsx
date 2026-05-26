import { useId, useState } from "react"
import "./InfoTooltip.css"

function InfoTooltip({ text }) {
  const tooltipId = useId()
  const [open, setOpen] = useState(false)

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      setOpen((current) => !current)
    }
    if (event.key === "Escape") setOpen(false)
  }

  return (
    <span
      className={`info-tooltip${open ? " is-open" : ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        aria-describedby={open ? tooltipId : undefined}
        aria-label="Mostrar ayuda"
        aria-expanded={open}
        className="info-tooltip-trigger"
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        ?
      </span>
      <span className="info-tooltip-content" id={tooltipId} role="tooltip">
        {text}
      </span>
    </span>
  )
}

export default InfoTooltip
