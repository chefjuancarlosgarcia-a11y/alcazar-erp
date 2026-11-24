const PENDING_STATUSES = new Set(["sent_to_cashier", "partially_paid"])

function money(amount) {
  return Math.round((Number(amount) || 0) * 100) / 100
}

function cashierItems(order) {
  return (order?.items || [])
    .filter((item) => item && item.status !== "cancelled")
    .map((item) => ({
      lineId: item.lineId || item.id,
      id: item.productId || item.product_id || item.id,
      nombre: item.nombre || item.productName || item.product_name || "Producto",
      cantidad: Number(item.cantidad ?? item.quantity ?? 0),
      precio: Number(item.precio ?? item.unitPrice ?? item.unit_price ?? 0),
      quantity_paid: Number(item.quantity_paid || 0),
      status: item.status || "served"
    }))
}

function firstRelation(value) {
  if (Array.isArray(value)) return value[0] || {}
  return value || {}
}

function deliveryFromOrder(order, channel) {
  if (channel !== "delivery") return null
  const customer = firstRelation(order.customer)
  const address = firstRelation(order.customer_address || order.customerAddress)
  return {
    customerName: customer.full_name || customer.fullName || "",
    email: customer.email || "",
    phone: customer.phone || "",
    whatsapp: customer.whatsapp || "",
    nit: customer.tax_id || customer.taxId || "",
    address: address.address || "",
    address2: address.notes || "",
    reference: address.reference || "",
    mapsLink: address.google_maps_url || address.googleMapsUrl || "",
    paymentMethod: "",
    deliveryNotes: order.delivery_notes || order.deliveryNotes || "",
    deliveryStatus: order.delivery_status || order.deliveryStatus || "pending"
  }
}

function tableLabel(order, channel, delivery) {
  if (channel === "delivery") return `Delivery - ${delivery?.customerName || "Cliente"}`
  if (channel === "takeout") return order.table_name || order.tableName || "Para llevar"
  return order.table_name || order.tableName || "Mesa"
}

export function preBillFromSupabaseOrder(order) {
  if (!order?.id) return null
  const channel = String(order.salesChannel || order.sales_channel || "dine_in").trim() || "dine_in"
  const items = cashierItems(order)
  const subtotal = money(items.reduce((sum, item) => sum + (item.precio * item.cantidad), 0))
  const balanceDue = money(items.reduce((sum, item) => {
    const remaining = Math.max(0, item.cantidad - item.quantity_paid)
    return sum + (remaining * item.precio)
  }, 0))
  const delivery = deliveryFromOrder(order, channel)
  const status = PENDING_STATUSES.has(order.status) ? order.status : "sent_to_cashier"
  return {
    id: `remote-${order.id}`,
    orderId: order.id,
    tableId: order.tableId || order.table_id || "",
    tableName: tableLabel(order, channel, delivery),
    waiterId: order.waiterId || order.waiter_id || "",
    waiterName: order.waiter_name || order.usuarioNombre || order.waiterName || "POS",
    items,
    subtotal,
    discounts: 0,
    taxes: 0,
    tipSuggested: money(subtotal * 0.1),
    total: subtotal,
    balanceDue: status === "partially_paid" ? balanceDue : subtotal,
    status,
    peopleCount: "",
    salesChannel: channel,
    delivery,
    deliveryNotes: order.delivery_notes || order.deliveryNotes || "",
    source: "supabase_pos",
    createdAt: order.created_at || order.createdAt || new Date().toISOString(),
    sentAt: order.updated_at || order.updatedAt || order.created_at || order.createdAt || "",
    printedAt: "",
    remote: true
  }
}

function preferDelivery(localDelivery, remoteDelivery) {
  if (!localDelivery && !remoteDelivery) return null
  return {
    ...(remoteDelivery || {}),
    ...(localDelivery || {}),
    customerName: localDelivery?.customerName || remoteDelivery?.customerName || "",
    phone: localDelivery?.phone || remoteDelivery?.phone || "",
    address: localDelivery?.address || remoteDelivery?.address || "",
    paymentMethod: localDelivery?.paymentMethod || remoteDelivery?.paymentMethod || "",
    deliveryNotes: localDelivery?.deliveryNotes || remoteDelivery?.deliveryNotes || ""
  }
}

export function mergePendingPreBills(localBills = [], remoteOrders = [], { remoteAvailable = false } = {}) {
  const localPending = (localBills || []).filter((bill) => PENDING_STATUSES.has(bill.status))
  if (!remoteAvailable) return localPending

  const remoteBills = (remoteOrders || []).map(preBillFromSupabaseOrder).filter(Boolean)
  const seen = new Set()
  const merged = []

  remoteBills.forEach((remote) => {
    const orderId = String(remote.orderId)
    if (seen.has(orderId)) return
    seen.add(orderId)
    const local = localPending.find((bill) => String(bill.orderId) === orderId)
    if (!local) {
      merged.push(remote)
      return
    }
    merged.push({
      ...remote,
      id: local.id,
      billingCustomer: local.billingCustomer || null,
      peopleCount: local.peopleCount || "",
      discounts: Number(local.discounts || 0),
      tipSuggested: local.tipSuggested ?? remote.tipSuggested,
      delivery: preferDelivery(local.delivery, remote.delivery),
      printedAt: local.printedAt || "",
      problem: local.problem || false,
      problemReason: local.problemReason || ""
    })
  })

  localPending.forEach((local) => {
    if (seen.has(String(local.orderId))) return
    if (local.source === "supabase_pos") return
    merged.push(local)
  })

  return merged
}

export function reconcileStoredPreBills(storedBills = [], mergedPending = []) {
  const pendingOrderIds = new Set(mergedPending.map((bill) => String(bill.orderId)))
  const kept = (storedBills || []).filter((bill) => {
    const pending = PENDING_STATUSES.has(bill.status)
    if (!pending) return true
    if (pendingOrderIds.has(String(bill.orderId))) return false
    if (bill.source === "supabase_pos") return false
    return true
  })
  return [...mergedPending, ...kept]
}
