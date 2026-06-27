import { supabase } from "../lib/supabase"
import { CACHE_KEYS } from "./cacheConfig"
import { invalidateQueryCache } from "./queryCache"
import { getProductionAreas, saveOperationalArea, updateArea, deactivateArea } from "./areasService"

export { getProductionAreas }

const AREA_CARD_META = {
  cocina: { kdsLabel: "KDS Cocina", subtitle: "Platos calientes, línea caliente y expeditors.", tone: "kitchen" },
  pizzeria: { kdsLabel: "KDS Pizzería / Horno", subtitle: "Pizzas, horno y preparación de línea caliente.", tone: "pizza" },
  barra: { kdsLabel: "KDS Barra", subtitle: "Bebidas, coctelería y servicio de barra.", tone: "bar" },
  cafeteria: { kdsLabel: "KDS Cafetería", subtitle: "Cafés, bebidas calientes y preparación rápida.", tone: "cafe" },
  reposteria: { kdsLabel: "KDS Repostería / Postres", subtitle: "Postres, repostería y emplatados fríos.", tone: "dessert" },
  panaderia: { kdsLabel: "KDS Panadería", subtitle: "Panadería y productos de horno.", tone: "bakery" }
}

export function getProductionAreaCardMeta(areaId) {
  const key = String(areaId || "").trim().toLowerCase()
  return AREA_CARD_META[key] || {
    kdsLabel: `KDS ${key}`,
    subtitle: "Estación de producción del restaurante.",
    tone: "default"
  }
}

export function enrichProductionArea(area) {
  const meta = getProductionAreaCardMeta(area.id)
  return {
    ...area,
    slug: area.id,
    kdsLabel: meta.kdsLabel,
    cardSubtitle: meta.subtitle,
    cardTone: meta.tone
  }
}

export async function getProductionAreasEnriched() {
  const { data, error } = await getProductionAreas()
  return { data: (data || []).map(enrichProductionArea), error }
}

export async function getUserProductionAreaAssignments(profileId) {
  if (!profileId) return { data: [], error: null }
  const { data, error } = await supabase
    .from("user_production_areas")
    .select("id, profile_id, production_area_id, is_active, created_at, area:areas(id, name, active, is_production_area)")
    .eq("profile_id", profileId)
    .eq("is_active", true)
  return { data: data || [], error }
}

export async function getAllUserProductionAreaAssignments() {
  const { data, error } = await supabase
    .from("user_production_areas")
    .select("id, profile_id, production_area_id, is_active, created_at, profile:profiles(id, full_name, username, role, area_name), area:areas(id, name)")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
  return { data: data || [], error }
}

export async function assignUserProductionArea(profileId, productionAreaId) {
  const { data, error } = await supabase
    .from("user_production_areas")
    .upsert({
      profile_id: profileId,
      production_area_id: productionAreaId,
      is_active: true
    }, { onConflict: "profile_id,production_area_id" })
    .select("*")
    .single()
  if (!error) {
    await supabase.from("profiles").update({ area_id: productionAreaId }).eq("id", profileId)
  }
  return { data, error }
}

export async function deactivateUserProductionArea(id) {
  const { data, error } = await supabase
    .from("user_production_areas")
    .update({ is_active: false })
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function saveProductionArea(payload, editingId = "") {
  const result = await saveOperationalArea({
    ...payload,
    isProductionArea: true,
    type: "produccion"
  }, editingId)
  invalidateQueryCache(CACHE_KEYS.AREAS_PREFIX)
  return result
}

export async function deactivateProductionArea(id) {
  const result = await deactivateArea(id)
  invalidateQueryCache(CACHE_KEYS.AREAS_PREFIX)
  return result
}

export async function activateProductionArea(id) {
  const { activateArea } = await import("./areasService")
  const result = await activateArea(id)
  invalidateQueryCache(CACHE_KEYS.AREAS_PREFIX)
  return result
}

export async function resolveUserProductionAreaIds(user) {
  if (!user?.id) return []
  const { data, error } = await getUserProductionAreaAssignments(user.id)
  if (error) return user.areaId ? [user.areaId] : []
  const assigned = (data || []).map((row) => row.production_area_id).filter(Boolean)
  if (assigned.length) return assigned
  return user.areaId ? [user.areaId] : []
}
