import { supabase } from "../lib/supabase"
import {
  getChecklistOperationalDate,
  getChecklistTodayDateCandidates,
  isChecklistTemplateDueOnDate,
  normalizeChecklistRunDate,
  normalizeChecklistRunStatus,
  shouldEnsureChecklistRunForOperationalDate
} from "../utils/checklistOperationalStatus"
import {
  canForceCancelCompletedTodayRun,
  canManageChecklistAssignmentDirectly
} from "../utils/checklistAssignment"
import { buildChecklistModuleAudit } from "../utils/checklistModuleAudit"

const TEMPLATE_SELECT = "*, checklist_template_items(*)"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPersistentItemId(id) {
  return UUID_RE.test(String(id || ""))
}

function activeTemplateItems(items) {
  return (items || []).filter((item) => item.is_active !== false)
}
const RUN_SELECT_CORE = "*, checklist_templates(title, description, frequency, shift_context, backup_profile_id, supervisor_profile_id), checklist_run_items(*)"
const RUN_SELECT_EXTENDED = "*, checklist_templates(title, description, frequency, shift_context, primary_replacement_profile_id, secondary_replacement_profile_id, coverage_escalation_profile_id, backup_profile_id, auto_coverage_enabled, auto_coverage_wait_minutes, supervisor_profile_id), checklist_run_items(*)"
const RUN_SELECT = RUN_SELECT_EXTENDED
const INCIDENT_SELECT = "*, checklist_runs(run_date, area, checklist_templates(title)), checklist_run_items(title, response_type, checked, response_text, response_number, photo_url, comment), profiles!checklist_incidents_reported_by_fkey(full_name, username)"
const MANAGEMENT_ALERT_SELECT = "*, checklist_runs(run_date, area, checklist_templates(title)), sender:sender_profile_id(full_name, username)"

function guatemalaDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Guatemala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date)
}
const RRULE_DAY_TO_ISO = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 }
const ISO_TO_RRULE_DAY = { 1: "MO", 2: "TU", 3: "WE", 4: "TH", 5: "FR", 6: "SA", 7: "SU" }

function normalizeRecurrenceDays(days) {
  return [...new Set((Array.isArray(days) ? days : []).map((day) => Number(day)).filter((day) => ISO_TO_RRULE_DAY[day]))].sort((a, b) => a - b)
}

function parseRecurrenceDaysFromRule(rule) {
  const match = String(rule || "").toUpperCase().match(/(?:^|;)BYDAY=([^;]+)/)
  if (!match) return []
  return normalizeRecurrenceDays(match[1].split(",").map((token) => RRULE_DAY_TO_ISO[token.trim()]))
}

function buildWeeklyRecurrenceRule(days) {
  const normalized = normalizeRecurrenceDays(days)
  if (!normalized.length) return null
  return `FREQ=WEEKLY;BYDAY=${normalized.map((day) => ISO_TO_RRULE_DAY[day]).join(",")}`
}

function normalizeRecurrenceConfig(payload = {}) {
  const trimmedRule = payload.recurrence_rule?.trim() || ""
  const daysFromRule = parseRecurrenceDaysFromRule(trimmedRule)
  const recurrence_days = daysFromRule.length ? daysFromRule : normalizeRecurrenceDays(payload.recurrence_days)
  return {
    recurrence_days,
    recurrence_rule: recurrence_days.length ? buildWeeklyRecurrenceRule(recurrence_days) : (trimmedRule || null)
  }
}

function orderTemplate(template) {
  const recurrence = normalizeRecurrenceConfig(template || {})
  const items = Array.isArray(template?.checklist_template_items)
    ? template.checklist_template_items
    : (template?.checklist_template_items?.length ? template.checklist_template_items : [])
  return template ? {
    ...template,
    ...recurrence,
    checklist_template_items: activeTemplateItems(items)
      .sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0))
  } : template
}

function orderRun(run) {
  return run ? {
    ...run,
    checklist_run_items: [...(run.checklist_run_items || [])].sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0))
  } : run
}

function templatePayload(payload) {
  const recurrence = normalizeRecurrenceConfig(payload)
  return {
    title: payload.title?.trim(),
    description: payload.description?.trim() || null,
    area: payload.area || null,
    assigned_role: payload.assigned_role || null,
    assigned_profile_id: payload.assigned_profile_id || null,
    supervisor_profile_id: payload.supervisor_profile_id || null,
    backup_profile_id: payload.backup_profile_id || null,
    primary_replacement_profile_id: payload.primary_replacement_profile_id || null,
    secondary_replacement_profile_id: payload.secondary_replacement_profile_id || null,
    coverage_escalation_profile_id: payload.coverage_escalation_profile_id || null,
    auto_coverage_enabled: Boolean(payload.auto_coverage_enabled),
    auto_coverage_wait_minutes: Math.max(0, Math.min(240, Number(payload.auto_coverage_wait_minutes || 20))),
    frequency: payload.frequency || "manual",
    shift_context: payload.shift_context || "general",
    status: payload.status || "active",
    reminder_time: payload.reminder_time || null,
    due_time: payload.due_time || null,
    recurrence_days: recurrence.recurrence_days,
    recurrence_month_day: payload.recurrence_month_day ? Number(payload.recurrence_month_day) : null,
    recurrence_rule: recurrence.recurrence_rule,
    skip_non_work_days: payload.skip_non_work_days !== false,
    auto_generate: Boolean(payload.auto_generate),
    requires_approval: false
  }
}

function itemPayload(item, index, templateId) {
  const triggersIncident = Boolean(item.triggers_incident || item.generate_incident_on_no)
  return {
    template_id: templateId,
    item_order: index,
    title: item.title?.trim(),
    description: item.description?.trim() || null,
    response_type: item.response_type || "checkbox",
    is_required: item.is_required !== false,
    requires_photo: Boolean(item.requires_photo),
    requires_comment: Boolean(item.requires_comment),
    require_comment_on_no: Boolean(item.require_comment_on_no),
    require_photo_on_no: Boolean(item.require_photo_on_no),
    generate_incident_on_no: Boolean(item.generate_incident_on_no || (triggersIncident && item.expected_response === "si")),
    expected_response: item.expected_response?.trim() || null,
    triggers_incident: triggersIncident,
    incident_severity: item.incident_severity || "medium",
    notify_roles: Array.isArray(item.notify_roles) && item.notify_roles.length ? item.notify_roles : ["admin", "gerente_general", "gerente"],
    create_task_on_fail: Boolean(item.create_task_on_fail),
    options: parseOptions(item.options),
    rule_config: { ...(item.rule_config || {}), section: item.section || item.rule_config?.section || "" },
    score_points: Math.max(0, Number(item.score_points || 0)),
    is_active: true
  }
}

function requestPayload(payload, items) {
  const recurrence = normalizeRecurrenceConfig(payload)
  return {
    template_id: payload.template_id || null,
    request_type: payload.request_type || (payload.template_id ? "update" : "create"),
    status: "draft",
    title: payload.title?.trim(),
    description: payload.description?.trim() || null,
    area: payload.area || null,
    assigned_role: payload.assigned_role || null,
    assigned_profile_id: payload.assigned_profile_id || null,
    frequency: payload.frequency || "manual",
    shift_context: payload.shift_context || "general",
    status_after_approval: payload.status_after_approval || payload.status || "active",
    supervisor_profile_id: payload.supervisor_profile_id || null,
    backup_profile_id: payload.backup_profile_id || null,
    primary_replacement_profile_id: payload.primary_replacement_profile_id || null,
    secondary_replacement_profile_id: payload.secondary_replacement_profile_id || null,
    coverage_escalation_profile_id: payload.coverage_escalation_profile_id || null,
    auto_coverage_enabled: Boolean(payload.auto_coverage_enabled),
    auto_coverage_wait_minutes: Math.max(0, Math.min(240, Number(payload.auto_coverage_wait_minutes || 20))),
    reminder_time: payload.reminder_time || null,
    due_time: payload.due_time || null,
    recurrence_days: recurrence.recurrence_days,
    recurrence_month_day: payload.recurrence_month_day ? Number(payload.recurrence_month_day) : null,
    recurrence_rule: recurrence.recurrence_rule,
    skip_non_work_days: payload.skip_non_work_days !== false,
    auto_generate: Boolean(payload.auto_generate),
    requires_approval: false,
    items_snapshot: (items || []).map((item, index) => ({
      item_order: index,
      title: item.title?.trim(),
      description: item.description?.trim() || "",
      response_type: item.response_type || "checkbox",
      is_required: item.is_required !== false,
      requires_photo: Boolean(item.requires_photo),
      requires_comment: Boolean(item.requires_comment),
      require_comment_on_no: Boolean(item.require_comment_on_no),
      require_photo_on_no: Boolean(item.require_photo_on_no),
      generate_incident_on_no: Boolean(item.generate_incident_on_no || item.triggers_incident),
      expected_response: item.expected_response?.trim() || null,
      triggers_incident: Boolean(item.triggers_incident || item.generate_incident_on_no),
      incident_severity: item.incident_severity || "medium",
      notify_roles: Array.isArray(item.notify_roles) && item.notify_roles.length ? item.notify_roles : ["admin", "gerente_general", "gerente"],
      create_task_on_fail: Boolean(item.create_task_on_fail),
      options: parseOptions(item.options),
      rule_config: { ...(item.rule_config || {}), section: item.section || item.rule_config?.section || "" },
      score_points: Math.max(0, Number(item.score_points || 0))
    })).filter((item) => item.title)
  }
}

function parseOptions(options) {
  if (Array.isArray(options)) return options.map((item) => String(item).trim()).filter(Boolean)
  return String(options || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export async function createChecklistChangeRequest(payload, items) {
  const { data, error } = await supabase
    .from("checklist_template_change_requests")
    .insert(requestPayload(payload, items))
    .select("*")
    .single()
  return { data, error }
}

export async function updateChecklistChangeRequest(id, payload, items) {
  const { data, error } = await supabase
    .from("checklist_template_change_requests")
    .update(requestPayload(payload, items))
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function submitChecklistChangeRequest(id) {
  const result = await supabase.rpc("submit_checklist_change_request", { p_request_id: id })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function getChecklistChangeRequests(filters = {}) {
  let query = supabase
    .from("checklist_template_change_requests")
    .select("*")
    .order("created_at", { ascending: false })
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.templateId) query = query.eq("template_id", filters.templateId)
  const { data, error } = await query
  return { data: data || [], error }
}

export async function getChecklistTemplateSuggestions(filters = {}) {
  let query = supabase
    .from("checklist_template_suggestions")
    .select("*, checklist_templates(title, area)")
    .order("created_at", { ascending: false })
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.templateId) query = query.eq("template_id", filters.templateId)
  const { data, error } = await query
  return { data: data || [], error }
}

export async function createChecklistTemplateSuggestion(payload) {
  const { data, error } = await supabase
    .from("checklist_template_suggestions")
    .insert({
      template_id: payload.template_id,
      area: payload.area || null,
      change_type: payload.change_type,
      description: payload.description?.trim(),
      justification: payload.justification?.trim(),
      priority: payload.priority || "medium",
      evidence_url: payload.evidence_url || null,
      status: "pending"
    })
    .select("*")
    .single()
  return { data, error }
}

export async function updateChecklistTemplateSuggestionStatus(id, status, reviewNotes = "") {
  const { data, error } = await supabase
    .from("checklist_template_suggestions")
    .update({
      status,
      review_notes: reviewNotes?.trim() || null,
      reviewed_at: new Date().toISOString()
    })
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function approveChecklistChangeRequest(id, reviewNotes = "") {
  const result = await supabase.rpc("approve_checklist_change_request", {
    p_request_id: id,
    p_review_notes: reviewNotes || null
  })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function rejectChecklistChangeRequest(id, reviewNotes) {
  const result = await supabase.rpc("reject_checklist_change_request", {
    p_request_id: id,
    p_review_notes: reviewNotes
  })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function getChecklistTemplates() {
  const { data, error } = await supabase.rpc("get_checklist_templates_library")
  if (error) {
    const fallback = await supabase
      .from("checklist_templates")
      .select("*, creator:profiles!checklist_templates_created_by_fkey(full_name, username), checklist_template_items(*)")
      .order("created_at", { ascending: false })
    return {
      data: (fallback.data || []).map((template) => orderTemplate({
        ...template,
        creator_name: template.creator?.full_name || template.creator?.username || null
      })),
      error: fallback.error
    }
  }
  return {
    data: (data || []).map((template) => orderTemplate({
      ...template,
      checklist_template_items: template.checklist_template_items || []
    })),
    error: null
  }
}

export async function getChecklistTemplateById(id) {
  const { data, error } = await supabase
    .from("checklist_templates")
    .select(TEMPLATE_SELECT)
    .eq("id", id)
    .single()
  return { data: orderTemplate(data), error }
}

export async function createChecklistTemplate(payload, items) {
  const { data: template, error } = await supabase
    .from("checklist_templates")
    .insert(templatePayload(payload))
    .select("*")
    .single()
  if (error) return { data: null, error }

  const itemRows = items.map((item, index) => itemPayload(item, index, template.id))
  const { error: itemsError } = await supabase.from("checklist_template_items").insert(itemRows)
  if (itemsError) return { data: null, error: itemsError }

  return getChecklistTemplateById(template.id)
}

export async function checkTemplateHasRuns(templateId) {
  if (!templateId) return { hasRuns: false, error: null }
  const { count, error } = await supabase
    .from("checklist_runs")
    .select("id", { count: "exact", head: true })
    .eq("template_id", templateId)
  return { hasRuns: Number(count || 0) > 0, error }
}

export async function syncChecklistRunsFromTemplate(templateId) {
  if (!templateId) return { data: { synced_runs: 0 }, error: null }
  return supabase.rpc("sync_checklist_runs_from_template", { p_template_id: templateId })
}

export async function updateChecklistTemplate(id, payload, items) {
  const { error } = await supabase
    .from("checklist_templates")
    .update(templatePayload(payload))
    .eq("id", id)
  if (error) return { data: null, error }

  const { data: existingItems, error: fetchError } = await supabase
    .from("checklist_template_items")
    .select("id")
    .eq("template_id", id)
    .eq("is_active", true)
  if (fetchError) return { data: null, error: fetchError }

  const submittedIds = new Set(
    items.map((item) => item.id).filter((itemId) => isPersistentItemId(itemId))
  )
  const toDeactivate = (existingItems || [])
    .filter((row) => !submittedIds.has(row.id))
    .map((row) => row.id)

  if (toDeactivate.length) {
    const { error: deactivateError } = await supabase
      .from("checklist_template_items")
      .update({ is_active: false })
      .in("id", toDeactivate)
    if (deactivateError) return { data: null, error: deactivateError }
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const row = itemPayload(item, index, id)

    if (isPersistentItemId(item.id)) {
      const { error: updateError } = await supabase
        .from("checklist_template_items")
        .update(row)
        .eq("id", item.id)
        .eq("template_id", id)
      if (updateError) return { data: null, error: updateError }
    } else {
      const { error: insertError } = await supabase
        .from("checklist_template_items")
        .insert(row)
      if (insertError) return { data: null, error: insertError }
    }
  }

  const templateResult = await getChecklistTemplateById(id)
  if (templateResult.error) return templateResult

  const syncResult = await syncChecklistRunsFromTemplate(id)
  if (syncResult.error) {
    console.error("sync_checklist_runs_from_template", syncResult.error)
    return {
      data: templateResult.data,
      error: null,
      syncWarning: `La plantilla se guardo, pero no se pudieron actualizar las checklists en Hoy: ${syncResult.error.message || "error de sincronizacion"}. Verifica que la migracion 068 este aplicada en Supabase.`
    }
  }

  return {
    data: templateResult.data,
    error: null,
    syncedRuns: Number(syncResult.data?.synced_runs || 0),
    reopenedRuns: Number(syncResult.data?.reopened_runs || 0)
  }
}

export function deactivateChecklistTemplate(id) {
  return supabase
    .from("checklist_templates")
    .update({ status: "inactive" })
    .eq("id", id)
    .select(TEMPLATE_SELECT)
    .single()
}

export function reactivateChecklistTemplate(id) {
  return supabase
    .from("checklist_templates")
    .update({ status: "active" })
    .eq("id", id)
    .select(TEMPLATE_SELECT)
    .single()
}

export async function notifyOverdueChecklistRuns() {
  const result = await supabase.rpc("notify_overdue_checklist_runs")
  if (!result.error && Number(result.data?.notified_count || 0) > 0) {
    window.dispatchEvent(new CustomEvent("notifications-updated"))
  }
  return result
}

export async function deleteChecklistTemplate(id, { force = false } = {}) {
  if (force) {
    const result = await supabase.rpc("force_delete_checklist_template", { p_template_id: id })
    if (result.error) return { data: null, error: result.error, mode: "error" }
    return { data: result.data || { id }, error: null, mode: "deleted" }
  }

  const { count, error: countError } = await supabase
    .from("checklist_runs")
    .select("id", { count: "exact", head: true })
    .eq("template_id", id)
  if (countError) return { data: null, error: countError, mode: "error" }

  if (Number(count || 0) > 0) {
    const { data, error } = await deactivateChecklistTemplate(id)
    return { data: orderTemplate(data), error, mode: "archived" }
  }

  const forceResult = await supabase.rpc("force_delete_checklist_template", { p_template_id: id })
  if (!forceResult.error) {
    return { data: forceResult.data || { id }, error: null, mode: "deleted" }
  }

  const { error } = await supabase
    .from("checklist_templates")
    .delete()
    .eq("id", id)
  return { data: { id }, error, mode: "deleted" }
}

function buildChecklistRunsQuery(select, filters = {}) {
  let query = supabase.from("checklist_runs").select(select)
  if (filters.date) query = query.eq("run_date", filters.date)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.area) query = query.eq("area", filters.area)
  if (filters.sinceDate) query = query.gte("run_date", filters.sinceDate)
  return query.order("run_date", { ascending: false }).order("created_at", { ascending: false })
}

export async function getChecklistRuns(filters = {}) {
  const extended = await buildChecklistRunsQuery(RUN_SELECT_EXTENDED, filters)
  if (!extended.error) {
    return { data: (extended.data || []).map(orderRun), error: null, selectMode: "extended" }
  }

  console.warn("getChecklistRuns extended select failed, retrying core select:", extended.error.message)
  const core = await buildChecklistRunsQuery(RUN_SELECT_CORE, filters)
  return {
    data: (core.data || []).map(orderRun),
    error: core.error,
    selectMode: core.error ? "failed" : "core"
  }
}

function mergeChecklistRunsById(...groups) {
  const merged = new Map()
  groups.flat().forEach((run) => {
    if (run?.id) merged.set(run.id, run)
  })
  return Array.from(merged.values())
}

export async function loadModuleChecklistRuns() {
  const todayDates = getChecklistTodayDateCandidates()
  const operationalToday = getChecklistOperationalDate()
  const sinceDate = (() => {
    const [year, month, day] = todayDates[0].split("-").map(Number)
    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() - 45)
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
  })()

  const [recentResult, ...todayResults] = await Promise.all([
    getChecklistRuns({ sinceDate }),
    ...todayDates.map((date) => getChecklistRuns({ date }))
  ])

  const errors = [recentResult, ...todayResults].map((result) => result.error).filter(Boolean)
  const diagnostics = {
    operationalToday,
    todayDateCandidates: todayDates,
    sinceDate,
    queries: [
      {
        type: "sinceDate",
        filter: sinceDate,
        count: recentResult.error ? 0 : (recentResult.data?.length || 0),
        error: recentResult.error?.message || null,
        selectMode: recentResult.selectMode || null
      },
      ...todayDates.map((date, index) => {
        const result = todayResults[index]
        return {
          type: "date",
          filter: date,
          count: result.error ? 0 : (result.data?.length || 0),
          error: result.error?.message || null,
          selectMode: result.selectMode || null
        }
      })
    ]
  }

  if (errors.length === todayResults.length + 1) {
    return { data: [], error: errors[0], diagnostics }
  }

  const merged = mergeChecklistRunsById(
    ...(recentResult.error ? [] : [recentResult.data || []]),
    ...todayResults.filter((result) => !result.error).map((result) => result.data || [])
  )
  diagnostics.mergedCount = merged.length
  diagnostics.operationalDateCount = merged.filter((run) => (
    normalizeChecklistRunDate(run.run_date) === operationalToday
  )).length
  diagnostics.pendingOperationalCount = merged.filter((run) => (
    normalizeChecklistRunDate(run.run_date) === operationalToday && run.status === "pending"
  )).length

  return {
    data: merged,
    error: null,
    diagnostics
  }
}

export async function createChecklistRunFromTemplate(templateId, assignmentPayload = {}, options = {}) {
  const runDate = assignmentPayload.run_date || getChecklistOperationalDate()
  const assignedProfileId = assignmentPayload.assigned_profile_id || null
  const assignedRole = assignmentPayload.assigned_role?.trim() || null
  const area = assignmentPayload.area?.trim() || null
  let existingQuery = supabase
    .from("checklist_runs")
    .select("id")
    .eq("template_id", templateId)
    .eq("run_date", runDate)
    .neq("status", "cancelled")
    .limit(1)
  existingQuery = assignedProfileId
    ? existingQuery.eq("assigned_profile_id", assignedProfileId)
    : existingQuery.is("assigned_profile_id", null)
  existingQuery = assignedRole
    ? existingQuery.eq("assigned_role", assignedRole)
    : existingQuery.is("assigned_role", null)
  existingQuery = area
    ? existingQuery.eq("area", area)
    : existingQuery.is("area", null)
  const { data: existingRuns, error: existingError } = await existingQuery
  if (existingError) return { data: null, error: existingError }

  const { data: run, error } = await supabase.rpc("create_checklist_run_from_template", {
    p_template_id: templateId,
    p_run_date: runDate,
    p_assignment_source: assignmentPayload.assignment_source || "manual",
    p_assigned_profile_id: assignedProfileId,
    p_notes: assignmentPayload.notes?.trim() || null,
    p_area: area,
    p_assigned_role: assignedRole
  })
  if (error) return { data: null, error }
  const existedAlready = Boolean(existingRuns?.some((item) => item.id === run.id))
  if (assignmentPayload.due_time) {
    const { error: updateError } = await supabase
      .from("checklist_runs")
      .update({
        due_time: assignmentPayload.due_time || run.due_time || null
      })
      .eq("id", run.id)
    if (updateError) return { data: null, error: updateError }
  }
  if (!options.skipReload) {
    window.dispatchEvent(new CustomEvent("notifications-updated"))
    const result = await getChecklistRuns({ date: runDate })
    return { data: { ...(result.data.find((item) => item.id === run.id) || run), existedAlready }, error: result.error }
  }
  return { data: { ...run, existedAlready }, error: null }
}

export async function cancelChecklistRun(runId) {
  const { data, error } = await supabase
    .from("checklist_runs")
    .update({ status: "cancelled" })
    .eq("id", runId)
    .select("id, status, template_id, run_date, assigned_profile_id, assigned_role, area")
    .single()
  return { data, error }
}

export async function cancelTodayChecklistRunByAdmin({
  runId,
  cancelReason,
  userRole,
  forceCompletedCancel = false,
  run = null,
  actorProfileId = null
}) {
  if (!canManageChecklistAssignmentDirectly(userRole)) {
    return { data: null, error: { message: "No tienes permiso para cancelar checklists de hoy." } }
  }

  const reason = String(cancelReason || "").trim()
  if (!reason) {
    return { data: null, error: { message: "El motivo de cancelación es obligatorio." } }
  }

  const previousStatus = normalizeChecklistRunStatus(run?.status)
  if (previousStatus === "completed" && !canForceCancelCompletedTodayRun(userRole)) {
    return { data: null, error: { message: "No se puede cancelar una checklist completada." } }
  }
  if (previousStatus === "completed" && !forceCompletedCancel) {
    return { data: null, error: { message: "CONFIRM_COMPLETED_CANCEL", code: "CONFIRM_COMPLETED_CANCEL" } }
  }

  const rpcResult = await supabase.rpc("cancel_checklist_run_for_today", {
    p_run_id: runId,
    p_cancel_reason: reason,
    p_force_completed: Boolean(forceCompletedCancel)
  })

  if (!rpcResult.error) {
    return { data: orderRun(rpcResult.data), error: null }
  }

  if (rpcResult.error.code !== "PGRST202" && !/function.*does not exist/i.test(rpcResult.error.message || "")) {
    return { data: null, error: rpcResult.error }
  }

  const updatePayload = {
    status: "cancelled",
    cancelled_by: actorProfileId || null,
    cancelled_at: new Date().toISOString(),
    cancel_reason: reason
  }
  const { data, error } = await supabase
    .from("checklist_runs")
    .update(updatePayload)
    .eq("id", runId)
    .select("*, checklist_templates(title, description, frequency, shift_context, backup_profile_id), checklist_run_items(*)")
    .single()

  if (error) return { data: null, error }

  await logChecklistSessionAudit({
    profileId: actorProfileId,
    runId,
    eventType: "today_run_cancelled_by_admin",
    details: {
      run_id: runId,
      template_id: data?.template_id || run?.template_id || null,
      template_name: data?.checklist_templates?.title || run?.checklist_templates?.title || "",
      cancelled_by: actorProfileId || null,
      previous_status: previousStatus || run?.status || null,
      cancel_reason: reason,
      timestamp: new Date().toISOString(),
      fallback_update: true
    }
  })

  return { data: orderRun(data), error: null }
}

export async function getChecklistRunSessionAudit(runId) {
  const rpcResult = await supabase.rpc("get_checklist_run_session_audit", { p_run_id: runId })
  if (!rpcResult.error) {
    return { data: rpcResult.data || [], error: null }
  }

  const { data, error } = await supabase
    .from("checklist_session_audit")
    .select("id, profile_id, checklist_run_id, event_type, details, created_at")
    .eq("checklist_run_id", runId)
    .order("created_at", { ascending: false })

  return { data: data || [], error }
}

export async function reassignTodayChecklistRun({
  run,
  assignmentPayload,
  reason = "",
  requestedByProfileId = null
}) {
  if (!run?.id || !run?.template_id) {
    return { data: null, error: { message: "Corrida invalida para reasignar." } }
  }
  const payload = {
    template_id: run.template_id,
    run_date: normalizeChecklistRunDate(run.run_date),
    area: assignmentPayload.area ?? run.area ?? "",
    assigned_role: assignmentPayload.assigned_role ?? run.assigned_role ?? "",
    assigned_profile_id: assignmentPayload.assigned_profile_id ?? run.assigned_profile_id ?? "",
    due_time: assignmentPayload.due_time ?? run.due_time ?? "",
    notes: assignmentPayload.notes ?? ""
  }
  return executeChecklistAssignmentResolution({
    payload,
    conflictingRuns: [run],
    mode: "replace",
    reason,
    requestedByProfileId
  })
}

export async function executeChecklistAssignmentResolution({
  payload,
  conflictingRuns = [],
  mode = "replace",
  reason = "",
  requestedByProfileId = null,
  approvedByProfileId = null
}) {
  const actorId = approvedByProfileId || requestedByProfileId
  const auditBase = {
    reason: reason || null,
    requested_by: requestedByProfileId || null,
    approved_by: approvedByProfileId || null,
    mode
  }

  if (mode === "replace") {
    for (const run of conflictingRuns) {
      const cancelResult = await cancelChecklistRun(run.id)
      if (cancelResult.error) return { data: null, error: cancelResult.error }
      await logChecklistSessionAudit({
        profileId: actorId,
        runId: run.id,
        eventType: "assignment_replaced_cancelled",
        details: {
          ...auditBase,
          previous_assigned_profile_id: run.assigned_profile_id || null,
          previous_assigned_role: run.assigned_role || null,
          previous_area: run.area || null,
          new_assigned_profile_id: payload.assigned_profile_id || null,
          new_assigned_role: payload.assigned_role || null,
          new_area: payload.area || null
        }
      })
    }
  }

  const createResult = await createChecklistRunFromTemplate(payload.template_id, {
    ...payload,
    assignment_source: mode === "additional" ? "manual_additional" : "reassignment"
  })
  if (createResult.error) return createResult

  await logChecklistSessionAudit({
    profileId: actorId,
    runId: createResult.data?.id || null,
    eventType: mode === "additional" ? "assignment_additional_created" : "assignment_replacement_created",
    details: {
      ...auditBase,
      conflicting_run_ids: conflictingRuns.map((run) => run.id),
      assigned_profile_id: payload.assigned_profile_id || null,
      assigned_role: payload.assigned_role || null,
      area: payload.area || null,
      run_date: payload.run_date || null
    }
  })

  return createResult
}

export async function submitChecklistAssignmentChangeRequest({
  payload,
  conflictingRuns = [],
  reason = "",
  templateTitle = "",
  submittedByProfileId = null
}) {
  const snapshot = [{
    assignment_change: true,
    action: "replace",
    run_date: payload.run_date,
    conflicting_run_ids: conflictingRuns.map((run) => run.id),
    previous_assignments: conflictingRuns.map((run) => ({
      run_id: run.id,
      assigned_profile_id: run.assigned_profile_id || null,
      assigned_role: run.assigned_role || null,
      area: run.area || null
    })),
    new_assignment: payload,
    reason
  }]

  const { data, error } = await supabase
    .from("checklist_template_change_requests")
    .insert({
      template_id: payload.template_id,
      request_type: "update",
      status: "draft",
      title: `Cambio de responsable: ${templateTitle || "Checklist"}`,
      description: reason,
      area: payload.area || null,
      assigned_role: payload.assigned_role || null,
      assigned_profile_id: payload.assigned_profile_id || null,
      frequency: "manual",
      shift_context: "general",
      status_after_approval: "active",
      items_snapshot: snapshot
    })
    .select("*")
    .single()
  if (error) return { data: null, error }

  const submitResult = await submitChecklistChangeRequest(data.id)
  if (submitResult.error) return { data: null, error: submitResult.error }

  await logChecklistSessionAudit({
    profileId: submittedByProfileId,
    runId: null,
    eventType: "assignment_change_requested",
    details: {
      request_id: data.id,
      reason,
      conflicting_run_ids: conflictingRuns.map((run) => run.id),
      new_assignment: payload,
      previous_assignments: snapshot[0].previous_assignments
    }
  })

  return { data, error: null }
}

export async function approveChecklistAssignmentChangeRequest(request, {
  reviewNotes = "",
  approvedByProfileId = null,
  runs = []
} = {}) {
  const meta = Array.isArray(request?.items_snapshot) ? request.items_snapshot[0] : request?.items_snapshot
  if (!meta?.assignment_change) {
    return { data: null, error: { message: "La solicitud no es un cambio de responsable." } }
  }

  const payload = meta.new_assignment
  let conflictingRuns = (meta.conflicting_run_ids || [])
    .map((runId) => (runs || []).find((run) => run.id === runId))
    .filter(Boolean)

  if (!conflictingRuns.length && meta.conflicting_run_ids?.length) {
    const runDate = payload?.run_date || meta.run_date
    const fetched = await getChecklistRuns({ date: runDate })
    if (!fetched.error) {
      conflictingRuns = meta.conflicting_run_ids
        .map((runId) => (fetched.data || []).find((run) => run.id === runId))
        .filter(Boolean)
    }
  }

  const resolution = await executeChecklistAssignmentResolution({
    payload,
    conflictingRuns,
    mode: meta.action || "replace",
    reason: meta.reason || reviewNotes,
    requestedByProfileId: request.submitted_by || null,
    approvedByProfileId
  })
  if (resolution.error) return resolution

  const { error } = await supabase
    .from("checklist_template_change_requests")
    .update({
      status: "approved",
      reviewed_by: approvedByProfileId || null,
      reviewed_at: new Date().toISOString(),
      review_notes: reviewNotes?.trim() || null
    })
    .eq("id", request.id)
  if (error) return { data: null, error }

  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return resolution
}

export async function generateDueChecklistRuns(date = getChecklistOperationalDate()) {
  const result = await supabase.rpc("generate_due_checklist_runs", { p_target_date: date })
  if (!result.error) window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function ensureDueChecklistRunsFromTemplates(templates = [], date = getChecklistOperationalDate(), existingRuns = []) {
  const activeTemplates = (templates || []).filter((template) => template?.status === "active")
  let created = 0
  let ensured = 0
  let skipped = 0
  let attempted = 0
  let lastError = null

  const hasNonCancelledRunForDate = (templateId, targetDate) => (existingRuns || []).some((run) => (
    run?.template_id === templateId
    && run?.status !== "cancelled"
    && normalizeChecklistRunDate(run.run_date) === normalizeChecklistRunDate(targetDate)
  ))

  for (const template of activeTemplates) {
    if (hasNonCancelledRunForDate(template.id, date)) {
      skipped += 1
      continue
    }
    if (!shouldEnsureChecklistRunForOperationalDate(template, date, existingRuns)) {
      skipped += 1
      continue
    }
    attempted += 1
    const result = await createChecklistRunFromTemplate(template.id, {
      run_date: date,
      assignment_source: "recurrence",
      notes: "Generada automaticamente",
      area: template.area || null,
      assigned_role: template.assigned_role || null,
      assigned_profile_id: template.assigned_profile_id || null
    }, { skipReload: true })
    if (result.error) {
      lastError = result.error
      continue
    }
    if (result.data?.existedAlready) ensured += 1
    else created += 1
  }

  if (created > 0 || ensured > 0) window.dispatchEvent(new CustomEvent("notifications-updated"))
  return { created, ensured, skipped, attempted, error: lastError }
}

export function auditLoadedChecklistModule({ runs = [], templates = [], fallback = null } = {}) {
  return buildChecklistModuleAudit({ runs, templates, fallback })
}

export async function updateChecklistRunItem(runItemId, payload) {
  const { data, error } = await supabase
    .from("checklist_run_items")
    .update({
      checked: Boolean(payload.checked),
      response_text: payload.response_text ?? null,
      response_number: payload.response_number === "" || payload.response_number == null ? null : Number(payload.response_number),
      response_date: payload.response_date || null,
      response_time: payload.response_time || null,
      response_json: payload.response_json || {},
      photo_url: payload.photo_url || null,
      comment: payload.comment || null
    })
    .eq("id", runItemId)
    .select("*")
    .single()
  if (error) return { data: null, error }
  return { data, error: null }
}

export async function getChecklistIncidents(filters = {}) {
  let query = supabase.from("checklist_incidents").select(INCIDENT_SELECT)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.severity) query = query.eq("severity", filters.severity)
  const { data, error } = await query.order("created_at", { ascending: false })
  return { data: data || [], error }
}

export async function updateChecklistIncidentStatus(id, status, resolutionNotes = "") {
  const result = await supabase.rpc("update_checklist_incident_status", {
    p_incident_id: id,
    p_status: status,
    p_resolution_notes: resolutionNotes || null
  })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function createChecklistManagementAlert(runId, priority, message) {
  const result = await supabase.rpc("create_checklist_management_alert", {
    p_checklist_run_id: runId,
    p_priority: priority,
    p_message: message
  })
  if (!result.error) {
    window.dispatchEvent(new CustomEvent("notifications-updated"))
  }
  return result
}

export async function getChecklistManagementAlerts(filters = {}) {
  let query = supabase.from("checklist_management_alerts").select(MANAGEMENT_ALERT_SELECT)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.priority) query = query.eq("priority", filters.priority)
  const { data, error } = await query.order("created_at", { ascending: false })
  return { data: data || [], error }
}

export async function updateChecklistManagementAlertStatus(id, status, resolutionNotes = "") {
  const result = await supabase.rpc("update_checklist_management_alert_status", {
    p_alert_id: id,
    p_status: status,
    p_resolution_notes: resolutionNotes || null
  })
  return result
}

export async function startChecklistRun(runId) {
  const { data, error } = await supabase
    .from("checklist_runs")
    .update({ status: "in_progress", started_at: new Date().toISOString() })
    .eq("id", runId)
    .select(RUN_SELECT)
    .single()
  return { data: orderRun(data), error }
}

export async function completeChecklistRun(runId) {
  const { data: run, error: runError } = await supabase
    .from("checklist_runs")
    .select(RUN_SELECT)
    .eq("id", runId)
    .single()
  if (runError) return { data: null, error: runError }

  const missing = (run.checklist_run_items || []).filter((item) => {
    const jsonValue = item.response_json && Object.keys(item.response_json).length > 0
    const answeredNo = String(item.response_text || "").toLowerCase() === "no"
    const hasValue = item.checked || item.response_text || item.response_number != null || item.response_date || item.response_time || item.photo_url || jsonValue
    const missingRequired = item.is_required && !hasValue
    const missingPhoto = (item.response_type === "photo" || item.requires_photo || (item.require_photo_on_no && answeredNo)) && !item.photo_url
    const missingComment = (item.requires_comment || (item.require_comment_on_no && answeredNo)) && !item.comment
    return missingRequired || missingPhoto || missingComment
  })
  if (missing.length) return { data: null, error: { message: "Completa los items obligatorios antes de finalizar." } }

  const submitResult = await supabase.rpc("submit_checklist_run_for_review", { p_run_id: runId })
  if (submitResult.error) return { data: null, error: submitResult.error }
  const { data, error } = await supabase.from("checklist_runs").select(RUN_SELECT).eq("id", runId).single()
  if (!error) await supabase.rpc("mark_checklist_notifications_read", { p_run_id: runId })
  return { data: orderRun(data), error }
}

export async function approveChecklistRun(runId, reviewNotes = "") {
  const result = await supabase.rpc("approve_checklist_run", {
    p_run_id: runId,
    p_review_notes: reviewNotes || null
  })
  return result
}

export async function rejectChecklistRun(runId, reviewNotes) {
  return supabase.rpc("reject_checklist_run", {
    p_run_id: runId,
    p_review_notes: reviewNotes
  })
}

export async function getChecklistDashboardStats() {
  const today = guatemalaDateString()
  const { data, error } = await getChecklistRuns({ date: today })
  if (error) return { data: null, error }
  const runs = data || []
  const completed = runs.filter((run) => run.status === "completed").length
  const pending = runs.filter((run) => ["pending", "in_progress"].includes(run.status)).length
  const overdue = runs.filter((run) => run.status === "overdue").length
  return {
    data: {
      pending,
      completed,
      overdue,
      compliance: runs.length ? Math.round((completed / runs.length) * 100) : 0
    },
    error: null
  }
}

export async function logChecklistSessionAudit({
  profileId,
  runId = null,
  eventType,
  details = {}
}) {
  const payload = {
    profile_id: profileId || null,
    checklist_run_id: runId || null,
    event_type: eventType,
    details
  }
  const { error } = await supabase.from("checklist_session_audit").insert(payload)
  return { error }
}

export async function getChecklistProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, area_name, status, supervisor_profile_id")
    .eq("status", "active")
    .order("full_name", { ascending: true })
  return { data: data || [], error }
}

export async function assignChecklistRunReplacement(runId, replacementProfileId, reason, notes = "") {
  const result = await supabase.rpc("assign_checklist_run_replacement", {
    p_run_id: runId,
    p_replacement_profile_id: replacementProfileId,
    p_reason: reason,
    p_notes: notes?.trim() || null
  })
  if (!result.error) window.dispatchEvent(new CustomEvent("notifications-updated"))
  return { data: orderRun(result.data), error: result.error }
}

export async function processChecklistCoverage() {
  const result = await supabase.rpc("process_checklist_coverage")
  if (!result.error) window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function getChecklistCoverageForRuns(runIds = []) {
  const ids = [...new Set((runIds || []).filter(Boolean))]
  if (!ids.length) return { data: [], error: null }
  const result = await supabase.rpc("get_checklist_coverage_for_runs", { p_run_ids: ids })
  return { data: result.data || [], error: result.error }
}

export async function getChecklistRunCoverageContext(runId) {
  const result = await supabase.rpc("get_checklist_run_coverage_context", { p_run_id: runId })
  return { data: result.data, error: result.error }
}
