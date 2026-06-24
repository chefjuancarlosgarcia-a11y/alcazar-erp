import { getProcessTodaySummary } from "../../utils/operationalProcessProgress"

function formatProcessRunDate(value) {
  if (!value) return "Sin fecha"
  const [year, month, day] = String(value).slice(0, 10).split("-")
  if (!year || !month || !day) return String(value)
  return `${day}/${month}/${year}`
}

export default function OperationalProcessTodayCard({ processDetail, onOpen, variant = "today" }) {
  const summary = getProcessTodaySummary(processDetail)
  const { itemTotals, assigneeCount, progress } = summary
  const isCompleted = variant === "completed" || summary.tone === "completed"

  return (
    <article className={`operational-process-today-card operational-process-today-card--${summary.tone}`}>
      <div className="operational-process-today-card__head">
        <span className="operational-process-today-card__eyebrow">Proceso operativo</span>
        <h3>{summary.title}</h3>
        {summary.area ? <p className="operational-process-today-card__area">{summary.area}</p> : null}
      </div>

      <div className="operational-process-today-card__stats">
        <p className="operational-process-today-card__completion">
          <strong>{progress.percent}%</strong>
          <span>{isCompleted ? "Completado" : summary.label}</span>
        </p>
        <p className="operational-process-today-card__counts">
          {summary.completed}/{summary.total} checklists
          {itemTotals.totalItems > 0 ? (
            <>
              {" · "}
              {itemTotals.completedItems}/{itemTotals.totalItems} tareas
            </>
          ) : null}
        </p>
        <p className="operational-process-today-card__meta-line">
          Fecha: {formatProcessRunDate(summary.runDate)}
          {assigneeCount > 0 ? ` · Responsables: ${assigneeCount}` : null}
        </p>
      </div>

      <div className="operational-process-today-card__progress">
        <div className="operational-process-today-card__progress-meta">
          <span>Progreso global</span>
          <span className={`operational-process-today-card__status operational-process-today-card__status--${summary.tone}`}>
            {summary.label}
          </span>
        </div>
        <div className="operational-process-today-card__bar" aria-hidden="true">
          <div
            className="operational-process-today-card__bar-fill"
            style={{ width: `${Math.min(progress.percent, 100)}%` }}
          />
        </div>
      </div>

      <button type="button" className="checklist-primary-action" onClick={onOpen}>
        Ver proceso
      </button>
    </article>
  )
}
