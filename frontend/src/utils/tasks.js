export const TASK_TEMPLATES_KEY = "taskTemplates"
export const ASSIGNED_TASKS_KEY = "assignedTasks"
export const TASK_NOTIFICATIONS_KEY = "notifications"

export const TASK_CATEGORIES = [
  "Apertura", "Cierre", "Limpieza", "Producción", "Mise en place", "Inventario",
  "Mantenimiento", "Calidad", "Servicio", "Caja", "Barra", "Cafetería",
  "Repostería", "Panadería", "Emergencia", "Recursos Humanos", "Capacitación"
]

export const TASK_PRIORITIES = [
  { id: "low", label: "Baja" },
  { id: "medium", label: "Media" },
  { id: "high", label: "Alta" },
  { id: "critical", label: "Crítica" }
]

export const TASK_DIFFICULTIES = [
  { id: "easy", label: "Fácil" },
  { id: "medium", label: "Media" },
  { id: "hard", label: "Difícil" },
  { id: "expert", label: "Experta" }
]

export const TASK_LEVELS = [
  { id: "junior", label: "Junior" },
  { id: "intermediate", label: "Intermedio" },
  { id: "senior", label: "Senior" },
  { id: "supervisor", label: "Supervisor" }
]

export const TASK_RECURRENCES = [
  { id: "none", label: "Sin recurrencia" },
  { id: "daily", label: "Diaria" },
  { id: "weekly", label: "Semanal" },
  { id: "monthly", label: "Mensual" },
  { id: "per_shift", label: "Por turno" },
  { id: "event_based", label: "Por evento" }
]

export const OPERATIONAL_SHIFTS = [
  { id: "opening", name: "Apertura", start: "08:00", end: "12:00" },
  { id: "day", name: "Día", start: "12:00", end: "17:00" },
  { id: "evening", name: "Tarde / cierre", start: "17:00", end: "23:00" }
]

const SEED_TASKS = [
  ["Revisar temperaturas", "cocina", "Cocina", "Calidad", "high", "medium", 20, true, ["Medir cámaras frías", "Registrar temperatura", "Reportar desviaciones"]],
  ["Preparar mise en place", "cocina", "Cocina", "Mise en place", "medium", "medium", 45, false, ["Preparar ingredientes", "Etiquetar recipientes"]],
  ["Limpiar mesa fría", "cocina", "Cocina", "Limpieza", "high", "medium", 30, true, ["Retirar insumos", "Desinfectar superficie", "Tomar foto final"]],
  ["Requisición de mozzarella", "cocina", "Cocina", "Inventario", "medium", "easy", 15, false, ["Validar existencia", "Enviar requisición"]],
  ["Cierre de cocina", "cocina", "Cocina", "Cierre", "high", "hard", 35, true, ["Apagar equipo", "Limpiar estaciones", "Validar cierre"]],
  ["Revisar hielo", "barra", "Barra", "Apertura", "medium", "easy", 10, false, ["Revisar nivel de hielo"]],
  ["Preparar garnishes", "barra", "Barra", "Producción", "medium", "medium", 25, false, ["Cortar garnish", "Etiquetar producción"]],
  ["Limpiar cristalería", "barra", "Barra", "Limpieza", "medium", "easy", 30, false, ["Lavar", "Pulir", "Ordenar"]],
  ["Revisión de licores", "barra", "Barra", "Inventario", "high", "medium", 25, false, ["Contar botellas", "Reportar faltantes"]],
  ["Calibrar molino", "cafeteria", "Cafetería", "Calidad", "high", "hard", 20, true, ["Pesar dosis", "Ajustar molienda", "Registrar resultado"]],
  ["Revisar leche", "cafeteria", "Cafetería", "Calidad", "medium", "easy", 10, false, ["Validar fechas", "Rotar producto"]],
  ["Limpieza de máquina espresso", "cafeteria", "Cafetería", "Limpieza", "high", "medium", 25, true, ["Purgar grupos", "Lavar accesorios", "Tomar evidencia"]],
  ["Revisar salones", "mesas", "Mesas", "Apertura", "medium", "easy", 15, false, ["Revisar montaje", "Corregir faltantes"]],
  ["Limpiar mesas", "mesas", "Mesas", "Limpieza", "medium", "easy", 25, false, ["Desinfectar mesas", "Ordenar sillas"]],
  ["Revisar baños", "mesas", "Mesas", "Servicio", "high", "easy", 15, true, ["Revisar limpieza", "Reponer consumibles"]],
  ["Reponer servilletas", "mesas", "Mesas", "Servicio", "low", "easy", 10, false, ["Reponer estaciones"]],
  ["Limpieza baños", "limpieza", "Limpieza", "Limpieza", "critical", "medium", 30, true, ["Colocar señalización", "Limpiar", "Desinfectar", "Adjuntar foto"]],
  ["Sacar basura", "limpieza", "Limpieza", "Cierre", "medium", "easy", 20, false, ["Clasificar residuos", "Retirar bolsas"]],
  ["Trapear áreas comunes", "limpieza", "Limpieza", "Limpieza", "medium", "easy", 30, false, ["Colocar señalización", "Trapear áreas"]],
  ["Revisar documentos pendientes", "administracion", "Administración", "Recursos Humanos", "medium", "medium", 30, false, ["Revisar vencimientos", "Notificar pendientes"]],
  ["Confirmar capacitaciones", "administracion", "Administración", "Capacitación", "medium", "medium", 30, false, ["Validar agenda", "Confirmar participantes"]],
  ["Publicar aviso interno", "administracion", "Administración", "Recursos Humanos", "low", "easy", 15, false, ["Redactar aviso", "Publicar"]]
]

function parseArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function normalize(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

export function loadTaskTemplates() {
  const stored = parseArray(TASK_TEMPLATES_KEY)
  if (stored.length) return stored
  const now = new Date().toISOString()
  const seeded = SEED_TASKS.map(([title, areaId, areaName, category, priority, difficulty, minutes, evidenceRequired, checklist], index) => ({
    id: `seed-task-${index + 1}`,
    title,
    description: `Procedimiento operativo estandarizado: ${title}.`,
    areaId,
    areaName,
    category,
    priority,
    difficulty,
    estimatedMinutes: minutes,
    requiredPeople: difficulty === "hard" ? 2 : 1,
    recommendedRole: areaName,
    requiredSkillLevel: difficulty === "hard" ? "senior" : difficulty === "medium" ? "intermediate" : "junior",
    toolsNeeded: [],
    materialsNeeded: [],
    sopLink: "",
    checklistItems: checklist.map((text, itemIndex) => ({ id: `step-${index}-${itemIndex}`, text })),
    evidenceRequired,
    recurrence: ["Cierre", "Apertura"].includes(category) ? "daily" : "none",
    recommendedTimeBlock: category === "Cierre" ? "21:30" : "08:00",
    active: true,
    createdBy: "Sistema",
    createdAt: now,
    updatedAt: now
  }))
  saveTaskTemplates(seeded)
  return seeded
}

export function saveTaskTemplates(templates) {
  localStorage.setItem(TASK_TEMPLATES_KEY, JSON.stringify(templates))
}

export function loadAssignedTasks() {
  return parseArray(ASSIGNED_TASKS_KEY)
}

export function saveAssignedTasks(tasks) {
  localStorage.setItem(ASSIGNED_TASKS_KEY, JSON.stringify(tasks))
}

export function loadTaskNotifications() {
  return parseArray(TASK_NOTIFICATIONS_KEY)
}

export function saveTaskNotifications(notifications) {
  localStorage.setItem(TASK_NOTIFICATIONS_KEY, JSON.stringify(notifications))
  window.dispatchEvent(new Event("task-notifications-updated"))
}

export function loadOperationalEmployees(currentUser) {
  const managed = parseArray("users")
  const users = managed.map((employee) => ({
    ...employee,
    taskId: employee.id || employee.username,
    name: employee.nombre || employee.name || employee.username,
    areaId: normalize(employee.departamento),
    level: employee.skillLevel || inferSkillLevel(employee),
    score: calculateScore(employee)
  }))
  const currentId = currentUser?.id || currentUser?.username
  if (currentUser && !users.some((employee) => employee.taskId === currentId)) {
    users.push({
      id: currentId,
      taskId: currentId,
      username: currentUser.username,
      nombre: currentUser.name,
      name: currentUser.name,
      rol: currentUser.legacyRole,
      departamento: currentUser.role === "rrhh" ? "Administración" : "",
      areaId: currentUser.role === "rrhh" ? "administracion" : "",
      activo: true,
      estado: "Activo",
      level: ["admin", "gerente", "supervisor"].includes(currentUser.role) ? "supervisor" : "junior",
      score: 100,
      schedules: []
    })
  }
  return users
}

function inferSkillLevel(employee) {
  const role = normalize(employee.rol || employee.role || employee.puesto)
  if (role.includes("supervisor") || role.includes("gerente") || role.includes("administrador")) return "supervisor"
  const score = calculateScore(employee)
  if (score >= 90) return "senior"
  if (score >= 75) return "intermediate"
  return "junior"
}

function calculateScore(employee) {
  const performance = employee.performance || {}
  const values = Object.values(performance).filter((value) => Number.isFinite(Number(value))).map(Number)
  return values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 80
}

export function getCurrentUserTaskId(user) {
  return user?.id || user?.username
}

function isEmployeeAvailable(employee, date, shift, areaId) {
  const state = normalize(employee.estado || (employee.activo === false ? "Inactivo" : "Activo"))
  if (employee.activo === false || ["inactivo", "suspendido", "vacaciones", "descanso"].includes(state)) return false
  const employeeArea = normalize(employee.departamento || employee.areaId)
  const supportAreas = (employee.supportAreas || []).map(normalize)
  if (areaId && employeeArea && employeeArea !== normalize(areaId) && !supportAreas.includes(normalize(areaId))) return false

  const schedules = Array.isArray(employee.schedules) ? employee.schedules : []
  if (!schedules.length) return true
  const weekday = normalize(new Intl.DateTimeFormat("es-GT", { weekday: "long", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)))
  return schedules.some((schedule) => {
    const dayMatches = !schedule.day && !schedule.dia ? true : normalize(schedule.day || schedule.dia) === weekday
    const scheduleShift = schedule.shiftId || schedule.turnoId
    return dayMatches && (!scheduleShift || scheduleShift === shift.id)
  })
}

function levelRank(level) {
  return { junior: 1, intermediate: 2, senior: 3, supervisor: 4 }[level] || 1
}

function difficultyRank(difficulty) {
  return { easy: 1, medium: 2, hard: 3, expert: 4 }[difficulty] || 1
}

function createAssignedTask(template, assignedTo, date, shift, assignedBy) {
  return {
    id: makeId("task"),
    templateId: template.id,
    title: template.title,
    description: template.description || "",
    areaId: template.areaId,
    areaName: template.areaName,
    category: template.category,
    assignedTo,
    assignedBy,
    date,
    shiftId: shift.id,
    scheduledStart: "",
    scheduledEnd: "",
    estimatedMinutes: Number(template.estimatedMinutes) || 0,
    recommendedTimeBlock: template.recommendedTimeBlock || "",
    priority: template.priority,
    difficulty: template.difficulty,
    requiredPeople: Number(template.requiredPeople) || 1,
    status: assignedTo.length ? "pending" : "review_required",
    checklistItems: (template.checklistItems || []).map((item) => ({ ...item, completed: false })),
    evidenceRequired: Boolean(template.evidenceRequired),
    evidenceFiles: [],
    completedAt: "",
    completionNotes: "",
    createdAt: new Date().toISOString()
  }
}

export function assignTasksAutomatically(tasks, employees, date, shift, areaId, existingTasks = [], assignedBy = "Sistema") {
  const load = {}
  existingTasks.filter((task) => task.date === date && task.status !== "cancelled").forEach((task) => {
    ;(task.assignedTo || []).forEach((userId) => {
      load[userId] = (load[userId] || 0) + Number(task.estimatedMinutes || 0)
    })
  })
  const assignedTasks = []
  const unassignedTasks = []
  const warnings = []

  tasks.forEach((template) => {
    const candidates = employees
      .filter((employee) => isEmployeeAvailable(employee, date, shift, areaId || template.areaId))
      .filter((employee) => levelRank(employee.level) >= Math.min(difficultyRank(template.difficulty), 3) || (template.difficulty === "hard" && employee.level === "junior" && Number(template.requiredPeople) > 1))
      .filter((employee) => template.priority !== "critical" || employee.score >= 70)
      .sort((a, b) => (load[a.taskId] || 0) - (load[b.taskId] || 0) || b.score - a.score)
    const required = Math.max(1, Number(template.requiredPeople) || 1)
    let selected = candidates.slice(0, required)
    if (required > 1 && ["hard", "expert"].includes(template.difficulty) && !selected.some((employee) => levelRank(employee.level) >= 3)) {
      selected = []
    }
    if (selected.length < required) {
      unassignedTasks.push(template)
      warnings.push(`No se encontró colaborador compatible para: ${template.title}.`)
      assignedTasks.push(createAssignedTask(template, [], date, shift, assignedBy))
      return
    }
    const ids = selected.map((employee) => employee.taskId)
    ids.forEach((id) => {
      load[id] = (load[id] || 0) + Number(template.estimatedMinutes || 0)
    })
    assignedTasks.push(createAssignedTask(template, ids, date, shift, assignedBy))
  })

  return { assignedTasks: generateDailyTaskSchedule(assignedTasks, shift), unassignedTasks, warnings }
}

export function assignTasksManually(tasks, selectedEmployeeIds, date, shift, assignedBy) {
  const created = tasks.map((template) => createAssignedTask(template, selectedEmployeeIds.slice(0, Number(template.requiredPeople) || 1), date, shift, assignedBy))
  return generateDailyTaskSchedule(created, shift)
}

function minutesFromTime(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number)
  return (hours * 60) + minutes
}

function timeFromMinutes(value) {
  const minutes = value % (24 * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}

export function formatOperationalTime(value) {
  const minutes = minutesFromTime(value)
  const hours = Math.floor(minutes / 60)
  const period = hours >= 12 ? "PM" : "AM"
  const displayHour = hours % 12 || 12
  return `${String(displayHour).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${period}`
}

export function generateDailyTaskSchedule(assignedTasks, shift) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 }
  let cursor = minutesFromTime(shift.start)
  return [...assignedTasks]
    .sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2))
    .map((task) => {
      const recommended = minutesFromTime(task.recommendedTimeBlock || "")
      const start = task.scheduledStart ? minutesFromTime(task.scheduledStart) : Math.max(cursor, recommended || cursor)
      const end = start + Number(task.estimatedMinutes || 0)
      cursor = end
      return { ...task, scheduledStart: timeFromMinutes(start), scheduledEnd: timeFromMinutes(end) }
    })
}

export function createTaskNotifications(tasks) {
  const notifications = loadTaskNotifications()
  tasks.forEach((task) => {
    ;(task.assignedTo || []).forEach((userId) => notifications.unshift({
      id: makeId("notification"),
      userId,
      type: "task_assigned",
      title: "Nueva tarea asignada",
      message: `Se te asignó: ${task.title}`,
      relatedTaskId: task.id,
      read: false,
      createdAt: new Date().toISOString()
    }))
  })
  saveTaskNotifications(notifications)
}

export function addTaskNotification(userId, type, title, message, relatedTaskId) {
  if (!userId) return
  const notifications = loadTaskNotifications()
  notifications.unshift({ id: makeId("notification"), userId, type, title, message, relatedTaskId, read: false, createdAt: new Date().toISOString() })
  saveTaskNotifications(notifications)
}

export function markTaskNotificationsRead(userId) {
  const notifications = loadTaskNotifications().map((notification) => notification.userId === userId ? { ...notification, read: true } : notification)
  saveTaskNotifications(notifications)
}

export function withComputedTaskStatus(task) {
  if (["completed", "cancelled"].includes(task.status) || !task.date || !task.scheduledEnd) return task
  const dueAt = new Date(`${task.date}T${task.scheduledEnd}:00`)
  return dueAt.getTime() < Date.now() ? { ...task, status: "late" } : task
}

export function updateTaskPerformance(tasks) {
  const users = parseArray("users")
  if (!users.length) return
  const updated = users.map((user) => {
    const id = user.id || user.username
    const own = tasks.filter((task) => (task.assignedTo || []).includes(id))
    if (!own.length) return user
    const completed = own.filter((task) => task.status === "completed")
    const late = own.filter((task) => task.status === "late")
    const evidenceTasks = completed.filter((task) => task.evidenceRequired)
    const minutes = completed.map((task) => {
      if (!task.completedAt || !task.createdAt) return Number(task.estimatedMinutes) || 0
      return Math.round((new Date(task.completedAt) - new Date(task.createdAt)) / 60000)
    })
    return {
      ...user,
      taskPerformance: {
        assignedCount: own.length,
        completedCount: completed.length,
        lateCount: late.length,
        completionRate: Math.round((completed.length / own.length) * 100),
        averageCompletionTime: minutes.length ? Math.round(minutes.reduce((sum, minute) => sum + minute, 0) / minutes.length) : 0,
        evidenceCompliance: evidenceTasks.length ? Math.round((evidenceTasks.filter((task) => task.evidenceFiles?.length).length / evidenceTasks.length) * 100) : 100
      }
    }
  })
  localStorage.setItem("users", JSON.stringify(updated))
}

export function taskMatchesUser(task, user) {
  const ids = [user?.id, user?.username].filter(Boolean)
  return (task.assignedTo || []).some((assignedId) => ids.includes(assignedId))
}
