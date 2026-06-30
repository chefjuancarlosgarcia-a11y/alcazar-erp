import * as XLSX from "xlsx"
import { getColumnDefinitions } from "./attendanceExportConfig"
import {
  getEmployeeSchedules,
  getScheduleAttendanceDetails,
  getScheduleAttendanceSummary
} from "../../services/schedulesService"
import { sanitizeAttendanceObservation } from "../../utils/attendanceObservationUtils"
import { mergePublishedBlocksIntoAttendanceDetails } from "./attendanceRowsUtils"

const LEGACY_SHIFT_TYPES = {
  full: "Turno completo",
  half: "Medio turno",
  rest: "Descanso",
  asueto: "Asueto"
}

const ATTENDANCE_STATUS = {
  completo: "Completo",
  tarde: "Tarde",
  falta: "Ausente",
  incompleto: "Incompleto",
  descanso: "Descanso",
  asueto: "Vacaciones",
  horas_extra: "Horas extra",
  pendiente: "Pendiente"
}

const PAYROLL_STATUS = {
  pending: "Pendiente",
  reviewed: "Revisado",
  approved: "Aprobado"
}

export function getMonday(value) {
  const date = new Date(`${typeof value === "string" ? value : value.toISOString().slice(0, 10)}T12:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.toISOString().slice(0, 10)
}

export function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function listWeekStartsInRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo || dateFrom > dateTo) return []
  const weeks = []
  let cursor = getMonday(dateFrom)
  while (cursor <= dateTo) {
    weeks.push(cursor)
    cursor = addDays(cursor, 7)
  }
  return weeks
}

export function buildAttendanceExportFilename(dateFrom, dateTo, extension = "xlsx") {
  return `asistencia_${dateFrom}_a_${dateTo}.${extension}`
}

export async function fetchAttendanceExportDataset(dateFrom, dateTo, profiles = []) {
  const weekStarts = listWeekStartsInRange(dateFrom, dateTo)
  if (!weekStarts.length) {
    return { details: [], summaries: [], error: null }
  }

  const [detailResults, summaryResults, scheduleResults] = await Promise.all([
    Promise.all(weekStarts.map((weekStart) => getScheduleAttendanceDetails(weekStart))),
    Promise.all(weekStarts.map((weekStart) => getScheduleAttendanceSummary(weekStart))),
    Promise.all(weekStarts.map((weekStart) => getEmployeeSchedules(weekStart, addDays(weekStart, 6))))
  ])

  const failedDetail = detailResults.find((result) => result.error)
  const failedSummary = summaryResults.find((result) => result.error)
  if (failedDetail?.error || failedSummary?.error) {
    return {
      details: [],
      summaries: [],
      error: failedDetail?.error || failedSummary?.error
    }
  }

  const detailsMap = new Map()
  detailResults
    .flatMap((result) => result.data || [])
    .forEach((row) => {
      if (row.shift_date >= dateFrom && row.shift_date <= dateTo && row.schedule_id) {
        detailsMap.set(row.schedule_id, row)
      }
    })

  const summaries = summaryResults.flatMap((result, index) => (
    (result.data || []).map((row) => ({ ...row, week_start: weekStarts[index] }))
  ))

  const periodSchedules = scheduleResults.flatMap((result) => result.data || [])
  const details = mergePublishedBlocksIntoAttendanceDetails(
    [...detailsMap.values()],
    periodSchedules,
    profiles
  )

  return { details, summaries, error: null }
}

export function aggregatePayrollFromDetails(details = [], summaries = []) {
  const payrollByEmployeeWeek = new Map(
    summaries.map((row) => [`${row.employee_id}:${row.week_start}`, row])
  )
  const byEmployee = new Map()

  for (const detail of details) {
    const weekStart = getMonday(detail.shift_date)
    const payroll = payrollByEmployeeWeek.get(`${detail.employee_id}:${weekStart}`) || {}
    const scheduledHours = Number(detail.scheduled_hours || 0)
    const actualHours = Number(detail.actual_hours || 0)
    const weekActualHours = Number(payroll.actual_hours || 0)
    const estimatedPay = Number(payroll.estimated_pay || 0)
    const dailyPay = weekActualHours > 0 ? (actualHours / weekActualHours) * estimatedPay : 0

    if (!byEmployee.has(detail.employee_id)) {
      byEmployee.set(detail.employee_id, {
        employee_id: detail.employee_id,
        employee_name: detail.employee_name,
        area: detail.area,
        scheduled_hours: 0,
        actual_hours: 0,
        regular_hours: 0,
        overtime_hours: 0,
        pending_extra_hours: 0,
        approved_extra_hours: 0,
        late_minutes: 0,
        absences: 0,
        estimated_pay: 0,
        payroll_status: payroll.payroll_status || "pending"
      })
    }

    const aggregate = byEmployee.get(detail.employee_id)
    if (!detail.is_work_day) continue

    aggregate.scheduled_hours += scheduledHours
    aggregate.actual_hours += actualHours
    aggregate.regular_hours += Math.min(actualHours, scheduledHours)
    aggregate.overtime_hours += Number(detail.overtime_hours || 0)
    aggregate.pending_extra_hours += Number(detail.pending_extra_hours || 0)
    aggregate.approved_extra_hours += Number(detail.approved_extra_hours || 0)
    aggregate.late_minutes += Number(detail.late_minutes || 0)
    if (detail.attendance_status === "falta") aggregate.absences += 1
    aggregate.estimated_pay += dailyPay
  }

  return [...byEmployee.values()].map((row) => ({
    ...row,
    scheduled_hours: Number(row.scheduled_hours.toFixed(2)),
    actual_hours: Number(row.actual_hours.toFixed(2)),
    regular_hours: Number(row.regular_hours.toFixed(2)),
    overtime_hours: Number(row.overtime_hours.toFixed(2)),
    pending_extra_hours: Number(row.pending_extra_hours.toFixed(2)),
    approved_extra_hours: Number(row.approved_extra_hours.toFixed(2)),
    estimated_pay: Number(row.estimated_pay.toFixed(2))
  }))
}

export function buildAttendanceExportRows(details = [], summaries = [], shiftTypes = []) {
  const payrollByKey = new Map(
    summaries.map((row) => [`${row.employee_id}:${row.week_start}`, row])
  )

  return details.map((detail) => {
    const weekStart = getMonday(detail.shift_date)
    const payroll = payrollByKey.get(`${detail.employee_id}:${weekStart}`) || {}
    const scheduledHours = Number(detail.scheduled_hours || 0)
    const actualHours = Number(detail.actual_hours || 0)
    const regularHours = Math.min(actualHours, scheduledHours)
    const weekActualHours = Number(payroll.actual_hours || 0)
    const estimatedPay = Number(payroll.estimated_pay || 0)
    const dailyPay = weekActualHours > 0 ? (actualHours / weekActualHours) * estimatedPay : 0

    return {
      fecha: detail.shift_date,
      colaborador: detail.employee_name || "",
      rol: roleLabel(detail.role),
      area: detail.area || "",
      tipo_turno: shiftTypeLabel(detail.shift_type, shiftTypes),
      entrada_programada: detail.is_work_day ? trimTime(detail.scheduled_start) : "",
      entrada_real: formatMarkTimeExport(detail.actual_start),
      minutos_tarde: Number(detail.late_minutes || 0),
      salida_comida: formatMarkTimeExport(detail.meal_out),
      regreso_comida: formatMarkTimeExport(detail.meal_back),
      minutos_comida: Number(detail.meal_minutes || 0),
      salida_programada: detail.is_work_day ? trimTime(detail.scheduled_end) : "",
      salida_real: formatMarkTimeExport(detail.actual_end),
      horas_programadas: scheduledHours,
      horas_trabajadas: actualHours,
      horas_ordinarias: Number(regularHours.toFixed(2)),
      horas_extra: Number(detail.overtime_hours || 0),
      ausencias: detail.attendance_status === "falta" ? 1 : 0,
      pago: Number(dailyPay.toFixed(2)),
      estado: attendanceStatusLabel(detail.attendance_status),
      observaciones: sanitizeAttendanceObservation(detail.observations),
      _employee_id: detail.employee_id,
      _role: detail.role || "",
      _attendance_status: detail.attendance_status || "",
      _payroll_status: payroll.payroll_status || "pending"
    }
  })
}

export function filterAttendanceExportRows(rows = [], filters = {}) {
  const {
    area = "",
    employeeId = "",
    role = "",
    status = ""
  } = filters

  return rows.filter((row) => {
    if (employeeId && row._employee_id !== employeeId) return false
    if (role && normalizeText(row._role) !== normalizeText(role)) return false
    if (area && normalizeText(row.area) !== normalizeText(area)) return false
    if (status === "pending") {
      if (row._payroll_status !== "pending") return false
    } else if (status && row._attendance_status !== status) {
      return false
    }
    return true
  })
}

export function projectAttendanceExportRows(rows = [], selectedColumnKeys = []) {
  const columns = getColumnDefinitions(selectedColumnKeys)
  return rows.map((row) => {
    const projected = {}
    columns.forEach((column) => {
      let value = row[column.key]
      if (column.key === "pago" && value != null && value !== "") {
        value = Number(value)
      }
      projected[column.label] = value ?? ""
    })
    return projected
  })
}

export function exportAttendanceWorkbook(projectedRows, filename) {
  const worksheet = XLSX.utils.json_to_sheet(projectedRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Asistencia")
  XLSX.writeFile(workbook, filename)
}

export function exportAttendanceCsv(projectedRows, filename) {
  if (!projectedRows.length) return
  const worksheet = XLSX.utils.json_to_sheet(projectedRows)
  const csv = XLSX.utils.sheet_to_csv(worksheet)
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}

export function validateAttendanceExportInput({ dateFrom, dateTo, selectedColumnKeys = [] }) {
  if (!dateFrom || !dateTo) {
    return "Selecciona un rango de fechas valido."
  }
  if (dateTo < dateFrom) {
    return "La fecha final no puede ser menor que la fecha inicial."
  }
  if (!selectedColumnKeys.length) {
    return "Selecciona al menos una columna para exportar."
  }
  return ""
}

function trimTime(value) {
  return String(value || "").slice(0, 5)
}

function formatMarkTimeExport(value) {
  if (!value) return ""
  return new Intl.DateTimeFormat("es-GT", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Guatemala"
  }).format(new Date(value))
}

function roleLabel(value) {
  return String(value || "").replaceAll("_", " ")
}

function shiftTypeLabel(value, shiftTypes = []) {
  return shiftTypes.find((type) => type.id === value)?.name || LEGACY_SHIFT_TYPES[value] || value || "Turno"
}

function attendanceStatusLabel(value) {
  return ATTENDANCE_STATUS[value] || value || "Incompleto"
}

function payrollStatusLabel(value) {
  return PAYROLL_STATUS[value] || value || "Pendiente"
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function textMatches(value, filter) {
  const normalizedFilter = normalizeText(filter)
  if (!normalizedFilter) return true
  return normalizeText(value).includes(normalizedFilter)
}

export function uniqueRoleOptions(profiles = []) {
  return [...new Set(profiles.map((profile) => profile.role).filter(Boolean))].sort()
}

export { payrollStatusLabel }
