import { supabase } from "../lib/supabase"
import { getActiveAreas } from "./areasService"

const INVENTORY_IMAGES_BUCKET = "inventory-images"

function mapItem(item) {
  const stocks = item?.area_inventory || []
  const stockByArea = Object.fromEntries(stocks.map((stock) => [stock.area_id, Number(stock.quantity || 0)]))
  const minimumByArea = Object.fromEntries(stocks.map((stock) => [stock.area_id, Number(stock.minimum_quantity || 0)]))
  return item ? {
    ...item,
    stockByArea,
    minimumByArea,
    totalQuantity: Object.values(stockByArea).reduce((total, quantity) => total + quantity, 0)
  } : item
}

function itemPayload(item) {
  return {
    name: item.name?.trim(),
    sku: item.sku?.trim() || null,
    category: item.category?.trim() || null,
    purchase_unit: item.purchase_unit?.trim() || null,
    base_unit: item.base_unit?.trim(),
    conversion_factor: Number(item.conversion_factor || 1),
    cost_per_base_unit: Number(item.cost_per_base_unit || 0),
    supplier: item.supplier?.trim() || null,
    image_url: item.image_url?.trim() || null,
    active: item.active !== false,
    notes: item.notes?.trim() || null
  }
}

async function queryItems(activeOnly = false) {
  let query = supabase.from("inventory_items").select("*, area_inventory(*)")
  if (activeOnly) query = query.eq("active", true)
  const { data, error } = await query.order("name", { ascending: true })
  return { data: (data || []).map(mapItem), error }
}

export function getInventoryItems() {
  return queryItems()
}

export function getActiveInventoryItems() {
  return queryItems(true)
}

export async function createInventoryItem(item) {
  const { data, error } = await supabase
    .from("inventory_items")
    .insert(itemPayload(item))
    .select("*")
    .single()
  if (error) return { data: null, error }
  const rowsResult = await ensureItemAreaRows(data.id)
  if (rowsResult.error) return { data: null, error: rowsResult.error }
  return { data: mapItem({ ...data, area_inventory: rowsResult.data }), error: null }
}

export async function updateInventoryItem(id, updates) {
  const { data, error } = await supabase
    .from("inventory_items")
    .update(itemPayload(updates))
    .eq("id", id)
    .select("*, area_inventory(*)")
    .single()
  return { data: mapItem(data), error }
}

export function deactivateInventoryItem(id) {
  return supabase.from("inventory_items").update({ active: false }).eq("id", id).select("*").single()
}

export async function getAreaInventory(areaId) {
  const { data, error } = await supabase
    .from("area_inventory")
    .select("*, inventory_items(*)")
    .eq("area_id", areaId)
    .order("updated_at", { ascending: false })
  return { data: data || [], error }
}

export async function getAllAreaInventory() {
  const { data, error } = await supabase
    .from("area_inventory")
    .select("*, inventory_items(*)")
    .order("updated_at", { ascending: false })
  return { data: data || [], error }
}

export async function upsertAreaInventory(itemId, areaId, quantity, minimumQuantity = 0) {
  return supabase
    .from("area_inventory")
    .upsert({
      item_id: itemId,
      area_id: areaId,
      quantity: Number(quantity || 0),
      minimum_quantity: Number(minimumQuantity || 0)
    }, { onConflict: "item_id,area_id" })
    .select("*")
    .single()
}

export async function getItemStockByArea(itemId) {
  const { data, error } = await supabase
    .from("area_inventory")
    .select("*")
    .eq("item_id", itemId)
    .order("area_id", { ascending: true })
  return { data: data || [], error }
}

export async function getInventoryMovements(filters = {}) {
  let query = supabase.from("inventory_movements").select("*").order("created_at", { ascending: false })
  if (filters.itemId) query = query.eq("item_id", filters.itemId)
  if (filters.areaId) query = query.or(`from_area_id.eq.${filters.areaId},to_area_id.eq.${filters.areaId}`)
  if (filters.movementType) query = query.eq("movement_type", filters.movementType)
  const { data, error } = await query.limit(filters.limit || 100)
  return { data: data || [], error }
}

export function createInventoryMovement(movement) {
  return supabase.from("inventory_movements").insert({
    item_id: movement.itemId,
    movement_type: movement.movementType,
    from_area_id: movement.fromAreaId || null,
    to_area_id: movement.toAreaId || null,
    quantity: Number(movement.quantity || 0),
    unit: movement.unit,
    previous_quantity: movement.previousQuantity,
    new_quantity: movement.newQuantity,
    source_type: movement.sourceType || null,
    source_id: movement.sourceId || null,
    notes: movement.notes || null,
    performed_by: movement.performedBy || null
  }).select("*").single()
}

export function adjustAreaInventory(itemId, areaId, quantity, minimumQuantity, unit, notes) {
  return supabase.rpc("adjust_area_inventory", {
    p_item_id: itemId,
    p_area_id: areaId,
    p_quantity: Number(quantity || 0),
    p_minimum_quantity: Number(minimumQuantity || 0),
    p_unit: unit,
    p_notes: notes || "Actualización de mínimo"
  })
}

export function importAreaInventoryStock(itemId, areaId, quantity, minimumQuantity, unit) {
  return supabase.rpc("import_area_inventory_stock", {
    p_item_id: itemId,
    p_area_id: areaId,
    p_quantity: Number(quantity || 0),
    p_minimum_quantity: Number(minimumQuantity || 0),
    p_unit: unit
  })
}

export function importInventoryRows(rows) {
  return supabase.rpc("import_inventory_rows", { p_rows: rows })
}

export async function uploadInventoryImage(file, itemId) {
  const extension = String(file.name || "").split(".").pop()?.toLowerCase() || "jpg"
  const safeName = String(file.name || "imagen")
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "imagen"
  const path = `${itemId}/${Date.now()}-${safeName}.${extension}`
  const { error } = await supabase.storage
    .from(INVENTORY_IMAGES_BUCKET)
    .upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false })
  if (error) return { data: null, error }
  const { data } = supabase.storage.from(INVENTORY_IMAGES_BUCKET).getPublicUrl(path)
  return { data: { path, url: data.publicUrl }, error: null }
}

export function updateInventoryItemImage(itemId, imageUrl) {
  return supabase
    .from("inventory_items")
    .update({ image_url: imageUrl || null })
    .eq("id", itemId)
    .select("*")
    .single()
}

export function deleteInventoryImage(path) {
  return supabase.storage.from(INVENTORY_IMAGES_BUCKET).remove([path])
}

export async function ensureItemAreaRows(itemId) {
  const { data: areas, error: areasError } = await getActiveAreas()
  if (areasError) return { data: [], error: areasError }
  if (!areas.length) return { data: [], error: null }
  const { data, error } = await supabase
    .from("area_inventory")
    .upsert(areas.map((area) => ({
      item_id: itemId,
      area_id: area.id,
      quantity: 0,
      minimum_quantity: 0
    })), { onConflict: "item_id,area_id", ignoreDuplicates: true })
    .select("*")
  return { data: data || [], error }
}
