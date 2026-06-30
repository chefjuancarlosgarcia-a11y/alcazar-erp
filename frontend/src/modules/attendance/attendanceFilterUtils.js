const LEGACY_SHIFT_TYPES = {
  full: "Turno completo",
  half: "Medio turno",
  rest: "Descanso",
  asueto: "Asueto"
}

export const ATTENDANCE_RECORD_STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "completo", label: "Completo" },
  { value: "incompleto", label: "Incompleto" },
  { value: "tarde", label: "Tarde" },
  { value: "falta", label: "Ausente" },
  { value: "descanso", label: "Descanso" },
  { value: "asueto", label: "Vacaciones" },
  { value: "pendiente", label: "Pendiente" },
  { value: "horas_extra", label: "Horas extra" },
  { value: "extra_pendiente", label: "Extra pendiente" },
  { value: "extra_rechazada", label: "Extra rechazada" }
]

export function buildShiftTypeFilterOptions(shiftTypes = []) {
  const options = [{ value: "", label: "Todos" }]
  const seen = new Set()

  for (const type of shiftTypes) {
    if (!type?.id || seen.has(type.id)) continue
    seen.add(type.id)
    options.push({ value: type.id, label: type.name || type.id })
  }

  for (const [value, label] of Object.entries(LEGACY_SHIFT_TYPES)) {
    if (!seen.has(value)) {
      options.push({ value, label })
      seen.add(value)
    }
  }

  return options
}

export function normalizeFilterText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

export function resolveAttendanceShiftTypeKey(row = {}, shiftTypes = []) {
  const raw = row.shift_type || row.shift_type_id || ""
  if (!raw) return ""
  const match = shiftTypes.find((type) => type.id === raw)
  return match?.id || raw
}

export function resolveAttendanceShiftTypeLabel(row = {}, shiftTypes = []) {
  const key = resolveAttendanceShiftTypeKey(row, shiftTypes)
  return shiftTypes.find((type) => type.id === key)?.name || LEGACY_SHIFT_TYPES[key] || key || "Turno"
}

export function matchesAttendanceArea(row = {}, areaFilter = "") {
  if (!areaFilter) return true
  return normalizeFilterText(row.area) === normalizeFilterText(areaFilter)
}

export function matchesAttendanceShiftType(row = {}, shiftTypeFilter = "", shiftTypes = []) {
  if (!shiftTypeFilter) return true
  const rowKey = resolveAttendanceShiftTypeKey(row, shiftTypes)
  if (rowKey === shiftTypeFilter) return true

  const filterType = shiftTypes.find((type) => type.id === shiftTypeFilter)
  const rowType = shiftTypes.find((type) => type.id === rowKey)
  if (filterType && rowType) return filterType.id === rowType.id

  if (shiftTypeFilter === "half" && (rowKey === "half" || /medio turno/i.test(resolveAttendanceShiftTypeLabel(row, shiftTypes)))) {
    return true
  }

  return normalizeFilterText(resolveAttendanceShiftTypeLabel(row, shiftTypes)) ===
    normalizeFilterText(shiftTypes.find((type) => type.id === shiftTypeFilter)?.name || LEGACY_SHIFT_TYPES[shiftTypeFilter] || shiftTypeFilter)
}

export function matchesAttendanceStatus(row = {}, statusFilter = "") {
  if (!statusFilter) return true
  if (statusFilter === "pendiente") {
    return row.attendance_status === "pendiente" ||
      (row.is_work_day && !row.actual_start && !row.actual_end && row.shift_date >= new Date().toISOString().slice(0, 10))
  }
  return row.attendance_status === statusFilter
}

export function filterAttendanceDetailRows(rows = [], filters = {}, shiftTypes = []) {
  const {
    area = "",
    employeeId = "",
    employeeSearch = "",
    shiftType = "",
    status = ""
  } = filters

  return rows.filter((row) => {
    if (employeeId && row.employee_id !== employeeId) return false
    if (employeeSearch && !normalizeFilterText(row.employee_name).includes(normalizeFilterText(employeeSearch))) return false
    if (!matchesAttendanceArea(row, area)) return false
    if (!matchesAttendanceShiftType(row, shiftType, shiftTypes)) return false
    if (!matchesAttendanceStatus(row, status)) return false
    return true
  })
}

export function sortAttendanceDetailRows(rows = []) {
  return [...rows].sort((left, right) => {
    const leftKey = [
      left.shift_date,
      left.employee_name,
      String(left.scheduled_start || ""),
      String(left.scheduled_end || ""),
      String(left.block_order || 0),
      left.schedule_id
    ].join(":")
    const rightKey = [
      right.shift_date,
      right.employee_name,
      String(right.scheduled_start || ""),
      String(right.scheduled_end || ""),
      String(right.block_order || 0),
      right.schedule_id
    ].join(":")
    return leftKey.localeCompare(rightKey)
  })
}
