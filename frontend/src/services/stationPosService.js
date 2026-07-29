import { supabase } from "../lib/supabase"
import { formatSupabaseError, withTimeout } from "./productionTicketsService"
import { runStationPosIdempotentRpc } from "./stationPosIdempotency"
import { mapPosTableServiceError } from "./posOrdersService"
import {
  buildStationCategoriesFromCatalogProducts,
  normalizeStationPosCatalogResponse
} from "../utils/posCatalogCanonical"

const STATION_POS_DISABLED = "POS en estación no está habilitado en esta fase."

const TERMINAL_LOCK_REASONS = new Set([
  "send_to_production",
  "send_to_cashier",
  "release_table"
])

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
    isTestItem: row.is_test_item === true,
    is_test_item: row.is_test_item === true,
    inventoryConsumed: row.inventory_consumed === true,
    ticketId: row.production_ticket_id || "",
    productVariantId: row.product_variant_id || "",
    productVariantName: row.product_variant_name || "",
    selectedSize: row.selected_size || "",
    selectedOptions: row.selected_options || [],
    selected_options: row.selected_options || [],
    modificaciones: row.notes || "",
    modifiers: row.modifiers || []
  }
}

function mapOrder(row, items = []) {
  if (!row) return null
  const mergedItems = items.length ? items : row.items || []
  return {
    ...row,
    tableId: row.table_id,
    tableName: row.table_name,
    mesaId: row.table_id,
    mesa: row.table_name?.replace(/^Mesa\s+/i, "") || row.table_name,
    areaId: row.area_id,
    area: row.area_name,
    usuarioNombre: row.waiter_name || "POS",
    ownerProfileId: row.owner_profile_id || row.waiter_id || null,
    waiterId: row.waiter_id || null,
    estado: row.status === "sent" ? "en preparacion" : row.status,
    mesaKey: `${row.area_id || ""}:${row.table_id || ""}`,
    total: Number(row.total || 0),
    items: mergedItems.map(mapOrderItem)
  }
}

export function mapStationPosFloorResponse(data) {
  const areas = (data?.areas || []).map((z) => ({
    id: z.id,
    name: z.name,
    nombre: z.nombre || z.name,
    description: z.description || "",
    sortOrder: z.sortOrder ?? z.sort_order ?? 0,
    active: z.active !== false,
    width: z.width ?? 800,
    height: z.height ?? 600,
    mesasTotales: z.mesasTotales
  }))
  const tables = (data?.tables || []).map((t) => ({
    id: t.id,
    areaId: t.areaId || t.zone_id,
    zone_id: t.zone_id || t.areaId,
    name: t.name,
    numero: t.numero || String(t.name || "").replace(/^[Mm]/, ""),
    capacity: t.capacity,
    capacidad: t.capacidad ?? t.capacity,
    shape: t.shape,
    x: t.x,
    y: t.y,
    status: t.status || t.manual_status,
    estado: t.estado || t.manual_status,
    manual_status: t.manual_status || t.status,
    sortOrder: t.sortOrder ?? t.sort_order,
    active: t.active !== false
  }))
  return {
    areas,
    tables,
    settings: data?.settings || { snapToGrid: true, gridSize: 24, zoom: 1 },
    activeOrders: data?.active_orders || []
  }
}

async function rpcRead(token, fn, args, label) {
  const { data, error } = await withTimeout(supabase.rpc(fn, args), 15000, label)
  return { data, error, message: error ? formatSupabaseError(error) : "" }
}

async function fetchOrderWithItems(token, orderId) {
  const { data, error, message } = await rpcRead(
    token,
    "get_station_pos_order",
    { p_operator_session_token: token, p_order_id: orderId },
    "cargar orden POS estación"
  )
  if (error) return { data: null, error, message }
  return {
    data: mapOrder(data?.order, data?.items || []),
    error: null,
    message: ""
  }
}

function buildOptionSelections(product, notesOrOptions) {
  const options = typeof notesOrOptions === "string"
    ? { notes: notesOrOptions }
    : (notesOrOptions || {})
  const rawSelections = options.optionSelections || options.selectedOptions || {}
  if (rawSelections && !Array.isArray(rawSelections) && typeof rawSelections === "object") {
    return rawSelections
  }
  const groups = product?.optionGroups || product?.option_groups || []
  const out = {}
  if (Array.isArray(rawSelections)) {
    rawSelections.forEach((row) => {
      if (row?.group_id && row?.choice_id) out[row.group_id] = row.choice_id
    })
    return out
  }
  groups.forEach((group) => {
    const gid = String(group.id || group.name || "")
    const selected = rawSelections[gid] ?? rawSelections[group.id] ?? rawSelections[group.name]
    if (selected) out[gid] = selected
  })
  return out
}

function buildModifierIds(product, notesOrOptions) {
  const options = typeof notesOrOptions === "string" ? {} : (notesOrOptions || {})
  if (Array.isArray(options.modifierIds)) {
    return options.modifierIds.filter(Boolean)
  }
  const mods = Array.isArray(options.modifiers) ? options.modifiers : []
  return mods.map((m) => (typeof m === "object" ? m.id : m)).filter(Boolean)
}

export async function fetchOperationalStationPosEnabled() {
  const { data, error } = await supabase.rpc("operational_station_pos_enabled")
  if (error) return { enabled: false, error }
  return { enabled: Boolean(data), error: null }
}

export async function fetchStationPosCatalog(token) {
  const { data, error, message } = await rpcRead(
    token,
    "get_station_pos_catalog",
    { p_operator_session_token: token },
    "catálogo POS estación"
  )
  if (error) return { data: [], error, message }
  return { data: normalizeStationPosCatalogResponse(data), error: null, message: "" }
}

export async function fetchStationPosFloorLayout(token) {
  const { data, error, message } = await rpcRead(
    token,
    "get_station_pos_floor_layout",
    { p_operator_session_token: token },
    "plano POS estación"
  )
  if (error) return { data: null, error, message }
  return { data: mapStationPosFloorResponse(data), error: null, message: "" }
}

export function createStationPosPort(operatorSessionToken, { onOperatorLocked, onContextLoaded } = {}) {
  const token = operatorSessionToken
  let trackedOrderId = null

  function afterTerminal(actionType, result) {
    if (result.error || result.idempotencyUnknown) return
    if (TERMINAL_LOCK_REASONS.has(actionType)) {
      onOperatorLocked?.(actionType)
    }
  }

  async function fetchOrderWithItemsTracked(orderId) {
    trackedOrderId = orderId
    return fetchOrderWithItems(token, orderId)
  }

  async function loadContext() {
    const { data, error } = await supabase.rpc("get_station_pos_context", {
      p_operator_session_token: token
    })
    if (error) return { data: null, error }
    if (data?.pos_enabled === false) {
      return { data: null, error: { message: STATION_POS_DISABLED } }
    }
    if (data?.idle_expires_at) onContextLoaded?.(data.idle_expires_at)
    return { data, error: null }
  }

  return {
    mode: "station",
    loadContext,
    async fetchCatalog() {
      return fetchStationPosCatalog(token)
    },
    async fetchFloorLayout() {
      return fetchStationPosFloorLayout(token)
    },
    async openPosTableService(params) {
      const payload = {
        tableId: params.tableId,
        tableName: params.tableName || "",
        areaId: params.areaId || "",
        areaName: params.areaName || ""
      }
      const result = await runStationPosIdempotentRpc("open_table", payload, (idempotencyKey) =>
        supabase.rpc("open_station_pos_table_service", {
          p_operator_session_token: token,
          p_table_id: payload.tableId,
          p_table_name: payload.tableName,
          p_area_id: payload.areaId,
          p_area_name: payload.areaName,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: mapPosTableServiceError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      const orderId = result.data?.order_id
      if (!orderId) {
        return { data: null, error: new Error("Sin order_id"), message: "No se pudo abrir el servicio." }
      }
      const orderResult = await fetchOrderWithItemsTracked(orderId)
      return { ...orderResult, openMeta: result.data, created: result.data?.created === true, reused: result.data?.reused === true }
    },
    async getOpenOrderByTable(tableId) {
      const floor = await fetchStationPosFloorLayout(token)
      if (floor.error) return { data: null, error: floor.error, message: floor.message }
      const row = (floor.data?.activeOrders || []).find((o) => String(o.table_id) === String(tableId))
      if (!row?.order_id) return { data: null, error: null, message: "" }
      return fetchOrderWithItemsTracked(row.order_id)
    },
    async getActiveOrdersForTables(tableIds = []) {
      const floor = await fetchStationPosFloorLayout(token)
      if (floor.error) return { data: [], error: floor.error, message: floor.message }
      const ids = new Set((tableIds || []).map(String))
      const matches = (floor.data?.activeOrders || []).filter((o) => ids.has(String(o.table_id)))
      const orders = []
      for (const row of matches) {
        if (!row.order_id) continue
        const detail = await fetchOrderWithItems(token, row.order_id)
        if (detail.data) orders.push(detail.data)
      }
      return { data: orders, error: null, message: "" }
    },
    async getOrderWithItems(orderId) {
      return fetchOrderWithItemsTracked(orderId)
    },
    async getTableOrderHistory(tableId) {
      const { data, error, message } = await rpcRead(
        token,
        "get_station_pos_table_history",
        { p_operator_session_token: token, p_table_id: String(tableId) },
        "historial mesa POS estación"
      )
      if (error) return { data: [], error, message }
      const orders = (data?.orders || []).map((o) => mapOrder(o, []))
      return { data: orders, error: null, message: "" }
    },
    async getTableOrderEvents(tableId) {
      const { data, error, message } = await rpcRead(
        token,
        "get_station_pos_table_events",
        { p_operator_session_token: token, p_table_id: String(tableId), p_limit: 40 },
        "eventos mesa POS estación"
      )
      if (error) return { data: [], error, message }
      return { data: data?.events || [], error: null, message: "" }
    },
    async getOrderEvents(orderId) {
      const { data, error, message } = await rpcRead(
        token,
        "get_station_pos_order_events",
        {
          p_operator_session_token: token,
          p_order_id: String(orderId),
          p_limit: 40
        },
        "eventos orden POS estación"
      )
      if (error) return { data: [], error, message }
      return { data: data?.events || [], error: null, message: "" }
    },
    async addItemToOrder(orderId, product, quantity = 1, notesOrOptions = "") {
      const options = typeof notesOrOptions === "string" ? { notes: notesOrOptions } : (notesOrOptions || {})
      const payload = {
        orderId,
        productId: product.productId || product.id,
        quantity: Number(quantity),
        notes: options.notes || "",
        variantId: options.productVariantId || null,
        modifierIds: buildModifierIds(product, options),
        optionSelections: buildOptionSelections(product, options)
      }
      const result = await runStationPosIdempotentRpc("add_item", payload, (idempotencyKey) =>
        supabase.rpc("add_station_pos_order_item", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_product_id: payload.productId,
          p_quantity: payload.quantity,
          p_notes: payload.notes,
          p_variant_id: payload.variantId,
          p_modifier_ids: payload.modifierIds,
          p_option_selections: payload.optionSelections,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        const mapped = mapPosTableServiceError(result.error)
        return { data: null, error: result.error, message: mapped.userMessage || mapped.message, idempotencyUnknown: result.idempotencyUnknown }
      }
      const refreshed = await fetchOrderWithItemsTracked(orderId)
      const itemId = result.data?.item_id
      const item = refreshed.data?.items?.find((i) => i.lineId === itemId) || null
      return { data: item, error: null, message: "" }
    },
    async clearDraftItems(orderId) {
      const payload = { orderId }
      const result = await runStationPosIdempotentRpc("clear_drafts", payload, (idempotencyKey) =>
        supabase.rpc("clear_station_pos_draft_items", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: 0, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      return { data: Number(result.data?.removed || 0), error: null, message: "" }
    },
    async removeOrderItem(itemId) {
      const orderId = trackedOrderId
      if (!orderId) {
        return { error: new Error("Orden no cargada."), message: "Orden no cargada." }
      }
      const payload = { orderId, itemId }
      const result = await runStationPosIdempotentRpc("remove_draft", payload, (idempotencyKey) =>
        supabase.rpc("remove_station_pos_draft_item", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_item_id: itemId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      return { error: null, message: "" }
    },
    async updateOrderItemQuantity(itemId, quantity, unitPrice) {
      void unitPrice
      const orderId = trackedOrderId
      if (!orderId) {
        return { data: null, error: new Error("Orden no cargada."), message: "Orden no cargada." }
      }
      const payload = { orderId, itemId, quantity: Number(quantity) }
      const result = await runStationPosIdempotentRpc("update_item_qty", payload, (idempotencyKey) =>
        supabase.rpc("update_station_pos_order_item", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_item_id: itemId,
          p_quantity: payload.quantity,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      return { data: mapOrderItem(result.data?.item || result.data), error: null, message: "" }
    },
    async updateOrderItemNotes(itemId, notes) {
      const orderId = trackedOrderId
      if (!orderId) {
        return { data: null, error: new Error("Orden no cargada."), message: "Orden no cargada." }
      }
      const payload = { orderId, itemId, notes: notes || "" }
      const result = await runStationPosIdempotentRpc("update_item_notes", payload, (idempotencyKey) =>
        supabase.rpc("update_station_pos_order_item_notes", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_item_id: itemId,
          p_notes: payload.notes,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      return { data: mapOrderItem(result.data?.item || result.data), error: null, message: "" }
    },
    async sendOrderToProduction(orderId) {
      const payload = { orderId }
      const result = await runStationPosIdempotentRpc("send_to_production", payload, (idempotencyKey) =>
        supabase.rpc("send_station_pos_order_to_production", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      afterTerminal("send_to_production", result)
      return { data: result.data, error: null, message: "" }
    },
    async requestOrderBill(orderId) {
      const payload = { orderId }
      const result = await runStationPosIdempotentRpc("request_bill", payload, (idempotencyKey) =>
        supabase.rpc("request_station_pos_order_bill", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      return fetchOrderWithItemsTracked(orderId)
    },
    async sendOrderToCashier(orderId) {
      const payload = { orderId }
      const result = await runStationPosIdempotentRpc("send_to_cashier", payload, (idempotencyKey) =>
        supabase.rpc("send_station_pos_order_to_cashier", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        return { data: null, error: result.error, message: formatSupabaseError(result.error), idempotencyUnknown: result.idempotencyUnknown }
      }
      afterTerminal("send_to_cashier", result)
      return fetchOrderWithItemsTracked(orderId)
    },
    async releasePosTableService(orderId, reason) {
      const payload = { orderId, reason: String(reason || "").trim() }
      const result = await runStationPosIdempotentRpc("release_table", payload, (idempotencyKey) =>
        supabase.rpc("release_station_pos_table_service", {
          p_operator_session_token: token,
          p_order_id: orderId,
          p_reason: payload.reason,
          p_idempotency_key: idempotencyKey
        })
      )
      if (result.error) {
        const mapped = mapPosTableServiceError(result.error)
        return { data: null, error: result.error, message: mapped.userMessage || mapped.message, idempotencyUnknown: result.idempotencyUnknown }
      }
      afterTerminal("release_table", result)
      return { data: result.data, error: null, message: "" }
    },
    async lockOperator(reason) {
      const { error } = await supabase.rpc("station_pos_lock_operator_session", {
        p_operator_session_token: token,
        p_reason: reason || "manual_lock"
      })
      if (!error) onOperatorLocked?.(reason || "manual_lock")
      return { error }
    },
    exposesHumanPaymentApis: false
  }
}

/** Adapter shape for posOrdersFacade — maps human posOrdersService names to station port. */
export function createStationPosOrdersFacadeAdapter(port) {
  if (typeof port.fetchFloorLayout !== "function") {
    throw new Error("Station POS port must expose fetchFloorLayout")
  }
  return {
    fetchFloorLayout: () => port.fetchFloorLayout(),
    openPosTableService: (params) => port.openPosTableService(params),
    getOpenOrderByTable: (tableId) => port.getOpenOrderByTable(tableId),
    getActiveOrdersForTables: (ids) => port.getActiveOrdersForTables(ids),
    getOrderWithItems: (id) => port.getOrderWithItems(id),
    getTableOrderHistory: (id) => port.getTableOrderHistory(id),
    getTableOrderEvents: (id) => port.getTableOrderEvents(id),
    getOrderEvents: (id) => port.getOrderEvents(id),
    addItemToOrder: (...args) => port.addItemToOrder(...args),
    clearDraftItems: (...args) => port.clearDraftItems(...args),
    removeOrderItem: (...args) => port.removeOrderItem(...args),
    updateOrderItemQuantity: (...args) => port.updateOrderItemQuantity(...args),
    updateOrderItemNotes: (...args) => port.updateOrderItemNotes(...args),
    sendOrderToProduction: (...args) => port.sendOrderToProduction(...args),
    requestOrderBill: (...args) => port.requestOrderBill(...args),
    sendOrderToCashier: (...args) => port.sendOrderToCashier(...args),
    releasePosTableService: (...args) => port.releasePosTableService(...args),
    createOrGetOpenOrder: () =>
      Promise.resolve({
        data: null,
        error: new Error("Usa openPosTableService en estación POS."),
        message: "Operación no disponible en estación."
      }),
    clearLegacyPOSOrders: () => Promise.resolve({ data: null, error: null }),
    createPosRpcIdempotencyKey: () => crypto.randomUUID(),
    recordOrderEvent: () =>
      Promise.resolve({ error: new Error("Eventos vía wrappers de estación solamente.") }),
    updateOrderSalesChannel: () =>
      Promise.resolve({ error: new Error("Canal fijo dine_in en estación POS.") }),
    markOrderItemServed: () =>
      Promise.resolve({ error: new Error("Marcar servido no disponible en estación POS.") })
  }
}
