import { supabase } from "../lib/supabase"
import { inferBarcodeSource, inferBarcodeType, normalizeBarcode } from "../utils/barcodeUtils"
import { getActiveAreas } from "./areasService"

const INVENTORY_IMAGES_BUCKET = "inventory-images"
export const INVENTORY_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const INVENTORY_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"]

const MIME_TO_EXTENSION = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
}

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

function barcodePayload(item, { previousBarcode = null } = {}) {
  const barcode = normalizeBarcode(item.barcode)
  if (!barcode) {
    return {
      barcode: null,
      barcode_type: null,
      barcode_source: null,
      barcode_created_at: null
    }
  }

  const previous = normalizeBarcode(previousBarcode)
  const isNewAssignment = !previous || previous !== barcode

  return {
    barcode,
    barcode_type: item.barcode_type || inferBarcodeType(barcode),
    barcode_source: inferBarcodeSource(barcode, item.barcode_source),
    barcode_created_at: isNewAssignment
      ? (item.barcode_created_at || new Date().toISOString())
      : (item.barcode_created_at || null)
  }
}

function itemPayload(item, options = {}) {
  return {
    name: item.name?.trim(),
    sku: item.sku?.trim() || null,
    ...barcodePayload(item, options),
    category: item.category?.trim() || null,
    purchase_unit: item.purchase_unit?.trim() || null,
    base_unit: item.base_unit?.trim(),
    default_requisition_unit: item.default_requisition_unit?.trim() || item.base_unit?.trim() || null,
    conversion_factor: Number(item.conversion_factor || 1),
    purchase_price: item.purchase_price === "" || item.purchase_price == null
      ? null
      : Number(item.purchase_price),
    cost_per_base_unit: Number(item.cost_per_base_unit || 0),
    supplier: item.supplier?.trim() || null,
    image_url: item.image_url?.trim() || null,
    active: item.active !== false,
    notes: item.notes?.trim() || null
  }
}

const INVENTORY_REQUEST_TIMEOUT_MS = 30000

export function mapInventoryError(error) {
  if (!error) return { message: "Operación de inventario fallida." }
  const message = String(error.message || "").trim()
  const lower = message.toLowerCase()
  if (lower.includes("duplicate key") && lower.includes("sku")) {
    return { message: "No se pudo guardar el producto porque el SKU ya existe.", code: error.code }
  }
  if (lower.includes("inventory_items_barcode") || (lower.includes("duplicate") && lower.includes("barcode"))) {
    return { message: "Este código ya pertenece a otro producto.", code: error.code }
  }
  if (lower.includes("row-level security") || lower.includes("permission") || lower.includes("not authorized")) {
    return { message: "No tienes permisos para modificar productos de inventario.", code: error.code }
  }
  return { message: message || "Operación de inventario fallida.", code: error.code }
}

async function withInventoryTimeout(promise, label = "inventory") {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error("La solicitud tardó demasiado. Intenta de nuevo."), { code: "TIMEOUT" }))
        }, INVENTORY_REQUEST_TIMEOUT_MS)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

const INVENTORY_FETCH_PAGE_SIZE = 1000

async function queryItems(activeOnly = false) {
  const rows = []
  let from = 0
  let totalCount = null

  while (true) {
    let query = supabase
      .from("inventory_items")
      .select("*, area_inventory(*)", from === 0 ? { count: "exact" } : undefined)
      .order("name", { ascending: true })
      .range(from, from + INVENTORY_FETCH_PAGE_SIZE - 1)

    if (activeOnly) query = query.eq("active", true)

    const { data, error, count } = await withInventoryTimeout(query)
    if (error) return { data: [], error: mapInventoryError(error), totalCount: null }

    if (from === 0 && typeof count === "number") {
      totalCount = count
    }

    const batch = data || []
    rows.push(...batch)

    if (batch.length < INVENTORY_FETCH_PAGE_SIZE) break
    from += INVENTORY_FETCH_PAGE_SIZE
  }

  if (import.meta.env.DEV && typeof totalCount === "number" && totalCount > rows.length) {
    console.warn(
      `[inventory] Catálogo parcial: ${rows.length}/${totalCount} productos visibles para este usuario. Revisa RLS o paginación.`
    )
  }

  return { data: rows.map(mapItem), error: null, totalCount }
}

export function getInventoryItems() {
  return queryItems()
}

export function getActiveInventoryItems() {
  return queryItems(true)
}

export async function getInventoryItemById(id) {
  const { data, error } = await withInventoryTimeout(
    supabase.from("inventory_items").select("*, area_inventory(*)").eq("id", id).single()
  )
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.id) return { data: null, error: { message: "No se encontró el producto en Supabase." } }
  return { data: mapItem(data), error: null }
}

export async function getInventoryItemByBarcode(barcode) {
  const normalized = normalizeBarcode(barcode)
  if (!normalized) {
    return { data: null, error: { message: "Código de barras vacío." } }
  }

  const { data, error } = await withInventoryTimeout(
    supabase.rpc("find_inventory_item_by_barcode", { p_barcode: normalized })
  )
  if (error) return { data: null, error: mapInventoryError(error) }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.id) return { data: null, error: null }

  const detail = await getInventoryItemById(row.id)
  return detail
}

export async function checkBarcodeExists(barcode, excludeItemId = "") {
  const normalized = normalizeBarcode(barcode)
  if (!normalized) return { exists: false, item: null, error: null }

  const lookup = await getInventoryItemByBarcode(normalized)
  if (lookup.error) return { exists: false, item: null, error: lookup.error }
  if (!lookup.data) return { exists: false, item: null, error: null }
  if (lookup.data.id === excludeItemId) return { exists: false, item: null, error: null }

  return { exists: true, item: lookup.data, error: null }
}

export async function generateInternalBarcode() {
  const { data, error } = await withInventoryTimeout(supabase.rpc("generate_internal_barcode"))
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.barcode) {
    return { data: null, error: { message: "No se pudo generar el código interno." } }
  }
  return {
    data: {
      barcode: normalizeBarcode(data.barcode),
      barcode_type: data.barcode_type || "CODE128",
      barcode_source: data.barcode_source || "internal"
    },
    error: null
  }
}

export async function createInventoryItem(item) {
  const { data, error } = await withInventoryTimeout(
    supabase.from("inventory_items").insert(itemPayload(item)).select("*").single()
  )
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.id) return { data: null, error: { message: "Supabase no devolvió el producto creado." } }

  const rowsResult = await ensureItemAreaRows(data.id)
  if (rowsResult.error) return { data: null, error: mapInventoryError(rowsResult.error) }

  const mapped = mapItem({ ...data, area_inventory: rowsResult.data })
  return { data: mapped?.id ? mapped : null, error: mapped?.id ? null : { message: "No se pudo confirmar el producto creado." } }
}

export async function updateInventoryItem(id, updates, options = {}) {
  const { data, error } = await withInventoryTimeout(
    supabase.from("inventory_items").update(itemPayload(updates, options)).eq("id", id).select("*, area_inventory(*)").single()
  )
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.id) return { data: null, error: { message: "Supabase no devolvió el producto actualizado." } }
  const mapped = mapItem(data)
  return { data: mapped?.id ? mapped : null, error: mapped?.id ? null : { message: "No se pudo confirmar el producto actualizado." } }
}

export async function deactivateInventoryItem(id) {
  const { data, error } = await withInventoryTimeout(
    supabase.from("inventory_items").update({ active: false }).eq("id", id).select("*, area_inventory(*)").single()
  )
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.id) return { data: null, error: { message: "No se pudo confirmar la desactivación del producto." } }
  const mapped = mapItem(data)
  return { data: mapped?.id ? mapped : null, error: mapped?.id ? null : { message: "No se pudo confirmar la desactivación del producto." } }
}

export async function reactivateInventoryItem(id) {
  const { data, error } = await withInventoryTimeout(
    supabase.from("inventory_items").update({ active: true }).eq("id", id).select("*, area_inventory(*)").single()
  )
  if (error) return { data: null, error: mapInventoryError(error) }
  if (!data?.id) return { data: null, error: { message: "No se pudo confirmar la activación del producto." } }
  const mapped = mapItem(data)
  return { data: mapped?.id ? mapped : null, error: mapped?.id ? null : { message: "No se pudo confirmar la activación del producto." } }
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
  const testFilter = filters.testFlowFilter ?? (filters.includeTest ? "all" : "real")
  if (testFilter === "real") query = query.eq("is_test", false)
  else if (testFilter === "test") query = query.eq("is_test", true)
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
    performed_by: movement.performedBy || null,
    is_test: Boolean(movement.isTest ?? movement.is_test)
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
  if (!INVENTORY_IMAGE_ALLOWED_TYPES.includes(file.type)) {
    return {
      data: null,
      error: { message: "Formato no permitido. Usa JPG, PNG o WEBP." }
    }
  }
  if (file.size > INVENTORY_IMAGE_MAX_BYTES) {
    return {
      data: null,
      error: {
        message: "La imagen optimizada supera 10 MB. Intenta con otra foto o un encuadre más cercano."
      }
    }
  }

  const extension = MIME_TO_EXTENSION[file.type] || "jpg"
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
  if (error) {
    const message = /payload too large|exceeded the maximum|413/i.test(error.message || "")
      ? "La imagen supera el límite permitido por el servidor. Intenta con otra foto."
      : error.message
    return { data: null, error: { message } }
  }
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
  const warehouse = areas.find((area) => area.id === "almacen")
  if (!warehouse) return { data: [], error: null }
  const { data, error } = await supabase
    .from("area_inventory")
    .upsert([warehouse].map((area) => ({
      item_id: itemId,
      area_id: area.id,
      quantity: 0,
      minimum_quantity: 0
    })), { onConflict: "item_id,area_id", ignoreDuplicates: true })
    .select("*")
  return { data: data || [], error }
}
