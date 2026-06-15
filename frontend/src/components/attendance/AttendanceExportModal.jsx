import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ATTENDANCE_EXPORT_COLUMNS,
  ATTENDANCE_EXPORT_PRESET_OPTIONS,
  ATTENDANCE_EXPORT_STATUS_OPTIONS,
  getPresetColumnKeys
} from "../../modules/attendance/attendanceExportConfig"
import {
  buildShiftTypeFilterOptions,
  filterAttendanceDetailRows
} from "../../modules/attendance/attendanceFilterUtils"
import {
  buildAttendanceExportFilename,
  buildAttendanceExportRows,
  exportAttendanceCsv,
  exportAttendanceWorkbook,
  fetchAttendanceExportDataset,
  filterAttendanceExportRows,
  projectAttendanceExportRows,
  uniqueRoleOptions,
  validateAttendanceExportInput
} from "../../modules/attendance/attendanceExportService"
import "./AttendanceExportModal.css"

export default function AttendanceExportModal({
  open,
  onClose,
  defaultDateFrom,
  defaultDateTo,
  defaultArea = "",
  defaultEmployeeId = "",
  defaultShiftType = "",
  defaultRole = "",
  defaultStatus = "",
  areaChoices = [],
  profiles = [],
  shiftTypes = []
}) {
  const [dateFrom, setDateFrom] = useState(defaultDateFrom)
  const [dateTo, setDateTo] = useState(defaultDateTo)
  const [area, setArea] = useState(defaultArea)
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId)
  const [shiftType, setShiftType] = useState(defaultShiftType)
  const [role, setRole] = useState(defaultRole)
  const [status, setStatus] = useState(defaultStatus)
  const [preset, setPreset] = useState("asistencia")
  const [selectedColumns, setSelectedColumns] = useState(() => getPresetColumnKeys("asistencia"))
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const [recordCount, setRecordCount] = useState(null)

  const roleOptions = useMemo(() => uniqueRoleOptions(profiles), [profiles])
  const shiftTypeOptions = useMemo(() => buildShiftTypeFilterOptions(shiftTypes), [shiftTypes])

  useEffect(() => {
    if (!open) return
    setDateFrom(defaultDateFrom)
    setDateTo(defaultDateTo)
    setArea(defaultArea)
    setEmployeeId(defaultEmployeeId)
    setShiftType(defaultShiftType)
    setRole(defaultRole)
    setStatus(defaultStatus)
    setPreset("asistencia")
    setSelectedColumns(getPresetColumnKeys("asistencia"))
    setError("")
    setRecordCount(null)
  }, [open, defaultArea, defaultDateFrom, defaultDateTo, defaultEmployeeId, defaultRole, defaultShiftType, defaultStatus])

  const buildFilteredExportRows = useCallback(async () => {
    const { details, summaries, error: fetchError } = await fetchAttendanceExportDataset(dateFrom, dateTo, profiles)
    if (fetchError) {
      return { rows: [], error: fetchError }
    }

    const filteredDetails = filterAttendanceDetailRows(details, {
      area,
      employeeId,
      shiftType,
      status
    }, shiftTypes)
    const rows = buildAttendanceExportRows(filteredDetails, summaries, shiftTypes)
    const filtered = filterAttendanceExportRows(rows, { area, employeeId, role, status })
    return { rows: filtered, error: null }
  }, [area, dateFrom, dateTo, employeeId, profiles, role, shiftType, shiftTypes, status])

  const refreshPreview = useCallback(async () => {
    const validationError = validateAttendanceExportInput({ dateFrom, dateTo, selectedColumnKeys: selectedColumns })
    if (validationError) {
      setRecordCount(null)
      return
    }

    setLoadingPreview(true)
    setError("")
    const { rows, error: fetchError } = await buildFilteredExportRows()
    if (fetchError) {
      setError(fetchError.message || "No se pudieron cargar los datos para exportar.")
      setRecordCount(0)
      setLoadingPreview(false)
      return
    }

    setRecordCount(rows.length)
    setLoadingPreview(false)
  }, [buildFilteredExportRows, dateFrom, dateTo, selectedColumns])

  useEffect(() => {
    if (!open) return undefined
    const timeoutId = window.setTimeout(refreshPreview, 350)
    return () => window.clearTimeout(timeoutId)
  }, [open, refreshPreview])

  function handlePresetChange(nextPreset) {
    setPreset(nextPreset)
    const presetColumns = getPresetColumnKeys(nextPreset)
    if (presetColumns) setSelectedColumns(presetColumns)
  }

  function toggleColumn(columnKey) {
    setPreset("personalizado")
    setSelectedColumns((current) => (
      current.includes(columnKey)
        ? current.filter((key) => key !== columnKey)
        : [...current, columnKey]
    ))
  }

  function selectAllColumns() {
    setPreset("personalizado")
    setSelectedColumns(ATTENDANCE_EXPORT_COLUMNS.map((column) => column.key))
  }

  function clearColumns() {
    setPreset("personalizado")
    setSelectedColumns([])
  }

  async function handleExport(format) {
    const validationError = validateAttendanceExportInput({ dateFrom, dateTo, selectedColumnKeys: selectedColumns })
    if (validationError) {
      setError(validationError)
      return
    }

    setExporting(true)
    setError("")
    try {
      const { rows: filtered, error: fetchError } = await buildFilteredExportRows()
      if (fetchError) {
        setError(fetchError.message || "No se pudieron cargar los datos para exportar.")
        return
      }
      if (!filtered.length) {
        setError("No hay registros para exportar.")
        setRecordCount(0)
        return
      }

      const projected = projectAttendanceExportRows(filtered, selectedColumns)
      const filename = buildAttendanceExportFilename(dateFrom, dateTo, format === "csv" ? "csv" : "xlsx")
      if (format === "csv") exportAttendanceCsv(projected, filename)
      else exportAttendanceWorkbook(projected, filename)
      onClose()
    } catch (exportError) {
      console.error("attendance export failed", exportError)
      setError(exportError?.message || "No se pudo generar el archivo de exportacion.")
    } finally {
      setExporting(false)
    }
  }

  if (!open) return null

  const summaryText = loadingPreview
    ? "Calculando registros..."
    : recordCount == null
      ? "Configura el rango y filtros para ver el resumen."
      : recordCount === 0
        ? "No hay registros para exportar con los filtros seleccionados."
        : `Exportaras ${recordCount} registro${recordCount === 1 ? "" : "s"} del ${dateFrom} al ${dateTo}.`

  return (
    <div className="attendance-export-overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !exporting) onClose() }}>
      <div className="attendance-export-modal" role="dialog" aria-modal="true" aria-labelledby="attendance-export-title">
        <header className="attendance-export-header">
          <div>
            <p className="attendance-export-eyebrow">Recursos Humanos</p>
            <h2 id="attendance-export-title">Exportar reporte</h2>
          </div>
          <button type="button" className="attendance-export-close" onClick={onClose} disabled={exporting}>Cerrar</button>
        </header>

        <section className="attendance-export-section">
          <h3>Rango de fechas</h3>
          <div className="attendance-export-grid">
            <label>Fecha desde<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
            <label>Fecha hasta<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
          </div>
        </section>

        <section className="attendance-export-section">
          <h3>Filtros</h3>
          <div className="attendance-export-grid">
            <label>Area
              <select value={area} onChange={(event) => setArea(event.target.value)}>
                <option value="">Todas</option>
                {areaChoices.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label>Colaborador
              <select value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
                <option value="">Todos</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <label>Tipo de turno
              <select value={shiftType} onChange={(event) => setShiftType(event.target.value)}>
                {shiftTypeOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>Rol
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="">Todos</option>
                {roleOptions.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label>Estado
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                {ATTENDANCE_EXPORT_STATUS_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="attendance-export-section">
          <h3>Tipo de reporte</h3>
          <div className="attendance-export-presets">
            {ATTENDANCE_EXPORT_PRESET_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={preset === option.id ? "active" : ""}
                onClick={() => handlePresetChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="attendance-export-section">
          <div className="attendance-export-columns-head">
            <h3>Columnas</h3>
            <div className="attendance-export-column-actions">
              <button type="button" className="attendance-export-link" onClick={selectAllColumns}>Seleccionar todas</button>
              <button type="button" className="attendance-export-link" onClick={clearColumns}>Limpiar columnas</button>
            </div>
          </div>
          <div className="attendance-export-columns">
            {ATTENDANCE_EXPORT_COLUMNS.map((column) => (
              <label key={column.key} className="attendance-export-column">
                <input
                  type="checkbox"
                  checked={selectedColumns.includes(column.key)}
                  onChange={() => toggleColumn(column.key)}
                />
                <span>{column.label}</span>
              </label>
            ))}
          </div>
        </section>

        <p className={`attendance-export-summary ${recordCount === 0 ? "warning" : ""}`}>{summaryText}</p>
        {error && <p className="attendance-export-error" role="alert">{error}</p>}

        <footer className="attendance-export-footer">
          <button type="button" className="attendance-export-secondary" onClick={onClose} disabled={exporting}>Cancelar</button>
          <button type="button" className="attendance-export-secondary" disabled={exporting || loadingPreview} onClick={() => handleExport("csv")}>Exportar CSV</button>
          <button type="button" className="attendance-export-primary" disabled={exporting || loadingPreview} onClick={() => handleExport("xlsx")}>
            {exporting ? "Exportando..." : "Exportar Excel"}
          </button>
        </footer>
      </div>
    </div>
  )
}
