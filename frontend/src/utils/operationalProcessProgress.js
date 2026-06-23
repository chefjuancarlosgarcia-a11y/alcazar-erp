import { getChecklistOperationalDisplayStatus, CHECKLIST_OPERATIONAL_STATUS } from "./checklistOperationalStatus"

export const OPERATIONAL_PROCESS_TYPES = [
  { value: "checklist_bundle", label: "Grupo de checklists" }
]

export const OPERATIONAL_COMPLETION_MODES = [
  { value: "all_required", label: "Todas requeridas" },
  { value: "sequential", label: "Secuencial" }
]

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
      supervisor_profile_id: form.supervisor_profile_id || null
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

export function partitionTodayRunsForProcesses(todayRuns, processRunDetails = [], { groupProcesses = false } = {}) {
  if (!groupProcesses || !processRunDetails.length) {
    return { processGroups: [], orphanRuns: todayRuns }
  }

  const groupedRunIds = new Set()
  const processGroups = processRunDetails.map((detail) => {
    const steps = detail?.steps || []
    steps.forEach((step) => {
      if (step.checklist_run_id) groupedRunIds.add(step.checklist_run_id)
    })
    const runsById = new Map(todayRuns.map((run) => [run.id, run]))
    return {
      ...detail,
      steps: steps.map((step) => ({
        ...step,
        run: runsById.get(step.checklist_run_id) || null
      }))
    }
  })

  const orphanRuns = todayRuns.filter((run) => !groupedRunIds.has(run.id))
  return { processGroups, orphanRuns }
}

export function moveProcessStep(steps, fromIndex, toIndex) {
  const next = [...steps]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  return next.map((step, index) => ({ ...step, step_order: index + 1 }))
}
