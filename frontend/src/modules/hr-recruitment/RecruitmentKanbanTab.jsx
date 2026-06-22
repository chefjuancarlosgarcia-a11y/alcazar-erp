import { useMemo, useState } from "react"
import {
  updateRecruitmentCandidatePipeline,
  upsertRecruitmentCandidate
} from "./recruitmentService"
import {
  CANDIDATE_SOURCES,
  emptyCandidateForm,
  labelFor,
  PIPELINE_COLUMNS
} from "./recruitmentUtils"
import CandidateDetailPanel from "./CandidateDetailPanel"

function Field({ label, className = "", children }) {
  return (
    <label className={`recruitment-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export default function RecruitmentKanbanTab({
  vacancies = [],
  candidates = [],
  profiles = [],
  loading = false,
  onRefresh,
  onMessage
}) {
  const [filters, setFilters] = useState({ vacancyId: "", source: "", area: "", search: "" })
  const [selectedId, setSelectedId] = useState("")
  const [modalOpen, setModalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyCandidateForm())

  const filtered = useMemo(() => candidates.filter((row) => {
    const search = filters.search.trim().toLowerCase()
    return (
      (!filters.vacancyId || row.vacancy_id === filters.vacancyId)
      && (!filters.source || row.source === filters.source)
      && (!filters.area || String(row.vacancy_area || "").toLowerCase().includes(filters.area.toLowerCase()))
      && (!search || String(row.full_name || "").toLowerCase().includes(search))
    )
  }), [candidates, filters])

  const grouped = useMemo(() => {
    const map = Object.fromEntries(PIPELINE_COLUMNS.map((column) => [column.value, []]))
    filtered.forEach((row) => {
      if (map[row.pipeline_status]) map[row.pipeline_status].push(row)
    })
    return map
  }, [filtered])

  function openCreate() {
    setForm(emptyCandidateForm(filters.vacancyId || vacancies[0]?.id || ""))
    setModalOpen(true)
  }

  async function moveCandidate(candidateId, pipelineStatus) {
    const result = await updateRecruitmentCandidatePipeline(candidateId, pipelineStatus)
    if (result.error) onMessage?.(result.error, "error")
    else onRefresh?.()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.full_name?.trim() || !form.vacancy_id) {
      onMessage?.("Nombre y vacante son obligatorios.", "error")
      return
    }
    setSaving(true)
    const result = await upsertRecruitmentCandidate({
      ...form,
      age: form.age ? Number(form.age) : null
    })
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Candidato registrado.", "success")
      setModalOpen(false)
      onRefresh?.()
    }
  }

  return (
    <>
      <article className="recruitment-panel">
        <div className="recruitment-panel__head">
          <div>
            <h2>Pipeline de candidatos</h2>
            <p className="tasks-muted">Kanban por etapa del proceso de contratación.</p>
          </div>
          <button type="button" className="tasks-primary" onClick={openCreate}>+ Nuevo candidato</button>
        </div>

        <div className="recruitment-filters">
          <input placeholder="Buscar candidato" value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value })} />
          <select value={filters.vacancyId} onChange={(e) => setFilters({ ...filters, vacancyId: e.target.value })}>
            <option value="">Todas las vacantes</option>
            {vacancies.map((vacancy) => (
              <option key={vacancy.id} value={vacancy.id}>{vacancy.position_title}</option>
            ))}
          </select>
          <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
            <option value="">Todas las fuentes</option>
            {CANDIDATE_SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input placeholder="Filtrar área" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })} />
        </div>

        {loading ? <p className="tasks-muted">Cargando candidatos...</p> : null}

        <div className="recruitment-kanban">
          {PIPELINE_COLUMNS.map((column) => (
            <section key={column.value} className="recruitment-kanban-column">
              <header className="recruitment-kanban-column__head">
                <strong>{column.label}</strong>
                <span>{grouped[column.value]?.length || 0}</span>
              </header>
              {(grouped[column.value] || []).map((row) => (
                <article key={row.id} className="recruitment-candidate-card" onClick={() => setSelectedId(row.id)}>
                  <strong>{row.full_name}</strong>
                  <span>{row.vacancy_title || "Sin vacante"}</span>
                  <small>{labelFor(CANDIDATE_SOURCES, row.source)} · {row.applied_at}</small>
                  <div className="recruitment-candidate-card__actions" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={row.pipeline_status}
                      onChange={(e) => moveCandidate(row.id, e.target.value)}
                    >
                      {PIPELINE_COLUMNS.map((item) => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </section>
          ))}
        </div>
      </article>

      {selectedId ? (
        <CandidateDetailPanel
          candidateId={selectedId}
          profiles={profiles}
          onClose={() => setSelectedId("")}
          onChanged={onRefresh}
          onMessage={onMessage}
        />
      ) : null}

      {modalOpen ? (
        <div className="recruitment-modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <form className="recruitment-modal" onSubmit={handleSubmit} onClick={(e) => e.stopPropagation()}>
            <div>
              <h2>Nuevo candidato</h2>
              <p className="tasks-muted">Registra la aplicación y asígnala a una vacante.</p>
            </div>
            <div className="recruitment-form-grid">
              <Field label="Nombre completo" className="recruitment-field--full">
                <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </Field>
              <Field label="Vacante">
                <select value={form.vacancy_id} onChange={(e) => setForm({ ...form, vacancy_id: e.target.value })} required>
                  <option value="">Seleccionar...</option>
                  {vacancies.map((vacancy) => (
                    <option key={vacancy.id} value={vacancy.id}>{vacancy.position_title}</option>
                  ))}
                </select>
              </Field>
              <Field label="Puesto aplicado"><input value={form.position_applied} onChange={(e) => setForm({ ...form, position_applied: e.target.value })} /></Field>
              <Field label="Teléfono"><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field label="WhatsApp"><input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></Field>
              <Field label="Fuente">
                <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  {CANDIDATE_SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Fecha de aplicación"><input type="date" value={form.applied_at} onChange={(e) => setForm({ ...form, applied_at: e.target.value })} /></Field>
              <Field label="Expectativa salarial"><input value={form.salary_expectation} onChange={(e) => setForm({ ...form, salary_expectation: e.target.value })} /></Field>
              <Field label="Disponibilidad" className="recruitment-field--full">
                <input value={form.schedule_availability} onChange={(e) => setForm({ ...form, schedule_availability: e.target.value })} />
              </Field>
              <Field label="Experiencia previa" className="recruitment-field--full">
                <textarea value={form.prior_experience} onChange={(e) => setForm({ ...form, prior_experience: e.target.value })} />
              </Field>
              <Field label="Observaciones" className="recruitment-field--full">
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
            <div className="recruitment-modal__actions">
              <button type="button" className="tasks-secondary" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button type="submit" className="tasks-primary" disabled={saving}>{saving ? "Guardando..." : "Registrar candidato"}</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  )
}
