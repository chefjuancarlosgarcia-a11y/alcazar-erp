import { formatChecklistRunAssignee } from "./checklistRunDisplay"
import {
  getChecklistOperationalDate,
  normalizeChecklistRunDate
} from "./checklistOperationalStatus"

function parseChecklistLocalDate(dateStr) {
  if (!dateStr) return null
  const [year, month, day] = String(dateStr).slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

export function daysPastRunDate(runDate, now = new Date()) {
  const run = parseChecklistLocalDate(normalizeChecklistRunDate(runDate))
  const today = parseChecklistLocalDate(getChecklistOperationalDate(now))
  if (!run || !today) return 0
  return Math.round((today.getTime() - run.getTime()) / 86400000)
}

export function formatOverdueDaysLabel(runDate, now = new Date()) {
  const days = daysPastRunDate(runDate, now)
  if (days === 1) return "Vencida hace 1 día"
  return `Vencida hace ${days} días`
}

export function formatOverdueRunDateLabel(dateStr) {
  const date = parseChecklistLocalDate(dateStr)
  if (!date) return "Sin fecha"
  return date.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function formatOverdueDueTime(run) {
  if (!run?.due_time) return "—"
  return String(run.due_time).slice(0, 5)
}

export function getOverdueRunItemProgress(run, itemHasAnswer) {
  const items = run?.checklist_run_items || []
  const done = items.filter((item) => itemHasAnswer(item)).length
  return { done, total: items.length }
}

function overdueAssigneeKey(run) {
  if (run?.assigned_profile_id) return `profile:${run.assigned_profile_id}`
  if (run?.assigned_role) return `role:${run.assigned_role}`
  if (run?.area) return `area:${run.area}`
  return "unassigned"
}

export function groupOverdueRunsByDate(runs, profiles = []) {
  const byDate = new Map()
  ;(runs || []).forEach((run) => {
    const runDate = normalizeChecklistRunDate(run?.run_date) || "sin-fecha"
    if (!byDate.has(runDate)) byDate.set(runDate, [])
    byDate.get(runDate).push(run)
  })

  return [...byDate.entries()]
    .sort((left, right) => String(left[0]).localeCompare(String(right[0])))
    .map(([runDate, dateRuns]) => ({
      runDate,
      daysOverdue: daysPastRunDate(runDate),
      runs: [...dateRuns].sort((left, right) => {
        const areaLeft = String(left.area || left.checklist_templates?.area || "").trim()
        const areaRight = String(right.area || right.checklist_templates?.area || "").trim()
        const areaCompare = areaLeft.localeCompare(areaRight, "es", { sensitivity: "base" })
        if (areaCompare !== 0) return areaCompare
        const assigneeLeft = formatChecklistRunAssignee(left, profiles)
        const assigneeRight = formatChecklistRunAssignee(right, profiles)
        return String(assigneeLeft).localeCompare(String(assigneeRight), "es", { sensitivity: "base" })
      })
    }))
}

export function buildOverdueSummary(runs, profiles = [], now = new Date()) {
  const list = runs || []
  const operationalToday = getChecklistOperationalDate(now)
  const assigneeKeys = new Set(list.map(overdueAssigneeKey))
  const daysList = list.map((run) => daysPastRunDate(run.run_date, now))
  const oldestDays = daysList.length ? Math.max(...daysList) : 0

  return {
    total: list.length,
    oldestDays,
    dueTodayCount: list.filter((run) => normalizeChecklistRunDate(run.run_date) === operationalToday).length,
    assigneesAffected: assigneeKeys.size
  }
}
