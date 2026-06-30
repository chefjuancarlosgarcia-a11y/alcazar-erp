import { supabase } from "../lib/supabase"

function mapPurchaseOrderRow(order) {
  if (!order) return order
  const payload = order.data && typeof order.data === "object" ? order.data : {}
  return {
    ...payload,
    id: payload.id ?? order.id,
    status: payload.status ?? order.status,
    numeroOrden: payload.numeroOrden ?? order.order_number,
    is_test: Boolean(order.is_test ?? payload.is_test)
  }
}

export async function getPurchaseOrders(filters = {}) {
  let query = supabase
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
  if (filters.testFlowFilter === "real") query = query.eq("is_test", false)
  else if (filters.testFlowFilter === "test") query = query.eq("is_test", true)
  const { data, error } = await query
  return { data: (data || []).map(mapPurchaseOrderRow), error }
}

export function savePurchaseOrder(order) {
  return supabase.rpc("save_purchase_order", {
    p_data: {
      ...order,
      is_test: Boolean(order?.is_test ?? order?.isTest)
    }
  })
}

export async function receivePurchaseOrderLines(purchaseOrderId, supplierName, lines, invoice = {}) {
  const { data, error } = await supabase.rpc("receive_purchase_order_lines", {
    p_purchase_order_id: purchaseOrderId,
    p_supplier_name: supplierName,
    p_lines: lines,
    p_invoice: invoice
  })
  return { data, error }
}

export async function getPurchaseOrderReceivingProgress(purchaseOrderId) {
  const { data, error } = await supabase.rpc("get_purchase_order_receiving_progress", {
    p_purchase_order_id: purchaseOrderId
  })
  return { data, error }
}
