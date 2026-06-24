import { getChecklistOperationalDisplayStatus, CHECKLIST_OPERATIONAL_STATUS } from "./checklistOperationalStatus"

export const OPERATIONAL_PROCESS_TYPES = [
  { value: "checklist_bundle", label: "Grupo de checklists" }
]

export const OPERATIONAL_COMPLETION_MODES = [
  { value: "all_required", label: "Todas requeridas" },
  { value: "sequential", label: "Secuencial" }
]

export const OPERATIONAL_FREQUENCY_TYPES = [
  { value: "manual", label: "Manual (Ejecutar hoy)" },
  { value: "daily", label: "Diaria" },
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensual" }
]

export const OPERATIONAL_WEEKDAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mie"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sab"],
  [7, "Dom"]
]

export function isOperationalProcessManual(template) {
  return (template?.frequency_type || "manual") === "manual"
}

export function normalizeOperationalRecurrenceDays(days) {
  return [...new Set((Array.isArray(days) ? days : []).map((day) => Number(day)).filter((day) => day >= 1 && day <= 7))].sort((a, b) => a - b)
}

export function formatOperationalProcessFrequency(template) {
  const type = template?.frequency_type || "manual"
  if (type === "manual") return "Manual"
  if (type === "daily") return "Diaria"
  if (type === "weekly") {
    const days = normalizeOperationalRecurrenceDays(template?.recurrence_days)
    if (!days.length) return "Semanal"
    const labels = days.map((day) => OPERATIONAL_WEEKDAYS.find(([id]) => id === day)?.[1] || day)
    return `Semanal (${labels.join(", ")})`
  }
  if (type === "monthly") {
    const day = Number(template?.recurrence_month_day || 1)
    return `Mensual (día ${day})`
  }
  return type
}

export function createEmptyProcessStep(clientKey = `step-${Date.now()}`) {
  return {
    client_key: clientKey,
    child_template_id: "",
    step_label: "",
    step_order: 1,
    assigned_profile_id: "",
    assigned_role: "",
    area: "",
    supervisor_profile_id: "",
    is_required: true,
    depends_on_client_key: ""
  }
}

export function normalizeProcessSteps(steps = []) {
  return steps.map((step, index) => ({
    client_key: step.client_key || step.id || `step-${index + 1}`,
    child_template_id: step.child_template_id || "",
    step_label: String(step.step_label || "").trim(),
    step_order: Number(step.step_order) || index + 1,
    assigned_profile_id: step.assigned_profile_id || "",
    assigned_role: step.assigned_role || "",
    area: step.area || "",
    supervisor_profile_id: step.supervisor_profile_id || "",
    is_required: step.is_required !== false,
    depends_on_client_key: step.depends_on_client_key || ""
  }))
}

export function buildProcessTemplatePayload(form, steps) {
  return {
    payload: {
      id: form.id || null,
      title: form.title?.trim(),
      description: form.description?.trim() || null,
      area: form.area?.trim() || null,
      process_type: form.process_type || "checklist_bundle",
      completion_mode: form.completion_mode || "all_required",
      allow_parallel_execution: form.allow_parallel_execution !== false,
      status: form.status || "active",
      supervisor_profile_id: form.supervisor_profile_id || null,
      frequency_type: form.frequency_type || "manual",
      recurrence_days: form.frequency_type === "weekly"
        ? normalizeOperationalRecurrenceDays(form.recurrence_days)
        : [],
      recurrence_month_day: form.frequency_type === "monthly"
        ? Number(form.recurrence_month_day || 1)
        : null
    },
    steps: normalizeProcessSteps(steps).map((step, index) => ({
      client_key: step.client_key,
      child_template_id: step.child_template_id,
      step_label: step.step_label,
      step_order: index + 1,
      assigned_profile_id: step.assigned_profile_id || null,
      assigned_role: step.assigned_role || null,
      area: step.area || null,
      supervisor_profile_id: step.supervisor_profile_id || null,
      is_required: step.is_required,
      depends_on_client_key: step.depends_on_client_key || null
    }))
  }
}

export function mapProcessDetailSteps(detail) {
  const steps = detail?.steps || []
  return steps.map((step, index) => ({
    client_key: step.id || `step-${index + 1}`,
    child_template_id: step.child_template_id || "",
    step_label: step.step_label || step.child_template?.title || "",
    step_order: step.step_order ?? index + 1,
    assigned_profile_id: step.assigned_profile_id || "",
    assigned_role: step.assigned_role || "",
    area: step.area || "",
    supervisor_profile_id: step.supervisor_profile_id || "",
    is_required: step.is_required !== false,
    depends_on_client_key: step.depends_on_step_id
      ? (steps.find((candidate) => candidate.id === step.depends_on_step_id)?.id || "")
      : ""
  }))
}

export function getProcessRunProgress(processRunDetail) {
  return processRunDetail?.progress || {
    required_steps: 0,
    completed_steps: 0,
    in_progress_steps: 0,
    pending_steps: 0,
    cancelled_steps: 0,
    percent: 0
  }
}

function stepRunRef(step) {
  return step?.run || step?.checklist_run || null
}

function countAnsweredItems(items = []) {
  return items.filter((item) => (
    Boolean(
      item?.checked
      || item?.response_text
      || item?.response_number != null
      || item?.response_date
      || item?.response_time
      || item?.photo_url
      || item?.completed_at
      || (item?.response_json && Object.keys(item.response_json).length > 0)
    )
  )).length
}

export function getProcessItemTotals(processDetail) {
  const steps = processDetail?.steps || []
  let completedItems = 0
  let totalItems = 0

  steps.forEach((step) => {
    const run = stepRunRef(step)
    if (run?.checklist_run_items?.length) {
      totalItems += run.checklist_run_items.length
      completedItems += countAnsweredItems(run.checklist_run_items)
      return
    }
    if (run?.item_count != null || run?.completed_items != null) {
      totalItems += Number(run.item_count) || 0
      completedItems += Number(run.completed_items) || 0
      return
    }
    const embedded = step.checklist_run
    if (embedded) {
      totalItems += Number(embedded.item_count) || 0
      completedItems += Number(embedded.completed_items) || 0
    }
  })

  return { completedItems, totalItems }
}

export function getProcessAssigneeCount(processDetail) {
  const assignees = new Set()
  ;(processDetail?.steps || []).forEach((step) => {
    const run = stepRunRef(step)
    if (run?.assigned_profile_id) assignees.add(String(run.assigned_profile_id))
  })
  return assignees.size
}

export function mergeOperationalProcessDetails(existing = [], incoming = []) {
  const merged = new Map()
  ;[...(existing || []), ...(incoming || [])].forEach((detail) => {
    const id = detail?.process_run?.id
    if (!id) return
    merged.set(id, detail)
  })
  return Array.from(merged.values())
}

export function isProcessStepUnlocked(step, allSteps, template) {
  if (!step.depends_on_run_step_id) return true
  const dependency = allSteps.find((candidate) => candidate.id === step.depends_on_run_step_id)
  if (!dependency) return true
  const depStatus = dependency.checklist_run?.status
  if (depStatus === "completed") return true
  if (template?.allow_parallel_execution !== false && template?.completion_mode !== "sequential") {
    return true
  }
  return false
}

export function getStepDisplayStatus(step, run) {
  if (!run) return "pending"
  const status = String(run.status || "").toLowerCase()
  if (status === "cancelled") return "cancelled"
  if (status === "completed") return "completed"
  if (status === "pending_review") return "pending_review"
  if (status === "in_progress") return "in_progress"
  if (status === "rejected") return "rejected"
  const operational = getChecklistOperationalDisplayStatus(run)
  if (operational === CHECKLIST_OPERATIONAL_STATUS.VENCIDA) return "overdue"
  if (operational === CHECKLIST_OPERATIONAL_STATUS.PENDIENTE_ATRASADA) return "late"
  return "pending"
}

export function getProcessTodaySummary(processDetail) {
  const steps = processDetail?.steps || []
  const progress = getProcessRunProgress(processDetail)
  const itemTotals = getProcessItemTotals(processDetail)
  const assigneeCount = getProcessAssigneeCount(processDetail)
  const template = processDetail?.template || {}
  const processRun = processDetail?.process_run || {}

  let pending = 0
  let inProgress = 0
  let late = 0
  let completed = 0

  steps.forEach((step) => {
    const run = step.run || step.checklist_run || null
    const status = getStepDisplayStatus(step, run)
    if (status === "completed" || status === "pending_review") completed += 1
    else if (status === "in_progress") inProgress += 1
    else if (status === "overdue" || status === "late") late += 1
    else pending += 1
  })

  const total = steps.length
  const hasStarted = inProgress > 0 || completed > 0 || late > 0
  let label = "Pendiente"
  let tone = "pending"

  if (late > 0) {
    label = "Con atrasos"
    tone = "late"
  } else if (
    processRun.status === "completed"
    || (total > 0 && completed === total)
    || progress.percent >= 100
  ) {
    label = "Completado"
    tone = "completed"
  } else if (inProgress > 0) {
    label = "En progreso"
    tone = "in_progress"
  }

  const buttonLabel = !hasStarted
    ? "Ver proceso"
    : (tone === "completed" ? "Ver proceso" : "Continuar proceso")

  return {
    pending,
    inProgress,
    late,
    completed,
    total,
    progress,
    itemTotals,
    assigneeCount,
    runDate: processRun.run_date || null,
    label,
    tone,
    buttonLabel,
    area: template.area || processRun.area || null,
    title: template.title || "Proceso operativo"
  }
}

export function getProcessChildCardTone(step, run) {
  const status = getStepDisplayStatus(step, run)
  if (status === "completed") return "completed"
  if (status === "pending_review") return "pending-review"
  if (status === "in_progress") return "in-progress"
  if (status === "overdue" || status === "late") return "overdue"
  if (status === "cancelled") return "cancelled"
  return "pending"
}

export function getProcessChildActionLabel(step, run, { disabled = false } = {}) {
  if (disabled) return "Bloqueada"
  const status = getStepDisplayStatus(step, run)
  if (status === "pending" || status === "rejected") return "Iniciar"
  if (status === "in_progress") return "Continuar"
  if (status === "pending_review") return "Revisar"
  if (status === "completed") return "Completada"
  if (status === "overdue" || status === "late") return "Continuar"
  return "Iniciar"
}

export function getProcessChildStatusLabel(step, run) {
  const status = getStepDisplayStatus(step, run)
  if (status === "completed") return "Completada"
  if (status === "pending_review") return "Revisión"
  if (status === "in_progress") return "En progreso"
  if (status === "overdue" || status === "late") return "Atrasada"
  if (status === "cancelled") return "Cancelada"
  if (status === "rejected") return "Rechazada"
  return "Pendiente"
}

export function getNextProcessStepToWork(processDetail) {
  const template = processDetail?.template || {}
  const steps = processDetail?.steps || []

  const rank = (step) => {
    const run = step.run || step.checklist_run || null
    const status = getStepDisplayStatus(step, run)
    if (!isProcessStepUnlocked(step, steps, template)) return 99
    if (status === "in_progress") return 0
    if (status === "overdue" || status === "late") return 1
    if (status === "rejected") return 2
    if (status === "pending") return 3
    return 10
  }

  return steps
    .filter((step) => {
      const run = step.run || step.checklist_run || null
      const status = getStepDisplayStatus(step, run)
      return isProcessStepUnlocked(step, steps, template)
        && !["completed", "pending_review", "cancelled"].includes(status)
    })
    .sort((left, right) => {
      const rankDiff = rank(left) - rank(right)
      if (rankDiff !== 0) return rankDiff
      return (left.step_order ?? 0) - (right.step_order ?? 0)
    })[0] || null
}

export function isProcessStepResolved(step, run) {
  const status = getStepDisplayStatus(step, run)
  return status === "completed" || status === "pending_review" || status === "cancelled"
}

export function partitionProcessStepsForDetail(steps = []) {
  return groupProcessStepsForDisplay(steps).map((group) => ({
    ...group,
    activeSteps: group.steps.filter((step) => !isProcessStepResolved(step, step.run || step.checklist_run || null)),
    completedSteps: group.steps.filter((step) => isProcessStepResolved(step, step.run || step.checklist_run || null))
  }))
}

export function getProcessStepLabel(step, run) {
  return step?.step_label || run?.checklist_templates?.title || "Checklist"
}

export function groupProcessStepsForDisplay(steps = []) {
  const groups = new Map()

  steps.forEach((step) => {
    const run = step.run || step.checklist_run || null
    const area = String(run?.area || step.area || "").trim()
    const role = String(run?.assigned_role || step.assigned_role || "").trim()
    const key = area || role || "General"
    const label = area
      ? (role ? `${area} · ${role}` : area)
      : (role || "General")

    if (!groups.has(key)) {
      groups.set(key, { key, label, steps: [] })
    }
    groups.get(key).steps.push(step)
  })

  return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label, "es"))
}

export function partitionRunsForProcesses(runs, processRunDetails = [], { groupProcesses = false } = {}) {
  if (!groupProcesses || !processRunDetails.length) {
    return { processGroups: [], orphanRuns: runs }
  }

  const groupedRunIds = new Set()
  const runsById = new Map((runs || []).map((run) => [run.id, run]))
  const processGroups = processRunDetails.map((detail) => {
    const steps = detail?.steps || []
    steps.forEach((step) => {
      if (step.checklist_run_id) groupedRunIds.add(step.checklist_run_id)
    })
    return {
      ...detail,
      steps: steps.map((step) => ({
        ...step,
        run: runsById.get(step.checklist_run_id) || step.run || null,
        checklist_run: step.checklist_run || runsById.get(step.checklist_run_id) || null
      }))
    }
  })

  const orphanRuns = (runs || []).filter((run) => !groupedRunIds.has(run.id))
  return { processGroups, orphanRuns }
}

export function partitionTodayRunsForProcesses(todayRuns, processRunDetails = [], options = {}) {
  return partitionRunsForProcesses(todayRuns, processRunDetails, options)
}

export function filterProcessGroupsWithRuns(processGroups = [], runs = []) {
  const runIds = new Set((runs || []).map((run) => run.id))
  return (processGroups || []).filter((detail) => (
    (detail?.steps || []).some((step) => runIds.has(step.checklist_run_id))
  )).map((detail) => ({
    ...detail,
    steps: (detail.steps || []).map((step) => ({
      ...step,
      run: (runs || []).find((run) => run.id === step.checklist_run_id) || step.run || null
    }))
  }))
}

export function moveProcessStep(steps, fromIndex, toIndex) {
  const next = [...steps]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((step, index) => ({ ...step, step_order: index + 1 }))
}
