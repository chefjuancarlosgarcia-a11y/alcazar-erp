import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery } from "./queryCache"
import { mapRequisitionError } from "../utils/requisitionErrorUtils"

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
  return rpcMutation(supabase.rpc("create_requisition", {
    p_data: serializeData(data),
    p_items: serializeItems(items),
    p_submit: submit
  }))
}

export function updateRequisition(id, updates, items) {
  return rpcMutation(supabase.rpc("update_draft_requisition", {
    p_requisition_id: id,
    p_data: serializeData(updates),
    p_items: serializeItems(items)
  }))
}

export function submitRequisition(id) {
  return rpcMutation(supabase.rpc("submit_requisition", { p_requisition_id: id }))
}

function serializeApprovalItems(items) {
  return items.map((item) => ({
    id: item.id,
    approved_quantity: item.approvedQuantity !== undefined && item.approvedQuantity !== ""
      ? Number(item.approvedQuantity)
      : Number(item.approved_quantity ?? item.requested_quantity),
    shortage_reason: item.shortageReason || item.shortage_reason || null,
    shortage_notes: item.shortageNotes || item.shortage_notes || null
  }))
}

function serializeFulfillmentItems(items) {
  return items.map((item) => ({
    id: item.id,
    delivered_quantity: item.deliveredQuantity !== undefined && item.deliveredQuantity !== ""
      ? Number(item.deliveredQuantity)
      : Number(
        item.delivered_quantity
        ?? item.approved_quantity
        ?? item.approvedQuantity
        ?? item.requested_quantity
      ),
    shortage_reason: item.shortageReason || item.shortage_reason || null,
    shortage_notes: item.shortageNotes || item.shortage_notes || null
  }))
}

async function rpcMutation(promise) {
  const result = await promise
  if (result.error) {
    return { ...result, error: { ...result.error, message: mapRequisitionError(result.error) } }
  }
  return result
}

export async function approveRequisition(id, items) {
  return rpcMutation(supabase.rpc("approve_requisition", {
    p_requisition_id: id,
    p_items: serializeApprovalItems(items)
  }))
}

export async function rejectRequisition(id, reason) {
  return rpcMutation(supabase.rpc("reject_requisition", { p_requisition_id: id, p_reason: reason }))
}

export async function cancelRequisition(id, reason) {
  return rpcMutation(supabase.rpc("cancel_requisition", { p_requisition_id: id, p_reason: reason }))
}

export async function completeRequisition(id, items = null) {
  return rpcMutation(supabase.rpc("complete_requisition", {
    p_requisition_id: id,
    p_items: items ? serializeFulfillmentItems(items) : null
  }))
}

export async function getRequisitionPurchaseSuggestions(requisitionId, { recordSuggested = true } = {}) {
  const { data, error } = await supabase.rpc("get_requisition_purchase_suggestions", {
    p_requisition_id: requisitionId,
    p_record_suggested: recordSuggested
  })
  return { data: Array.isArray(data) ? data : (data || []), error }
}

export async function getRequisitionLowStockImpacts(requisitionId, { recordSuggested = true } = {}) {
  const { data, error } = await supabase.rpc("get_requisition_low_stock_impacts", {
    p_requisition_id: requisitionId,
    p_record_suggested: recordSuggested
  })
  return { data: Array.isArray(data) ? data : (data || []), error }
}

export function addLowStockItemsToTodayPurchaseOrder(requisitionId, items) {
  return supabase.rpc("add_low_stock_items_to_today_purchase_order", {
    p_requisition_id: requisitionId,
    p_items: items
  })
}

export function ignoreLowStockPurchaseSuggestion(requisitionId, items, notes = "") {
  return supabase.rpc("ignore_low_stock_purchase_suggestion", {
    p_requisition_id: requisitionId,
    p_items: items,
    p_notes: notes || null
  })
}

export async function getItemOpenRequisitionsForUnitChange(itemId) {
  const { data, error } = await supabase.rpc("get_item_open_requisitions_for_unit_change", {
    p_item_id: itemId
  })
  if (error) return { data: [], error: { ...error, message: mapRequisitionError(error) } }
  const rows = Array.isArray(data) ? data : []
  return { data: rows, error: null }
}

export function mapRequisitionRpcError(error) {
  return mapRequisitionError(error)
}

export async function duplicateRequisitionWithCurrentUnits(requisitionId, mode = "full_duplicate") {
  const { data, error } = await supabase.rpc("duplicate_requisition_with_current_units", {
    p_requisition_id: requisitionId,
    p_mode: mode
  })
  if (error) {
    return { data: null, error: { ...error, message: mapRequisitionError(error) } }
  }
  return { data: data || null, error: null }
}
