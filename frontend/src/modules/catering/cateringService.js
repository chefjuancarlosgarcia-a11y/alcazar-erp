import { supabase } from "../../lib/supabase"
import {
  repairCateringQuote,
  repairCateringQuoteItems,
  repairCateringCompanySettings,
  repairCateringRequest
} from "./cateringTextEncoding"

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible completar la operacion de catering."
}

function result(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

export async function getCateringPipelineSummary(dateFrom = null, dateTo = null) {
  const { data, error } = await supabase.rpc("get_catering_pipeline_summary", {
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  })
  return result(data, error)
}

export async function getCateringLeadsBySource(dateFrom = null, dateTo = null) {
  const { data, error } = await supabase.rpc("get_catering_leads_by_source", {
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  })
  return result(Array.isArray(data) ? data : [], error)
}

export async function updateCateringRequest(requestId, payload = {}) {
  const { data, error } = await supabase.rpc("update_catering_request", {
    p_request_id: requestId,
    p_data: {
      customer_name: payload.customerName,
      customer_phone: payload.customerPhone || null,
      customer_email: payload.customerEmail || null,
      event_date: payload.eventDate || null,
      event_time: payload.eventTime || null,
      event_location: payload.eventLocation || null,
      event_type: payload.eventType || null,
      guest_count: payload.guestCount != null && payload.guestCount !== ""
        ? Number(payload.guestCount)
        : null,
      lead_source: payload.leadSource || null,
      products_requested: payload.productsRequested || [],
      notes: payload.notes || null,
      assigned_to: payload.assignedTo || null,
      estimated_value: payload.estimatedValue != null && payload.estimatedValue !== ""
        ? Number(payload.estimatedValue)
        : null,
      follow_up_date: payload.followUpDate || null
    }
  })
  return result(repairCateringRequest(data), error)
}

export async function createManualCateringLead(payload = {}) {
  const { data, error } = await supabase.rpc("create_catering_request", {
    p_data: {
      source: "manual",
      customer_name: payload.customerName,
      customer_phone: payload.customerPhone || null,
      customer_email: payload.customerEmail || null,
      event_date: payload.eventDate || null,
      event_time: payload.eventTime || null,
      event_location: payload.eventLocation || null,
      event_type: payload.eventType || null,
      guest_count: payload.guestCount != null && payload.guestCount !== ""
        ? Number(payload.guestCount)
        : null,
      lead_source: payload.leadSource || "other",
      products_requested: payload.productsRequested || [],
      notes: payload.notes || null,
      assigned_to: payload.assignedTo || null,
      estimated_value: payload.estimatedValue != null && payload.estimatedValue !== ""
        ? Number(payload.estimatedValue)
        : null,
      follow_up_date: payload.followUpDate || null
    }
  })
  return result(repairCateringRequest(data), error)
}

export async function listCateringRequests({
  status = null,
  conversionStatus = null,
  assignedTo = null,
  leadSource = null,
  limit = 200,
  offset = 0
} = {}) {
  const { data, error } = await supabase.rpc("get_catering_requests", {
    p_status: status || null,
    p_conversion_status: conversionStatus || null,
    p_assigned_to: assignedTo || null,
    p_lead_source: leadSource || null,
    p_limit: limit,
    p_offset: offset
  })
  return result(Array.isArray(data) ? data.map(repairCateringRequest) : [], error)
}

export async function getCateringRequestDetail(requestId) {
  const { data, error } = await supabase.rpc("get_catering_request_detail", {
    p_request_id: requestId
  })
  return result(repairCateringRequest(data), error)
}

export async function getCateringActivityLog(requestId) {
  const { data, error } = await supabase.rpc("get_catering_activity_log", {
    p_request_id: requestId
  })
  return result(Array.isArray(data) ? data : [], error)
}

export async function getCateringAssigneeRanking(dateFrom = null, dateTo = null) {
  const { data, error } = await supabase.rpc("get_catering_assignee_ranking", {
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null
  })
  return result(data, error)
}

export async function getCateringPendingFollowups() {
  const { data, error } = await supabase.rpc("get_catering_pending_followups")
  return result(data?.rows || [], error)
}

export async function syncCateringFollowupReminders() {
  const { data, error } = await supabase.rpc("sync_catering_followup_reminders")
  return result(data ?? 0, error)
}

export async function updateCateringRequestStatus(requestId, status, notes = null) {
  const { data, error } = await supabase.rpc("update_catering_request_status", {
    p_request_id: requestId,
    p_status: status,
    p_notes: notes || null
  })
  return result(data, error)
}

export async function assignCateringLead(requestId, assignedTo) {
  const { data, error } = await supabase.rpc("assign_catering_lead", {
    p_request_id: requestId,
    p_assigned_to: assignedTo
  })
  return result(data, error)
}

export async function updateCateringFollowup(requestId, payload = {}) {
  const { data, error } = await supabase.rpc("update_catering_followup", {
    p_request_id: requestId,
    p_follow_up_date: payload.followUpDate || null,
    p_notes: payload.notes || null,
    p_conversion_status: payload.conversionStatus || null,
    p_estimated_value: payload.estimatedValue != null && payload.estimatedValue !== ""
      ? Number(payload.estimatedValue)
      : null,
    p_win_probability: payload.winProbability != null && payload.winProbability !== ""
      ? Number(payload.winProbability)
      : null
  })
  return result(data, error)
}

export async function getCateringAssignableProfiles() {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, status")
    .eq("status", "active")
    .order("full_name", { ascending: true })
  if (error) return result([], error)
  const roles = new Set([
    "admin",
    "gerente_general",
    "gerente",
    "gerente_operaciones",
    "supervisor",
    "ventas"
  ])
  const rows = (data || []).filter((profile) => roles.has(String(profile.role || "").toLowerCase()))
  return result(rows, null)
}

export async function getCateringRequestQuotes(requestId) {
  const { data, error } = await supabase.rpc("get_catering_request_quotes", {
    p_request_id: requestId
  })
  return result(data, error)
}

export async function getCateringQuoteDetail(quoteId) {
  const { data, error } = await supabase.rpc("get_catering_quote_detail", {
    p_quote_id: quoteId
  })
  if (error || !data) return result(data, error)
  return result({
    ...data,
    quote: repairCateringQuote(data.quote),
    items: repairCateringQuoteItems(data.items || [])
  }, error)
}

export async function createCateringQuote(requestId, payload = {}) {
  const { data, error } = await supabase.rpc("create_catering_quote", {
    p_request_id: requestId,
    p_items: payload.items || [],
    p_discount_amount: payload.discountAmount != null ? Number(payload.discountAmount) : 0,
    p_valid_until: payload.validUntil || null,
    p_notes: payload.notes || null,
    p_terms: payload.terms || null
  })
  return result(data, error)
}

export async function updateCateringQuote(quoteId, payload = {}) {
  const { data, error } = await supabase.rpc("update_catering_quote", {
    p_quote_id: quoteId,
    p_items: payload.items || [],
    p_discount_amount: payload.discountAmount != null ? Number(payload.discountAmount) : 0,
    p_valid_until: payload.validUntil || null,
    p_notes: payload.notes || null,
    p_terms: payload.terms || null
  })
  return result(data, error)
}

export async function updateCateringQuoteStatus(quoteId, status) {
  const { data, error } = await supabase.rpc("update_catering_quote_status", {
    p_quote_id: quoteId,
    p_status: status
  })
  return result(data, error)
}

export async function listCateringQuoteTemplates(includeInactive = false) {
  const { data, error } = await supabase.rpc("list_catering_quote_templates", {
    p_include_inactive: includeInactive
  })
  return result(data?.rows || [], error)
}

export async function getCateringQuoteTemplateDetail(templateId) {
  const { data, error } = await supabase.rpc("catering_quote_template_detail", {
    p_template_id: templateId
  })
  return result(data, error)
}

export async function upsertCateringQuoteTemplate(payload = {}) {
  const { data, error } = await supabase.rpc("upsert_catering_quote_template", {
    p_template_id: payload.id || null,
    p_name: payload.name,
    p_description: payload.description || null,
    p_category: payload.category || "general",
    p_is_active: payload.isActive !== false,
    p_items: payload.items || []
  })
  return result(data, error)
}

export async function duplicateCateringQuoteTemplate(templateId) {
  const { data, error } = await supabase.rpc("duplicate_catering_quote_template", {
    p_template_id: templateId
  })
  return result(data, error)
}

export async function deleteCateringQuoteTemplate(templateId) {
  const { data, error } = await supabase.rpc("delete_catering_quote_template", {
    p_template_id: templateId
  })
  return result(data, error)
}

export async function saveCateringQuoteAsTemplate(quoteId, payload = {}) {
  const { data, error } = await supabase.rpc("save_catering_quote_as_template", {
    p_quote_id: quoteId,
    p_name: payload.name,
    p_description: payload.description || null,
    p_category: payload.category || "general"
  })
  return result(data, error)
}
