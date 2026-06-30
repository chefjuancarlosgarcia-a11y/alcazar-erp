import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import {
  getAttendanceMarksForReview,
  reviewAttendanceMark
} from "../services/attendanceService"
import {
  ATTENDANCE_APPROVAL_LABELS,
  ATTENDANCE_CLASSIFICATION_LABELS
} from "../utils/attendanceClassificationUtils"
import { getAttendanceMarkLabel } from "../modules/attendance/attendanceReportsHelpers"
import "./AttendancePendingReviews.css"

const APPROVER_ROLES = ["admin", "gerente_general", "recursos_humanos", "rrhh"]
const VIEWER_ROLES = [...APPROVER_ROLES, "supervisor"]

const STATUS_FILTERS = [
  { value: "pending", label: "Pendientes" },
  { value: "approved", label: "Aprobadas" },
  { value: "rejected", label: "Rechazadas" },
  { value: "all", label: "Todas" }
]

function AttendancePendingReviews() {
  const { user } = useAuth()
  const canApprove = APPROVER_ROLES.includes(user?.role)
  const canView = VIEWER_ROLES.includes(user?.role)
  const [rows, setRows] = useState([])
  const [statusFilter, setStatusFilter] = useState("pending")
  const [fromDate, setFromDate] = useState(() => defaultFromDate())
  const [toDate, setToDate] = useState(() => defaultToDate())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [notesById, setNotesById] = useState({})
  const [busyId, setBusyId] = useState("")

  const loadRows = useCallback(async () => {
    if (!canView) return
    setLoading(true)
    setError("")
    const { data, error: queryError } = await getAttendanceMarksForReview({
      status: statusFilter,
      from: fromDate,
      to: toDate
    })
    if (queryError) {
      setError(queryError.message || "No se pudieron cargar las marcaciones.")
      setRows([])
    } else {
      setRows(data || [])
    }
    setLoading(false)
  }, [canView, fromDate, statusFilter, toDate])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  const pendingCount = useMemo(
    () => rows.filter((row) => row.approval_status === "pending").length,
    [rows]
  )

  async function handleReview(row, action) {
    if (!canApprove) return
    setBusyId(row.id)
    setMessage("")
    setError("")
    const { error: reviewError } = await reviewAttendanceMark({
      markId: row.id,
      action,
      notes: notesById[row.id] || ""
    })
    if (reviewError) {
      setError(reviewError.message || "No se pudo actualizar la marcación.")
    } else {
      setMessage(action === "approve" ? "Marcación aprobada." : "Marcación rechazada.")
      await loadRows()
    }
    setBusyId("")
  }

  if (!canView) {
    return (
      <section className="attendance-pending-reviews">
        <p className="attendance-pending-empty">No tienes permiso para ver esta sección.</p>
      </section>
    )
  }

  return (
    <section className="attendance-pending-reviews">
      <header className="attendance-pending-head">
        <div>
          <h2>Marcaciones extraordinarias</h2>
          <p>Revisa entradas fuera de horario, sin horario, en descanso o con excepción.</p>
        </div>
        <div className="attendance-pending-kpis">
          <span>{pendingCount} pendiente{pendingCount === 1 ? "" : "s"}</span>
        </div>
      </header>

      {message && <div className="attendance-pending-success">{message}</div>}
      {error && <div className="attendance-pending-error">{error}</div>}

      <div className="attendance-pending-filters">
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Desde
          <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
        </label>
        <label>
          Hasta
          <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
        </label>
        <button type="button" className="attendance-pending-refresh" onClick={loadRows} disabled={loading}>
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {loading ? (
        <p className="attendance-pending-empty">Cargando marcaciones...</p>
      ) : rows.length === 0 ? (
        <p className="attendance-pending-empty">No hay marcaciones para el filtro seleccionado.</p>
      ) : (
        <div className="attendance-pending-table-wrap">
          <table className="attendance-pending-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Fecha</th>
                <th>Hora</th>
                <th>Tipo</th>
                <th>Clasificación</th>
                <th>Motivo</th>
                <th>Estado</th>
                <th>Revisión</th>
                {canApprove && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.employee_name}</td>
                  <td>{row.labor_date || "-"}</td>
                  <td>{new Date(row.marked_at).toLocaleString("es-GT")}</td>
                  <td>{getAttendanceMarkLabel(row.mark_type)}</td>
                  <td>
                    <span className={`attendance-pending-badge classification-${row.classification || "normal"}`}>
                      {ATTENDANCE_CLASSIFICATION_LABELS[row.classification] || row.classification || "-"}
                    </span>
                  </td>
                  <td>{row.system_reason || row.observation || "-"}</td>
                  <td>
                    <span className={`attendance-pending-badge approval-${row.approval_status || "pending"}`}>
                      {ATTENDANCE_APPROVAL_LABELS[row.approval_status] || row.approval_status}
                    </span>
                  </td>
                  <td>
                    {row.approver_name
                      ? `${row.approver_name}${row.approved_at ? ` · ${new Date(row.approved_at).toLocaleString("es-GT")}` : ""}`
                      : "-"}
                    {row.approval_notes ? <small>{row.approval_notes}</small> : null}
                  </td>
                  {canApprove && (
                    <td className="attendance-pending-actions">
                      {row.approval_status === "pending" ? (
                        <>
                          <input
                            type="text"
                            placeholder="Nota opcional"
                            value={notesById[row.id] || ""}
                            onChange={(event) => setNotesById((current) => ({
                              ...current,
                              [row.id]: event.target.value
                            }))}
                          />
                          <button
                            type="button"
                            className="approve"
                            disabled={busyId === row.id}
                            onClick={() => handleReview(row, "approve")}
                          >
                            Aprobar
                          </button>
                          <button
                            type="button"
                            className="reject"
                            disabled={busyId === row.id}
                            onClick={() => handleReview(row, "reject")}
                          >
                            Rechazar
                          </button>
                        </>
                      ) : (
                        <span className="attendance-pending-done">Revisada</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function defaultFromDate() {
  const date = new Date()
  date.setDate(date.getDate() - 14)
  return date.toLocaleDateString("en-CA", { timeZone: "America/Guatemala" })
}

function defaultToDate() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Guatemala" })
}

export default AttendancePendingReviews
