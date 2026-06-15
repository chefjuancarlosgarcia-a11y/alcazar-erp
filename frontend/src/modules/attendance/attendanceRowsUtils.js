import { sortAttendanceDetailRows } from "./attendanceFilterUtils"

function inferAttendanceStatusFromSchedule(schedule = {}) {
  if (schedule.shift_type === "asueto") return "asueto"
  if (!schedule.is_work_day || schedule.shift_type === "rest") return "descanso"
  if (schedule.shift_date > new Date().toISOString().slice(0, 10)) return "pendiente"
  return "incompleto"
}

function buildRowFromSchedule(schedule = {}, profile = {}) {
  const isWorkDay = schedule.is_work_day !== false && schedule.shift_type !== "rest" && schedule.shift_type !== "asueto"

  return {
    schedule_id: schedule.id,
    employee_id: schedule.employee_id,
    employee_name: profile.name || profile.full_name || "Colaborador",
    role: profile.role || schedule.role || "",
    area: schedule.area || "",
    shift_date: schedule.shift_date,
    shift_type: schedule.shift_type_id || schedule.shift_type || "",
    shift_type_id: schedule.shift_type_id || schedule.shift_type || "",
    block_order: Number(schedule.block_order || 1),
    is_work_day: isWorkDay,
    scheduled_start: schedule.start_time || null,
    scheduled_end: schedule.end_time || null,
    actual_start: null,
    actual_end: null,
    meal_out: null,
    meal_back: null,
    meal_minutes: 0,
    scheduled_hours: isWorkDay ? estimateScheduleHours(schedule) : 0,
    actual_hours: 0,
    late_minutes: 0,
    early_departure_minutes: 0,
    overtime_hours: 0,
    attendance_status: inferAttendanceStatusFromSchedule(schedule),
    observations: schedule.day_notes || schedule.notes || ""
  }
}

function estimateScheduleHours(schedule = {}) {
  const start = String(schedule.start_time || "").slice(0, 5)
  const end = String(schedule.end_time || "").slice(0, 5)
  if (!start || !end) return 0
  const [startHours, startMinutes] = start.split(":").map(Number)
  const [endHours, endMinutes] = end.split(":").map(Number)
  let minutes = endHours * 60 + endMinutes - (startHours * 60 + startMinutes)
  if (minutes < 0) minutes += 24 * 60
  return Math.max(0, minutes - Number(schedule.break_minutes || 0)) / 60
}

export function mergePublishedBlocksIntoAttendanceDetails(details = [], schedules = [], profiles = []) {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]))
  const merged = new Map()

  for (const row of details) {
    if (!row?.schedule_id) continue
    merged.set(row.schedule_id, {
      ...row,
      shift_type: row.shift_type || row.shift_type_id || "",
      shift_type_id: row.shift_type_id || row.shift_type || "",
      block_order: Number(row.block_order || 1)
    })
  }

  for (const schedule of schedules) {
    if (!schedule?.id) continue
    if (!["published", "draft"].includes(schedule.status)) continue
    if (merged.has(schedule.id)) continue
    merged.set(
      schedule.id,
      buildRowFromSchedule(schedule, profileById.get(schedule.employee_id) || {})
    )
  }

  return sortAttendanceDetailRows([...merged.values()])
}
