import { useCallback, useEffect, useState } from "react"
import {
  listRecruitmentRetentionCases,
  recordRecruitmentRetentionReview
} from "./recruitmentService"
import {
  CANDIDATE_SOURCES,
  labelFor,
  RETENTION_STATUS_OPTIONS
} from "./recruitmentUtils"

function Field({ label, children }) {
  return (
    <label className="recruitment-field">
      <span>{label}</span>
      {children}
    </label>
  )
}

function reviewLabel(day) {
  return `${day} días`
}

function daysSinceHire(hireDate) {
  if (!hireDate) return null
  const start = new Date(hireDate)
  const now = new Date()
  return Math.floor((now - start) / (1000 * 60 * 60 * 24))
}

export default function RecruitmentRetentionTab({ onMessage }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)

  const loadRows = useCallback(async () => {
    setLoading(true)
    const result = await listRecruitmentRetentionCases()
    if (result.error) onMessage?.(result.error, "error")
    else setRows(result.data)
    setLoading(false)
  }, [onMessage])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  function openEdit(row, reviewDay) {
    const existing = (row.reviews || []).find((item) => item.review_day === reviewDay) || {}
    setEditing({
      candidate_id: row.candidate_id,
      review_day: reviewDay,
      full_name: row.full_name,
      active_status: existing.active_status || "pending",
      evaluation_notes: existing.evaluation_notes || "",
      exit_reason: existing.exit_reason || ""
    })
  }

  async function submitReview(event) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    const result = await recordRecruitmentRetentionReview(
      editing.candidate_id,
      editing.review_day,
      editing.active_status,
      editing.evaluation_notes,
      editing.exit_reason
    )
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.(`Evaluación de ${reviewLabel(editing.review_day)} guardada.`, "success")
      setEditing(null)
      loadRows()
    }
  }

  return (
    <>
      <article className="recruitment-panel">
        <div className="recruitment-panel__head">
          <div>
            <h2>Retención 30 / 60 / 90 días</h2>
            <p className="tasks-muted">Seguimiento post-contratación de colaboradores convertidos desde reclutamiento.</p>
          </div>
          <button type="button" className="tasks-secondary" onClick={loadRows}>Actualizar</button>
        </div>

        {loading ? <p className="tasks-muted">Cargando casos...</p> : null}

        <div className="recruitment-table-wrap">
          <table className="recruitment-table">
            <thead>
              <tr>
                <th>Colaborador</th>
                <th>Puesto</th>
                <th>Área</th>
                <th>Ingreso</th>
                <th>Fuente</th>
                <th>30 días</th>
                <th>60 días</th>
                <th>90 días</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const reviews = Object.fromEntries((row.reviews || []).map((item) => [item.review_day, item]))
                const elapsed = daysSinceHire(row.hire_date)
                return (
                  <tr key={row.candidate_id}>
                    <td>{row.full_name}</td>
                    <td>{row.position || "—"}</td>
                    <td>{row.area || "—"}</td>
                    <td>
                      {row.hire_date || "—"}
                      {elapsed != null ? <small className="tasks-muted"> ({elapsed} d)</small> : null}
                    </td>
                    <td>{labelFor(CANDIDATE_SOURCES, row.source)}</td>
                    {[30, 60, 90].map((day) => {
                      const review = reviews[day]
                      const status = review?.active_status || "pending"
                      return (
                        <td key={day}>
                          <span className={`recruitment-badge recruitment-badge--${status === "yes" ? "success" : status === "no" ? "muted" : "warning"}`}>
                            {labelFor(RETENTION_STATUS_OPTIONS, status)}
                          </span>
                        </td>
                      )
                    })}
                    <td>
                      <div className="recruitment-candidate-card__actions">
                        {[30, 60, 90].map((day) => (
                          <button key={day} type="button" className="tasks-link" onClick={() => openEdit(row, day)}>
                            {day}d
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {!loading && !rows.length ? (
          <p className="tasks-muted">Aún no hay colaboradores convertidos para seguimiento.</p>
        ) : null}
      </article>

      {editing ? (
        <div className="recruitment-modal-backdrop" role="presentation" onClick={() => setEditing(null)}>
          <form className="recruitment-modal" onSubmit={submitReview} onClick={(e) => e.stopPropagation()}>
            <div>
              <h2>Evaluación {reviewLabel(editing.review_day)}</h2>
              <p className="tasks-muted">{editing.full_name}</p>
            </div>
            <Field label="¿Sigue activo?">
              <select
                value={editing.active_status}
                onChange={(e) => setEditing({ ...editing, active_status: e.target.value })}
              >
                {RETENTION_STATUS_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Evaluación / observaciones">
              <textarea
                value={editing.evaluation_notes}
                onChange={(e) => setEditing({ ...editing, evaluation_notes: e.target.value })}
              />
            </Field>
            {editing.active_status === "no" ? (
              <Field label="Motivo de salida">
                <textarea
                  value={editing.exit_reason}
                  onChange={(e) => setEditing({ ...editing, exit_reason: e.target.value })}
                />
              </Field>
            ) : null}
            <div className="recruitment-modal__actions">
              <button type="button" className="tasks-secondary" onClick={() => setEditing(null)}>Cancelar</button>
              <button type="submit" className="tasks-primary" disabled={saving}>
                {saving ? "Guardando..." : "Guardar evaluación"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
