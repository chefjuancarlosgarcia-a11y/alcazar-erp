import { useEffect, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import ConvertCandidateModal from "./ConvertCandidateModal"
import {
  discardRecruitmentCandidate,
  getRecruitmentCandidateDetail,
  registerRecruitmentContact,
  saveRecruitmentInterviewEvaluation,
  scheduleRecruitmentInterview,
  updateRecruitmentInterviewResult,
  upsertRecruitmentCandidate
} from "./recruitmentService"
import {
  CANDIDATE_SOURCES,
  CONTACT_RESULTS,
  CONTACT_TYPES,
  DISCARD_REASONS,
  EVAL_RECOMMENDATIONS,
  INTERVIEW_RESULTS,
  labelFor,
  ONBOARDING_STATUSES,
  onboardingStatusTone,
  PIPELINE_COLUMNS,
  VACANCY_PRIORITIES,
  canViewRecruitmentIntegrationDebug
} from "./recruitmentUtils"
import {
  buildIntegrationDebugPayload,
  buildWebsiteApplicationRows,
  hasWebsiteApplicationData
} from "./websiteApplicationDisplay"

function Field({ label, className = "", children }) {
  return (
    <label className={`recruitment-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

export default function CandidateDetailPanel({
  candidateId,
  profiles = [],
  onClose,
  onChanged,
  onMessage
}) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [panel, setPanel] = useState("profile")

  const [contactForm, setContactForm] = useState({
    contacted_at: new Date().toISOString().slice(0, 16),
    contact_type: "call",
    result: "no_answer",
    notes: ""
  })
  const [interviewForm, setInterviewForm] = useState({
    scheduled_date: new Date().toISOString().slice(0, 10),
    scheduled_time: "10:00",
    responsible_profile_id: "",
    location_modality: "",
    notes: ""
  })
  const [evalForm, setEvalForm] = useState({
    interview_id: "",
    presentation_score: 3,
    communication_score: 3,
    experience_score: 3,
    attitude_score: 3,
    availability_score: 3,
    comments: "",
    recommendation: "second_interview"
  })
  const [discardForm, setDiscardForm] = useState({ reason: "profile_mismatch", notes: "" })
  const [convertOpen, setConvertOpen] = useState(false)
  const { user } = useAuth()
  const canViewIntegrationDebug = canViewRecruitmentIntegrationDebug(user?.role)

  async function loadDetail() {
    setLoading(true)
    const result = await getRecruitmentCandidateDetail(candidateId)
    setLoading(false)
    if (result.error) {
      onMessage?.(result.error, "error")
      return
    }
    setDetail(result.data)
    const candidate = result.data?.candidate || {}
    setEvalForm((current) => ({
      ...current,
      interview_id: result.data?.interviews?.[0]?.interview?.id || ""
    }))
  }

  useEffect(() => {
    if (candidateId) loadDetail()
  }, [candidateId])

  const candidate = detail?.candidate || {}
  const vacancy = detail?.vacancy || {}
  const applicationPayload = candidate.application_payload && typeof candidate.application_payload === "object"
    ? candidate.application_payload
    : {}
  const isWebsiteApplication = hasWebsiteApplicationData(candidate, applicationPayload)

  function renderWebsiteApplicationSection() {
    if (!isWebsiteApplication) return null

    const rows = buildWebsiteApplicationRows(candidate, applicationPayload)
    if (!rows.length) return null

    return (
      <section className="recruitment-section">
        <h3>Aplicación desde el sitio web</h3>
        <dl className="recruitment-detail-list">
          {rows.map((row) => (
            <div key={row.id}>
              <dt>{row.label}</dt>
              <dd>
                {row.type === "link" ? (
                  <a href={row.value} target="_blank" rel="noopener noreferrer">Abrir / descargar</a>
                ) : (
                  row.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    )
  }

  function renderIntegrationDebugSection() {
    if (!canViewIntegrationDebug || !isWebsiteApplication) return null

    const debugPayload = buildIntegrationDebugPayload(applicationPayload)
    if (!Object.keys(debugPayload).length) return null

    return (
      <details className="recruitment-section recruitment-collapse recruitment-debug">
        <summary>Datos técnicos de integración</summary>
        <pre className="recruitment-debug-payload">{JSON.stringify(debugPayload, null, 2)}</pre>
      </details>
    )
  }

  function renderProfileForm() {
    if (isWebsiteApplication) {
      return (
        <form className="recruitment-section" onSubmit={saveProfile}>
          <h3>Seguimiento RRHH</h3>
          <p className="tasks-muted">Los datos de la aplicación web se muestran arriba. Aquí puedes registrar información interna.</p>
          <div className="recruitment-form-grid">
            <Field label="WhatsApp">
              <input value={candidate.whatsapp || ""} onChange={(e) => updateCandidate("whatsapp", e.target.value)} />
            </Field>
            <Field label="Notas internas" className="recruitment-field--full">
              <textarea value={candidate.internal_notes || ""} onChange={(e) => updateCandidate("internal_notes", e.target.value)} />
            </Field>
          </div>
          <button type="submit" className="tasks-primary" disabled={saving}>Guardar notas</button>
        </form>
      )
    }

    return (
      <form className="recruitment-section" onSubmit={saveProfile}>
        <h3>Datos personales</h3>
        <div className="recruitment-form-grid recruitment-form-grid--compact">
          <Field label="Nombre completo" className="recruitment-field--full">
            <input value={candidate.full_name || ""} onChange={(e) => updateCandidate("full_name", e.target.value)} required />
          </Field>
          <Field label="Teléfono"><input value={candidate.phone || ""} onChange={(e) => updateCandidate("phone", e.target.value)} /></Field>
          <Field label="Correo"><input type="email" value={candidate.email || ""} onChange={(e) => updateCandidate("email", e.target.value)} /></Field>
          <Field label="WhatsApp"><input value={candidate.whatsapp || ""} onChange={(e) => updateCandidate("whatsapp", e.target.value)} /></Field>
          <Field label="Edad"><input type="number" min="16" max="99" value={candidate.age ?? ""} onChange={(e) => updateCandidate("age", e.target.value)} /></Field>
          <Field label="Fuente">
            <select value={candidate.source || "other"} onChange={(e) => updateCandidate("source", e.target.value)}>
              {CANDIDATE_SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Puesto aplicado"><input value={candidate.position_applied || ""} onChange={(e) => updateCandidate("position_applied", e.target.value)} /></Field>
          <Field label="Dirección / municipio" className="recruitment-field--span-2">
            <input value={candidate.address || ""} onChange={(e) => updateCandidate("address", e.target.value)} />
          </Field>
          <Field label="Disponibilidad"><input value={candidate.schedule_availability || ""} onChange={(e) => updateCandidate("schedule_availability", e.target.value)} /></Field>
          <Field label="Expectativa salarial"><input value={candidate.salary_expectation || ""} onChange={(e) => updateCandidate("salary_expectation", e.target.value)} /></Field>
          <Field label="Experiencia previa">
            <textarea value={candidate.prior_experience || ""} onChange={(e) => updateCandidate("prior_experience", e.target.value)} />
          </Field>
          <Field label="Observaciones">
            <textarea value={candidate.notes || ""} onChange={(e) => updateCandidate("notes", e.target.value)} />
          </Field>
          <Field label="Notas internas">
            <textarea value={candidate.internal_notes || ""} onChange={(e) => updateCandidate("internal_notes", e.target.value)} />
          </Field>
        </div>
        <button type="submit" className="tasks-primary" disabled={saving}>Guardar perfil</button>
      </form>
    )
  }

  async function saveProfile(event) {
    event.preventDefault()
    setSaving(true)
    const result = await upsertRecruitmentCandidate({
      id: candidate.id,
      vacancy_id: candidate.vacancy_id,
      full_name: candidate.full_name,
      phone: candidate.phone,
      email: candidate.email,
      whatsapp: candidate.whatsapp,
      age: candidate.age,
      address: candidate.address,
      position_applied: candidate.position_applied,
      source: candidate.source,
      prior_experience: candidate.prior_experience,
      schedule_availability: candidate.schedule_availability,
      salary_expectation: candidate.salary_expectation,
      notes: candidate.notes,
      internal_notes: candidate.internal_notes
    })
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Perfil actualizado.", "success")
      await loadDetail()
      onChanged?.()
    }
  }

  async function submitContact(event) {
    event.preventDefault()
    setSaving(true)
    const result = await registerRecruitmentContact({
      candidate_id: candidateId,
      ...contactForm,
      contacted_at: new Date(contactForm.contacted_at).toISOString()
    })
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Contacto registrado.", "success")
      setPanel("profile")
      await loadDetail()
      onChanged?.()
    }
  }

  async function submitInterview(event) {
    event.preventDefault()
    setSaving(true)
    const result = await scheduleRecruitmentInterview({
      candidate_id: candidateId,
      ...interviewForm
    })
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Entrevista programada.", "success")
      setPanel("profile")
      await loadDetail()
      onChanged?.()
    }
  }

  async function submitEvaluation(event) {
    event.preventDefault()
    if (!evalForm.interview_id) {
      onMessage?.("Selecciona una entrevista para evaluar.", "error")
      return
    }
    setSaving(true)
    const result = await saveRecruitmentInterviewEvaluation(evalForm)
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Evaluación guardada.", "success")
      await loadDetail()
      onChanged?.()
    }
  }

  async function handleInterviewResult(interviewId, interviewResult) {
    setSaving(true)
    const result = await updateRecruitmentInterviewResult(interviewId, interviewResult)
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Resultado de entrevista actualizado.", "success")
      await loadDetail()
      onChanged?.()
    }
  }

  async function submitDiscard(event) {
    event.preventDefault()
    setSaving(true)
    const result = await discardRecruitmentCandidate(candidateId, discardForm.reason, discardForm.notes)
    setSaving(false)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Candidato descartado.", "success")
      onChanged?.()
      onClose?.()
    }
  }

  async function handleConverted() {
    await loadDetail()
    onChanged?.()
  }

  function renderConversionStatus() {
    const status = candidate.onboarding_status
    if (!status || status === "none") return null
    return (
      <section className="recruitment-section">
        <h3>Incorporación</h3>
        <span className={`recruitment-badge recruitment-badge--${onboardingStatusTone(status)}`}>
          {labelFor(ONBOARDING_STATUSES, status)}
        </span>
        {candidate.profile_id && detail?.employee_profile ? (
          <p className="tasks-muted">
            Colaborador: {detail.employee_profile.full_name || detail.employee_profile.username}
            {detail.employee_profile.area_name ? ` · ${detail.employee_profile.area_name}` : ""}
          </p>
        ) : null}
        {candidate.hire_date ? <p className="tasks-muted">Fecha de ingreso: {candidate.hire_date}</p> : null}
        {candidate.converted_at ? (
          <p className="tasks-muted">Convertido: {new Date(candidate.converted_at).toLocaleString("es-GT")}</p>
        ) : null}
      </section>
    )
  }

  function updateCandidate(field, value) {
    setDetail((current) => ({
      ...current,
      candidate: { ...current.candidate, [field]: value }
    }))
  }

  return (
    <div className="recruitment-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside className="recruitment-drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="recruitment-drawer__head">
          <button type="button" className="tasks-link" onClick={onClose}>← Cerrar</button>
          <h2>{candidate.full_name || "Candidato"}</h2>
          <p className="tasks-muted">
            {labelFor(PIPELINE_COLUMNS, candidate.pipeline_status)} · {vacancy.position_title || "Sin vacante"}
          </p>
          {candidate.onboarding_status && candidate.onboarding_status !== "none" ? (
            <span className={`recruitment-badge recruitment-badge--${onboardingStatusTone(candidate.onboarding_status)}`}>
              {labelFor(ONBOARDING_STATUSES, candidate.onboarding_status)}
            </span>
          ) : null}
        </header>

        <div className="recruitment-drawer__body">
          {loading ? <p className="tasks-muted">Cargando perfil...</p> : null}
          {!loading && panel === "profile" && (
            <>
              {renderWebsiteApplicationSection()}
              {renderProfileForm()}

              <details className="recruitment-section recruitment-collapse">
                <summary>Vacante asociada</summary>
                <p><strong>{vacancy.position_title}</strong> · {vacancy.area || "Sin área"}</p>
                <p className="tasks-muted">Meta: {vacancy.target_date || "—"} · Prioridad: {labelFor(VACANCY_PRIORITIES, vacancy.priority)}</p>
              </details>

              {candidate.discard_reason ? (
                <section className="recruitment-section">
                  <h3>Descarte</h3>
                  <p>{labelFor(DISCARD_REASONS, candidate.discard_reason)}</p>
                  <p className="tasks-muted">{candidate.discard_notes || "Sin notas"}</p>
                </section>
              ) : null}

              {renderConversionStatus()}

              <details className="recruitment-section recruitment-collapse">
                <summary>Historial de contactos ({detail?.contacts?.length || 0})</summary>
                <div className="recruitment-timeline">
                  {(detail?.contacts || []).map((item) => (
                    <article key={item.id} className="recruitment-timeline-item">
                      <strong>{labelFor(CONTACT_TYPES, item.contact_type)} · {labelFor(CONTACT_RESULTS, item.result)}</strong>
                      <p>{new Date(item.contacted_at).toLocaleString("es-GT")} · {item.notes || "Sin observaciones"}</p>
                    </article>
                  ))}
                  {!detail?.contacts?.length ? <p className="tasks-muted">Sin contactos registrados.</p> : null}
                </div>
              </details>

              <details className="recruitment-section recruitment-collapse">
                <summary>Entrevistas ({detail?.interviews?.length || 0})</summary>
                <div className="recruitment-timeline">
                  {(detail?.interviews || []).map(({ interview, responsible_name, evaluation }) => (
                    <article key={interview.id} className="recruitment-timeline-item">
                      <strong>{interview.scheduled_date} {interview.scheduled_time || ""}</strong>
                      <p>{responsible_name || "Sin responsable"} · {interview.location_modality || "Sin lugar"}</p>
                      <p>{interview.result ? labelFor(INTERVIEW_RESULTS, interview.result) : "Pendiente"} · {interview.notes || ""}</p>
                      {!interview.result ? (
                        <div className="recruitment-candidate-card__actions">
                          {INTERVIEW_RESULTS.map((item) => (
                            <button key={item.value} type="button" className="tasks-secondary" disabled={saving} onClick={() => handleInterviewResult(interview.id, item.value)}>
                              {item.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {evaluation ? (
                        <p>Evaluación: {labelFor(EVAL_RECOMMENDATIONS, evaluation.recommendation)} · Promedio {
                          Math.round((
                            Number(evaluation.presentation_score)
                            + Number(evaluation.communication_score)
                            + Number(evaluation.experience_score)
                            + Number(evaluation.attitude_score)
                            + Number(evaluation.availability_score)
                          ) / 5)
                        }/5</p>
                      ) : null}
                    </article>
                  ))}
                  {!detail?.interviews?.length ? <p className="tasks-muted">Sin entrevistas programadas.</p> : null}
                </div>
              </details>

              <details className="recruitment-section recruitment-collapse">
                <summary>Historial de estados ({detail?.status_history?.length || 0})</summary>
                <div className="recruitment-timeline">
                  {(detail?.status_history || []).map((item) => (
                    <article key={item.id} className="recruitment-timeline-item">
                      <strong>{labelFor(PIPELINE_COLUMNS, item.from_status)} → {labelFor(PIPELINE_COLUMNS, item.to_status)}</strong>
                      <p>{new Date(item.changed_at).toLocaleString("es-GT")}</p>
                    </article>
                  ))}
                  {!detail?.status_history?.length ? <p className="tasks-muted">Sin cambios registrados.</p> : null}
                </div>
              </details>

              {renderIntegrationDebugSection()}
            </>
          )}

          {panel === "contact" && (
            <form className="recruitment-section" onSubmit={submitContact}>
              <h3>Registrar contacto</h3>
              <div className="recruitment-form-grid">
                <Field label="Fecha y hora" className="recruitment-field--full">
                  <input type="datetime-local" value={contactForm.contacted_at} onChange={(e) => setContactForm({ ...contactForm, contacted_at: e.target.value })} />
                </Field>
                <Field label="Tipo">
                  <select value={contactForm.contact_type} onChange={(e) => setContactForm({ ...contactForm, contact_type: e.target.value })}>
                    {CONTACT_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Resultado">
                  <select value={contactForm.result} onChange={(e) => setContactForm({ ...contactForm, result: e.target.value })}>
                    {CONTACT_RESULTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Observaciones" className="recruitment-field--full">
                  <textarea value={contactForm.notes} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })} />
                </Field>
              </div>
              <div className="recruitment-modal__actions">
                <button type="button" className="tasks-secondary" onClick={() => setPanel("profile")}>Cancelar</button>
                <button type="submit" className="tasks-primary" disabled={saving}>Guardar contacto</button>
              </div>
            </form>
          )}

          {panel === "interview" && (
            <form className="recruitment-section" onSubmit={submitInterview}>
              <h3>Programar entrevista</h3>
              <div className="recruitment-form-grid">
                <Field label="Fecha"><input type="date" value={interviewForm.scheduled_date} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_date: e.target.value })} required /></Field>
                <Field label="Hora"><input type="time" value={interviewForm.scheduled_time} onChange={(e) => setInterviewForm({ ...interviewForm, scheduled_time: e.target.value })} /></Field>
                <Field label="Responsable">
                  <select value={interviewForm.responsible_profile_id} onChange={(e) => setInterviewForm({ ...interviewForm, responsible_profile_id: e.target.value })}>
                    <option value="">Seleccionar...</option>
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                </Field>
                <Field label="Lugar / modalidad"><input value={interviewForm.location_modality} onChange={(e) => setInterviewForm({ ...interviewForm, location_modality: e.target.value })} /></Field>
                <Field label="Observaciones" className="recruitment-field--full">
                  <textarea value={interviewForm.notes} onChange={(e) => setInterviewForm({ ...interviewForm, notes: e.target.value })} />
                </Field>
              </div>
              <div className="recruitment-modal__actions">
                <button type="button" className="tasks-secondary" onClick={() => setPanel("profile")}>Cancelar</button>
                <button type="submit" className="tasks-primary" disabled={saving}>Programar</button>
              </div>
            </form>
          )}

          {panel === "evaluation" && (
            <form className="recruitment-section" onSubmit={submitEvaluation}>
              <h3>Evaluación de entrevista</h3>
              <Field label="Entrevista">
                <select value={evalForm.interview_id} onChange={(e) => setEvalForm({ ...evalForm, interview_id: e.target.value })}>
                  <option value="">Seleccionar...</option>
                  {(detail?.interviews || []).map(({ interview }) => (
                    <option key={interview.id} value={interview.id}>{interview.scheduled_date} {interview.scheduled_time || ""}</option>
                  ))}
                </select>
              </Field>
              <div className="recruitment-form-grid">
                {[
                  ["presentation_score", "Presentación"],
                  ["communication_score", "Comunicación"],
                  ["experience_score", "Experiencia"],
                  ["attitude_score", "Actitud"],
                  ["availability_score", "Disponibilidad"]
                ].map(([field, label]) => (
                  <Field key={field} label={`${label} (1-5)`}>
                    <input type="number" min="1" max="5" value={evalForm[field]} onChange={(e) => setEvalForm({ ...evalForm, [field]: Number(e.target.value) })} />
                  </Field>
                ))}
                <Field label="Recomendación" className="recruitment-field--full">
                  <select value={evalForm.recommendation} onChange={(e) => setEvalForm({ ...evalForm, recommendation: e.target.value })}>
                    {EVAL_RECOMMENDATIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </Field>
                <Field label="Comentarios" className="recruitment-field--full">
                  <textarea value={evalForm.comments} onChange={(e) => setEvalForm({ ...evalForm, comments: e.target.value })} />
                </Field>
              </div>
              <div className="recruitment-modal__actions">
                <button type="button" className="tasks-secondary" onClick={() => setPanel("profile")}>Cancelar</button>
                <button type="submit" className="tasks-primary" disabled={saving}>Guardar evaluación</button>
              </div>
            </form>
          )}

          {panel === "discard" && (
            <form className="recruitment-section" onSubmit={submitDiscard}>
              <h3>Descartar candidato</h3>
              <Field label="Motivo">
                <select value={discardForm.reason} onChange={(e) => setDiscardForm({ ...discardForm, reason: e.target.value })}>
                  {DISCARD_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </Field>
              <Field label="Observaciones">
                <textarea value={discardForm.notes} onChange={(e) => setDiscardForm({ ...discardForm, notes: e.target.value })} />
              </Field>
              <div className="recruitment-modal__actions">
                <button type="button" className="tasks-secondary" onClick={() => setPanel("profile")}>Cancelar</button>
                <button type="submit" className="tasks-primary danger" disabled={saving}>Confirmar descarte</button>
              </div>
            </form>
          )}
        </div>

        {panel === "profile" && candidate.pipeline_status !== "hired" && candidate.pipeline_status !== "discarded" ? (
          <footer className="recruitment-drawer__foot">
            <button type="button" className="tasks-secondary" disabled={saving} onClick={() => setPanel("contact")}>Registrar contacto</button>
            <button type="button" className="tasks-secondary" disabled={saving} onClick={() => setPanel("interview")}>Programar entrevista</button>
            <button type="button" className="tasks-secondary" disabled={saving} onClick={() => setPanel("evaluation")}>Evaluar entrevista</button>
            <button type="button" className="tasks-primary" disabled={saving} onClick={() => setConvertOpen(true)}>Contratar</button>
            <button type="button" className="tasks-link danger" disabled={saving} onClick={() => setPanel("discard")}>Descartar</button>
          </footer>
        ) : null}

        {panel === "profile" && candidate.pipeline_status === "hired" && !candidate.profile_id ? (
          <footer className="recruitment-drawer__foot">
            <button type="button" className="tasks-primary" disabled={saving} onClick={() => setConvertOpen(true)}>
              Convertir en colaborador
            </button>
          </footer>
        ) : null}
      </aside>

      <ConvertCandidateModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        candidateId={candidateId}
        detail={detail}
        profiles={profiles}
        onSuccess={handleConverted}
        onMessage={onMessage}
      />
    </div>
  )
}
