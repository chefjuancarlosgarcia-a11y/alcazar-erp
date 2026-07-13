import { useEffect, useMemo, useState } from "react"
import {
  labelForOperationalPriority,
  labelForOperationalStatus,
  OPERATIONAL_TASK_PRIORITIES,
  OPERATIONAL_TASK_STATUSES,
  OPERATIONAL_TASK_WAITING_REASONS
} from "../../config/operationalTasksConfig"
import "../../components/commandCenter/CommandCenterLayer.css"
import "./operationalTasks.css"

function CommandCenterDrawer({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="cc-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="cc-drawer ot-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="cc-drawer__head">
          <h2>{title}</h2>
          <button type="button" className="cc-drawer__close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="cc-drawer__body">{children}</div>
      </aside>
    </div>
  )
}

function formatDueAt(value) {
  if (!value) return "Sin fecha"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin fecha"
  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  })
}

function assigneeLabel(task) {
  const names = (task.assignees || [])
    .map((row) => row.full_name)
    .filter(Boolean)
  if (!names.length) return "Sin asignar"
  if (names.length === 1) return names[0]
  return `${names[0]} +${names.length - 1}`
}

export default function TaskDetailDrawer({
  task,
  loading = false,
  open = false,
  onClose,
  onStatusChange,
  onTaskUpdate,
  onAssigneesChange,
  assignableProfiles = [],
  canAssign = false,
  saving = false
}) {
  const [waitingReason, setWaitingReason] = useState("vendor")
  const [nextAction, setNextAction] = useState("")
  const [cancelReason, setCancelReason] = useState("")
  const [editTitle, setEditTitle] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [editPriority, setEditPriority] = useState("medium")
  const [editDueAt, setEditDueAt] = useState("")
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState([])

  useEffect(() => {
    if (!task) return
    setEditTitle(task.title || "")
    setEditDescription(task.description || "")
    setEditPriority(task.priority || "medium")
    setEditDueAt(task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : "")
    setWaitingReason(task.waiting_reason || "vendor")
    setNextAction(task.next_action || "")
    setSelectedAssigneeIds((task.assignees || []).map((row) => row.profile_id).filter(Boolean))
  }, [task])

  const profileOptions = useMemo(
    () => assignableProfiles.map((row) => ({
      id: row.id,
      label: row.full_name || row.username || "Colaborador",
      area: row.area_name || row.area_id || ""
    })),
    [assignableProfiles]
  )

  async function handleStatusChange(status) {
    if (!task?.id || !onStatusChange) return
    await onStatusChange(task.id, {
      status,
      waitingReason: status === "waiting" ? waitingReason : null,
      nextAction: status === "waiting" ? nextAction : null,
      cancelReason: status === "cancelled" ? cancelReason : null
    })
  }

  async function handleSaveEdit(event) {
    event.preventDefault()
    if (!task?.id || !onTaskUpdate) return
    const title = editTitle.trim()
    if (!title) return
    await onTaskUpdate(task.id, {
      title,
      description: editDescription,
      priority: editPriority,
      due_at: editDueAt ? new Date(editDueAt).toISOString() : null
    })
  }

  function toggleAssignee(profileId) {
    setSelectedAssigneeIds((current) => (
      current.includes(profileId)
        ? current.filter((id) => id !== profileId)
        : [...current, profileId]
    ))
  }

  async function handleSaveAssignees() {
    if (!task?.id || !onAssigneesChange || !selectedAssigneeIds.length) return
    const before = new Set((task.assignees || []).map((row) => row.profile_id))
    const addedIds = selectedAssigneeIds.filter((id) => !before.has(id))
    await onAssigneesChange(task.id, selectedAssigneeIds, addedIds)
  }

  const canEdit = task && !["completed", "cancelled"].includes(task.status)
  const assigneesDirty = useMemo(() => {
    const current = [...selectedAssigneeIds].sort().join(",")
    const original = [...((task?.assignees || []).map((row) => row.profile_id).filter(Boolean))].sort().join(",")
    return current !== original
  }, [selectedAssigneeIds, task])

  return (
    <CommandCenterDrawer open={open} title={task?.title || "Detalle de tarea"} onClose={onClose}>
      {loading && <p className="ot-muted">Cargando tarea...</p>}
      {!loading && !task && <p className="ot-muted">No se encontró la tarea.</p>}
      {!loading && task && (
        <div className="ot-drawer-stack">
          <div className="ot-drawer-meta">
            <span className={`erp-badge ot-badge ot-badge--${task.priority || "medium"}`}>
              {labelForOperationalPriority(task.priority)}
            </span>
            <span className="erp-badge ot-badge ot-badge--status">
              {labelForOperationalStatus(task.status)}
            </span>
          </div>

          {task.description ? <p className="ot-drawer-copy">{task.description}</p> : null}

          <dl className="ot-detail-grid">
            <div>
              <dt>Asignados</dt>
              <dd>{assigneeLabel(task)}</dd>
            </div>
            <div>
              <dt>Área</dt>
              <dd>{task.area_name || task.area_id || "General"}</dd>
            </div>
            <div>
              <dt>Vence</dt>
              <dd>{formatDueAt(task.due_at)}</dd>
            </div>
          </dl>

          {canEdit && canAssign && (
            <section className="ot-drawer-section">
              <h3>Delegar a colaboradores</h3>
              <p className="ot-muted">Selecciona quién debe ejecutar esta tarea. Al guardar se notifica a los nuevos asignados.</p>
              <div className="ot-assignee-list">
                {profileOptions.map((profile) => (
                  <label key={profile.id} className="ot-assignee-option">
                    <input
                      type="checkbox"
                      checked={selectedAssigneeIds.includes(profile.id)}
                      onChange={() => toggleAssignee(profile.id)}
                    />
                    <span>
                      <strong>{profile.label}</strong>
                      {profile.area ? <small>{profile.area}</small> : null}
                    </span>
                  </label>
                ))}
                {!profileOptions.length ? <p className="ot-muted">No hay colaboradores asignables para tu rol.</p> : null}
              </div>
              <button
                type="button"
                className="ot-btn ot-btn--primary"
                disabled={saving || !assigneesDirty || !selectedAssigneeIds.length}
                onClick={handleSaveAssignees}
              >
                Guardar asignación
              </button>
            </section>
          )}

          {canEdit && (
            <section className="ot-drawer-section">
              <h3>Editar tarea</h3>
              <form className="ot-drawer-stack" onSubmit={handleSaveEdit}>
                <label className="ot-field">
                  <span>Título</span>
                  <input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} required />
                </label>
                <label className="ot-field">
                  <span>Descripción</span>
                  <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
                </label>
                <label className="ot-field">
                  <span>Prioridad</span>
                  <select value={editPriority} onChange={(event) => setEditPriority(event.target.value)}>
                    {OPERATIONAL_TASK_PRIORITIES.map((row) => (
                      <option key={row.id} value={row.id}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="ot-field">
                  <span>Vence</span>
                  <input
                    type="datetime-local"
                    value={editDueAt}
                    onChange={(event) => setEditDueAt(event.target.value)}
                  />
                </label>
                <button type="submit" className="ot-btn ot-btn--primary" disabled={saving}>
                  Guardar cambios
                </button>
              </form>
            </section>
          )}

          <section className="ot-drawer-section">
            <h3>Cambiar estado</h3>
            <div className="ot-status-actions">
              {OPERATIONAL_TASK_STATUSES.filter((row) => row.id !== task.status).map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="ot-btn ot-btn--ghost"
                  disabled={saving}
                  onClick={() => handleStatusChange(row.id)}
                >
                  {row.label}
                </button>
              ))}
            </div>
          </section>

          {task.status !== "waiting" && (
            <section className="ot-drawer-section">
              <h3>Mover a espera</h3>
              <label className="ot-field">
                <span>Motivo</span>
                <select value={waitingReason} onChange={(event) => setWaitingReason(event.target.value)}>
                  {OPERATIONAL_TASK_WAITING_REASONS.map((row) => (
                    <option key={row.id} value={row.id}>{row.label}</option>
                  ))}
                </select>
              </label>
              <label className="ot-field">
                <span>Siguiente acción</span>
                <input
                  value={nextAction}
                  onChange={(event) => setNextAction(event.target.value)}
                  placeholder="Qué debe pasar para desbloquear"
                />
              </label>
              <button
                type="button"
                className="ot-btn ot-btn--primary"
                disabled={saving}
                onClick={() => handleStatusChange("waiting")}
              >
                Marcar en espera
              </button>
            </section>
          )}

          {task.status !== "cancelled" && (
            <section className="ot-drawer-section">
              <h3>Cancelar</h3>
              <label className="ot-field">
                <span>Motivo</span>
                <input
                  value={cancelReason}
                  onChange={(event) => setCancelReason(event.target.value)}
                  placeholder="Motivo de cancelación"
                />
              </label>
              <button
                type="button"
                className="ot-btn ot-btn--danger"
                disabled={saving}
                onClick={() => handleStatusChange("cancelled")}
              >
                Cancelar tarea
              </button>
            </section>
          )}

          {Array.isArray(task.activity) && task.activity.length > 0 && (
            <section className="ot-drawer-section">
              <h3>Actividad</h3>
              <ul className="ot-activity-list">
                {task.activity.map((row) => (
                  <li key={row.id}>
                    <strong>{row.actor_name || "Sistema"}</strong>
                    <span>{row.action}</span>
                    <time>{formatDueAt(row.created_at)}</time>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </CommandCenterDrawer>
  )
}

export { assigneeLabel, formatDueAt }
