import { useEffect, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
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
  ["mine", "Mis tareas"],
  ["reports", "Reportes"]
]

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
  const requestedTab = params.get("view") || (isManager ? "dashboard" : "mine")
  const tab = isManager && ADMIN_TABS.some(([id]) => id === requestedTab) ? requestedTab : "mine"
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
  const labels = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica", easy: "Fácil", hard: "Difícil", expert: "Experta", pending: "Pendiente", in_progress: "En proceso", completed: "Completada", late: "Atrasada", cancelled: "Cancelada", review_required: "Requiere revisión" }
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
