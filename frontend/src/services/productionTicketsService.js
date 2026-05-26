import { supabase } from "../lib/supabase"

const DEBUG = import.meta.env.DEV
const ticketSelect = `
  *,
  items:production_ticket_items(*)
`

function debugTicket(label, payload) {
  if (DEBUG) console.log(`[productionTicketsService] ${label}`, payload)
}

export function withTimeout(promise, ms = 10000, label = "operación") {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(`Timeout en ${label}`)), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => window.clearTimeout(timeoutId))
}

export function formatSupabaseError(error) {
  if (!error) return "Error desconocido de Supabase."
  return [
    `message: ${error.message || "Sin mensaje"}`,
    `details: ${error.details || "Sin detalles"}`,
    `hint: ${error.hint || "Sin sugerencia"}`,
    `code: ${error.code || "Sin código"}`
  ].join(" | ")
}

function mapTicketItem(row) {
  return {
    ...row,
    orderItemId: row.order_item_id,
    productId: row.product_id,
    productName: row.product_name,
    quantity: Number(row.quantity || 0),
    modifiers: Array.isArray(row.modifiers) ? row.modifiers : [],
    createdAt: row.created_at
  }
}

function mapTicket(row) {
  if (!row) return row
  return {
    ...row,
    orderId: row.order_id,
    tableId: row.table_id,
    tableName: row.table_name,
    areaId: row.area_id,
    areaName: row.area_name,
    waiterId: row.waiter_id,
    waiterName: row.waiter_name || "POS",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    readyAt: row.ready_at,
    servedAt: row.served_at,
    problemReason: row.status === "problem" ? row.notes || "" : "",
    cancellationReason: row.status === "cancelled" ? row.notes || "" : "",
    items: (row.items || []).map(mapTicketItem)
  }
}

function serializeOrder(order) {
  return {
    order_id: String(order.id),
    table_id: String(order.mesaId || order.tableId || ""),
    table_name: order.mesa ? `Mesa ${order.mesa}` : order.tableName || "Orden POS",
    waiter_name: order.usuarioNombre || order.waiterName || "POS",
    priority: order.priority || "normal",
    notes: order.notes || ""
  }
}

function serializeItem(item) {
  return {
    order_item_id: String(item.lineId || item.orderItemId || ""),
    product_id: String(item.productId || item.id || ""),
    product_name: item.productName || item.nombre || "Producto",
    quantity: Number(item.quantity ?? item.cantidad ?? 0),
    notes: item.modificaciones || item.notes || "",
    modifiers: item.modificaciones ? [item.modificaciones] : []
  }
}

export async function createProductionTicketsFromOrder(order, items) {
  const payload = {
    p_order: serializeOrder(order),
    p_items: items.map((item) => ({
      ...serializeItem(item),
      production_area_id: item.productionAreaId || item.production_area_id || item.areaProduccion || ""
    }))
  }
  debugTicket("create request", payload)
  const { data, error } = await withTimeout(
    supabase.rpc("create_production_tickets_from_order", payload),
    10000,
    "insertar production_tickets y production_ticket_items"
  )
  if (error) {
    console.error("Supabase production ticket create error:", error)
    const detailedError = new Error(formatSupabaseError(error))
    detailedError.cause = error
    throw detailedError
  }
  const ids = data?.ticket_ids || []
  if (!ids.length) return { data: [], error: null }
  const query = await withTimeout(
    supabase.from("production_tickets").select(ticketSelect).in("id", ids).order("created_at"),
    10000,
    "consultar tickets creados"
  )
  debugTicket("create response", query)
  if (query.error) {
    const detailedError = new Error(formatSupabaseError(query.error))
    detailedError.cause = query.error
    throw detailedError
  }
  return { data: (query.data || []).map(mapTicket), error: query.error }
}

export async function checkProductionTicketsAvailability() {
  const { error } = await withTimeout(
    supabase.from("production_tickets").select("id").limit(1),
    10000,
    "verificar tabla production_tickets"
  )
  if (error) console.error("Supabase production tickets availability error:", error)
  return { available: !error, error }
}

export async function getProductionTickets(areaId = "") {
  let query = supabase.from("production_tickets").select(ticketSelect)
  if (areaId) query = query.eq("area_id", areaId)
  const { data, error } = await withTimeout(
    query.order("created_at", { ascending: false }).limit(100),
    10000,
    "actualizar tickets KDS"
  )
  if (error) console.error("Supabase KDS tickets error:", error)
  return { data: (data || []).map(mapTicket), error }
}

export async function updateProductionTicketStatus(ticketId, status, details = {}) {
  const now = new Date().toISOString()
  const updates = { status }
  if (status === "in_production") updates.started_at = now
  if (status === "ready") updates.ready_at = now
  if (status === "served") updates.served_at = now
  if (details.notes) updates.notes = details.notes
  const ticketResult = await withTimeout(
    supabase.from("production_tickets").update(updates).eq("id", ticketId).select(ticketSelect).single(),
    10000,
    "actualizar estado production_ticket"
  )
  if (ticketResult.error) return { data: null, error: ticketResult.error }
  const itemResult = await withTimeout(
    supabase.from("production_ticket_items").update({ status }).eq("ticket_id", ticketId),
    10000,
    "actualizar estado production_ticket_items"
  )
  if (itemResult.error) return { data: null, error: itemResult.error }
  return { data: mapTicket(ticketResult.data), error: null }
}

export async function updateProductionTicketItemStatus(itemId, status) {
  const { data, error } = await withTimeout(
    supabase
      .from("production_ticket_items")
      .update({ status })
      .eq("id", itemId)
      .select()
      .single(),
    10000,
    "actualizar item KDS"
  )
  return { data: mapTicketItem(data), error }
}
