import { useState } from "react"
import {
  labelForOperationalWaitingReason,
  OPERATIONAL_TASK_WAITING_REASONS
} from "../../config/operationalTasksConfig"
import "./operationalTasks.css"

export default function TaskWaitingPanel({
  task,
  canEdit = false,
  saving = false,
  onSaveWaiting,
  onStatusChange
}) {
  const [waitingReason, setWaitingReason] = useState(task?.waiting_reason || "vendor")
  const [unblockNote, setUnblockNote] = useState(task?.waiting_unblock_note || "")

  if (!task || !["waiting", "blocked"].includes(task.status)) return null

  async function handleSave() {
    await onSaveWaiting?.({
      waitingReason,
      waitingUnblockNote: unblockNote
    })
  }

  async function handleUnblock() {
    await onStatusChange?.("in_progress")
  }

  return (
    <section className="ot-detail-block erp-card erp-card--form ot-detail-block--waiting">
      <header className="ot-detail-block__head">
        <span className="ot-detail-block__icon ot-detail-block__icon--waiting" aria-hidden="true" />
        <div>
          <h3 className="ot-detail-block__title">Bloqueo</h3>
          <p className="ot-detail-block__hint">Qué estamos esperando y qué desbloquea la tarea</p>
        </div>
        <span className="erp-badge ot-badge ot-badge--status">
          {task.status === "blocked" ? "Bloqueada" : "En espera"}
        </span>
      </header>
      <div className="ot-detail-block__content">
        {canEdit ? (
          <div className="ot-detail-panel__fields ot-detail-panel__fields--stack">
            <label className="ot-field ot-field--detail">
              <span>¿Qué estamos esperando?</span>
              <select
                className="ot-detail-control"
                value={waitingReason}
                onChange={(event) => setWaitingReason(event.target.value)}
                disabled={saving}
              >
                {OPERATIONAL_TASK_WAITING_REASONS.map((row) => (
                  <option key={row.id} value={row.id}>{row.label}</option>
                ))}
              </select>
            </label>
            <label className="ot-field ot-field--detail">
              <span>¿Qué desbloquea esta tarea?</span>
              <input
                className="ot-detail-control"
                value={unblockNote}
                onChange={(event) => setUnblockNote(event.target.value)}
                placeholder="Condición para continuar"
              />
            </label>
            <div className="ot-detail-block__actions">
              <button type="button" className="ot-btn ot-btn--primary" disabled={saving} onClick={handleSave}>
                Guardar bloqueo
              </button>
              <button type="button" className="ot-btn ot-btn--ghost" disabled={saving} onClick={handleUnblock}>
                Desbloquear
              </button>
            </div>
          </div>
        ) : (
          <p className="ot-detail-readonly">
            {labelForOperationalWaitingReason(task.waiting_reason)}
            {task.waiting_unblock_note ? ` — ${task.waiting_unblock_note}` : ""}
          </p>
        )}
      </div>
    </section>
  )
}
