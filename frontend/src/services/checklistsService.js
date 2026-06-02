import { supabase } from "../lib/supabase"

const TEMPLATE_SELECT = "*, checklist_template_items(*)"
const RUN_SELECT = "*, checklist_templates(title, description, frequency, shift_context), checklist_run_items(*)"

function orderTemplate(template) {
  return template ? {
    ...template,
    checklist_template_items: [...(template.checklist_template_items || [])].sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0))
  } : template
}

function orderRun(run) {
  return run ? {
    ...run,
    checklist_run_items: [...(run.checklist_run_items || [])].sort((a, b) => Number(a.item_order || 0) - Number(b.item_order || 0))
  } : run
}

function templatePayload(payload) {
  return {
    title: payload.title?.trim(),
    description: payload.description?.trim() || null,
    area: payload.area || null,
    assigned_role: payload.assigned_role || null,
    assigned_profile_id: payload.assigned_profile_id || null,
    frequency: payload.frequency || "manual",
    shift_context: payload.shift_context || "general",
    status: payload.status || "active"
  }
}

function itemPayload(item, index, templateId) {
  return {
    template_id: templateId,
    item_order: index,
    title: item.title?.trim(),
    description: item.description?.trim() || null,
    response_type: item.response_type || "checkbox",
    is_required: item.is_required !== false,
    requires_photo: Boolean(item.requires_photo),
    requires_comment: Boolean(item.requires_comment),
    score_points: Math.max(0, Number(item.score_points || 0))
  }
}

function requestPayload(payload, items) {
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
    items_snapshot: (items || []).map((item, index) => ({
      item_order: index,
      title: item.title?.trim(),
      description: item.description?.trim() || "",
      response_type: item.response_type || "checkbox",
      is_required: item.is_required !== false,
      requires_photo: Boolean(item.requires_photo),
      requires_comment: Boolean(item.requires_comment),
      score_points: Math.max(0, Number(item.score_points || 0))
    })).filter((item) => item.title)
  }
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

export async function updateChecklistTemplate(id, payload, items) {
  const { error } = await supabase
    .from("checklist_templates")
    .update(templatePayload(payload))
    .eq("id", id)
  if (error) return { data: null, error }

  const { error: deleteError } = await supabase
    .from("checklist_template_items")
    .delete()
    .eq("template_id", id)
  if (deleteError) return { data: null, error: deleteError }

  const itemRows = items.map((item, index) => itemPayload(item, index, id))
  const { error: itemsError } = await supabase.from("checklist_template_items").insert(itemRows)
  if (itemsError) return { data: null, error: itemsError }

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
  const { data: template, error: templateError } = await getChecklistTemplateById(templateId)
  if (templateError) return { data: null, error: templateError }

  const totalPoints = (template.checklist_template_items || []).reduce((sum, item) => sum + Number(item.score_points || 0), 0)
  const { data: run, error } = await supabase
    .from("checklist_runs")
    .insert({
      template_id: templateId,
      run_date: assignmentPayload.run_date || new Date().toISOString().slice(0, 10),
      area: assignmentPayload.area || template.area || null,
      assigned_profile_id: assignmentPayload.assigned_profile_id || template.assigned_profile_id || null,
      assigned_role: assignmentPayload.assigned_role || template.assigned_role || null,
      notes: assignmentPayload.notes?.trim() || null,
      total_points: totalPoints,
      earned_points: 0,
      status: "pending"
    })
    .select("*")
    .single()
  if (error) return { data: null, error }

  const runItems = (template.checklist_template_items || []).map((item) => ({
    run_id: run.id,
    template_item_id: item.id,
    item_order: item.item_order,
    title: item.title,
    response_type: item.response_type,
    is_required: item.is_required,
    requires_photo: item.requires_photo,
    requires_comment: item.requires_comment,
    score_points: item.score_points,
    comment: item.requires_comment ? "" : null
  }))
  if (runItems.length) {
    const { error: itemsError } = await supabase.from("checklist_run_items").insert(runItems)
    if (itemsError) return { data: null, error: itemsError }
  }

  await supabase.rpc("create_checklist_run_notifications", { p_run_id: run.id })
  window.dispatchEvent(new CustomEvent("notifications-updated"))

  const result = await getChecklistRuns({ date: assignmentPayload.run_date || run.run_date })
  return { data: result.data.find((item) => item.id === run.id) || run, error: result.error }
}

export async function updateChecklistRunItem(runItemId, payload) {
  const { data, error } = await supabase
    .from("checklist_run_items")
    .update({
      checked: Boolean(payload.checked),
      response_text: payload.response_text ?? null,
      response_number: payload.response_number === "" || payload.response_number == null ? null : Number(payload.response_number),
      photo_url: payload.photo_url || null,
      comment: payload.comment || null
    })
    .eq("id", runItemId)
    .select("*")
    .single()
  if (error) return { data: null, error }
  if (data?.run_id) await supabase.rpc("recalculate_checklist_run_points", { p_run_id: data.run_id })
  return { data, error: null }
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
    const hasValue = item.checked || item.response_text || item.response_number != null || item.photo_url
    const missingRequired = item.is_required && !hasValue
    const missingPhoto = (item.response_type === "photo" || item.requires_photo) && !item.photo_url
    const missingComment = item.requires_comment && !item.comment
    return missingRequired || missingPhoto || missingComment
  })
  if (missing.length) return { data: null, error: { message: "Completa los items obligatorios antes de finalizar." } }

  await supabase.rpc("recalculate_checklist_run_points", { p_run_id: runId })
  const { data, error } = await supabase
    .from("checklist_runs")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", runId)
    .select(RUN_SELECT)
    .single()
  if (!error) await supabase.rpc("mark_checklist_notifications_read", { p_run_id: runId })
  return { data: orderRun(data), error }
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
