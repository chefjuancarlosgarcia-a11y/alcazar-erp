import { useEffect, useRef, useState } from "react"
import {
  closeIncident,
  getDisciplineDetail,
  getSignedDocumentUrl,
  saveDisciplinaryAction,
  saveIncident,
  uploadDisciplinaryDocument,
  uploadIncidentEvidence
} from "./expedientesService"
import {
  DISCIPLINARY_ACTION_STATUSES,
  DISCIPLINARY_ACTION_TYPES,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  actionTypeClass,
  formatDate,
  incidentStatusClass
} from "./expedientesUtils"

const EMPTY_INCIDENT = {
  title: "",
  description: "",
  category: "conduct",
  severity: "medium",
  incident_date: new Date().toISOString().slice(0, 10),
  location: ""
}

const EMPTY_ACTION = {
  action_type: "verbal_warning",
  title: "",
  description: "",
  effective_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  duration_days: "",
  incident_id: ""
}

function DisciplineKpi({ label, value, tone = "" }) {
  return (
    <article className={`expediente-discipline-kpi ${tone ? `expediente-discipline-kpi--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </article>
  )
}

export default function DisciplineTab({ profileId, canWrite, initialKpis = null }) {
  const evidenceInputRef = useRef(null)
  const docInputRef = useRef(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showIncidentForm, setShowIncidentForm] = useState(false)
  const [showActionForm, setShowActionForm] = useState(false)
  const [incidentForm, setIncidentForm] = useState(EMPTY_INCIDENT)
  const [actionForm, setActionForm] = useState(EMPTY_ACTION)
  const [pendingDoc, setPendingDoc] = useState(null)
  const [evidenceTargetId, setEvidenceTargetId] = useState("")
  const [closureDraft, setClosureDraft] = useState({})

  useEffect(() => {
    loadData()
  }, [profileId])

  async function loadData() {
    if (!profileId) return
    setLoading(true)
    setError("")
    const result = await getDisciplineDetail(profileId)
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setData(null)
      return
    }
    setData(result.data)
  }

  const kpis = data?.kpis || initialKpis || {}
  const writeEnabled = canWrite && data?.can_write !== false

  async function handleSaveIncident(event) {
    event.preventDefault()
    if (!writeEnabled) return
    setSaving(true)
    setError("")
    setMessage("")
    const result = await saveIncident(profileId, incidentForm)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setShowIncidentForm(false)
    setIncidentForm(EMPTY_INCIDENT)
    setMessage("Incidente registrado.")
    loadData()
  }

  async function handleCloseIncident(incidentId) {
    if (!writeEnabled) return
    const summary = closureDraft[incidentId] || ""
    const confirmed = window.confirm("¿Cerrar este incidente? Las acciones disciplinarias permaneceran en el expediente.")
    if (!confirmed) return
    setSaving(true)
    setError("")
    const result = await closeIncident(incidentId, summary)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setMessage("Incidente cerrado.")
    loadData()
  }

  async function handleSaveAction(event) {
    event.preventDefault()
    if (!writeEnabled) return
    setSaving(true)
    setError("")
    setMessage("")

    let payload = {
      ...actionForm,
      incident_id: actionForm.incident_id || null,
      duration_days: actionForm.duration_days ? Number(actionForm.duration_days) : null,
      end_date: actionForm.end_date || null
    }

    if (pendingDoc) {
      const upload = await uploadDisciplinaryDocument({ profileId, file: pendingDoc })
      if (upload.error) {
        setSaving(false)
        setError(upload.error)
        return
      }
      payload = {
        ...payload,
        document_storage_path: upload.data.storagePath,
        document_file_name: upload.data.fileName
      }
    }

    const result = await saveDisciplinaryAction(profileId, payload)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setShowActionForm(false)
    setActionForm(EMPTY_ACTION)
    setPendingDoc(null)
    if (docInputRef.current) docInputRef.current.value = ""
    setMessage("Accion disciplinaria registrada en el expediente.")
    loadData()
  }

  async function handleEvidencePick(event) {
    const file = event.target.files?.[0]
    if (!file || !evidenceTargetId) return
    setSaving(true)
    setError("")
    const result = await uploadIncidentEvidence({
      profileId,
      incidentId: evidenceTargetId,
      file
    })
    setSaving(false)
    if (evidenceInputRef.current) evidenceInputRef.current.value = ""
    setEvidenceTargetId("")
    if (result.error) {
      setError(result.error)
      return
    }
    setMessage("Evidencia cargada.")
    loadData()
  }

  async function handleOpenFile(storagePath) {
    if (!storagePath) return
    const result = await getSignedDocumentUrl(storagePath)
    if (result.error) {
      setError(result.error)
      return
    }
    window.open(result.data, "_blank", "noopener,noreferrer")
  }

  if (loading) {
    return <section className="expediente-section"><p className="expediente-empty">Cargando disciplina e incidentes...</p></section>
  }

  return (
    <section className="expediente-section expediente-discipline">
      <header className="expediente-discipline__head">
        <div>
          <h3>Disciplina e Incidentes</h3>
          <p className="expediente-discipline__hint">
            Registro permanente de incidentes y acciones disciplinarias vinculadas al expediente.
          </p>
        </div>
        {writeEnabled ? (
          <div className="expediente-discipline__head-actions">
            <button type="button" className="expediente-btn expediente-btn--secondary" onClick={() => setShowIncidentForm((v) => !v)}>
              {showIncidentForm ? "Cancelar incidente" : "Nuevo incidente"}
            </button>
            <button type="button" className="expediente-btn expediente-btn--primary" onClick={() => setShowActionForm((v) => !v)}>
              {showActionForm ? "Cancelar accion" : "Nueva accion disciplinaria"}
            </button>
          </div>
        ) : null}
      </header>

      <div className="expediente-discipline-kpi-grid">
        <DisciplineKpi label="Llamadas de atencion" value={kpis.verbal_warnings} tone="yellow" />
        <DisciplineKpi label="Memorandums" value={kpis.memorandums} tone="orange" />
        <DisciplineKpi label="Suspensiones" value={kpis.suspensions} tone="red" />
        <DisciplineKpi label="Reincidencias" value={kpis.recurrences} tone="orange" />
        <DisciplineKpi label="Incidentes abiertos" value={kpis.open_incidents} tone="red" />
      </div>

      {showIncidentForm && writeEnabled ? (
        <form className="expediente-discipline-form" onSubmit={handleSaveIncident}>
          <h4>Registrar incidente</h4>
          <div className="expediente-form-grid">
            <label>Titulo<input required value={incidentForm.title} onChange={(e) => setIncidentForm((c) => ({ ...c, title: e.target.value }))} /></label>
            <label>
              Categoria
              <select value={incidentForm.category} onChange={(e) => setIncidentForm((c) => ({ ...c, category: e.target.value }))}>
                {Object.entries(INCIDENT_CATEGORIES).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
            <label>
              Severidad
              <select value={incidentForm.severity} onChange={(e) => setIncidentForm((c) => ({ ...c, severity: e.target.value }))}>
                {Object.entries(INCIDENT_SEVERITIES).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </label>
            <label>Fecha<input type="date" required value={incidentForm.incident_date} onChange={(e) => setIncidentForm((c) => ({ ...c, incident_date: e.target.value }))} /></label>
            <label className="expediente-span-2">Lugar<input value={incidentForm.location} onChange={(e) => setIncidentForm((c) => ({ ...c, location: e.target.value }))} /></label>
            <label className="expediente-span-2">
              Descripcion
              <textarea rows={3} value={incidentForm.description} onChange={(e) => setIncidentForm((c) => ({ ...c, description: e.target.value }))} />
            </label>
          </div>
          <div className="expediente-doc-card__actions">
            <button type="submit" className="expediente-btn expediente-btn--primary" disabled={saving}>Guardar incidente</button>
          </div>
        </form>
      ) : null}

      {showActionForm && writeEnabled ? (
        <form className="expediente-discipline-form" onSubmit={handleSaveAction}>
          <h4>Registrar accion disciplinaria</h4>
          <p className="expediente-discipline__hint">Esta accion quedara registrada permanentemente en el expediente.</p>
          <div className="expediente-form-grid">
            <label>
              Tipo
              <select value={actionForm.action_type} onChange={(e) => setActionForm((c) => ({ ...c, action_type: e.target.value }))}>
                {Object.entries(DISCIPLINARY_ACTION_TYPES).map(([value, meta]) => (
                  <option key={value} value={value}>{meta.label}</option>
                ))}
              </select>
            </label>
            <label>
              Incidente vinculado
              <select value={actionForm.incident_id} onChange={(e) => setActionForm((c) => ({ ...c, incident_id: e.target.value }))}>
                <option value="">Sin incidente / registro directo</option>
                {(data?.incidents || []).map((row) => (
                  <option key={row.incident.id} value={row.incident.id}>
                    {row.incident.reference_code || row.incident.title} · {INCIDENT_STATUSES[row.incident.status]?.label}
                  </option>
                ))}
              </select>
            </label>
            <label>Titulo<input required value={actionForm.title} onChange={(e) => setActionForm((c) => ({ ...c, title: e.target.value }))} /></label>
            <label>Fecha efectiva<input type="date" required value={actionForm.effective_date} onChange={(e) => setActionForm((c) => ({ ...c, effective_date: e.target.value }))} /></label>
            {actionForm.action_type === "suspension" ? (
              <>
                <label>Dias<input type="number" min="1" value={actionForm.duration_days} onChange={(e) => setActionForm((c) => ({ ...c, duration_days: e.target.value }))} /></label>
                <label>Fecha fin<input type="date" value={actionForm.end_date} onChange={(e) => setActionForm((c) => ({ ...c, end_date: e.target.value }))} /></label>
              </>
            ) : null}
            <label className="expediente-span-2">
              Descripcion
              <textarea rows={3} value={actionForm.description} onChange={(e) => setActionForm((c) => ({ ...c, description: e.target.value }))} />
            </label>
          </div>
          <div className="expediente-file-picker">
            <input ref={docInputRef} type="file" accept=".pdf,image/*" className="expediente-file-picker__input" onChange={(e) => setPendingDoc(e.target.files?.[0] || null)} />
            <button type="button" className="expediente-btn expediente-btn--secondary" onClick={() => docInputRef.current?.click()}>
              {pendingDoc ? "Cambiar documento" : "Adjuntar memorandum / documento"}
            </button>
            <span className="expediente-file-picker__name">{pendingDoc?.name || "Opcional"}</span>
          </div>
          <div className="expediente-doc-card__actions">
            <button type="submit" className="expediente-btn expediente-btn--primary" disabled={saving}>Guardar accion</button>
          </div>
        </form>
      ) : null}

      <input
        ref={evidenceInputRef}
        type="file"
        accept=".pdf,image/*"
        className="expediente-file-picker__input"
        onChange={handleEvidencePick}
      />

      <section className="expediente-discipline-block">
        <h4>Acciones disciplinarias permanentes</h4>
        {(data?.disciplinary_actions || []).length ? (
          <div className="expediente-discipline-list">
            {data.disciplinary_actions.map((row) => {
              const action = row.action
              const typeMeta = DISCIPLINARY_ACTION_TYPES[action.action_type] || DISCIPLINARY_ACTION_TYPES.other
              const statusMeta = DISCIPLINARY_ACTION_STATUSES[action.status] || DISCIPLINARY_ACTION_STATUSES.active
              return (
                <article key={action.id} className="expediente-discipline-card expediente-discipline-card--permanent">
                  <header>
                    <div>
                      <strong>{action.title}</strong>
                      <small>
                        {typeMeta.label} · {formatDate(action.effective_date)}
                        {action.end_date ? ` → ${formatDate(action.end_date)}` : ""}
                      </small>
                    </div>
                    <span className={actionTypeClass(action.action_type)}>{typeMeta.label}</span>
                  </header>
                  {action.description ? <p>{action.description}</p> : null}
                  <dl className="expediente-doc-card__meta">
                    <div><dt>Estado accion</dt><dd>{statusMeta.label}</dd></div>
                    {row.incident_title ? (
                      <div>
                        <dt>Incidente vinculado</dt>
                        <dd>
                          {row.incident_reference ? `${row.incident_reference} · ` : ""}
                          {row.incident_title}
                          {row.incident_status === "closed" ? " (cerrado)" : ""}
                        </dd>
                      </div>
                    ) : null}
                    {row.issued_by_name ? <div><dt>Registrado por</dt><dd>{row.issued_by_name}</dd></div> : null}
                  </dl>
                  {action.document_storage_path ? (
                    <button type="button" className="expediente-btn expediente-btn--secondary" onClick={() => handleOpenFile(action.document_storage_path)}>
                      Ver documento
                    </button>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="expediente-empty">Sin acciones disciplinarias registradas.</p>
        )}
      </section>

      <section className="expediente-discipline-block">
        <h4>Incidentes</h4>
        {(data?.incidents || []).length ? (
          <div className="expediente-discipline-list">
            {data.incidents.map((row) => {
              const incident = row.incident
              const statusMeta = INCIDENT_STATUSES[incident.status] || INCIDENT_STATUSES.open
              const isClosed = incident.status === "closed"
              return (
                <article key={incident.id} className={`expediente-discipline-card ${isClosed ? "expediente-discipline-card--closed" : ""}`}>
                  <header>
                    <div>
                      <strong>{incident.title}</strong>
                      <small>
                        {incident.reference_code ? `${incident.reference_code} · ` : ""}
                        {INCIDENT_CATEGORIES[incident.category] || incident.category} · {formatDate(incident.incident_date)}
                      </small>
                    </div>
                    <div className="expediente-discipline-card__badges">
                      {incident.is_recurrence ? <span className="expediente-doc-badge expediente-doc-badge--orange">Reincidencia</span> : null}
                      <span className={incidentStatusClass(incident.status)}>{statusMeta.label}</span>
                    </div>
                  </header>
                  {incident.description ? <p>{incident.description}</p> : null}
                  {row.parent_title ? <p className="expediente-discipline__related">Incidente previo: {row.parent_title}</p> : null}
                  {isClosed && incident.closure_summary ? (
                    <p className="expediente-discipline__closure"><strong>Cierre:</strong> {incident.closure_summary}</p>
                  ) : null}

                  {(row.actions || []).length ? (
                    <div className="expediente-discipline-nested">
                      <span>Acciones del incidente</span>
                      <ul>
                        {row.actions.map((actionRow) => (
                          <li key={actionRow.action.id}>
                            {DISCIPLINARY_ACTION_TYPES[actionRow.action.action_type]?.label}: {actionRow.action.title}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {(row.evidence || []).length ? (
                    <div className="expediente-discipline-nested">
                      <span>Evidencia</span>
                      <ul>
                        {row.evidence.map((item) => (
                          <li key={item.id}>
                            <button type="button" className="expediente-link-btn" onClick={() => handleOpenFile(item.storage_path)}>
                              {item.file_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {!isClosed && writeEnabled ? (
                    <div className="expediente-discipline-close">
                      <label>
                        Resumen de cierre
                        <input
                          value={closureDraft[incident.id] || ""}
                          onChange={(e) => setClosureDraft((c) => ({ ...c, [incident.id]: e.target.value }))}
                          placeholder="Opcional"
                        />
                      </label>
                      <div className="expediente-doc-card__actions">
                        <button
                          type="button"
                          className="expediente-btn expediente-btn--secondary"
                          disabled={saving}
                          onClick={() => { setEvidenceTargetId(incident.id); evidenceInputRef.current?.click() }}
                        >
                          Subir evidencia
                        </button>
                        <button type="button" className="expediente-btn expediente-btn--ghost" disabled={saving} onClick={() => handleCloseIncident(incident.id)}>
                          Cerrar incidente
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="expediente-empty">Sin incidentes registrados.</p>
        )}
      </section>

      {message ? <p className="expediente-message success">{message}</p> : null}
      {error ? <p className="expediente-message error">{error}</p> : null}
    </section>
  )
}
