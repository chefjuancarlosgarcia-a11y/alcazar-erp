const GT_TIMEZONE = "America/Guatemala"

export const DEFAULT_CHECKLIST_OPERATIONAL_DAY_END = "04:00"

export const CHECKLIST_OPERATIONAL_STATUS = {
  PENDIENTE: "pendiente",
  PENDIENTE_ATRASADA: "pendiente_atrasada",
  COMPLETADA_A_TIEMPO: "completada_a_tiempo",
  COMPLETADA_TARDE: "completada_tarde",
  VENCIDA: "vencida"
}

export const CHECKLIST_OPERATIONAL_STATUS_LABELS = {
  pendiente: "Pendiente",
  pendiente_atrasada: "Pendiente atrasada",
  completada_a_tiempo: "Completada a tiempo",
  completada_tarde: "Completada tarde",
  vencida: "Vencida"
}

export const CHECKLIST_REPLACEMENT_REASONS = [
  ["descanso", "Descanso"],
  ["vacaciones", "Vacaciones"],
  ["permiso", "Permiso"],
  ["ausencia", "Ausencia"],
  ["ausencia_no_marcaje", "Ausencia sin marcaje"],
  ["emergencia", "Emergencia"],
  ["otro", "Otro"]
]

export function getGuatemalaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: GT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}

export function getGuatemalaTimeString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date)
  const hour = String(Number(parts.find((part) => part.type === "hour")?.value || 0)).padStart(2, "0")
  const minute = String(Number(parts.find((part) => part.type === "minute")?.value || 0)).padStart(2, "0")
  return `${hour}:${minute}`
}

function parseTimeToMinutes(timeStr) {
  const [hours, minutes] = String(timeStr || "00:00").slice(0, 5).split(":").map(Number)
  return (hours * 60) + (minutes || 0)
}

function shiftDateString(dateStr, days) {
  const normalized = String(dateStr || "").slice(0, 10)
  const [year, month, day] = normalized.split("-").map(Number)
  if (!year || !month || !day) return normalized
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

export function normalizeChecklistRunDate(value) {
  if (!value) return ""
  if (value instanceof Date) return getGuatemalaDateString(value)
  const trimmed = String(value).trim()
  const isoMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoMatch) return isoMatch[1]
  return trimmed.slice(0, 10)
}

export function normalizeChecklistRunStatus(value) {
  return String(value || "").trim().toLowerCase()
}

export function isChecklistRunActive(run) {
  return ["pending", "in_progress", "overdue", "rejected", "pending_review"].includes(
    normalizeChecklistRunStatus(run?.status)
  )
}

export function isChecklistRunDateToday(runDate, now = new Date()) {
  const normalized = normalizeChecklistRunDate(runDate)
  if (!normalized) return false
  return getChecklistTodayDateCandidates(now).includes(normalized)
}

export function getChecklistTodayDateCandidates(now = new Date()) {
  const operationalDate = getChecklistOperationalDate(now)
  const calendarDate = getGuatemalaDateString(now)
  return [...new Set([operationalDate, calendarDate, shiftDateString(operationalDate, -1)])]
}

export function getChecklistOperationalDate(
  now = new Date(),
  dayEndTime = DEFAULT_CHECKLIST_OPERATIONAL_DAY_END
) {
  const calendarDate = getGuatemalaDateString(now)
  if (parseTimeToMinutes(getGuatemalaTimeString(now)) < parseTimeToMinutes(dayEndTime)) {
    return shiftDateString(calendarDate, -1)
  }
  return calendarDate
}

export function isChecklistOperationalWindowOpen(
  runDate,
  now = new Date(),
  dayEndTime = DEFAULT_CHECKLIST_OPERATIONAL_DAY_END
) {
  const normalizedRunDate = normalizeChecklistRunDate(runDate)
  if (!normalizedRunDate) return false
  const windowEndDate = shiftDateString(normalizedRunDate, 1)
  const calendarDate = getGuatemalaDateString(now)
  if (calendarDate < windowEndDate) return true
  if (calendarDate > windowEndDate) return false
  return parseTimeToMinutes(getGuatemalaTimeString(now)) < parseTimeToMinutes(dayEndTime)
}

export function isPastChecklistExpectedDue(run, now = new Date()) {
  if (!run?.run_date || !run?.due_time) return false
  const calendarDate = getGuatemalaDateString(now)
  const dueTime = String(run.due_time).slice(0, 5)
  if (calendarDate > run.run_date) return true
  if (calendarDate < run.run_date) return false
  return parseTimeToMinutes(getGuatemalaTimeString(now)) > parseTimeToMinutes(dueTime)
}

export function hasChecklistReplacement(run) {
  return Boolean(
    run?.replaced_at
    && run?.original_assigned_profile_id
    && run.original_assigned_profile_id !== run.assigned_profile_id
  )
}

export function getChecklistOperationalDisplayStatus(run, now = new Date()) {
  if (!run) return CHECKLIST_OPERATIONAL_STATUS.PENDIENTE

  if (run.status === "completed") {
    if (run.completion_timing === "late") return CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE
    if (run.completion_timing === "on_time") return CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_A_TIEMPO
    if (isPastChecklistExpectedDue({ ...run, due_time: run.due_time, run_date: run.run_date }, run.completed_at ? new Date(run.completed_at) : now)) {
      return CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE
    }
    return CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_A_TIEMPO
  }

  if (
    run.status === "overdue"
    || (["pending", "in_progress", "rejected"].includes(run.status) && !isChecklistOperationalWindowOpen(run.run_date, now))
  ) {
    return CHECKLIST_OPERATIONAL_STATUS.VENCIDA
  }

  if (isPastChecklistExpectedDue(run, now)) {
    return CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA
  }

  return CHECKLIST_OPERATIONAL_STATUS.PENDIENTE
}

export function getChecklistOperationalStatusLabel(status) {
  return CHECKLIST_OPERATIONAL_STATUS_LABELS[status] || status
}

export function getChecklistReplacementReasonLabel(reason) {
  return CHECKLIST_REPLACEMENT_REASONS.find(([value]) => value === reason)?.[1] || reason || ""
}

export function isChecklistRunTodayWork(run, now = new Date()) {
  if (!isChecklistRunActive(run)) return false
  return isChecklistRunDateToday(run?.run_date, now)
}

export function isChecklistRunOperationalTodayWork(
  run,
  operationalToday = getChecklistOperationalDate(),
  now = new Date()
) {
  if (!isChecklistRunActive(run)) return false
  const today = operationalToday || getChecklistOperationalDate(now)
  return normalizeChecklistRunDate(run?.run_date) === today
}

export function isChecklistRunHistoricPending(run, now = new Date()) {
  if (!isChecklistRunActive(run)) return false
  if (isChecklistRunTodayWork(run, now)) return false
  const runDate = normalizeChecklistRunDate(run?.run_date)
  if (!runDate) return false
  const operationalToday = getChecklistOperationalDate(now)
  if (runDate < operationalToday) return true
  if (isChecklistRunDateToday(runDate, now)) {
    return isChecklistOperationallyExpired(run, now)
  }
  return !isChecklistOperationalWindowOpen(runDate, now)
}

function isoWeekdayFromDateString(dateStr) {
  const [year, month, day] = String(dateStr).slice(0, 10).split("-").map(Number)
  if (!year || !month || !day) return null
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

export function isChecklistTemplateDueOnDate(template, dateStr = getChecklistOperationalDate()) {
  if (!template || template.status !== "active") return false
  const frequency = template.frequency || "manual"
  const autoGenerate = template.auto_generate !== false
  if (frequency === "manual") return autoGenerate
  if (frequency === "diaria") return true
  if (["apertura", "cierre", "por_turno"].includes(frequency)) return true
  if (frequency === "semanal") {
    const days = Array.isArray(template.recurrence_days) ? template.recurrence_days.map(Number) : []
    if (!days.length) return true
    const weekday = isoWeekdayFromDateString(dateStr)
    return weekday != null && days.includes(weekday)
  }
  if (frequency === "mensual") {
    const monthDay = Number(template.recurrence_month_day || 1)
    const day = Number(String(dateStr).slice(8, 10))
    return day === monthDay
  }
  return false
}

export function shouldEnsureChecklistRunForOperationalDate(template, dateStr = getChecklistOperationalDate(), existingRuns = []) {
  if (!template || template.status !== "active") return false
  if (isChecklistTemplateDueOnDate(template, dateStr)) return true

  const frequency = template.frequency || "manual"
  if (!["diaria", "apertura", "cierre", "por_turno"].includes(frequency)) return false

  const templateRuns = (existingRuns || []).filter((run) => (
    run?.template_id === template.id && isChecklistRunActive(run)
  ))
  if (!templateRuns.length) return false

  const normalizedDate = normalizeChecklistRunDate(dateStr)
  if (templateRuns.some((run) => normalizeChecklistRunDate(run.run_date) === normalizedDate)) return false

  return templateRuns.some((run) => {
    const runDate = normalizeChecklistRunDate(run.run_date)
    return runDate && normalizedDate && runDate < normalizedDate
  })
}

export function isChecklistOperationallyExpired(run, now = new Date()) {
  return getChecklistOperationalDisplayStatus(run, now) === CHECKLIST_OPERATIONAL_STATUS.VENCIDA
}
