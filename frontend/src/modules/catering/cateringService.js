import { supabase } from "../../lib/supabase"

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

export async function listCateringRequests({
  status = null,
  conversionStatus = null,
  assignedTo = null,
  limit = 200,
  offset = 0
} = {}) {
  const { data, error } = await supabase.rpc("get_catering_requests", {
    p_status: status || null,
    p_conversion_status: conversionStatus || null,
    p_assigned_to: assignedTo || null,
    p_limit: limit,
    p_offset: offset
  })
  return result(Array.isArray(data) ? data : [], error)
}

export async function getCateringRequestDetail(requestId) {
  const { data, error } = await supabase.rpc("get_catering_request_detail", {
    p_request_id: requestId
  })
  return result(data, error)
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
      : null
  })
  return result(data, error)
}
