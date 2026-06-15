export const ATTENDANCE_EXPORT_COLUMNS = [
  { key: "fecha", label: "Fecha" },
  { key: "colaborador", label: "Colaborador" },
  { key: "rol", label: "Rol" },
  { key: "area", label: "Area" },
  { key: "tipo_turno", label: "Tipo de turno" },
  { key: "entrada_programada", label: "Entrada programada" },
  { key: "entrada_real", label: "Entrada real" },
  { key: "minutos_tarde", label: "Minutos tarde" },
  { key: "salida_comida", label: "Salida comida" },
  { key: "regreso_comida", label: "Regreso comida" },
  { key: "minutos_comida", label: "Minutos comida" },
  { key: "salida_programada", label: "Salida programada" },
  { key: "salida_real", label: "Salida real" },
  { key: "horas_programadas", label: "Horas programadas" },
  { key: "horas_trabajadas", label: "Horas trabajadas" },
  { key: "horas_ordinarias", label: "Horas ordinarias" },
  { key: "horas_extra", label: "Horas extra" },
  { key: "ausencias", label: "Ausencias" },
  { key: "pago", label: "Pago" },
  { key: "estado", label: "Estado" },
  { key: "observaciones", label: "Observaciones" }
]

export const ATTENDANCE_EXPORT_PRESET_OPTIONS = [
  { id: "asistencia", label: "Asistencia" },
  { id: "planilla", label: "Planilla" },
  { id: "incidencias", label: "Incidencias" },
  { id: "ejecutivo", label: "Ejecutivo" },
  { id: "personalizado", label: "Personalizado" }
]

export const ATTENDANCE_EXPORT_PRESETS = {
  asistencia: [
    "fecha", "colaborador", "area", "entrada_programada", "entrada_real", "minutos_tarde",
    "salida_programada", "salida_real", "estado", "observaciones"
  ],
  planilla: [
    "fecha", "colaborador", "rol", "area", "horas_programadas", "horas_trabajadas",
    "horas_ordinarias", "horas_extra", "ausencias", "pago", "estado"
  ],
  incidencias: [
    "fecha", "colaborador", "area", "minutos_tarde", "ausencias", "estado", "observaciones"
  ],
  ejecutivo: [
    "fecha", "colaborador", "rol", "area", "horas_programadas", "horas_trabajadas",
    "horas_ordinarias", "horas_extra", "minutos_tarde", "ausencias", "pago", "estado", "observaciones"
  ],
  personalizado: null
}

export const ATTENDANCE_EXPORT_STATUS_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "completo", label: "Completo" },
  { value: "incompleto", label: "Incompleto" },
  { value: "tarde", label: "Tarde" },
  { value: "falta", label: "Ausente" },
  { value: "descanso", label: "Descanso" },
  { value: "asueto", label: "Vacaciones" },
  { value: "pendiente", label: "Pendiente" },
  { value: "horas_extra", label: "Horas extra" },
  { value: "pending", label: "Pendiente planilla" }
]

export function getColumnDefinitions(selectedKeys = []) {
  const keys = new Set(selectedKeys)
  return ATTENDANCE_EXPORT_COLUMNS.filter((column) => keys.has(column.key))
}

export function getPresetColumnKeys(presetId) {
  return ATTENDANCE_EXPORT_PRESETS[presetId] || []
}
