import {
  getChecklistOperationalDisplayStatus,
  getChecklistOperationalStatusLabel,
  normalizeChecklistRunStatus
} from "../../utils/checklistOperationalStatus"
import { formatChecklistRunAssignee } from "../../utils/checklistRunDisplay"
import {
  formatOverdueDueTime,
  formatOverdueRunDateLabel,
  getOverdueRunItemProgress
} from "../../utils/overdueChecklistsView"

const DB_STATUS_LABELS = {
  pending: "Pendiente",
  in_progress: "En progreso",
  overdue: "Vencida",
  rejected: "Devuelta"
}

function itemHasAnswer(item) {
  const jsonValue = item?.response_json && Object.keys(item.response_json).length > 0
  return Boolean(
    item?.checked
    || item?.response_text
    || item?.response_number != null
    || item?.response_date
    || item?.response_time
    || item?.photo_url
    || jsonValue
    || item?.completed_at
  )
}

function overdueStatusLabel(run) {
  const displayStatus = getChecklistOperationalDisplayStatus(run)
  const displayLabel = getChecklistOperationalStatusLabel(displayStatus)
  if (displayLabel) return displayLabel
  return DB_STATUS_LABELS[normalizeChecklistRunStatus(run?.status)] || run?.status || "—"
}

function overdueAreaLabel(run) {
  return run?.area || run?.checklist_templates?.area || "—"
}

export default function OverdueChecklistRow({ run, profiles, onOpen }) {
  const title = run?.checklist_templates?.title || "Checklist"
  const assignee = formatChecklistRunAssignee(run, profiles)
  const { done, total } = getOverdueRunItemProgress(run, itemHasAnswer)
  const progressLabel = total ? `${done}/${total}` : "—"
  const statusLabel = overdueStatusLabel(run)

  return (
    <tr className="overdue-checklist-row">
      <td className="overdue-checklist-row__title" data-label="Checklist">
        <strong>{title}</strong>
      </td>
      <td data-label="Responsable">{assignee}</td>
      <td data-label="Área">{overdueAreaLabel(run)}</td>
      <td className="overdue-checklist-row__date" data-label="Fecha">{formatOverdueRunDateLabel(run?.run_date)}</td>
      <td data-label="Esperada">{formatOverdueDueTime(run)}</td>
      <td data-label="Progreso">{progressLabel}</td>
      <td data-label="Estado">
        <span className={`overdue-checklist-row__status is-${normalizeChecklistRunStatus(run?.status) || "pending"}`}>
          {statusLabel}
        </span>
      </td>
      <td className="overdue-checklist-row__action" data-label="Acción">
        <button type="button" className="tasks-secondary overdue-checklist-row__btn" onClick={onOpen}>
          Ver
        </button>
      </td>
    </tr>
  )
}
