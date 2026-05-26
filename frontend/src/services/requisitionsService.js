import { supabase } from "../lib/supabase"

const requisitionSelect = `
  *,
  requisition_items(*),
  requester:profiles!requisitions_requested_by_fkey(id, full_name, username),
  approver:profiles!requisitions_approved_by_fkey(id, full_name, username),
  completer:profiles!requisitions_completed_by_fkey(id, full_name, username)
`

function normalizeRequisition(row) {
  return row ? {
    ...row,
    items: row.requisition_items || [],
    requestedByName: row.requester?.full_name || row.requester?.username || "Sin información",
    approvedByName: row.approver?.full_name || row.approver?.username || "",
    completedByName: row.completer?.full_name || row.completer?.username || ""
  } : row
}

function serializeData(data) {
  return {
    from_area_id: data.fromAreaId,
    to_area_id: data.toAreaId,
    priority: data.priority || "normal",
    notes: data.notes || ""
  }
}

function serializeItems(items) {
  return items.map((item) => ({
    id: item.id,
    item_id: item.itemId || item.item_id,
    requested_quantity: Number(item.requestedQuantity ?? item.requested_quantity ?? 0),
    approved_quantity: item.approvedQuantity ?? item.approved_quantity ?? null,
    notes: item.notes || ""
  }))
}

export async function getRequisitions(filters = {}) {
  let query = supabase.from("requisitions").select(requisitionSelect).order("created_at", { ascending: false })
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status)
  if (filters.fromAreaId) query = query.eq("from_area_id", filters.fromAreaId)
  if (filters.toAreaId) query = query.eq("to_area_id", filters.toAreaId)
  if (filters.priority) query = query.eq("priority", filters.priority)
  if (filters.requestedBy) query = query.eq("requested_by", filters.requestedBy)
  if (filters.date) query = query.gte("created_at", `${filters.date}T00:00:00`).lte("created_at", `${filters.date}T23:59:59.999`)
  const { data, error } = await query
  return { data: (data || []).map(normalizeRequisition), error }
}

export async function getRequisitionById(id) {
  const { data, error } = await supabase.from("requisitions").select(requisitionSelect).eq("id", id).single()
  return { data: normalizeRequisition(data), error }
}

export function getRequisitionItems(id) {
  return supabase.from("requisition_items").select("*").eq("requisition_id", id).order("created_at", { ascending: true })
}

export function createRequisition(data, items, submit = false) {
  return supabase.rpc("create_requisition", {
    p_data: serializeData(data),
    p_items: serializeItems(items),
    p_submit: submit
  })
}

export function updateRequisition(id, updates, items) {
  return supabase.rpc("update_draft_requisition", {
    p_requisition_id: id,
    p_data: serializeData(updates),
    p_items: serializeItems(items)
  })
}

export function submitRequisition(id) {
  return supabase.rpc("submit_requisition", { p_requisition_id: id })
}

export function approveRequisition(id, items) {
  return supabase.rpc("approve_requisition", {
    p_requisition_id: id,
    p_items: serializeItems(items).map((item) => ({
      id: item.id,
      approved_quantity: Number(item.approved_quantity ?? item.requested_quantity)
    }))
  })
}

export function rejectRequisition(id, reason) {
  return supabase.rpc("reject_requisition", { p_requisition_id: id, p_reason: reason })
}

export function cancelRequisition(id, reason) {
  return supabase.rpc("cancel_requisition", { p_requisition_id: id, p_reason: reason })
}

export function completeRequisition(id) {
  return supabase.rpc("complete_requisition", { p_requisition_id: id })
}
