import { supabase } from "../lib/supabase"
import { cachedQuery, invalidateQueryCache } from "./queryCache"

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
  return cachedQuery("areas:all", () => fetchAreas(supabase.from("areas").select("*")), 300000)
}

export function getActiveAreas() {
  return cachedQuery("areas:active", () => fetchAreas(supabase.from("areas").select("*").eq("active", true)), 300000)
}

export function getProductionAreas() {
  return cachedQuery("areas:production", () => fetchAreas(supabase.from("areas").select("*").eq("active", true).eq("is_production_area", true)), 300000)
}

export async function createArea(area) {
  const { data, error } = await supabase
    .from("areas")
    .insert({ id: area.id, ...serializeArea(area) })
    .select("*")
    .single()
  if (!error) invalidateQueryCache("areas:")
  return { data: normalizeArea(data), error }
}

export function slugifyAreaId(name) {
  return String(name || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export async function createOperationalArea(payload = {}) {
  const name = String(payload.name || "").trim()
  if (!name) throw new Error("El nombre del área es obligatorio")

  const id = String(payload.id || slugifyAreaId(name)).trim()
  if (!id) throw new Error("No se pudo generar una clave válida para el área")

  const allowedTypes = new Set(["principal", "operativa", "produccion", "servicio", "administrativa", "limpieza"])
  const type = allowedTypes.has(payload.type) ? payload.type : "operativa"

  const { data: existingAreas, error: loadError } = await getAreas()
  if (loadError) throw new Error(loadError.message || "No se pudieron validar las áreas existentes.")
  if ((existingAreas || []).some((area) => area.id === id)) {
    throw new Error(`Ya existe un área con la clave "${id}".`)
  }

  const result = await createArea({
    id,
    name,
    type,
    description: String(payload.description || "").trim(),
    active: payload.active !== false,
    canRequestInventory: payload.canRequestInventory !== false,
    isProductionArea: payload.isProductionArea === true,
    sortOrder: Number(payload.sortOrder || 0)
  })

  if (result.error) {
    throw new Error(result.error.message || "No se pudo crear el área.")
  }
  return result.data
}

export async function updateArea(id, updates) {
  const { data, error } = await supabase
    .from("areas")
    .update(serializeArea(updates))
    .eq("id", id)
    .select("*")
    .single()
  if (!error) invalidateQueryCache("areas:")
  return { data: normalizeArea(data), error }
}

export function deactivateArea(id) {
  return updateArea(id, { active: false })
}
