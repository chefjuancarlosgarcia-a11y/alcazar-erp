import * as human from "./posOrdersService"

let stationDelegate = null
let stationDelegateEpoch = 0

export function setStationPosOrdersDelegate(delegate) {
  stationDelegateEpoch += 1
  const epoch = stationDelegateEpoch
  stationDelegate = delegate
  return () => {
    if (stationDelegateEpoch === epoch) {
      stationDelegate = null
    }
  }
}

export function clearStationPosOrdersDelegate() {
  stationDelegateEpoch += 1
  stationDelegate = null
}

export function getStationPosOrdersDelegate() {
  return stationDelegate
}

function call(name, ...args) {
  if (stationDelegate?.[name]) {
    return stationDelegate[name](...args)
  }
  if (typeof human[name] === "function") {
    return human[name](...args)
  }
  throw new Error(`POS orders API missing: ${name}`)
}

export const addItemToOrder = (...args) => call("addItemToOrder", ...args)
export const clearDraftItems = (...args) => call("clearDraftItems", ...args)
export const clearLegacyPOSOrders = (...args) => call("clearLegacyPOSOrders", ...args)
export const createOrGetOpenOrder = (...args) => call("createOrGetOpenOrder", ...args)
export const createPosRpcIdempotencyKey = (...args) => call("createPosRpcIdempotencyKey", ...args)
export const getActiveOrdersForTables = (...args) => call("getActiveOrdersForTables", ...args)
export const getOpenOrderByTable = (...args) => call("getOpenOrderByTable", ...args)
export const getTableOrderEvents = (...args) => call("getTableOrderEvents", ...args)
export const getOrderWithItems = (...args) => call("getOrderWithItems", ...args)
export const getTableOrderHistory = (...args) => call("getTableOrderHistory", ...args)
export const markOrderItemServed = (...args) => call("markOrderItemServed", ...args)
export const openPosTableService = (...args) => call("openPosTableService", ...args)
export const releasePosTableService = (...args) => call("releasePosTableService", ...args)
export const removeOrderItem = (...args) => call("removeOrderItem", ...args)
export const recordOrderEvent = (...args) => call("recordOrderEvent", ...args)
export const requestOrderBill = (...args) => call("requestOrderBill", ...args)
export const sendOrderToCashier = (...args) => call("sendOrderToCashier", ...args)
export const sendOrderToProduction = (...args) => call("sendOrderToProduction", ...args)
export const updateOrderSalesChannel = (...args) => call("updateOrderSalesChannel", ...args)
export const updateOrderItemNotes = (...args) => call("updateOrderItemNotes", ...args)
export const updateOrderItemQuantity = (...args) => call("updateOrderItemQuantity", ...args)
