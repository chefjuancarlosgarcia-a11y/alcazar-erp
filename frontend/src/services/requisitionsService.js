import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery } from "./queryCache"

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
    requestedByName: row.requested_by_name || row.requester?.full_name || row.requester?.username || "Sin informacion",
    requestedByRole: row.requested_by_role || "",
    approvedByName: row.approver?.full_name || row.approver?.username || "",
    completedByName: row.completer?.full_name || row.completer?.username || ""
  } : row
}

function serializeData(data) {
  return {
    from_area_id: data.fromAreaId,
    to_area_id: data.toAreaId,
    priority: data.priority || "normal",
    notes: data.notes || "",
    requested_by_profile_id: data.requestedByProfileId || null,
    is_test: Boolean(data.isTest ?? data.is_test)
  }
}

function serializeItems(items) {
  return items.map((item) => ({
    id: item.id,
    item_id: item.itemId || item.item_id,
    requested_quantity: Number(item.requestedQuantity ?? item.requested_quantity ?? 0),
    approved_quantity: item.approvedQuantity ?? item.approved_quantity ?? null,
    requested_unit: item.requestedUnit || item.requested_unit || item.unit || null,
    conversion_factor: item.conversionFactor ?? item.conversion_factor ?? null,
    converted_requested_quantity: item.convertedRequestedQuantity ?? item.converted_requested_quantity ?? null,
    converted_approved_quantity: item.convertedApprovedQuantity ?? item.converted_approved_quantity ?? null,
    availability_status: item.availabilityStatus || item.availability_status || null,
    stock_available_at_request: item.stockAvailableAtRequest ?? item.stock_available_at_request ?? null,
    stock_minimum_at_request: item.stockMinimumAtRequest ?? item.stock_minimum_at_request ?? null,
    conversion_warning: item.conversionWarning ?? item.conversion_warning ?? false,
    notes: item.notes || ""
  }))
}

export function getInventoryUnitConversions() {
  return cachedQuery(CACHE_KEYS.UNITS_INVENTORY, async () => {
    const { data, error } = await supabase
      .from("inventory_unit_conversions")
      .select("*")
      .order("from_unit", { ascending: true })
    return { data: data || [], error }
  }, CACHE_TTL.REFERENCE)
}

export async function getRequisitions(filters = {}) {
  let query = supabase.from("requisitions").select(requisitionSelect).order("created_at", { ascending: false })
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status)
  if (filters.fromAreaId) query = query.eq("from_area_id", filters.fromAreaId)
  if (filters.toAreaId) query = query.eq("to_area_id", filters.toAreaId)
  if (filters.priority) query = query.eq("priority", filters.priority)
  if (filters.requestedBy) query = query.eq("requested_by", filters.requestedBy)
  if (filters.date) query = query.gte("created_at", `${filters.date}T00:00:00`).lte("created_at", `${filters.date}T23:59:59.999`)
  if (filters.testFlowFilter === "real") query = query.eq("is_test", false)
  else if (filters.testFlowFilter === "test") query = query.eq("is_test", true)
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
