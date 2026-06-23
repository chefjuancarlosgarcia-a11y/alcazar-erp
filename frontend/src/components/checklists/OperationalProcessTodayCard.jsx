import { getProcessTodaySummary } from "../../utils/operationalProcessProgress"

export default function OperationalProcessTodayCard({ processDetail, onOpen }) {
  const summary = getProcessTodaySummary(processDetail)

  return (
    <article className={`operational-process-today-card operational-process-today-card--${summary.tone}`}>
      <div className="operational-process-today-card__head">
        <span className="operational-process-today-card__eyebrow">Proceso operativo</span>
        <h3>{summary.title}</h3>
        {summary.area ? <p className="operational-process-today-card__area">{summary.area}</p> : null}
      </div>

      <div className="operational-process-today-card__stats">
        <p className="operational-process-today-card__completion">
          <strong>{summary.completed}/{summary.total}</strong>
          <span>checklists completadas</span>
        </p>
        <p className="operational-process-today-card__counts">
          Pendientes: {summary.pending}
          {" | "}
          En progreso: {summary.inProgress}
          {" | "}
          Atrasadas: {summary.late}
        </p>
      </div>

      <div className="operational-process-today-card__progress">
        <div className="operational-process-today-card__progress-meta">
          <span>Progreso: {summary.progress.percent}%</span>
          <span className={`operational-process-today-card__status operational-process-today-card__status--${summary.tone}`}>
            {summary.label}
          </span>
        </div>
        <div className="operational-process-today-card__bar" aria-hidden="true">
          <div
            className="operational-process-today-card__bar-fill"
            style={{ width: `${Math.min(summary.progress.percent, 100)}%` }}
          />
        </div>
      </div>

      <button type="button" className="checklist-primary-action" onClick={onOpen}>
        {summary.buttonLabel}
      </button>
    </article>
  )
}
