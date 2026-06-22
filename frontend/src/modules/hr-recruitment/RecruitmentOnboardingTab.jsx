import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import {
  listRecruitmentOnboardings,
  updateRecruitmentOnboardingTaskStatus
} from "./recruitmentService"
import {
  canManageRecruitment,
  canViewRecruitmentOnboarding,
  labelFor,
  ONBOARDING_STATUSES
} from "./recruitmentUtils"

const TASK_STATUS_LABELS = [
  { value: "pending", label: "Pendiente" },
  { value: "completed", label: "Completada" },
  { value: "overdue", label: "Vencida" },
  { value: "skipped", label: "Omitida" }
]

function statusTone(status) {
  if (status === "completed") return "success"
  if (status === "overdue") return "warning"
  if (status === "active") return "default"
  return "muted"
}

export default function RecruitmentOnboardingTab({ onMessage }) {
  const { user } = useAuth()
  const canManage = canManageRecruitment(user?.role)
  const canView = canViewRecruitmentOnboarding(user?.role)

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState("")
  const [expandedId, setExpandedId] = useState("")
  const [savingTaskId, setSavingTaskId] = useState("")

  const loadRows = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    const result = await listRecruitmentOnboardings(filter || null)
    if (result.error) onMessage?.(result.error, "error")
    else setRows(result.data)
    setLoading(false)
  }, [canView, filter, onMessage])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  async function completeTask(taskId) {
    setSavingTaskId(taskId)
    const result = await updateRecruitmentOnboardingTaskStatus(taskId, "completed")
    setSavingTaskId("")
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Tarea completada.", "success")
      loadRows()
    }
  }

  if (!canView) {
    return (
      <article className="recruitment-panel">
        <p className="recruitment-message error">No tienes permiso para ver onboardings.</p>
      </article>
    )
  }

  return (
    <article className="recruitment-panel">
      <div className="recruitment-panel__head">
        <div>
          <h2>Onboarding</h2>
          <p className="tasks-muted">Checklist de incorporación para nuevos colaboradores.</p>
        </div>
        <button type="button" className="tasks-secondary" onClick={loadRows}>Actualizar</button>
      </div>

      <div className="recruitment-filters">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="completed">Completados</option>
          <option value="overdue">Vencidos</option>
        </select>
      </div>

      {loading ? <p className="tasks-muted">Cargando onboardings...</p> : null}

      {!loading && !rows.length ? (
        <p className="tasks-muted">No hay procesos de onboarding registrados.</p>
      ) : null}

      <div className="recruitment-onboarding-list">
        {rows.map((row) => {
          const expanded = expandedId === row.id
          const tasks = Array.isArray(row.tasks) ? row.tasks : []
          return (
            <section key={row.id} className="recruitment-onboarding-card">
              <header className="recruitment-onboarding-card__head">
                <div>
                  <strong>{row.employee_name || "Colaborador"}</strong>
                  <p className="tasks-muted">
                    {row.position || "Sin puesto"} · {row.area || "Sin área"}
                  </p>
                </div>
                <div className="recruitment-onboarding-card__meta">
                  <span className={`recruitment-badge recruitment-badge--${statusTone(row.status)}`}>
                    {labelFor(ONBOARDING_STATUSES, row.status) || row.status}
                  </span>
                  <span>{row.pending_tasks ?? 0}/{row.total_tasks ?? 0} pendientes</span>
                  {row.due_date ? <span>Vence: {row.due_date}</span> : null}
                </div>
                <button
                  type="button"
                  className="tasks-link"
                  onClick={() => setExpandedId(expanded ? "" : row.id)}
                >
                  {expanded ? "Ocultar tareas" : "Ver tareas"}
                </button>
              </header>

              {expanded ? (
                <ul className="recruitment-onboarding-tasks">
                  {tasks.map((task) => (
                    <li key={task.id} className={`recruitment-onboarding-task recruitment-onboarding-task--${task.status}`}>
                      <div>
                        <strong>{task.title}</strong>
                        <p className="tasks-muted">{task.description || "—"}</p>
                        <small>
                          {labelFor(TASK_STATUS_LABELS, task.status)}
                          {task.due_date ? ` · Vence ${task.due_date}` : ""}
                        </small>
                      </div>
                      {task.status !== "completed" && (canManage || task.assigned_profile_id === user?.id) ? (
                        <button
                          type="button"
                          className="tasks-secondary"
                          disabled={savingTaskId === task.id}
                          onClick={() => completeTask(task.id)}
                        >
                          {savingTaskId === task.id ? "..." : "Completar"}
                        </button>
                      ) : null}
                    </li>
                  ))}
                  {!tasks.length ? <li className="tasks-muted">Sin tareas visibles.</li> : null}
                </ul>
              ) : null}
            </section>
          )
        })}
      </div>
    </article>
  )
}
