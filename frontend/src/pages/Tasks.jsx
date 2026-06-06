import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import {
  approveChecklistChangeRequest,
  approveChecklistRun,
  completeChecklistRun,
  createChecklistRunFromTemplate,
  createChecklistChangeRequest,
  createChecklistTemplate,
  createChecklistTemplateSuggestion,
  deactivateChecklistTemplate,
  deleteChecklistTemplate,
  getChecklistChangeRequests,
  getChecklistIncidents,
  getChecklistProfiles,
  getChecklistRuns,
  getChecklistTemplateSuggestions,
  getChecklistTemplates,
  generateDueChecklistRuns,
  rejectChecklistRun,
  rejectChecklistChangeRequest,
  startChecklistRun,
  submitChecklistChangeRequest,
  updateChecklistRunItem,
  updateChecklistIncidentStatus,
  updateChecklistChangeRequest,
  updateChecklistTemplate,
  updateChecklistTemplateSuggestionStatus
} from "../services/checklistsService"
import {
  TASK_CATEGORIES,
  TASK_DIFFICULTIES,
  TASK_LEVELS,
  TASK_PRIORITIES,
  TASK_RECURRENCES,
  OPERATIONAL_SHIFTS,
  addTaskNotification,
  assignTasksAutomatically,
  assignTasksManually,
  createTaskNotifications,
  formatOperationalTime,
  getCurrentUserTaskId,
  loadAssignedTasks,
  loadOperationalEmployees,
  loadTaskNotifications,
  loadTaskTemplates,
  saveAssignedTasks,
  saveTaskTemplates,
  taskMatchesUser,
  updateTaskPerformance,
  withComputedTaskStatus
} from "../utils/tasks"
import { normalizeRole } from "../utils/profilePermissions"
import "./Tasks.css"

const TODAY = new Date().toISOString().slice(0, 10)
const MANAGEMENT_ROLES = ["admin", "gerente", "gerente_general", "recursos_humanos", "supervisor"]
const ADMIN_TABS = [
  ["dashboard", "Dashboard"],
  ["bank", "Banco de tareas"],
  ["create", "Crear tarea nueva"],
  ["assign", "Asignar tareas"],
  ["calendar", "Calendario operativo"],
  ["checklists", "Checklists"],
  ["mine", "Mis tareas"],
  ["reports", "Reportes"]
]

const CHECKLIST_AREAS = ["FOH", "BOH / Cocina", "Pizzeria", "Cafeteria", "Barra", "Caja", "Panaderia", "Reposteria", "Almacen", "Limpieza", "Oficina", "Recursos Humanos", "Administracion"]
const CHECKLIST_ROLES = ["admin", "gerente_general", "gerente", "supervisor", "encargado_almacen", "recursos_humanos", "cocina", "pizzeria", "barista", "bartender", "panadero", "repostero", "caja", "mesero", "limpieza", "mantenimiento", "colaborador"]
const CHECKLIST_FREQUENCIES = [["manual", "Manual"], ["diaria", "Diaria"], ["semanal", "Semanal"], ["mensual", "Mensual"], ["apertura", "Apertura"], ["cierre", "Cierre"], ["por_turno", "Por turno"]]
const CHECKLIST_CONTEXTS = [["general", "General"], ["apertura", "Apertura"], ["servicio", "Servicio"], ["cierre", "Cierre"], ["limpieza_profunda", "Limpieza profunda"], ["inventario", "Inventario"]]
const CHECKLIST_RESPONSE_TYPES = [["yes_no", "Si / No"], ["checkbox", "Checkbox completado"], ["short_text", "Texto corto"], ["long_text", "Texto largo"], ["number", "Numero"], ["date", "Fecha"], ["time", "Hora"], ["photo", "Foto / evidencia"], ["rating", "Ranking 1 a 5"], ["select", "Lista desplegable"], ["multi_select", "Seleccion multiple"], ["signature", "Firma"], ["acknowledgement", "Lectura obligatoria"]]
const CHECKLIST_WEEKDAYS = [[1, "Lunes"], [2, "Martes"], [3, "Miercoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sabado"], [7, "Domingo"]]
const CHECKLIST_SUGGESTION_TYPES = [["add_item", "Agregar item"], ["remove_item", "Eliminar item"], ["edit_item_text", "Editar texto de item"], ["change_order", "Cambiar orden"], ["change_frequency", "Cambiar frecuencia"], ["change_responsible", "Cambiar responsable"], ["change_evidence", "Cambiar evidencia requerida"], ["other", "Otro"]]
const CHECKLIST_TEMPLATE_MANAGERS = ["admin", "gerente_general", "gerente", "supervisor"]
const CHECKLIST_TEMPLATE_APPROVERS = ["admin", "gerente_general", "gerente"]
const CHECKLIST_INCIDENT_SEVERITIES = [["low", "Baja"], ["medium", "Media"], ["high", "Alta"], ["critical", "Critica"]]
const CHECKLIST_INCIDENT_STATUSES = [["open", "Abiertas"], ["acknowledged", "Reconocidas"], ["in_progress", "En proceso"], ["resolved", "Resueltas"], ["dismissed", "Descartadas"]]
const CHECKLIST_INCIDENT_NOTIFY_ROLES = [["admin", "Admin"], ["gerente_general", "Gerencia General"], ["gerente", "Gerente"], ["supervisor", "Supervisor"]]

const EMPTY_TEMPLATE = {
  title: "",
  description: "",
  areaId: "cocina",
  category: "Apertura",
  priority: "medium",
  difficulty: "easy",
  estimatedMinutes: "20",
  requiredPeople: "1",
  recommendedRole: "",
  requiredSkillLevel: "junior",
  toolsNeeded: "",
  materialsNeeded: "",
  sopLink: "",
  checklistItems: "",
  evidenceRequired: false,
  recurrence: "none",
  recommendedTimeBlock: "08:00",
  active: true
}

function Tasks() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const isManager = MANAGEMENT_ROLES.includes(normalizeRole(user?.role))
  const [templates, setTemplates] = useState(loadTaskTemplates)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [assignedTasks, setAssignedTasks] = useState(loadAssignedTasks)
  const [areas, setAreas] = useState([])
  const [employees] = useState(() => loadOperationalEmployees(user))
  const requestedTab = params.get("tab") === "checklists" ? "checklists" : params.get("view") || (isManager ? "dashboard" : "mine")
  const tab = requestedTab === "checklists" ? "checklists" : isManager && ADMIN_TABS.some(([id]) => id === requestedTab) ? requestedTab : "mine"
  const visibleTemplates = templates.filter((template) => mayUseTemplate(template, user, employees))
  const computedTasks = assignedTasks.map(withComputedTaskStatus)
  const permittedAreas = getPermittedAreas(areas, user, employees, visibleTemplates)

  useEffect(() => {
    let mounted = true
    getActiveAreas().then(({ data }) => {
      if (mounted) setAreas((data || []).map((area) => ({ id: area.id, name: area.name })))
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    const currentTasks = assignedTasks.map(withComputedTaskStatus)
    if (currentTasks.some((task, index) => task.status !== assignedTasks[index].status)) {
      saveAssignedTasks(currentTasks)
      updateTaskPerformance(currentTasks)
    }
    const existing = loadTaskNotifications()
    currentTasks.filter((task) => !["completed", "cancelled"].includes(task.status)).forEach((task) => {
      const dueAt = new Date(`${task.date}T${task.scheduledEnd || "23:59"}:00`).getTime()
      const minutesUntilDue = Math.round((dueAt - Date.now()) / 60000)
      const type = task.status === "late" ? "task_late" : minutesUntilDue >= 0 && minutesUntilDue <= 30 ? "task_due_soon" : ""
      if (!type) return
      task.assignedTo?.forEach((userId) => {
        if (existing.some((notification) => notification.userId === userId && notification.type === type && notification.relatedTaskId === task.id)) return
        addTaskNotification(
          userId,
          type,
          type === "task_late" ? "Tarea atrasada" : "Tarea por vencer",
          type === "task_late" ? `Tu tarea está atrasada: ${task.title}` : `Tu tarea vence pronto: ${task.title}`,
          task.id
        )
        existing.push({ userId, type, relatedTaskId: task.id })
      })
    })
  }, [assignedTasks])

  function openTab(next) {
    setParams({ view: next })
  }

  function persistTasks(nextTasks) {
    setAssignedTasks(nextTasks)
    saveAssignedTasks(nextTasks)
    updateTaskPerformance(nextTasks)
  }

  return (
    <section className="tasks-page">
      <header className="tasks-page-header">
        <div>
          <p className="tasks-eyebrow">Operación diaria</p>
          <h1>Tareas</h1>
          <p className="tasks-muted">Planifica, asigna y mide la ejecución por área y turno.</p>
        </div>
        {!isManager && <span className="tasks-access-chip">Vista personal</span>}
      </header>

      <nav className="tasks-tabs" aria-label="Tareas">
        {(isManager ? ADMIN_TABS : [["mine", "Mis tareas"]]).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => { if (id === "create") setEditingTemplate(null); openTab(id) }}>{label}</button>
        ))}
      </nav>

      {tab === "dashboard" && <TasksDashboard tasks={computedTasks} areas={areas} employees={employees} onOpenTab={openTab} />}
      {tab === "bank" && <TaskBank templates={visibleTemplates} allTemplates={templates} areas={permittedAreas} setTemplates={setTemplates} canDeactivate={user.role !== "rrhh"} onEdit={(template) => { setEditingTemplate(template); openTab("create") }} />}
      {tab === "create" && <TaskTemplateForm key={editingTemplate?.id || "new"} templates={templates} setTemplates={setTemplates} areas={permittedAreas} currentUser={user} editingTemplate={editingTemplate} onFinished={() => { setEditingTemplate(null); openTab("bank") }} />}
      {tab === "assign" && (
        <TaskAssignment
          templates={visibleTemplates}
          tasks={computedTasks}
          employees={employees}
          areas={permittedAreas}
          user={user}
          onAssigned={(newTasks) => persistTasks([...newTasks, ...assignedTasks])}
        />
      )}
      {tab === "calendar" && <OperationalCalendar tasks={computedTasks} employees={employees} areas={areas} />}
      {tab === "checklists" && <ChecklistsModule user={user} initialRunId={params.get("id") || ""} initialChecklistView={params.get("view") || ""} />}
      {tab === "mine" && <MyTasks tasks={computedTasks.filter((task) => taskMatchesUser(task, user))} user={user} persistAllTasks={persistTasks} allTasks={assignedTasks} />}
      {tab === "reports" && <TaskReports tasks={computedTasks} employees={employees} areas={areas} />}
    </section>
  )
}

function mayUseTemplate(template, user, employees) {
  if (!template.active) return false
  if (user?.role === "rrhh") return template.areaId === "administracion" || ["Recursos Humanos", "Capacitación"].includes(template.category)
  if (user?.role !== "supervisor") return true
  const employee = employees.find((item) => item.taskId === getCurrentUserTaskId(user))
  return !employee?.areaId || template.areaId === employee.areaId
}

function getPermittedAreas(areas, user, employees, templates) {
  if (user?.role === "rrhh") return areas.filter((area) => area.id === "administracion")
  if (user?.role !== "supervisor") return areas
  const employee = employees.find((item) => item.taskId === getCurrentUserTaskId(user))
  if (employee?.areaId) return areas.filter((area) => area.id === employee.areaId)
  const taskAreaIds = new Set(templates.map((template) => template.areaId))
  return areas.filter((area) => taskAreaIds.has(area.id))
}

function TasksDashboard({ tasks, areas, employees, onOpenTab }) {
  const todayTasks = tasks.filter((task) => task.date === TODAY)
  const pending = todayTasks.filter((task) => ["pending", "in_progress"].includes(task.status))
  const completed = todayTasks.filter((task) => task.status === "completed")
  const late = todayTasks.filter((task) => task.status === "late")
  const critical = todayTasks.filter((task) => task.priority === "critical" && task.status !== "completed")
  const unassigned = todayTasks.filter((task) => !task.assignedTo?.length)
  const completion = todayTasks.length ? Math.round((completed.length / todayTasks.length) * 100) : 0
  const areaLoad = groupCounts(pending, (task) => task.areaName || task.areaId)
  const employeeLoad = groupMinutes(todayTasks, employees)
  const cards = [
    ["Tareas pendientes hoy", pending.length, "pending"],
    ["Completadas hoy", completed.length, "completed"],
    ["Tareas atrasadas", late.length, "late"],
    ["Tareas críticas", critical.length, "critical"],
    ["Cumplimiento del día", `${completion}%`, "completed"],
    ["Área con más pendientes", areaLoad[0]?.label || "Sin tareas", "pending"],
    ["Colaborador con más carga", employeeLoad[0]?.label || "Sin carga", "medium"],
    ["Tareas sin asignar", unassigned.length, "late"]
  ]
  return (
    <div className="tasks-dashboard">
      <div className="tasks-metric-grid">
        {cards.map(([label, value, tone]) => <article className={`tasks-metric ${tone}`} key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>
      <div className="tasks-dashboard-columns">
        <article className="tasks-panel">
          <div className="tasks-panel-title"><h2>Progreso por área</h2><button type="button" onClick={() => onOpenTab("calendar")}>Ver calendario</button></div>
          {areas.map((area) => {
            const areaTasks = todayTasks.filter((task) => task.areaId === area.id)
            const done = areaTasks.filter((task) => task.status === "completed").length
            const percentage = areaTasks.length ? Math.round((done / areaTasks.length) * 100) : 0
            return <div className="tasks-progress" key={area.id}><div><strong>{area.name}</strong><span>{done}/{areaTasks.length} completadas</span></div><progress value={percentage} max="100" /><small>{percentage}%</small></div>
          })}
        </article>
        <article className="tasks-panel">
          <div className="tasks-panel-title"><h2>Próximas a vencer</h2><button type="button" onClick={() => onOpenTab("assign")}>Asignar</button></div>
          {pending.slice(0, 5).map((task) => <CompactTask key={task.id} task={task} employees={employees} />)}
          {!pending.length && <Empty text="No hay pendientes para hoy." />}
        </article>
      </div>
    </div>
  )
}

function TaskBank({ templates, allTemplates, areas, setTemplates, canDeactivate, onEdit }) {
  const [search, setSearch] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [category, setCategory] = useState("")
  const filtered = templates.filter((template) =>
    (!search || `${template.title} ${template.description}`.toLowerCase().includes(search.toLowerCase())) &&
    (!areaFilter || template.areaId === areaFilter) &&
    (!category || template.category === category)
  )
  function toggle(templateId) {
    const updated = allTemplates.map((template) => template.id === templateId ? { ...template, active: !template.active, updatedAt: new Date().toISOString() } : template)
    setTemplates(updated)
    saveTaskTemplates(updated)
  }
  return (
    <article className="tasks-panel">
      <div className="tasks-panel-title"><div><h2>Banco de tareas</h2><p className="tasks-muted">{filtered.length} procedimientos estandarizados activos</p></div></div>
      <div className="tasks-filters">
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar tarea..." />
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}><option value="">Todas las áreas</option>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select>
        <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas las categorías</option>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
      </div>
      <div className="tasks-template-grid">
        {filtered.map((template) => (
          <article className="tasks-template-card" key={template.id}>
            <div className="tasks-card-badges"><Badge type="priority" value={template.priority} /><Badge type="difficulty" value={template.difficulty} /></div>
            <h3>{template.title}</h3>
            <p>{template.description || "Sin descripción"}</p>
            <div className="tasks-template-meta"><span>{template.areaName}</span><span>{template.category}</span><span>{template.estimatedMinutes} min</span><span>{template.requiredPeople} pers.</span></div>
            {template.evidenceRequired && <small className="tasks-evidence-tag">Requiere evidencia</small>}
            <div className="tasks-card-actions">
              <button type="button" className="tasks-link" onClick={() => onEdit(template)}>Editar</button>
              {canDeactivate && <button type="button" className="tasks-link danger" onClick={() => toggle(template.id)}>Desactivar</button>}
            </div>
          </article>
        ))}
      </div>
    </article>
  )
}

function TaskTemplateForm({ templates, setTemplates, areas, currentUser, editingTemplate, onFinished }) {
  const [form, setForm] = useState(() => editingTemplate ? templateToForm(editingTemplate) : ({ ...EMPTY_TEMPLATE, areaId: areas[0]?.id || EMPTY_TEMPLATE.areaId }))
  const [message, setMessage] = useState("")
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  function toggleRecurrenceDay(day) {
    setForm((current) => {
      const days = current.recurrence_days || []
      return { ...current, recurrence_days: days.includes(day) ? days.filter((item) => item !== day) : [...days, day].sort((a, b) => a - b) }
    })
  }
  function submit(event) {
    event.preventDefault()
    if (!form.title.trim() || !form.description.trim()) return
    const area = areas.find((item) => item.id === form.areaId)
    const created = {
      ...form,
      id: editingTemplate?.id || `template-${Date.now()}`,
      title: form.title.trim(),
      description: form.description.trim(),
      areaName: area?.name || form.areaId,
      estimatedMinutes: Number(form.estimatedMinutes) || 0,
      requiredPeople: Math.max(1, Number(form.requiredPeople) || 1),
      toolsNeeded: listFromText(form.toolsNeeded),
      materialsNeeded: listFromText(form.materialsNeeded),
      checklistItems: listFromText(form.checklistItems).map((text, index) => ({ id: `new-step-${index}`, text })),
      createdBy: editingTemplate?.createdBy || currentUser.name,
      createdAt: editingTemplate?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    const updated = editingTemplate
      ? templates.map((template) => template.id === editingTemplate.id ? created : template)
      : [created, ...templates]
    setTemplates(updated)
    saveTaskTemplates(updated)
    setForm({ ...EMPTY_TEMPLATE, areaId: form.areaId })
    setMessage(editingTemplate ? "Tarea actualizada correctamente." : "Tarea estandarizada guardada en el banco.")
    if (editingTemplate) onFinished()
  }
  return (
    <form className="tasks-panel tasks-form" onSubmit={submit}>
      <div className="tasks-panel-title"><div><h2>{editingTemplate ? "Editar tarea estandarizada" : "Crear tarea nueva"}</h2><p className="tasks-muted">Define el procedimiento antes de asignarlo.</p></div></div>
      {message && <p className="tasks-success">{message}</p>}
      <div className="tasks-form-grid">
        <Field label="Nombre de tarea"><input required value={form.title} onChange={(event) => update("title", event.target.value)} /></Field>
        <Field label="Área"><select value={form.areaId} onChange={(event) => update("areaId", event.target.value)}>{areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}</select></Field>
        <Field label="Categoría"><select value={form.category} onChange={(event) => update("category", event.target.value)}>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
        <Field label="Prioridad"><OptionSelect options={TASK_PRIORITIES} value={form.priority} onChange={(value) => update("priority", value)} /></Field>
        <Field label="Dificultad"><OptionSelect options={TASK_DIFFICULTIES} value={form.difficulty} onChange={(value) => update("difficulty", value)} /></Field>
        <Field label="Tiempo estimado (min)"><input type="number" min="1" value={form.estimatedMinutes} onChange={(event) => update("estimatedMinutes", event.target.value)} /></Field>
        <Field label="Personas requeridas"><input type="number" min="1" value={form.requiredPeople} onChange={(event) => update("requiredPeople", event.target.value)} /></Field>
        <Field label="Rol recomendado"><input value={form.recommendedRole} onChange={(event) => update("recommendedRole", event.target.value)} /></Field>
        <Field label="Nivel requerido"><OptionSelect options={TASK_LEVELS} value={form.requiredSkillLevel} onChange={(value) => update("requiredSkillLevel", value)} /></Field>
        <Field label="Frecuencia"><OptionSelect options={TASK_RECURRENCES} value={form.recurrence} onChange={(value) => update("recurrence", value)} /></Field>
        <Field label="Horario recomendado"><input type="time" value={form.recommendedTimeBlock} onChange={(event) => update("recommendedTimeBlock", event.target.value)} /></Field>
        <Field label="Estado"><select value={form.active ? "active" : "inactive"} onChange={(event) => update("active", event.target.value === "active")}><option value="active">Activa</option><option value="inactive">Inactiva</option></select></Field>
      </div>
      <Field label="Descripción"><textarea required value={form.description} onChange={(event) => update("description", event.target.value)} /></Field>
      <div className="tasks-form-grid">
        <Field label="Herramientas necesarias (una por línea)"><textarea value={form.toolsNeeded} onChange={(event) => update("toolsNeeded", event.target.value)} /></Field>
        <Field label="Materiales necesarios (uno por línea)"><textarea value={form.materialsNeeded} onChange={(event) => update("materialsNeeded", event.target.value)} /></Field>
        <Field label="Checklist de pasos (uno por línea)"><textarea value={form.checklistItems} onChange={(event) => update("checklistItems", event.target.value)} /></Field>
        <Field label="SOP relacionado"><input value={form.sopLink} onChange={(event) => update("sopLink", event.target.value)} placeholder="Enlace o documento" /></Field>
      </div>
      <label className="tasks-checkbox"><input type="checkbox" checked={form.evidenceRequired} onChange={(event) => update("evidenceRequired", event.target.checked)} />Requiere evidencia para completar</label>
      <button className="tasks-primary" type="submit">{editingTemplate ? "Guardar cambios" : "Guardar tarea en banco"}</button>
    </form>
  )
}

function TaskAssignment({ templates, tasks, employees, areas, user, onAssigned }) {
  const [date, setDate] = useState(TODAY)
  const [areaId, setAreaId] = useState(templates[0]?.areaId || "cocina")
  const [shiftId, setShiftId] = useState(OPERATIONAL_SHIFTS[0].id)
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("")
  const [priority, setPriority] = useState("")
  const [difficulty, setDifficulty] = useState("")
  const [selected, setSelected] = useState([])
  const [selectedEmployees, setSelectedEmployees] = useState([])
  const [warnings, setWarnings] = useState([])
  const shift = OPERATIONAL_SHIFTS.find((item) => item.id === shiftId)
  const available = templates.filter((template) =>
    template.areaId === areaId &&
    (!query || template.title.toLowerCase().includes(query.toLowerCase())) &&
    (!category || template.category === category) &&
    (!priority || template.priority === priority) &&
    (!difficulty || template.difficulty === difficulty)
  )
  const selection = templates.filter((template) => selected.includes(template.id))
  const totalMinutes = selection.reduce((sum, template) => sum + Number(template.estimatedMinutes || 0), 0)
  const team = employees.filter((employee) => !areaId || employee.areaId === areaId || !employee.areaId)

  function toggle(templateId) {
    setSelected((current) => current.includes(templateId) ? current.filter((id) => id !== templateId) : [...current, templateId])
  }
  function automated() {
    if (!selection.length) return
    const result = assignTasksAutomatically(selection, employees, date, shift, areaId, tasks, user.name)
    createTaskNotifications(result.assignedTasks)
    onAssigned(result.assignedTasks)
    setWarnings(result.warnings)
    setSelected([])
  }
  function manual() {
    if (!selection.length || !selectedEmployees.length) {
      setWarnings(["Selecciona al menos una tarea y un colaborador para asignar manualmente."])
      return
    }
    const created = assignTasksManually(selection, selectedEmployees, date, shift, user.name)
    createTaskNotifications(created)
    onAssigned(created)
    setWarnings([])
    setSelected([])
  }
  return (
    <div className="tasks-assignment">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Asignar tareas</h2><p className="tasks-muted">Selecciona procedimientos y crea la jornada.</p></div></div>
        <div className="tasks-form-grid">
          <Field label="Fecha"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
          <Field label="Área"><select value={areaId} onChange={(event) => { setAreaId(event.target.value); setSelected([]) }}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
          <Field label="Turno"><select value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{OPERATIONAL_SHIFTS.map((item) => <option value={item.id} key={item.id}>{item.name} ({formatOperationalTime(item.start)})</option>)}</select></Field>
          <Field label="Buscar tarea"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nombre..." /></Field>
          <Field label="Categoría"><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">Todas</option>{TASK_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Prioridad"><FilterOption options={TASK_PRIORITIES} value={priority} onChange={setPriority} /></Field>
          <Field label="Dificultad"><FilterOption options={TASK_DIFFICULTIES} value={difficulty} onChange={setDifficulty} /></Field>
        </div>
        <div className="tasks-picker">
          {available.map((template) => (
            <label className={selected.includes(template.id) ? "selected" : ""} key={template.id}>
              <input type="checkbox" checked={selected.includes(template.id)} onChange={() => toggle(template.id)} />
              <div><strong>{template.title}</strong><small>{template.estimatedMinutes} min · {template.requiredPeople} persona(s)</small></div>
              <Badge type="priority" value={template.priority} />
            </label>
          ))}
          {!available.length && <Empty text="No hay tareas disponibles con estos filtros." />}
        </div>
      </article>
      <article className="tasks-panel tasks-assignment-summary">
        <h2>Plan de asignación</h2>
        <strong className="tasks-total">{selection.length} tareas · {totalMinutes} min</strong>
        <Field label="Asignación manual">
          <select multiple value={selectedEmployees} onChange={(event) => setSelectedEmployees([...event.target.selectedOptions].map((option) => option.value))}>
            {team.map((employee) => <option value={employee.taskId} key={employee.taskId}>{employee.name} · {employee.level}</option>)}
          </select>
        </Field>
        <p className="tasks-muted">Automática considera nivel, turno, área, carga existente y desempeño.</p>
        <button type="button" className="tasks-primary" onClick={automated}>Asignar automáticamente</button>
        <button type="button" className="tasks-secondary" onClick={manual}>Asignar manualmente</button>
        {warnings.map((warning) => <p className="tasks-warning" key={warning}>{warning}</p>)}
      </article>
    </div>
  )
}

function OperationalCalendar({ tasks, employees, areas }) {
  const [date, setDate] = useState(TODAY)
  const [area, setArea] = useState("")
  const [shift, setShift] = useState("")
  const shown = tasks.filter((task) => task.date === date && (!area || task.areaId === area) && (!shift || task.shiftId === shift)).sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart))
  return (
    <article className="tasks-panel">
      <div className="tasks-panel-title"><div><h2>Calendario operativo</h2><p className="tasks-muted">Mini schedule del día por turno y área.</p></div></div>
      <div className="tasks-filters">
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        <select value={area} onChange={(event) => setArea(event.target.value)}><option value="">Todas las áreas</option>{areas.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select value={shift} onChange={(event) => setShift(event.target.value)}><option value="">Todos los turnos</option>{OPERATIONAL_SHIFTS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </div>
      <div className="tasks-timeline">
        {shown.map((task) => (
          <article className={`tasks-timeline-row ${task.status}`} key={task.id}>
            <time>{formatOperationalTime(task.scheduledStart)}<small>{formatOperationalTime(task.scheduledEnd)}</small></time>
            <div><strong>{task.title}</strong><span>{task.areaName} · {task.estimatedMinutes} min</span></div>
            <span>{employeeNames(task.assignedTo, employees) || "Sin asignar"}</span>
            <Badge type="status" value={task.status} />
            <Badge type="priority" value={task.priority} />
          </article>
        ))}
        {!shown.length && <Empty text="No existen tareas calendarizadas para esta selección." />}
      </div>
    </article>
  )
}

function MyTasks({ tasks, user, allTasks, persistAllTasks }) {
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [notes, setNotes] = useState("")
  const taskNotifications = loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user))
  const notifications = taskNotifications.filter((notification) => !notification.read)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)
  function updateOwn(taskId, updater) {
    const updated = allTasks.map((task) => task.id === taskId ? updater(task) : task)
    persistAllTasks(updated)
  }
  function start(task) {
    updateOwn(task.id, (current) => ({ ...current, status: "in_progress" }))
  }
  function toggleChecklist(task, itemId) {
    updateOwn(task.id, (current) => ({ ...current, checklistItems: current.checklistItems.map((item) => item.id === itemId ? { ...item, completed: !item.completed } : item) }))
  }
  function attachEvidence(task, event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (loadEvent) => updateOwn(task.id, (current) => ({ ...current, evidenceFiles: [...(current.evidenceFiles || []), { name: file.name, data: loadEvent.target.result }] }))
    reader.readAsDataURL(file)
  }
  function complete(task) {
    if (task.checklistItems?.some((item) => !item.completed)) return window.alert("Completa todos los pasos del checklist antes de terminar.")
    if (task.evidenceRequired && !task.evidenceFiles?.length) return window.alert("Adjunta evidencia antes de completar esta tarea.")
    const completion = { ...task, status: "completed", completedAt: new Date().toISOString(), completionNotes: notes.trim() }
    updateOwn(task.id, () => completion)
    addTaskNotification(getCurrentUserTaskId(user), "task_completed", "Tarea completada", `Completaste: ${task.title}`, task.id)
    setNotes("")
    setSelectedTaskId("")
  }
  return (
    <div className="tasks-my-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Mis tareas</h2><p className="tasks-muted">{notifications.length} notificaciones nuevas</p></div></div>
        {taskNotifications.length > 0 && (
          <div className="tasks-notice-list">
            {taskNotifications.slice(0, 4).map((notification) => (
              <div className={notification.read ? "read" : ""} key={notification.id}>
                <strong>{notification.title}</strong>
                <span>{notification.message}</span>
              </div>
            ))}
          </div>
        )}
        <div className="tasks-status-columns">
          {["pending", "in_progress", "late", "completed"].map((status) => (
            <div key={status}>
              <h3><Badge type="status" value={status} /></h3>
              {tasks.filter((task) => task.status === status).map((task) => (
                <button type="button" className="tasks-own-card" key={task.id} onClick={() => { setSelectedTaskId(task.id); setNotes(task.completionNotes || "") }}>
                  <strong>{task.title}</strong><small>{task.date} · {task.areaName} · {task.estimatedMinutes} min</small><Badge type="priority" value={task.priority} />
                </button>
              ))}
            </div>
          ))}
        </div>
      </article>
      {selectedTask && (
        <article className="tasks-panel tasks-detail">
          <div className="tasks-panel-title"><h2>{selectedTask.title}</h2><button type="button" onClick={() => setSelectedTaskId("")}>Cerrar</button></div>
          <p>{selectedTask.description}</p>
          <div className="tasks-card-badges"><Badge type="status" value={selectedTask.status} /><Badge type="priority" value={selectedTask.priority} /></div>
          {selectedTask.status === "pending" && <button className="tasks-primary" type="button" onClick={() => start(selectedTask)}>Iniciar tarea</button>}
          <h3>Checklist</h3>
          {(selectedTask.checklistItems || []).map((item) => (
            <label className="tasks-check-item" key={item.id}><input type="checkbox" checked={item.completed} disabled={selectedTask.status === "completed"} onChange={() => toggleChecklist(selectedTask, item.id)} />{item.text}</label>
          ))}
          {selectedTask.evidenceRequired && (
            <div className="tasks-evidence">
              <strong>Evidencia requerida</strong>
              {selectedTask.status !== "completed" && <input type="file" accept="image/*" onChange={(event) => attachEvidence(selectedTask, event)} />}
              <div>{selectedTask.evidenceFiles?.map((file) => <img key={file.name} src={file.data} alt={file.name} />)}</div>
            </div>
          )}
          <Field label="Comentario final"><textarea disabled={selectedTask.status === "completed"} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          {!["completed", "cancelled"].includes(selectedTask.status) && <button className="tasks-primary" type="button" onClick={() => complete(selectedTask)}>He terminado mi tarea</button>}
        </article>
      )}
    </div>
  )
}

function ChecklistsModule({ user, initialRunId = "", initialChecklistView = "" }) {
  const userRole = normalizeRole(user?.role)
  const canViewChecklistLibrary = ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh", "supervisor"].includes(userRole)
  const canCreateChecklists = ["admin", "gerente_general"].includes(userRole)
  const canEditChecklistsDirectly = ["admin", "gerente_general"].includes(userRole)
  const canAssignChecklists = ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"].includes(userRole)
  const canApproveTemplateChanges = ["admin", "gerente_general"].includes(userRole)
  const isSupervisorOnly = userRole === "supervisor"
  const canDeleteTemplates = ["admin", "gerente_general"].includes(userRole)
  const [section, setSection] = useState(initialChecklistView === "incidents" ? "incidents" : "today")
  const [templates, setTemplates] = useState([])
  const [runs, setRuns] = useState([])
  const [incidents, setIncidents] = useState([])
  const [changeRequests, setChangeRequests] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState("")
  const [selectedIncidentId, setSelectedIncidentId] = useState(initialChecklistView === "incidents" ? initialRunId : "")
  const selectedRun = runs.find((run) => run.id === selectedRunId)
  const activeTemplates = templates.filter((template) => template.status === "active")
  const visibleRuns = runs.filter((run) => run.status !== "cancelled" && canSeeChecklistRun(run, user, profiles))
  const sections = [
    ["today", "Hoy"],
    ...(canViewChecklistLibrary ? [["templates", "Checklists"]] : []),
    ...(canCreateChecklists || editingTemplate ? [["create", editingTemplate ? "Editar checklist" : "Crear checklist"]] : []),
    ...(canViewChecklistLibrary ? [["incidents", "Incidencias"], ["approvals", "Aprobaciones"], ["reports", "Reportes"]] : [])
  ]

  async function refresh() {
    setLoading(true)
    if (canViewChecklistLibrary) await generateDueChecklistRuns(TODAY)
    const [templateResult, runResult, incidentResult, requestResult, suggestionResult, profileResult] = await Promise.all([
      getChecklistTemplates(),
      getChecklistRuns(),
      getChecklistIncidents(),
      getChecklistChangeRequests(),
      getChecklistTemplateSuggestions(),
      getChecklistProfiles()
    ])
    if (templateResult.error || runResult.error || incidentResult.error || requestResult.error || suggestionResult.error) {
      setMessage(templateResult.error?.message || runResult.error?.message || incidentResult.error?.message || requestResult.error?.message || suggestionResult.error?.message || "No se pudieron cargar checklists.")
    } else {
      setTemplates(templateResult.data || [])
      setRuns(markOverdueRuns(runResult.data || []))
      setIncidents(incidentResult.data || [])
      setChangeRequests(requestResult.data || [])
      setSuggestions(suggestionResult.data || [])
    }
    if (!profileResult.error) setProfiles(profileResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!initialRunId || initialChecklistView === "incidents") return
    setSection("today")
    setSelectedRunId(initialRunId)
  }, [initialRunId, initialChecklistView])

  useEffect(() => {
    if (initialChecklistView !== "approvals") return
    setSection("approvals")
  }, [initialChecklistView])

  useEffect(() => {
    if (initialChecklistView !== "incidents") return
    setSection("incidents")
    if (initialRunId) setSelectedIncidentId(initialRunId)
  }, [initialChecklistView, initialRunId])

  async function saveTemplate(form, items, options = {}) {
    if (!form.title.trim()) return setMessage("No se puede guardar una checklist sin titulo.")
    if (!items.some((item) => item.title.trim())) return setMessage("Agrega al menos 1 item.")
    setLoading(true)
    const cleanedItems = items.filter((item) => item.title.trim())
    if (isSupervisorOnly) {
      const payload = {
        ...form,
        template_id: editingTemplate?.id || null,
        request_type: editingTemplate?.id ? "update" : "create",
        status_after_approval: form.status || "active"
      }
      const draftResult = await createChecklistChangeRequest(payload, cleanedItems)
      if (draftResult.error) {
        setLoading(false)
        return setMessage(draftResult.error.message || "No se pudo guardar el borrador.")
      }
      if (options.submitForReview) {
        const submitResult = await submitChecklistChangeRequest(draftResult.data.id)
        setLoading(false)
        if (submitResult.error) return setMessage(submitResult.error.message || "No se pudo mandar a verificación.")
        setMessage("Solicitud enviada a verificación.")
      } else {
        setLoading(false)
        setMessage("Borrador guardado.")
      }
      setEditingTemplate(null)
      setSection("templates")
      refresh()
      return
    }

    const result = editingTemplate
      ? await updateChecklistTemplate(editingTemplate.id, form, cleanedItems)
      : await createChecklistTemplate(form, cleanedItems)
    setLoading(false)
    if (result.error) return setMessage(result.error.message || "No se pudo guardar la plantilla.")
    setMessage(editingTemplate ? "Checklist actualizada." : "Checklist creada.")
    setEditingTemplate(null)
    setSection("templates")
    refresh()
  }

  async function assignTemplate(payload) {
    if (!payload.template_id) return setMessage("Selecciona una plantilla.")
    setLoading(true)
    const result = await createChecklistRunFromTemplate(payload.template_id, payload)
    setLoading(false)
    if (result.error) return setMessage(result.error.message || "No se pudo asignar la checklist.")
    setMessage("Checklist asignada correctamente.")
    setSection("today")
    refresh()
  }

  async function assignToday(template) {
    await assignTemplate({
      template_id: template.id,
      run_date: TODAY,
      area: template.area || "",
      assigned_role: template.assigned_role || "",
      assigned_profile_id: template.assigned_profile_id || "",
      notes: "Asignada desde Plantillas"
    })
  }

  async function duplicateTemplate(template) {
    const result = await createChecklistTemplate(
      { ...template, title: `${template.title} (copia)`, status: "active" },
      template.checklist_template_items || []
    )
    if (result.error) return setMessage(result.error.message || "No se pudo duplicar la plantilla.")
    setMessage("Plantilla duplicada.")
    refresh()
  }

  async function deactivate(id) {
    const result = await deactivateChecklistTemplate(id)
    if (result.error) return setMessage(result.error.message || "No se pudo desactivar.")
    setMessage("Plantilla desactivada.")
    refresh()
  }

  async function removeTemplate(template) {
    const confirmed = window.confirm("¿Seguro que deseas eliminar esta checklist? Esta acción no se puede deshacer.")
    if (!confirmed) return

    const result = await deleteChecklistTemplate(template.id)
    if (result.error) return setMessage(result.error.message || "No se pudo eliminar la checklist.")

    if (result.mode === "deactivated") {
      setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, status: "inactive" } : item))
      setMessage("Esta checklist ya tiene historial. Se desactivará para conservar los reportes.")
      return
    }

    setTemplates((current) => current.filter((item) => item.id !== template.id))
    setMessage("Checklist eliminada.")
  }

  async function startRun(runId) {
    const result = await startChecklistRun(runId)
    if (result.error) return setMessage(result.error.message || "No se pudo iniciar la checklist.")
    setSelectedRunId(runId)
    refresh()
  }

  async function removeTemplateWithArchiveUX(template) {
    const hasHistory = runs.some((run) => run.template_id === template.id)
    const confirmationMessage = hasHistory
      ? "Esta checklist ya tiene historial. No se borrará definitivamente, se archivará para conservar reportes. ¿Deseas continuar?"
      : "¿Seguro que deseas eliminar esta checklist? Esta acción no se puede deshacer."
    const confirmed = window.confirm(confirmationMessage)
    if (!confirmed) return

    const result = await deleteChecklistTemplate(template.id)
    if (result.error) return setMessage(result.error.message || "No se pudo eliminar la checklist.")

    if (result.mode === "archived") {
      setTemplates((current) => current.map((item) => item.id === template.id ? { ...item, status: "inactive" } : item))
      setMessage("Checklist archivada. Se conserva el historial para reportes.")
      return
    }

    setTemplates((current) => current.filter((item) => item.id !== template.id))
    setMessage("Checklist eliminada.")
  }

  async function updateRunItem(itemId, payload) {
    const result = await updateChecklistRunItem(itemId, payload)
    if (result.error) {
      setMessage(result.error.message || "No se pudo guardar el progreso.")
      return result
    }
    setRuns((current) => current.map((run) => ({
      ...run,
      checklist_run_items: (run.checklist_run_items || []).map((item) => item.id === itemId ? { ...item, ...result.data } : item)
    })))
    return result
  }

  async function updateIncidentStatus(incidentId, status, notes = "") {
    const result = await updateChecklistIncidentStatus(incidentId, status, notes)
    if (result.error) return setMessage(result.error.message || "No se pudo actualizar la incidencia.")
    setMessage(status === "resolved" ? "Incidencia resuelta." : "Incidencia actualizada.")
    refresh()
  }

  async function completeRun(runId) {
    const result = await completeChecklistRun(runId)
    if (result.error) return setMessage(result.error.message || "Completa los items obligatorios antes de finalizar.")
    setMessage(result.data?.status === "pending_review" ? "Checklist enviada para revision." : "Checklist completada.")
    setSelectedRunId("")
    refresh()
  }

  async function approveRun(runId, notes = "") {
    const result = await approveChecklistRun(runId, notes)
    if (result.error) return setMessage(result.error.message || "No se pudo aprobar la checklist.")
    setMessage("Checklist aprobada.")
    setSelectedRunId("")
    refresh()
  }

  async function rejectRun(runId, notes = "") {
    if (!notes.trim()) return setMessage("La nota de rechazo es obligatoria.")
    const result = await rejectChecklistRun(runId, notes)
    if (result.error) return setMessage(result.error.message || "No se pudo rechazar la checklist.")
    setMessage("Checklist devuelta con comentario.")
    setSelectedRunId("")
    refresh()
  }

  return (
    <div className="checklists-module">
      <article className="checklists-hero">
        <div>
          <p className="tasks-eyebrow">Operacion diaria</p>
          <h2>Checklists</h2>
          <p className="tasks-muted">Haz lo que toca hoy, guarda evidencia y mide cumplimiento sin ruido.</p>
        </div>
        {loading && <span className="tasks-access-chip">Cargando</span>}
      </article>

      {message && <p className={message.includes("No ") || message.includes("Completa") ? "tasks-warning" : "tasks-success"}>{message}</p>}

      <nav className="checklists-main-tabs" aria-label="Checklists">
        {sections.map(([id, label]) => (
          <button key={id} type="button" className={section === id ? "active" : ""} onClick={() => { if (id === "create" && !editingTemplate) setEditingTemplate(null); setSection(id) }}>{label}</button>
        ))}
      </nav>

      {section === "today" && (
        <ChecklistToday
          runs={visibleRuns}
          profiles={profiles}
          selectedRun={selectedRun}
          onSelect={setSelectedRunId}
          onStart={startRun}
          onUpdateItem={updateRunItem}
          onComplete={completeRun}
          onApprove={approveRun}
          onReject={rejectRun}
          canApprove={canApproveTemplateChanges || userRole === "supervisor"}
        />
      )}
      {section === "templates" && canViewChecklistLibrary && (
        <ChecklistTemplatesView
          templates={templates}
          profiles={profiles}
          currentUser={user}
          userRole={userRole}
          onEdit={(template) => { setEditingTemplate(template); setSection("create") }}
          onAssign={assignTemplate}
          onAssignToday={assignToday}
          onDuplicate={duplicateTemplate}
          onDeactivate={deactivate}
          onDelete={removeTemplateWithArchiveUX}
          canDelete={canDeleteTemplates}
          canEdit={canEditChecklistsDirectly}
          canAssign={canAssignChecklists}
          canSuggest={isSupervisorOnly}
          onSuggest={async (payload) => {
            const result = await createChecklistTemplateSuggestion(payload)
            if (result.error) return setMessage(result.error.message || "No se pudo enviar la sugerencia.")
            setMessage("Sugerencia enviada a aprobacion.")
            refresh()
          }}
        />
      )}
      {section === "create" && (canCreateChecklists || editingTemplate) && (
        <ChecklistTemplateWizard
          editingTemplate={editingTemplate}
          profiles={profiles}
          onCancel={() => { setEditingTemplate(null); setSection("templates") }}
          onSave={saveTemplate}
          approvalMode={isSupervisorOnly}
        />
      )}
      {section === "incidents" && canViewChecklistLibrary && (
        <ChecklistIncidentsView
          incidents={incidents}
          profiles={profiles}
          selectedIncidentId={selectedIncidentId}
          userRole={userRole}
          onSelect={setSelectedIncidentId}
          onStatus={updateIncidentStatus}
        />
      )}
      {section === "approvals" && canViewChecklistLibrary && (
        <ChecklistApprovalsCenter
          requests={changeRequests}
          runs={runs}
          suggestions={suggestions}
          templates={templates}
          profiles={profiles}
          initialRequestId={initialChecklistView === "approvals" ? initialRunId : ""}
          onApprove={async (request, notes) => {
            const result = await approveChecklistChangeRequest(request.id, notes)
            if (result.error) return setMessage(result.error.message || "No se pudo aprobar la solicitud.")
            setMessage("Checklist aprobada y publicada.")
            refresh()
          }}
          onReject={async (request, notes) => {
            if (!notes.trim()) return setMessage("La nota de rechazo es obligatoria.")
            const result = await rejectChecklistChangeRequest(request.id, notes)
            if (result.error) return setMessage(result.error.message || "No se pudo rechazar la solicitud.")
            setMessage("Solicitud rechazada.")
            refresh()
          }}
          onApproveRun={approveRun}
          onRejectRun={rejectRun}
          onUpdateSuggestion={async (suggestion, status, notes = "") => {
            const result = await updateChecklistTemplateSuggestionStatus(suggestion.id, status, notes)
            if (result.error) return setMessage(result.error.message || "No se pudo actualizar la sugerencia.")
            setMessage("Sugerencia actualizada.")
            refresh()
          }}
          onEditTemplate={(templateId) => {
            const template = templates.find((item) => item.id === templateId)
            if (!template) return setMessage("Checklist no encontrada.")
            setEditingTemplate(template)
            setSection("create")
          }}
          canApprove={canApproveTemplateChanges}
          canApproveRuns={canApproveTemplateChanges || isSupervisorOnly}
        />
      )}
      {section === "reports" && canViewChecklistLibrary && <ChecklistReports runs={runs} templates={templates} profiles={profiles} />}
    </div>
  )
}

function ChecklistToday({ runs, profiles, selectedRun, onSelect, onStart, onUpdateItem, onComplete, onApprove, onReject, canApprove }) {
  const todayRuns = runs.filter((run) => run.run_date === TODAY || ["overdue", "pending_review", "rejected"].includes(run.status))
  const pending = todayRuns.filter((run) => run.status === "pending")
  const inProgress = todayRuns.filter((run) => run.status === "in_progress")
  const review = todayRuns.filter((run) => run.status === "pending_review")
  const completed = todayRuns.filter((run) => run.status === "completed")
  const overdue = todayRuns.filter((run) => run.status === "overdue")
  const completion = todayRuns.length ? Math.round((completed.length / todayRuns.length) * 100) : 0
  const cards = [
    ["Pendientes hoy", pending.length, "pending"],
    ["En progreso", inProgress.length, "in_progress"],
    ["En revision", review.length, "pending_review"],
    ["Completadas", completed.length, "completed"],
    ["Atrasadas", overdue.length, "overdue"],
  ]
  return (
    <div className="checklists-today">
      <div className="checklists-kpis">
        {cards.map(([label, value, tone]) => <article className={`checklists-kpi ${tone}`} key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      {selectedRun ? (
        <ChecklistGuidedRun run={selectedRun} profiles={profiles} onClose={() => onSelect("")} onUpdateItem={onUpdateItem} onComplete={onComplete} onApprove={onApprove} onReject={onReject} canApprove={canApprove} />
      ) : (
        <div className="checklists-card-grid">
          {todayRuns.map((run) => <ChecklistTodayCard key={run.id} run={run} profiles={profiles} onOpen={() => ["pending", "rejected"].includes(run.status) ? onStart(run.id) : onSelect(run.id)} />)}
          {!todayRuns.length && <FriendlyEmpty title="No hay checklists pendientes para hoy." text="Cuando gerencia asigne una checklist, aparecera aqui lista para iniciar." />}
        </div>
      )}
    </div>
  )
}

function ChecklistTodayCard({ run, profiles, onOpen }) {
  const progress = checklistRunProgress(run)
  const completedItems = (run.checklist_run_items || []).filter(itemHasAnswer).length
  const totalItems = run.checklist_run_items?.length || 0
  return (
    <article className="checklist-today-card">
      <div className="checklist-card-top">
        <div>
          <h3>{run.checklist_templates?.title || "Checklist"}</h3>
          <p>{run.area || "Sin area"} · {responsibleLabel(run, profiles)}</p>
        </div>
        <Badge type="status" value={run.status} />
      </div>
      <div className="checklist-progress-row">
        <progress value={progress} max="100" />
        <strong>{progress}%</strong>
      </div>
      <div className="checklist-card-meta">
        <span>{completedItems} / {totalItems} items</span>
        <span>Rol: {run.assigned_role || "Sin rol"}</span>
        <span>Hora limite: {run.due_time || "Sin hora"}</span>
      </div>
      <button type="button" className="checklist-primary-action" onClick={onOpen}>{run.status === "pending" ? "Iniciar checklist" : "Ver checklist"}</button>
    </article>
  )
}

function ChecklistTemplatesView({ templates, profiles, currentUser, userRole, onEdit, onAssign, onAssignToday, onDuplicate, onDeactivate, onDelete, canDelete, canEdit, canAssign, canSuggest, onSuggest }) {
  const [filters, setFilters] = useState({ area: "", frequency: "", status: "active" })
  const [assigning, setAssigning] = useState(null)
  const [suggesting, setSuggesting] = useState(null)
  const filtered = templates.filter((template) =>
    (!filters.area || template.area === filters.area) &&
    (!filters.frequency || template.frequency === filters.frequency) &&
    (filters.status === "all" || template.status === filters.status) &&
    (!canSuggest || !currentUser?.area_name || template.area === currentUser.area_name)
  )
  return (
    <div className="checklists-admin-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Checklists</h2><p className="tasks-muted">Biblioteca permanente de checklists operativas.</p></div></div>
        <div className="tasks-filters">
          <select value={filters.area} onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}><option value="">Todas las areas</option>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select>
          <select value={filters.frequency} onChange={(event) => setFilters((current) => ({ ...current, frequency: event.target.value }))}><option value="">Todas las frecuencias</option>{CHECKLIST_FREQUENCIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="active">Activas</option><option value="inactive">Inactivas / Archivadas</option><option value="all">Todas</option></select>
        </div>
      </article>
      <div className="checklists-card-grid">
        {filtered.map((template) => (
          <article className="checklist-template-card" key={template.id}>
            <div className="checklist-card-top"><div><h3>{template.title}</h3><p>{template.area || "Todas las areas"} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, template.frequency)}</p></div><span className="tasks-badge">{template.status === "active" ? "Activa" : "Inactiva"}</span></div>
            <p>{template.description || "Sin descripcion"}</p>
            <div className="checklist-card-meta"><span>{template.checklist_template_items?.length || 0} items</span><span>{friendlyChecklistLabel(CHECKLIST_CONTEXTS, template.shift_context)}</span><span>{template.assigned_role || "Rol libre"}</span><span>{profileDisplayName(profiles, template.assigned_profile_id) || "Sin responsable"}</span></div>
            <div className="checklist-actions">
              {canEdit && <button type="button" className="tasks-secondary" onClick={() => onEdit(template)}>Editar</button>}
              {canSuggest && <button type="button" className="tasks-secondary" onClick={() => setSuggesting(template)}>Sugerir cambios</button>}
              {canAssign && <button type="button" className="tasks-secondary" onClick={() => setAssigning(template)}>Asignar</button>}
              {canEdit && <button type="button" className="tasks-secondary" onClick={() => onDuplicate(template)}>Duplicar</button>}
              {canAssign && <button type="button" className="tasks-secondary" onClick={() => onAssignToday(template)}>Asignar hoy</button>}
              {canEdit && template.status === "active" && <button type="button" className="tasks-link danger" onClick={() => onDeactivate(template.id)}>Desactivar</button>}
              {canDelete && <button type="button" className="tasks-link danger" onClick={() => onDelete(template)}>Eliminar</button>}
            </div>
          </article>
        ))}
        {!filtered.length && <FriendlyEmpty title="Crea tu primera plantilla de apertura." text="Usa Crear plantilla para definir pasos simples por area." />}
      </div>
      {assigning && <ChecklistAssignPanel template={assigning} profiles={profiles} onClose={() => setAssigning(null)} onAssign={(payload) => { onAssign(payload); setAssigning(null) }} />}
      {suggesting && <ChecklistSuggestionPanel template={suggesting} currentUser={currentUser} onClose={() => setSuggesting(null)} onSubmit={(payload) => { onSuggest(payload); setSuggesting(null) }} />}
    </div>
  )
}

function ChecklistAssignPanel({ template, profiles, onClose, onAssign }) {
  const [form, setForm] = useState({ template_id: template.id, run_date: TODAY, area: template.area || "", assigned_profile_id: template.assigned_profile_id || "", assigned_role: template.assigned_role || "", notes: "" })
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  return (
    <article className="tasks-panel checklist-assign-panel">
      <div className="tasks-panel-title"><div><h2>Asignar checklist</h2><p className="tasks-muted">{template.title}</p></div><button type="button" onClick={onClose}>Cerrar</button></div>
      <div className="tasks-form-grid">
        <Field label="Fecha"><input type="date" value={form.run_date} onChange={(event) => update("run_date", event.target.value)} /></Field>
        <Field label="Area"><select value={form.area} onChange={(event) => update("area", event.target.value)}>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select></Field>
        <Field label="Rol/Puesto"><select value={form.assigned_role} onChange={(event) => update("assigned_role", event.target.value)}><option value="">Rol libre</option>{CHECKLIST_ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field>
        <Field label="Colaborador"><select value={form.assigned_profile_id} onChange={(event) => update("assigned_profile_id", event.target.value)}><option value="">Sin colaborador especifico</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field>
      </div>
      <Field label="Observacion"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
      <button type="button" className="tasks-primary" onClick={() => onAssign(form)}>Asignar</button>
    </article>
  )
}

function ChecklistSuggestionPanel({ template, currentUser, onClose, onSubmit }) {
  const [form, setForm] = useState({
    template_id: template.id,
    area: template.area || currentUser?.area_name || "",
    change_type: "add_item",
    description: "",
    justification: "",
    priority: "medium",
    evidence_url: ""
  })
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  function submit() {
    if (!form.description.trim() || !form.justification.trim()) return
    onSubmit(form)
  }
  return (
    <article className="tasks-panel checklist-assign-panel">
      <div className="tasks-panel-title"><div><h2>Sugerir cambios</h2><p className="tasks-muted">{template.title} · {template.area || "Sin area"}</p></div><button type="button" onClick={onClose}>Cerrar</button></div>
      <div className="tasks-form-grid">
        <Field label="Tipo de cambio"><select value={form.change_type} onChange={(event) => update("change_type", event.target.value)}>{CHECKLIST_SUGGESTION_TYPES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field>
        <Field label="Prioridad"><select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></Field>
      </div>
      <Field label="Descripcion del cambio"><textarea value={form.description} onChange={(event) => update("description", event.target.value)} /></Field>
      <Field label="Justificacion operativa"><textarea value={form.justification} onChange={(event) => update("justification", event.target.value)} /></Field>
      <Field label="Evidencia opcional"><input type="file" accept="image/*,.pdf" onChange={(event) => readEvidenceFile(event, (evidence_url) => update("evidence_url", evidence_url))} /></Field>
      <button type="button" className="tasks-primary" onClick={submit}>Enviar sugerencia</button>
    </article>
  )
}

function ChecklistTemplateWizard({ editingTemplate, profiles, onCancel, onSave, approvalMode = false }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(() => ({
    title: editingTemplate?.title || "",
    description: editingTemplate?.description || "",
    area: editingTemplate?.area || CHECKLIST_AREAS[0],
    assigned_role: editingTemplate?.assigned_role || "",
    assigned_profile_id: editingTemplate?.assigned_profile_id || "",
    supervisor_profile_id: editingTemplate?.supervisor_profile_id || "",
    backup_profile_id: editingTemplate?.backup_profile_id || "",
    frequency: editingTemplate?.frequency || "manual",
    shift_context: editingTemplate?.shift_context || "general",
    status: editingTemplate?.status || "active",
    reminder_time: editingTemplate?.reminder_time || "",
    due_time: editingTemplate?.due_time || "",
    recurrence_days: editingTemplate?.recurrence_days || [],
    recurrence_month_day: editingTemplate?.recurrence_month_day || "",
    recurrence_rule: editingTemplate?.recurrence_rule || "",
    skip_non_work_days: editingTemplate?.skip_non_work_days !== false,
    auto_generate: Boolean(editingTemplate?.auto_generate),
    requires_approval: editingTemplate?.requires_approval !== false
  }))
  const [items, setItems] = useState(() => editingTemplate?.checklist_template_items?.length ? editingTemplate.checklist_template_items : [emptyChecklistItem()])
  const steps = ["Informacion", "Items", "Asignacion", "Vista previa"]
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  function updateItem(index, field, value) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item))
  }
  function move(index, direction) {
    setItems((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }
  function duplicateItem(index) {
    setItems((current) => current.flatMap((item, itemIndex) => itemIndex === index ? [item, { ...item, id: `item-${Date.now()}-${index}`, title: `${item.title} copia` }] : [item]))
  }
  return (
    <article className="tasks-panel checklist-wizard">
      <div className="tasks-panel-title"><div><h2>{editingTemplate ? "Editar plantilla" : "Crear plantilla"}</h2><p className="tasks-muted">Paso {step} de 4 · {steps[step - 1]}</p></div><button type="button" onClick={onCancel}>Cancelar</button></div>
      <div className="checklist-stepper">{steps.map((label, index) => <button key={label} type="button" className={step === index + 1 ? "active" : ""} onClick={() => setStep(index + 1)}><span>{index + 1}</span>{label}</button>)}</div>
      {step === 1 && <div className="checklist-step-card"><div className="tasks-form-grid"><Field label="Nombre"><input required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Apertura FOH" /></Field><Field label="Area"><select value={form.area} onChange={(event) => update("area", event.target.value)}>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select></Field><Field label="Frecuencia"><select value={form.frequency} onChange={(event) => update("frequency", event.target.value)}>{CHECKLIST_FREQUENCIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field><Field label="Contexto"><select value={form.shift_context} onChange={(event) => update("shift_context", event.target.value)}>{CHECKLIST_CONTEXTS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field></div><Field label="Descripcion"><textarea value={form.description} onChange={(event) => update("description", event.target.value)} /></Field></div>}
      {step === 2 && <div className="checklist-builder">{items.map((item, index) => <ChecklistBuilderItem key={item.id || index} item={item} index={index} onUpdate={updateItem} onMove={move} onDuplicate={duplicateItem} onDelete={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}<button type="button" className="checklist-add-item" onClick={() => setItems((current) => [...current, emptyChecklistItem()])}>Agregar item</button></div>}
      {step === 3 && <div className="checklist-step-card"><div className="tasks-form-grid"><Field label="Area sugerida"><select value={form.area} onChange={(event) => update("area", event.target.value)}>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select></Field><Field label="Rol/Puesto sugerido"><select value={form.assigned_role} onChange={(event) => update("assigned_role", event.target.value)}><option value="">Cualquier rol</option>{CHECKLIST_ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field><Field label="Responsable permanente"><select value={form.assigned_profile_id} onChange={(event) => update("assigned_profile_id", event.target.value)}><option value="">Sin colaborador fijo</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field><Field label="Suplente"><select value={form.backup_profile_id} onChange={(event) => update("backup_profile_id", event.target.value)}><option value="">Sin suplente</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field><Field label="Supervisor aprobador"><select value={form.supervisor_profile_id} onChange={(event) => update("supervisor_profile_id", event.target.value)}><option value="">Gerencia / supervisor</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field><Field label="Recordatorio"><input type="time" value={form.reminder_time} onChange={(event) => update("reminder_time", event.target.value)} /></Field><Field label="Hora limite"><input type="time" value={form.due_time} onChange={(event) => update("due_time", event.target.value)} /></Field><Field label="Dia mensual"><input type="number" min="1" max="31" value={form.recurrence_month_day} onChange={(event) => update("recurrence_month_day", event.target.value)} /></Field></div><div className="checklist-flags"><label className="tasks-checkbox"><input type="checkbox" checked={form.auto_generate} onChange={(event) => update("auto_generate", event.target.checked)} />Generar automaticamente</label><label className="tasks-checkbox"><input type="checkbox" checked={form.skip_non_work_days} onChange={(event) => update("skip_non_work_days", event.target.checked)} />Excluir dias de descanso</label><label className="tasks-checkbox"><input type="checkbox" checked={form.requires_approval} onChange={(event) => update("requires_approval", event.target.checked)} />Requiere aprobacion</label></div><div className="checklist-weekdays">{CHECKLIST_WEEKDAYS.map(([day, label]) => <label key={day} className="tasks-checkbox"><input type="checkbox" checked={(form.recurrence_days || []).includes(day)} onChange={() => toggleRecurrenceDay(day)} />{label}</label>)}</div><Field label="RRULE personalizada"><input value={form.recurrence_rule} onChange={(event) => update("recurrence_rule", event.target.value)} placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR" /></Field></div>}
      {step === 4 && <ChecklistTemplatePreview form={form} items={items} profiles={profiles} />}
      <div className="checklist-wizard-actions">
        <button type="button" className="tasks-secondary" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>Anterior</button>
        {step < 4 ? (
          <button type="button" className="tasks-primary" onClick={() => setStep((current) => Math.min(4, current + 1))}>Siguiente</button>
        ) : approvalMode ? (
          <>
            <button type="button" className="tasks-secondary" onClick={() => onSave(form, items, { submitForReview: false })}>Guardar borrador</button>
            <button type="button" className="tasks-primary" onClick={() => onSave(form, items, { submitForReview: true })}>Mandar a verificación</button>
          </>
        ) : (
          <button type="button" className="tasks-primary" onClick={() => onSave(form, items)}>Guardar plantilla</button>
        )}
      </div>
    </article>
  )
}

function ChecklistBuilderItem({ item, index, onUpdate, onMove, onDuplicate, onDelete }) {
  const [advanced, setAdvanced] = useState(false)
  function toggleNotifyRole(role) {
    const current = Array.isArray(item.notify_roles) ? item.notify_roles : ["admin", "gerente_general", "gerente"]
    const next = current.includes(role) ? current.filter((value) => value !== role) : [...current, role]
    onUpdate(index, "notify_roles", next.length ? next : ["admin"])
  }
  return (
    <article className="checklist-builder-item">
      <div className="tasks-form-grid">
        <Field label={`Item ${index + 1}`}><input value={item.title} onChange={(event) => onUpdate(index, "title", event.target.value)} placeholder="Revisar estacion limpia" /></Field>
        <Field label="Tipo"><select value={item.response_type} onChange={(event) => onUpdate(index, "response_type", event.target.value)}>{CHECKLIST_RESPONSE_TYPES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field>
        <label className="tasks-checkbox checklist-touch-toggle"><input type="checkbox" checked={item.is_required !== false} onChange={(event) => onUpdate(index, "is_required", event.target.checked)} />Obligatorio</label>
      </div>
      <div className="checklist-actions compact"><button type="button" className="tasks-link" onClick={() => setAdvanced((current) => !current)}>{advanced ? "Ocultar avanzado" : "Avanzado"}</button><button type="button" className="tasks-link" onClick={() => onDuplicate(index)}>Duplicar</button><button type="button" className="tasks-link" onClick={() => onMove(index, -1)}>Subir</button><button type="button" className="tasks-link" onClick={() => onMove(index, 1)}>Bajar</button><button type="button" className="tasks-link danger" onClick={onDelete}>Eliminar</button></div>
      {advanced && (
        <div className="checklist-advanced">
          <div className="checklist-flags">
            <label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.requires_photo)} onChange={(event) => onUpdate(index, "requires_photo", event.target.checked)} />Requiere foto</label>
            <label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.requires_comment)} onChange={(event) => onUpdate(index, "requires_comment", event.target.checked)} />Requiere comentario</label>
            <label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.require_comment_on_no)} onChange={(event) => onUpdate(index, "require_comment_on_no", event.target.checked)} />Si responde No, comentario obligatorio</label>
            <label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.require_photo_on_no)} onChange={(event) => onUpdate(index, "require_photo_on_no", event.target.checked)} />Si responde No, foto obligatoria</label>
          </div>
          <div className="tasks-form-grid">
            <Field label="Seccion"><input value={item.section || item.rule_config?.section || ""} onChange={(event) => onUpdate(index, "section", event.target.value)} placeholder="Baños, Salon, Barra..." /></Field>
            <Field label="Puntos"><input type="number" min="0" value={item.score_points} onChange={(event) => onUpdate(index, "score_points", event.target.value)} /></Field>
            <Field label="Descripcion"><textarea value={item.description || ""} onChange={(event) => onUpdate(index, "description", event.target.value)} /></Field>
            <Field label="Opciones (una por linea)"><textarea value={Array.isArray(item.options) ? item.options.join("\n") : item.options || ""} onChange={(event) => onUpdate(index, "options", event.target.value)} placeholder={"Operativo\nRequiere mantenimiento\nFuera de servicio"} /></Field>
          </div>
          <div className="checklist-incident-config">
            <strong>Incidencia automatica</strong>
            <div className="checklist-flags">
              <label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.triggers_incident || item.generate_incident_on_no)} onChange={(event) => { onUpdate(index, "triggers_incident", event.target.checked); onUpdate(index, "generate_incident_on_no", event.target.checked); if (event.target.checked && !item.expected_response) onUpdate(index, "expected_response", item.response_type === "checkbox" ? "checked" : "si") }} />Activar alerta si este item falla</label>
              <label className="tasks-checkbox"><input type="checkbox" disabled checked={Boolean(item.create_task_on_fail)} onChange={(event) => onUpdate(index, "create_task_on_fail", event.target.checked)} />Crear tarea correctiva automaticamente (Proximamente)</label>
            </div>
            <div className="tasks-form-grid">
              <Field label="Respuesta esperada">
                {item.response_type === "checkbox" ? (
                  <select value={item.expected_response || "checked"} onChange={(event) => onUpdate(index, "expected_response", event.target.value)}><option value="checked">Si / completado</option><option value="unchecked">No / sin marcar</option></select>
                ) : item.response_type === "select" ? (
                  <select value={item.expected_response || ""} onChange={(event) => onUpdate(index, "expected_response", event.target.value)}><option value="">Seleccionar</option>{(Array.isArray(item.options) ? item.options : String(item.options || "").split(/\n|,/).map((value) => value.trim()).filter(Boolean)).map((option) => <option value={option} key={option}>{option}</option>)}</select>
                ) : (
                  <input value={item.expected_response || ""} onChange={(event) => onUpdate(index, "expected_response", event.target.value)} placeholder={item.response_type === "yes_no" ? "si" : "Opcional"} />
                )}
              </Field>
              <Field label="Severidad"><select value={item.incident_severity || "medium"} onChange={(event) => onUpdate(index, "incident_severity", event.target.value)}>{CHECKLIST_INCIDENT_SEVERITIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field>
            </div>
            <div className="checklist-flags">{CHECKLIST_INCIDENT_NOTIFY_ROLES.map(([role, label]) => <label className="tasks-checkbox" key={role}><input type="checkbox" checked={(item.notify_roles || ["admin", "gerente_general", "gerente"]).includes(role)} onChange={() => toggleNotifyRole(role)} />{label}</label>)}</div>
          </div>
        </div>
      )}
    </article>
  )
}

function ChecklistTemplatePreview({ form, items, profiles }) {
  const assignee = profiles.find((profile) => profile.id === form.assigned_profile_id)
  return (
    <div className="checklist-preview">
      <article className="checklist-template-card"><div className="checklist-card-top"><div><h3>{form.title || "Nueva checklist"}</h3><p>{form.area} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, form.frequency)}</p></div><span className="tasks-badge">{friendlyChecklistLabel(CHECKLIST_CONTEXTS, form.shift_context)}</span></div><p>{form.description || "Sin descripcion"}</p><div className="checklist-card-meta"><span>{items.filter((item) => item.title.trim()).length} items</span><span>{form.assigned_role || "Cualquier rol"}</span><span>{assignee?.full_name || assignee?.username || "Sin colaborador fijo"}</span></div></article>
      <div className="checklist-preview-items">{items.filter((item) => item.title.trim()).map((item, index) => <div key={item.id || index}><strong>{index + 1}. {item.title}</strong><span>{friendlyResponseType(item.response_type)}{item.requires_photo ? " · foto" : ""}{item.requires_comment ? " · comentario" : ""}</span></div>)}</div>
    </div>
  )
}

function ChecklistGuidedRun({ run, profiles, onClose, onUpdateItem, onComplete, onApprove, onReject, canApprove }) {
  const progress = checklistRunProgress(run)
  const [reviewNotes, setReviewNotes] = useState("")
  const completedCount = (run.checklist_run_items || []).filter(itemHasAnswer).length
  const noCount = (run.checklist_run_items || []).filter((item) => String(item.response_text || "").toLowerCase() === "no").length
  const photoCount = (run.checklist_run_items || []).filter((item) => item.photo_url).length
  const canEdit = !["completed", "pending_review"].includes(run.status)
  const itemGroups = groupChecklistRunItems(run.checklist_run_items || [])
  return (
    <article className="checklist-guided">
      <div className="checklist-guided-header">
        <button type="button" className="tasks-link" onClick={onClose}>Volver</button>
        <div><h2>{run.checklist_templates?.title || "Checklist"}</h2><p>{run.area || "Sin area"} · {responsibleLabel(run, profiles)}</p></div>
        <Badge type="status" value={run.status} />
      </div>
      <div className="checklist-big-progress"><progress value={progress} max="100" /><strong>{completedCount} de {run.checklist_run_items?.length || 0} · {progress}%</strong></div>
      {run.status === "pending_review" && (
        <div className="checklist-review-summary">
          <strong>Resumen para supervisor</strong>
          <span>Cumplimiento: {progress}%</span>
          <span>Respuestas No: {noCount}</span>
          <span>Evidencias: {photoCount}</span>
        </div>
      )}
      <div className="checklist-guided-items">
        {itemGroups.map((group, groupIndex) => {
          const done = group.items.filter(({ item }) => itemHasAnswer(item)).length
          return (
            <details className="checklist-section" key={group.title} open={groupIndex === 0 || done < group.items.length}>
              <summary><strong>{group.title}</strong><span>{done} de {group.items.length}</span></summary>
              <div className="checklist-section-items">
                {group.items.map(({ item, index }) => <ChecklistRunItem key={item.id} item={item} index={index} disabled={!canEdit} onSave={(payload) => onUpdateItem(item.id, payload)} />)}
              </div>
            </details>
          )
        })}
      </div>
      {run.status === "pending_review" && canApprove && (
        <div className="checklist-sticky-actions review">
          <Field label="Comentario de revision"><textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Obligatorio si rechazas" /></Field>
          <div className="checklist-actions"><button type="button" className="tasks-primary" onClick={() => onApprove(run.id, reviewNotes)}>Aprobar</button><button type="button" className="tasks-secondary" onClick={() => onReject(run.id, reviewNotes)}>Rechazar y devolver</button></div>
        </div>
      )}
      {canEdit && <div className="checklist-sticky-actions"><button type="button" className="tasks-secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Guardar y continuar despues</button><button type="button" className="tasks-primary" onClick={() => onComplete(run.id)}>Enviar para revision</button></div>}
    </article>
  )
}

function ChecklistRunItem({ item, index = 0, disabled, onSave }) {
  const [draft, setDraft] = useState(() => ({ checked: item.checked, response_text: item.response_text || "", response_number: item.response_number ?? "", response_date: item.response_date || "", response_time: item.response_time || "", response_json: item.response_json || {}, photo_url: item.photo_url || "", comment: item.comment || "" }))
  const [saveStatus, setSaveStatus] = useState("")
  const saveTimerRef = useRef(null)
  const latestDraftRef = useRef(draft)

  useEffect(() => () => window.clearTimeout(saveTimerRef.current), [])

  async function save(next = latestDraftRef.current) {
    window.clearTimeout(saveTimerRef.current)
    setSaveStatus("saving")
    const result = await onSave(next)
    setSaveStatus(result?.error ? "error" : "saved")
    if (!result?.error) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = window.setTimeout(() => setSaveStatus(""), 1800)
    }
    return result
  }

  function scheduleSave(next) {
    window.clearTimeout(saveTimerRef.current)
    setSaveStatus("pending")
    saveTimerRef.current = window.setTimeout(() => save(next), 650)
  }

  function applyChange(field, value) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    latestDraftRef.current = next
    scheduleSave(next)
  }
  function toggleMulti(option) {
    const current = Array.isArray(draft.response_json?.selected) ? draft.response_json.selected : []
    const selected = current.includes(option) ? current.filter((item) => item !== option) : [...current, option]
    const next = { ...draft, response_json: { selected } }
    setDraft(next)
    save(next)
  }
  const options = Array.isArray(item.options) ? item.options : []
  const answeredNo = String(draft.response_text || "").toLowerCase() === "no"
  const incidentWillTrigger = checklistItemWouldFail(item, draft)
  const needsComment = item.requires_comment || (item.require_comment_on_no && answeredNo)
  const needsPhoto = item.response_type === "photo" || item.requires_photo || (item.require_photo_on_no && answeredNo)
  const needsIncidentComment = incidentWillTrigger && !draft.comment
  function saveCritical(next) {
    if (checklistItemWouldFail(item, next) && !String(next.comment || "").trim()) {
      setDraft(next)
      return
    }
    save(next)
  }
  return (
    <div className="checklist-run-item form-question">
      <div className="tasks-panel-title"><div><strong>{index + 1}. {item.title}</strong><p className="tasks-muted">{friendlyResponseType(item.response_type)} · {item.score_points} pts</p></div><span className={itemHasAnswer(draft) ? "checklist-answer-state done" : "checklist-answer-state"}>{saveStatus === "pending" ? "Pendiente" : saveStatus === "saving" ? "Guardando..." : saveStatus === "saved" ? "Guardado" : saveStatus === "error" ? "Error al guardar" : itemHasAnswer(draft) ? "Listo" : item.is_required ? "Obligatorio" : "Opcional"}</span></div>
      {incidentWillTrigger && <p className="tasks-warning">Esto generara una incidencia para gerencia.</p>}
      {item.response_type === "yes_no" && <div className="checklist-choice-row native"><label className={draft.response_text === "si" ? "selected" : ""}><input type="radio" disabled={disabled} checked={draft.response_text === "si"} onChange={() => { const next = { ...draft, response_text: "si", checked: true }; setDraft(next); saveCritical(next) }} />Si</label><label className={draft.response_text === "no" ? "selected danger" : ""}><input type="radio" disabled={disabled} checked={draft.response_text === "no"} onChange={() => { const next = { ...draft, response_text: "no", checked: false }; setDraft(next); saveCritical(next) }} />No</label></div>}
      {item.response_type === "checkbox" && <label className="checklist-inline-check"><input type="checkbox" disabled={disabled} checked={draft.checked} onChange={(event) => { const next = { ...draft, checked: event.target.checked }; setDraft(next); saveCritical(next) }} /><span>Completado</span></label>}
      {["short_text", "text", "signature"].includes(item.response_type) && <Field label={friendlyResponseType(item.response_type)}><input disabled={disabled} value={draft.response_text} onChange={(event) => applyChange("response_text", event.target.value)} onBlur={() => save()} /></Field>}
      {item.response_type === "long_text" && <Field label="Respuesta"><textarea disabled={disabled} value={draft.response_text} onChange={(event) => applyChange("response_text", event.target.value)} onBlur={() => save()} /></Field>}
      {item.response_type === "select" && <Field label="Seleccion"><select disabled={disabled} value={draft.response_text} onChange={(event) => { const next = { ...draft, response_text: event.target.value }; setDraft(next); saveCritical(next) }}><option value="">Seleccionar</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></Field>}
      {item.response_type === "multi_select" && <div className="checklist-option-grid">{options.map((option) => <label key={option} className="tasks-checkbox"><input disabled={disabled} type="checkbox" checked={(draft.response_json?.selected || []).includes(option)} onChange={() => toggleMulti(option)} />{option}</label>)}</div>}
      {["number", "temperature"].includes(item.response_type) && <Field label={item.response_type === "temperature" ? "Temperatura" : "Numero"}><input disabled={disabled} type="number" step="any" value={draft.response_number} onChange={(event) => applyChange("response_number", event.target.value)} onBlur={() => save()} /></Field>}
      {item.response_type === "date" && <Field label="Fecha"><input disabled={disabled} type="date" value={draft.response_date} onChange={(event) => applyChange("response_date", event.target.value)} onBlur={() => save()} /></Field>}
      {item.response_type === "time" && <Field label="Hora"><input disabled={disabled} type="time" value={draft.response_time} onChange={(event) => applyChange("response_time", event.target.value)} onBlur={() => save()} /></Field>}
      {item.response_type === "rating" && <div className="checklist-rating">{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" disabled={disabled} className={Number(draft.response_number) >= value ? "selected" : ""} onClick={() => { const next = { ...draft, response_number: value }; setDraft(next); save(next) }}>★</button>)}</div>}
      {item.response_type === "acknowledgement" && <label className="tasks-checkbox checklist-touch-toggle"><input disabled={disabled} type="checkbox" checked={draft.checked} onChange={(event) => { const next = { ...draft, checked: event.target.checked, response_text: event.target.checked ? "acepto" : "" }; setDraft(next); save(next) }} />He leido y comprendo este procedimiento</label>}
      {needsPhoto && <Field label="Fotografia / evidencia"><input disabled={disabled} type="file" accept="image/*" capture="environment" onChange={(event) => readEvidenceFile(event, (photo_url) => { const next = { ...draft, photo_url }; setDraft(next); save(next) })} />{draft.photo_url && <img className="checklist-evidence-preview" src={draft.photo_url} alt="Evidencia" />}</Field>}
      {(needsComment || incidentWillTrigger) && <Field label={incidentWillTrigger ? "Describe que esta pasando" : "Comentario"}><textarea disabled={disabled} value={draft.comment} onChange={(event) => { const next = { ...draft, comment: event.target.value }; setDraft(next); latestDraftRef.current = next; if (!checklistItemWouldFail(item, next) || next.comment.trim()) scheduleSave(next) }} onBlur={() => save()} /></Field>}
      {needsIncidentComment && <p className="tasks-warning">Agrega un comentario para guardar la incidencia.</p>}
    </div>
  )
}

function ChecklistIncidentsView({ incidents, profiles, selectedIncidentId, userRole, onSelect, onStatus }) {
  const [filter, setFilter] = useState("open")
  const [notes, setNotes] = useState("")
  const visible = incidents.filter((incident) => !filter || incident.status === filter)
  const selected = incidents.find((incident) => incident.id === selectedIncidentId) || visible[0]
  const canDismiss = ["admin", "gerente_general", "gerente"].includes(userRole)
  const openCount = incidents.filter((incident) => ["open", "acknowledged", "in_progress"].includes(incident.status)).length
  const criticalCount = incidents.filter((incident) => incident.severity === "critical" && incident.status !== "resolved" && incident.status !== "dismissed").length
  return (
    <div className="checklist-approvals-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Incidencias</h2><p className="tasks-muted">{openCount} abiertas · {criticalCount} criticas</p></div></div>
        <div className="tasks-filters">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">Todas</option>
            {CHECKLIST_INCIDENT_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div className="checklists-card-grid">
          {visible.map((incident) => (
            <button type="button" className={selected?.id === incident.id ? "checklist-approval-card selected" : "checklist-approval-card"} key={incident.id} onClick={() => { onSelect(incident.id); setNotes("") }}>
              <div className="tasks-card-badges"><Badge type="priority" value={incident.severity} /><Badge type="status" value={incident.status} /></div>
              <strong>{incident.title}</strong>
              <small>{incident.checklist_runs?.checklist_templates?.title || "Checklist"} · {incident.area || "Sin area"} · {profileDisplayName(profiles, incident.reported_by)}</small>
              <small>{new Date(incident.created_at).toLocaleString("es-GT")}</small>
            </button>
          ))}
          {!visible.length && <FriendlyEmpty title="No hay incidencias." text="Las alertas de checklists apareceran aqui." />}
        </div>
      </article>

      {selected && (
        <article className="tasks-panel checklist-approval-detail">
          <div className="tasks-panel-title"><div><h2>{selected.title}</h2><p className="tasks-muted">{selected.area || "Sin area"} · {new Date(selected.created_at).toLocaleString("es-GT")}</p></div><Badge type="priority" value={selected.severity} /></div>
          <div className="checklist-review-summary">
            <div><span>Estado</span><strong>{incidentStatusLabel(selected.status)}</strong></div>
            <div><span>Reportado por</span><strong>{profileDisplayName(profiles, selected.reported_by)}</strong></div>
            <div><span>Checklist</span><strong>{selected.checklist_runs?.checklist_templates?.title || "Checklist"}</strong></div>
            <div><span>Item</span><strong>{selected.checklist_run_items?.title || "Item"}</strong></div>
          </div>
          <p>{selected.description || "Sin descripcion adicional."}</p>
          {selected.checklist_run_items?.photo_url && <img className="checklist-evidence-preview" src={selected.checklist_run_items.photo_url} alt="Evidencia de incidencia" />}
          {selected.resolution_notes && <p className="tasks-success">{selected.resolution_notes}</p>}
          <Field label="Notas de resolucion"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          <div className="checklist-actions">
            <button type="button" className="tasks-secondary" onClick={() => onStatus(selected.id, "acknowledged", notes)}>Reconocer</button>
            <button type="button" className="tasks-secondary" onClick={() => onStatus(selected.id, "in_progress", notes)}>Marcar en proceso</button>
            <button type="button" className="tasks-primary" onClick={() => onStatus(selected.id, "resolved", notes)}>Resolver</button>
            {canDismiss && <button type="button" className="tasks-link danger" onClick={() => onStatus(selected.id, "dismissed", notes)}>Descartar</button>}
          </div>
        </article>
      )}
    </div>
  )
}

function ChecklistApprovalsCenter({ requests, runs, suggestions, templates, profiles, onApprove, onReject, onApproveRun, onRejectRun, onUpdateSuggestion, onEditTemplate, canApprove, canApproveRuns }) {
  const [notes, setNotes] = useState("")
  const pendingRuns = (runs || []).filter((run) => run.status === "pending_review")
  const pendingSuggestions = (suggestions || []).filter((suggestion) => ["pending", "approved"].includes(suggestion.status))
  const visibleRequests = (requests || []).filter((request) => canApprove || request.submitted_by)
  return (
    <div className="checklists-admin-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Aprobaciones</h2><p className="tasks-muted">Central de revision de ejecuciones y sugerencias.</p></div></div>
      </article>

      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Checklists completadas</h2><p className="tasks-muted">{pendingRuns.length} en revision</p></div></div>
        <div className="checklists-card-grid">
          {pendingRuns.map((run) => (
            <article className="checklist-approval-card" key={run.id}>
              <span className="tasks-badge status-pending_review">En revision</span>
              <strong>{run.checklist_templates?.title || "Checklist"}</strong>
              <small>{run.area || "Sin area"} · {responsibleLabel(run, profiles)} · {checklistRunProgress(run)}%</small>
              {canApproveRuns && <Field label="Nota"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Obligatoria si rechazas" /></Field>}
              {canApproveRuns && <div className="checklist-actions"><button type="button" className="tasks-primary" onClick={() => { onApproveRun(run.id, notes); setNotes("") }}>Aprobar</button><button type="button" className="tasks-secondary" onClick={() => { onRejectRun(run.id, notes); setNotes("") }}>Rechazar</button></div>}
            </article>
          ))}
          {!pendingRuns.length && <FriendlyEmpty title="No hay ejecuciones en revision." text="Cuando un colaborador envie una checklist, aparecera aqui." />}
        </div>
      </article>

      {canApprove && (
        <article className="tasks-panel">
          <div className="tasks-panel-title"><div><h2>Sugerencias de cambios</h2><p className="tasks-muted">{pendingSuggestions.length} abiertas</p></div></div>
          <div className="checklists-card-grid">
            {pendingSuggestions.map((suggestion) => (
              <article className="checklist-approval-card" key={suggestion.id}>
                <span className="tasks-badge">{suggestionStatusLabel(suggestion.status)}</span>
                <strong>{suggestion.checklist_templates?.title || templates.find((template) => template.id === suggestion.template_id)?.title || "Checklist"}</strong>
                <small>{friendlySuggestionType(suggestion.change_type)} · {profileDisplayName(profiles, suggestion.suggested_by)} · {new Date(suggestion.created_at).toLocaleDateString()}</small>
                <p>{suggestion.description}</p>
                <small>Justificacion: {suggestion.justification}</small>
                <small>Prioridad: {suggestion.priority}</small>
                <div className="checklist-actions">
                  {suggestion.status === "pending" && <button type="button" className="tasks-primary" onClick={() => onUpdateSuggestion(suggestion, "approved")}>Aprobar</button>}
                  {suggestion.status === "pending" && <button type="button" className="tasks-secondary" onClick={() => onUpdateSuggestion(suggestion, "rejected")}>Rechazar</button>}
                  {suggestion.status === "approved" && <button type="button" className="tasks-primary" onClick={() => onUpdateSuggestion(suggestion, "applied")}>Marcar aplicada</button>}
                  <button type="button" className="tasks-secondary" onClick={() => onEditTemplate(suggestion.template_id)}>Ir a editar checklist</button>
                </div>
              </article>
            ))}
            {!pendingSuggestions.length && <FriendlyEmpty title="No hay sugerencias abiertas." text="Las propuestas de supervisores apareceran aqui." />}
          </div>
        </article>
      )}

      {canApprove && (
        <article className="tasks-panel">
          <div className="tasks-panel-title"><div><h2>Cambios formales de plantilla</h2><p className="tasks-muted">Solicitudes enviadas a verificacion.</p></div></div>
          <div className="checklists-card-grid">
            {visibleRequests.map((request) => (
              <article className="checklist-approval-card" key={request.id}>
                <span className="tasks-badge">{approvalStatusLabel(request.status)}</span>
                <strong>{request.title}</strong>
                <small>{request.request_type} · {request.area || "Sin area"} · {profileDisplayName(profiles, request.submitted_by)}</small>
                {request.status === "pending_review" && <Field label="Nota de revision"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Obligatoria si rechazas" /></Field>}
                {request.status === "pending_review" && <div className="checklist-actions"><button type="button" className="tasks-primary" onClick={() => { onApprove(request, notes); setNotes("") }}>Aprobar</button><button type="button" className="tasks-secondary" onClick={() => { onReject(request, notes); setNotes("") }}>Rechazar</button></div>}
              </article>
            ))}
            {!visibleRequests.length && <FriendlyEmpty title="No hay cambios de plantilla." text="Las solicitudes formales apareceran aqui." />}
          </div>
        </article>
      )}
    </div>
  )
}

function ChecklistApprovals({ requests, templates, profiles, initialRequestId = "", onApprove, onReject, canApprove }) {
  const [selectedId, setSelectedId] = useState(initialRequestId || "")
  const [notes, setNotes] = useState("")
  const visible = requests.filter((request) => canApprove || request.submitted_by)
  const selected = visible.find((request) => request.id === selectedId) || visible.find((request) => request.status === "pending_review")
  const currentTemplate = selected?.template_id ? templates.find((template) => template.id === selected.template_id) : null

  useEffect(() => {
    if (initialRequestId) setSelectedId(initialRequestId)
  }, [initialRequestId])

  return (
    <div className="checklist-approvals-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Aprobaciones</h2><p className="tasks-muted">Cambios propuestos por supervisores antes de publicarse.</p></div></div>
        <div className="checklists-card-grid">
          {visible.map((request) => (
            <button type="button" className={selected?.id === request.id ? "checklist-approval-card selected" : "checklist-approval-card"} key={request.id} onClick={() => { setSelectedId(request.id); setNotes("") }}>
              <span className="tasks-badge">{approvalStatusLabel(request.status)}</span>
              <strong>{request.title}</strong>
              <small>{request.request_type} · {request.area || "Sin area"} · {profileDisplayName(profiles, request.submitted_by)}</small>
            </button>
          ))}
          {!visible.length && <FriendlyEmpty title="No hay solicitudes pendientes." text="Cuando un supervisor mande cambios a verificación aparecerán aquí." />}
        </div>
      </article>

      {selected && (
        <article className="tasks-panel checklist-approval-detail">
          <div className="tasks-panel-title"><div><h2>{selected.title}</h2><p className="tasks-muted">{approvalStatusLabel(selected.status)} · {selected.request_type}</p></div><span className="tasks-badge">{selected.area || "Sin area"}</span></div>
          <div className="checklist-compare-grid">
            <ChecklistVersionSummary title="Versión actual" template={currentTemplate} />
            <ChecklistRequestSummary title="Versión propuesta" request={selected} />
          </div>
          <div className="checklist-preview-items">
            {(selected.items_snapshot || []).map((item, index) => <div key={`${selected.id}-${index}`}><strong>{index + 1}. {item.title}</strong><span>{friendlyResponseType(item.response_type)}{item.requires_photo ? " · foto" : ""}{item.requires_comment ? " · comentario" : ""}</span></div>)}
          </div>
          {selected.review_notes && <p className="tasks-warning">{selected.review_notes}</p>}
          {canApprove && selected.status === "pending_review" && (
            <>
              <Field label="Nota de revisión"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Obligatoria si rechazas" /></Field>
              <div className="checklist-actions">
                <button type="button" className="tasks-primary" onClick={() => onApprove(selected, notes)}>Aprobar</button>
                <button type="button" className="tasks-secondary" onClick={() => onReject(selected, notes)}>Rechazar</button>
              </div>
            </>
          )}
        </article>
      )}
    </div>
  )
}

function ChecklistVersionSummary({ title, template }) {
  return (
    <div className="checklist-version-box">
      <strong>{title}</strong>
      {template ? (
        <>
          <span>{template.title}</span>
          <small>{template.area || "Sin area"} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, template.frequency)} · {template.checklist_template_items?.length || 0} items</small>
        </>
      ) : <small>Checklist nueva</small>}
    </div>
  )
}

function ChecklistRequestSummary({ title, request }) {
  return (
    <div className="checklist-version-box proposed">
      <strong>{title}</strong>
      <span>{request.title}</span>
      <small>{request.area || "Sin area"} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, request.frequency)} · {(request.items_snapshot || []).length} items</small>
    </div>
  )
}

function ChecklistReports({ runs, templates, profiles }) {
  const [filters, setFilters] = useState({ area: "", profile: "", template: "", status: "", date: "", minProgress: "" })
  const profileName = (id) => profiles.find((profile) => profile.id === id)?.full_name || id || "Sin colaborador"
  const filteredRuns = runs.filter((run) =>
    (!filters.area || run.area === filters.area) &&
    (!filters.profile || run.assigned_profile_id === filters.profile) &&
    (!filters.template || run.template_id === filters.template) &&
    (!filters.status || run.status === filters.status) &&
    (!filters.date || run.run_date === filters.date) &&
    (!filters.minProgress || checklistRunProgress(run) >= Number(filters.minProgress))
  )
  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }))
  }
  return (
    <div className="tasks-reports">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Filtros</h2><p className="tasks-muted">{filteredRuns.length} checklists encontradas</p></div></div>
        <div className="tasks-filters">
          <select value={filters.area} onChange={(event) => updateFilter("area", event.target.value)}><option value="">Todas las areas</option>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select>
          <select value={filters.profile} onChange={(event) => updateFilter("profile", event.target.value)}><option value="">Todos los responsables</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select>
          <select value={filters.template} onChange={(event) => updateFilter("template", event.target.value)}><option value="">Todas las checklists</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}</select>
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="in_progress">En progreso</option><option value="pending_review">En revision</option><option value="completed">Completadas</option><option value="overdue">Atrasadas</option></select>
          <input type="date" value={filters.date} onChange={(event) => updateFilter("date", event.target.value)} />
          <input type="number" min="0" max="100" value={filters.minProgress} onChange={(event) => updateFilter("minProgress", event.target.value)} placeholder="% minimo" />
        </div>
      </article>
      <ChecklistReportTable title="Cumplimiento por area" rows={groupChecklistCompliance(filteredRuns, (run) => run.area || "Sin area")} />
      <ChecklistReportTable title="Cumplimiento por colaborador" rows={groupChecklistCompliance(filteredRuns, (run) => profileName(run.assigned_profile_id))} />
      <ChecklistReportTable title="Cumplimiento por plantilla" rows={groupChecklistCompliance(filteredRuns, (run) => templates.find((template) => template.id === run.template_id)?.title || run.checklist_templates?.title || "Checklist")} />
      <article className="tasks-panel"><h2>Checklists atrasadas</h2>{filteredRuns.filter((run) => run.status === "overdue").map((run) => <CompactChecklistRun key={run.id} run={run} />)}{!filteredRuns.some((run) => run.status === "overdue") && <Empty text="No hay checklists atrasadas." />}</article>
    </div>
  )
}

function ChecklistReportTable({ title, rows }) {
  return (
    <article className="tasks-panel">
      <h2>{title}</h2>
      <div className="tasks-report-table checklist-report-table">
        <header><span>Nombre</span><span>Asignadas</span><span>Completadas</span><span>Atrasadas</span><span>Cumplimiento</span><span>Puntos</span></header>
        {rows.map((row) => <div key={row.label}><strong>{row.label}</strong><span>{row.assigned}</span><span>{row.completed}</span><span>{row.late}</span><span>{row.rate}%</span><span>{row.points}</span></div>)}
      </div>
    </article>
  )
}

function CompactChecklistRun({ run }) {
  return <div className="tasks-compact"><div><strong>{run.checklist_templates?.title || "Checklist"}</strong><span>{run.run_date} · {run.area || "Sin area"}</span></div><Badge type="status" value={run.status} /></div>
}

function emptyChecklistItem() {
  return { id: `item-${Date.now()}`, title: "", description: "", section: "", response_type: "yes_no", is_required: true, requires_photo: false, requires_comment: false, require_comment_on_no: false, require_photo_on_no: false, generate_incident_on_no: false, triggers_incident: false, expected_response: "si", incident_severity: "medium", notify_roles: ["admin", "gerente_general", "gerente"], create_task_on_fail: false, options: "", score_points: 1 }
}

function itemHasAnswer(item) {
  const jsonValue = item.response_json && Object.keys(item.response_json).length > 0
  return Boolean(item.checked || item.response_text || item.response_number != null || item.response_date || item.response_time || item.photo_url || jsonValue || item.completed_at)
}

function checklistItemWouldFail(item, draft) {
  if (!(item.triggers_incident || item.generate_incident_on_no)) return false
  const expected = String(item.expected_response || (item.generate_incident_on_no ? "si" : "")).trim().toLowerCase()
  const responseType = item.response_type || "checkbox"
  if (["checkbox", "acknowledgement"].includes(responseType)) {
    if (!expected || ["true", "checked", "si", "sí", "yes", "1"].includes(expected)) return !draft.checked
    if (["false", "unchecked", "no", "0"].includes(expected)) return Boolean(draft.checked)
  }
  if (responseType === "yes_no") return String(draft.response_text || "").trim().toLowerCase() !== (expected || "si")
  if (responseType === "select") return Boolean(expected) && String(draft.response_text || "").trim().toLowerCase() !== expected
  if (["number", "temperature"].includes(responseType)) return item.is_required && (draft.response_number === "" || draft.response_number == null)
  return Boolean(expected) && String(draft.response_text || "").trim().toLowerCase() !== expected
}

function checklistItemSection(item, index) {
  if (item.rule_config?.section) return item.rule_config.section
  if (item.section) return item.section
  const description = String(item.description || "")
  const match = description.match(/^(seccion|sección|section|categoria|categoría):\s*(.+)$/i)
  if (match) return match[2].trim()
  return `Bloque ${Math.floor(index / 10) + 1}`
}

function groupChecklistRunItems(items) {
  const groups = []
  items.forEach((item, index) => {
    const title = checklistItemSection(item, index)
    const current = groups.find((group) => group.title === title)
    if (current) current.items.push({ item, index })
    else groups.push({ title, items: [{ item, index }] })
  })
  return groups
}

function readEvidenceFile(event, callback) {
  const file = event.target.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => callback(String(reader.result || ""))
  reader.readAsDataURL(file)
}

function checklistRunProgress(run) {
  const items = run?.checklist_run_items || []
  if (!items.length) return run?.status === "completed" ? 100 : 0
  const done = items.filter(itemHasAnswer).length
  return Math.round((done / items.length) * 100)
}

function responsibleLabel(run, profiles) {
  const profile = profiles.find((item) => item.id === run.assigned_profile_id)
  if (profile) return profile.full_name || profile.username
  if (run.assigned_role) return run.assigned_role
  return "Equipo operativo"
}

function friendlyChecklistLabel(options, value) {
  return options.find(([id]) => id === value)?.[1] || value || "General"
}

function friendlyResponseType(value) {
  return friendlyChecklistLabel(CHECKLIST_RESPONSE_TYPES, value)
}

function approvalStatusLabel(value) {
  const labels = {
    draft: "Borrador",
    pending_review: "Pendiente de aprobación",
    approved: "Aprobado",
    rejected: "Rechazado",
    cancelled: "Cancelado"
  }
  return labels[value] || value
}

function friendlySuggestionType(value) {
  return friendlyChecklistLabel(CHECKLIST_SUGGESTION_TYPES, value)
}

function suggestionStatusLabel(value) {
  const labels = { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", applied: "Aplicada" }
  return labels[value] || value
}

function incidentStatusLabel(value) {
  return CHECKLIST_INCIDENT_STATUSES.find(([id]) => id === value)?.[1] || value
}

function canSeeChecklistRun(run, user, profiles) {
  const role = normalizeRole(user?.role)
  if (["admin", "gerente_general", "recursos_humanos", "rrhh"].includes(role)) return true
  if (run.assigned_profile_id === user?.id) return true
  if (role === "supervisor") {
    if (run.supervisor_profile_id === user?.id) return true
    if (run.assigned_role && normalizeRole(run.assigned_role) === role) return true
    const assigned = profiles.find((profile) => profile.id === run.assigned_profile_id)
    return Boolean(user?.area_name && assigned?.area_name === user.area_name)
  }
  return false
}

function profileDisplayName(profiles, profileId) {
  const profile = profiles.find((item) => item.id === profileId)
  return profile?.full_name || profile?.username || "Supervisor"
}

function markOverdueRuns(runs) {
  return runs.map((run) => run.run_date < TODAY && ["pending", "in_progress"].includes(run.status) ? { ...run, status: "overdue" } : run)
}

function groupChecklistCompliance(runs, getter) {
  const grouped = {}
  runs.forEach((run) => {
    const label = getter(run)
    if (!grouped[label]) grouped[label] = { label, assigned: 0, completed: 0, late: 0, points: 0 }
    grouped[label].assigned += 1
    if (run.status === "completed") grouped[label].completed += 1
    if (run.status === "overdue") grouped[label].late += 1
    grouped[label].points += Number(run.earned_points || 0)
  })
  return Object.values(grouped).map((row) => ({ ...row, rate: row.assigned ? Math.round((row.completed / row.assigned) * 100) : 0 })).sort((a, b) => b.assigned - a.assigned)
}

function TaskReports({ tasks, employees, areas }) {
  return (
    <div className="tasks-reports">
      <ReportTable title="Cumplimiento por colaborador" rows={employees.map((employee) => reportRow(tasks.filter((task) => task.assignedTo?.includes(employee.taskId)), employee.name))} />
      <ReportTable title="Cumplimiento por área" rows={areas.map((area) => reportRow(tasks.filter((task) => task.areaId === area.id), area.name))} />
      <ReportTable title="Cumplimiento por tipo" rows={TASK_CATEGORIES.map((category) => reportRow(tasks.filter((task) => task.category === category || task.title.includes(category)), category)).filter((row) => row.assigned)} />
    </div>
  )
}

function ReportTable({ title, rows }) {
  return (
    <article className="tasks-panel">
      <h2>{title}</h2>
      <div className="tasks-report-table">
        <header><span>Nombre</span><span>Asignadas</span><span>Completadas</span><span>Atrasadas</span><span>Cumplimiento</span><span>Minutos</span><span>Evidencia</span></header>
        {rows.map((row) => <div key={row.label}><strong>{row.label}</strong><span>{row.assigned}</span><span>{row.completed}</span><span>{row.late}</span><span>{row.rate}%</span><span>{row.minutes}</span><span>{row.evidence}%</span></div>)}
      </div>
    </article>
  )
}

function reportRow(tasks, label) {
  const completed = tasks.filter((task) => task.status === "completed").length
  const requiredEvidence = tasks.filter((task) => task.evidenceRequired && task.status === "completed")
  return { label, assigned: tasks.length, completed, late: tasks.filter((task) => task.status === "late").length, rate: tasks.length ? Math.round((completed / tasks.length) * 100) : 0, minutes: tasks.reduce((sum, task) => sum + Number(task.estimatedMinutes || 0), 0), evidence: requiredEvidence.length ? Math.round((requiredEvidence.filter((task) => task.evidenceFiles?.length).length / requiredEvidence.length) * 100) : 100 }
}

function groupCounts(items, getter) {
  const grouped = {}
  items.forEach((item) => { const name = getter(item); grouped[name] = (grouped[name] || 0) + 1 })
  return Object.entries(grouped).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
}

function groupMinutes(tasks, employees) {
  const totals = {}
  tasks.forEach((task) => task.assignedTo?.forEach((id) => { totals[id] = (totals[id] || 0) + Number(task.estimatedMinutes || 0) }))
  return Object.entries(totals).map(([id, minutes]) => ({ label: employeeNames([id], employees), minutes })).sort((a, b) => b.minutes - a.minutes)
}

function employeeNames(ids = [], employees) {
  return ids.map((id) => employees.find((employee) => employee.taskId === id)?.name || id).join(" + ")
}

function CompactTask({ task, employees }) {
  return <div className="tasks-compact"><div><strong>{task.title}</strong><span>{formatOperationalTime(task.scheduledStart)} · {employeeNames(task.assignedTo, employees) || "Sin asignar"}</span></div><Badge type="priority" value={task.priority} /></div>
}

function Badge({ type, value }) {
  const labels = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica", easy: "Fácil", hard: "Difícil", expert: "Experta", pending: "Pendiente", open: "Abierta", acknowledged: "Reconocida", in_progress: "En proceso", resolved: "Resuelta", dismissed: "Descartada", pending_review: "En revision", completed: "Completada", late: "Atrasada", overdue: "Atrasada", rejected: "Devuelta", cancelled: "Cancelada", review_required: "Requiere revisión" }
  return <span className={`tasks-badge ${type}-${value}`}>{labels[value] || value}</span>
}

function Field({ label, children }) {
  return <label className="tasks-field"><span>{label}</span>{children}</label>
}

function OptionSelect({ options, value, onChange }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
}

function FilterOption({ options, value, onChange }) {
  return <select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todas</option>{options.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}</select>
}

function Empty({ text }) {
  return <p className="tasks-empty">{text}</p>
}

function FriendlyEmpty({ title, text }) {
  return <div className="checklists-empty-card"><strong>{title}</strong><span>{text}</span></div>
}

function listFromText(text) {
  return String(text || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean)
}

function templateToForm(template) {
  return {
    ...EMPTY_TEMPLATE,
    ...template,
    toolsNeeded: (template.toolsNeeded || []).join("\n"),
    materialsNeeded: (template.materialsNeeded || []).join("\n"),
    checklistItems: (template.checklistItems || []).map((item) => item.text).join("\n")
  }
}

export default Tasks
