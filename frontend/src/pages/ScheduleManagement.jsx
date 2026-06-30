import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import AttendanceExportModal from "../components/attendance/AttendanceExportModal"
import {
  aggregatePayrollFromDetails,
  listWeekStartsInRange
} from "../modules/attendance/attendanceExportService"
import {
  ATTENDANCE_RECORD_STATUS_OPTIONS,
  buildShiftTypeFilterOptions,
  filterAttendanceDetailRows,
  resolveAttendanceShiftTypeLabel
} from "../modules/attendance/attendanceFilterUtils"
import {
  ATTENDANCE_PERIOD_OPTIONS,
  formatAttendancePeriodLabel,
  resolveAttendancePeriodRange,
  validateAttendancePeriodRange
} from "../modules/attendance/attendancePeriodUtils"
import { mergePublishedBlocksIntoAttendanceDetails } from "../modules/attendance/attendanceRowsUtils"
import { getAttendanceTerminalProfiles } from "../services/attendanceService"
import { sanitizeAttendanceObservation } from "../utils/attendanceObservationUtils"
import { getActiveAreas } from "../services/areasService"
import {
  deleteEmployeeSchedule,
  deleteShiftType,
  getEmployeeSchedules,
  getScheduleAttendanceDetails,
  getScheduleAttendanceSummary,
  getShiftTypes,
  getShiftTemplates,
  publishScheduleWeek,
  reviewPayrollSummary,
  saveEmployeeSchedule,
  saveShiftType
} from "../services/schedulesService"
import "./ScheduleManagement.css"

const EDITOR_ROLES = ["admin", "gerente_general", "recursos_humanos", "rrhh", "gerente"]
const PUBLISHER_ROLES = ["admin", "gerente_general", "recursos_humanos", "rrhh"]
const DAYS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]
const DEFAULT_AREAS = ["Cocina", "Servicio", "Barra", "Cafeteria", "Panaderia", "Reposteria", "Mise en Place", "Almacen", "Caja", "Limpieza", "Administracion", "Otro"]
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
  extra_pendiente: "Extra pendiente",
  extra_rechazada: "Extra rechazada",
  pendiente: "Pendiente"
}
const OVERTIME_TOLERANCE_MINUTES = {
  AM: 20,
  PM: 30
}
const AREA_COLORS = {
  cocina: "#f97316",
  pizzeria: "#ef4444",
  mesas: "#3b82f6",
  meseros: "#3b82f6",
  caja: "#22c55e",
  barra: "#8b5cf6",
  cafeteria: "#eab308",
  panaderia: "#f59e0b",
  reposteria: "#ec4899",
  almacen: "#14b8a6",
  limpieza: "#64748b",
  administracion: "#06b6d4"
}

function ScheduleManagement() {
  const { user } = useAuth()
  const canEdit = EDITOR_ROLES.includes(user?.role)
  const canPublish = PUBLISHER_ROLES.includes(user?.role)
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [schedules, setSchedules] = useState([])
  const [profiles, setProfiles] = useState([])
  const [areas, setAreas] = useState([])
  const [templates, setTemplates] = useState([])
  const [shiftTypes, setShiftTypes] = useState([])
  const [payroll, setPayroll] = useState([])
  const [attendanceDetails, setAttendanceDetails] = useState([])
  const [attendanceSummaries, setAttendanceSummaries] = useState([])
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendancePeriodType, setAttendancePeriodType] = useState("week")
  const [attendanceAnchor, setAttendanceAnchor] = useState(() => getMonday(new Date()))
  const [attendanceCustomFrom, setAttendanceCustomFrom] = useState("")
  const [attendanceCustomTo, setAttendanceCustomTo] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [employeeSearch, setEmployeeSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [payrollAreaFilter, setPayrollAreaFilter] = useState("")
  const [payrollEmployeeFilter, setPayrollEmployeeFilter] = useState("")
  const [payrollShiftTypeFilter, setPayrollShiftTypeFilter] = useState("")
  const [payrollStatusFilter, setPayrollStatusFilter] = useState("")
  const [onlyMyTeam, setOnlyMyTeam] = useState(false)
  const [mobileDay, setMobileDay] = useState(0)
  const [view, setView] = useState("calendar")
  const [editingPublished, setEditingPublished] = useState(false)
  const [modal, setModal] = useState(null)
  const [shiftTypesOpen, setShiftTypesOpen] = useState(false)
  const [shiftTypeForm, setShiftTypeForm] = useState(null)
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const weekEnd = addDays(weekStart, 6)
  const weekDates = DAYS.map((label, index) => ({ label, date: addDays(weekStart, index) }))
  const areaChoices = [...new Set([...DEFAULT_AREAS, ...areas.map((area) => area.name).filter(Boolean)])]
  const activeShiftTypes = shiftTypes.filter((type) => type.status === "active")
  const shiftTypeFilterOptions = buildShiftTypeFilterOptions(shiftTypes)
  const attendanceRange = useMemo(
    () => resolveAttendancePeriodRange(attendancePeriodType, attendanceAnchor, attendanceCustomFrom, attendanceCustomTo),
    [attendanceAnchor, attendanceCustomFrom, attendanceCustomTo, attendancePeriodType]
  )
  const attendancePeriodError = validateAttendancePeriodRange(attendanceRange)

  const loadAttendanceData = useCallback(async () => {
    if (!canPublish) {
      setPayroll([])
      setAttendanceDetails([])
      setAttendanceSummaries([])
      return
    }
    if (validateAttendancePeriodRange(attendanceRange)) {
      setPayroll([])
      setAttendanceDetails([])
      setAttendanceSummaries([])
      return
    }

    setAttendanceLoading(true)
    const { from, to } = attendanceRange
    const weekStarts = listWeekStartsInRange(from, to)
    const [detailResults, summaryResults, scheduleResults] = await Promise.all([
      Promise.all(weekStarts.map((weekStart) => getScheduleAttendanceDetails(weekStart))),
      Promise.all(weekStarts.map((weekStart) => getScheduleAttendanceSummary(weekStart))),
      Promise.all(weekStarts.map((weekStart) => getEmployeeSchedules(weekStart, addDays(weekStart, 6))))
    ])

    const failedDetail = detailResults.find((result) => result.error)
    const failedSummary = summaryResults.find((result) => result.error)
    if (failedDetail?.error || failedSummary?.error) {
      setError(failedDetail?.error?.message || failedSummary?.error?.message || "No se pudieron cargar los datos de asistencia.")
      setPayroll([])
      setAttendanceDetails([])
      setAttendanceSummaries([])
      setAttendanceLoading(false)
      return
    }

    const detailsMap = new Map()
    detailResults
      .flatMap((result) => result.data || [])
      .forEach((row) => {
        if (row.shift_date >= from && row.shift_date <= to && row.schedule_id) {
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

    setAttendanceDetails(details)
    setAttendanceSummaries(summaries)
    const weekPayrollIndex = weekStarts.findIndex((weekStart) => weekStart === getMonday(from))
    setPayroll(summaryResults[weekPayrollIndex >= 0 ? weekPayrollIndex : 0]?.data || [])
    setAttendanceLoading(false)
  }, [attendanceRange, canPublish, profiles])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError("")
    const profilePromise = canEdit
      ? getAttendanceTerminalProfiles()
      : Promise.resolve({ data: [{ id: user.id, full_name: user.name, area_name: user.areaName }], error: null })
    const [scheduleResult, profileResult, areaResult, templateResult, shiftTypeResult] = await Promise.all([
      getEmployeeSchedules(weekStart, weekEnd),
      profilePromise,
      getActiveAreas(),
      getShiftTemplates(),
      getShiftTypes(true)
    ])
    if (scheduleResult.error) {
      setError("No se pudieron cargar los horarios. Ejecuta la migracion 020_employee_schedules.sql en Supabase.")
    }
    if (profileResult.error) setError("No se pudieron cargar los colaboradores activos.")
    setSchedules(scheduleResult.data || [])
    setProfiles((profileResult.data || []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || user.name || "Colaborador",
      area: fixMesas(profile.area_name || ""),
      areaId: profile.area_id || "",
      role: profile.role || "",
      position: profile.position || "",
      department: profile.department || ""
    })))
    setAreas(areaResult.data || [])
    setTemplates(templateResult.data || [])
    setShiftTypes(shiftTypeResult.data || [])
    setLoading(false)
  }, [canEdit, user, weekEnd, weekStart])

  useEffect(() => {
    const timeoutId = window.setTimeout(loadData, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  useEffect(() => {
    const timeoutId = window.setTimeout(loadAttendanceData, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadAttendanceData])

  useEffect(() => {
    if (attendancePeriodType === "week") {
      setAttendanceAnchor(weekStart)
    }
  }, [attendancePeriodType, weekStart])

  const visibleSchedules = schedules.filter((schedule) => {
    const employee = profiles.find((profile) => profile.id === schedule.employee_id)
    const teamMatch = !onlyMyTeam || !user?.areaName || profileMatchesArea(employee, user.areaName) || textMatches(schedule.area, user.areaName)
    return (!areaFilter || scheduleMatchesArea(schedule, employee, areaFilter)) &&
      (!employeeFilter || schedule.employee_id === employeeFilter) &&
      (!employeeSearch || textMatches(employee?.name, employeeSearch)) &&
      (!statusFilter || schedule.status === statusFilter) &&
      teamMatch
  })

  const visibleProfiles = profiles.filter((profile) => {
    if (employeeFilter && profile.id !== employeeFilter) return false
    if (employeeSearch && !textMatches(profile.name, employeeSearch)) return false
    if (areaFilter && !profileMatchesArea(profile, areaFilter)) return false
    if (onlyMyTeam && user?.areaName && !profileMatchesArea(profile, user.areaName)) {
      return visibleSchedules.some((schedule) => schedule.employee_id === profile.id)
    }
    if (!canEdit) return profile.id === user?.id
    return true
  })

  const alerts = buildAlerts(visibleSchedules, profiles, weekDates, shiftTypes)
  const summary = buildSummary(visibleSchedules, payroll, shiftTypes)
  const isPublishedWeek = schedules.some((schedule) => schedule.status === "published")
  const drafts = schedules.filter((schedule) => schedule.status === "draft").length
  const isLocked = isPublishedWeek && !editingPublished

  function openNew(employeeId, date) {
    if (!canEdit || isLocked) return
    const employee = profiles.find((profile) => profile.id === employeeId)
    setModal({
      employee_id: employeeId,
      area: employee?.area || areas[0]?.name || "",
      position: "",
      shift_date: date,
      start_time: "12:00",
      end_time: "20:00",
      break_minutes: 30,
      is_work_day: true,
      shift_type: "full",
      shift_type_id: activeShiftTypes.find((type) => type.counts_as_workday && !type.is_rest_day && !type.is_holiday)?.id || "",
      block_order: nextBlockOrder(employeeId, date),
      day_notes: "",
      notes: "",
      template: ""
    })
  }

  function openEdit(schedule) {
    if (!canEdit || (schedule.status === "published" && !editingPublished)) return
    setModal({ ...schedule, template: "" })
  }

  function applyTemplate(value) {
    const template = templates.find((item) => item.id === value)
    setModal((current) => template ? ({
      ...current,
      template: value,
      start_time: trimTime(template.start_time),
      end_time: trimTime(template.end_time),
      break_minutes: template.break_minutes,
      is_work_day: true,
      shift_type: isNonWorkShift(current, shiftTypes) ? "full" : current.shift_type,
      area: template.area || current.area
    }) : ({ ...current, template: value }))
  }

  function applyShiftType(value) {
    const type = shiftTypes.find((item) => item.id === value)
    setModal((current) => {
      if (!current) return current
      if (!type) return { ...current, shift_type_id: "", shift_type: "full", is_work_day: true }
      const nonWork = isNonWorkShiftType(type)
      return {
        ...current,
        shift_type_id: type.id,
        shift_type: type.id,
        is_work_day: !nonWork,
        start_time: nonWork ? "" : (type.start_time ? trimTime(type.start_time) : current.start_time || "12:00"),
        end_time: nonWork ? "" : (type.end_time ? trimTime(type.end_time) : current.end_time || "20:00"),
        break_minutes: nonWork ? 0 : current.break_minutes,
        area: nonWork ? type.name : current.area,
        position: nonWork ? "" : current.position,
        template: nonWork ? "" : current.template
      }
    })
  }

  async function persistSchedule(event) {
    event.preventDefault()
    if (!modal) return
    const payload = buildSchedulePayload(modal, shiftTypes)
    if (!payload.employee_id || (!isNonWorkShift(payload, shiftTypes) && (!payload.area || !payload.start_time || !payload.end_time))) {
      setError("Colaborador, area y horario son obligatorios para dias laborales.")
      return
    }
    setSaving(true)
    const { error: saveError } = await saveEmployeeSchedule(payload)
    setSaving(false)
    if (saveError) {
      setError(saveError.message || "No se pudo guardar el turno.")
      return
    }
    setModal(null)
    setMessage("Turno guardado en borrador correctamente.")
    await loadData()
  }

  async function removeSchedule(schedule) {
    if (!window.confirm("¿Deseas eliminar este turno?")) return
    const { error: deleteError } = await deleteEmployeeSchedule(schedule.id)
    if (deleteError) {
      setError(deleteError.message || "No se pudo eliminar el turno.")
      return
    }
    setMessage("Turno eliminado.")
    await loadData()
  }

  async function copyShift(schedule, targetDate = schedule.shift_date) {
    const copy = getCopyPayload(schedule)
    const { error: copyError } = await saveEmployeeSchedule({ ...copy, shift_date: targetDate, status: "draft" })
    if (copyError) {
      setError(copyError.message || "No se pudo copiar el turno.")
      return
    }
    setMessage("Turno copiado como borrador.")
    await loadData()
  }

  async function dropShift(event, employeeId, date) {
    event.preventDefault()
    if (!canEdit || isLocked) return
    const transfer = JSON.parse(event.dataTransfer.getData("text/plain") || "{}")
    const schedule = schedules.find((item) => item.id === transfer.id)
    if (!schedule) return
    if (event.ctrlKey || transfer.copy) {
      await copyShift({ ...schedule, employee_id: employeeId }, date)
      return
    }
    const { error: moveError } = await saveEmployeeSchedule({ ...schedule, employee_id: employeeId, shift_date: date })
    if (moveError) {
      setError(moveError.message || "No se pudo mover el turno.")
      return
    }
    setMessage("Turno movido.")
    await loadData()
  }

  async function duplicatePreviousWeek() {
    if (!window.confirm("Se copiaran los turnos de la semana anterior como borradores. ¿Continuar?")) return
    const previousStart = addDays(weekStart, -7)
    const previousResult = await getEmployeeSchedules(previousStart, addDays(previousStart, 6))
    if (previousResult.error) {
      setError("No se pudo leer la semana anterior.")
      return
    }
    for (const schedule of previousResult.data || []) {
      const copy = getCopyPayload(schedule)
      const shiftedDate = addDays(schedule.shift_date, 7)
      const result = await saveEmployeeSchedule({ ...copy, shift_date: shiftedDate, status: "draft" })
      if (result.error) {
        setError(result.error.message || "No se pudo duplicar toda la semana.")
        return
      }
    }
    setMessage("Semana anterior duplicada como borrador.")
    await loadData()
  }

  async function publishWeek() {
    if (!window.confirm("Al publicar, los colaboradores recibiran una notificacion y se bloquearan cambios accidentales. ¿Publicar?")) return
    const { data, error: publishError } = await publishScheduleWeek(weekStart)
    if (publishError) {
      setError(publishError.message || "No se pudo publicar el horario.")
      return
    }
    window.dispatchEvent(new CustomEvent("notifications-updated"))
    setEditingPublished(false)
    setMessage(`Horario publicado. ${Number(data || 0)} turno(s) pasaron de borrador a publicado.`)
    await loadData()
    await loadAttendanceData()
  }

  async function updatePayrollStatus(row, status) {
    const result = await reviewPayrollSummary(row.employee_id, weekStart, status)
    if (result.error) {
      setError(result.error.message || "No se pudo actualizar planilla.")
      return
    }
    setMessage("Resumen de planilla actualizado.")
    await loadAttendanceData()
  }

  const filteredAttendanceDetails = filterAttendanceDetailRows(
    attendanceDetails.filter((row) => row.shift_date >= attendanceRange.from && row.shift_date <= attendanceRange.to),
    {
      area: payrollAreaFilter,
      employeeId: payrollEmployeeFilter,
      shiftType: payrollShiftTypeFilter,
      status: payrollStatusFilter
    },
    shiftTypes
  )

  const isWeeklyPayrollView = attendancePeriodType === "week" &&
    attendanceRange.from === weekStart &&
    attendanceRange.to === weekEnd &&
    !attendancePeriodError

  const displayPayroll = useMemo(() => {
    if (isWeeklyPayrollView) {
      return payroll.filter((row) => (
        filteredAttendanceDetails.some((detail) => detail.employee_id === row.employee_id) ||
        (!payrollEmployeeFilter && !payrollAreaFilter && !payrollShiftTypeFilter && !payrollStatusFilter)
      ))
    }
    return aggregatePayrollFromDetails(filteredAttendanceDetails, attendanceSummaries)
  }, [
    attendancePeriodError,
    attendanceSummaries,
    payrollAreaFilter,
    payrollEmployeeFilter,
    payrollShiftTypeFilter,
    payrollStatusFilter,
    filteredAttendanceDetails,
    isWeeklyPayrollView,
    payroll
  ])

  async function persistShiftType(event) {
    event.preventDefault()
    if (!shiftTypeForm) return
    const { error: saveError } = await saveShiftType(shiftTypeForm)
    if (saveError) {
      setError(saveError.message || "No se pudo guardar el tipo de turno.")
      return
    }
    setShiftTypeForm(null)
    setMessage("Tipo de turno guardado.")
    const { data } = await getShiftTypes(true)
    setShiftTypes(data || [])
  }

  async function removeShiftType(type) {
    if (!window.confirm("Eliminar solo funciona si el tipo de turno no ha sido usado. Continuar?")) return
    const { error: deleteError } = await deleteShiftType(type.id)
    if (deleteError) {
      setError(deleteError.message || "No se pudo eliminar el tipo de turno.")
      return
    }
    setMessage("Tipo de turno eliminado.")
    const { data } = await getShiftTypes(true)
    setShiftTypes(data || [])
  }

  function clearFilters() {
    setAreaFilter("")
    setEmployeeFilter("")
    setEmployeeSearch("")
    setStatusFilter("")
    setOnlyMyTeam(false)
  }

  function clearPayrollFilters() {
    setPayrollAreaFilter("")
    setPayrollEmployeeFilter("")
    setPayrollShiftTypeFilter("")
    setPayrollStatusFilter("")
  }

  function nextBlockOrder(employeeId, date) {
    const dayBlocks = schedules.filter((item) => item.employee_id === employeeId && item.shift_date === date)
    return dayBlocks.length ? Math.max(...dayBlocks.map((item) => Number(item.block_order || 1))) + 1 : 1
  }

  return (
    <section className="schedule-page">
      <header className="schedule-header">
        <div>
          <p className="schedule-eyebrow">Recursos Humanos</p>
          <h1>Horarios de colaboradores</h1>
          <p className="schedule-muted">Planifica turnos, publica horarios y compara asistencia real.</p>
        </div>
        {canEdit && (
          <div className="schedule-header-actions">
            <button className="schedule-secondary" type="button" onClick={duplicatePreviousWeek} disabled={isLocked}>Duplicar semana anterior</button>
            {canPublish && <button className="schedule-secondary" type="button" onClick={() => setShiftTypesOpen(true)}>Tipos de turno</button>}
            {canPublish && drafts > 0 && <button className="schedule-primary" type="button" onClick={publishWeek}>Publicar horario</button>}
            {canPublish && isPublishedWeek && (
              <button className="schedule-secondary" type="button" onClick={() => setEditingPublished((value) => !value)}>
                {editingPublished ? "Bloquear edicion" : "Editar horario publicado"}
              </button>
            )}
          </div>
        )}
      </header>

      {message && <div className="schedule-success">{message}</div>}
      {error && <div className="schedule-error">{error}</div>}

      <div className="schedule-summary">
        <SummaryCard label="Colaboradores programados" value={summary.employees} />
        <SummaryCard label="Horas estimadas" value={`${summary.hours.toFixed(1)} h`} />
        <SummaryCard label="Costo estimado" value={`Q${summary.pay.toFixed(2)}`} />
        <SummaryCard label="Turnos en borrador" value={drafts} />
        <SummaryCard label="Alertas activas" value={alerts.length} warning={alerts.length > 0} />
      </div>
      <div className="schedule-area-hours">
        <strong>Horas por area</strong>
        {Object.entries(summary.byArea).map(([area, hours]) => <span key={area}>{area}: <b>{hours.toFixed(1)} h</b></span>)}
        {!Object.keys(summary.byArea).length && <span>Sin turnos programados.</span>}
      </div>

      <div className="schedule-toolbar">
        <label>Semana<input type="date" value={weekStart} onChange={(event) => setWeekStart(getMonday(event.target.value))} /></label>
        {view !== "payroll" && (
          <>
            <label>Area<select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="">Todas</option>{areaChoices.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
            <label>Buscar nombre<input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} placeholder="Nombre del colaborador" /></label>
            <label>Colaborador<select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">Todos</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos</option><option value="draft">Borrador</option><option value="published">Publicado</option></select></label>
          </>
        )}
        {canEdit && <label className="schedule-check"><input type="checkbox" checked={onlyMyTeam} onChange={(event) => setOnlyMyTeam(event.target.checked)} /> Solo mi equipo</label>}
        {view !== "payroll" && <button className="schedule-secondary" type="button" onClick={clearFilters}>Limpiar filtros</button>}
      </div>
      <p className="schedule-results">Mostrando {visibleProfiles.length} colaboradores</p>

      <nav className="schedule-tabs">
        <button type="button" className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>Calendario semanal</button>
        {canPublish && <button type="button" className={view === "payroll" ? "active" : ""} onClick={() => setView("payroll")}>Planilla y asistencia</button>}
      </nav>

      {view === "calendar" && (
        <>
          <div className="schedule-mobile-days">
            {weekDates.map((day, index) => <button type="button" key={day.date} className={mobileDay === index ? "active" : ""} onClick={() => setMobileDay(index)}>{day.label.slice(0, 3)}</button>)}
          </div>
          {loading ? <div className="schedule-empty">Cargando horarios...</div> : (
            <div className="schedule-calendar">
              <div className="schedule-calendar-heading"><span>Colaborador</span>{weekDates.map((day) => <strong key={day.date}>{day.label}<small>{formatShortDate(day.date)}</small></strong>)}</div>
              {visibleProfiles.map((profile) => (
                <div className="schedule-row" key={profile.id}>
                  <aside><strong>{profile.name}</strong><span>{profile.area || "Sin area"}</span></aside>
                  {weekDates.map((day, index) => (
                    <div
                      key={day.date}
                      className={`schedule-cell ${mobileDay === index ? "mobile-selected" : ""} ${canEdit && !isLocked ? "editable" : ""}`}
                      onClick={() => openNew(profile.id, day.date)}
                      onDragOver={(event) => canEdit && !isLocked && event.preventDefault()}
                      onDrop={(event) => dropShift(event, profile.id, day.date)}
                    >
                      {visibleSchedules.filter((schedule) => schedule.employee_id === profile.id && schedule.shift_date === day.date).map((schedule) => (
                        <ShiftCard
                          key={schedule.id}
                          schedule={schedule}
                          shiftTypes={shiftTypes}
                          employeeName={profile.name}
                          editable={canEdit && (schedule.status !== "published" || editingPublished)}
                          onEdit={() => openEdit(schedule)}
                          onCopy={() => copyShift({ ...schedule, block_order: nextBlockOrder(schedule.employee_id, schedule.shift_date) })}
                          onDelete={() => removeSchedule(schedule)}
                        />
                      ))}
                      {canEdit && !isLocked && <button className="schedule-add" type="button" onClick={(event) => { event.stopPropagation(); openNew(profile.id, day.date) }}>+ Bloque / descanso</button>}
                    </div>
                  ))}
                </div>
              ))}
              {!visibleProfiles.length && <div className="schedule-empty">No hay colaboradores para este filtro.</div>}
            </div>
          )}
          <div className="schedule-alerts">
            <h2>Alertas inteligentes</h2>
            {alerts.length ? alerts.map((alert) => <p key={alert}>{alert}</p>) : <span>Sin alertas para esta semana.</span>}
          </div>
        </>
      )}

      {view === "payroll" && canPublish && (
        <section className="schedule-payroll">
          <header>
            <div>
              <h2>Asistencia y planilla</h2>
              <p>Compara horarios publicados con los marcajes reales.</p>
            </div>
            <button className="schedule-secondary" type="button" onClick={() => setExportModalOpen(true)}>Exportar reporte</button>
          </header>

          <div className="schedule-attendance-period">
            <label>Tipo de periodo
              <select value={attendancePeriodType} onChange={(event) => setAttendancePeriodType(event.target.value)}>
                {ATTENDANCE_PERIOD_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            {attendancePeriodType !== "custom" && (
              <label>{attendancePeriodType === "day" ? "Fecha" : attendancePeriodType === "week" ? "Semana del" : attendancePeriodType === "month" ? "Mes de" : "Ano de"}
                <input type="date" value={attendanceAnchor} onChange={(event) => setAttendanceAnchor(event.target.value)} />
              </label>
            )}
            {attendancePeriodType === "custom" && (
              <>
                <label>Fecha desde<input type="date" value={attendanceCustomFrom || attendanceAnchor} onChange={(event) => setAttendanceCustomFrom(event.target.value)} /></label>
                <label>Fecha hasta<input type="date" value={attendanceCustomTo || attendanceAnchor} onChange={(event) => setAttendanceCustomTo(event.target.value)} /></label>
              </>
            )}
            <label>Area
              <select value={payrollAreaFilter} onChange={(event) => setPayrollAreaFilter(event.target.value)}>
                <option value="">Todas</option>
                {areaChoices.map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
            </label>
            <label>Colaborador
              <select value={payrollEmployeeFilter} onChange={(event) => setPayrollEmployeeFilter(event.target.value)}>
                <option value="">Todos</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <label>Tipo de turno
              <select value={payrollShiftTypeFilter} onChange={(event) => setPayrollShiftTypeFilter(event.target.value)}>
                {shiftTypeFilterOptions.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>Estado
              <select value={payrollStatusFilter} onChange={(event) => setPayrollStatusFilter(event.target.value)}>
                {ATTENDANCE_RECORD_STATUS_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <button className="schedule-secondary" type="button" onClick={clearPayrollFilters}>Limpiar filtros</button>
          </div>

          <p className="schedule-results">
            Periodo: {formatAttendancePeriodLabel(attendancePeriodType, attendanceRange)}
            {" · "}
            {attendanceLoading
              ? "Cargando registros..."
              : attendancePeriodError
                ? attendancePeriodError
                : `${filteredAttendanceDetails.length} registro${filteredAttendanceDetails.length === 1 ? "" : "s"}`}
          </p>

          <div className="schedule-payroll-table">
            <table>
              <thead><tr><th>Colaborador</th><th>Area</th><th>Programadas</th><th>Reales</th><th>Ordinarias</th><th>Extra</th><th>Extra pend.</th><th>Extra aprob.</th><th>Tarde</th><th>Ausencias</th><th>Pago</th><th>Estado</th>{isWeeklyPayrollView && <th>Acciones</th>}</tr></thead>
              <tbody>
                {displayPayroll.map((row) => (
                  <tr key={row.employee_id}>
                    <td>{row.employee_name}</td><td>{row.area}</td><td>{row.scheduled_hours} h</td><td>{row.actual_hours} h</td><td>{row.regular_hours} h</td>
                    <td className={Number(row.overtime_hours) > 0 ? "warning" : ""}>{row.overtime_hours} h</td>
                    <td className={Number(row.pending_extra_hours) > 0 ? "warning" : ""}>{row.pending_extra_hours || 0} h</td>
                    <td className={Number(row.approved_extra_hours) > 0 ? "warning" : ""}>{row.approved_extra_hours || 0} h</td>
                    <td>{row.late_minutes} min</td><td>{row.absences}</td><td>Q{Number(row.estimated_pay).toFixed(2)}</td>
                    <td><span className={`schedule-status ${row.payroll_status}`}>{payrollLabel(row.payroll_status)}</span></td>
                    {isWeeklyPayrollView && (
                      <td><button type="button" onClick={() => updatePayrollStatus(row, "reviewed")}>Revisar</button><button type="button" onClick={() => updatePayrollStatus(row, "approved")}>Aprobar</button></td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!attendanceLoading && !displayPayroll.length && (
              <div className="schedule-empty">
                {attendancePeriodError || "No hay registros de asistencia para el periodo seleccionado."}
              </div>
            )}
          </div>
          <h2>Detalle de marcajes vs. horario</h2>
          <div className="schedule-payroll-table">
            <table>
              <thead><tr><th>Fecha</th><th>Colaborador</th><th>Turno</th><th>Area</th><th>Entrada prog.</th><th>Entrada real</th><th>Tarde</th><th>Salida comida</th><th>Regreso comida</th><th>Min comida</th><th>Salida prog.</th><th>Salida real</th><th>Prog.</th><th>Trab.</th><th>Extra</th><th>Extra pend.</th><th>Extra aprob.</th><th>Estado</th><th>Observaciones</th></tr></thead>
              <tbody>
                {filteredAttendanceDetails.map((row) => (
                  <tr key={row.schedule_id}>
                    <td>{row.shift_date}</td><td>{row.employee_name}</td>
                    <td><span className={`schedule-status ${row.shift_type}`}>{resolveAttendanceShiftTypeLabel(row, shiftTypes)}</span></td>
                    <td>{row.area || "-"}</td>
                    <td>{row.is_work_day ? formatTime(row.scheduled_start) : "-"}</td><td>{formatMarkTime(row.actual_start)}</td>
                    <td>{row.late_minutes || 0} min</td>
                    <td>{formatMarkTime(row.meal_out)}</td><td>{formatMarkTime(row.meal_back)}</td><td>{row.meal_minutes || 0} min</td>
                    <td>{row.is_work_day ? formatTime(row.scheduled_end) : "-"}</td><td>{formatMarkTime(row.actual_end)}</td>
                    <td>{row.scheduled_hours || 0} h</td><td>{row.actual_hours || 0} h</td><td className={Number(row.overtime_hours) > 0 ? "warning" : ""}>{row.overtime_hours || 0} h</td>
                    <td className={Number(row.pending_extra_hours) > 0 ? "warning" : ""}>{row.pending_extra_hours || 0} h</td>
                    <td className={Number(row.approved_extra_hours) > 0 ? "warning" : ""}>{row.approved_extra_hours || 0} h</td>
                    <td><span className={`schedule-status ${row.attendance_status}`}>{attendanceStatusLabel(row.attendance_status)}</span></td>
                    <td>{sanitizeAttendanceObservation(row.observations) || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!attendanceLoading && !filteredAttendanceDetails.length && (
              <div className="schedule-empty">
                {attendancePeriodError || "No hay registros de asistencia para el periodo seleccionado."}
              </div>
            )}
          </div>
        </section>
      )}

      {modal && (
        <div className="schedule-modal-overlay">
          <form className="schedule-modal" onSubmit={persistSchedule}>
            <header><div><p className="schedule-eyebrow">Turno rapido</p><h2>{modal.id ? "Editar turno" : "Nuevo turno"}</h2></div><button type="button" onClick={() => setModal(null)}>Cerrar</button></header>
            {!isNonWorkShift(modal, shiftTypes) && (
              <label>Plantilla<select value={modal.template} onChange={(event) => applyTemplate(event.target.value)}><option value="">Personalizado</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            )}
            <label>Colaborador<select required value={modal.employee_id} onChange={(event) => setModal({ ...modal, employee_id: event.target.value })}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <div className="schedule-modal-grid">
              <label>Tipo de turno<select value={modal.shift_type_id || ""} onChange={(event) => applyShiftType(event.target.value)}><option value="">Tipo manual</option>{activeShiftTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
              <label>Bloque #<input type="number" min="1" value={modal.block_order || 1} onChange={(event) => setModal({ ...modal, block_order: event.target.value })} /></label>
              {!isNonWorkShift(modal, shiftTypes) && (
                <>
                  <label>Area<select required value={modal.area || ""} onChange={(event) => setModal({ ...modal, area: event.target.value })}><option value="">Selecciona area</option>{areaChoices.map((area) => <option key={area} value={area}>{area}</option>)}</select></label>
                  <label>Puesto<input value={modal.position || ""} onChange={(event) => setModal({ ...modal, position: event.target.value })} placeholder="Ej. Cocinero" /></label>
                  <label>Break (minutos)<input type="number" min="0" value={modal.break_minutes} onChange={(event) => setModal({ ...modal, break_minutes: event.target.value })} /></label>
                  <label>Hora entrada<input type="time" value={trimTime(modal.start_time)} onChange={(event) => setModal({ ...modal, start_time: event.target.value })} required /></label>
                  <label>Hora salida<input type="time" value={trimTime(modal.end_time)} onChange={(event) => setModal({ ...modal, end_time: event.target.value })} required /></label>
                </>
              )}
              <label>Fecha<input type="date" value={modal.shift_date} onChange={(event) => setModal({ ...modal, shift_date: event.target.value })} required /></label>
            </div>
            <label>Observacion del dia<textarea value={modal.day_notes || modal.notes || ""} onChange={(event) => setModal({ ...modal, day_notes: event.target.value, notes: event.target.value })} placeholder="Ej. 9:00 a 12:00 Mise en Place / 12:00 a 18:00 Servicio" /></label>
            {!isNonWorkShift(modal, shiftTypes) && (
              <p className="schedule-hours">Horas estimadas: <strong>{shiftHours(modal, shiftTypes).toFixed(2)} h</strong></p>
            )}
            <footer><button className="schedule-secondary" type="button" onClick={() => setModal(null)}>Cancelar</button><button className="schedule-primary" disabled={saving}>{saving ? "Guardando..." : "Guardar turno"}</button></footer>
          </form>
        </div>
      )}

      {shiftTypesOpen && (
        <div className="schedule-modal-overlay">
          <div className="schedule-modal shift-types-modal">
            <header><div><p className="schedule-eyebrow">Recursos Humanos</p><h2>Tipos de turno</h2></div><button type="button" onClick={() => { setShiftTypesOpen(false); setShiftTypeForm(null) }}>Cerrar</button></header>
            <div className="shift-types-list">
              {shiftTypes.map((type) => (
                <article className="shift-type-row" key={type.id}>
                  <span className="shift-type-dot" style={{ background: type.color || "#14b8a6" }} />
                  <div><strong>{type.name}</strong><small>{isNonWorkShiftType(type) ? "No laborable" : `${formatTime(type.start_time)} - ${formatTime(type.end_time)}`} · {type.status === "active" ? "Activo" : "Inactivo"}</small></div>
                  <button className="schedule-secondary" type="button" onClick={() => setShiftTypeForm({ ...type })}>Editar</button>
                  <button className="schedule-secondary danger" type="button" onClick={() => removeShiftType(type)}>Eliminar</button>
                </article>
              ))}
              {!shiftTypes.length && <div className="schedule-empty">Sin tipos de turno configurados.</div>}
            </div>
            <button className="schedule-primary" type="button" onClick={() => setShiftTypeForm(emptyShiftType())}>Nuevo tipo de turno</button>
          </div>
        </div>
      )}

      <AttendanceExportModal
        open={exportModalOpen && canPublish}
        onClose={() => setExportModalOpen(false)}
        defaultDateFrom={attendanceRange.from}
        defaultDateTo={attendanceRange.to}
        defaultArea={payrollAreaFilter}
        defaultEmployeeId={payrollEmployeeFilter}
        defaultShiftType={payrollShiftTypeFilter}
        defaultRole=""
        defaultStatus={payrollStatusFilter}
        areaChoices={areaChoices}
        profiles={profiles}
        shiftTypes={shiftTypes}
      />

      {shiftTypeForm && (
        <div className="schedule-modal-overlay">
          <form className="schedule-modal" onSubmit={persistShiftType}>
            <header><div><p className="schedule-eyebrow">Tipos de turno</p><h2>{shiftTypeForm.id ? "Editar tipo" : "Nuevo tipo"}</h2></div><button type="button" onClick={() => setShiftTypeForm(null)}>Cerrar</button></header>
            <div className="schedule-modal-grid">
              <label>Nombre<input value={shiftTypeForm.name || ""} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, name: event.target.value })} required /></label>
              <label>Entrada<input type="time" value={shiftTypeForm.start_time ? trimTime(shiftTypeForm.start_time) : ""} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, start_time: event.target.value })} /></label>
              <label>Salida<input type="time" value={shiftTypeForm.end_time ? trimTime(shiftTypeForm.end_time) : ""} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, end_time: event.target.value })} /></label>
              <label>Horas estimadas<input type="number" min="0" step="0.25" value={shiftTypeForm.estimated_hours ?? ""} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, estimated_hours: event.target.value })} /></label>
              <label>Color<input type="color" value={shiftTypeForm.color || "#14b8a6"} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, color: event.target.value })} /></label>
              <label>Estado<select value={shiftTypeForm.status || "active"} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, status: event.target.value })}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label>
              <label className="schedule-check"><input type="checkbox" checked={shiftTypeForm.counts_as_workday !== false} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, counts_as_workday: event.target.checked })} /> Cuenta como dia trabajado</label>
              <label className="schedule-check"><input type="checkbox" checked={shiftTypeForm.is_rest_day === true} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, is_rest_day: event.target.checked, counts_as_workday: event.target.checked ? false : shiftTypeForm.counts_as_workday })} /> Cuenta como descanso</label>
              <label className="schedule-check"><input type="checkbox" checked={shiftTypeForm.is_holiday === true} onChange={(event) => setShiftTypeForm({ ...shiftTypeForm, is_holiday: event.target.checked, counts_as_workday: event.target.checked ? false : shiftTypeForm.counts_as_workday })} /> Cuenta como asueto</label>
            </div>
            <footer><button className="schedule-secondary" type="button" onClick={() => setShiftTypeForm(null)}>Cancelar</button><button className="schedule-primary">Guardar</button></footer>
          </form>
        </div>
      )}
    </section>
  )
}

function ShiftCard({ schedule, shiftTypes, employeeName, editable, onEdit, onCopy, onDelete }) {
  const shiftType = shiftTypes.find((type) => type.id === schedule.shift_type_id || type.id === schedule.shift_type)
  const color = shiftType?.color || AREA_COLORS[normalizeText(schedule.area)] || "#14b8a6"
  const isRest = isNonWorkShift(schedule, shiftTypes)
  const typeLabel = shiftTypeLabel(schedule.shift_type_id || schedule.shift_type, shiftTypes)
  return (
    <article
      className="schedule-shift"
      style={{ "--shift-color": color }}
      draggable={editable}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", JSON.stringify({ id: schedule.id }))}
      onClick={(event) => { event.stopPropagation(); if (editable) onEdit() }}
    >
      <b>{employeeName}</b>
      <strong>{isRest ? typeLabel : schedule.area}</strong>
      <time>{isRest ? typeLabel : `${formatTime(schedule.start_time)} - ${formatTime(schedule.end_time)}`}</time>
      <small>Bloque {schedule.block_order || 1} - {typeLabel}{!isRest ? ` - ${shiftHours(schedule, shiftTypes).toFixed(1)} h${Number(schedule.break_minutes) ? ` - Comida ${schedule.break_minutes}m` : ""}` : ""}</small>
      <span className={`schedule-status ${schedule.status}`}>{schedule.status === "published" ? "Publicado" : "Borrador"}</span>
      {editable && <div className="schedule-shift-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onCopy() }}>Copiar</button><button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }}>Eliminar</button></div>}
    </article>
  )
}

function SummaryCard({ label, value, warning = false }) {
  return <article className={warning ? "warning" : ""}><span>{label}</span><strong>{value}</strong></article>
}

function buildSummary(schedules, payroll, shiftTypes = []) {
  const byArea = schedules.reduce((result, schedule) => {
    if (isNonWorkShift(schedule, shiftTypes)) return result
    result[schedule.area || "Sin area"] = (result[schedule.area || "Sin area"] || 0) + shiftHours(schedule, shiftTypes)
    return result
  }, {})
  return {
    employees: new Set(schedules.map((schedule) => schedule.employee_id)).size,
    hours: schedules.reduce((total, schedule) => total + shiftHours(schedule, shiftTypes), 0),
    pay: payroll.reduce((total, item) => total + Number(item.estimated_pay || 0), 0),
    byArea
  }
}

function getCopyPayload(schedule) {
  const copy = { ...schedule }
  delete copy.id
  delete copy.created_at
  delete copy.updated_at
  delete copy.published_at
  return copy
}

function buildAlerts(schedules, profiles, weekDates, shiftTypes = []) {
  const alerts = []
  profiles.forEach((profile) => {
    const employeeShifts = schedules.filter((schedule) => schedule.employee_id === profile.id)
    const workShifts = employeeShifts.filter((schedule) => !isNonWorkShift(schedule, shiftTypes))
    const hours = employeeShifts.reduce((total, shift) => total + shiftHours(shift, shiftTypes), 0)
    if (hours > 48) alerts.push(`${profile.name}: supera 48 horas programadas (${hours.toFixed(1)} h).`)
    if (new Set(workShifts.map((shift) => shift.shift_date)).size === 7) alerts.push(`${profile.name}: sin descanso semanal.`)
    workShifts.forEach((shift, index) => workShifts.slice(index + 1).forEach((other) => {
      if (shift.shift_date === other.shift_date && overlaps(shift, other, shiftTypes)) alerts.push(`${profile.name}: tiene choque de horarios el ${shift.shift_date}.`)
    }))
  })
  schedules.filter((schedule) => !isNonWorkShift(schedule, shiftTypes) && !schedule.area).forEach(() => alerts.push("Existe un turno sin area asignada."))
  weekDates.forEach((day) => {
    const shifts = schedules.filter((schedule) => schedule.shift_date === day.date && !isNonWorkShift(schedule, shiftTypes))
    if (shifts.length && !shifts.some((schedule) => trimTime(schedule.start_time) <= "12:00")) alerts.push(`${day.label}: apertura sin suficiente personal.`)
    if (shifts.length && !shifts.some((schedule) => trimTime(schedule.end_time) >= "22:00")) alerts.push(`${day.label}: cierre sin suficiente personal.`)
  })
  return [...new Set(alerts)]
}

function overlaps(first, second, shiftTypes = []) {
  if (isNonWorkShift(first, shiftTypes) || isNonWorkShift(second, shiftTypes)) return false
  return trimTime(first.start_time) < trimTime(second.end_time) && trimTime(second.start_time) < trimTime(first.end_time)
}

function shiftHours(schedule, shiftTypes = []) {
  if (isNonWorkShift(schedule, shiftTypes)) return 0
  const [startHours, startMinutes] = trimTime(schedule.start_time).split(":").map(Number)
  const [endHours, endMinutes] = trimTime(schedule.end_time).split(":").map(Number)
  let minutes = endHours * 60 + endMinutes - (startHours * 60 + startMinutes)
  if (minutes < 0) minutes += 24 * 60
  return Math.max(0, minutes - Number(schedule.break_minutes || 0)) / 60
}

function getMonday(value) {
  const date = new Date(`${typeof value === "string" ? value : value.toISOString().slice(0, 10)}T12:00:00`)
  const offset = (date.getDay() + 6) % 7
  date.setDate(date.getDate() - offset)
  return date.toISOString().slice(0, 10)
}

function addDays(dateValue, days) {
  const date = new Date(`${dateValue}T12:00:00`)
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function trimTime(value) {
  return String(value || "00:00").slice(0, 5)
}

function formatTime(value) {
  if (!value) return "-"
  const [hours, minutes] = trimTime(value).split(":").map(Number)
  const period = hours >= 12 ? "PM" : "AM"
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${period}`
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("es-GT", { day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00`))
}

function formatMarkTime(value) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("es-GT", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Guatemala" }).format(new Date(value))
}

function normalizeText(value) {
  return fixMesas(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function fixMesas(value) {
  return String(value || "").replace(/Mesetas/g, "Mesas").replace(/mesetas/g, "mesas")
}

function textMatches(value, filter) {
  const normalizedFilter = normalizeText(filter)
  if (!normalizedFilter) return true
  return normalizeText(value).includes(normalizedFilter)
}

function profileMatchesArea(profile, filter) {
  if (!profile) return false
  return [profile.area, profile.areaId, profile.role, profile.position, profile.department].some((value) => textMatches(value, filter))
}

function scheduleMatchesArea(schedule, profile, filter) {
  return [schedule?.area, schedule?.area_id, schedule?.role, schedule?.position, schedule?.department].some((value) => textMatches(value, filter)) ||
    profileMatchesArea(profile, filter)
}

function payrollLabel(value) {
  return { pending: "Pendiente", reviewed: "Revisado", approved: "Aprobado" }[value] || value
}

function shiftTypeLabel(value, shiftTypes = []) {
  return shiftTypes.find((type) => type.id === value)?.name || LEGACY_SHIFT_TYPES[value] || value || "Turno"
}

function isNonWorkShiftType(type) {
  if (!type) return false
  return type.is_rest_day || type.is_holiday || !type.counts_as_workday
}

function resolveShiftTypeRecord(scheduleOrType, shiftTypes = []) {
  if (typeof scheduleOrType === "object" && scheduleOrType?.shift_type_id) {
    return shiftTypes.find((type) => type.id === scheduleOrType.shift_type_id) || null
  }
  const shiftTypeId = typeof scheduleOrType === "string" ? scheduleOrType : scheduleOrType?.shift_type
  if (!shiftTypeId || shiftTypeId === "full" || shiftTypeId === "half") return null
  return shiftTypes.find((type) => type.id === shiftTypeId) || null
}

function isNonWorkShift(scheduleOrType, shiftTypes = []) {
  if (typeof scheduleOrType === "object" && scheduleOrType?.is_work_day === false) return true
  const legacyType = typeof scheduleOrType === "string" ? scheduleOrType : scheduleOrType?.shift_type
  if (legacyType === "rest" || legacyType === "asueto") return true
  const type = resolveShiftTypeRecord(scheduleOrType, shiftTypes)
  return isNonWorkShiftType(type)
}

function buildSchedulePayload(modal, shiftTypes = []) {
  if (!isNonWorkShift(modal, shiftTypes)) return modal
  const type = resolveShiftTypeRecord(modal, shiftTypes)
  return {
    ...modal,
    is_work_day: false,
    start_time: "",
    end_time: "",
    break_minutes: 0,
    position: "",
    area: type?.name || modal.area || "Descanso",
    template: ""
  }
}

function attendanceStatusLabel(value) {
  return ATTENDANCE_STATUS[value] || value || "Incompleto"
}

function roleLabel(value) {
  return String(value || "").replaceAll("_", " ")
}

function emptyShiftType() {
  return {
    name: "",
    start_time: "",
    end_time: "",
    estimated_hours: "",
    counts_as_workday: true,
    is_rest_day: false,
    is_holiday: false,
    color: "#14b8a6",
    status: "active"
  }
}

export default ScheduleManagement
