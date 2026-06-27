import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
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
  return cachedQuery(`${CACHE_KEYS.AREAS_PREFIX}all`, () => fetchAreas(supabase.from("areas").select("*")), CACHE_TTL.CATALOG)
}

export function getActiveAreas() {
  return cachedQuery(`${CACHE_KEYS.AREAS_PREFIX}active`, () => fetchAreas(supabase.from("areas").select("*").eq("active", true)), CACHE_TTL.CATALOG)
}

export function getProductionAreas() {
  return cachedQuery(`${CACHE_KEYS.AREAS_PREFIX}production`, () => fetchAreas(supabase.from("areas").select("*").eq("active", true).eq("is_production_area", true)), CACHE_TTL.CATALOG)
}

export async function createArea(area) {
  const { data, error } = await supabase
    .from("areas")
    .insert({ id: area.id, ...serializeArea(area) })
    .select("*")
    .single()
  if (!error) invalidateQueryCache(CACHE_KEYS.AREAS_PREFIX)
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
  if (!error) invalidateQueryCache(CACHE_KEYS.AREAS_PREFIX)
  return { data: normalizeArea(data), error }
}

export function deactivateArea(id) {
  return updateArea(id, { active: false })
}

export function activateArea(id) {
  return updateArea(id, { active: true })
}

export async function saveOperationalArea(payload = {}, editingAreaId = "") {
  const name = String(payload.name || "").trim()
  if (!name) throw new Error("El nombre del área es obligatorio")

  const allowedTypes = new Set(["principal", "operativa", "produccion", "servicio", "administrativa", "limpieza"])
  const type = allowedTypes.has(payload.type) ? payload.type : "operativa"
  const id = editingAreaId || String(payload.id || slugifyAreaId(name)).trim()
  if (!id) throw new Error("No se pudo generar una clave válida para el área")

  const areaPayload = {
    id,
    name,
    type: id === "almacen" ? "principal" : type,
    description: String(payload.description || "").trim(),
    responsibleUserId: payload.responsibleUserId || null,
    active: id === "almacen" ? true : payload.active !== false,
    canRequestInventory: id === "almacen" ? false : payload.canRequestInventory !== false,
    isProductionArea: id === "almacen" ? false : payload.isProductionArea === true,
    sortOrder: Number(payload.sortOrder || 0)
  }

  if (editingAreaId) {
    const result = await updateArea(editingAreaId, areaPayload)
    if (result.error) throw new Error(result.error.message || "No se pudo actualizar el área.")
    return result.data
  }

  const { data: existingAreas, error: loadError } = await getAreas()
  if (loadError) throw new Error(loadError.message || "No se pudieron validar las áreas existentes.")
  if ((existingAreas || []).some((area) => area.id === id)) {
    throw new Error(`Ya existe un área con la clave "${id}".`)
  }

  const result = await createArea(areaPayload)
  if (result.error) throw new Error(result.error.message || "No se pudo crear el área.")
  return result.data
}
