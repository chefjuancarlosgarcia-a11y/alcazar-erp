import { useEffect, useState } from "react"
import { formatDueAt } from "./taskCardUtils"
import TaskLabelChips from "./TaskLabelChips"
import "./operationalTasks.css"

export default function TaskArchivedPanel({
  open = false,
  loading = false,
  tasks = [],
  onClose,
  onOpenTask,
  onRestore
}) {
  const [query, setQuery] = useState("")

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  if (!open) return null

  const filtered = tasks.filter((task) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (task.title || "").toLowerCase().includes(q)
      || (task.objective || "").toLowerCase().includes(q)
  })

  return (
    <div className="ot-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ot-modal erp-card ot-archived-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Tareas archivadas"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ot-archived-panel__head">
          <div>
            <h3>Tareas archivadas</h3>
            <p className="ot-muted">Restaura una tarea para volver a verla en el tablero.</p>
          </div>
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onClose}>Cerrar</button>
        </header>
        <label className="ot-field">
          <span>Buscar</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Título u objetivo"
          />
        </label>
        {loading ? <p className="ot-muted">Cargando archivadas...</p> : null}
        <ul className="ot-archived-panel__list">
          {filtered.map((task) => (
            <li key={task.id} className="ot-archived-panel__item">
              <button
                type="button"
                className="ot-archived-panel__open"
                onClick={() => onOpenTask?.(task.id)}
              >
                <strong>{task.title}</strong>
                <small>Archivada {formatDueAt(task.archived_at)}</small>
                <TaskLabelChips labels={task.labels || []} max={3} />
              </button>
              {task.permissions?.can_restore ? (
                <button
                  type="button"
                  className="ot-btn ot-btn--ghost ot-btn--small"
                  onClick={() => onRestore?.(task.id)}
                >
                  Restaurar
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {!loading && !filtered.length ? (
          <p className="ot-muted">No hay tareas archivadas.</p>
        ) : null}
      </div>
    </div>
  )
}
