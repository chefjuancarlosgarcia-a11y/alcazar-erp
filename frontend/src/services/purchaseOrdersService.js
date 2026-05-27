import { supabase } from "../lib/supabase"

export async function getPurchaseOrders() {
  const { data, error } = await supabase
    .from("purchase_orders")
    .select("*")
    .order("created_at", { ascending: false })
  return { data: (data || []).map((order) => order.data), error }
}

export function savePurchaseOrder(order) {
  return supabase.rpc("save_purchase_order", { p_data: order })
}
