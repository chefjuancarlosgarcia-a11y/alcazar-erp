import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getAttendanceTerminalProfiles } from "../services/attendanceService"
import { getActiveAreas } from "../services/areasService"
import {
  deleteEmployeeSchedule,
  getEmployeeSchedules,
  getScheduleAttendanceDetails,
  getScheduleAttendanceSummary,
  getShiftTemplates,
  publishScheduleWeek,
  reviewPayrollSummary,
  saveEmployeeSchedule
} from "../services/schedulesService"
import "./ScheduleManagement.css"

const EDITOR_ROLES = ["admin", "gerente_general", "rrhh", "gerente"]
const PUBLISHER_ROLES = ["admin", "gerente_general", "rrhh"]
const DAYS = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]
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
  const [payroll, setPayroll] = useState([])
  const [attendanceDetails, setAttendanceDetails] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [employeeFilter, setEmployeeFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [onlyMyTeam, setOnlyMyTeam] = useState(false)
  const [mobileDay, setMobileDay] = useState(0)
  const [view, setView] = useState("calendar")
  const [editingPublished, setEditingPublished] = useState(false)
  const [modal, setModal] = useState(null)
  const weekEnd = addDays(weekStart, 6)
  const weekDates = DAYS.map((label, index) => ({ label, date: addDays(weekStart, index) }))

  const loadData = useCallback(async () => {
    setLoading(true)
    setError("")
    const profilePromise = canEdit
      ? getAttendanceTerminalProfiles()
      : Promise.resolve({ data: [{ id: user.id, full_name: user.name, area_name: user.areaName }], error: null })
    const [scheduleResult, profileResult, areaResult, templateResult] = await Promise.all([
      getEmployeeSchedules(weekStart, weekEnd),
      profilePromise,
      getActiveAreas(),
      getShiftTemplates()
    ])
    if (scheduleResult.error) {
      setError("No se pudieron cargar los horarios. Ejecuta la migracion 020_employee_schedules.sql en Supabase.")
    }
    if (profileResult.error) setError("No se pudieron cargar los colaboradores activos.")
    setSchedules(scheduleResult.data || [])
    setProfiles((profileResult.data || []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || user.name || "Colaborador",
      area: profile.area_name || ""
    })))
    setAreas(areaResult.data || [])
    setTemplates(templateResult.data || [])
    if (canPublish) {
      const [payrollResult, detailsResult] = await Promise.all([
        getScheduleAttendanceSummary(weekStart),
        getScheduleAttendanceDetails(weekStart)
      ])
      setPayroll(payrollResult.data || [])
      setAttendanceDetails(detailsResult.data || [])
    } else {
      setPayroll([])
      setAttendanceDetails([])
    }
    setLoading(false)
  }, [canEdit, canPublish, user, weekEnd, weekStart])

  useEffect(() => {
    const timeoutId = window.setTimeout(loadData, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  const visibleSchedules = schedules.filter((schedule) => {
    const employee = profiles.find((profile) => profile.id === schedule.employee_id)
    const teamMatch = !onlyMyTeam || !user?.areaName || employee?.area === user.areaName || schedule.area === user.areaName
    return (!areaFilter || schedule.area === areaFilter) &&
      (!employeeFilter || schedule.employee_id === employeeFilter) &&
      (!statusFilter || schedule.status === statusFilter) &&
      teamMatch
  })

  const visibleProfiles = profiles.filter((profile) => {
    if (employeeFilter && profile.id !== employeeFilter) return false
    if (onlyMyTeam && user?.areaName && profile.area !== user.areaName) {
      return visibleSchedules.some((schedule) => schedule.employee_id === profile.id)
    }
    if (!canEdit) return profile.id === user?.id
    return true
  })

  const alerts = buildAlerts(visibleSchedules, profiles, weekDates)
  const summary = buildSummary(visibleSchedules, payroll)
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
      area: template.area || current.area
    }) : ({ ...current, template: value }))
  }

  async function persistSchedule(event) {
    event.preventDefault()
    if (!modal) return
    if (!modal.employee_id || !modal.area || !modal.start_time || !modal.end_time) {
      setError("Colaborador, area y horario son obligatorios.")
      return
    }
    setSaving(true)
    const { error: saveError } = await saveEmployeeSchedule(modal)
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
  }

  async function updatePayrollStatus(row, status) {
    const result = await reviewPayrollSummary(row.employee_id, weekStart, status)
    if (result.error) {
      setError(result.error.message || "No se pudo actualizar planilla.")
      return
    }
    setMessage("Resumen de planilla actualizado.")
    await loadData()
  }

  function exportPayroll() {
    const headers = ["Colaborador", "Area", "Horas programadas", "Horas reales", "Horas ordinarias", "Horas extra", "Tardanzas min", "Ausencias", "Pago estimado", "Estado"]
    const rows = payroll.map((row) => [
      row.employee_name, row.area, row.scheduled_hours, row.actual_hours, row.regular_hours,
      row.overtime_hours, row.late_minutes, row.absences, row.estimated_pay, row.payroll_status
    ])
    const csv = [headers, ...rows].map((row) => row.map(csvValue).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `planilla-${weekStart}.csv`
    link.click()
    URL.revokeObjectURL(url)
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
        <label>Area<select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="">Todas</option>{areas.map((area) => <option key={area.id} value={area.name}>{area.name}</option>)}</select></label>
        <label>Colaborador<select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}><option value="">Todos</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos</option><option value="draft">Borrador</option><option value="published">Publicado</option></select></label>
        {canEdit && <label className="schedule-check"><input type="checkbox" checked={onlyMyTeam} onChange={(event) => setOnlyMyTeam(event.target.checked)} /> Solo mi equipo</label>}
      </div>

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
                          employeeName={profile.name}
                          editable={canEdit && (schedule.status !== "published" || editingPublished)}
                          onEdit={() => openEdit(schedule)}
                          onCopy={() => copyShift(schedule)}
                          onDelete={() => removeSchedule(schedule)}
                        />
                      ))}
                      {canEdit && !isLocked && <button className="schedule-add" type="button" onClick={(event) => { event.stopPropagation(); openNew(profile.id, day.date) }}>+ Turno</button>}
                    </div>
                  ))}
                </div>
              ))}
              {!visibleProfiles.length && <div className="schedule-empty">No hay colaboradores para los filtros seleccionados.</div>}
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
            <div><h2>Asistencia y planilla semanal</h2><p>Compara horarios publicados con los marcajes reales.</p></div>
            <button className="schedule-secondary" type="button" onClick={exportPayroll}>Exportar CSV</button>
          </header>
          <div className="schedule-payroll-table">
            <table>
              <thead><tr><th>Colaborador</th><th>Area</th><th>Programadas</th><th>Reales</th><th>Ordinarias</th><th>Extra</th><th>Tarde</th><th>Ausencias</th><th>Pago</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {payroll.map((row) => (
                  <tr key={row.employee_id}>
                    <td>{row.employee_name}</td><td>{row.area}</td><td>{row.scheduled_hours} h</td><td>{row.actual_hours} h</td><td>{row.regular_hours} h</td>
                    <td className={Number(row.overtime_hours) > 0 ? "warning" : ""}>{row.overtime_hours} h</td>
                    <td>{row.late_minutes} min</td><td>{row.absences}</td><td>Q{Number(row.estimated_pay).toFixed(2)}</td>
                    <td><span className={`schedule-status ${row.payroll_status}`}>{payrollLabel(row.payroll_status)}</span></td>
                    <td><button type="button" onClick={() => updatePayrollStatus(row, "reviewed")}>Revisar</button><button type="button" onClick={() => updatePayrollStatus(row, "approved")}>Aprobar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!payroll.length && <div className="schedule-empty">Publica horarios para generar comparacion de asistencia y planilla.</div>}
          </div>
          <h2>Detalle de marcajes vs. horario</h2>
          <div className="schedule-payroll-table">
            <table>
              <thead><tr><th>Fecha</th><th>Colaborador</th><th>Entrada programada</th><th>Entrada real</th><th>Salida programada</th><th>Salida real</th><th>Tarde</th><th>Salida temprana</th><th>Resultado</th></tr></thead>
              <tbody>
                {attendanceDetails.map((row) => (
                  <tr key={row.schedule_id}>
                    <td>{row.shift_date}</td><td>{row.employee_name}</td>
                    <td>{formatTime(row.scheduled_start)}</td><td>{formatMarkTime(row.actual_start)}</td>
                    <td>{formatTime(row.scheduled_end)}</td><td>{formatMarkTime(row.actual_end)}</td>
                    <td>{row.late_minutes} min</td><td>{row.early_departure_minutes} min</td>
                    <td className={row.absence || Number(row.late_minutes) > 0 ? "warning" : ""}>{row.absence ? "Ausencia" : `${row.actual_hours} h reales`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {modal && (
        <div className="schedule-modal-overlay">
          <form className="schedule-modal" onSubmit={persistSchedule}>
            <header><div><p className="schedule-eyebrow">Turno rapido</p><h2>{modal.id ? "Editar turno" : "Nuevo turno"}</h2></div><button type="button" onClick={() => setModal(null)}>Cerrar</button></header>
            <label>Plantilla<select value={modal.template} onChange={(event) => applyTemplate(event.target.value)}><option value="">Personalizado</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <label>Colaborador<select required value={modal.employee_id} onChange={(event) => setModal({ ...modal, employee_id: event.target.value })}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <div className="schedule-modal-grid">
              <label>Area<select required value={modal.area} onChange={(event) => setModal({ ...modal, area: event.target.value })}><option value="">Selecciona area</option>{areas.map((area) => <option key={area.id} value={area.name}>{area.name}</option>)}</select></label>
              <label>Puesto<input value={modal.position || ""} onChange={(event) => setModal({ ...modal, position: event.target.value })} placeholder="Ej. Cocinero" /></label>
              <label>Fecha<input type="date" value={modal.shift_date} onChange={(event) => setModal({ ...modal, shift_date: event.target.value })} required /></label>
              <label>Break (minutos)<input type="number" min="0" value={modal.break_minutes} onChange={(event) => setModal({ ...modal, break_minutes: event.target.value })} /></label>
              <label>Hora entrada<input type="time" value={trimTime(modal.start_time)} onChange={(event) => setModal({ ...modal, start_time: event.target.value })} required /></label>
              <label>Hora salida<input type="time" value={trimTime(modal.end_time)} onChange={(event) => setModal({ ...modal, end_time: event.target.value })} required /></label>
            </div>
            <label>Notas<textarea value={modal.notes || ""} onChange={(event) => setModal({ ...modal, notes: event.target.value })} placeholder="Observaciones del turno" /></label>
            <p className="schedule-hours">Horas estimadas: <strong>{shiftHours(modal).toFixed(2)} h</strong></p>
            <footer><button className="schedule-secondary" type="button" onClick={() => setModal(null)}>Cancelar</button><button className="schedule-primary" disabled={saving}>{saving ? "Guardando..." : "Guardar turno"}</button></footer>
          </form>
        </div>
      )}
    </section>
  )
}

function ShiftCard({ schedule, employeeName, editable, onEdit, onCopy, onDelete }) {
  const color = AREA_COLORS[normalize(schedule.area)] || "#14b8a6"
  return (
    <article
      className="schedule-shift"
      style={{ "--shift-color": color }}
      draggable={editable}
      onDragStart={(event) => event.dataTransfer.setData("text/plain", JSON.stringify({ id: schedule.id }))}
      onClick={(event) => { event.stopPropagation(); if (editable) onEdit() }}
    >
      <b>{employeeName}</b>
      <strong>{schedule.area}</strong>
      <time>{formatTime(schedule.start_time)} - {formatTime(schedule.end_time)}</time>
      <small>{schedule.position || "Turno"} · {shiftHours(schedule).toFixed(1)} h{Number(schedule.break_minutes) ? ` · Break ${schedule.break_minutes}m` : ""}</small>
      <span className={`schedule-status ${schedule.status}`}>{schedule.status === "published" ? "Publicado" : "Borrador"}</span>
      {editable && <div className="schedule-shift-actions"><button type="button" onClick={(event) => { event.stopPropagation(); onCopy() }}>Copiar</button><button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }}>Eliminar</button></div>}
    </article>
  )
}

function SummaryCard({ label, value, warning = false }) {
  return <article className={warning ? "warning" : ""}><span>{label}</span><strong>{value}</strong></article>
}

function buildSummary(schedules, payroll) {
  const byArea = schedules.reduce((result, schedule) => {
    result[schedule.area || "Sin area"] = (result[schedule.area || "Sin area"] || 0) + shiftHours(schedule)
    return result
  }, {})
  return {
    employees: new Set(schedules.map((schedule) => schedule.employee_id)).size,
    hours: schedules.reduce((total, schedule) => total + shiftHours(schedule), 0),
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

function buildAlerts(schedules, profiles, weekDates) {
  const alerts = []
  profiles.forEach((profile) => {
    const employeeShifts = schedules.filter((schedule) => schedule.employee_id === profile.id)
    const hours = employeeShifts.reduce((total, shift) => total + shiftHours(shift), 0)
    if (hours > 48) alerts.push(`${profile.name}: supera 48 horas programadas (${hours.toFixed(1)} h).`)
    if (new Set(employeeShifts.map((shift) => shift.shift_date)).size === 7) alerts.push(`${profile.name}: sin descanso semanal.`)
    employeeShifts.forEach((shift, index) => employeeShifts.slice(index + 1).forEach((other) => {
      if (shift.shift_date === other.shift_date && overlaps(shift, other)) alerts.push(`${profile.name}: tiene choque de horarios el ${shift.shift_date}.`)
    }))
  })
  schedules.filter((schedule) => !schedule.area).forEach(() => alerts.push("Existe un turno sin area asignada."))
  weekDates.forEach((day) => {
    const shifts = schedules.filter((schedule) => schedule.shift_date === day.date)
    if (shifts.length && !shifts.some((schedule) => trimTime(schedule.start_time) <= "12:00")) alerts.push(`${day.label}: apertura sin suficiente personal.`)
    if (shifts.length && !shifts.some((schedule) => trimTime(schedule.end_time) >= "22:00")) alerts.push(`${day.label}: cierre sin suficiente personal.`)
  })
  return [...new Set(alerts)]
}

function overlaps(first, second) {
  return trimTime(first.start_time) < trimTime(second.end_time) && trimTime(second.start_time) < trimTime(first.end_time)
}

function shiftHours(schedule) {
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

function normalize(value) {
  return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function payrollLabel(value) {
  return { pending: "Pendiente", reviewed: "Revisado", approved: "Aprobado" }[value] || value
}

function csvValue(value) {
  return `"${String(value ?? "").replaceAll("\"", "\"\"")}"`
}

export default ScheduleManagement
