import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import {
  completeChecklistRun,
  createChecklistRunFromTemplate,
  createChecklistTemplate,
  deactivateChecklistTemplate,
  getChecklistProfiles,
  getChecklistRuns,
  getChecklistTemplates,
  startChecklistRun,
  updateChecklistRunItem,
  updateChecklistTemplate
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
import "./Tasks.css"

const TODAY = new Date().toISOString().slice(0, 10)
const MANAGEMENT_ROLES = ["admin", "gerente", "gerente_general", "rrhh", "supervisor"]
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
const CHECKLIST_RESPONSE_TYPES = [["checkbox", "Si / No"], ["text", "Respuesta escrita"], ["number", "Numero"], ["temperature", "Temperatura"], ["photo", "Foto"], ["signature", "Firma"], ["select", "Seleccion"]]
const CHECKLIST_TEMPLATE_MANAGERS = ["admin", "gerente_general", "gerente", "supervisor"]

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
  const isManager = MANAGEMENT_ROLES.includes(user?.role)
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
  const canManageTemplates = CHECKLIST_TEMPLATE_MANAGERS.includes(user?.role)
  const [section, setSection] = useState(initialChecklistView === "run" ? "today" : "today")
  const [templates, setTemplates] = useState([])
  const [runs, setRuns] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState("")
  const selectedRun = runs.find((run) => run.id === selectedRunId)
  const activeTemplates = templates.filter((template) => template.status === "active")
  const visibleRuns = runs.filter((run) => run.status !== "cancelled")
  const sections = canManageTemplates
    ? [["today", "Hoy"], ["templates", "Plantillas"], ["create", editingTemplate ? "Editar" : "Crear plantilla"], ["reports", "Reportes"]]
    : [["today", "Hoy"]]

  async function refresh() {
    setLoading(true)
    const [templateResult, runResult, profileResult] = await Promise.all([
      getChecklistTemplates(),
      getChecklistRuns(),
      getChecklistProfiles()
    ])
    if (templateResult.error || runResult.error) {
      setMessage(templateResult.error?.message || runResult.error?.message || "No se pudieron cargar checklists.")
    } else {
      setTemplates(templateResult.data || [])
      setRuns(markOverdueRuns(runResult.data || []))
    }
    if (!profileResult.error) setProfiles(profileResult.data || [])
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!initialRunId) return
    setSection("today")
    setSelectedRunId(initialRunId)
  }, [initialRunId])

  async function saveTemplate(form, items) {
    if (!form.title.trim()) return setMessage("No se puede guardar una checklist sin titulo.")
    if (!items.some((item) => item.title.trim())) return setMessage("Agrega al menos 1 item.")
    setLoading(true)
    const cleanedItems = items.filter((item) => item.title.trim())
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

  async function startRun(runId) {
    const result = await startChecklistRun(runId)
    if (result.error) return setMessage(result.error.message || "No se pudo iniciar la checklist.")
    setSelectedRunId(runId)
    refresh()
  }

  async function updateRunItem(itemId, payload) {
    const result = await updateChecklistRunItem(itemId, payload)
    if (result.error) return setMessage(result.error.message || "No se pudo guardar el progreso.")
    refresh()
  }

  async function completeRun(runId) {
    const result = await completeChecklistRun(runId)
    if (result.error) return setMessage(result.error.message || "Completa los items obligatorios antes de finalizar.")
    setMessage("Checklist completada.")
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
        />
      )}
      {section === "templates" && canManageTemplates && (
        <ChecklistTemplatesView
          templates={templates}
          profiles={profiles}
          onEdit={(template) => { setEditingTemplate(template); setSection("create") }}
          onAssign={assignTemplate}
          onAssignToday={assignToday}
          onDuplicate={duplicateTemplate}
          onDeactivate={deactivate}
        />
      )}
      {section === "create" && canManageTemplates && (
        <ChecklistTemplateWizard
          editingTemplate={editingTemplate}
          profiles={profiles}
          onCancel={() => { setEditingTemplate(null); setSection("templates") }}
          onSave={saveTemplate}
        />
      )}
      {section === "reports" && canManageTemplates && <ChecklistReports runs={runs} templates={templates} profiles={profiles} />}
    </div>
  )
}

function ChecklistToday({ runs, profiles, selectedRun, onSelect, onStart, onUpdateItem, onComplete }) {
  const todayRuns = runs.filter((run) => run.run_date === TODAY || run.status === "overdue")
  const pending = todayRuns.filter((run) => run.status === "pending")
  const inProgress = todayRuns.filter((run) => run.status === "in_progress")
  const completed = todayRuns.filter((run) => run.status === "completed")
  const overdue = todayRuns.filter((run) => run.status === "overdue")
  const completion = todayRuns.length ? Math.round((completed.length / todayRuns.length) * 100) : 0
  const cards = [
    ["Pendientes hoy", pending.length, "pending"],
    ["En progreso", inProgress.length, "in_progress"],
    ["Completadas", completed.length, "completed"],
    ["Atrasadas", overdue.length, "overdue"],
    ["Cumplimiento", `${completion}%`, "completed"]
  ]
  return (
    <div className="checklists-today">
      <div className="checklists-kpis">
        {cards.map(([label, value, tone]) => <article className={`checklists-kpi ${tone}`} key={label}><span>{label}</span><strong>{value}</strong></article>)}
      </div>

      {selectedRun ? (
        <ChecklistGuidedRun run={selectedRun} profiles={profiles} onClose={() => onSelect("")} onUpdateItem={onUpdateItem} onComplete={onComplete} />
      ) : (
        <div className="checklists-card-grid">
          {todayRuns.map((run) => <ChecklistTodayCard key={run.id} run={run} profiles={profiles} onOpen={() => run.status === "pending" ? onStart(run.id) : onSelect(run.id)} />)}
          {!todayRuns.length && <FriendlyEmpty title="No hay checklists pendientes para hoy." text="Cuando gerencia asigne una checklist, aparecera aqui lista para iniciar." />}
        </div>
      )}
    </div>
  )
}

function ChecklistTodayCard({ run, profiles, onOpen }) {
  const progress = checklistRunProgress(run)
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
        <span>{run.checklist_run_items?.length || 0} items</span>
        <span>Hora limite: {run.due_time || "Sin hora"}</span>
      </div>
      <button type="button" className="checklist-primary-action" onClick={onOpen}>{run.status === "pending" ? "Iniciar" : run.status === "completed" ? "Ver" : "Continuar"}</button>
    </article>
  )
}

function ChecklistTemplatesView({ templates, profiles, onEdit, onAssign, onAssignToday, onDuplicate, onDeactivate }) {
  const [filters, setFilters] = useState({ area: "", frequency: "", status: "" })
  const [assigning, setAssigning] = useState(null)
  const filtered = templates.filter((template) =>
    (!filters.area || template.area === filters.area) &&
    (!filters.frequency || template.frequency === filters.frequency) &&
    (!filters.status || template.status === filters.status)
  )
  return (
    <div className="checklists-admin-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Plantillas</h2><p className="tasks-muted">Biblioteca operativa para apertura, cierre, limpieza e inventario.</p></div></div>
        <div className="tasks-filters">
          <select value={filters.area} onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}><option value="">Todas las areas</option>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select>
          <select value={filters.frequency} onChange={(event) => setFilters((current) => ({ ...current, frequency: event.target.value }))}><option value="">Todas las frecuencias</option>{CHECKLIST_FREQUENCIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}><option value="">Todos los estados</option><option value="active">Activa</option><option value="inactive">Inactiva</option></select>
        </div>
      </article>
      <div className="checklists-card-grid">
        {filtered.map((template) => (
          <article className="checklist-template-card" key={template.id}>
            <div className="checklist-card-top"><div><h3>{template.title}</h3><p>{template.area || "Todas las areas"} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, template.frequency)}</p></div><span className="tasks-badge">{template.status === "active" ? "Activa" : "Inactiva"}</span></div>
            <p>{template.description || "Sin descripcion"}</p>
            <div className="checklist-card-meta"><span>{template.checklist_template_items?.length || 0} items</span><span>{friendlyChecklistLabel(CHECKLIST_CONTEXTS, template.shift_context)}</span><span>{template.assigned_role || "Rol libre"}</span></div>
            <div className="checklist-actions">
              <button type="button" className="tasks-secondary" onClick={() => onEdit(template)}>Ver</button>
              <button type="button" className="tasks-secondary" onClick={() => onEdit(template)}>Editar</button>
              <button type="button" className="tasks-secondary" onClick={() => setAssigning(template)}>Asignar</button>
              <button type="button" className="tasks-secondary" onClick={() => onDuplicate(template)}>Duplicar</button>
              <button type="button" className="tasks-secondary" onClick={() => onAssignToday(template)}>Asignar hoy</button>
              <button type="button" className="tasks-secondary" disabled>Programar recurrencia: Proximamente</button>
              {template.status === "active" && <button type="button" className="tasks-link danger" onClick={() => onDeactivate(template.id)}>Desactivar</button>}
            </div>
          </article>
        ))}
        {!filtered.length && <FriendlyEmpty title="Crea tu primera plantilla de apertura." text="Usa Crear plantilla para definir pasos simples por area." />}
      </div>
      {assigning && <ChecklistAssignPanel template={assigning} profiles={profiles} onClose={() => setAssigning(null)} onAssign={(payload) => { onAssign(payload); setAssigning(null) }} />}
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

function ChecklistTemplateWizard({ editingTemplate, profiles, onCancel, onSave }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState(() => ({
    title: editingTemplate?.title || "",
    description: editingTemplate?.description || "",
    area: editingTemplate?.area || CHECKLIST_AREAS[0],
    assigned_role: editingTemplate?.assigned_role || "",
    assigned_profile_id: editingTemplate?.assigned_profile_id || "",
    frequency: editingTemplate?.frequency || "manual",
    shift_context: editingTemplate?.shift_context || "general",
    status: editingTemplate?.status || "active"
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
      {step === 3 && <div className="checklist-step-card"><div className="tasks-form-grid"><Field label="Area sugerida"><select value={form.area} onChange={(event) => update("area", event.target.value)}>{CHECKLIST_AREAS.map((area) => <option key={area}>{area}</option>)}</select></Field><Field label="Rol/Puesto sugerido"><select value={form.assigned_role} onChange={(event) => update("assigned_role", event.target.value)}><option value="">Cualquier rol</option>{CHECKLIST_ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field><Field label="Colaborador opcional"><select value={form.assigned_profile_id} onChange={(event) => update("assigned_profile_id", event.target.value)}><option value="">Sin colaborador fijo</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field></div></div>}
      {step === 4 && <ChecklistTemplatePreview form={form} items={items} profiles={profiles} />}
      <div className="checklist-wizard-actions"><button type="button" className="tasks-secondary" disabled={step === 1} onClick={() => setStep((current) => Math.max(1, current - 1))}>Anterior</button>{step < 4 ? <button type="button" className="tasks-primary" onClick={() => setStep((current) => Math.min(4, current + 1))}>Siguiente</button> : <button type="button" className="tasks-primary" onClick={() => onSave(form, items)}>Guardar plantilla</button>}</div>
    </article>
  )
}

function ChecklistBuilderItem({ item, index, onUpdate, onMove, onDuplicate, onDelete }) {
  const [advanced, setAdvanced] = useState(false)
  return (
    <article className="checklist-builder-item">
      <div className="tasks-form-grid">
        <Field label={`Item ${index + 1}`}><input value={item.title} onChange={(event) => onUpdate(index, "title", event.target.value)} placeholder="Revisar estacion limpia" /></Field>
        <Field label="Tipo"><select value={item.response_type} onChange={(event) => onUpdate(index, "response_type", event.target.value)}>{CHECKLIST_RESPONSE_TYPES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field>
        <label className="tasks-checkbox checklist-touch-toggle"><input type="checkbox" checked={item.is_required !== false} onChange={(event) => onUpdate(index, "is_required", event.target.checked)} />Obligatorio</label>
      </div>
      <div className="checklist-actions compact"><button type="button" className="tasks-link" onClick={() => setAdvanced((current) => !current)}>{advanced ? "Ocultar avanzado" : "Avanzado"}</button><button type="button" className="tasks-link" onClick={() => onDuplicate(index)}>Duplicar</button><button type="button" className="tasks-link" onClick={() => onMove(index, -1)}>Subir</button><button type="button" className="tasks-link" onClick={() => onMove(index, 1)}>Bajar</button><button type="button" className="tasks-link danger" onClick={onDelete}>Eliminar</button></div>
      {advanced && <div className="checklist-advanced"><div className="checklist-flags"><label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.requires_photo)} onChange={(event) => onUpdate(index, "requires_photo", event.target.checked)} />Requiere foto</label><label className="tasks-checkbox"><input type="checkbox" checked={Boolean(item.requires_comment)} onChange={(event) => onUpdate(index, "requires_comment", event.target.checked)} />Requiere comentario</label></div><div className="tasks-form-grid"><Field label="Puntos"><input type="number" min="0" value={item.score_points} onChange={(event) => onUpdate(index, "score_points", event.target.value)} /></Field><Field label="Descripcion"><textarea value={item.description || ""} onChange={(event) => onUpdate(index, "description", event.target.value)} /></Field></div></div>}
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

function ChecklistGuidedRun({ run, profiles, onClose, onUpdateItem, onComplete }) {
  const progress = checklistRunProgress(run)
  return (
    <article className="checklist-guided">
      <div className="checklist-guided-header">
        <button type="button" className="tasks-link" onClick={onClose}>Volver</button>
        <div><h2>{run.checklist_templates?.title || "Checklist"}</h2><p>{run.area || "Sin area"} · {responsibleLabel(run, profiles)}</p></div>
        <Badge type="status" value={run.status} />
      </div>
      <div className="checklist-big-progress"><progress value={progress} max="100" /><strong>{progress}%</strong></div>
      <div className="checklist-guided-items">{(run.checklist_run_items || []).map((item) => <ChecklistRunItem key={item.id} item={item} disabled={run.status === "completed"} onSave={(payload) => onUpdateItem(item.id, payload)} />)}</div>
      {run.status !== "completed" && <div className="checklist-sticky-actions"><button type="button" className="tasks-secondary" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Guardar progreso</button><button type="button" className="tasks-primary" onClick={() => onComplete(run.id)}>Completar checklist</button></div>}
    </article>
  )
}

function ChecklistRunItem({ item, disabled, onSave }) {
  const [draft, setDraft] = useState(() => ({ checked: item.checked, response_text: item.response_text || "", response_number: item.response_number ?? "", photo_url: item.photo_url || "", comment: item.comment || "" }))
  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }
  return (
    <div className="checklist-run-item">
      <div className="tasks-panel-title"><div><strong>{item.title}</strong><p className="tasks-muted">{friendlyResponseType(item.response_type)} · {item.score_points} pts</p></div>{item.is_required && <span className="tasks-badge">Obligatorio</span>}</div>
      {item.response_type === "checkbox" && <button type="button" disabled={disabled} className={draft.checked ? "checklist-complete-button done" : "checklist-complete-button"} onClick={() => update("checked", !draft.checked)}>{draft.checked ? "Item completado" : "Completar item"}</button>}
      {["text", "signature", "select"].includes(item.response_type) && <Field label={friendlyResponseType(item.response_type)}><input disabled={disabled} value={draft.response_text} onChange={(event) => update("response_text", event.target.value)} /></Field>}
      {["number", "temperature"].includes(item.response_type) && <Field label={item.response_type === "temperature" ? "Temperatura" : "Numero"}><input disabled={disabled} type="number" step="any" value={draft.response_number} onChange={(event) => update("response_number", event.target.value)} /></Field>}
      {(item.response_type === "photo" || item.requires_photo) && <Field label="Foto"><input disabled={disabled} value={draft.photo_url} onChange={(event) => update("photo_url", event.target.value)} placeholder="URL de foto o evidencia" /></Field>}
      {item.requires_comment && <Field label="Comentario"><textarea disabled={disabled} value={draft.comment} onChange={(event) => update("comment", event.target.value)} /></Field>}
      {!disabled && <button type="button" className="tasks-secondary" onClick={() => onSave(draft)}>Guardar item</button>}
    </div>
  )
}

function ChecklistReports({ runs, templates, profiles }) {
  const profileName = (id) => profiles.find((profile) => profile.id === id)?.full_name || id || "Sin colaborador"
  return (
    <div className="tasks-reports">
      <ChecklistReportTable title="Cumplimiento por area" rows={groupChecklistCompliance(runs, (run) => run.area || "Sin area")} />
      <ChecklistReportTable title="Cumplimiento por colaborador" rows={groupChecklistCompliance(runs, (run) => profileName(run.assigned_profile_id))} />
      <ChecklistReportTable title="Cumplimiento por plantilla" rows={groupChecklistCompliance(runs, (run) => templates.find((template) => template.id === run.template_id)?.title || run.checklist_templates?.title || "Checklist")} />
      <article className="tasks-panel"><h2>Checklists atrasadas</h2>{runs.filter((run) => run.status === "overdue").map((run) => <CompactChecklistRun key={run.id} run={run} />)}{!runs.some((run) => run.status === "overdue") && <Empty text="No hay checklists atrasadas." />}</article>
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
  return { id: `item-${Date.now()}`, title: "", description: "", response_type: "checkbox", is_required: true, requires_photo: false, requires_comment: false, score_points: 1 }
}

function checklistRunProgress(run) {
  const items = run?.checklist_run_items || []
  if (!items.length) return run?.status === "completed" ? 100 : 0
  const done = items.filter((item) => item.checked || item.response_text || item.response_number != null || item.photo_url || item.completed_at).length
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
  const labels = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica", easy: "Fácil", hard: "Difícil", expert: "Experta", pending: "Pendiente", in_progress: "En proceso", completed: "Completada", late: "Atrasada", overdue: "Atrasada", cancelled: "Cancelada", review_required: "Requiere revisión" }
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
