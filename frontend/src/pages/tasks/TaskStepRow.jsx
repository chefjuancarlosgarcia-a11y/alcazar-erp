import { useMemo, useState } from "react"
import { formatDueAt } from "./taskCardUtils"
import "./operationalTasks.css"

function StepMenu({ open, onClose, onAction }) {
  if (!open) return null
  return (
    <div className="ot-step-menu" role="menu">
      <button type="button" onClick={() => { onAction("assign"); onClose() }}>Asignar</button>
      <button type="button" onClick={() => { onAction("due"); onClose() }}>Fecha límite</button>
      <button type="button" onClick={() => { onAction("depends"); onClose() }}>Dependencia</button>
      <button type="button" onClick={() => { onAction("convert"); onClose() }}>Convertir en tarea</button>
      <button type="button" className="is-danger" onClick={() => { onAction("delete"); onClose() }}>Eliminar</button>
    </div>
  )
}

export default function TaskStepRow({
  step,
  listId,
  members = [],
  allSteps = [],
  canEdit = false,
  saving = false,
  onToggle,
  onUpdate,
  onDelete,
  onConvert
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingText, setEditingText] = useState(step.text)
  const [showAssign, setShowAssign] = useState(false)
  const [showDue, setShowDue] = useState(false)
  const [showDepends, setShowDepends] = useState(false)

  const dueLabel = step.due_at ? formatDueAt(step.due_at, { dateOnly: true }) : null

  const dependencyOptions = useMemo(
    () => allSteps.filter((row) => row.id !== step.id && !row.completed),
    [allSteps, step.id]
  )

  async function handleMenuAction(action) {
    if (action === "assign") setShowAssign(true)
    if (action === "due") setShowDue(true)
    if (action === "depends") setShowDepends(true)
    if (action === "convert") await onConvert?.(step.id)
    if (action === "delete") await onDelete?.(step.id)
  }

  return (
    <li className={`ot-step-row${step.is_blocked ? " is-blocked" : ""}${step.completed ? " is-done" : ""}`}>
      <label className="ot-step-row__check">
        <input
          type="checkbox"
          checked={Boolean(step.completed)}
          disabled={!canEdit || saving || step.is_blocked}
          onChange={(event) => onToggle?.(step.id, event.target.checked)}
        />
        <span className="ot-step-row__box" aria-hidden="true" />
      </label>
      <div className="ot-step-row__body">
        {canEdit ? (
          <input
            className="ot-step-row__text-input"
            value={editingText}
            onChange={(event) => setEditingText(event.target.value)}
            onBlur={() => {
              if (editingText.trim() && editingText !== step.text) {
                onUpdate?.(step.id, { text: editingText.trim() })
              }
            }}
          />
        ) : (
          <span className="ot-step-row__text">{step.text}</span>
        )}
        {step.is_blocked && step.depends_on_text ? (
          <small className="ot-step-row__blocked">Requiere: {step.depends_on_text}</small>
        ) : null}
        <div className="ot-step-row__chips">
          {step.assigned_name ? <span className="ot-step-chip">👤 {step.assigned_name}</span> : null}
          {dueLabel ? <span className="ot-step-chip">📅 {dueLabel}</span> : null}
          {Number(step.attachment_count) > 0 ? (
            <span className="ot-step-chip">📎 {step.attachment_count}</span>
          ) : null}
          {Number(step.comment_count) > 0 ? (
            <span className="ot-step-chip">💬 {step.comment_count}</span>
          ) : null}
        </div>
        {showAssign ? (
          <div className="ot-step-row__inline-form">
            <select
              defaultValue={step.assigned_profile_id || ""}
              onChange={(event) => {
                onUpdate?.(step.id, { assigned_profile_id: event.target.value || null })
                setShowAssign(false)
              }}
            >
              <option value="">Sin responsable</option>
              {members.map((row) => (
                <option key={row.profile_id} value={row.profile_id}>{row.full_name}</option>
              ))}
            </select>
          </div>
        ) : null}
        {showDue ? (
          <div className="ot-step-row__inline-form">
            <input
              type="datetime-local"
              defaultValue={step.due_at ? new Date(step.due_at).toISOString().slice(0, 16) : ""}
              onBlur={(event) => {
                onUpdate?.(step.id, {
                  due_at: event.target.value ? new Date(event.target.value).toISOString() : null
                })
                setShowDue(false)
              }}
            />
          </div>
        ) : null}
        {showDepends ? (
          <div className="ot-step-row__inline-form">
            <select
              defaultValue={step.depends_on_step_id || ""}
              onChange={(event) => {
                onUpdate?.(step.id, { depends_on_step_id: event.target.value || null })
                setShowDepends(false)
              }}
            >
              <option value="">Sin dependencia</option>
              {dependencyOptions.map((row) => (
                <option key={row.id} value={row.id}>{row.text}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div className="ot-step-row__menu-wrap">
          <button
            type="button"
            className="ot-step-row__menu-btn"
            aria-label="Opciones del paso"
            onClick={() => setMenuOpen((value) => !value)}
          >
            ⋮
          </button>
          <StepMenu open={menuOpen} onClose={() => setMenuOpen(false)} onAction={handleMenuAction} />
        </div>
      ) : null}
    </li>
  )
}
