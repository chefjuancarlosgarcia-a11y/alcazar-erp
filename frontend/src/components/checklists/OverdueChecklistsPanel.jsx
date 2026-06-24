import OverdueChecklistRow from "./OverdueChecklistRow"
import {
  buildOverdueSummary,
  formatOverdueDaysLabel,
  formatOverdueRunDateLabel,
  groupOverdueRunsByDate
} from "../../utils/overdueChecklistsView"

function OverdueSummary({ summary }) {
  if (!summary.total) return null
  return (
    <div className="overdue-checklists-summary">
      <article className="overdue-checklists-summary__kpi">
        <span>Total vencidas</span>
        <strong>{summary.total}</strong>
      </article>
      <article className="overdue-checklists-summary__kpi">
        <span>Más antigua</span>
        <strong>{summary.oldestDays ? `hace ${summary.oldestDays} día${summary.oldestDays === 1 ? "" : "s"}` : "—"}</strong>
      </article>
      <article className="overdue-checklists-summary__kpi">
        <span>Hoy vencidas</span>
        <strong>{summary.dueTodayCount}</strong>
      </article>
      <article className="overdue-checklists-summary__kpi">
        <span>Responsables afectados</span>
        <strong>{summary.assigneesAffected}</strong>
      </article>
    </div>
  )
}

function OverdueDateGroup({ dateGroup, profiles, onOpenRun }) {
  return (
    <section className="overdue-checklists-date-group">
      <header className="overdue-checklists-date-group__head">
        <strong>{formatOverdueRunDateLabel(dateGroup.runDate)}</strong>
        <span>{formatOverdueDaysLabel(dateGroup.runDate)}</span>
        <em>{dateGroup.runs.length} corrida{dateGroup.runs.length === 1 ? "" : "s"}</em>
      </header>
      <div className="overdue-checklists-table-wrap">
        <table className="overdue-checklists-table">
          <thead>
            <tr>
              <th>Checklist</th>
              <th>Responsable</th>
              <th>Área</th>
              <th>Fecha</th>
              <th>Esperada</th>
              <th>Progreso</th>
              <th>Estado</th>
              <th>Acción</th>
            </tr>
          </thead>
          <tbody>
            {dateGroup.runs.map((run) => (
              <OverdueChecklistRow
                key={run.id}
                run={run}
                profiles={profiles}
                onOpen={() => onOpenRun(run)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function OverdueChecklistsPanel({ runs, profiles, onOpenRun }) {
  const dateGroups = groupOverdueRunsByDate(runs, profiles)
  const summary = buildOverdueSummary(runs, profiles)

  return (
    <div className="overdue-checklists-panel">
      <OverdueSummary summary={summary} />
      {dateGroups.map((dateGroup) => (
        <OverdueDateGroup
          key={dateGroup.runDate}
          dateGroup={dateGroup}
          profiles={profiles}
          onOpenRun={onOpenRun}
        />
      ))}
    </div>
  )
}
