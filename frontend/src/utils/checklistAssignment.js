import { normalizeRole } from "./profilePermissions"
import { normalizeChecklistRunDate, normalizeChecklistRunStatus } from "./checklistOperationalStatus"

const ACTIVE_ASSIGNMENT_STATUSES = ["pending", "in_progress", "overdue", "rejected", "pending_review"]

export function isChecklistRunAssignmentActive(run) {
  return ACTIVE_ASSIGNMENT_STATUSES.includes(normalizeChecklistRunStatus(run?.status))
}

export function normalizeChecklistAssignmentPayload(payload = {}) {
  return {
    template_id: payload.template_id || null,
    run_date: normalizeChecklistRunDate(payload.run_date),
    area: String(payload.area || "").trim() || null,
    assigned_role: String(payload.assigned_role || "").trim() || null,
    assigned_profile_id: payload.assigned_profile_id || null,
    due_time: payload.due_time || null,
    notes: payload.notes?.trim() || null
  }
}

export function isSameChecklistAssignee(run, payload = {}) {
  const leftProfile = run?.assigned_profile_id || null
  const rightProfile = payload.assigned_profile_id || null
  const leftRole = String(run?.assigned_role || "").trim()
  const rightRole = String(payload.assigned_role || "").trim()
  const leftArea = String(run?.area || "").trim()
  const rightArea = String(payload.area || "").trim()
  return leftProfile === rightProfile && leftRole === rightRole && leftArea === rightArea
}

function matchesAssignmentArea(run, scopeArea) {
  if (!scopeArea) return true
  const runArea = String(run?.area || "").trim() || null
  if (!runArea) return true
  return runArea.toLowerCase() === scopeArea.toLowerCase()
}

export function findChecklistAssignmentConflicts(payload = {}, runs = []) {
  const normalized = normalizeChecklistAssignmentPayload(payload)
  const activeForSlot = (runs || []).filter((run) => (
    run?.template_id === normalized.template_id
    && normalizeChecklistRunDate(run?.run_date) === normalized.run_date
    && isChecklistRunAssignmentActive(run)
    && matchesAssignmentArea(run, normalized.area)
  ))
  const exactMatch = activeForSlot.find((run) => isSameChecklistAssignee(run, payload)) || null
  const conflicts = activeForSlot.filter((run) => !isSameChecklistAssignee(run, payload))
  return { conflicts, exactMatch, activeForSlot, normalized }
}

export function formatChecklistAssigneeSummary(run, profiles = []) {
  if (!run) return "Sin asignar"
  if (run.assigned_profile_id) {
    const profile = profiles.find((item) => item.id === run.assigned_profile_id)
    return profile?.full_name || profile?.username || run.assigned_profile_id
  }
  if (run.assigned_role) return run.assigned_role
  if (run.area) return run.area
  return "Sin asignar"
}

export function parseChecklistAssignmentChangeRequest(request) {
  const snapshot = request?.items_snapshot
  if (!snapshot) return null
  const meta = Array.isArray(snapshot) ? snapshot[0] : snapshot
  if (!meta?.assignment_change) return null
  return meta
}

export function canManageChecklistAssignmentDirectly(userRole) {
  const role = String(userRole || "").trim().toLowerCase()
  return ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"].includes(role)
}

export function canForceCancelCompletedTodayRun(userRole) {
  return normalizeRole(userRole) === "admin"
}

export const CHECKLIST_TODAY_CANCEL_REASONS = [
  ["duplicate_error", "Duplicada por error"],
  ["wrong_assignee", "Responsable incorrecto"],
  ["not_applicable_today", "No aplica hoy"],
  ["created_by_error", "Creada por error"],
  ["other", "Otra razón"]
]

export function formatChecklistCancelReason(value) {
  return CHECKLIST_TODAY_CANCEL_REASONS.find(([id]) => id === value)?.[1] || value || ""
}
