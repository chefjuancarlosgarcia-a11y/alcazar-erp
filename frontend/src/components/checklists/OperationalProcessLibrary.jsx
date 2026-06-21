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
  mapProcessDetailSteps,
  moveProcessStep,
  OPERATIONAL_COMPLETION_MODES,
  OPERATIONAL_PROCESS_TYPES
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
  supervisor_profile_id: ""
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
      supervisor_profile_id: template.supervisor_profile_id || ""
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
      <form className="operational-process-editor" onSubmit={handleSave}>
        <header className="operational-process-editor__head">
          <div>
            <p className="tasks-eyebrow">Proceso operativo</p>
            <h3>{form.id ? "Editar proceso" : "Nuevo proceso"}</h3>
          </div>
          <button type="button" className="ghost" onClick={resetEditor}>Volver al listado</button>
        </header>

        <div className="operational-process-editor__grid">
          <label>
            Titulo
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          </label>
          <label>
            Area
            <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
          </label>
          <label>
            Tipo
            <select value={form.process_type} onChange={(e) => setForm({ ...form, process_type: e.target.value })}>
              {OPERATIONAL_PROCESS_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            Modo de completado
            <select value={form.completion_mode} onChange={(e) => setForm({ ...form, completion_mode: e.target.value })}>
              {OPERATIONAL_COMPLETION_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="operational-process-editor__checkbox">
            <input
              type="checkbox"
              checked={form.allow_parallel_execution}
              onChange={(e) => setForm({ ...form, allow_parallel_execution: e.target.checked })}
            />
            Permitir ejecucion paralela
          </label>
          <label>
            Supervisor
            <select value={form.supervisor_profile_id} onChange={(e) => setForm({ ...form, supervisor_profile_id: e.target.value })}>
              <option value="">Sin supervisor</option>
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
            </select>
          </label>
        </div>

        <label>
          Descripcion
          <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </label>

        <section className="operational-process-editor__steps">
          <div className="operational-process-editor__steps-head">
            <h4>Checklists hijas</h4>
            <button type="button" className="ghost" onClick={addStep}>+ Agregar checklist</button>
          </div>

          {steps.map((step, index) => (
            <article key={step.client_key} className="operational-process-step-editor">
              <div className="operational-process-step-editor__head">
                <strong>Paso {index + 1}</strong>
                <div className="operational-process-step-editor__actions">
                  {index > 0 ? (
                    <button type="button" className="ghost" onClick={() => setSteps(moveProcessStep(steps, index, index - 1))}>↑</button>
                  ) : null}
                  {index < steps.length - 1 ? (
                    <button type="button" className="ghost" onClick={() => setSteps(moveProcessStep(steps, index, index + 1))}>↓</button>
                  ) : null}
                  <button type="button" className="ghost" onClick={() => removeStep(index)}>Quitar</button>
                </div>
              </div>
              <div className="operational-process-step-editor__grid">
                <label>
                  Checklist plantilla
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
                </label>
                <label>
                  Etiqueta del paso
                  <input value={step.step_label} onChange={(e) => updateStep(index, "step_label", e.target.value)} />
                </label>
                <label>
                  Colaborador
                  <select value={step.assigned_profile_id} onChange={(e) => updateStep(index, "assigned_profile_id", e.target.value)}>
                    <option value="">Heredar de plantilla</option>
                    {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                </label>
                <label>
                  Rol
                  <input value={step.assigned_role} onChange={(e) => updateStep(index, "assigned_role", e.target.value)} placeholder="Opcional" />
                </label>
                <label>
                  Area
                  <input value={step.area} onChange={(e) => updateStep(index, "area", e.target.value)} placeholder="Opcional" />
                </label>
                <label>
                  Depende de
                  <select value={step.depends_on_client_key} onChange={(e) => updateStep(index, "depends_on_client_key", e.target.value)}>
                    <option value="">Ninguno</option>
                    {steps.filter((candidate) => candidate.client_key !== step.client_key).map((candidate, candidateIndex) => (
                      <option key={candidate.client_key} value={candidate.client_key}>
                        Paso {candidateIndex + 1}: {candidate.step_label || "Sin etiqueta"}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="operational-process-editor__checkbox">
                  <input type="checkbox" checked={step.is_required} onChange={(e) => updateStep(index, "is_required", e.target.checked)} />
                  Requerida para completar proceso
                </label>
              </div>
            </article>
          ))}
        </section>

        <footer className="operational-process-editor__foot">
          <button type="submit" className="tasks-primary" disabled={saving || !canManage}>
            {saving ? "Guardando..." : "Guardar proceso"}
          </button>
        </footer>
      </form>
    )
  }

  return (
    <section className="operational-process-library">
      <header className="operational-process-library__head">
        <div>
          <p className="tasks-eyebrow">Procesos operativos</p>
          <h3>Plantillas de proceso</h3>
          <p className="tasks-muted">Agrupa checklists hijas bajo un proceso padre sin modificar las checklists existentes.</p>
        </div>
        {canManage ? (
          <button type="button" className="tasks-primary" onClick={() => openEditor()}>+ Nuevo proceso</button>
        ) : null}
      </header>

      {loading ? <p className="tasks-muted">Cargando procesos...</p> : null}
      {!loading && !items.length ? (
        <p className="tasks-muted">Aun no hay procesos operativos configurados.</p>
      ) : null}

      <div className="operational-process-library__grid">
        {items.map((item) => (
          <article key={item.id} className="operational-process-card">
            <header>
              <strong>{item.title}</strong>
              <span className={`operational-process-card__status operational-process-card__status--${item.status}`}>{item.status}</span>
            </header>
            <p className="tasks-muted">{item.description || "Sin descripcion"}</p>
            <small>{item.step_count || 0} checklist(s) · {item.completion_mode} · {item.allow_parallel_execution ? "Paralelo" : "Secuencial"}</small>
            <footer>
              <button type="button" className="tasks-secondary" disabled={runningId === item.id} onClick={() => handleRunToday(item)}>
                {runningId === item.id ? "Iniciando..." : "Ejecutar hoy"}
              </button>
              {canManage ? (
                <>
                  <button type="button" className="ghost" onClick={() => openEditor(item)}>Editar</button>
                  {item.status === "active" ? (
                    <button type="button" className="ghost" onClick={() => handleDeactivate(item.id)}>Desactivar</button>
                  ) : null}
                </>
              ) : null}
            </footer>
          </article>
        ))}
      </div>
    </section>
  )
}
