import { addDays, getMonday } from "./attendanceExportService"

export const ATTENDANCE_PERIOD_OPTIONS = [
  { id: "day", label: "Dia" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mes" },
  { id: "year", label: "Ano" },
  { id: "custom", label: "Rango personalizado" }
]

export function resolveAttendancePeriodRange(periodType, anchorDate, customFrom = "", customTo = "") {
  const anchor = anchorDate || new Date().toISOString().slice(0, 10)

  if (periodType === "day") {
    return { from: anchor, to: anchor }
  }

  if (periodType === "week") {
    const from = getMonday(anchor)
    return { from, to: addDays(from, 6) }
  }

  if (periodType === "month") {
    const date = new Date(`${anchor}T12:00:00`)
    const year = date.getFullYear()
    const month = date.getMonth()
    const from = `${year}-${String(month + 1).padStart(2, "0")}-01`
    const lastDay = new Date(year, month + 1, 0).getDate()
    const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`
    return { from, to }
  }

  if (periodType === "year") {
    const year = anchor.slice(0, 4)
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }

  if (periodType === "custom") {
    return { from: customFrom || anchor, to: customTo || anchor }
  }

  const from = getMonday(anchor)
  return { from, to: addDays(from, 6) }
}

export function formatAttendancePeriodLabel(periodType, range) {
  if (!range?.from || !range?.to) return ""
  if (range.from === range.to) return range.from
  return `${range.from} al ${range.to}`
}

export function validateAttendancePeriodRange(range) {
  if (!range?.from || !range?.to) return "Selecciona un rango de fechas valido."
  if (range.to < range.from) return "La fecha final no puede ser menor que la fecha inicial."
  return ""
}
