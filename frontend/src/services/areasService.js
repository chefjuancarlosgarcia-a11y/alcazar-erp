import { supabase } from "../lib/supabase"

function normalizeArea(area) {
  return area ? {
    ...area,
    responsibleUserId: area.responsible_user_id || "",
    canRequestInventory: area.can_request_inventory !== false,
    isProductionArea: area.is_production_area === true,
    sortOrder: Number(area.sort_order || 0),
    createdAt: area.created_at,
    updatedAt: area.updated_at
  } : area
}

function serializeArea(area) {
  const payload = {}
  const fields = ["name", "type", "description", "active"]
  fields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(area, field)) payload[field] = area[field]
  })
  if (Object.prototype.hasOwnProperty.call(area, "responsibleUserId")) {
    payload.responsible_user_id = area.responsibleUserId || null
  }
  if (Object.prototype.hasOwnProperty.call(area, "canRequestInventory")) {
    payload.can_request_inventory = area.canRequestInventory
  }
  if (Object.prototype.hasOwnProperty.call(area, "isProductionArea")) {
    payload.is_production_area = area.isProductionArea
  }
  if (Object.prototype.hasOwnProperty.call(area, "sortOrder")) {
    payload.sort_order = Number(area.sortOrder || 0)
  }
  return payload
}

async function fetchAreas(query) {
  const { data, error } = await query.order("sort_order", { ascending: true }).order("name", { ascending: true })
  return { data: (data || []).map(normalizeArea), error }
}

export function getAreas() {
  return fetchAreas(supabase.from("areas").select("*"))
}

export function getActiveAreas() {
  return fetchAreas(supabase.from("areas").select("*").eq("active", true))
}

export function getProductionAreas() {
  return fetchAreas(supabase.from("areas").select("*").eq("active", true).eq("is_production_area", true))
}

export async function createArea(area) {
  const { data, error } = await supabase
    .from("areas")
    .insert({ id: area.id, ...serializeArea(area) })
    .select("*")
    .single()
  return { data: normalizeArea(data), error }
}

export async function updateArea(id, updates) {
  const { data, error } = await supabase
    .from("areas")
    .update(serializeArea(updates))
    .eq("id", id)
    .select("*")
    .single()
  return { data: normalizeArea(data), error }
}

export function deactivateArea(id) {
  return updateArea(id, { active: false })
}
