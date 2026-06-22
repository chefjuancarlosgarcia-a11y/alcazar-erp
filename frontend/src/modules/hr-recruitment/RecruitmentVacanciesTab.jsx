import { useMemo, useState } from "react"
import { upsertRecruitmentVacancy } from "./recruitmentService"
import {
  emptyVacancyForm,
  labelFor,
  priorityTone,
  statusTone,
  VACANCY_PRIORITIES,
  VACANCY_REASONS,
  VACANCY_STATUSES
} from "./recruitmentUtils"

function Field({ label, className = "", children }) {
  return (
    <label className={`recruitment-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export default function RecruitmentVacanciesTab({
  vacancies = [],
  profiles = [],
  canManage = false,
  currentUserId = "",
  loading = false,
  onRefresh,
  onMessage
}) {
  const [filters, setFilters] = useState({ status: "", area: "", priority: "" })
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyVacancyForm(currentUserId))

  const filtered = useMemo(() => vacancies.filter((row) => (
    (!filters.status || row.status === filters.status)
    && (!filters.area || String(row.area || "").toLowerCase().includes(filters.area.toLowerCase()))
    && (!filters.priority || row.priority === filters.priority)
  )), [vacancies, filters])

  function openCreate() {
    setForm(emptyVacancyForm(currentUserId))
    setModalOpen(true)
  }

  function openEdit(row) {
    setForm({
      id: row.id,
      position_title: row.position_title || "",
      area: row.area || "",
      quantity_required: row.quantity_required || 1,
      requested_by: row.requested_by || currentUserId,
      request_date: row.request_date || "",
      target_date: row.target_date || "",
      priority: row.priority || "medium",
      reason: row.reason || "replacement",
      status: row.status || "open",
      notes: row.notes || ""
    })
    setModalOpen(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.position_title?.trim()) {
      onMessage?.("El puesto es obligatorio.", "error")
      return
    }
    setSaving(true)
    const result = await upsertRecruitmentVacancy({
      ...form,
      quantity_required: Number(form.quantity_required) || 1
    })
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Vacante guardada.", "success")
      setModalOpen(false)
      onRefresh?.()
    }
  }

  return (
    <>
      <article className="recruitment-panel">
        <div className="recruitment-panel__head">
          <div>
            <h2>Solicitudes de personal</h2>
            <p className="tasks-muted">Vacantes abiertas y su avance de cobertura.</p>
          </div>
          <button type="button" className="tasks-primary" onClick={openCreate}>+ Nueva solicitud</button>
        </div>

        <div className="recruitment-filters">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Todos los estados</option>
            {VACANCY_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input placeholder="Filtrar área" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })} />
          <select value={filters.priority} onChange={(e) => setFilters({ ...filters, priority: e.target.value })}>
            <option value="">Todas las prioridades</option>
            {VACANCY_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </div>

        {loading ? <p className="tasks-muted">Cargando vacantes...</p> : null}
        {!loading && !filtered.length ? <p className="tasks-empty">No hay vacantes con los filtros actuales.</p> : null}

        <div className="recruitment-table-wrap">
          <table className="recruitment-table">
            <thead>
              <tr>
                <th>Puesto</th>
                <th>Área</th>
                <th>Requeridas</th>
                <th>Cubiertas</th>
                <th>Pendientes</th>
                <th>Fecha meta</th>
                <th>Días abierta</th>
                <th>Estado</th>
                <th>Prioridad</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.position_title}</strong></td>
                  <td>{row.area || "—"}</td>
                  <td>{row.quantity_required}</td>
                  <td>{row.quantity_filled}</td>
                  <td>{row.pending}</td>
                  <td>{row.target_date || "—"}</td>
                  <td>{row.days_open}</td>
                  <td><span className={`recruitment-badge recruitment-badge--${statusTone(row.status)}`}>{labelFor(VACANCY_STATUSES, row.status)}</span></td>
                  <td><span className={`recruitment-badge recruitment-badge--${priorityTone(row.priority)}`}>{labelFor(VACANCY_PRIORITIES, row.priority)}</span></td>
                  <td><button type="button" className="tasks-link" onClick={() => openEdit(row)}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      {modalOpen ? (
        <div className="recruitment-modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <form className="recruitment-modal" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
            <div>
              <h2>{form.id ? "Editar solicitud" : "Nueva solicitud de personal"}</h2>
              <p className="tasks-muted">Define el puesto, prioridad y meta de cobertura.</p>
            </div>
            <div className="recruitment-form-grid">
              <Field label="Puesto" className="recruitment-field--full">
                <input value={form.position_title} onChange={(e) => setForm({ ...form, position_title: e.target.value })} required />
              </Field>
              <Field label="Área"><input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} /></Field>
              <Field label="Cantidad requerida">
                <input type="number" min="1" value={form.quantity_required} onChange={(e) => setForm({ ...form, quantity_required: e.target.value })} />
              </Field>
              <Field label="Solicitado por">
                <select value={form.requested_by} onChange={(e) => setForm({ ...form, requested_by: e.target.value })} disabled={!canManage}>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
                  ))}
                </select>
              </Field>
              <Field label="Fecha de solicitud"><input type="date" value={form.request_date} onChange={(e) => setForm({ ...form, request_date: e.target.value })} /></Field>
              <Field label="Fecha meta"><input type="date" value={form.target_date} onChange={(e) => setForm({ ...form, target_date: e.target.value })} /></Field>
              <Field label="Prioridad">
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {VACANCY_PRIORITIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Motivo">
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                  {VACANCY_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              {canManage ? (
                <Field label="Estado">
                  <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {VACANCY_STATUSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label="Observaciones" className="recruitment-field--full">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div className="recruitment-modal__actions">
              <button type="button" className="tasks-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="tasks-primary" disabled={saving}>{saving ? "Guardando..." : "Guardar solicitud"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
