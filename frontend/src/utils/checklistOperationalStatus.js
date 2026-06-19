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
  const [year, month, day] = String(dateStr).split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
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
  if (!runDate) return false
  const windowEndDate = shiftDateString(runDate, 1)
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
  if (!["pending", "in_progress", "overdue", "rejected"].includes(run?.status)) return false
  if (!isChecklistOperationalWindowOpen(run.run_date, now)) return false
  const operationalDate = getChecklistOperationalDate(now)
  if (run.run_date === operationalDate) return true
  if (run.run_date === shiftDateString(operationalDate, -1)) return true
  return false
}

export function isChecklistRunHistoricPending(run, now = new Date()) {
  return ["pending", "in_progress", "overdue", "rejected"].includes(run?.status)
    && !isChecklistOperationalWindowOpen(run.run_date, now)
}

export function isChecklistOperationallyExpired(run, now = new Date()) {
  return getChecklistOperationalDisplayStatus(run, now) === CHECKLIST_OPERATIONAL_STATUS.VENCIDA
}
