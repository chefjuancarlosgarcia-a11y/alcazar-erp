import { useEffect, useState } from "react"
import {
  createOperationalProcessRun,
  deactivateOperationalProcessTemplate,
  getOperationalProcessTemplateDetail,
  getOperationalProcessTemplatesLibrary,
  upsertOperationalProcessTemplate
} from "../../services/operationalProcessService"
import {
  buildProcessTemplatePayload,
  createEmptyProcessStep,
  formatOperationalProcessFrequency,
  isOperationalProcessManual,
  mapProcessDetailSteps,
  moveProcessStep,
  normalizeOperationalRecurrenceDays,
  OPERATIONAL_COMPLETION_MODES,
  OPERATIONAL_FREQUENCY_TYPES,
  OPERATIONAL_PROCESS_TYPES,
  OPERATIONAL_WEEKDAYS
} from "../../utils/operationalProcessProgress"
import { getChecklistOperationalDate } from "../../utils/checklistOperationalStatus"

const EMPTY_FORM = {
  id: null,
  title: "",
  description: "",
  area: "",
  process_type: "checklist_bundle",
  completion_mode: "all_required",
  allow_parallel_execution: true,
  status: "active",
  supervisor_profile_id: "",
  frequency_type: "manual",
  recurrence_days: [],
  recurrence_month_day: 1
}

function ProcessField({ label, hint, className = "", children }) {
  return (
    <label className={`tasks-field ${className}`.trim()}>
      <span className="tasks-field-label">{label}</span>
      {children}
      {hint ? <small className="tasks-field-hint">{hint}</small> : null}
    </label>
  )
}

export default function OperationalProcessLibrary({
  checklistTemplates = [],
  profiles = [],
  canManage = false,
  onChanged,
  onMessage
}) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [runningId, setRunningId] = useState("")
  const [form, setForm] = useState(EMPTY_FORM)
  const [steps, setSteps] = useState([createEmptyProcessStep()])

  useEffect(() => {
    loadLibrary()
  }, [])

  async function loadLibrary() {
    setLoading(true)
    const result = await getOperationalProcessTemplatesLibrary()
    setLoading(false)
    if (result.error) onMessage?.(result.error, "error")
    setItems(result.data || [])
  }

  function resetEditor() {
    setForm(EMPTY_FORM)
    setSteps([createEmptyProcessStep()])
    setEditing(false)
  }

  async function openEditor(item = null) {
    if (!item) {
      resetEditor()
      setEditing(true)
      return
    }
    const result = await getOperationalProcessTemplateDetail(item.id)
    if (result.error) {
      onMessage?.(result.error, "error")
      return
    }
    const template = result.data?.template || {}
    setForm({
      id: template.id,
      title: template.title || "",
      description: template.description || "",
      area: template.area || "",
      process_type: template.process_type || "checklist_bundle",
      completion_mode: template.completion_mode || "all_required",
      allow_parallel_execution: template.allow_parallel_execution !== false,
      status: template.status || "active",
      supervisor_profile_id: template.supervisor_profile_id || "",
      frequency_type: template.frequency_type || "manual",
      recurrence_days: normalizeOperationalRecurrenceDays(template.recurrence_days),
      recurrence_month_day: Number(template.recurrence_month_day || 1)
    })
    const mapped = mapProcessDetailSteps(result.data)
    setSteps(mapped.length ? mapped : [createEmptyProcessStep()])
    setEditing(true)
  }

  function updateStep(index, field, value) {
    setSteps((current) => current.map((step, stepIndex) => (
      stepIndex === index ? { ...step, [field]: value } : step
    )))
  }

  function addStep() {
    setSteps((current) => [...current, createEmptyProcessStep(`step-${Date.now()}`)])
  }

  function removeStep(index) {
    setSteps((current) => {
      const removedKey = current[index]?.client_key
      const next = current.filter((_, stepIndex) => stepIndex !== index)
      return next.map((step) => (
        step.depends_on_client_key === removedKey ? { ...step, depends_on_client_key: "" } : step
      ))
    })
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!form.title?.trim()) {
      onMessage?.("El titulo del proceso es obligatorio.", "error")
      return
    }
    const validSteps = steps.filter((step) => step.child_template_id && step.step_label?.trim())
    if (!validSteps.length) {
      onMessage?.("Agrega al menos una checklist hija con etiqueta.", "error")
      return
    }
    if (form.frequency_type === "weekly" && !normalizeOperationalRecurrenceDays(form.recurrence_days).length) {
      onMessage?.("Selecciona al menos un dia de la semana para la programacion semanal.", "error")
      return
    }

    setSaving(true)
    const { payload, steps: stepPayload } = buildProcessTemplatePayload(form, validSteps)
    const result = await upsertOperationalProcessTemplate(payload, stepPayload)
    setSaving(false)
    if (result.error) {
      onMessage?.(result.error, "error")
      return
    }
    onMessage?.("Proceso operativo guardado.", "success")
    resetEditor()
    await loadLibrary()
    onChanged?.()
  }

  function toggleRecurrenceDay(day) {
    setForm((current) => {
      const normalized = normalizeOperationalRecurrenceDays(current.recurrence_days)
      const next = normalized.includes(day)
        ? normalized.filter((item) => item !== day)
        : [...normalized, day]
      return { ...current, recurrence_days: next.sort((a, b) => a - b) }
    })
  }

  async function handleDeactivate(id) {
    if (!window.confirm("¿Desactivar este proceso operativo?")) return
    const result = await deactivateOperationalProcessTemplate(id)
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.("Proceso desactivado.", "success")
      await loadLibrary()
      onChanged?.()
    }
  }

  async function handleRunToday(item) {
    setRunningId(item.id)
    const result = await createOperationalProcessRun(item.id, { runDate: getChecklistOperationalDate() })
    setRunningId("")
    if (result.error) onMessage?.(result.error, "error")
    else {
      onMessage?.(`Proceso "${item.title}" iniciado para hoy.`, "success")
      onChanged?.({ goToday: true })
    }
  }

  if (editing) {
    return (
      <article className="tasks-panel operational-process-editor">
        <div className="tasks-panel-title">
          <div>
            <p className="tasks-eyebrow">Proceso operativo</p>
            <h2>{form.id ? "Editar proceso" : "Nuevo proceso"}</h2>
            <p className="tasks-muted">Agrupa checklists hijas bajo un proceso padre sin modificar las plantillas existentes.</p>
          </div>
        </div>

        <form className="operational-process-editor__form" onSubmit={handleSave}>
          <section className="operational-process-section-card">
            <header className="operational-process-section-card__head">
              <div>
                <strong>Información General</strong>
                <p className="tasks-muted">Datos básicos del proceso operativo.</p>
              </div>
            </header>

            <div className="operational-process-editor__stack">
              <ProcessField label="Título" className="operational-process-field--full">
                <input
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Ej. Apertura completa FOH"
                  required
                />
              </ProcessField>

              <ProcessField label="Descripción" className="operational-process-field--full">
                <textarea
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Contexto opcional para supervisores y colaboradores."
                />
              </ProcessField>

              <div className="operational-process-meta-grid">
                <ProcessField label="Área">
                  <input
                    value={form.area}
                    onChange={(e) => setForm({ ...form, area: e.target.value })}
                    placeholder="Ej. Cocina, Salón"
                  />
                </ProcessField>
                <ProcessField label="Tipo">
                  <select value={form.process_type} onChange={(e) => setForm({ ...form, process_type: e.target.value })}>
                    {OPERATIONAL_PROCESS_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </ProcessField>
                <ProcessField label="Supervisor">
                  <select value={form.supervisor_profile_id} onChange={(e) => setForm({ ...form, supervisor_profile_id: e.target.value })}>
                    <option value="">Sin supervisor</option>
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
                    ))}
                  </select>
                </ProcessField>
                <ProcessField label="Modo de completado">
                  <select value={form.completion_mode} onChange={(e) => setForm({ ...form, completion_mode: e.target.value })}>
                    {OPERATIONAL_COMPLETION_MODES.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </ProcessField>
              </div>

              <label className="tasks-checkbox checklist-flag-chip operational-process-parallel-flag">
                <input
                  type="checkbox"
                  checked={form.allow_parallel_execution}
                  onChange={(e) => setForm({ ...form, allow_parallel_execution: e.target.checked })}
                />
                <span>Permitir ejecución paralela</span>
              </label>
            </div>
          </section>

          <section className="operational-process-section-card">
            <header className="operational-process-section-card__head">
              <div>
                <strong>Programación</strong>
                <p className="tasks-muted">Los procesos automáticos se generan al cargar Checklists, igual que las checklists recurrentes.</p>
              </div>
            </header>

            <div className="operational-process-editor__stack">
              <ProcessField label="Frecuencia" className="operational-process-field--full">
                <select
                  value={form.frequency_type}
                  onChange={(e) => setForm({
                    ...form,
                    frequency_type: e.target.value,
                    recurrence_days: e.target.value === "weekly" ? form.recurrence_days : [],
                    recurrence_month_day: e.target.value === "monthly" ? (form.recurrence_month_day || 1) : 1
                  })}
                >
                  {OPERATIONAL_FREQUENCY_TYPES.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </ProcessField>

              {form.frequency_type === "weekly" ? (
                <ProcessField label="Días de la semana" className="operational-process-field--full">
                  <div className="operational-process-weekdays">
                    {OPERATIONAL_WEEKDAYS.map(([day, label]) => {
                      const selected = normalizeOperationalRecurrenceDays(form.recurrence_days).includes(day)
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`operational-process-weekday${selected ? " is-selected" : ""}`}
                          onClick={() => toggleRecurrenceDay(day)}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </ProcessField>
              ) : null}

              {form.frequency_type === "monthly" ? (
                <ProcessField label="Día del mes">
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={form.recurrence_month_day}
                    onChange={(e) => setForm({ ...form, recurrence_month_day: Number(e.target.value || 1) })}
                  />
                </ProcessField>
              ) : null}

              {form.frequency_type !== "manual" ? (
                <p className="tasks-muted operational-process-schedule-hint">
                  Este proceso se creará automáticamente en el día operativo correspondiente. No requiere «Ejecutar hoy».
                </p>
              ) : null}
            </div>
          </section>

          <section className="operational-process-section-card">
            <header className="operational-process-section-card__head operational-process-section-card__head--split">
              <div>
                <strong>Checklists hijas</strong>
                <p className="tasks-muted">Cada paso genera una checklist independiente al ejecutar o programar el proceso.</p>
              </div>
              <button type="button" className="tasks-secondary operational-process-add-step" onClick={addStep}>
                + Agregar checklist
              </button>
            </header>

            <div className="operational-process-steps-list">
              {steps.map((step, index) => (
                <article key={step.client_key} className="operational-process-step-card">
                  <header className="operational-process-step-card__head">
                    <div className="operational-process-step-card__title">
                      <span className="operational-process-step-card__badge">Paso {index + 1}</span>
                      <strong>{step.step_label?.trim() || "Checklist sin etiqueta"}</strong>
                    </div>
                    <div className="operational-process-step-card__actions">
                      {index > 0 ? (
                        <button type="button" className="tasks-link" onClick={() => setSteps(moveProcessStep(steps, index, index - 1))}>Subir</button>
                      ) : null}
                      {index < steps.length - 1 ? (
                        <button type="button" className="tasks-link" onClick={() => setSteps(moveProcessStep(steps, index, index + 1))}>Bajar</button>
                      ) : null}
                      <button type="button" className="tasks-link danger" onClick={() => removeStep(index)}>Quitar</button>
                    </div>
                  </header>

                  <div className="operational-process-step-card__body">
                    <ProcessField label="Checklist plantilla">
                      <select
                        value={step.child_template_id}
                        onChange={(e) => {
                          const template = checklistTemplates.find((item) => item.id === e.target.value)
                          updateStep(index, "child_template_id", e.target.value)
                          if (template && !step.step_label) updateStep(index, "step_label", template.title)
                        }}
                      >
                        <option value="">Seleccionar...</option>
                        {checklistTemplates.filter((item) => item.status === "active").map((template) => (
                          <option key={template.id} value={template.id}>{template.title}</option>
                        ))}
                      </select>
                    </ProcessField>
                    <ProcessField label="Etiqueta del paso">
                      <input value={step.step_label} onChange={(e) => updateStep(index, "step_label", e.target.value)} />
                    </ProcessField>
                    <ProcessField label="Colaborador">
                      <select value={step.assigned_profile_id} onChange={(e) => updateStep(index, "assigned_profile_id", e.target.value)}>
                        <option value="">Heredar de plantilla</option>
                        {profiles.map((profile) => (
                          <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
                        ))}
                      </select>
                    </ProcessField>
                    <ProcessField label="Rol">
                      <input value={step.assigned_role} onChange={(e) => updateStep(index, "assigned_role", e.target.value)} placeholder="Opcional" />
                    </ProcessField>
                    <ProcessField label="Área">
                      <input value={step.area} onChange={(e) => updateStep(index, "area", e.target.value)} placeholder="Opcional" />
                    </ProcessField>
                    <ProcessField label="Depende de">
                      <select value={step.depends_on_client_key} onChange={(e) => updateStep(index, "depends_on_client_key", e.target.value)}>
                        <option value="">Ninguno</option>
                        {steps.filter((candidate) => candidate.client_key !== step.client_key).map((candidate, candidateIndex) => (
                          <option key={candidate.client_key} value={candidate.client_key}>
                            Paso {candidateIndex + 1}: {candidate.step_label || "Sin etiqueta"}
                          </option>
                        ))}
                      </select>
                    </ProcessField>
                    <label className="tasks-checkbox checklist-flag-chip operational-process-step-required">
                      <input type="checkbox" checked={step.is_required} onChange={(e) => updateStep(index, "is_required", e.target.checked)} />
                      <span>Requerida para completar proceso</span>
                    </label>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <footer className="operational-process-editor__foot">
            <button type="button" className="tasks-secondary" onClick={resetEditor} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="tasks-primary" disabled={saving || !canManage}>
              {saving ? "Guardando..." : "Guardar Proceso"}
            </button>
          </footer>
        </form>
      </article>
    )
  }

  return (
    <article className="tasks-panel operational-process-library">
      <header className="operational-process-library__head">
        <div>
          <p className="tasks-eyebrow">Procesos operativos</p>
          <h2>Plantillas de proceso</h2>
          <p className="tasks-muted">Agrupa checklists hijas bajo un proceso padre sin modificar las checklists existentes.</p>
        </div>
        {canManage ? (
          <button type="button" className="tasks-primary" onClick={() => openEditor()}>+ Nuevo proceso</button>
        ) : null}
      </header>

      {loading ? <p className="tasks-muted">Cargando procesos...</p> : null}
      {!loading && !items.length ? (
        <p className="tasks-empty">Aún no hay procesos operativos configurados.</p>
      ) : null}

      <div className="operational-process-library__grid">
        {items.map((item) => (
          <article key={item.id} className="operational-process-card">
            <header className="operational-process-card__head">
              <strong>{item.title}</strong>
              <span className={`operational-process-card__status operational-process-card__status--${item.status}`}>{item.status}</span>
            </header>
            <p className="tasks-muted">{item.description || "Sin descripción"}</p>
            <small className="operational-process-card__meta">
              {item.step_count || 0} checklist(s) · {formatOperationalProcessFrequency(item)} · {item.completion_mode} · {item.allow_parallel_execution ? "Paralelo" : "Secuencial"}
            </small>
            <footer className="operational-process-card__foot">
              {isOperationalProcessManual(item) ? (
                <button type="button" className="tasks-secondary" disabled={runningId === item.id} onClick={() => handleRunToday(item)}>
                  {runningId === item.id ? "Iniciando..." : "Ejecutar hoy"}
                </button>
              ) : (
                <span className="operational-process-card__auto-badge">Programado</span>
              )}
              {canManage ? (
                <>
                  <button type="button" className="tasks-link" onClick={() => openEditor(item)}>Editar</button>
                  {item.status === "active" ? (
                    <button type="button" className="tasks-link danger" onClick={() => handleDeactivate(item.id)}>Desactivar</button>
                  ) : null}
                </>
              ) : null}
            </footer>
          </article>
        ))}
      </div>
    </article>
  )
}
