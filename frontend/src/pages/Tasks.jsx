import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import { getActiveAreas } from "../services/areasService"
import { getProfilesTaskUnavailability, getTaskAssignableProfiles } from "../services/tasksService"
import { createNotification } from "../services/notificationsService"
import {
  approveChecklistChangeRequest,
  assignChecklistRunReplacement,
  completeChecklistRun,
  checkTemplateHasRuns,
  createChecklistRunFromTemplate,
  createChecklistChangeRequest,
  createChecklistManagementAlert,
  createChecklistTemplate,
  createChecklistTemplateSuggestion,
  deactivateChecklistTemplate,
  deleteChecklistTemplate,
  getChecklistChangeRequests,
  getChecklistIncidents,
  getChecklistManagementAlerts,
  getChecklistProfiles,
  getChecklistRuns,
  getChecklistTemplateSuggestions,
  getChecklistTemplates,
  generateDueChecklistRuns,
  getChecklistCoverageForRuns,
  notifyOverdueChecklistRuns,
  processChecklistCoverage,
  reactivateChecklistTemplate,
  rejectChecklistChangeRequest,
  startChecklistRun,
  submitChecklistChangeRequest,
  updateChecklistRunItem,
  updateChecklistIncidentStatus,
  updateChecklistManagementAlertStatus,
  updateChecklistChangeRequest,
  updateChecklistTemplate,
  updateChecklistTemplateSuggestionStatus,
  logChecklistSessionAudit
} from "../services/checklistsService"
import {
  appendLocalChecklistAudit,
  clearActiveChecklistSession,
  enqueueChecklistRetry,
  flushAllChecklistPendingSaves,
  getActiveChecklistSession,
  getChecklistRunMeta,
  getLastActiveChecklistSession,
  installChecklistLifecycleGuards,
  listAllUnsyncedChecklistDrafts,
  listChecklistDraftsForRun,
  listChecklistRetryQueue,
  markChecklistItemDraftSynced,
  hydrateDraftPayload,
  itemPayloadHasAnswer,
  mergeRunWithLocalDrafts,
  persistActiveChecklistSession,
  persistChecklistItemDraft,
  recordChecklistSuccessfulAutosave,
  registerChecklistFlushCallback,
  removeChecklistRetry,
  touchActiveChecklistSession,
  persistChecklistWizardDraft,
  getChecklistWizardDraft,
  clearChecklistWizardDraft
} from "../utils/checklistProgressPersistence"
import { readChecklistEvidenceFile } from "../utils/checklistPhotoUtils"
import {
  CHECKLIST_OPERATIONAL_STATUS,
  CHECKLIST_REPLACEMENT_REASONS,
  getChecklistOperationalDisplayStatus,
  getChecklistOperationalStatusLabel,
  getChecklistReplacementReasonLabel,
  hasChecklistReplacement,
  isChecklistOperationallyExpired,
  isChecklistRunHistoricPending,
  isChecklistRunTodayWork
} from "../utils/checklistOperationalStatus"
import {
  buildChecklistCoverageMap,
  getChecklistAvailabilityLabel,
  getChecklistCoverageAlertMessage,
  getChecklistCoverageSourceLabel,
  getChecklistSuggestedReplacement,
  needsChecklistCoverageAlert
} from "../utils/checklistCoverage"
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
  formatTaskDueAt,
  buildDueAtIso,
  resolveTaskDueAt,
  isTaskOverdue,
  getCurrentUserTaskId,
  loadAssignedTasks,
  loadOperationalEmployees,
  mapProfileToOperationalEmployee,
  mergeOperationalEmployees,
  loadTaskNotifications,
  loadTaskTemplates,
  saveAssignedTasks,
  saveTaskTemplates,
  taskMatchesUser,
  updateTaskPerformance,
  withComputedTaskStatus
} from "../utils/tasks"
import { normalizeRole } from "../utils/profilePermissions"
import YieldAuditFormPanel from "../components/yield/YieldAuditFormPanel"
import InfoTooltip from "../components/InfoTooltip"
import ChecklistWizardStepBoundary from "../components/checklists/ChecklistWizardStepBoundary"
import PaginationControls from "../components/PaginationControls"
import { pageItems } from "../utils/pagination"
import { hasYieldAuditForTask } from "../services/yieldCostingService"
import "./Tasks.css"

function guatemalaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}

const TODAY = guatemalaDateString()
/** Vista temporal: activar solo durante validación de corridas duplicadas. */
const SHOW_CHECKLIST_RUN_DIAGNOSTIC = false
const MANAGEMENT_ROLES = ["admin", "gerente", "gerente_general", "recursos_humanos", "supervisor"]
const OPERATIONAL_TASK_TABS = [
  ["checklists", "Mis checklists"],
  ["mine", "Mis tareas"],
  ["yieldForm", "Formulario rendimiento"]
]
const ADMIN_TABS = [
  ["dashboard", "Dashboard"],
  ["bank", "Banco de tareas"],
  ["create", "Crear tarea nueva"],
  ["assign", "Asignar tareas"],
  ["calendar", "Calendario operativo"],
  ["checklists", "Checklists"],
  ["mine", "Mis tareas"],
  ["yieldForm", "Formulario rendimiento"],
  ["reports", "Reportes"]
]

const CHECKLIST_AREAS = ["FOH", "BOH / Cocina", "Pizzeria", "Cafeteria", "Barra", "Caja", "Panaderia", "Reposteria", "Almacen", "Limpieza", "Oficina", "Recursos Humanos", "Administracion"]
const CHECKLIST_AREA_LABELS = {
  FOH: "FOH (Servicio)",
  "BOH / Cocina": "BOH (Cocina)",
  Pizzeria: "Pizzeria",
  Cafeteria: "Cafeteria",
  Barra: "Barra",
  Caja: "Caja",
  Panaderia: "Panaderia",
  Reposteria: "Reposteria",
  Almacen: "Almacen",
  Limpieza: "Limpieza",
  Oficina: "Oficina",
  "Recursos Humanos": "Recursos Humanos",
  Administracion: "Administracion"
}
const CHECKLIST_ROLES = ["admin", "gerente_general", "gerente", "supervisor", "encargado_almacen", "recursos_humanos", "cocina", "pizzeria", "barista", "bartender", "panadero", "repostero", "caja", "mesero", "limpieza", "mantenimiento", "colaborador"]
const CHECKLIST_FREQUENCIES = [["manual", "Manual"], ["diaria", "Diaria"], ["semanal", "Semanal"], ["mensual", "Mensual"], ["apertura", "Apertura"], ["cierre", "Cierre"], ["por_turno", "Por turno"]]
const CHECKLIST_CONTEXTS = [["general", "General"], ["apertura", "Apertura"], ["servicio", "Servicio"], ["cierre", "Cierre"], ["limpieza_profunda", "Limpieza profunda"], ["inventario", "Inventario"]]
const CHECKLIST_RESPONSE_TYPES = [["yes_no", "Si / No"], ["checkbox", "Checkbox completado"], ["short_text", "Texto corto"], ["long_text", "Texto largo"], ["number", "Numero"], ["date", "Fecha"], ["time", "Hora"], ["photo", "Foto / evidencia"], ["rating", "Ranking 1 a 5"], ["select", "Lista desplegable"], ["multi_select", "Seleccion multiple"], ["signature", "Firma"], ["acknowledgement", "Lectura obligatoria"]]
const CHECKLIST_WEEKDAYS = [[1, "Lunes"], [2, "Martes"], [3, "Miercoles"], [4, "Jueves"], [5, "Viernes"], [6, "Sabado"], [7, "Domingo"]]
const CHECKLIST_ALL_WEEKDAYS = CHECKLIST_WEEKDAYS.map(([day]) => day)
const CHECKLIST_WORKDAYS = [1, 2, 3, 4, 5]
const CHECKLIST_WEEKEND_DAYS = [6, 7]
const CHECKLIST_WEEKDAY_TO_RRULE = { 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA", 7: "SU" }
const CHECKLIST_RRULE_TO_WEEKDAY = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
const CHECKLIST_WEEKDAY_SHORT = { 1: "Lun", 2: "Mar", 3: "Mie", 4: "Jue", 5: "Vie", 6: "Sab", 7: "Dom" }
const CHECKLIST_SUGGESTION_TYPES = [["add_item", "Agregar item"], ["remove_item", "Eliminar item"], ["edit_item_text", "Editar texto de item"], ["change_order", "Cambiar orden"], ["change_frequency", "Cambiar frecuencia"], ["change_responsible", "Cambiar responsable"], ["change_evidence", "Cambiar evidencia requerida"], ["other", "Otro"]]
const CHECKLIST_TEMPLATE_MANAGERS = ["admin", "gerente_general", "gerente", "supervisor"]
const CHECKLIST_TEMPLATE_APPROVERS = ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"]
const CHECKLIST_INCIDENT_SEVERITIES = [["low", "Baja"], ["medium", "Media"], ["high", "Alta"], ["critical", "Critica"]]
const CHECKLIST_INCIDENT_STATUSES = [["open", "Abiertas"], ["acknowledged", "Reconocidas"], ["in_progress", "En proceso"], ["resolved", "Resueltas"], ["dismissed", "Descartadas"]]
const CHECKLIST_ALERT_PRIORITIES = [["informativo", "Informativo"], ["atencion", "Requiere atencion"], ["critico", "Critico"]]
const CHECKLIST_ALERT_STATUSES = [["open", "Abiertos"], ["reviewed", "Revisados"], ["resolved", "Resueltos"], ["dismissed", "Descartados"]]
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

const TASK_ROLE_LABELS = {
  admin: "Admin",
  gerente_general: "Gerente general",
  gerente: "Gerente",
  recursos_humanos: "RRHH",
  supervisor: "Supervisor",
  cocina: "Cocina",
  cocinero: "Cocina",
  servicio: "Servicio",
  mesero: "Servicio",
  caja: "Caja",
  cajero: "Caja",
  barra: "Barra",
  bartender: "Barra",
  barista: "Cafeteria",
  cafeteria: "Cafeteria",
  limpieza: "Limpieza",
  almacen: "Almacen",
  encargado_almacen: "Almacen",
  pizzeria: "Pizzeria",
  panadero: "Panaderia",
  repostero: "Reposteria",
  mantenimiento: "Mantenimiento",
  colaborador: "Colaborador"
}
const TASK_PROTECTED_ROLES = new Set(["admin", "gerente_general"])
const TASK_SUPERVISOR_RESTRICTED_ROLES = new Set(["admin", "gerente_general", "gerente", "recursos_humanos", "supervisor"])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isValidUuid(value) {
  return UUID_PATTERN.test(String(value || "").trim())
}

function resolveEmployeeProfileId(employeeOrId, employees = []) {
  if (typeof employeeOrId === "object" && employeeOrId) {
    if (isValidUuid(employeeOrId.profileId)) return String(employeeOrId.profileId).trim()
    if (isValidUuid(employeeOrId.id)) return String(employeeOrId.id).trim()
    return null
  }
  const assigneeKey = String(employeeOrId || "").trim()
  if (!assigneeKey) return null
  if (isValidUuid(assigneeKey)) return assigneeKey
  const employee = employees.find((item) => item.taskId === assigneeKey || item.profileId === assigneeKey)
  return resolveEmployeeProfileId(employee, employees)
}

function normalizeTaskArea(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
}

function getTaskOptionLabel(options, value, fallback = "No definido") {
  return options.find((option) => option.id === value)?.label || fallback
}

function getEmployeeRoleKey(employee) {
  return normalizeRole(employee?.role || employee?.rol || employee?.puesto)
}

function getEmployeeAreaKey(employee) {
  return normalizeTaskArea(employee?.areaId || employee?.departamento || employee?.areaName)
}

function getTaskActorArea(user, employees) {
  const actorId = getCurrentUserTaskId(user)
  const employee = employees.find((item) => item.taskId === actorId)
  return normalizeTaskArea(user?.areaId || user?.areaName || employee?.areaId || employee?.departamento || employee?.areaName)
}

function taskRoleLabel(role) {
  const normalized = normalizeRole(role)
  return TASK_ROLE_LABELS[normalized] || String(role || "Colaborador")
}

function formatTaskDate(date) {
  if (!date) return "Sin fecha"
  return new Date(`${date}T12:00:00`).toLocaleDateString("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  })
}

function timeToMinutes(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number)
  return (hours * 60) + minutes
}

function addMinutesToTime(time, minutesToAdd) {
  const total = timeToMinutes(time) + Number(minutesToAdd || 0)
  const hours = ((Math.floor(total / 60) % 24) + 24) % 24
  const minutes = ((total % 60) + 60) % 60
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
}

function toDateTime(date, time) {
  return new Date(`${date}T${time || "00:00"}:00`)
}

function isPastTaskSchedule(date, time, actorRole) {
  if (["admin", "gerente_general"].includes(actorRole)) return false
  return toDateTime(date, time).getTime() < Date.now()
}

function resolveTaskShiftId(startTime) {
  const minutes = timeToMinutes(startTime)
  const match = OPERATIONAL_SHIFTS.find((shift, index) => {
    const start = timeToMinutes(shift.start)
    const next = OPERATIONAL_SHIFTS[index + 1]
    const end = next ? timeToMinutes(next.start) : 24 * 60
    return minutes >= start && minutes < end
  })
  return match?.id || OPERATIONAL_SHIFTS[0]?.id || "opening"
}

function validateManualTaskAssignment({ assigneeId, date, startTime, dueDate, dueTime, requiresDeadline = true }, actorRole) {
  if (!assigneeId) return "Selecciona un colaborador para continuar."
  if (!date) return "Selecciona la fecha de ejecucion."
  if (!startTime) return "Selecciona la hora de inicio."
  if (requiresDeadline && !dueDate) return "Selecciona la fecha limite."
  if (requiresDeadline && !dueTime) return "Selecciona la hora limite."
  const startAt = toDateTime(date, startTime)
  const dueAt = toDateTime(dueDate, dueTime)
  if (dueAt.getTime() < startAt.getTime()) return "La fecha y hora limite no puede ser anterior al inicio."
  if (dueAt.getTime() < Date.now()) return "La fecha y hora limite no puede ser anterior al momento actual."
  if (isPastTaskSchedule(date, startTime, actorRole)) return "No puedes asignar tareas en el pasado con tu rol actual."
  return ""
}

function buildManualTaskRecord(template, assigneeId, assignment, assignedBy) {
  const shiftId = resolveTaskShiftId(assignment.startTime)
  const dueDate = assignment.dueDate || assignment.date
  const due_at = buildDueAtIso(dueDate, assignment.dueTime)
  return {
    id: `task-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    templateId: template.id,
    title: template.title,
    description: template.description || "",
    areaId: template.areaId,
    areaName: template.areaName,
    category: template.category,
    assignedTo: assigneeId ? [assigneeId] : [],
    assignedBy,
    date: assignment.date,
    shiftId,
    scheduledStart: assignment.startTime,
    scheduledEnd: assignment.dueTime,
    dueDate,
    due_at,
    estimatedMinutes: Number(template.estimatedMinutes) || 0,
    recommendedTimeBlock: template.recommendedTimeBlock || "",
    priority: template.priority,
    difficulty: template.difficulty,
    requiredPeople: 1,
    status: assigneeId ? "pending" : "review_required",
    checklistItems: (template.checklistItems || []).map((item) => ({ ...item, completed: false })),
    evidenceRequired: Boolean(template.evidenceRequired),
    evidenceFiles: [],
    completedAt: "",
    completionNotes: "",
    createdAt: new Date().toISOString()
  }
}

function getAssignableEmployeesForTemplate(user, employees, template, options = {}) {
  const actorRole = normalizeRole(user?.role)
  const actorId = String(user?.id || "")
  const availability = options.availability || {}

  return employees
    .filter((employee) => {
      if (!employee?.taskId) return false
      if (!employee?.profileId) return false

      const state = normalizeTaskArea(employee.estado || (employee.activo === false ? "Inactivo" : "Activo"))
      const profileStatus = String(employee.status || "").toLowerCase()
      if (employee.activo === false || ["inactivo", "suspendido"].includes(state)) return false
      if (profileStatus === "suspended" || profileStatus === "inactive") return false

      const targetRole = getEmployeeRoleKey(employee)

      if (actorRole === "admin" || actorRole === "gerente_general" || actorRole === "gerente") {
        // Sin restriccion por area: admin y gerencia pueden delegar a cualquier colaborador activo.
      } else if (actorRole === "recursos_humanos") {
        if (TASK_PROTECTED_ROLES.has(targetRole)) return false
      } else if (actorRole === "supervisor") {
        if (String(employee.supervisorProfileId || "") !== actorId) return false
        if (TASK_SUPERVISOR_RESTRICTED_ROLES.has(targetRole)) return false
      } else {
        return false
      }

      if (options.date && availability[employee.profileId]) return false

      return true
    })
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }))
}

function normalizeChecklistWeekdays(days) {
  return [...new Set((Array.isArray(days) ? days : []).map((day) => Number(day)).filter((day) => CHECKLIST_WEEKDAY_TO_RRULE[day]))].sort((a, b) => a - b)
}

function parseChecklistWeekdaysFromRRule(rule) {
  const match = String(rule || "").toUpperCase().match(/(?:^|;)BYDAY=([^;]+)/)
  if (!match) return []
  return normalizeChecklistWeekdays(match[1].split(",").map((token) => CHECKLIST_RRULE_TO_WEEKDAY[token.trim()]))
}

function buildChecklistWeeklyRRule(days) {
  const normalized = normalizeChecklistWeekdays(days)
  if (!normalized.length) return ""
  return `FREQ=WEEKLY;BYDAY=${normalized.map((day) => CHECKLIST_WEEKDAY_TO_RRULE[day]).join(",")}`
}

function summarizeChecklistWeekdays(days) {
  const normalized = normalizeChecklistWeekdays(days)
  return normalized.length ? normalized.map((day) => CHECKLIST_WEEKDAY_SHORT[day]).join(", ") : "Ninguno"
}

function checklistAreaLabel(area) {
  return CHECKLIST_AREA_LABELS[area] || area || "Sin area"
}

function formatChecklistList(items, conjunction = "y") {
  const safe = items.filter(Boolean)
  if (!safe.length) return ""
  if (safe.length === 1) return safe[0]
  if (safe.length === 2) return `${safe[0]} ${conjunction} ${safe[1]}`
  return `${safe.slice(0, -1).join(", ")} ${conjunction} ${safe[safe.length - 1]}`
}

function humanChecklistRecurrenceSummary(form) {
  if (form.frequency === "semanal") {
    const labels = normalizeChecklistWeekdays(form.recurrence_days).map((day) => CHECKLIST_WEEKDAYS.find(([id]) => id === day)?.[1]?.toLowerCase())
    return labels.length ? `Esta checklist se ejecutara todos los ${formatChecklistList(labels)}.` : "Debe seleccionar al menos un dia de ejecucion."
  }
  if (form.frequency === "mensual") {
    return form.recurrence_month_day ? `Esta checklist se ejecutara el dia ${form.recurrence_month_day} de cada mes.` : "Define el dia del mes en que debe ejecutarse."
  }
  if (form.frequency === "diaria") {
    return "Esta checklist se ejecutara todos los dias."
  }
  if (form.frequency === "manual") {
    return "Esta checklist es manual. Cambia la frecuencia a Semanal si quieres escoger dias especificos."
  }
  if (["apertura", "cierre", "por_turno"].includes(form.frequency)) {
    return `Esta checklist se ejecutara por evento de ${friendlyChecklistLabel(CHECKLIST_FREQUENCIES, form.frequency).toLowerCase()}. Si quieres elegir dias, usa frecuencia semanal.`
  }
  return "Ajusta la programacion segun la frecuencia elegida."
}

function checklistFrequencyBadge(template) {
  if (template.frequency === "manual" && !template.auto_generate) return "Unica"
  if (template.frequency === "manual" && template.auto_generate) return "Personalizada"
  if (template.frequency === "semanal" && normalizeChecklistWeekdays(template.recurrence_days).length) {
    return "Semanal"
  }
  return friendlyChecklistLabel(CHECKLIST_FREQUENCIES, template.frequency)
}

function normalizeChecklistTimeValue(value) {
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  const match = raw.match(/(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : ""
}

function slimChecklistWizardItem(item = {}) {
  return {
    id: item.id,
    title: item.title || "",
    description: item.description || "",
    section: item.section || "",
    response_type: item.response_type || "yes_no",
    is_required: item.is_required !== false,
    requires_photo: Boolean(item.requires_photo),
    requires_comment: Boolean(item.requires_comment),
    require_comment_on_no: Boolean(item.require_comment_on_no),
    require_photo_on_no: Boolean(item.require_photo_on_no),
    generate_incident_on_no: Boolean(item.generate_incident_on_no),
    triggers_incident: Boolean(item.triggers_incident),
    expected_response: item.expected_response || "",
    incident_severity: item.incident_severity || "medium",
    notify_roles: Array.isArray(item.notify_roles) ? item.notify_roles : ["admin", "gerente_general", "gerente"],
    create_task_on_fail: Boolean(item.create_task_on_fail),
    options: Array.isArray(item.options) ? item.options.join("\n") : String(item.options || ""),
    score_points: Number(item.score_points) || 1
  }
}

function normalizeChecklistWizardForm(form = {}) {
  return {
    title: form.title || "",
    description: form.description || "",
    area: form.area || CHECKLIST_AREAS[0],
    assigned_role: form.assigned_role || "",
    assigned_profile_id: form.assigned_profile_id || "",
    supervisor_profile_id: form.supervisor_profile_id || "",
    backup_profile_id: form.backup_profile_id || "",
    primary_replacement_profile_id: form.primary_replacement_profile_id || "",
    secondary_replacement_profile_id: form.secondary_replacement_profile_id || "",
    coverage_escalation_profile_id: form.coverage_escalation_profile_id || "",
    auto_coverage_enabled: Boolean(form.auto_coverage_enabled),
    auto_coverage_wait_minutes: Number(form.auto_coverage_wait_minutes || 20),
    frequency: form.frequency || "manual",
    shift_context: form.shift_context || "general",
    status: form.status || "active",
    reminder_time: normalizeChecklistTimeValue(form.reminder_time),
    due_time: normalizeChecklistTimeValue(form.due_time),
    recurrence_days: normalizeChecklistWeekdays(form.recurrence_days),
    recurrence_month_day: form.recurrence_month_day || "",
    recurrence_rule: form.recurrence_rule || "",
    skip_non_work_days: form.skip_non_work_days !== false,
    auto_generate: Boolean(form.auto_generate),
    requires_approval: false
  }
}

function buildChecklistWizardForm(editingTemplate) {
  const recurrenceRule = String(editingTemplate?.recurrence_rule || "").trim().toUpperCase()
  const recurrenceDaysFromTemplate = normalizeChecklistWeekdays(editingTemplate?.recurrence_days || [])
  const recurrenceDaysFromRule = parseChecklistWeekdaysFromRRule(recurrenceRule)
  const legacyWeeklyAllDays = Boolean(
    editingTemplate
    && editingTemplate.frequency === "semanal"
    && editingTemplate.auto_generate
    && !recurrenceRule
    && recurrenceDaysFromTemplate.length === 0
  )
  const recurrenceDays = legacyWeeklyAllDays
    ? CHECKLIST_ALL_WEEKDAYS
    : (recurrenceDaysFromTemplate.length ? recurrenceDaysFromTemplate : recurrenceDaysFromRule)

  return normalizeChecklistWizardForm({
    title: editingTemplate?.title || "",
    description: editingTemplate?.description || "",
    area: editingTemplate?.area || CHECKLIST_AREAS[0],
    assigned_role: editingTemplate?.assigned_role || "",
    assigned_profile_id: editingTemplate?.assigned_profile_id || "",
    supervisor_profile_id: editingTemplate?.supervisor_profile_id || "",
    backup_profile_id: editingTemplate?.backup_profile_id || "",
    primary_replacement_profile_id: editingTemplate?.primary_replacement_profile_id || editingTemplate?.backup_profile_id || "",
    secondary_replacement_profile_id: editingTemplate?.secondary_replacement_profile_id || "",
    coverage_escalation_profile_id: editingTemplate?.coverage_escalation_profile_id || "",
    auto_coverage_enabled: Boolean(editingTemplate?.auto_coverage_enabled),
    auto_coverage_wait_minutes: editingTemplate?.auto_coverage_wait_minutes || 20,
    frequency: editingTemplate?.frequency || "manual",
    shift_context: editingTemplate?.shift_context || "general",
    status: editingTemplate?.status || "active",
    reminder_time: editingTemplate?.reminder_time || "",
    due_time: editingTemplate?.due_time || "",
    recurrence_days: recurrenceDays,
    recurrence_month_day: editingTemplate?.recurrence_month_day || "",
    recurrence_rule: recurrenceRule || buildChecklistWeeklyRRule(recurrenceDays),
    skip_non_work_days: editingTemplate?.skip_non_work_days !== false,
    auto_generate: Boolean(editingTemplate?.auto_generate),
    requires_approval: false
  })
}

function Tasks() {
  const { user, canAccess, refreshChecklistModuleAccess } = useAuth()
  const [params, setParams] = useSearchParams()
  const currentUserRole = normalizeRole(user?.role)
  const isManager = MANAGEMENT_ROLES.includes(currentUserRole)
  const canUseChecklists = canAccess("tasks")
  const [templates, setTemplates] = useState(loadTaskTemplates)
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [assignedTasks, setAssignedTasks] = useState(loadAssignedTasks)
  const [areas, setAreas] = useState([])
  const [employees, setEmployees] = useState(() => loadOperationalEmployees(user))
  const [employeesLoading, setEmployeesLoading] = useState(false)
  const [assignmentTemplate, setAssignmentTemplate] = useState(null)
  const [assignmentFeedback, setAssignmentFeedback] = useState(null)
  const requestedTab = params.get("tab") === "checklists"
    ? "checklists"
    : params.get("view") || (isManager ? "dashboard" : canUseChecklists ? "checklists" : "mine")
  const tab = requestedTab === "checklists"
    ? "checklists"
    : requestedTab === "yieldForm"
      ? "yieldForm"
      : isManager && ADMIN_TABS.some(([id]) => id === requestedTab)
        ? requestedTab
        : !isManager && canUseChecklists && OPERATIONAL_TASK_TABS.some(([id]) => id === requestedTab)
          ? requestedTab
          : isManager
            ? "dashboard"
            : canUseChecklists
              ? "checklists"
              : "mine"
  const taskFromQuery = params.get("task") || ""
  const visibleTemplates = templates.filter((template) => mayUseTemplate(template, user, employees))
  const computedTasks = assignedTasks.map(withComputedTaskStatus)
  const permittedAreas = getPermittedAreas(areas, user, employees, visibleTemplates)

  useEffect(() => {
    refreshChecklistModuleAccess?.()
  }, [refreshChecklistModuleAccess, user?.id])

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
    if (!isManager) return undefined
    let mounted = true

    async function loadEmployees() {
      setEmployeesLoading(true)
      const fallback = loadOperationalEmployees(user)
      const { data, error } = await getTaskAssignableProfiles()
      if (!mounted) return

      if (error) {
        console.warn("[Tasks] No se pudieron cargar colaboradores desde Supabase.", error)
        setEmployees(fallback)
      } else {
        const mapped = (data || []).map(mapProfileToOperationalEmployee)
        setEmployees(mergeOperationalEmployees(mapped, fallback))
      }
      setEmployeesLoading(false)
    }

    loadEmployees()
    return () => {
      mounted = false
    }
  }, [isManager, user?.id, user?.role])

  useEffect(() => {
    const currentTasks = assignedTasks.map(withComputedTaskStatus)
    if (currentTasks.some((task, index) => task.status !== assignedTasks[index].status)) {
      saveAssignedTasks(currentTasks)
      updateTaskPerformance(currentTasks)
    }
    const existing = loadTaskNotifications()
    currentTasks.filter((task) => !["completed", "cancelled"].includes(task.status)).forEach((task) => {
      const dueAt = resolveTaskDueAt(task)?.getTime()
      if (!dueAt) return
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

  async function notifyAssignedTasks(newTasks) {
    createTaskNotifications(newTasks)
    // TODO: migrar assigned tasks a Supabase para deep links y sincronizacion entre dispositivos.
    const supabaseRequests = []
    let skippedMissingProfile = false
    for (const task of newTasks) {
      for (const assigneeId of task.assignedTo || []) {
        const profileId = resolveEmployeeProfileId(assigneeId, employees)
        if (!profileId) {
          skippedMissingProfile = true
          console.warn("[Tasks] Notificacion Supabase omitida: el colaborador no tiene profile UUID valido.", {
            assigneeId,
            taskId: task.id,
            taskTitle: task.title
          })
          continue
        }
        supabaseRequests.push(createNotification({
          userId: profileId,
          type: "task_assigned",
          title: `Nueva tarea asignada: ${task.title}`,
          message: `${user?.name || "Sistema"} te asigno la tarea ${task.title} para el ${formatTaskDate(task.date)} a las ${formatOperationalTime(task.scheduledStart || "08:00")}.`,
          entityType: "task",
          entityId: task.id,
          actionUrl: "/tasks?view=mine"
        }))
      }
    }
    if (!supabaseRequests.length) {
      return skippedMissingProfile
        ? "La tarea se asigno localmente. No se envio notificacion en campana porque el colaborador no tiene UUID de perfil valido."
        : ""
    }
    const responses = await Promise.all(supabaseRequests)
    const failed = responses.find((result) => result?.error)
    if (failed) return "La tarea se asigno, pero no se pudo reflejar la notificacion en la campana."
    if (skippedMissingProfile) {
      return "La tarea se asigno. Algunas notificaciones en campana se omitieron por falta de UUID de perfil valido."
    }
    return ""
  }

  async function handleManualAssignment(template, assignment) {
    const task = buildManualTaskRecord(template, assignment.assigneeId, assignment, user?.name || "Sistema")
    persistTasks([task, ...assignedTasks])
    const notificationWarning = await notifyAssignedTasks([task])
    setAssignmentFeedback({
      tone: notificationWarning ? "warning" : "success",
      text: notificationWarning || `Tarea asignada a ${assignment.assigneeName} para el ${formatTaskDate(assignment.date)}.`
    })
    setAssignmentTemplate(null)
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
        {(isManager ? ADMIN_TABS : canUseChecklists ? OPERATIONAL_TASK_TABS : [["mine", "Mis tareas"], ["yieldForm", "Formulario rendimiento"]]).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => { if (id === "create") setEditingTemplate(null); openTab(id) }}>{label}</button>
        ))}
      </nav>

      {tab === "dashboard" && <TasksDashboard tasks={computedTasks} areas={areas} employees={employees} onOpenTab={openTab} />}
      {tab === "bank" && (
        <TaskBank
          templates={visibleTemplates}
          allTemplates={templates}
          areas={permittedAreas}
          setTemplates={setTemplates}
          canDeactivate={currentUserRole !== "recursos_humanos"}
          onAssign={(template) => { setAssignmentFeedback(null); setAssignmentTemplate(template) }}
          onEdit={(template) => { setEditingTemplate(template); openTab("create") }}
          feedback={assignmentFeedback}
        />
      )}
      {tab === "create" && <TaskTemplateForm key={editingTemplate?.id || "new"} templates={templates} setTemplates={setTemplates} areas={permittedAreas} currentUser={user} editingTemplate={editingTemplate} onFinished={() => { setEditingTemplate(null); openTab("bank") }} />}
      {tab === "assign" && (
        <TaskAssignment
          templates={visibleTemplates}
          tasks={computedTasks}
          employees={employees}
          areas={permittedAreas}
          user={user}
          onAssigned={(newTasks) => persistTasks([...newTasks, ...assignedTasks])}
          onNotifyAssignedTasks={notifyAssignedTasks}
        />
      )}
      {tab === "calendar" && <OperationalCalendar tasks={computedTasks} employees={employees} areas={areas} />}
      {tab === "checklists" && <ChecklistsModule user={user} initialRunId={params.get("id") || ""} initialChecklistView={params.get("view") || ""} />}
      {tab === "mine" && <MyTasks initialTaskId={taskFromQuery} tasks={computedTasks.filter((task) => taskMatchesUser(task, user))} user={user} persistAllTasks={persistTasks} allTasks={assignedTasks} />}
      {tab === "yieldForm" && (
        <article className="tasks-panel">
          <YieldAuditFormPanel />
        </article>
      )}
      {tab === "reports" && <TaskReports tasks={computedTasks} employees={employees} areas={areas} />}
      {assignmentTemplate && (
        <TaskAssignWizard
          template={assignmentTemplate}
          user={user}
          employees={employees}
          areas={areas}
          onClose={() => setAssignmentTemplate(null)}
          onSubmit={handleManualAssignment}
        />
      )}
    </section>
  )
}

function mayUseTemplate(template, user, employees) {
  const role = normalizeRole(user?.role)
  if (!template.active) return false
  if (role === "recursos_humanos") return template.areaId === "administracion" || ["Recursos Humanos", "Capacitación"].includes(template.category)
  if (role !== "supervisor") return true
  const employee = employees.find((item) => item.taskId === getCurrentUserTaskId(user))
  return !employee?.areaId || template.areaId === employee.areaId
}

function getPermittedAreas(areas, user, employees, templates) {
  const role = normalizeRole(user?.role)
  if (role === "recursos_humanos") return areas.filter((area) => area.id === "administracion")
  if (role !== "supervisor") return areas
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

function TaskBank({ templates, allTemplates, areas, setTemplates, canDeactivate, onAssign, onEdit, feedback }) {
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
      {feedback?.text && <p className={feedback.tone === "warning" ? "tasks-warning" : "tasks-success"}>{feedback.text}</p>}
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
              <button type="button" className="tasks-card-action-primary" onClick={() => onAssign(template)}>Asignar</button>
              <button type="button" className="tasks-link" onClick={() => onEdit(template)}>Editar</button>
              {canDeactivate && <button type="button" className="tasks-link danger" onClick={() => toggle(template.id)}>Desactivar</button>}
            </div>
          </article>
        ))}
      </div>
    </article>
  )
}

function TaskAssignWizard({ template, user, employees, areas, onClose, onSubmit }) {
  const actorRole = normalizeRole(user?.role)
  const [step, setStep] = useState(1)
  const [date, setDate] = useState(TODAY)
  const [dueDate, setDueDate] = useState(TODAY)
  const [startTime, setStartTime] = useState(template?.recommendedTimeBlock || "08:00")
  const [dueTime, setDueTime] = useState(addMinutesToTime(template?.recommendedTimeBlock || "08:00", Number(template?.estimatedMinutes) || 30))
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const [availability, setAvailability] = useState({})
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const baseCandidates = useMemo(
    () => getAssignableEmployeesForTemplate(user, employees, template, { date }),
    [user, employees, template, date]
  )
  const candidates = useMemo(
    () => getAssignableEmployeesForTemplate(user, employees, template, { date, availability }),
    [user, employees, template, date, availability]
  )
  const [assigneeId, setAssigneeId] = useState("")
  const selectedEmployee = candidates.find((employee) => employee.taskId === assigneeId) || null
  const validationError = validateManualTaskAssignment({ assigneeId, date, startTime, dueDate, dueTime }, actorRole)
  const dueAtPreview = buildDueAtIso(dueDate, dueTime)
  const areaName = areas.find((area) => area.id === template.areaId)?.name || template.areaName || "Sin area"

  useEffect(() => {
    if (!baseCandidates.length) {
      setAssigneeId("")
      return
    }
    if (!assigneeId || !candidates.some((employee) => employee.taskId === assigneeId)) {
      setAssigneeId(candidates[0]?.taskId || "")
    }
  }, [assigneeId, candidates, baseCandidates.length])

  useEffect(() => {
    let mounted = true
    const profileIds = baseCandidates.map((employee) => employee.profileId).filter(Boolean)
    if (!date || !profileIds.length) {
      setAvailability({})
      return undefined
    }

    setAvailabilityLoading(true)
    getProfilesTaskUnavailability(profileIds, date).then(({ data, error: availabilityError }) => {
      if (!mounted) return
      if (availabilityError) {
        console.warn("[Tasks] No se pudo validar disponibilidad de colaboradores.", availabilityError)
        setAvailability({})
      } else {
        setAvailability(data || {})
      }
      setAvailabilityLoading(false)
    })

    return () => {
      mounted = false
    }
  }, [baseCandidates, date])

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && !saving) onClose()
    }
    document.addEventListener("keydown", closeOnEscape)
    return () => document.removeEventListener("keydown", closeOnEscape)
  }, [onClose, saving])

  async function submitAssignment() {
    if (validationError || !selectedEmployee) {
      setError(validationError || "Selecciona un colaborador para continuar.")
      return
    }
    setSaving(true)
    setError("")
    try {
      await onSubmit(template, {
        assigneeId: selectedEmployee.taskId,
        assigneeName: selectedEmployee.name,
        date,
        dueDate,
        startTime,
        dueTime
      })
    } catch (submitError) {
      setError(submitError?.message || "No se pudo asignar la tarea.")
      setSaving(false)
    }
  }

  return (
    <div className="tasks-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
      <section className="tasks-modal" aria-modal="true" role="dialog" aria-labelledby="task-assign-title">
        <div className="tasks-panel-title">
          <div>
            <p className="tasks-eyebrow">Asignacion guiada</p>
            <h2 id="task-assign-title">Asignar tarea</h2>
            <p className="tasks-muted">Banco de tareas &gt; {template.title}</p>
          </div>
          <button type="button" className="tasks-link" onClick={onClose} disabled={saving}>Cerrar</button>
        </div>

        <div className="tasks-wizard-steps" aria-label="Pasos de asignacion">
          {[
            [1, "Tarea"],
            [2, "Colaborador"],
            [3, "Fecha y hora"],
            [4, "Confirmar"]
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={step === id ? "active" : ""}
              onClick={() => {
                if (id < step) setStep(id)
              }}
            >
              <span>{id}</span>
              {label}
            </button>
          ))}
        </div>

        {step === 1 && (
          <div className="tasks-wizard-body">
            <p className="tasks-wizard-intro">Vas a asignar esta tarea a un colaborador.</p>
            <div className="tasks-summary-grid">
              <div><span>Tarea</span><strong>{template.title}</strong></div>
              <div><span>Categoria</span><strong>{template.category}</strong></div>
              <div><span>Area sugerida</span><strong>{areaName}</strong></div>
              <div><span>Prioridad</span><strong>{getTaskOptionLabel(TASK_PRIORITIES, template.priority, template.priority)}</strong></div>
              <div><span>Duracion estimada</span><strong>{template.estimatedMinutes} min</strong></div>
              <div><span>Estado</span><strong>{template.active ? "Activa" : "Inactiva"}</strong></div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="tasks-wizard-body">
            <Field label="Colaborador disponible" hint="Solo se excluyen colaboradores suspendidos, inactivos, de vacaciones o con dia de descanso en la fecha seleccionada.">
              <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={!candidates.length || availabilityLoading}>
                <option value="">{availabilityLoading ? "Validando disponibilidad..." : candidates.length ? "Selecciona un colaborador" : "Sin colaboradores disponibles"}</option>
                {candidates.map((employee) => (
                  <option value={employee.taskId} key={employee.taskId}>
                    {employee.name} · {taskRoleLabel(employee.role || employee.rol || employee.puesto)} · {employee.departamento || employee.areaName || employee.areaId || "Sin area"}
                  </option>
                ))}
              </select>
            </Field>
            {!candidates.length && !availabilityLoading && (
              <p className="tasks-warning">
                {normalizeRole(user?.role) === "supervisor"
                  ? "No tienes colaboradores a tu cargo disponibles. RRHH debe asignarte colaboradores en Gestion de usuarios."
                  : "No hay colaboradores disponibles para esta fecha."}
              </p>
            )}
            {selectedEmployee && (
              <div className="tasks-assignee-card">
                <strong>{selectedEmployee.name}</strong>
                <span>{taskRoleLabel(selectedEmployee.role || selectedEmployee.rol || selectedEmployee.puesto)}</span>
                <small>{selectedEmployee.departamento || selectedEmployee.areaName || selectedEmployee.areaId || "Sin area asignada"}</small>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="tasks-wizard-body tasks-wizard-schedule">
            <section className="tasks-wizard-schedule-section">
              <header className="tasks-wizard-schedule-heading">
                <span className="tasks-wizard-schedule-icon" aria-hidden="true">▶</span>
                <div>
                  <h3>Ejecucion</h3>
                  <p>Cuando debe iniciarse la tarea.</p>
                </div>
              </header>
              <div className="tasks-wizard-schedule-grid">
                <Field label="Fecha de ejecucion" hint={["admin", "gerente_general"].includes(actorRole) ? "Admin puede usar fechas pasadas para corregir cargas." : "Tu rol no permite fechas pasadas."}>
                  <input type="date" className="tasks-schedule-input" value={date} onChange={(event) => {
                    const nextDate = event.target.value
                    setDate(nextDate)
                    if (!dueDate || dueDate < nextDate) setDueDate(nextDate)
                  }} />
                </Field>
                <Field label="Hora de inicio sugerida" hint="Hora estimada para comenzar.">
                  <input type="time" className="tasks-schedule-input" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                </Field>
              </div>
            </section>

            <section className="tasks-wizard-schedule-section">
              <header className="tasks-wizard-schedule-heading">
                <span className="tasks-wizard-schedule-icon deadline" aria-hidden="true">⏱</span>
                <div>
                  <h3>Fecha limite</h3>
                  <p>Cuando debe quedar completada la tarea.</p>
                </div>
              </header>
              <div className="tasks-wizard-schedule-grid">
                <Field label="Fecha limite" hint="Obligatoria. No puede ser anterior a la ejecucion.">
                  <input type="date" className="tasks-schedule-input" value={dueDate} min={date} onChange={(event) => setDueDate(event.target.value)} />
                </Field>
                <Field label="Hora limite" hint="Debe ser posterior al momento actual.">
                  <input type="time" className="tasks-schedule-input" value={dueTime} onChange={(event) => setDueTime(event.target.value)} />
                </Field>
              </div>
            </section>

            <div className="tasks-wizard-summary-row">
              <div className="tasks-inline-summary">
                <span>Turno sugerido</span>
                <strong>{OPERATIONAL_SHIFTS.find((shift) => shift.id === resolveTaskShiftId(startTime))?.name || "Manual"}</strong>
              </div>
              {dueAtPreview && (
                <div className="tasks-inline-summary highlight">
                  <span>Limite programado</span>
                  <strong>{formatTaskDueAt({ due_at: dueAtPreview })}</strong>
                </div>
              )}
            </div>

            {validationError && <p className="tasks-warning tasks-wizard-schedule-alert">{validationError}</p>}
            {assigneeId && availability[baseCandidates.find((employee) => employee.taskId === assigneeId)?.profileId] && (
              <p className="tasks-warning tasks-wizard-schedule-alert">
                El colaborador seleccionado no esta disponible en esta fecha: {availability[baseCandidates.find((employee) => employee.taskId === assigneeId)?.profileId]}.
              </p>
            )}
          </div>
        )}

        {step === 4 && (
          <div className="tasks-wizard-body">
            <p className="tasks-wizard-intro">Revisa el resumen antes de guardar.</p>
            <div className="tasks-confirm-list">
              <div><span>Tarea</span><strong>{template.title}</strong></div>
              <div><span>Asignado a</span><strong>{selectedEmployee?.name || "Sin seleccionar"}</strong></div>
              <div><span>Fecha de ejecucion</span><strong>{formatTaskDate(date)}</strong></div>
              <div><span>Hora de inicio</span><strong>{formatOperationalTime(startTime)}</strong></div>
              <div><span>Limite</span><strong>{dueAtPreview ? formatTaskDueAt({ due_at: dueAtPreview }) : "Sin definir"}</strong></div>
              <div><span>Prioridad</span><strong>{getTaskOptionLabel(TASK_PRIORITIES, template.priority, template.priority)}</strong></div>
            </div>
            {validationError && <p className="tasks-warning">{validationError}</p>}
          </div>
        )}

        {error && <p className="tasks-warning">{error}</p>}

        <div className="tasks-wizard-actions">
          <button type="button" className="tasks-secondary" onClick={() => { if (step === 1) onClose(); else setStep((current) => current - 1) }} disabled={saving}>
            {step === 1 ? "Cancelar" : "Anterior"}
          </button>
          {step < 4 ? (
            <button
              type="button"
              className="tasks-primary"
              onClick={() => {
                if (step === 2 && !assigneeId) {
                  setError("Selecciona un colaborador para continuar.")
                  return
                }
                if (step === 3 && validationError) {
                  setError(validationError)
                  return
                }
                setError("")
                setStep((current) => current + 1)
              }}
              disabled={(step === 2 && !candidates.length) || (step === 3 && Boolean(validationError))}
            >
              Siguiente
            </button>
          ) : (
            <button type="button" className="tasks-primary" onClick={submitAssignment} disabled={saving || Boolean(validationError)}>
              {saving ? "Asignando..." : "Asignar tarea"}
            </button>
          )}
        </div>
      </section>
    </div>
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

function TaskAssignment({ templates, tasks, employees, areas, user, onAssigned, onNotifyAssignedTasks }) {
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
  async function automated() {
    if (!selection.length) return
    const result = assignTasksAutomatically(selection, employees, date, shift, areaId, tasks, user.name)
    onAssigned(result.assignedTasks)
    const notificationWarning = onNotifyAssignedTasks ? await onNotifyAssignedTasks(result.assignedTasks) : ""
    setWarnings(notificationWarning ? [...result.warnings, notificationWarning] : result.warnings)
    setSelected([])
  }
  async function manual() {
    if (!selection.length || !selectedEmployees.length) {
      setWarnings(["Selecciona al menos una tarea y un colaborador para asignar manualmente."])
      return
    }
    const created = assignTasksManually(selection, selectedEmployees, date, shift, user.name)
    onAssigned(created)
    const notificationWarning = onNotifyAssignedTasks ? await onNotifyAssignedTasks(created) : ""
    setWarnings(notificationWarning ? [notificationWarning] : [])
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
            <time>{formatOperationalTime(task.scheduledStart)}<small>{formatTaskDueAt(task)}</small></time>
            <div><strong>{task.title}</strong><span>{task.areaName} · {task.estimatedMinutes} min · Limite: {formatTaskDueAt(task)}</span></div>
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

function MyTasks({ initialTaskId = "", tasks, user, allTasks, persistAllTasks }) {
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [notes, setNotes] = useState("")
  const taskNotifications = loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user))
  const notifications = taskNotifications.filter((notification) => !notification.read)
  const selectedTask = tasks.find((task) => task.id === selectedTaskId)

  useEffect(() => {
    if (initialTaskId && tasks.some((task) => task.id === initialTaskId)) {
      const task = tasks.find((item) => item.id === initialTaskId)
      setSelectedTaskId(initialTaskId)
      setNotes(task?.completionNotes || "")
    }
  }, [initialTaskId, tasks])

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
  async function complete(task) {
    if (task.checklistItems?.some((item) => !item.completed)) return window.alert("Completa todos los pasos del checklist antes de terminar.")
    if (task.evidenceRequired && !task.evidenceFiles?.length) return window.alert("Adjunta evidencia antes de completar esta tarea.")
    const yieldIds = task.yieldRequiredItemIds || []
    const requiresYieldChecklist = (task.checklistItems || []).some((item) => String(item.text || "").toLowerCase().includes("registrar rendimiento"))
    if (yieldIds.length || requiresYieldChecklist) {
      const idsToVerify = yieldIds.length ? yieldIds : []
      for (const itemId of idsToVerify) {
        const { data: hasAudit, error: auditError } = await hasYieldAuditForTask(task.id, itemId)
        if (auditError) return window.alert("No se pudo verificar la auditoría de rendimiento. Intenta de nuevo.")
        if (!hasAudit) return window.alert("Debes registrar el rendimiento antes de cerrar esta tarea.")
      }
      if (!idsToVerify.length && requiresYieldChecklist) {
        return window.alert("Esta tarea requiere registrar rendimiento. Usa el formulario en Tareas → Formulario rendimiento y vincúlalo a esta tarea.")
      }
    }
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
                  <strong>{task.title}</strong>
                  <small>{task.date} · {task.areaName} · {task.estimatedMinutes} min</small>
                  <small className="tasks-own-deadline">Limite: {formatTaskDueAt(task)}</small>
                  <div className="tasks-own-card-badges">
                    {task.status === "late" && <Badge type="status" value="late" />}
                    <Badge type="priority" value={task.priority} />
                  </div>
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
          <div className="tasks-card-badges">
            <Badge type="status" value={selectedTask.status} />
            <Badge type="priority" value={selectedTask.priority} />
            {selectedTask.status === "late" && <Badge type="status" value="late" />}
          </div>
          <p className="tasks-muted">Limite: {formatTaskDueAt(selectedTask)}</p>
          {selectedTask.status === "pending" && <button className="tasks-primary" type="button" onClick={() => start(selectedTask)}>Iniciar tarea</button>}
          <h3>Checklist</h3>
          {(selectedTask.checklistItems || []).map((item) => (
            <label className="tasks-check-item" key={item.id}><input type="checkbox" checked={item.completed} disabled={selectedTask.status === "completed"} onChange={() => toggleChecklist(selectedTask, item.id)} />{item.text}</label>
          ))}
          {(selectedTask.yieldRequiredItemIds?.length || (selectedTask.checklistItems || []).some((item) => String(item.text || "").toLowerCase().includes("registrar rendimiento"))) && selectedTask.status !== "completed" && (
            <div className="tasks-evidence">
              <strong>Rendimiento obligatorio</strong>
              <p className="tasks-muted">Registra la auditoría de rendimiento antes de cerrar esta tarea.</p>
              <YieldAuditFormPanel
                compact
                taskId={selectedTask.id}
                requiredItemIds={selectedTask.yieldRequiredItemIds || []}
                onSaved={() => {
                  updateOwn(selectedTask.id, (current) => ({
                    ...current,
                    checklistItems: (current.checklistItems || []).map((item) => (
                      String(item.text || "").toLowerCase().includes("registrar rendimiento")
                        ? { ...item, completed: true }
                        : item
                    ))
                  }))
                }}
              />
            </div>
          )}
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
  const checklistPerms = resolveChecklistLibraryPermissions(userRole)
  const {
    canViewChecklistLibrary,
    canCreateDirectly,
    canEditDirectly,
    canAssignChecklists,
    canApproveTemplateChanges,
    isSupervisorOnly,
    canProposeEdits,
    canDeleteTemplates,
    isLibraryAdmin
  } = checklistPerms
  const canCreateChecklists = canCreateDirectly
  const canEditChecklistsDirectly = canEditDirectly
  const canManageManagementAlerts = ["admin", "gerente_general"].includes(userRole)
  const canManageCoverage = ["admin", "gerente_general", "gerente", "supervisor", "recursos_humanos", "rrhh"].includes(userRole)
  const [section, setSection] = useState(initialChecklistView === "incidents" ? "incidents" : initialChecklistView === "alerts" ? "alerts" : "today")
  const [templates, setTemplates] = useState([])
  const [runs, setRuns] = useState([])
  const [incidents, setIncidents] = useState([])
  const [managementAlerts, setManagementAlerts] = useState([])
  const [changeRequests, setChangeRequests] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")
  const [editingTemplate, setEditingTemplate] = useState(null)
  const [selectedRunId, setSelectedRunId] = useState("")
  const [selectedIncidentId, setSelectedIncidentId] = useState(initialChecklistView === "incidents" ? initialRunId : "")
  const [selectedAlertId, setSelectedAlertId] = useState(initialChecklistView === "alerts" ? initialRunId : "")
  const [createWizardOpen, setCreateWizardOpen] = useState(false)
  const [coverageByRunId, setCoverageByRunId] = useState({})
  const [detailReturnSection, setDetailReturnSection] = useState(null)
  const [, setChecklistSearchParams] = useSearchParams()
  const sectionRef = useRef(section)
  const deepLinkRunHandledRef = useRef(false)
  const runDetailDismissedRef = useRef(false)
  const sessionRestoreHandledRef = useRef(false)
  sectionRef.current = section
  const stableUserRef = useRef(user)
  useEffect(() => {
    if (user) stableUserRef.current = user
  }, [user])
  const stableUser = user || stableUserRef.current
  const selectedRun = runs.find((run) => run.id === selectedRunId)
  const activeTemplates = templates.filter((template) => template.status === "active")
  const visibleRuns = runs.filter((run) => run.status !== "cancelled" && canSeeChecklistRun(run, user, profiles))
  const logChecklistAudit = useCallback(async (eventType, runId, details = {}) => {
    const meta = runId ? getChecklistRunMeta(runId) : null
    const profileId = user?.id || getLastActiveChecklistSession()?.profileId || null
    const localEntry = appendLocalChecklistAudit({
      eventType,
      runId,
      profileId,
      details: {
        ...details,
        lastSuccessfulAutosaveAt: meta?.lastSuccessfulAutosaveAt || null,
        lastLocalSaveAt: meta?.lastLocalSaveAt || null
      }
    })
    if (!profileId) return localEntry
    logChecklistSessionAudit({
      profileId,
      runId,
      eventType,
      details: { ...details, localAuditId: localEntry.id, lastSuccessfulAutosaveAt: meta?.lastSuccessfulAutosaveAt || null }
    }).catch(() => {})
    return localEntry
  }, [user?.id])

  const mergeRunsWithLocalDrafts = useCallback((nextRuns = []) => (
    nextRuns.map((run) => mergeRunWithLocalDrafts(run, listChecklistDraftsForRun(run.id)))
  ), [])

  const replayPendingChecklistDrafts = useCallback(async (nextRuns = []) => {
    const drafts = listAllUnsyncedChecklistDrafts(user?.id)
    const retryQueue = listChecklistRetryQueue(user?.id)
    const pendingEntries = [
      ...drafts,
      ...retryQueue.map((entry) => ({
        runId: entry.runId,
        itemId: entry.itemId,
        payload: entry.payload,
        profileId: entry.profileId
      }))
    ]
    if (!pendingEntries.length) return mergeRunsWithLocalDrafts(nextRuns)

    let mergedRuns = mergeRunsWithLocalDrafts(nextRuns)
    for (const draft of pendingEntries) {
      const run = mergedRuns.find((item) => item.id === draft.runId)
      if (!run) continue
      const payload = hydrateDraftPayload(draft.runId, draft.itemId, draft.payload)
      const result = await updateChecklistRunItem(draft.itemId, payload)
      if (result.error) {
        enqueueChecklistRetry({
          runId: draft.runId,
          itemId: draft.itemId,
          payload: draft.payload,
          profileId: draft.profileId || user?.id || null,
          attempts: Number(draft.attempts || 0) + 1,
          lastError: result.error.message || "autosave_failed"
        })
        await logChecklistAudit("autosave_retry_failed", draft.runId, {
          itemId: draft.itemId,
          error: result.error.message || "autosave_failed"
        })
        continue
      }
      markChecklistItemDraftSynced(draft.runId, draft.itemId)
      removeChecklistRetry(draft.runId, draft.itemId)
      recordChecklistSuccessfulAutosave(draft.runId, user?.id)
      mergedRuns = mergedRuns.map((item) => (
        item.id === draft.runId
          ? {
            ...item,
            checklist_run_items: (item.checklist_run_items || []).map((runItem) => (
              runItem.id === draft.itemId ? { ...runItem, ...result.data } : runItem
            ))
          }
          : item
      ))
    }
    return mergeRunsWithLocalDrafts(mergedRuns)
  }, [logChecklistAudit, mergeRunsWithLocalDrafts, user?.id])

  const closeRunDetail = useCallback(() => {
    runDetailDismissedRef.current = true
    deepLinkRunHandledRef.current = true
    const returnSection = detailReturnSection || sectionRef.current
    setSelectedRunId("")
    setDetailReturnSection(null)
    if (user?.id) clearActiveChecklistSession(user?.id)
    if (returnSection) setSection(returnSection)
    setChecklistSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete("id")
      if (next.get("view") === "run") next.delete("view")
      if (!next.get("tab") && !next.get("view")) next.set("tab", "checklists")
      return next
    }, { replace: true })
  }, [detailReturnSection, setChecklistSearchParams, user?.id])

  const selectRun = useCallback((runId, originSection) => {
    if (!runId) {
      closeRunDetail()
      return
    }
    runDetailDismissedRef.current = false
    setDetailReturnSection(originSection || sectionRef.current)
    setSelectedRunId(runId)
    if (!user?.id) return
    const run = runs.find((item) => item.id === runId)
    persistActiveChecklistSession(user.id, runId, {
      templateTitle: run?.checklist_templates?.title || "",
      area: run?.area || ""
    })
  }, [closeRunDetail, runs, user?.id])
  const sections = useMemo(() => {
    const todayCount = dedupeLogicalChecklistRuns(visibleRuns).filter(isChecklistRunTodayWork).length
    const overdueCount = visibleRuns.filter(isChecklistRunHistoricPending).length
    const completedCount = visibleRuns.filter(isChecklistRunCompleted).length
    return [
      ["today", todayCount ? `Hoy (${todayCount})` : "Hoy"],
      ["overdue", overdueCount ? `Vencidas (${overdueCount})` : "Vencidas"],
      ["completed", completedCount ? `Completadas (${completedCount})` : "Completadas"],
      ...(canViewChecklistLibrary ? [["templates", "Checklists"]] : []),
      ...(canCreateDirectly || canProposeEdits || editingTemplate ? [["create", editingTemplate ? "Editar checklist" : "Crear checklist"]] : []),
      ...(canManageManagementAlerts ? [["alerts", "Avisos a Gerencia"]] : []),
      ...(canViewChecklistLibrary ? [
        ["incidents", "Incidencias"],
        ["approvals", canApproveTemplateChanges ? "Aprobaciones de plantillas" : "Mis solicitudes"],
        ["reports", "Reportes"]
      ] : [])
    ]
  }, [
    visibleRuns,
    canViewChecklistLibrary,
    canCreateDirectly,
    canProposeEdits,
    editingTemplate,
    canManageManagementAlerts,
    canApproveTemplateChanges
  ])

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      if (isLibraryAdmin) await generateDueChecklistRuns(TODAY)
      if (canManageManagementAlerts) await notifyOverdueChecklistRuns()
      if (canManageCoverage) await processChecklistCoverage()
      const libraryRequests = canViewChecklistLibrary
        ? [
          getChecklistTemplates(),
          getChecklistIncidents(),
          getChecklistChangeRequests(),
          getChecklistTemplateSuggestions()
        ]
        : []
      const requests = [...libraryRequests, getChecklistRuns(), getChecklistProfiles()]
      if (canManageManagementAlerts) requests.push(getChecklistManagementAlerts())
      const results = await Promise.all(requests)
      const templateResult = libraryRequests.length ? results[0] : { data: [], error: null }
      const incidentResult = libraryRequests.length ? results[1] : { data: [], error: null }
      const requestResult = libraryRequests.length ? results[2] : { data: [], error: null }
      const suggestionResult = libraryRequests.length ? results[3] : { data: [], error: null }
      const runResult = results[libraryRequests.length]
      const profileResult = results[libraryRequests.length + 1]
      const alertResult = canManageManagementAlerts ? results[libraryRequests.length + 2] : null
      if (templateResult.error || runResult.error || incidentResult.error || requestResult.error || suggestionResult.error || alertResult?.error) {
        if (!silent) {
          setMessage(templateResult.error?.message || runResult.error?.message || incidentResult.error?.message || requestResult.error?.message || suggestionResult.error?.message || alertResult?.error?.message || "No se pudieron cargar checklists.")
        }
        return { runs: [], error: templateResult.error || runResult.error || incidentResult.error || requestResult.error || suggestionResult.error || alertResult?.error }
      }

      setTemplates(templateResult.data || [])
      const syncedRuns = await replayPendingChecklistDrafts(runResult.data || [])
      setRuns(syncedRuns)
      const activeRunIds = syncedRuns
        .filter((run) => run.status !== "cancelled" && canSeeChecklistRun(run, user, profileResult.data || profiles))
        .filter((run) => isChecklistRunTodayWork(run) || isChecklistRunHistoricPending(run))
        .map((run) => run.id)
      const coverageResult = await getChecklistCoverageForRuns(activeRunIds)
      if (!coverageResult.error) {
        setCoverageByRunId(buildChecklistCoverageMap(coverageResult.data))
      }
      setIncidents(incidentResult.data || [])
      setChangeRequests(requestResult.data || [])
      setSuggestions(suggestionResult.data || [])
      if (alertResult) setManagementAlerts(alertResult.data || [])
      if (!profileResult.error) setProfiles(profileResult.data || [])
      return { runs: syncedRuns, error: null }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [canManageCoverage, canManageManagementAlerts, canViewChecklistLibrary, isLibraryAdmin, profiles, replayPendingChecklistDrafts, user])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  const realtimeRefreshTimerRef = useRef(null)

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => installChecklistLifecycleGuards(), [])

  useEffect(() => {
    if (initialRunId || !user?.id || runDetailDismissedRef.current || sessionRestoreHandledRef.current) return
    if (selectedRunId) return
    const activeSession = getActiveChecklistSession(user.id)
    if (!activeSession?.runId) return
    const run = runs.find((item) => item.id === activeSession.runId)
    if (!run) return
    sessionRestoreHandledRef.current = true
    if (isChecklistRunHistoricPending(run)) {
      setSection("overdue")
      setDetailReturnSection("overdue")
    } else if (isChecklistRunCompleted(run)) {
      setSection("completed")
      setDetailReturnSection("completed")
    } else {
      setSection("today")
      setDetailReturnSection("today")
    }
    setSelectedRunId(activeSession.runId)
  }, [initialRunId, user?.id, runs, selectedRunId])

  useEffect(() => {
    if (deepLinkRunHandledRef.current || runDetailDismissedRef.current) return
    if (!initialRunId || ["incidents", "alerts"].includes(initialChecklistView)) return
    const run = runs.find((item) => item.id === initialRunId)
    if (!run) return
    deepLinkRunHandledRef.current = true
    if (isChecklistRunHistoricPending(run)) {
      setSection("overdue")
      setDetailReturnSection("overdue")
    } else if (isChecklistRunCompleted(run)) {
      setSection("completed")
      setDetailReturnSection("completed")
    } else {
      setSection("today")
      setDetailReturnSection("today")
    }
    setSelectedRunId(initialRunId)
    if (user?.id) {
      persistActiveChecklistSession(user.id, initialRunId, {
        templateTitle: run.checklist_templates?.title || "",
        area: run.area || ""
      })
    }
  }, [initialRunId, initialChecklistView, runs, user?.id])

  useEffect(() => {
    if (section === "create") setCreateWizardOpen(true)
  }, [section])

  const selectedRunIdRef = useRef(selectedRunId)
  selectedRunIdRef.current = selectedRunId

  useEffect(() => {
    async function handleSessionInterrupted(event) {
      const runId = selectedRunIdRef.current || getLastActiveChecklistSession()?.runId
      if (!runId) return
      await flushAllChecklistPendingSaves()
      logChecklistAudit("session_interrupted", runId, {
        reason: event?.detail?.reason || "unknown",
        message: event?.detail?.message || ""
      })
    }
    window.addEventListener("auth:session-interrupted", handleSessionInterrupted)
    return () => window.removeEventListener("auth:session-interrupted", handleSessionInterrupted)
  }, [logChecklistAudit])

  const scheduleRealtimeRefresh = useCallback(() => {
    window.clearTimeout(realtimeRefreshTimerRef.current)
    realtimeRefreshTimerRef.current = window.setTimeout(() => {
      refreshRef.current({ silent: true })
    }, 450)
  }, [])

  useSupabaseRealtime({
    table: "checklist_runs",
    event: "*",
    enabled: true,
    onChange: scheduleRealtimeRefresh
  })
  useSupabaseRealtime({
    table: "checklist_run_items",
    event: "*",
    enabled: true,
    onChange: scheduleRealtimeRefresh
  })

  useEffect(() => {
    if (initialChecklistView !== "approvals") return
    setSection("approvals")
  }, [initialChecklistView])

  useEffect(() => {
    if (initialChecklistView !== "incidents") return
    setSection("incidents")
    if (initialRunId) setSelectedIncidentId(initialRunId)
  }, [initialChecklistView, initialRunId])

  useEffect(() => {
    if (initialChecklistView !== "alerts") return
    setSection("alerts")
    if (initialRunId) setSelectedAlertId(initialRunId)
  }, [initialChecklistView, initialRunId])

  async function saveTemplate(form, items, options = {}) {
    const templateId = options.templateId || editingTemplate?.id || null
    if (!form.title.trim()) {
      return { ok: false, error: "Falta el campo obligatorio: Nombre." }
    }
    if (!items.some((item) => item.title.trim())) {
      return { ok: false, error: "Agrega al menos 1 item con titulo antes de guardar." }
    }
    if (form.frequency === "semanal" && !normalizeChecklistWeekdays(form.recurrence_days).length) {
      return { ok: false, error: "Debe seleccionar al menos un dia de ejecucion para una checklist semanal." }
    }

    setLoading(true)
    const cleanedItems = items.filter((item) => item.title.trim())

    try {
      if (isSupervisorOnly) {
        const payload = {
          ...form,
          template_id: templateId,
          request_type: templateId ? "update" : "create",
          status_after_approval: form.status || "active"
        }
        const existingDraft = templateId
          ? changeRequests.find((request) => request.template_id === templateId && ["draft", "rejected"].includes(request.status))
          : changeRequests.find((request) =>
            request.request_type === "create" &&
            !request.template_id &&
            request.submitted_by === user?.id &&
            ["draft", "rejected"].includes(request.status)
          )
        const draftResult = existingDraft
          ? await updateChecklistChangeRequest(existingDraft.id, payload, cleanedItems)
          : await createChecklistChangeRequest(payload, cleanedItems)

        if (draftResult.error) {
          return { ok: false, error: draftResult.error.message || "No se pudo guardar el borrador." }
        }

        if (options.saveDraft) {
          setEditingTemplate(null)
          setSection("approvals")
          await refresh()
          const successMessage = templateId ? "Borrador de cambios actualizado." : "Borrador de checklist guardado."
          setMessage(successMessage)
          return { ok: true, message: successMessage }
        }

        const submitResult = await submitChecklistChangeRequest(draftResult.data.id)
        if (submitResult.error) {
          return { ok: false, error: submitResult.error.message || "No se pudo mandar a verificacion." }
        }
        setEditingTemplate(null)
        setSection("approvals")
        await refresh()
        const successMessage = templateId
          ? "Tu checklist tiene cambios pendientes de aprobacion. Gerencia, RRHH o admin deben autorizarlos antes de usarlos."
          : "Tu checklist esta pendiente de aprobacion. Podras asignarla y utilizarla cuando gerencia, RRHH o admin la autoricen."
        setMessage(successMessage)
        return { ok: true, message: successMessage }
      }

      const result = templateId
        ? await updateChecklistTemplate(templateId, form, cleanedItems)
        : await createChecklistTemplate(form, cleanedItems)

      if (result.error) {
        return { ok: false, error: result.error.message || "No se pudo guardar la plantilla." }
      }

      setEditingTemplate(null)
      setSection("templates")
      await refresh()
      let successMessage = templateId ? "Checklist actualizado correctamente." : "Checklist creado correctamente."
      if (templateId) {
        if (result.syncWarning) {
          successMessage = result.syncWarning
        } else if (Number(result.reopenedRuns || 0) > 0) {
          successMessage = `Checklist actualizada. ${result.reopenedRuns} asignacion(es) en Hoy se reabrieron porque tienen items nuevos por completar.`
        } else if (Number(result.syncedRuns || 0) > 0) {
          successMessage = `Checklist actualizada. ${result.syncedRuns} asignacion(es) activa(s) en Hoy tambien se actualizaron.`
        } else {
          const { hasRuns } = await checkTemplateHasRuns(templateId)
          if (hasRuns) {
            successMessage = "Checklist actualizada correctamente. El historial completado se conserva."
          }
        }
      }
      setMessage(successMessage)
      return { ok: true, message: successMessage, data: result.data }
    } finally {
      setLoading(false)
    }
  }

  async function assignTemplate(payload) {
    if (!payload.template_id) return setMessage("Selecciona una plantilla.")
    const template = templates.find((item) => item.id === payload.template_id)
    const pendingRequest = template ? getTemplatePendingRequest(template, changeRequests) : null
    if (pendingRequest?.status === "pending_review") {
      return setMessage("Esta checklist tiene cambios pendientes de aprobacion. No se puede asignar ni utilizar hasta que gerencia, RRHH o admin la autoricen.")
    }
    if (template?.status !== "active") {
      return setMessage("Esta checklist aun no esta activa. Espera la aprobacion antes de asignarla.")
    }
    setLoading(true)
    try {
      const result = await createChecklistRunFromTemplate(payload.template_id, payload)
      if (result.error) {
        console.error("Checklist assignment error:", result.error)
        setMessage("No se pudo asignar la checklist.")
        return { ok: false, error: result.error }
      }

      const assignedRun = result.data
      const runDate = assignedRun?.run_date || payload.run_date || TODAY
      const validationErrors = validateChecklistAssignmentResult(assignedRun, payload, { existing: assignedRun?.existedAlready })
      if (validationErrors.length) {
        console.error("Checklist assignment validation failed:", { errors: validationErrors, run: assignedRun, payload })
        setMessage("No se pudo asignar la checklist.")
        return { ok: false, error: new Error(validationErrors.join(", ")) }
      }

      const refreshResult = await refresh()
      const freshRun = refreshResult?.runs?.find((run) => run.id === assignedRun.id) || assignedRun
      setSelectedRunId(freshRun.id)
      let successMessage = ""
      if (runDate === TODAY) {
        setSection("today")
        successMessage = assignedRun.existedAlready ? "Esta checklist ya está asignada para hoy." : "Checklist asignada correctamente."
      } else {
        setSection("templates")
        successMessage = `Checklist asignada para ${formatChecklistRunDateLabel(runDate)}.`
      }
      setMessage(successMessage)
      return { ok: true, message: successMessage, data: freshRun }
    } catch (error) {
      console.error("Checklist assignment error:", error)
      setMessage("No se pudo asignar la checklist.")
      return { ok: false, error }
    } finally {
      setLoading(false)
    }
  }

  async function duplicateTemplate(template) {
    if (!canCreateDirectly) return setMessage("No tienes permiso para duplicar plantillas.")
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

  async function reactivate(id) {
    const result = await reactivateChecklistTemplate(id)
    if (result.error) return setMessage(result.error.message || "No se pudo reactivar la checklist.")
    setMessage("Checklist reactivada correctamente.")
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
    selectRun(runId, sectionRef.current)
    refresh()
  }

  async function removeTemplateWithArchiveUX(template) {
    const hasHistory = runs.some((run) => run.template_id === template.id)
    const confirmationMessage = hasHistory
      ? "¿Estás seguro de eliminar esta checklist?\n\nSe perderán los datos por completo: plantilla, historial, ejecuciones en Hoy, incidencias y reportes asociados.\n\nEsta acción no se puede deshacer."
      : "¿Estás seguro de eliminar esta checklist?\n\nSe perderán los datos por completo. Esta acción no se puede deshacer."
    const confirmed = window.confirm(confirmationMessage)
    if (!confirmed) return

    const result = await deleteChecklistTemplate(template.id, { force: true })
    if (result.error) {
      return setMessage(result.error.message || "No se pudo eliminar la checklist. Verifica que la migración 069 esté aplicada en Supabase.")
    }

    setTemplates((current) => current.filter((item) => item.id !== template.id))
    setRuns((current) => current.filter((run) => run.template_id !== template.id))
    setMessage(hasHistory
      ? "Checklist eliminada definitivamente junto con su historial."
      : "Checklist eliminada.")
    refresh()
  }

  async function updateRunItem(itemId, payload) {
    const run = runs.find((entry) => (entry.checklist_run_items || []).some((item) => item.id === itemId))
    const runId = run?.id
    if (runId) {
      persistChecklistItemDraft({
        runId,
        itemId,
        payload,
        profileId: user?.id,
        meta: {
          templateTitle: run?.checklist_templates?.title || "",
          area: run?.area || ""
        }
      })
      touchActiveChecklistSession(user?.id, runId)
    }

    const result = await updateChecklistRunItem(itemId, payload)
    if (result.error) {
      if (runId) {
        enqueueChecklistRetry({
          runId,
          itemId,
          payload,
          profileId: user?.id || null,
          attempts: 1,
          lastError: result.error.message || "autosave_failed"
        })
      }
      await logChecklistAudit("autosave_failed", runId, {
        itemId,
        error: result.error.message || "autosave_failed"
      })
      setMessage(result.error.message || "No se pudo guardar el progreso.")
      return result
    }

    if (runId) {
      markChecklistItemDraftSynced(runId, itemId)
      removeChecklistRetry(runId, itemId)
      recordChecklistSuccessfulAutosave(runId, user?.id)
      await logChecklistAudit("autosave_success", runId, { itemId })
    }

    setRuns((current) => current.map((entry) => ({
      ...entry,
      checklist_run_items: (entry.checklist_run_items || []).map((item) => item.id === itemId ? { ...item, ...result.data } : item)
    })))
    return result
  }

  async function updateIncidentStatus(incidentId, status, notes = "") {
    const result = await updateChecklistIncidentStatus(incidentId, status, notes)
    if (result.error) return setMessage(result.error.message || "No se pudo actualizar la incidencia.")
    setMessage(status === "resolved" ? "Incidencia resuelta." : "Incidencia actualizada.")
    refresh()
  }

  async function updateManagementAlertStatus(alertId, status, notes = "") {
    const result = await updateChecklistManagementAlertStatus(alertId, status, notes)
    if (result.error) return setMessage(result.error.message || "No se pudo actualizar el aviso.")
    setMessage(status === "resolved" ? "Aviso resuelto." : "Aviso actualizado.")
    refresh()
  }

  async function completeRun(runId) {
    await flushAllChecklistPendingSaves()
    const result = await completeChecklistRun(runId)
    if (result.error) return setMessage(result.error.message || "Completa los items obligatorios antes de finalizar.")
    clearActiveChecklistSession(user?.id, runId)
    setMessage("Checklist completada correctamente.")
    closeRunDetail()
    refresh()
  }

  async function assignRunReplacement(runId, payload) {
    const result = await assignChecklistRunReplacement(
      runId,
      payload.replacementProfileId,
      payload.reason,
      payload.notes
    )
    if (result.error) {
      setMessage(result.error.message || "No se pudo asignar el reemplazo.")
      return { error: result.error }
    }
    await logChecklistAudit("run_replacement", runId, {
      replacementProfileId: payload.replacementProfileId,
      reason: payload.reason
    })
    setMessage("Reemplazo asignado correctamente.")
    await refresh({ silent: true })
    if (result.data?.id) setSelectedRunId(result.data.id)
    return { data: result.data }
  }

  const canAssignRunReplacement = useCallback((run) => {
    if (!run || ["completed", "cancelled"].includes(run.status)) return false
    return ["admin", "gerente_general", "gerente", "supervisor", "recursos_humanos", "rrhh"].includes(userRole)
  }, [userRole])

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

      {message && <p className={message.includes("correctamente") || message.includes("asignada") || message.includes("guardad") || message.includes("enviad") || message.includes("actualizad") ? "tasks-success" : "tasks-warning"} role="status">{message}</p>}

      <nav className="checklists-main-tabs" aria-label="Checklists">
        {sections.map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={section === id ? "active" : ""}
            onClick={() => {
              if (id === "create" && !editingTemplate) setEditingTemplate(null)
              closeRunDetail()
              setSection(id)
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {section === "today" && (
        <ChecklistToday
          runs={visibleRuns}
          profiles={profiles}
          selectedRun={selectedRun && isChecklistRunTodayWork(selectedRun) ? selectedRun : null}
          onSelect={(runId) => (runId ? selectRun(runId, "today") : closeRunDetail())}
          onStart={startRun}
          onUpdateItem={updateRunItem}
          onComplete={completeRun}
          onAssignReplacement={assignRunReplacement}
          canAssignReplacement={canAssignRunReplacement}
          coverageByRunId={coverageByRunId}
          currentUser={user}
        />
      )}
      {section === "overdue" && (
        <ChecklistOverdue
          runs={visibleRuns}
          profiles={profiles}
          selectedRun={selectedRun && isChecklistRunHistoricPending(selectedRun) ? selectedRun : null}
          onSelect={(runId) => (runId ? selectRun(runId, "overdue") : closeRunDetail())}
          onStart={startRun}
          onUpdateItem={updateRunItem}
          onComplete={completeRun}
          onAssignReplacement={assignRunReplacement}
          canAssignReplacement={canAssignRunReplacement}
          coverageByRunId={coverageByRunId}
          currentUser={user}
        />
      )}
      {section === "completed" && (
        <ChecklistCompleted
          runs={visibleRuns}
          profiles={profiles}
          selectedRun={selectedRun && isChecklistRunCompleted(selectedRun) ? selectedRun : null}
          onSelect={(runId) => (runId ? selectRun(runId, "completed") : closeRunDetail())}
          onUpdateItem={updateRunItem}
          onComplete={completeRun}
          onAssignReplacement={assignRunReplacement}
          canAssignReplacement={canAssignRunReplacement}
          coverageByRunId={coverageByRunId}
          currentUser={user}
        />
      )}
      {section === "templates" && canViewChecklistLibrary && (
        <ChecklistTemplatesView
          templates={templates}
          changeRequests={changeRequests}
          profiles={profiles}
          currentUser={user}
          userRole={userRole}
          isLibraryAdmin={isLibraryAdmin}
          isSupervisorOnly={isSupervisorOnly}
          onEdit={(template) => { setEditingTemplate(template); setSection("create") }}
          onEditRequest={(request) => {
            if (request.template_id) {
              const template = templates.find((item) => item.id === request.template_id)
              if (template) {
                setEditingTemplate(template)
                setSection("create")
                return
              }
            }
            setEditingTemplate({
              id: "",
              title: request.title,
              description: request.description,
              area: request.area,
              assigned_role: request.assigned_role,
              assigned_profile_id: request.assigned_profile_id,
              frequency: request.frequency,
              shift_context: request.shift_context,
              status: request.status_after_approval || "active",
              checklist_template_items: request.items_snapshot || []
            })
            setSection("create")
          }}
          onAssign={assignTemplate}
          onDuplicate={duplicateTemplate}
          onDeactivate={deactivate}
          onReactivate={reactivate}
          onDelete={removeTemplateWithArchiveUX}
          canDelete={canDeleteTemplates}
          canEdit={canEditChecklistsDirectly}
          canProposeEdits={canProposeEdits}
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
      {section === "create" && (canCreateDirectly || canProposeEdits || editingTemplate || createWizardOpen) && (
        <ChecklistTemplateWizard
          key={editingTemplate?.id || "new-checklist-template"}
          templateId={editingTemplate?.id || ""}
          editingTemplate={editingTemplate}
          profiles={profiles}
          profileId={stableUser?.id || ""}
          onCancel={() => { clearChecklistWizardDraft(stableUser?.id || "", editingTemplate?.id || "new"); setCreateWizardOpen(false); setEditingTemplate(null); setSection("templates") }}
          onSave={saveTemplate}
          approvalMode={isSupervisorOnly}
          canConfigureCoverage={canManageCoverage}
        />
      )}
      {section === "alerts" && canManageManagementAlerts && (
        <ChecklistManagementAlertsView
          alerts={managementAlerts}
          profiles={profiles}
          selectedAlertId={selectedAlertId}
          onSelect={setSelectedAlertId}
          onStatus={updateManagementAlertStatus}
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
          suggestions={suggestions}
          templates={templates}
          profiles={profiles}
          initialRequestId={initialChecklistView === "approvals" ? initialRunId : ""}
          onApprove={async (request, notes) => {
            const result = await approveChecklistChangeRequest(request.id, notes)
            if (result.error) return setMessage(result.error.message || "No se pudo aprobar la solicitud.")
            setMessage(
              request.request_type === "update"
                ? "Cambios aprobados. La plantilla y las checklists activas en Hoy ya estan actualizadas."
                : "Checklist aprobada. El supervisor ya puede asignarla y utilizarla."
            )
            refresh()
          }}
          onReject={async (request, notes) => {
            if (!notes.trim()) return setMessage("La nota de rechazo es obligatoria.")
            const result = await rejectChecklistChangeRequest(request.id, notes)
            if (result.error) return setMessage(result.error.message || "No se pudo rechazar la solicitud.")
            setMessage("Solicitud rechazada.")
            refresh()
          }}
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
          onEditRequest={(request) => {
            if (request.template_id) {
              const template = templates.find((item) => item.id === request.template_id)
              if (template) {
                setEditingTemplate(template)
                setSection("create")
                return
              }
            }
            setEditingTemplate({
              id: "",
              title: request.title,
              description: request.description,
              area: request.area,
              assigned_role: request.assigned_role,
              assigned_profile_id: request.assigned_profile_id,
              frequency: request.frequency,
              shift_context: request.shift_context,
              status: request.status_after_approval || "active",
              checklist_template_items: request.items_snapshot || []
            })
            setSection("create")
          }}
          canApprove={canApproveTemplateChanges}
          isSupervisorOnly={isSupervisorOnly}
          currentUserId={user?.id}
        />
      )}
      {section === "reports" && canViewChecklistLibrary && <ChecklistReports runs={visibleRuns} templates={templates} profiles={profiles} />}
    </div>
  )
}

function ChecklistRunDetailShell({
  backLabel,
  summary,
  selectedRun,
  profiles,
  currentUser,
  onSelect,
  onUpdateItem,
  onComplete,
  onAssignReplacement,
  canAssignReplacement,
  coverageByRunId,
  children
}) {
  if (selectedRun) {
    const coverage = coverageByRunId?.[selectedRun.id]
    return (
      <>
        <div className="checklist-today-toolbar">
          <button type="button" className="checklist-back-button" onClick={() => onSelect("")}>
            {backLabel}
          </button>
          {summary ? <span className="tasks-muted">{summary}</span> : null}
        </div>
        <ChecklistGuidedRun
          run={selectedRun}
          profiles={profiles}
          currentUser={currentUser}
          coverage={coverage}
          onClose={() => onSelect("")}
          onUpdateItem={onUpdateItem}
          onComplete={onComplete}
          onAssignReplacement={onAssignReplacement}
          canAssignReplacement={canAssignReplacement?.(selectedRun)}
        />
      </>
    )
  }
  return children
}

function ChecklistToday({
  runs,
  profiles,
  selectedRun,
  onSelect,
  onStart,
  onUpdateItem,
  onComplete,
  onAssignReplacement,
  canAssignReplacement,
  coverageByRunId,
  currentUser
}) {
  const todayRuns = useMemo(
    () => dedupeLogicalChecklistRuns(runs)
      .filter(isChecklistRunTodayWork)
      .sort((a, b) => {
        const statusOrder = {
          [CHECKLIST_OPERATIONAL_STATUS.VENCIDA]: 0,
          [CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA]: 1,
          in_progress: 2,
          pending: 3
        }
        const leftStatus = getChecklistOperationalDisplayStatus(a)
        const rightStatus = getChecklistOperationalDisplayStatus(b)
        const statusDiff = (statusOrder[leftStatus] ?? statusOrder[a.status] ?? 9) - (statusOrder[rightStatus] ?? statusOrder[b.status] ?? 9)
        if (statusDiff !== 0) return statusDiff
        return String(a.checklist_templates?.title || "").localeCompare(String(b.checklist_templates?.title || ""))
      }),
    [runs]
  )

  const pending = todayRuns.filter((run) => getChecklistOperationalDisplayStatus(run) === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE)
  const inProgress = todayRuns.filter((run) => run.status === "in_progress")
  const latePending = todayRuns.filter((run) => getChecklistOperationalDisplayStatus(run) === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA)
  const cards = [
    ["Pendientes", pending.length, "pending"],
    ["En progreso", inProgress.length, "in_progress"],
    ["Atrasadas", latePending.length, "late"]
  ]

  return (
    <div className="checklists-today">
      <ChecklistRunDetailShell
        backLabel="← Volver a checklists de hoy"
        summary={`${todayRuns.length} checklist${todayRuns.length === 1 ? "" : "s"} para hoy`}
        selectedRun={selectedRun}
        profiles={profiles}
        currentUser={currentUser}
        onSelect={onSelect}
        onUpdateItem={onUpdateItem}
        onComplete={onComplete}
        onAssignReplacement={onAssignReplacement}
        canAssignReplacement={canAssignReplacement}
        coverageByRunId={coverageByRunId}
      >
        {!selectedRun && (
          <div className="checklists-kpis">
            {cards.map(([label, value, tone]) => <article className={`checklists-kpi ${tone}`} key={label}><span>{label}</span><strong>{value}</strong></article>)}
          </div>
        )}
        {!selectedRun && (
          <div className="checklists-card-grid">
            {todayRuns.map((run) => (
              <ChecklistTodayCard
                key={run.id}
                run={run}
                profiles={profiles}
                coverage={coverageByRunId?.[run.id]}
                canAssignReplacement={canAssignReplacement?.(run)}
                onAssignReplacement={onAssignReplacement}
                onOpen={() => (run.status === "pending" ? onStart(run.id) : onSelect(run.id))}
              />
            ))}
            {!todayRuns.length && (
              <FriendlyEmpty
                title="No hay checklists para ejecutar hoy."
                text="Las asignaciones del día aparecerán aquí. Las vencidas de días anteriores están en la pestaña Vencidas."
              />
            )}
          </div>
        )}
      </ChecklistRunDetailShell>
    </div>
  )
}

function ChecklistOverdue({
  runs,
  profiles,
  selectedRun,
  onSelect,
  onStart,
  onUpdateItem,
  onComplete,
  onAssignReplacement,
  canAssignReplacement,
  coverageByRunId,
  currentUser
}) {
  const groupedRuns = useMemo(
    () => groupHistoricOverdueRuns(runs.filter(isChecklistRunHistoricPending), profiles),
    [runs, profiles]
  )
  const totalRuns = useMemo(
    () => groupedRuns.reduce((sum, group) => sum + group.dateGroups.reduce((inner, dateGroup) => inner + dateGroup.runs.length, 0), 0),
    [groupedRuns]
  )

  return (
    <div className="checklists-overdue">
      <ChecklistRunDetailShell
        backLabel="← Volver a vencidas"
        summary={`${totalRuns} corrida${totalRuns === 1 ? "" : "s"} histórica${totalRuns === 1 ? "" : "s"} pendientes`}
        selectedRun={selectedRun}
        profiles={profiles}
        currentUser={currentUser}
        onSelect={onSelect}
        onUpdateItem={onUpdateItem}
        onComplete={onComplete}
        onAssignReplacement={onAssignReplacement}
        canAssignReplacement={canAssignReplacement}
        coverageByRunId={coverageByRunId}
      >
        {!selectedRun && !groupedRuns.length ? (
          <FriendlyEmpty
            title="No hay checklists vencidas pendientes."
            text="Las corridas anteriores sin cerrar aparecerán aquí para seguimiento gerencial."
          />
        ) : null}
        {!selectedRun && groupedRuns.map((templateGroup) => (
          <section key={templateGroup.templateId} className="checklist-overdue-template">
            <header className="checklist-overdue-template__head">
              <div>
                <h3>{templateGroup.title}</h3>
                <p className="tasks-muted">
                  {templateGroup.dateGroups.length} fecha{templateGroup.dateGroups.length === 1 ? "" : "s"} · {templateGroup.totalRuns} corrida{templateGroup.totalRuns === 1 ? "" : "s"}
                </p>
              </div>
            </header>
            {templateGroup.dateGroups.map((dateGroup) => (
              <div key={`${templateGroup.templateId}-${dateGroup.runDate}`} className="checklist-overdue-date">
                <div className="checklist-overdue-date__head">
                  <strong>{formatChecklistRunDateLabel(dateGroup.runDate)}</strong>
                  <span>{historicOverdueDaysLabel(dateGroup.runDate)}</span>
                  <span className="checklist-overdue-date__count">
                    {dateGroup.runs.length} corrida{dateGroup.runs.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="checklists-card-grid checklist-overdue-date__grid">
                  {dateGroup.runs.map((run) => (
                    <ChecklistTodayCard
                      key={run.id}
                      run={run}
                      profiles={profiles}
                      variant="overdue"
                      onOpen={() => (["pending", "rejected"].includes(run.status) ? onStart(run.id) : onSelect(run.id))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </ChecklistRunDetailShell>
    </div>
  )
}

function ChecklistCompleted({
  runs,
  profiles,
  selectedRun,
  onSelect,
  onUpdateItem,
  onComplete,
  onAssignReplacement,
  canAssignReplacement,
  coverageByRunId,
  currentUser
}) {
  const [filters, setFilters] = useState({
    search: "",
    area: "",
    role: "",
    dateFrom: "",
    dateTo: ""
  })
  const [page, setPage] = useState(1)
  const completedPageSize = 24

  const roleOptions = useMemo(() => {
    const roles = new Set()
    runs.filter(isChecklistRunCompleted).forEach((run) => {
      if (run.assigned_role) roles.add(run.assigned_role)
    })
    return Array.from(roles).sort()
  }, [runs])

  const completedRuns = useMemo(() => {
    const search = normalizeChecklistSearchText(filters.search)
    return runs
      .filter(isChecklistRunCompleted)
      .filter((run) => matchesCompletedChecklistSearch(run, profiles, search))
      .filter((run) => !filters.area || run.area === filters.area)
      .filter((run) => !filters.role || run.assigned_role === filters.role)
      .filter((run) => {
        const runDate = run.run_date || ""
        if (filters.dateFrom && runDate < filters.dateFrom) return false
        if (filters.dateTo && runDate > filters.dateTo) return false
        return true
      })
      .sort((a, b) => (
        String(checklistCompletedSortKey(b)).localeCompare(String(checklistCompletedSortKey(a)))
      ))
  }, [runs, profiles, filters])

  const pagedRuns = useMemo(
    () => pageItems(completedRuns, page, completedPageSize),
    [completedRuns, page]
  )

  const hasActiveFilters = Boolean(
    filters.search || filters.area || filters.role || filters.dateFrom || filters.dateTo
  )

  useEffect(() => {
    setPage(1)
  }, [filters.search, filters.area, filters.role, filters.dateFrom, filters.dateTo])

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(completedRuns.length / completedPageSize))
    if (page > totalPages) setPage(totalPages)
  }, [completedRuns.length, page])

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }))
  }

  function clearFilters() {
    setFilters({ search: "", area: "", role: "", dateFrom: "", dateTo: "" })
  }

  return (
    <div className="checklists-completed">
      <ChecklistRunDetailShell
        backLabel="← Volver a completadas"
        summary={`${completedRuns.length} checklist${completedRuns.length === 1 ? "" : "s"} completada${completedRuns.length === 1 ? "" : "s"}`}
        selectedRun={selectedRun}
        profiles={profiles}
        currentUser={currentUser}
        onSelect={onSelect}
        onUpdateItem={onUpdateItem}
        onComplete={onComplete}
        onAssignReplacement={onAssignReplacement}
        canAssignReplacement={canAssignReplacement}
        coverageByRunId={coverageByRunId}
      >
        {!selectedRun && (
          <>
            <article className="tasks-panel checklist-completed-toolbar">
              <div className="tasks-panel-title">
                <div>
                  <h2>Buscar completadas</h2>
                  <p className="tasks-muted">
                    Mostrando {pagedRuns.length} de {completedRuns.length} en esta página
                  </p>
                </div>
                {hasActiveFilters ? (
                  <button type="button" className="tasks-secondary" onClick={clearFilters}>
                    Limpiar filtros
                  </button>
                ) : null}
              </div>
              <div className="tasks-filters checklist-completed-filters">
                <input
                  type="search"
                  value={filters.search}
                  onChange={(event) => updateFilter("search", event.target.value)}
                  placeholder="Checklist, colaborador o area..."
                />
                <select value={filters.area} onChange={(event) => updateFilter("area", event.target.value)}>
                  <option value="">Todas las areas</option>
                  {CHECKLIST_AREAS.map((area) => (
                    <option key={area} value={area}>{checklistAreaLabel(area)}</option>
                  ))}
                </select>
                {roleOptions.length > 0 ? (
                  <select value={filters.role} onChange={(event) => updateFilter("role", event.target.value)}>
                    <option value="">Todos los roles</option>
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>{formatChecklistRole(role)}</option>
                    ))}
                  </select>
                ) : null}
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => updateFilter("dateFrom", event.target.value)}
                  aria-label="Fecha desde"
                />
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => updateFilter("dateTo", event.target.value)}
                  aria-label="Fecha hasta"
                />
              </div>
            </article>

            <div className="checklists-card-grid">
              {pagedRuns.map((run) => (
                <ChecklistTodayCard
                  key={run.id}
                  run={run}
                  profiles={profiles}
                  variant="completed"
                  onOpen={() => onSelect(run.id)}
                />
              ))}
              {!completedRuns.length ? (
                <FriendlyEmpty
                  title={hasActiveFilters
                    ? "No encontramos checklists completadas con esos filtros."
                    : "No hay checklists completadas."}
                  text={hasActiveFilters
                    ? "Prueba otro texto de búsqueda o ajusta las fechas y filtros."
                    : "Cuando cierres una corrida, aparecerá aquí para consulta."}
                />
              ) : null}
            </div>

            <PaginationControls
              page={page}
              total={completedRuns.length}
              pageSize={completedPageSize}
              onChange={setPage}
            />
          </>
        )}
      </ChecklistRunDetailShell>
    </div>
  )
}

function ChecklistTodayContextBadges({ run, variant = "today" }) {
  const badges = getChecklistRunContextBadges(run, variant)
  if (!badges.length) return null
  return (
    <div className="checklist-today-badges">
      {badges.map((badge) => (
        <span key={badge} className={`checklist-today-badge checklist-today-badge--${badge.toLowerCase()}`}>{badge}</span>
      ))}
    </div>
  )
}

function ChecklistTodayCard({ run, profiles, coverage, canAssignReplacement, onAssignReplacement, onOpen, variant = "today" }) {
  const [replacementOpen, setReplacementOpen] = useState(false)
  const progress = checklistRunProgress(run)
  const completedItems = (run.checklist_run_items || []).filter(itemHasAnswer).length
  const totalItems = run.checklist_run_items?.length || 0
  const displayStatus = getChecklistOperationalDisplayStatus(run)
  const scheduleLabel = variant === "completed"
    ? `${getChecklistOperationalStatusLabel(displayStatus)} · ${formatChecklistRunDateLabel(run.run_date)}`
    : checklistRunScheduleLabel(run)
  const dueLabel = formatChecklistDueDeadline(run)
  const cardClassName = [
    "checklist-today-card",
    variant === "overdue" ? "checklist-today-card--past-date" : "",
    variant === "completed" ? "checklist-today-card--completed" : "",
    displayStatus === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA ? "checklist-today-card--late-pending" : ""
  ].filter(Boolean).join(" ")

  return (
    <article className={cardClassName}>
      <div className="checklist-card-top">
        <div>
          <h3>{run.checklist_templates?.title || "Checklist"}</h3>
          <p>{run.area || "Sin area"}</p>
          <ChecklistResponsibleInfo run={run} profiles={profiles} compact />
        </div>
        <ChecklistTodayContextBadges run={run} variant={variant} />
      </div>
      <div className="checklist-today-schedule">
        <p className={`checklist-today-schedule__primary${isChecklistOperationallyExpired(run) || displayStatus === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA ? " is-overdue" : ""}`}>{scheduleLabel}</p>
        <p className="checklist-today-schedule__due">{dueLabel}</p>
      </div>
      {needsChecklistCoverageAlert(coverage) ? (
        <div className="checklist-coverage-alert checklist-coverage-alert--compact">
          <p>{getChecklistCoverageAlertMessage(coverage)}</p>
          {canAssignReplacement && onAssignReplacement ? (
            <button type="button" className="tasks-secondary" onClick={() => setReplacementOpen(true)}>Asignar reemplazo</button>
          ) : null}
        </div>
      ) : null}
      {replacementOpen ? (
        <ChecklistReplacementModal
          run={run}
          profiles={profiles}
          coverage={coverage}
          onClose={() => setReplacementOpen(false)}
          onSubmit={onAssignReplacement}
        />
      ) : null}
      <div className="checklist-progress-row">
        <progress value={progress} max="100" />
        <strong>{progress}%</strong>
      </div>
      <div className="checklist-card-meta">
        <span>{completedItems} / {totalItems} items</span>
        <span>Rol: {run.assigned_role || "Sin rol"}</span>
        {variant !== "today" ? <span>Corrida: {formatChecklistRunDateLabel(run.run_date)}</span> : null}
      </div>
      <button type="button" className="checklist-primary-action" onClick={onOpen}>
        {run.status === "pending" ? "Iniciar checklist" : run.status === "completed" ? "Ver detalle" : "Ver checklist"}
      </button>
      {SHOW_CHECKLIST_RUN_DIAGNOSTIC ? (
        <div className="checklist-today-diagnostic" aria-label="Diagnóstico temporal de corrida">
          <span><code>id</code> {run.id}</span>
          <span><code>run_date</code> {run.run_date || "—"}</span>
          <span><code>template_id</code> {run.template_id || "—"}</span>
          <span><code>status</code> {run.status}</span>
        </div>
      ) : null}
    </article>
  )
}

function formatChecklistRole(role) {
  if (!role) return "Rol libre"
  return String(role).replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
}

function ChecklistTemplatesView({ templates, changeRequests = [], profiles, currentUser, userRole, isLibraryAdmin, isSupervisorOnly, onEdit, onEditRequest, onAssign, onDuplicate, onDeactivate, onReactivate, onDelete, canDelete, canEdit, canProposeEdits, canAssign, canSuggest, onSuggest }) {
  const [filters, setFilters] = useState({ area: "", frequency: "", status: "all" })
  const [assigning, setAssigning] = useState(null)
  const [suggesting, setSuggesting] = useState(null)
  const [feedback, setFeedback] = useState("")
  const pendingCreates = getVisiblePendingCreateRequests(changeRequests, currentUser?.id, isLibraryAdmin, isSupervisorOnly)
  const supervisorArea = currentUser?.area_name || ""
  const filtered = templates.filter((template) => {
    const pendingRequest = getTemplatePendingRequest(template, changeRequests)
    const statusMatch = filters.status === "all"
      || (filters.status === "active" && template.status === "active" && pendingRequest?.status !== "pending_review")
      || (filters.status === "inactive" && template.status === "inactive")
      || (filters.status === "pending" && pendingRequest?.status === "pending_review")
      || (filters.status === "draft" && pendingRequest?.status === "draft")
      || (filters.status === "rejected" && pendingRequest?.status === "rejected")
    const supervisorAreaMatch = !isSupervisorOnly
      || template.created_by === currentUser?.id
      || !template.area
      || checklistAreasMatch(template.area, supervisorArea)
    return (!filters.area || template.area === filters.area) &&
      (!filters.frequency || template.frequency === filters.frequency) &&
      statusMatch &&
      (!isSupervisorOnly || template.status === "active" || template.created_by === currentUser?.id) &&
      supervisorAreaMatch
  })
  const filteredPendingCreates = pendingCreates.filter((request) => {
    if (filters.area && request.area !== filters.area) return false
    if (filters.frequency && request.frequency !== filters.frequency) return false
    if (isSupervisorOnly && request.area && supervisorArea && !checklistAreasMatch(request.area, supervisorArea)) return false
    if (filters.status === "active" || filters.status === "inactive") return false
    if (filters.status === "pending") return request.status === "pending_review"
    if (filters.status === "draft") return request.status === "draft"
    if (filters.status === "rejected") return request.status === "rejected"
    return true
  })

  function renderTemplateCard(template) {
    const pendingRequest = getTemplatePendingRequest(template, changeRequests)
    const badge = templateLibraryBadge(template, pendingRequest)
    const creatorName = template.creator_name || profileDisplayName(profiles, template.created_by)
    const responsibleName = profileDisplayName(profiles, template.assigned_profile_id)
    const itemCount = template.checklist_template_items?.length || 0
    function openAssign(event) {
      event.preventDefault()
      event.stopPropagation()
      console.log("CLICK ASIGNAR", template.id)
      if (!canAssign) {
        setFeedback("No tienes permiso para asignar checklists.")
        return
      }
      setFeedback("Asignando checklist...")
      setAssigning(template)
    }

    const primaryActions = [
      canEdit && { key: "edit", label: "Editar", className: "tasks-secondary", onClick: () => onEdit(template) },
      canProposeEdits && !canEdit && { key: "edit-propose", label: "Editar checklist", className: "tasks-secondary", onClick: () => onEdit(template) },
      canSuggest && { key: "suggest", label: "Sugerir cambios", className: "tasks-secondary", onClick: () => setSuggesting(template) },
      canAssign && template.status === "active" && pendingRequest?.status !== "pending_review" && { key: "assign", label: "Asignar", className: "tasks-secondary", onClick: openAssign },
      canEdit && { key: "duplicate", label: "Duplicar", className: "tasks-secondary", onClick: () => onDuplicate(template) },
      canEdit && template.status !== "active" && pendingRequest?.status !== "pending_review" && { key: "reactivate", label: "Reactivar", className: "tasks-primary", onClick: () => onReactivate(template.id) }
    ].filter(Boolean)
    const secondaryActions = [
      canEdit && template.status === "active" && pendingRequest?.status !== "pending_review" && { key: "deactivate", label: "Desactivar", onClick: () => onDeactivate(template.id) },
      canDelete && { key: "delete", label: "Eliminar", onClick: () => onDelete(template) }
    ].filter(Boolean)

    return (
      <article className="checklist-template-card" key={template.id}>
        <header className="checklist-template-card-header">
          <div className="checklist-template-card-heading">
            <h3>{template.title}</h3>
            <p>{template.area ? checklistAreaLabel(template.area) : "Todas las areas"}</p>
          </div>
          <span className={`checklist-template-status ${badge.className}`}>{badge.label}</span>
        </header>
        {template.description && <p className="checklist-template-card-description">{template.description}</p>}
        <div className="checklist-template-card-tags" aria-label="Detalles de la checklist">
          <span className="checklist-template-tag items">{itemCount} items</span>
          <span className="checklist-template-tag frequency">{checklistFrequencyBadge(template)}</span>
          <span className="checklist-template-tag">{friendlyChecklistLabel(CHECKLIST_CONTEXTS, template.shift_context)}</span>
        </div>
        <div className="checklist-template-card-responsible">
          <span className="checklist-template-card-responsible-label">Creada por</span>
          <span className="checklist-template-card-responsible-name">{creatorName}</span>
        </div>
        <div className="checklist-template-card-responsible">
          <span className="checklist-template-card-responsible-label">Responsable sugerido</span>
          <span className="checklist-template-card-responsible-name">{responsibleName || "Sin responsable sugerido"}</span>
        </div>
        {pendingRequest?.status === "pending_review" && (
          <p className="tasks-warning">Cambios pendientes de aprobacion. Esta checklist no se puede asignar ni utilizar con la version propuesta hasta que gerencia, RRHH o admin la autoricen.</p>
        )}
        {pendingRequest?.status === "rejected" && pendingRequest.review_notes && (
          <p className="tasks-warning">{pendingRequest.review_notes}</p>
        )}
        {(primaryActions.length > 0 || secondaryActions.length > 0) && (
          <footer className="checklist-template-card-footer">
            {primaryActions.length > 0 && (
              <div className="checklist-template-card-actions">
                {primaryActions.map((action) => (
                  <button key={action.key} type="button" className={action.className} onClick={action.onClick}>{action.label}</button>
                ))}
              </div>
            )}
            {secondaryActions.length > 0 && (
              <div className="checklist-template-card-links">
                {secondaryActions.map((action) => (
                  <button key={action.key} type="button" className="tasks-link danger" onClick={action.onClick}>{action.label}</button>
                ))}
              </div>
            )}
          </footer>
        )}
      </article>
    )
  }

  function renderPendingCreateCard(request) {
    const badge = templateLibraryBadge({ status: "inactive" }, request)
    const creatorName = profileDisplayName(profiles, request.submitted_by)
    const itemCount = (request.items_snapshot || []).length
    return (
      <article className="checklist-template-card pending-create" key={`request-${request.id}`}>
        <header className="checklist-template-card-header">
          <div className="checklist-template-card-heading">
            <h3>{request.title}</h3>
            <p>{request.area ? checklistAreaLabel(request.area) : "Todas las areas"}</p>
          </div>
          <span className={`checklist-template-status ${badge.className}`}>{badge.label}</span>
        </header>
        {request.description && <p className="checklist-template-card-description">{request.description}</p>}
        {request.status === "pending_review" && (
          <p className="tasks-warning">Tu checklist esta pendiente de aprobacion. Podras asignarla y utilizarla cuando gerencia, RRHH o admin la autoricen.</p>
        )}
        {request.status === "rejected" && request.review_notes && (
          <p className="tasks-warning">{request.review_notes}</p>
        )}
        <div className="checklist-template-card-tags">
          <span className="checklist-template-tag items">{itemCount} items</span>
          <span className="checklist-template-tag frequency">{friendlyChecklistLabel(CHECKLIST_FREQUENCIES, request.frequency)}</span>
          <span className="checklist-template-tag">Nueva plantilla</span>
        </div>
        <div className="checklist-template-card-responsible">
          <span className="checklist-template-card-responsible-label">Creada por</span>
          <span className="checklist-template-card-responsible-name">{creatorName}</span>
        </div>
        {request.status === "rejected" && request.review_notes && (
          <p className="tasks-warning">{request.review_notes}</p>
        )}
        {(canProposeEdits || isLibraryAdmin) && request.submitted_by === currentUser?.id && request.status !== "pending_review" && (
          <footer className="checklist-template-card-footer">
            <div className="checklist-template-card-actions">
              <button type="button" className="tasks-secondary" onClick={() => onEditRequest(request)}>Ver / editar solicitud</button>
            </div>
          </footer>
        )}
        {(canProposeEdits || isLibraryAdmin) && request.submitted_by === currentUser?.id && request.status === "pending_review" && (
          <footer className="checklist-template-card-footer">
            <p className="tasks-muted">En espera de autorizacion. Recibiras una notificacion cuando sea aprobada o rechazada.</p>
          </footer>
        )}
      </article>
    )
  }

  return (
    <div className="checklists-admin-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Checklists</h2><p className="tasks-muted">Biblioteca de plantillas operativas.{isLibraryAdmin ? " Vista completa del catalogo." : " Plantillas activas y solicitudes propias."}</p></div></div>
        {feedback && <p className={feedback.includes("permiso") ? "tasks-warning" : "tasks-success"} role="status">{feedback}</p>}
        <div className="tasks-filters">
          <select value={filters.area} onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}><option value="">Todas las areas</option>{CHECKLIST_AREAS.map((area) => <option key={area} value={area}>{checklistAreaLabel(area)}</option>)}</select>
          <select value={filters.frequency} onChange={(event) => setFilters((current) => ({ ...current, frequency: event.target.value }))}><option value="">Todas las frecuencias</option>{CHECKLIST_FREQUENCIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select>
          <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}>
            <option value="all">Todas</option>
            <option value="active">Activas</option>
            <option value="pending">Pendiente aprobacion</option>
            <option value="draft">Borrador</option>
            <option value="rejected">Rechazadas</option>
            <option value="inactive">Archivadas</option>
          </select>
        </div>
      </article>
      <div className="checklists-card-grid">
        {filtered.map(renderTemplateCard)}
        {filteredPendingCreates.map(renderPendingCreateCard)}
        {!filtered.length && !filteredPendingCreates.length && <FriendlyEmpty title="Crea tu primera plantilla de apertura." text={isSupervisorOnly ? "Usa Crear checklist para enviar una nueva plantilla a aprobacion." : "Usa Crear checklist para definir pasos simples por area."} />}
      </div>
      {assigning && (
        <div className="tasks-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setAssigning(null) }}>
          <ChecklistAssignPanel
            template={assigning}
            profiles={profiles}
            currentUser={currentUser}
            userRole={userRole}
            onClose={() => setAssigning(null)}
            onAssign={async (payload) => {
              setFeedback("Asignando checklist...")
              const result = await onAssign(payload)
              if (result?.ok) {
                setFeedback(result.message || "Checklist asignada correctamente.")
                setAssigning(null)
              }
              return result
            }}
          />
        </div>
      )}
      {suggesting && (
        <div className="tasks-modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSuggesting(null) }}>
          <ChecklistSuggestionPanel template={suggesting} currentUser={currentUser} onClose={() => setSuggesting(null)} onSubmit={(payload) => { onSuggest(payload); setSuggesting(null) }} />
        </div>
      )}
    </div>
  )
}

function ChecklistAssignPanel({ template, profiles, currentUser, userRole, onClose, onAssign }) {
  const isSupervisorOnly = normalizeRole(userRole) === "supervisor"
  const supervisorArea = currentUser?.area_name || ""
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [form, setForm] = useState({
    template_id: template.id,
    run_date: TODAY,
    due_time: template.due_time || "",
    area: template.area || (isSupervisorOnly ? supervisorArea : ""),
    assigned_profile_id: template.assigned_profile_id || "",
    assigned_role: template.assigned_role || "",
    notes: ""
  })
  const assignableProfiles = useMemo(
    () => getChecklistAssignableProfiles(currentUser, profiles, { templateArea: form.area || template.area || "" }),
    [currentUser, profiles, form.area, template.area]
  )
  const areaOptions = isSupervisorOnly && supervisorArea
    ? CHECKLIST_AREAS.filter((area) => checklistAreasMatch(area, supervisorArea))
    : CHECKLIST_AREAS
  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  async function submit() {
    setError("")
    setSaving(true)
    const result = await onAssign(form)
    if (!result?.ok) {
      setError("No se pudo asignar la checklist.")
      setSaving(false)
    }
  }
  return (
    <article className="tasks-panel checklist-assign-panel" role="dialog" aria-modal="true" aria-labelledby="checklist-assign-title">
      <div className="tasks-panel-title"><div><h2 id="checklist-assign-title">Asignar checklist</h2><p className="tasks-muted">{template.title}</p></div><button type="button" disabled={saving} onClick={onClose}>Cerrar</button></div>
      {saving && <p className="tasks-success" role="status">Asignando checklist...</p>}
      {error && <p className="tasks-warning" role="alert">{error}</p>}
      <div className="tasks-form-grid">
        <Field label="Fecha"><input type="date" value={form.run_date} onChange={(event) => update("run_date", event.target.value)} /></Field>
        <Field label="Hora limite"><input type="time" value={form.due_time} onChange={(event) => update("due_time", event.target.value)} /></Field>
        <Field label="Area"><select value={form.area} onChange={(event) => update("area", event.target.value)} disabled={isSupervisorOnly && areaOptions.length === 1}>{areaOptions.map((area) => <option key={area} value={area}>{checklistAreaLabel(area)}</option>)}</select></Field>
        <Field label="Rol/Puesto"><select value={form.assigned_role} onChange={(event) => update("assigned_role", event.target.value)}><option value="">Rol libre</option>{CHECKLIST_ROLES.map((role) => <option key={role}>{role}</option>)}</select></Field>
        <Field label="Colaborador" hint={isSupervisorOnly ? "Solo colaboradores a tu cargo en tu area." : undefined}><select value={form.assigned_profile_id} onChange={(event) => update("assigned_profile_id", event.target.value)}><option value="">Sin colaborador especifico</option>{assignableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select></Field>
      </div>
      <Field label="Observacion"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
      <button type="button" className="tasks-primary" disabled={saving} onClick={submit}>{saving ? "Asignando..." : "Asignar"}</button>
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
      <div className="tasks-panel-title"><div><h2>Sugerir cambios</h2><p className="tasks-muted">{template.title} · {checklistAreaLabel(template.area)}</p></div><button type="button" onClick={onClose}>Cerrar</button></div>
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

function loadChecklistWizardInitialState(editingTemplate, profileId, templateScope) {
  const draft = getChecklistWizardDraft(profileId, templateScope)
    || getChecklistWizardDraft("", templateScope)
    || getChecklistWizardDraft("anon", templateScope)
  if (draft?.form && Array.isArray(draft.items) && draft.items.length) {
    return {
      step: Number(draft.step) || 1,
      form: normalizeChecklistWizardForm(draft.form),
      items: draft.items.map(slimChecklistWizardItem)
    }
  }
  return {
    step: 1,
    form: buildChecklistWizardForm(editingTemplate),
    items: editingTemplate?.checklist_template_items?.length
      ? editingTemplate.checklist_template_items.map(slimChecklistWizardItem)
      : [emptyChecklistItem()]
  }
}

function checklistWizardProfileOptions(profiles = []) {
  return profiles.filter((profile) => profile?.id)
}

function ChecklistTemplateWizard({ templateId = "", editingTemplate, profiles, profileId = "", onCancel, onSave, approvalMode = false, canConfigureCoverage = false }) {
  const templateScope = templateId || editingTemplate?.id || "new"
  const initialState = loadChecklistWizardInitialState(editingTemplate, profileId, templateScope)
  const [step, setStep] = useState(initialState.step)
  const [form, setForm] = useState(initialState.form)
  const [items, setItems] = useState(initialState.items)
  const [saveFeedback, setSaveFeedback] = useState(null)
  const [saving, setSaving] = useState(false)
  const [hasRunHistory, setHasRunHistory] = useState(false)
  const persistTimerRef = useRef(null)
  const profileOptions = useMemo(() => checklistWizardProfileOptions(profiles), [profiles])
  const steps = ["Informacion", "Items", "Asignacion", "Vista previa"]

  const persistDraftNow = useCallback((nextStep = step) => {
    persistChecklistWizardDraft(profileId, templateScope, {
      step: nextStep,
      form: normalizeChecklistWizardForm(form),
      items: items.map(slimChecklistWizardItem)
    })
  }, [form, items, profileId, step, templateScope])

  useEffect(() => {
    window.clearTimeout(persistTimerRef.current)
    persistTimerRef.current = window.setTimeout(() => {
      persistDraftNow(step)
    }, 300)
    return () => window.clearTimeout(persistTimerRef.current)
  }, [persistDraftNow, step])

  useEffect(() => {
    if (!profileId) return
    const legacyDraft = getChecklistWizardDraft("", templateScope) || getChecklistWizardDraft("anon", templateScope)
    if (!legacyDraft) return
    if (!getChecklistWizardDraft(profileId, templateScope)) {
      persistChecklistWizardDraft(profileId, templateScope, legacyDraft)
    }
    clearChecklistWizardDraft("", templateScope)
    clearChecklistWizardDraft("anon", templateScope)
  }, [profileId, templateScope])

  useEffect(() => {
    if (!templateId) {
      setHasRunHistory(false)
      return
    }
    let cancelled = false
    checkTemplateHasRuns(templateId).then(({ hasRuns }) => {
      if (!cancelled) setHasRunHistory(hasRuns)
    })
    return () => {
      cancelled = true
    }
  }, [templateId])

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }
  function setRecurrenceDays(nextDays) {
    const recurrence_days = normalizeChecklistWeekdays(nextDays)
    setForm((current) => ({
      ...current,
      frequency: recurrence_days.length ? "semanal" : current.frequency,
      recurrence_days,
      recurrence_rule: buildChecklistWeeklyRRule(recurrence_days)
    }))
  }
  function toggleRecurrenceDay(day, checked) {
    setForm((current) => {
      const days = normalizeChecklistWeekdays(current.recurrence_days)
      const recurrence_days = normalizeChecklistWeekdays(checked ? [...days, day] : days.filter((item) => item !== day))
      return {
        ...current,
        frequency: checked ? "semanal" : current.frequency,
        recurrence_days,
        recurrence_rule: buildChecklistWeeklyRRule(recurrence_days)
      }
    })
  }
  function updateRecurrenceRule(value) {
    const recurrence_rule = String(value || "").toUpperCase().replace(/\s+/g, "")
    setForm((current) => ({
      ...current,
      recurrence_rule,
      recurrence_days: recurrence_rule ? parseChecklistWeekdaysFromRRule(recurrence_rule) : []
    }))
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
  const normalizedDays = normalizeChecklistWeekdays(form.recurrence_days)
  const isWeekly = form.frequency === "semanal"
  const isMonthly = form.frequency === "mensual"
  const isDaily = form.frequency === "diaria"
  const weeklyDaysMissing = isWeekly && !normalizedDays.length
  const recurrenceSummary = humanChecklistRecurrenceSummary({ ...form, recurrence_days: normalizedDays })
  const selectedDaysSummary = summarizeChecklistWeekdays(form.recurrence_days)
  const debugRRule = form.recurrence_rule || buildChecklistWeeklyRRule(form.recurrence_days)
  const saveBlockReason = weeklyDaysMissing
    ? "Selecciona al menos un dia de ejecucion en la pestana Asignacion antes de guardar."
    : !form.title.trim()
      ? "Completa el nombre de la checklist en la pestana Informacion."
      : !items.some((item) => item.title.trim())
        ? "Agrega al menos 1 item con titulo en la pestana Items."
        : ""
  const finalActionDisabled = Boolean(saveBlockReason) || saving

  async function handleSave(options = {}) {
    setSaveFeedback(null)
    if (saveBlockReason) {
      setSaveFeedback({ type: "error", message: saveBlockReason })
      return
    }
    setSaving(true)
    try {
      const result = await onSave(form, items, { ...options, templateId: templateId || editingTemplate?.id || "" })
      if (result?.ok) {
        clearChecklistWizardDraft(profileId, templateScope)
        setSaveFeedback({ type: "success", message: result.message || "Checklist guardado correctamente." })
        return
      }
      setSaveFeedback({ type: "error", message: result?.error || "No se pudo guardar la checklist." })
    } catch (error) {
      console.error("Checklist save error:", error)
      setSaveFeedback({ type: "error", message: error?.message || "Error inesperado al guardar la checklist." })
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    clearChecklistWizardDraft(profileId, templateScope)
    onCancel()
  }

  function goToStep(nextStep) {
    const safeStep = Math.min(4, Math.max(1, Number(nextStep) || 1))
    try {
      persistDraftNow(safeStep)
    } catch (error) {
      console.warn("checklist wizard draft persist failed", error)
    }
    startTransition(() => setStep(safeStep))
  }

  return (
    <article className="tasks-panel checklist-wizard">
      <div className="tasks-panel-title"><div><h2>{editingTemplate ? "Editar plantilla" : "Crear plantilla"}</h2><p className="tasks-muted">Paso {step} de 4 · {steps[step - 1]}</p></div><button type="button" onClick={handleCancel}>Cancelar</button></div>
      {hasRunHistory && (
        <p className="checklist-template-history-note">
          Esta plantilla tiene ejecuciones previas. Los cambios se aplicarán hacia adelante sin afectar el historial.
        </p>
      )}
      <div className="checklist-stepper">{steps.map((label, index) => <button key={label} type="button" className={step === index + 1 ? "active" : ""} onClick={() => goToStep(index + 1)}><span>{index + 1}</span>{label}</button>)}</div>
      {step === 1 && <div className="checklist-step-card"><div className="tasks-form-grid"><Field label="Nombre"><input required value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Apertura FOH" /></Field><Field label="Area"><select value={form.area} onChange={(event) => update("area", event.target.value)}>{CHECKLIST_AREAS.map((area) => <option key={area} value={area}>{checklistAreaLabel(area)}</option>)}</select></Field><Field label="Frecuencia"><select value={form.frequency} onChange={(event) => update("frequency", event.target.value)}>{CHECKLIST_FREQUENCIES.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field><Field label="Contexto"><select value={form.shift_context} onChange={(event) => update("shift_context", event.target.value)}>{CHECKLIST_CONTEXTS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></Field></div><Field label="Descripcion"><textarea value={form.description} onChange={(event) => update("description", event.target.value)} /></Field></div>}
      {step === 2 && <div className="checklist-builder">{items.map((item, index) => <ChecklistBuilderItem key={item.id || index} item={item} index={index} onUpdate={updateItem} onMove={move} onDuplicate={duplicateItem} onDelete={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} />)}<button type="button" className="checklist-add-item" onClick={() => setItems((current) => [...current, emptyChecklistItem()])}>Agregar item</button></div>}
      {step === 3 && (
        <ChecklistWizardStepBoundary key="checklist-wizard-step-3">
        <div className="checklist-step-card">
          <div className="tasks-form-grid">
            <Field label="Area sugerida">
              <select value={form.area} onChange={(event) => update("area", event.target.value)}>
                {CHECKLIST_AREAS.map((area) => <option key={area} value={area}>{checklistAreaLabel(area)}</option>)}
              </select>
            </Field>
            <Field label="Rol/Puesto sugerido">
              <select value={form.assigned_role} onChange={(event) => update("assigned_role", event.target.value)}>
                <option value="">Cualquier rol</option>
                {CHECKLIST_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </Field>
            <Field label="Responsable permanente">
              <select value={form.assigned_profile_id} onChange={(event) => update("assigned_profile_id", event.target.value)}>
                <option value="">Sin colaborador fijo</option>
                {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
              </select>
            </Field>
            <Field label="Suplente">
              <select value={form.backup_profile_id} onChange={(event) => update("backup_profile_id", event.target.value)}>
                <option value="">Sin suplente</option>
                {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
              </select>
            </Field>
            {canConfigureCoverage ? (
              <>
                <Field label="Reemplazo principal">
                  <select value={form.primary_replacement_profile_id} onChange={(event) => update("primary_replacement_profile_id", event.target.value)}>
                    <option value="">Sin reemplazo principal</option>
                    {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                </Field>
                <Field label="Reemplazo secundario">
                  <select value={form.secondary_replacement_profile_id} onChange={(event) => update("secondary_replacement_profile_id", event.target.value)}>
                    <option value="">Sin reemplazo secundario</option>
                    {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                </Field>
                <Field label="Escalar a">
                  <select value={form.coverage_escalation_profile_id} onChange={(event) => update("coverage_escalation_profile_id", event.target.value)}>
                    <option value="">Sin escalamiento</option>
                    {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                </Field>
                <Field label="Minutos de espera auto-cobertura">
                  <input
                    type="number"
                    min="0"
                    max="240"
                    value={form.auto_coverage_wait_minutes}
                    onChange={(event) => update("auto_coverage_wait_minutes", event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field label="Supervisor aprobador">
              <select value={form.supervisor_profile_id} onChange={(event) => update("supervisor_profile_id", event.target.value)}>
                <option value="">Gerencia / supervisor</option>
                {profileOptions.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
              </select>
            </Field>
            <Field label="Recordatorio">
              <input type="time" value={normalizeChecklistTimeValue(form.reminder_time)} onChange={(event) => update("reminder_time", event.target.value)} />
            </Field>
            <Field label="Hora limite">
              <input type="time" value={normalizeChecklistTimeValue(form.due_time)} onChange={(event) => update("due_time", event.target.value)} />
            </Field>
            {isMonthly && (
              <Field label="Dia mensual" hint="Se generara una vez al mes en la fecha indicada.">
                <input type="number" min="1" max="31" value={form.recurrence_month_day} onChange={(event) => update("recurrence_month_day", event.target.value)} />
              </Field>
            )}
          </div>

          <div className="checklist-flags compact">
            <label className="tasks-checkbox checklist-flag-chip">
              <input type="checkbox" checked={form.auto_generate} onChange={(event) => update("auto_generate", event.target.checked)} />
              <span>Generar automaticamente</span>
              <span className="checklist-inline-help" title="El sistema creara checklists automaticamente segun la programacion configurada." aria-label="Ayuda">?</span>
            </label>
            <label className="tasks-checkbox checklist-flag-chip">
              <input type="checkbox" checked={form.skip_non_work_days} onChange={(event) => update("skip_non_work_days", event.target.checked)} />
              <span>Excluir dias de descanso</span>
              <span className="checklist-inline-help" title="No se generaran checklists en los dias de descanso asignados al colaborador." aria-label="Ayuda">?</span>
            </label>
            {canConfigureCoverage ? (
              <label className="tasks-checkbox checklist-flag-chip">
                <input type="checkbox" checked={form.auto_coverage_enabled} onChange={(event) => update("auto_coverage_enabled", event.target.checked)} />
                <span>Activar auto-cobertura</span>
                <span className="checklist-inline-help" title="Reasigna automaticamente cuando hay vacaciones, descanso o ausencia sin marcaje despues de la tolerancia." aria-label="Ayuda">?</span>
              </label>
            ) : null}
          </div>

          <div className="checklist-recurrence-card compact">
              <div className="checklist-recurrence-header">
                <strong>Programacion</strong>
                <span className="tasks-muted">Configura solo los datos necesarios para esta frecuencia.</span>
              </div>

              {!isWeekly && <div className="checklist-frequency-hint">
                <span>Si marcas uno o mas dias, la frecuencia cambiara automaticamente a <strong>Semanal</strong>.</span>
                <button type="button" className="tasks-secondary" onClick={() => goToStep(1)}>Ir a Informacion</button>
              </div>}

              <div className="checklist-recurrence-toolbar">
                <div className="checklist-quick-actions">
                  <button type="button" className="checklist-quick-action" onClick={() => setRecurrenceDays(CHECKLIST_ALL_WEEKDAYS)}>Todos</button>
                  <button type="button" className="checklist-quick-action" onClick={() => setRecurrenceDays(CHECKLIST_WORKDAYS)}>Laborales</button>
                  <button type="button" className="checklist-quick-action" onClick={() => setRecurrenceDays(CHECKLIST_WEEKEND_DAYS)}>Fin de semana</button>
                  <button type="button" className="checklist-quick-action" onClick={() => setRecurrenceDays([])}>Ninguno</button>
                </div>
                <span className={weeklyDaysMissing ? "checklist-inline-warning visible" : "checklist-inline-warning"}>Debe seleccionar al menos un dia de ejecucion.</span>
              </div>

              <div className="checklist-weekdays boxes" role="group" aria-label="Dias de ejecucion">
                {CHECKLIST_WEEKDAYS.map(([day, label]) => {
                  const selected = normalizedDays.includes(day)
                  return (
                    <label
                      key={day}
                      className={selected ? "tasks-checkbox checklist-day-box selected" : "tasks-checkbox checklist-day-box"}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => toggleRecurrenceDay(day, event.target.checked)}
                      />
                      <span className="checklist-day-box-copy">
                        <span className="checklist-day-box-short">{CHECKLIST_WEEKDAY_SHORT[day].toUpperCase()}</span>
                        <span className="checklist-day-box-full">{label}</span>
                      </span>
                    </label>
                  )
                })}
              </div>

              <div className="checklist-recurrence-summary human">
                <strong>Resumen:</strong>
                <span>{recurrenceSummary}</span>
              </div>

              <details className="checklist-technical-details">
                <summary>Mostrar detalles tecnicos</summary>
                <div className="checklist-technical-body">
                  <Field label="RRULE personalizada" hint="Puedes pegar o ajustar una regla semanal para depuracion avanzada.">
                    <input value={form.recurrence_rule} onChange={(event) => updateRecurrenceRule(event.target.value)} placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR" />
                  </Field>
                  {debugRRule && <div className="checklist-recurrence-debug"><strong>RRULE:</strong><code>{debugRRule}</code></div>}
                  <div className="checklist-recurrence-summary"><strong>Dias seleccionados:</strong><span>{selectedDaysSummary}</span></div>
                </div>
              </details>
            </div>
        </div>
        </ChecklistWizardStepBoundary>
      )}
      {step === 4 && <ChecklistTemplatePreview form={form} items={items} profiles={profiles} templateId={templateId || editingTemplate?.id} />}
      {saveFeedback && (
        <p className={saveFeedback.type === "success" ? "tasks-success checklist-wizard-feedback" : "tasks-warning checklist-wizard-feedback"} role={saveFeedback.type === "success" ? "status" : "alert"}>
          {saveFeedback.message}
        </p>
      )}
      {saveBlockReason && step === 4 && (
        <p className="tasks-warning checklist-wizard-feedback" role="alert">{saveBlockReason}</p>
      )}
      <div className="checklist-wizard-actions">
        <button type="button" className="tasks-secondary" disabled={step === 1 || saving} onClick={() => goToStep(Math.max(1, step - 1))}>Anterior</button>
        {step < 4 ? (
          <button type="button" className="tasks-primary" onClick={() => goToStep(Math.min(4, step + 1))}>Siguiente</button>
        ) : approvalMode ? (
          <>
            <button type="button" className="tasks-secondary" disabled={finalActionDisabled} title={saveBlockReason || ""} onClick={() => handleSave({ saveDraft: true })}>{saving ? "Guardando..." : "Guardar borrador"}</button>
            <button type="button" className="tasks-primary" disabled={finalActionDisabled} title={saveBlockReason || ""} onClick={() => handleSave()}>{saving ? "Enviando..." : templateId ? "Enviar cambios a aprobacion" : "Enviar a aprobacion"}</button>
          </>
        ) : (
          <button type="button" className="tasks-primary" disabled={finalActionDisabled} title={saveBlockReason || ""} onClick={() => handleSave()}>{saving ? "Guardando..." : templateId ? "Guardar cambios" : "Guardar plantilla"}</button>
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

function ChecklistTemplatePreview({ form, items, profiles, templateId = "" }) {
  const assignee = profiles.find((profile) => profile.id === form.assigned_profile_id)
  const recurrenceDays = summarizeChecklistWeekdays(form.recurrence_days)
  return (
    <div className="checklist-preview">
      {templateId && <p className="tasks-muted checklist-preview-meta">Editando checklist existente · ID {templateId.slice(0, 8)}...</p>}
      <article className="checklist-template-card"><div className="checklist-card-top"><div><h3>{form.title || "Nueva checklist"}</h3><p>{checklistAreaLabel(form.area)} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, form.frequency)}</p></div><span className="tasks-badge">{friendlyChecklistLabel(CHECKLIST_CONTEXTS, form.shift_context)}</span></div><p>{form.description || "Sin descripcion"}</p><div className="checklist-card-meta"><span>{items.filter((item) => item.title.trim()).length} items</span><span>{form.assigned_role || "Cualquier rol"}</span><span>{assignee?.full_name || assignee?.username || "Sin colaborador fijo"}</span>{recurrenceDays !== "Ninguno" && <span>Dias: {recurrenceDays}</span>}</div></article>
      <div className="checklist-preview-items">{items.filter((item) => item.title.trim()).map((item, index) => <div key={item.id || index}><strong>{index + 1}. {item.title}</strong><span>{friendlyResponseType(item.response_type)}{item.requires_photo ? " · foto" : ""}{item.requires_comment ? " · comentario" : ""}</span></div>)}</div>
    </div>
  )
}

function ChecklistCoverageInfo({ run, profiles, coverage }) {
  if (!coverage) return null
  const availability = coverage.responsible_availability
  const suggested = getChecklistSuggestedReplacement(coverage)
  const originalId = coverage.original_profile_id || run.original_assigned_profile_id || run.assigned_profile_id
  const effectiveId = coverage.effective_profile_id || run.assigned_profile_id

  return (
    <div className="checklist-coverage-info">
      <p><strong>Estado de disponibilidad:</strong> {availability?.availability_label || getChecklistAvailabilityLabel(availability?.availability_state)}</p>
      {suggested?.profileId ? (
        <p>
          <strong>Reemplazo sugerido:</strong> {profileDisplayName(profiles, suggested.profileId)}
          {suggested.source ? ` (${getChecklistCoverageSourceLabel(suggested.source)})` : ""}
        </p>
      ) : coverage.escalation_profile_id ? (
        <p><strong>Escalar a:</strong> {profileDisplayName(profiles, coverage.escalation_profile_id)}</p>
      ) : null}
      {coverage.auto_coverage_enabled ? (
        <p className="tasks-muted">Auto-cobertura activa · espera {coverage.auto_coverage_wait_minutes || 20} min tras tolerancia</p>
      ) : null}
      {coverage.coverage_auto_applied_at ? (
        <p className="tasks-success">Cobertura automatica aplicada</p>
      ) : null}
      {coverage.coverage_alert_notified_at ? (
        <p className="tasks-muted">Alerta de cobertura enviada</p>
      ) : null}
      {!coverage.already_replaced && originalId !== effectiveId ? null : (
        <p className="tasks-muted">Responsable efectivo: {profileDisplayName(profiles, effectiveId)}</p>
      )}
    </div>
  )
}

function ChecklistCoverageAlert({ run, profiles, coverage, canAssignReplacement, onAssignReplacement, onViewOriginal }) {
  const [replacementOpen, setReplacementOpen] = useState(false)
  if (!needsChecklistCoverageAlert(coverage)) return null
  const suggested = getChecklistSuggestedReplacement(coverage)
  const originalId = coverage.original_profile_id || run.original_assigned_profile_id || run.assigned_profile_id

  return (
    <div className="checklist-coverage-alert" role="status">
      <div>
        <strong>Cobertura requerida</strong>
        <p>{getChecklistCoverageAlertMessage(coverage)}</p>
        {suggested?.profileId ? (
          <p className="tasks-muted">
            Sugerido: {profileDisplayName(profiles, suggested.profileId)}
            {suggested.source ? ` · ${getChecklistCoverageSourceLabel(suggested.source)}` : ""}
          </p>
        ) : (
          <p className="tasks-warning">Sin reemplazo disponible. Escalar a gerencia.</p>
        )}
      </div>
      <div className="checklist-coverage-alert__actions">
        {canAssignReplacement && onAssignReplacement ? (
          <button type="button" className="tasks-primary" onClick={() => setReplacementOpen(true)}>Asignar reemplazo</button>
        ) : null}
        {originalId ? (
          <button type="button" className="tasks-secondary" onClick={() => onViewOriginal?.(originalId)}>
            Ver responsable original
          </button>
        ) : null}
      </div>
      {replacementOpen ? (
        <ChecklistReplacementModal
          run={run}
          profiles={profiles}
          coverage={coverage}
          onClose={() => setReplacementOpen(false)}
          onSubmit={onAssignReplacement}
        />
      ) : null}
    </div>
  )
}

function ChecklistResponsibleInfo({ run, profiles, compact = false }) {
  const originalId = run.original_assigned_profile_id || run.assigned_profile_id
  const originalName = profileDisplayName(profiles, originalId)
  const effectiveName = profileDisplayName(profiles, run.assigned_profile_id)
  const replaced = hasChecklistReplacement(run)

  if (!replaced) {
    return compact
      ? <p className="checklist-responsible-info">{originalName}</p>
      : <p className="checklist-responsible-info"><strong>Responsable:</strong> {originalName}</p>
  }

  return (
    <div className={`checklist-responsible-info${compact ? " checklist-responsible-info--compact" : ""}`}>
      <p><strong>Responsable original:</strong> {originalName}</p>
      <p><strong>Asignada hoy a:</strong> {effectiveName}</p>
      <p><strong>Motivo:</strong> {getChecklistReplacementReasonLabel(run.replacement_reason)}</p>
      {run.replacement_notes ? <p className="tasks-muted">{run.replacement_notes}</p> : null}
    </div>
  )
}

function ChecklistReplacementModal({ run, profiles, coverage, onClose, onSubmit }) {
  const suggested = getChecklistSuggestedReplacement(coverage)
  const [replacementProfileId, setReplacementProfileId] = useState(suggested?.profileId || "")
  const [reason, setReason] = useState(suggested?.reason || "vacaciones")
  const [notes, setNotes] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const assignableProfiles = useMemo(
    () => profiles.filter((profile) => profile?.id && profile.id !== (run.original_assigned_profile_id || run.assigned_profile_id)),
    [profiles, run.assigned_profile_id, run.original_assigned_profile_id]
  )

  useEffect(() => {
    if (suggested?.profileId) setReplacementProfileId(suggested.profileId)
    if (suggested?.reason) setReason(suggested.reason)
  }, [suggested?.profileId, suggested?.reason])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!replacementProfileId) {
      setError("Selecciona un colaborador de reemplazo.")
      return
    }
    setSaving(true)
    setError("")
    const result = await onSubmit(run.id, { replacementProfileId, reason, notes })
    setSaving(false)
    if (result?.error) {
      setError(result.error.message || "No se pudo asignar el reemplazo.")
      return
    }
    onClose()
  }

  return (
    <div className="tasks-modal-backdrop" role="presentation" onClick={onClose}>
      <form className="tasks-modal checklist-replacement-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
        <div className="tasks-modal-head">
          <div>
            <h3>Asignar reemplazo</h3>
            <p className="tasks-muted">{run.checklist_templates?.title || "Checklist"} · {formatChecklistRunDateLabel(run.run_date)}</p>
          </div>
          <button type="button" className="tasks-link" onClick={onClose}>Cerrar</button>
        </div>
        <ChecklistResponsibleInfo run={run} profiles={profiles} />
        {suggested?.profileId ? (
          <p className="tasks-muted">Reemplazo sugerido preseleccionado segun disponibilidad y plantilla.</p>
        ) : null}
        <div className="tasks-form-grid">
          <Field label="Reemplazo">
            <select value={replacementProfileId} onChange={(event) => setReplacementProfileId(event.target.value)} required>
              <option value="">Seleccionar colaborador</option>
              {assignableProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
              ))}
            </select>
          </Field>
          <Field label="Motivo">
            <select value={reason} onChange={(event) => setReason(event.target.value)} required>
              {CHECKLIST_REPLACEMENT_REASONS.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </Field>
          <Field label="Nota opcional">
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Detalle adicional del reemplazo" />
          </Field>
        </div>
        {error ? <p className="tasks-warning">{error}</p> : null}
        <div className="tasks-modal-actions">
          <button type="button" className="tasks-secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="tasks-primary" disabled={saving}>{saving ? "Guardando..." : "Guardar reemplazo"}</button>
        </div>
      </form>
    </div>
  )
}

function ChecklistGuidedRun({ run, profiles, currentUser, coverage, onClose, onUpdateItem, onComplete, onAssignReplacement, canAssignReplacement }) {
  const progress = checklistRunProgress(run)
  const completedCount = (run.checklist_run_items || []).filter(itemHasAnswer).length
  const canEdit = run.status !== "completed"
  const itemGroups = groupChecklistRunItems(run.checklist_run_items || [])
  const runMeta = getChecklistRunMeta(run.id)
  const [savingDraft, setSavingDraft] = useState(false)
  const [replacementOpen, setReplacementOpen] = useState(false)
  const displayStatus = getChecklistOperationalDisplayStatus(run)

  async function handleSaveAndContinueLater() {
    setSavingDraft(true)
    try {
      await flushAllChecklistPendingSaves()
      onClose()
    } finally {
      setSavingDraft(false)
    }
  }

  return (
    <article className="checklist-guided">
      <div className="checklist-guided-header">
        <button type="button" className="checklist-back-button compact" onClick={onClose}>← Volver</button>
        <div>
          <h2>{run.checklist_templates?.title || "Checklist"}</h2>
          <p>{run.area || "Sin area"}</p>
          <ChecklistResponsibleInfo run={run} profiles={profiles} />
        </div>
        <span className={`checklist-today-badge checklist-today-badge--${displayStatus.replace(/_/g, "-")}`}>
          {getChecklistOperationalStatusLabel(displayStatus)}
        </span>
      </div>
      {canAssignReplacement && onAssignReplacement ? (
        <div className="checklist-guided-actions">
          <button type="button" className="tasks-secondary" onClick={() => setReplacementOpen(true)}>Asignar reemplazo</button>
        </div>
      ) : null}
      <ChecklistCoverageAlert
        run={run}
        profiles={profiles}
        coverage={coverage}
        canAssignReplacement={canAssignReplacement}
        onAssignReplacement={onAssignReplacement}
        onViewOriginal={() => {}}
      />
      <ChecklistCoverageInfo run={run} profiles={profiles} coverage={coverage} />
      {replacementOpen ? (
        <ChecklistReplacementModal
          run={run}
          profiles={profiles}
          coverage={coverage}
          onClose={() => setReplacementOpen(false)}
          onSubmit={onAssignReplacement}
        />
      ) : null}
      {runMeta?.lastSuccessfulAutosaveAt && (
        <p className="tasks-muted checklist-autosave-meta">
          Ultimo guardado: {new Date(runMeta.lastSuccessfulAutosaveAt).toLocaleString("es-GT")}
        </p>
      )}
      <div className="checklist-big-progress"><progress value={progress} max="100" /><strong>{completedCount} de {run.checklist_run_items?.length || 0} · {progress}%</strong></div>
      <div className="checklist-guided-items">
        {itemGroups.map((group, groupIndex) => {
          const done = group.items.filter(({ item }) => itemHasAnswer(item)).length
          return (
            <details className="checklist-section" key={group.title} open={groupIndex === 0 || done < group.items.length}>
              <summary><strong>{group.title}</strong><span>{done} de {group.items.length}</span></summary>
              <div className="checklist-section-items">
                {group.items.map(({ item, index }) => (
                  <ChecklistRunItem
                    key={item.id}
                    item={item}
                    index={index}
                    disabled={!canEdit}
                    runId={run.id}
                    profileId={currentUser?.id}
                    runMeta={{ templateTitle: run.checklist_templates?.title || "", area: run.area || "" }}
                    onSave={(payload) => onUpdateItem(item.id, payload)}
                  />
                ))}
              </div>
            </details>
          )
        })}
      </div>
      {canEdit && !["cancelled"].includes(run.status) && <ChecklistManagementAlertForm run={run} />}
      {canEdit && (
        <div className="checklist-sticky-actions">
          <button type="button" className="tasks-secondary" disabled={savingDraft} onClick={handleSaveAndContinueLater}>{savingDraft ? "Guardando..." : "Guardar y continuar despues"}</button>
          <button type="button" className="tasks-primary" onClick={() => onComplete(run.id)}>Completar checklist</button>
        </div>
      )}
    </article>
  )
}

function checklistRunItemDraft(item) {
  return {
    checked: item.checked,
    response_text: item.response_text || "",
    response_number: item.response_number ?? "",
    response_date: item.response_date || "",
    response_time: item.response_time || "",
    response_json: item.response_json || {},
    photo_url: item.photo_url || "",
    comment: item.comment || ""
  }
}

function ChecklistRunItem({ item, index = 0, disabled, runId, profileId, runMeta = {}, onSave }) {
  const [draft, setDraft] = useState(() => checklistRunItemDraft(item))
  const [saveStatus, setSaveStatus] = useState("")
  const saveTimerRef = useRef(null)
  const latestDraftRef = useRef(draft)
  const saveRef = useRef(null)
  const NOTE_DEBOUNCE_MS = 800

  useEffect(() => () => window.clearTimeout(saveTimerRef.current), [])

  useEffect(() => {
    return registerChecklistFlushCallback(async () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      await saveRef.current?.(latestDraftRef.current)
    })
  }, [])

  useEffect(() => {
    if (saveStatus === "pending" || saveStatus === "saving" || saveStatus === "error") return
    const external = checklistRunItemDraft(item)
    const localDraft = latestDraftRef.current
    if (itemPayloadHasAnswer(localDraft) && !itemPayloadHasAnswer(external)) return
    const externalKey = JSON.stringify(external)
    const draftKey = JSON.stringify(localDraft)
    if (externalKey !== draftKey) {
      setDraft(external)
      latestDraftRef.current = external
    }
  }, [item.checked, item.response_text, item.response_number, item.response_date, item.response_time, item.photo_url, item.comment, item.completed_at, item.response_json, saveStatus])

  function persistLocalDraft(next) {
    if (!runId) return
    persistChecklistItemDraft({
      runId,
      itemId: item.id,
      payload: next,
      profileId,
      meta: runMeta
    })
    touchActiveChecklistSession(profileId, runId)
  }

  async function save(next = latestDraftRef.current) {
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = null
    persistLocalDraft(next)
    setSaveStatus("saving")
    const result = await onSave(next)
    setSaveStatus(result?.error ? "error" : "saved")
    if (!result?.error) {
      saveTimerRef.current = window.setTimeout(() => setSaveStatus(""), 1800)
    }
    return result
  }
  saveRef.current = save

  function scheduleSave(next, delay = NOTE_DEBOUNCE_MS) {
    persistLocalDraft(next)
    window.clearTimeout(saveTimerRef.current)
    setSaveStatus("pending")
    saveTimerRef.current = window.setTimeout(() => save(next), delay)
  }

  function applyChange(field, value) {
    const next = { ...draft, [field]: value }
    setDraft(next)
    latestDraftRef.current = next
    scheduleSave(next)
  }

  function saveImmediate(next) {
    setDraft(next)
    latestDraftRef.current = next
    save(next)
  }
  function toggleMulti(option) {
    const current = Array.isArray(draft.response_json?.selected) ? draft.response_json.selected : []
    const selected = current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option]
    const next = { ...draft, response_json: { selected } }
    saveImmediate(next)
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
      latestDraftRef.current = next
      persistLocalDraft(next)
      return
    }
    saveImmediate(next)
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
      {needsPhoto && <Field label="Fotografia / evidencia"><input disabled={disabled} type="file" accept="image/*" capture="environment" onChange={(event) => readChecklistEvidenceFile(event, (photo_url) => { const next = { ...draft, photo_url }; setDraft(next); latestDraftRef.current = next; save(next) })} />{draft.photo_url && <img className="checklist-evidence-preview" src={draft.photo_url} alt="Evidencia" />}</Field>}
      {(needsComment || incidentWillTrigger) && <Field label={incidentWillTrigger ? "Describe que esta pasando" : "Comentario"}><textarea disabled={disabled} value={draft.comment} onChange={(event) => { const next = { ...draft, comment: event.target.value }; setDraft(next); latestDraftRef.current = next; if (!checklistItemWouldFail(item, next) || next.comment.trim()) scheduleSave(next) }} onBlur={() => save()} /></Field>}
      {needsIncidentComment && <p className="tasks-warning">Agrega un comentario para guardar la incidencia.</p>}
    </div>
  )
}

function ChecklistManagementAlertForm({ run }) {
  const [message, setMessage] = useState("")
  const [priority, setPriority] = useState("informativo")
  const [feedback, setFeedback] = useState("")
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const trimmed = message.trim()
  const isCritical = priority === "critico"

  async function submitAlert(event) {
    event.preventDefault()
    setError("")
    setFeedback("")
    if (trimmed.length < 10) {
      setError("El aviso debe tener al menos 10 caracteres.")
      return
    }
    if (trimmed.length > 1000) {
      setError("El aviso no puede superar 1000 caracteres.")
      return
    }
    setSending(true)
    const result = await createChecklistManagementAlert(run.id, priority, trimmed)
    setSending(false)
    if (result.error) {
      setError(result.error.message || "No se pudo enviar el aviso. Intenta nuevamente.")
      return
    }
    setMessage("")
    setPriority("informativo")
    setFeedback(result.data?.notification_warning || "Aviso enviado a Gerencia correctamente.")
  }

  return (
    <section className={`checklist-management-alert-panel${isCritical ? " critical" : ""}`}>
      <div className="tasks-panel-title">
        <div>
          <h3>Aviso a Gerencia</h3>
          <p className="tasks-muted">Usa este espacio solo si encontraste un problema, falla, falta de insumo, equipo danado o situacion que Gerencia deba conocer.</p>
        </div>
      </div>
      <p className="tasks-muted checklist-alert-guidance">Describe el problema observado, no ataques personales. Este aviso es un reporte unidireccional; Gerencia no puede responder aqui.</p>
      <form className="checklist-management-alert-form" onSubmit={submitAlert}>
        <Field label="Detalle del aviso">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, 1000))}
            placeholder="Ejemplo: La camara fria esta marcando temperatura alta."
            rows={4}
            maxLength={1000}
          />
        </Field>
        <Field label="Prioridad">
          <select className={isCritical ? "checklist-alert-priority-critical" : ""} value={priority} onChange={(event) => setPriority(event.target.value)}>
            {CHECKLIST_ALERT_PRIORITIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </Field>
        {isCritical && <p className="tasks-warning">Prioridad critica: Gerencia recibira este aviso como urgente.</p>}
        {error && <p className="tasks-warning">{error}</p>}
        {feedback && <p className="tasks-success">{feedback}</p>}
        <div className="checklist-actions">
          <button type="submit" className={isCritical ? "tasks-primary danger" : "tasks-primary"} disabled={sending || trimmed.length < 10}>
            {sending ? "Enviando..." : "Enviar aviso a Gerencia"}
          </button>
        </div>
      </form>
    </section>
  )
}

function ChecklistManagementAlertsView({ alerts, profiles, selectedAlertId, onSelect, onStatus }) {
  const [filter, setFilter] = useState("open")
  const [notes, setNotes] = useState("")
  const visible = alerts.filter((alert) => !filter || alert.status === filter)
  const selected = alerts.find((alert) => alert.id === selectedAlertId) || visible[0]
  const openCount = alerts.filter((alert) => ["open", "reviewed"].includes(alert.status)).length
  const criticalCount = alerts.filter((alert) => alert.priority === "critico" && !["resolved", "dismissed"].includes(alert.status)).length

  return (
    <div className="checklist-approvals-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title">
          <div>
            <h2>Avisos a Gerencia</h2>
            <p className="tasks-muted">{openCount} pendientes · {criticalCount} criticos</p>
          </div>
        </div>
        <div className="tasks-filters">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="">Todos</option>
            {CHECKLIST_ALERT_STATUSES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div>
        <div className="checklist-management-alerts-table-wrap">
          <table className="checklist-management-alerts-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Colaborador</th>
                <th>Checklist</th>
                <th>Prioridad</th>
                <th>Mensaje</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((alert) => (
                <tr
                  key={alert.id}
                  className={selected?.id === alert.id ? "selected" : ""}
                  onClick={() => { onSelect(alert.id); setNotes("") }}
                >
                  <td>{new Date(alert.created_at).toLocaleString("es-GT")}</td>
                  <td>{profileDisplayName(profiles, alert.sender_profile_id, alert.sender?.full_name || alert.sender?.username)}</td>
                  <td>{alert.checklist_runs?.checklist_templates?.title || "Checklist"}</td>
                  <td><Badge type="priority" value={alert.priority === "critico" ? "critical" : alert.priority === "atencion" ? "high" : "low"} /></td>
                  <td>{alert.message}</td>
                  <td><Badge type="status" value={alert.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!visible.length && <FriendlyEmpty title="No hay avisos." text="Los reportes voluntarios de checklists apareceran aqui." />}
        </div>
      </article>

      {selected && (
        <article className="tasks-panel checklist-approval-detail">
          <div className="tasks-panel-title">
            <div>
              <h2>Aviso de {profileDisplayName(profiles, selected.sender_profile_id, selected.sender?.full_name || selected.sender?.username)}</h2>
              <p className="tasks-muted">{selected.checklist_runs?.checklist_templates?.title || "Checklist"} · {new Date(selected.created_at).toLocaleString("es-GT")}</p>
            </div>
            <Badge type="priority" value={selected.priority === "critico" ? "critical" : selected.priority === "atencion" ? "high" : "low"} />
          </div>
          <div className="checklist-review-summary">
            <div><span>Estado</span><strong>{alertStatusLabel(selected.status)}</strong></div>
            <div><span>Prioridad</span><strong>{alertPriorityLabel(selected.priority)}</strong></div>
            <div><span>Checklist</span><strong>{selected.checklist_runs?.checklist_templates?.title || "Checklist"}</strong></div>
            <div><span>Area</span><strong>{selected.checklist_runs?.area || "Sin area"}</strong></div>
          </div>
          <p className="checklist-alert-message">{selected.message}</p>
          {selected.resolution_notes && <p className="tasks-success">{selected.resolution_notes}</p>}
          <Field label="Notas internas de resolucion"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Solo para registro interno de Gerencia." /></Field>
          <div className="checklist-actions">
            <button type="button" className="tasks-secondary" onClick={() => onStatus(selected.id, "reviewed", notes)}>Marcar revisado</button>
            <button type="button" className="tasks-primary" onClick={() => onStatus(selected.id, "resolved", notes)}>Marcar resuelto</button>
            <button type="button" className="tasks-link danger" onClick={() => onStatus(selected.id, "dismissed", notes)}>Descartar</button>
          </div>
        </article>
      )}
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

function ChecklistApprovalsCenter({ requests, suggestions, templates, profiles, initialRequestId = "", onApprove, onReject, onUpdateSuggestion, onEditTemplate, onEditRequest, canApprove, isSupervisorOnly, currentUserId }) {
  const pendingSuggestions = (suggestions || []).filter((suggestion) => ["pending", "approved"].includes(suggestion.status))
  const formalRequests = (requests || []).filter((request) =>
    canApprove ? ["pending_review", "draft", "rejected"].includes(request.status) : request.submitted_by === currentUserId
  )
  const pendingCount = formalRequests.filter((request) => request.status === "pending_review").length

  return (
    <div className="checklists-admin-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title">
          <div>
            <h2>Aprobaciones de plantillas</h2>
            <p className="tasks-muted">
              {canApprove
                ? `${pendingCount} solicitud(es) pendiente(s) de revision. Admin, gerencia y RRHH pueden aprobar.`
                : "Tus solicitudes de plantillas nuevas o cambios enviados a verificacion."}
            </p>
          </div>
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

      {canApprove ? (
        <ChecklistApprovals
          requests={formalRequests}
          templates={templates}
          profiles={profiles}
          initialRequestId={initialRequestId}
          onApprove={onApprove}
          onReject={onReject}
          canApprove={canApprove}
        />
      ) : (
        <article className="tasks-panel">
          <div className="tasks-panel-title"><div><h2>Mis solicitudes</h2><p className="tasks-muted">{formalRequests.length} registro(s)</p></div></div>
          <div className="checklists-card-grid">
            {formalRequests.map((request) => (
              <article className="checklist-approval-card" key={request.id}>
                <span className="tasks-badge">{approvalStatusLabel(request.status)}</span>
                <strong>{request.title}</strong>
                <small>{request.request_type === "create" ? "Nueva plantilla" : "Cambio de plantilla"} · {profileDisplayName(profiles, request.submitted_by)} · {new Date(request.submitted_at || request.created_at).toLocaleString("es-GT")}</small>
                <p>{request.description || "Sin descripcion."}</p>
                {request.status === "pending_review" && (
                  <p className="tasks-warning">Tu checklist esta pendiente de aprobacion. No podras asignarla ni utilizarla hasta que gerencia, RRHH o admin la autoricen.</p>
                )}
                {request.review_notes && <p className="tasks-warning">{request.review_notes}</p>}
                <div className="checklist-actions">
                  {request.status !== "pending_review" && (
                    <button type="button" className="tasks-secondary" onClick={() => onEditRequest(request)}>Ver / editar</button>
                  )}
                </div>
              </article>
            ))}
            {!formalRequests.length && <FriendlyEmpty title="No tienes solicitudes." text="Cuando envies una checklist a aprobacion aparecera aqui." />}
          </div>
        </article>
      )}
    </div>
  )
}

function ChecklistApprovals({ requests, templates, profiles, initialRequestId = "", onApprove, onReject, canApprove }) {
  const [selectedId, setSelectedId] = useState(initialRequestId || "")
  const [notes, setNotes] = useState("")
  const visible = (requests || []).filter((request) => canApprove || request.submitted_by)
  const selected = visible.find((request) => request.id === selectedId) || visible.find((request) => request.status === "pending_review")
  const currentTemplate = selected?.template_id ? templates.find((template) => template.id === selected.template_id) : null

  useEffect(() => {
    if (initialRequestId) setSelectedId(initialRequestId)
  }, [initialRequestId])

  return (
    <div className="checklist-approvals-layout">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Cambios formales de plantilla</h2><p className="tasks-muted">Nuevas plantillas y cambios enviados por supervisores.</p></div></div>
        <div className="checklists-card-grid">
          {visible.map((request) => (
            <button type="button" className={selected?.id === request.id ? "checklist-approval-card selected" : "checklist-approval-card"} key={request.id} onClick={() => { setSelectedId(request.id); setNotes("") }}>
              <span className="tasks-badge">{approvalStatusLabel(request.status)}</span>
              <strong>{request.title}</strong>
              <small>{request.request_type === "create" ? "Nueva plantilla" : "Cambio de plantilla"} · {profileDisplayName(profiles, request.submitted_by)} · {new Date(request.submitted_at || request.created_at).toLocaleDateString("es-GT")}</small>
            </button>
          ))}
          {!visible.length && <FriendlyEmpty title="No hay solicitudes pendientes." text="Cuando un supervisor envie una plantilla a aprobacion aparecera aqui." />}
        </div>
      </article>

      {selected && (
        <article className="tasks-panel checklist-approval-detail">
          <div className="tasks-panel-title"><div><h2>{selected.title}</h2><p className="tasks-muted">{approvalStatusLabel(selected.status)} · {selected.request_type === "create" ? "Nueva plantilla" : "Cambio de plantilla"}</p></div><span className="tasks-badge">{selected.area || "Sin area"}</span></div>
          <div className="checklist-review-summary">
            <div><span>Creador</span><strong>{profileDisplayName(profiles, selected.submitted_by)}</strong></div>
            <div><span>Fecha</span><strong>{new Date(selected.submitted_at || selected.created_at).toLocaleString("es-GT")}</strong></div>
            <div><span>Items</span><strong>{(selected.items_snapshot || []).length}</strong></div>
          </div>
          <div className="checklist-compare-grid">
            <ChecklistVersionSummary title="Version actual" template={currentTemplate} />
            <ChecklistRequestSummary title="Version propuesta" request={selected} />
          </div>
          <div className="checklist-preview-items">
            {(selected.items_snapshot || []).map((item, index) => <div key={`${selected.id}-${index}`}><strong>{index + 1}. {item.title}</strong><span>{friendlyResponseType(item.response_type)}{item.requires_photo ? " · foto" : ""}{item.requires_comment ? " · comentario" : ""}</span></div>)}
          </div>
          {selected.review_notes && <p className="tasks-warning">{selected.review_notes}</p>}
          {canApprove && selected.status === "pending_review" && (
            <>
              <Field label="Nota de revision"><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Obligatoria si rechazas" /></Field>
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
          <small>{checklistAreaLabel(template.area)} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, template.frequency)} · {template.checklist_template_items?.length || 0} items</small>
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
      <small>{checklistAreaLabel(request.area)} · {friendlyChecklistLabel(CHECKLIST_FREQUENCIES, request.frequency)} · {(request.items_snapshot || []).length} items</small>
    </div>
  )
}

function ChecklistReports({ runs, templates, profiles }) {
  const [filters, setFilters] = useState({ area: "", profile: "", template: "", status: "", date: "", minProgress: "" })
  const profileName = (id) => profiles.find((profile) => profile.id === id)?.full_name || id || "Sin colaborador"
  const filteredRuns = runs.filter((run) => {
    if (filters.area && run.area !== filters.area) return false
    if (filters.profile && run.assigned_profile_id !== filters.profile) return false
    if (filters.template && run.template_id !== filters.template) return false
    if (filters.date && run.run_date !== filters.date) return false
    if (filters.minProgress && checklistRunProgress(run) < Number(filters.minProgress)) return false
    if (!filters.status) return true
    if (filters.status === "completion_timing:on_time") {
      return run.status === "completed" && getChecklistOperationalDisplayStatus(run) === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_A_TIEMPO
    }
    if (filters.status === "completion_timing:late") {
      return run.status === "completed" && getChecklistOperationalDisplayStatus(run) === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE
    }
    if (filters.status === "replaced") return hasChecklistReplacement(run)
    return run.status === filters.status
  })
  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }))
  }
  return (
    <div className="tasks-reports">
      <article className="tasks-panel">
        <div className="tasks-panel-title"><div><h2>Filtros</h2><p className="tasks-muted">{filteredRuns.length} checklists encontradas</p></div></div>
        <div className="tasks-filters">
          <select value={filters.area} onChange={(event) => updateFilter("area", event.target.value)}><option value="">Todas las areas</option>{CHECKLIST_AREAS.map((area) => <option key={area} value={area}>{checklistAreaLabel(area)}</option>)}</select>
          <select value={filters.profile} onChange={(event) => updateFilter("profile", event.target.value)}><option value="">Todos los responsables</option>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}</select>
          <select value={filters.template} onChange={(event) => updateFilter("template", event.target.value)}><option value="">Todas las checklists</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.title}</option>)}</select>
          <select value={filters.status} onChange={(event) => updateFilter("status", event.target.value)}><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="in_progress">En progreso</option><option value="completed">Completadas</option><option value="overdue">Vencidas</option><option value="completion_timing:on_time">Completadas a tiempo</option><option value="completion_timing:late">Completadas tarde</option><option value="replaced">Reasignadas</option></select>
          <input type="date" value={filters.date} onChange={(event) => updateFilter("date", event.target.value)} />
          <input type="number" min="0" max="100" value={filters.minProgress} onChange={(event) => updateFilter("minProgress", event.target.value)} placeholder="% minimo" />
        </div>
      </article>
      <ChecklistReportTable title="Cumplimiento por area" rows={groupChecklistCompliance(filteredRuns, (run) => run.area || "Sin area")} />
      <ChecklistReportTable title="Cumplimiento por colaborador" rows={groupChecklistCompliance(filteredRuns, (run) => profileName(run.assigned_profile_id))} />
      <ChecklistReportTable title="Cumplimiento por plantilla" rows={groupChecklistCompliance(filteredRuns, (run) => templates.find((template) => template.id === run.template_id)?.title || run.checklist_templates?.title || "Checklist")} />
      <article className="tasks-panel"><h2>Checklists vencidas</h2>{filteredRuns.filter((run) => run.status === "overdue").map((run) => <CompactChecklistRun key={run.id} run={run} />)}{!filteredRuns.some((run) => run.status === "overdue") && <Empty text="No hay checklists vencidas." />}</article>
    </div>
  )
}

function ChecklistReportTable({ title, rows }) {
  return (
    <article className="tasks-panel">
      <h2>{title}</h2>
      <div className="tasks-report-table checklist-report-table">
        <header><span>Nombre</span><span>Asignadas</span><span>Completadas</span><span>Vencidas</span><span>Cumplimiento</span><span>Puntos</span></header>
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

function isChecklistRunCompleted(run) {
  return run?.status === "completed"
}

function checklistCompletedSortKey(run) {
  return run?.completed_at || run?.updated_at || run?.run_date || ""
}

function normalizeChecklistSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
}

function matchesCompletedChecklistSearch(run, profiles, search) {
  if (!search) return true
  const haystack = normalizeChecklistSearchText([
    run.checklist_templates?.title,
    responsibleLabel(run, profiles),
    run.area,
    run.assigned_role
  ].filter(Boolean).join(" "))
  return haystack.includes(search)
}

function historicOverdueDaysLabel(runDate) {
  const days = daysPastRunDate(runDate)
  if (days === 1) return "Vencida hace 1 día"
  return `Vencida hace ${days} días`
}

function groupHistoricOverdueRuns(runs, profiles = []) {
  const byTemplate = new Map()
  runs.forEach((run) => {
    const templateId = run.template_id || run.id
    if (!byTemplate.has(templateId)) {
      byTemplate.set(templateId, {
        templateId,
        title: run.checklist_templates?.title || "Checklist",
        dateGroups: new Map(),
        totalRuns: 0
      })
    }
    const templateGroup = byTemplate.get(templateId)
    const runDate = run.run_date || "sin-fecha"
    if (!templateGroup.dateGroups.has(runDate)) templateGroup.dateGroups.set(runDate, [])
    templateGroup.dateGroups.get(runDate).push(run)
    templateGroup.totalRuns += 1
  })

  return [...byTemplate.values()]
    .map((templateGroup) => ({
      ...templateGroup,
      dateGroups: [...templateGroup.dateGroups.entries()]
        .sort((a, b) => String(b[0]).localeCompare(String(a[0])))
        .map(([runDate, dateRuns]) => ({
          runDate,
          daysOverdue: daysPastRunDate(runDate),
          runs: [...dateRuns].sort((a, b) => String(responsibleLabel(a, profiles)).localeCompare(String(responsibleLabel(b, profiles))))
        }))
    }))
    .sort((a, b) => a.title.localeCompare(b.title))
}

function parseChecklistLocalDate(dateStr) {
  if (!dateStr) return null
  const [year, month, day] = String(dateStr).split("-").map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day)
}

function formatChecklistRunDateLabel(dateStr) {
  const date = parseChecklistLocalDate(dateStr)
  if (!date) return "Sin fecha"
  return date.toLocaleDateString("es-GT", { day: "2-digit", month: "2-digit", year: "numeric" })
}

function daysPastRunDate(runDate) {
  const run = parseChecklistLocalDate(runDate)
  const today = parseChecklistLocalDate(TODAY)
  if (!run || !today) return 0
  return Math.round((today.getTime() - run.getTime()) / 86400000)
}

function isChecklistRunOverdue(run) {
  return isChecklistOperationallyExpired(run)
}

function checklistRunScheduleLabel(run) {
  const displayStatus = getChecklistOperationalDisplayStatus(run)
  if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.VENCIDA) {
    const days = daysPastRunDate(run.run_date)
    if (days === 1) return "Vencida hace 1 día"
    return `Vencida hace ${days} días`
  }
  if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA) {
    return `Esperada: ${formatChecklistDueDeadline(run).replace("Límite: ", "")}`
  }
  return `Programada: ${formatChecklistRunDateLabel(run.run_date)}`
}

function formatChecklistDueDeadline(run) {
  if (!run?.due_time) return "Sin hora esperada"
  const time = String(run.due_time).slice(0, 5)
  const datePart = run.run_date === TODAY ? "hoy" : formatChecklistRunDateLabel(run.run_date)
  return `Esperada: ${datePart} · ${time}`
}

function getChecklistRunContextBadges(run, variant = "today") {
  const badges = []
  const displayStatus = getChecklistOperationalDisplayStatus(run)
  if (run.status === "rejected") return ["RECHAZADA"]
  if (run.status === "completed") {
    if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE) return ["COMPLETADA TARDE"]
    if (hasChecklistReplacement(run)) return ["REASIGNADA", "COMPLETADA"]
    return ["COMPLETADA"]
  }
  if (variant === "today" && isChecklistRunTodayWork(run)) badges.push("HOY")
  if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.VENCIDA) badges.push("VENCIDA")
  if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA) badges.push("ATRASADA")
  if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE) badges.push("PENDIENTE")
  if (hasChecklistReplacement(run) && run.status !== "completed") badges.push("REASIGNADA")
  return badges
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

function alertStatusLabel(value) {
  return CHECKLIST_ALERT_STATUSES.find(([id]) => id === value)?.[1] || value
}

function alertPriorityLabel(value) {
  return CHECKLIST_ALERT_PRIORITIES.find(([id]) => id === value)?.[1] || value
}

function isChecklistRestaurantWideRole(role) {
  return ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"].includes(normalizeRole(role))
}

function normalizeChecklistAreaKey(value) {
  if (!value) return ""
  const trimmed = String(value).trim().toLowerCase()
  const direct = CHECKLIST_AREAS.find((area) => area.toLowerCase() === trimmed)
  if (direct) return direct
  const fromLabel = Object.entries(CHECKLIST_AREA_LABELS).find(([, label]) => String(label).trim().toLowerCase() === trimmed)
  return fromLabel?.[0] || String(value).trim()
}

function checklistAreasMatch(left, right) {
  if (!left || !right) return false
  return normalizeChecklistAreaKey(left) === normalizeChecklistAreaKey(right)
}

function getChecklistAssignableProfiles(user, profiles, { templateArea = "" } = {}) {
  const role = normalizeRole(user?.role)
  const actorId = String(user?.id || "")

  return (profiles || []).filter((profile) => {
    if (["inactive", "suspended"].includes(String(profile.status || "").toLowerCase())) return false
    if (isChecklistRestaurantWideRole(role)) return true
    if (role !== "supervisor") return false
    if (String(profile.supervisor_profile_id || "") !== actorId) return false
    if (templateArea && profile.area_name && !checklistAreasMatch(templateArea, profile.area_name)) return false
    return true
  })
}

function userChecklistArea(user) {
  return user?.area_name || user?.areaName || ""
}

function canSeeChecklistRun(run, user, profiles) {
  const role = normalizeRole(user?.role)
  const userArea = userChecklistArea(user)
  if (isChecklistRestaurantWideRole(role)) return true
  if (run.assigned_profile_id === user?.id) return true

  const replaced = hasChecklistReplacement(run)
  if (replaced && run.original_assigned_profile_id === user?.id) return false

  if (!run.assigned_profile_id && run.assigned_role && normalizeRole(run.assigned_role) === role) return true
  if (!run.assigned_profile_id && run.area && userArea && checklistAreasMatch(run.area, userArea)) return true
  if (role === "supervisor") {
    if (run.supervisor_profile_id === user?.id) return true
    if (userArea && run.area && checklistAreasMatch(run.area, userArea)) return true
    const assigned = profiles.find((profile) => profile.id === run.assigned_profile_id)
    if (assigned && String(assigned.supervisor_profile_id || "") === String(user?.id || "")) return true
    return Boolean(userArea && assigned?.area_name && checklistAreasMatch(assigned.area_name, userArea))
  }
  return false
}

function profileDisplayName(profiles, profileId, fallbackName = "") {
  const profile = profiles.find((item) => item.id === profileId)
  return profile?.full_name || profile?.username || fallbackName || "Colaborador"
}

function validateChecklistAssignmentResult(run, payload, { existing = false } = {}) {
  const errors = []
  if (!run?.id) errors.push("missing run id")
  if (run?.template_id !== payload.template_id) errors.push("missing or mismatched template_id")
  if (!run?.run_date) errors.push("missing run_date")
  if (payload.run_date && run?.run_date !== payload.run_date) errors.push("mismatched run_date")
  if (!run?.assigned_profile_id && !run?.assigned_role) errors.push("missing assignee")
  if (!existing && run?.status !== "pending") errors.push("status is not pending")
  if (!Array.isArray(run?.checklist_run_items) || run.checklist_run_items.length === 0) errors.push("missing checklist run items")
  return errors
}

function checklistLogicalRunKey(run) {
  return [
    run?.template_id || "NO_TEMPLATE",
    run?.run_date || "NO_DATE",
    run?.assigned_profile_id || "NO_PROFILE",
    String(run?.assigned_role || "").trim() || "NO_ROLE",
    String(run?.area || "").trim() || "NO_AREA"
  ].join("|")
}

function preferChecklistRun(left, right) {
  const statusRank = { in_progress: 0, pending: 1, overdue: 2, rejected: 3, completed: 4 }
  const leftRank = statusRank[left?.status] ?? 9
  const rightRank = statusRank[right?.status] ?? 9
  if (leftRank !== rightRank) return leftRank < rightRank ? left : right
  return String(left?.created_at || "") <= String(right?.created_at || "") ? left : right
}

function dedupeLogicalChecklistRuns(runs) {
  const grouped = new Map()
  ;(runs || []).forEach((run) => {
    const key = checklistLogicalRunKey(run)
    grouped.set(key, grouped.has(key) ? preferChecklistRun(grouped.get(key), run) : run)
  })
  return Array.from(grouped.values())
}

function groupChecklistCompliance(runs, getter) {
  const grouped = {}
  runs.forEach((run) => {
    const label = getter(run)
    if (!grouped[label]) grouped[label] = { label, assigned: 0, completed: 0, late: 0, onTime: 0, points: 0 }
    grouped[label].assigned += 1
    if (run.status === "completed") {
      grouped[label].completed += 1
      const displayStatus = getChecklistOperationalDisplayStatus(run)
      if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_TARDE) grouped[label].late += 1
      if (displayStatus === CHECKLIST_OPERATIONAL_STATUS.COMPLETADA_A_TIEMPO) grouped[label].onTime += 1
    }
    if (run.status === "overdue" || getChecklistOperationalDisplayStatus(run) === CHECKLIST_OPERATIONAL_STATUS.VENCIDA) {
      grouped[label].late += 1
    }
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
  return (
    <div className="tasks-compact">
      <div>
        <strong>{task.title}</strong>
        <span>{formatOperationalTime(task.scheduledStart)} · {employeeNames(task.assignedTo, employees) || "Sin asignar"} · Limite: {formatTaskDueAt(task)}</span>
      </div>
      <div className="tasks-compact-badges">
        {task.status === "late" && <Badge type="status" value="late" />}
        <Badge type="priority" value={task.priority} />
      </div>
    </div>
  )
}

function Badge({ type, value }) {
  const labels = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica", easy: "Fácil", hard: "Difícil", expert: "Experta", pending: "Pendiente", open: "Abierta", reviewed: "Revisado", acknowledged: "Reconocida", in_progress: "En progreso", resolved: "Resuelta", dismissed: "Descartada", pending_review: "Pendiente de aprobación", completed: "Completada", late: "Vencida", overdue: "Vencida", rejected: "Devuelta", cancelled: "Cancelada", review_required: "Requiere revisión" }
  return <span className={`tasks-badge ${type}-${value}`}>{labels[value] || value}</span>
}

function Field({ label, tooltip, hint, children }) {
  return (
    <label className="tasks-field">
      <span className="tasks-field-label">
        <span>{label}</span>
        {tooltip && <InfoTooltip text={tooltip} />}
      </span>
      {children}
      {hint && <small className="tasks-field-hint">{hint}</small>}
    </label>
  )
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

function resolveChecklistLibraryPermissions(userRole) {
  const role = normalizeRole(userRole)
  return {
    canViewChecklistLibrary: ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh", "supervisor"].includes(role),
    canCreateDirectly: ["admin", "gerente_general", "recursos_humanos", "rrhh"].includes(role),
    canEditDirectly: ["admin", "gerente_general", "recursos_humanos", "rrhh"].includes(role),
    isSupervisorOnly: role === "supervisor",
    canProposeEdits: role === "supervisor",
    canApproveTemplateChanges: CHECKLIST_TEMPLATE_APPROVERS.includes(role),
    isLibraryAdmin: ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"].includes(role),
    canAssignChecklists: ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh", "supervisor"].includes(role),
    canDeleteTemplates: ["admin", "gerente_general"].includes(role)
  }
}

function getTemplatePendingRequest(template, changeRequests) {
  return (changeRequests || []).find((request) =>
    request.template_id === template.id &&
    ["draft", "pending_review", "rejected"].includes(request.status)
  ) || null
}

function getVisiblePendingCreateRequests(changeRequests, userId, isLibraryAdmin, isSupervisorOnly) {
  return (changeRequests || []).filter((request) =>
    request.request_type === "create" &&
    ["draft", "pending_review", "rejected"].includes(request.status) &&
    (isLibraryAdmin || (isSupervisorOnly && request.submitted_by === userId))
  )
}

function templateLibraryBadge(template, pendingRequest) {
  if (pendingRequest?.status === "pending_review") return { label: "Pendiente aprobacion", className: "pending" }
  if (pendingRequest?.status === "draft") return { label: "Borrador", className: "draft" }
  if (pendingRequest?.status === "rejected") return { label: "Rechazada", className: "rejected" }
  if (template.status === "inactive") return { label: "Archivada", className: "archived" }
  if (template.status === "active") return { label: "Activa", className: "active" }
  return { label: template.status || "Plantilla", className: "" }
}

export default Tasks
