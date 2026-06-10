import { supabase } from "../lib/supabase"

const TEMPLATE_SELECT = "*, checklist_template_items(*)"
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isPersistentItemId(id) {
  return UUID_RE.test(String(id || ""))
}

function activeTemplateItems(items) {
  return (items || []).filter((item) => item.is_active !== false)
}
const RUN_SELECT = "*, checklist_templates(title, description, frequency, shift_context), checklist_run_items(*)"
const INCIDENT_SELECT = "*, checklist_runs(run_date, area, checklist_templates(title)), checklist_run_items(title, response_type, checked, response_text, response_number, photo_url, comment), profiles!checklist_incidents_reported_by_fkey(full_name, username)"
const MANAGEMENT_ALERT_SELECT = "*, checklist_runs(run_date, area, checklist_templates(title)), sender:sender_profile_id(full_name, username)"
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
  return template ? {
    ...template,
    ...recurrence,
    checklist_template_items: activeTemplateItems(template.checklist_template_items)
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
    requires_approval: payload.requires_approval !== false
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
    reminder_time: payload.reminder_time || null,
    due_time: payload.due_time || null,
    recurrence_days: recurrence.recurrence_days,
    recurrence_month_day: payload.recurrence_month_day ? Number(payload.recurrence_month_day) : null,
    recurrence_rule: recurrence.recurrence_rule,
    skip_non_work_days: payload.skip_non_work_days !== false,
    auto_generate: Boolean(payload.auto_generate),
    requires_approval: payload.requires_approval !== false,
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
  const { data, error } = await supabase
    .from("checklist_templates")
    .select(TEMPLATE_SELECT)
    .order("created_at", { ascending: false })
  return { data: (data || []).map(orderTemplate), error }
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

  return getChecklistTemplateById(id)
}

export function deactivateChecklistTemplate(id) {
  return supabase
    .from("checklist_templates")
    .update({ status: "inactive" })
    .eq("id", id)
    .select(TEMPLATE_SELECT)
    .single()
}

export async function deleteChecklistTemplate(id) {
  const { count, error: countError } = await supabase
    .from("checklist_runs")
    .select("id", { count: "exact", head: true })
    .eq("template_id", id)
  if (countError) return { data: null, error: countError, mode: "error" }

  if (Number(count || 0) > 0) {
    const { data, error } = await deactivateChecklistTemplate(id)
    return { data: orderTemplate(data), error, mode: "archived" }
  }

  const { error } = await supabase
    .from("checklist_templates")
    .delete()
    .eq("id", id)
  return { data: { id }, error, mode: "deleted" }
}

export async function getChecklistRuns(filters = {}) {
  let query = supabase.from("checklist_runs").select(RUN_SELECT)
  if (filters.date) query = query.eq("run_date", filters.date)
  if (filters.status) query = query.eq("status", filters.status)
  if (filters.area) query = query.eq("area", filters.area)
  const { data, error } = await query.order("run_date", { ascending: false }).order("created_at", { ascending: false })
  return { data: (data || []).map(orderRun), error }
}

export async function createChecklistRunFromTemplate(templateId, assignmentPayload = {}) {
  const runDate = assignmentPayload.run_date || new Date().toISOString().slice(0, 10)
  const { data: run, error } = await supabase.rpc("create_checklist_run_from_template", {
    p_template_id: templateId,
    p_run_date: runDate,
    p_assignment_source: assignmentPayload.assignment_source || "manual",
    p_assigned_profile_id: assignmentPayload.assigned_profile_id || null,
    p_notes: assignmentPayload.notes?.trim() || null
  })
  if (error) return { data: null, error }
  if (assignmentPayload.area || assignmentPayload.assigned_role) {
    const { error: updateError } = await supabase
      .from("checklist_runs")
      .update({
        area: assignmentPayload.area || run.area || null,
        assigned_role: assignmentPayload.assigned_role || run.assigned_role || null
      })
      .eq("id", run.id)
    if (updateError) return { data: null, error: updateError }
  }
  window.dispatchEvent(new CustomEvent("notifications-updated"))

  const result = await getChecklistRuns({ date: runDate })
  return { data: result.data.find((item) => item.id === run.id) || run, error: result.error }
}

export async function generateDueChecklistRuns(date = new Date().toISOString().slice(0, 10)) {
  const result = await supabase.rpc("generate_due_checklist_runs", { p_target_date: date })
  if (!result.error) window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
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
  const today = new Date().toISOString().slice(0, 10)
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

export async function getChecklistProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, area_name, status")
    .eq("status", "active")
    .order("full_name", { ascending: true })
  return { data: data || [], error }
}
