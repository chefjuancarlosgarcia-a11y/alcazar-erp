import { supabase } from "../lib/supabase"
import { formatSupabaseError, withTimeout } from "./productionTicketsService"

const orderSelect = `*, items:pos_order_items(*)`

function mapOrderItem(row) {
  if (!row) return null
  return {
    ...row,
    lineId: row.id,
    productId: row.product_id,
    id: row.product_id,
    productName: row.product_name,
    nombre: row.product_name,
    quantity: Number(row.quantity || 0),
    cantidad: Number(row.quantity || 0),
    unitPrice: Number(row.unit_price || 0),
    precio: Number(row.unit_price || 0),
    recipeId: row.recipe_id || "",
    productionAreaId: row.production_area_id || "",
    areaProduccion: row.production_area_id || "",
    productionReady: row.production_ready === true,
    inventoryConsumed: row.inventory_consumed === true,
    ticketId: row.production_ticket_id || "",
    modificaciones: row.notes || "",
    modifiers: row.modifiers || []
  }
}

function mapOrder(row) {
  if (!row) return row
  return {
    ...row,
    tableId: row.table_id,
    tableName: row.table_name,
    mesaId: row.table_id,
    mesa: row.table_name?.replace(/^Mesa\s+/i, "") || row.table_name,
    areaId: row.area_id,
    area: row.area_name,
    usuarioNombre: row.waiter_name || "POS",
    estado: row.status === "sent" ? "en preparacion" : row.status,
    mesaKey: `${row.area_id || ""}:${row.table_id || ""}`,
    total: Number(row.total || 0),
    items: (row.items || []).map(mapOrderItem)
  }
}

async function queryOrder(query, label) {
  const { data, error } = await withTimeout(query, 10000, label)
  return {
    data: mapOrder(data),
    error,
    message: error ? formatSupabaseError(error) : ""
  }
}

export async function getOpenOrderByTable(tableId) {
  return queryOrder(
    supabase.from("pos_orders").select(orderSelect).eq("table_id", String(tableId)).in("status", ["open", "awaiting_bill", "sent_to_cashier"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    "cargar orden abierta POS"
  )
}

export async function getTableOrderHistory(tableId) {
  const { data, error } = await withTimeout(
    supabase.from("pos_orders").select(orderSelect).eq("table_id", String(tableId)).order("created_at", { ascending: false }).limit(30),
    10000,
    "cargar historial POS"
  )
  return { data: (data || []).map(mapOrder), error }
}

export const getOrdersByTable = getTableOrderHistory

export async function getOrderWithItems(orderId) {
  return queryOrder(
    supabase.from("pos_orders").select(orderSelect).eq("id", orderId).single(),
    "cargar detalle de orden POS"
  )
}

export async function getOrderEvents(orderId) {
  if (!orderId) return { data: [], error: null }
  const { data, error } = await withTimeout(
    supabase.from("pos_order_events").select("*").eq("order_id", orderId).order("created_at", { ascending: false }),
    10000,
    "cargar historial operativo POS"
  )
  return { data: data || [], error }
}

export async function getTableOrderEvents(tableId) {
  const { data, error } = await withTimeout(
    supabase
      .from("pos_order_events")
      .select("*, order:pos_orders!inner(table_id)")
      .eq("order.table_id", String(tableId))
      .order("created_at", { ascending: false })
      .limit(40),
    10000,
    "cargar historial de mesa POS"
  )
  return { data: data || [], error }
}

export async function recordOrderEvent(orderId, eventType, description) {
  const { error } = await withTimeout(
    supabase.rpc("record_pos_order_event", {
      p_order_id: orderId,
      p_event_type: eventType,
      p_description: description
    }),
    10000,
    "registrar evento POS"
  )
  return { error }
}

export async function createOrGetOpenOrder(tableData, currentUser) {
  const existing = await getOpenOrderByTable(tableData.tableId || tableData.mesaId)
  if (existing.error || existing.data) return existing
  return queryOrder(
    supabase.from("pos_orders").insert({
      table_id: String(tableData.tableId || tableData.mesaId),
      table_name: tableData.tableName || `Mesa ${tableData.mesaNumero || ""}`,
      area_id: tableData.areaId || null,
      area_name: tableData.areaName || tableData.areaNombre || null,
      waiter_id: currentUser.id,
      waiter_name: currentUser.name || currentUser.username || "POS",
      status: "open"
    }).select(orderSelect).single(),
    "crear orden POS"
  )
}

export async function addItemToOrder(orderId, product, quantity = 1, notes = "") {
  const unitPrice = Number(product.price ?? product.precio ?? 0)
  const { data, error } = await withTimeout(
    supabase.from("pos_order_items").insert({
      order_id: orderId,
      product_id: product.productId || product.id,
      product_name: product.productName || product.nombre || product.name,
      quantity: Number(quantity),
      unit_price: unitPrice,
      total_price: unitPrice * Number(quantity),
      recipe_id: product.recipeId || product.recipe_id,
      production_area_id: product.productionAreaId || product.production_area_id || product.areaProduccion,
      production_ready: product.productionReady === true,
      notes: notes || null,
      modifiers: notes ? [notes] : []
    }).select().single(),
    10000,
    "agregar producto a orden POS"
  )
  return {
    data: mapOrderItem(data),
    error,
    message: error ? formatSupabaseError(error) : ""
  }
}

export async function updateOrderItemQuantity(itemId, quantity, unitPrice) {
  const { data, error } = await withTimeout(
    supabase.from("pos_order_items").update({
      quantity: Number(quantity),
      total_price: Number(quantity) * Number(unitPrice || 0)
    }).eq("id", itemId).eq("status", "draft").select().single(),
    10000,
    "actualizar cantidad POS"
  )
  return {
    data: mapOrderItem(data),
    error,
    message: error ? formatSupabaseError(error) : ""
  }
}

export async function removeOrderItem(itemId) {
  const { error } = await withTimeout(
    supabase.from("pos_order_items").delete().eq("id", itemId).eq("status", "draft"),
    10000,
    "eliminar item POS"
  )
  return { error, message: error ? formatSupabaseError(error) : "" }
}

export async function cancelDraftItem(itemId) {
  const { error } = await withTimeout(
    supabase.rpc("cancel_pos_order_draft_item", { p_item_id: itemId }),
    10000,
    "cancelar producto nuevo POS"
  )
  return { error }
}

export async function clearDraftItems(orderId) {
  const { data, error } = await withTimeout(
    supabase.rpc("clear_pos_order_draft_items", { p_order_id: orderId }),
    10000,
    "limpiar productos nuevos POS"
  )
  return { data: Number(data || 0), error }
}

export async function updateOrderItemNotes(itemId, notes) {
  const { data, error } = await withTimeout(
    supabase.from("pos_order_items").update({
      notes: notes || null,
      modifiers: notes ? [notes] : []
    }).eq("id", itemId).eq("status", "draft").select().single(),
    10000,
    "actualizar modificaciones POS"
  )
  return {
    data: mapOrderItem(data),
    error,
    message: error ? formatSupabaseError(error) : ""
  }
}

export async function getOrderItems(orderId) {
  const { data, error } = await withTimeout(
    supabase.from("pos_order_items").select("*").eq("order_id", orderId).order("created_at"),
    10000,
    "refrescar items POS"
  )
  return { data: (data || []).map(mapOrderItem), error }
}

export async function sendOrderToProduction(orderId) {
  try {
    const { data, error } = await withTimeout(
      supabase.rpc("send_pos_order_to_production", { p_order_id: orderId }),
      10000,
      "enviar orden y consumir inventario"
    )
    if (error) return { data: null, error, message: formatSupabaseError(error) }
    return { data, error: null, message: "" }
  } catch (error) {
    return { data: null, error, message: error.message }
  }
}

async function runOrderAction(functionName, args, label) {
  const { data, error } = await withTimeout(
    supabase.rpc(functionName, args),
    10000,
    label
  )
  return { data: mapOrder(data), error, message: error ? formatSupabaseError(error) : "" }
}

export async function markOrderItemServed(itemId) {
  const { error } = await withTimeout(
    supabase.rpc("mark_pos_order_item_served", { p_item_id: itemId }),
    10000,
    "marcar producto servido"
  )
  return { error, message: error ? formatSupabaseError(error) : "" }
}

export async function requestOrderBill(orderId) {
  return runOrderAction("request_pos_order_bill", { p_order_id: orderId }, "solicitar cuenta POS")
}

export async function sendOrderToCashier(orderId) {
  return runOrderAction("send_pos_order_to_cashier", { p_order_id: orderId }, "enviar cuenta a caja")
}

export async function clearLegacyPOSOrders() {
  localStorage.removeItem("posOrders")
  localStorage.removeItem("posOrdenes")
}
