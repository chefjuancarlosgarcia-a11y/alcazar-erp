import { useEffect, useState } from "react"
import { OPERATIONAL_TASK_WAITING_STATUSES } from "../../config/operationalTasksConfig"

export default function WaitingReasonDialog({
  open = false,
  saving = false,
  onConfirm,
  onCancel
}) {
  const [waitingKey, setWaitingKey] = useState("waiting:vendor")
  const [unblockNote, setUnblockNote] = useState("")

  useEffect(() => {
    if (!open) return
    setWaitingKey("waiting:vendor")
    setUnblockNote("")
  }, [open])

  if (!open) return null

  const selected = OPERATIONAL_TASK_WAITING_STATUSES.find(
    (row) => `${row.status}:${row.waitingReason}` === waitingKey
  ) || OPERATIONAL_TASK_WAITING_STATUSES[0]

  return (
    <div className="ot-modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="ot-modal erp-card"
        role="dialog"
        aria-modal="true"
        aria-label="Motivo de espera"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Mover a espera</h3>
        <p className="ot-muted">Indica qué estamos esperando y qué debe ocurrir para continuar.</p>
        <label className="ot-field">
          <span>¿Qué estamos esperando?</span>
          <select value={waitingKey} onChange={(event) => setWaitingKey(event.target.value)}>
            {OPERATIONAL_TASK_WAITING_STATUSES.map((row) => (
              <option key={`${row.status}:${row.waitingReason}`} value={`${row.status}:${row.waitingReason}`}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ot-field">
          <span>¿Qué desbloquea esta tarea?</span>
          <input
            value={unblockNote}
            onChange={(event) => setUnblockNote(event.target.value)}
            placeholder="Condición para continuar"
          />
        </label>
        <div className="ot-modal__actions">
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="ot-btn ot-btn--primary"
            disabled={saving}
            onClick={() => onConfirm({
              status: selected.status,
              waitingReason: selected.waitingReason,
              waitingUnblockNote: unblockNote
            })}
          >
            {saving ? "Guardando..." : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  )
}
