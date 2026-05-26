import { supabase } from "../lib/supabase"

function number(value) {
  return Number(value || 0)
}

function message(error) {
  return typeof error === "string" ? error : error?.message || "No fue posible consultar los datos."
}

function empty(data, error = null) {
  return { data, error: error ? message(error) : "" }
}

export function getReportDateRange(filters = {}) {
  const now = new Date()
  const end = filters.end ? new Date(`${filters.end}T23:59:59.999`) : now
  let start
  if (filters.start) start = new Date(`${filters.start}T00:00:00`)
  else if (filters.preset === "yesterday") {
    start = new Date(now)
    start.setDate(start.getDate() - 1)
    start.setHours(0, 0, 0, 0)
    end.setTime(start.getTime())
    end.setHours(23, 59, 59, 999)
  } else if (filters.preset === "last7") {
    start = new Date(now)
    start.setDate(start.getDate() - 6)
    start.setHours(0, 0, 0, 0)
  } else if (filters.preset === "month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  } else {
    start = new Date(now)
    start.setHours(0, 0, 0, 0)
  }
  return { start: start.toISOString(), end: end.toISOString() }
}

function withDates(query, filters, column = "created_at") {
  const range = getReportDateRange(filters)
  return query.gte(column, range.start).lte(column, range.end)
}

function dayKey(value) {
  return new Date(value).toLocaleDateString("es-GT", { day: "2-digit", month: "short", year: "numeric" })
}

async function fetchOrders(filters = {}) {
  const query = withDates(
    supabase.from("pos_orders").select("*, items:pos_order_items(*)").neq("status", "cancelled"),
    filters
  )
  const { data, error } = await query.order("created_at", { ascending: false })
  return { data: data || [], error }
}

async function fetchProducts() {
  const { data, error } = await supabase
    .from("pos_products")
    .select("*, recipe:standard_recipes(id, name, estimated_cost, active, production_area_id)")
  return { data: data || [], error }
}

export async function getExecutiveKPIs(filters = {}) {
  const monthFilters = { preset: "month" }
  const [todayOrders, monthOrders, tickets, stock, requisitions] = await Promise.all([
    fetchOrders({ preset: "today" }),
    fetchOrders(monthFilters),
    supabase.from("production_tickets").select("id,status").not("status", "in", "(served,cancelled)"),
    supabase.from("area_inventory").select("quantity,minimum_quantity"),
    supabase.from("requisitions").select("id,status").in("status", ["draft", "pending", "approved"])
  ])
  const errors = [todayOrders.error, monthOrders.error, tickets.error, stock.error, requisitions.error].filter(Boolean)
  const ordersToday = todayOrders.data || []
  const salesToday = ordersToday.reduce((sum, order) => sum + number(order.total), 0)
  const activeTables = ordersToday.filter((order) => ["open", "awaiting_bill", "sent_to_cashier"].includes(order.status)).length
  return empty({
    salesToday,
    salesMonth: (monthOrders.data || []).reduce((sum, order) => sum + number(order.total), 0),
    ordersToday: ordersToday.length,
    averageTicket: ordersToday.length ? salesToday / ordersToday.length : 0,
    activeTables,
    activeTickets: (tickets.data || []).length,
    lowStock: (stock.data || []).filter((row) => number(row.quantity) <= number(row.minimum_quantity)).length,
    pendingRequisitions: (requisitions.data || []).length,
    range: getReportDateRange(filters)
  }, errors[0])
}

export async function getSalesReport(filters = {}) {
  const ordersResult = await fetchOrders(filters)
  if (ordersResult.error) return empty([], ordersResult.error)
  const grouped = new Map()
  ordersResult.data.forEach((order) => {
    const key = dayKey(order.created_at)
    const current = grouped.get(key) || { date: key, sales: 0, orders: 0, averageTicket: 0 }
    current.sales += number(order.total)
    current.orders += 1
    grouped.set(key, current)
  })
  return empty([...grouped.values()].map((row) => ({ ...row, averageTicket: row.orders ? row.sales / row.orders : 0 })))
}

export async function getSalesByCategory(filters = {}) {
  const [ordersResult, productsResult] = await Promise.all([fetchOrders(filters), fetchProducts()])
  if (ordersResult.error || productsResult.error) return empty([], ordersResult.error || productsResult.error)
  const products = new Map(productsResult.data.map((product) => [product.id, product]))
  const grouped = new Map()
  ordersResult.data.flatMap((order) => order.items || []).filter((item) => item.status !== "cancelled").forEach((item) => {
    const product = products.get(item.product_id)
    const category = product?.category_name || product?.category_id || "Sin categoría"
    const row = grouped.get(category) || { category, quantity: 0, sales: 0 }
    row.quantity += number(item.quantity)
    row.sales += number(item.total_price)
    grouped.set(category, row)
  })
  return empty([...grouped.values()].sort((a, b) => b.sales - a.sales))
}

export async function getTopProducts(filters = {}) {
  const ordersResult = await fetchOrders(filters)
  if (ordersResult.error) return empty([], ordersResult.error)
  const grouped = new Map()
  ordersResult.data.flatMap((order) => order.items || []).filter((item) => item.status !== "cancelled").forEach((item) => {
    const row = grouped.get(item.product_id) || { productId: item.product_id, product: item.product_name, quantity: 0, sales: 0 }
    row.quantity += number(item.quantity)
    row.sales += number(item.total_price)
    grouped.set(item.product_id, row)
  })
  return empty([...grouped.values()].sort((a, b) => b.quantity - a.quantity))
}

export async function getSalesByWaiter(filters = {}) {
  const ordersResult = await fetchOrders(filters)
  if (ordersResult.error) return empty([], ordersResult.error)
  const grouped = new Map()
  ordersResult.data.forEach((order) => {
    const waiter = order.waiter_name || "Sin asignar"
    const row = grouped.get(waiter) || { waiter, orders: 0, sales: 0, averageTicket: 0 }
    row.orders += 1
    row.sales += number(order.total)
    grouped.set(waiter, row)
  })
  return empty([...grouped.values()].map((row) => ({ ...row, averageTicket: row.orders ? row.sales / row.orders : 0 })).sort((a, b) => b.sales - a.sales))
}

export async function getProductionReport(filters = {}) {
  const { data, error } = await withDates(
    supabase.from("production_tickets").select("*, items:production_ticket_items(*)"),
    filters
  ).order("created_at", { ascending: false })
  if (error) return empty({ summary: {}, areas: [], recent: [] }, error)
  const tickets = data || []
  const now = Date.now()
  const active = tickets.filter((ticket) => !["served", "cancelled"].includes(ticket.status))
  const byArea = new Map()
  tickets.forEach((ticket) => {
    const area = ticket.area_name || ticket.area_id
    const row = byArea.get(area) || { area, tickets: 0, active: 0, minutesTotal: 0, timed: 0 }
    row.tickets += 1
    if (!["served", "cancelled"].includes(ticket.status)) row.active += 1
    if (ticket.ready_at) {
      row.minutesTotal += (new Date(ticket.ready_at) - new Date(ticket.created_at)) / 60000
      row.timed += 1
    }
    byArea.set(area, row)
  })
  return empty({
    summary: {
      pending: active.filter((row) => row.status === "pending").length,
      inProduction: active.filter((row) => row.status === "in_production").length,
      ready: active.filter((row) => row.status === "ready").length,
      late: active.filter((row) => (now - new Date(row.created_at).getTime()) / 60000 > 15).length
    },
    areas: [...byArea.values()].map((row) => ({ ...row, averageMinutes: row.timed ? Math.round(row.minutesTotal / row.timed) : 0 })),
    recent: tickets.slice(0, 30)
  })
}

export async function getInventoryReport(filters = {}) {
  const [stock, movements] = await Promise.all([
    supabase.from("area_inventory").select("*, item:inventory_items(id,name,category,base_unit), area:areas(id,name)"),
    withDates(supabase.from("inventory_movements").select("*, item:inventory_items(name), from_area:areas!inventory_movements_from_area_id_fkey(name), to_area:areas!inventory_movements_to_area_id_fkey(name)"), filters)
      .order("created_at", { ascending: false }).limit(100)
  ])
  if (stock.error || movements.error) return empty({ low: [], out: [], stock: [], movements: [], consumption: [], transfers: [] }, stock.error || movements.error)
  let stocks = stock.data || []
  if (filters.areaId) stocks = stocks.filter((row) => row.area_id === filters.areaId)
  if (filters.category) stocks = stocks.filter((row) => row.item?.category === filters.category)
  let rows = movements.data || []
  if (filters.areaId) rows = rows.filter((row) => row.from_area_id === filters.areaId || row.to_area_id === filters.areaId)
  if (filters.movementType) rows = rows.filter((row) => row.movement_type === filters.movementType)
  const consumption = new Map()
  rows.filter((row) => row.movement_type === "consumption").forEach((row) => {
    const name = row.item?.name || row.item_id
    consumption.set(name, number(consumption.get(name)) + number(row.quantity))
  })
  return empty({
    low: stocks.filter((row) => number(row.quantity) > 0 && number(row.quantity) <= number(row.minimum_quantity)),
    out: stocks.filter((row) => number(row.quantity) <= 0),
    stock: stocks,
    movements: rows,
    consumption: [...consumption].map(([item, quantity]) => ({ item, quantity })).sort((a, b) => b.quantity - a.quantity),
    transfers: rows.filter((row) => row.movement_type === "transfer")
  })
}

export async function getRequisitionReport(filters = {}) {
  const { data, error } = await withDates(
    supabase.from("requisitions").select("*, items:requisition_items(*), requester:profiles!requisitions_requested_by_fkey(full_name,username), target:areas!requisitions_to_area_id_fkey(name)"),
    filters
  ).order("created_at", { ascending: false })
  if (error) return empty({ summary: {}, byArea: [], byRequester: [], topItems: [], rows: [] }, error)
  const rows = data || []
  const areaMap = new Map()
  const requesterMap = new Map()
  const itemMap = new Map()
  rows.forEach((row) => {
    const area = row.target?.name || row.to_area_id
    areaMap.set(area, number(areaMap.get(area)) + 1)
    const requester = row.requester?.full_name || row.requester?.username || "Sin información"
    requesterMap.set(requester, number(requesterMap.get(requester)) + 1)
    ;(row.items || []).forEach((item) => {
      const current = itemMap.get(item.item_name) || 0
      itemMap.set(item.item_name, current + number(item.requested_quantity))
    })
  })
  return empty({
    summary: {
      pending: rows.filter((row) => ["draft", "pending", "approved"].includes(row.status)).length,
      completed: rows.filter((row) => row.status === "completed").length,
      rejected: rows.filter((row) => row.status === "rejected").length
    },
    byArea: [...areaMap].map(([area, count]) => ({ area, count })),
    byRequester: [...requesterMap].map(([requester, count]) => ({ requester, count })),
    topItems: [...itemMap].map(([item, quantity]) => ({ item, quantity })).sort((a, b) => b.quantity - a.quantity),
    rows
  })
}

export async function getFoodCostReport() {
  const productsResult = await fetchProducts()
  if (productsResult.error) return empty([], productsResult.error)
  const rows = productsResult.data.filter((product) => product.active && product.recipe_id).map((product) => {
    const price = number(product.price)
    const cost = number(product.recipe?.estimated_cost)
    const foodCostPercent = price ? (cost / price) * 100 : 0
    const grossMargin = price - cost
    const level = foodCostPercent <= 25 ? "excellent" : foodCostPercent <= 35 ? "acceptable" : foodCostPercent <= 45 ? "high" : "critical"
    return { productId: product.id, product: product.name, category: product.category_name || product.category_id || "Sin categoría", price, cost, foodCostPercent, grossMargin, level }
  })
  return empty(rows.sort((a, b) => b.foodCostPercent - a.foodCostPercent))
}

export async function getMenuEngineeringReport(filters = {}) {
  const [top, food] = await Promise.all([getTopProducts(filters), getFoodCostReport()])
  if (top.error || food.error) return empty([], top.error || food.error)
  const salesByProduct = new Map(top.data.map((row) => [row.productId, row]))
  const rows = food.data.map((row) => {
    const sales = salesByProduct.get(row.productId) || { quantity: 0, sales: 0 }
    return { ...row, quantity: sales.quantity, sales: sales.sales, estimatedProfit: row.grossMargin * sales.quantity }
  })
  const averageQuantity = rows.length ? rows.reduce((sum, row) => sum + row.quantity, 0) / rows.length : 0
  const averageMargin = rows.length ? rows.reduce((sum, row) => sum + row.grossMargin, 0) / rows.length : 0
  return empty(rows.map((row) => {
    const popular = row.quantity >= averageQuantity
    const profitable = row.grossMargin >= averageMargin
    const classification = popular && profitable ? "star" : popular ? "horse" : profitable ? "puzzle" : "dog"
    const recommendation = { star: "Mantener y destacar", horse: "Revisar costos o precio", puzzle: "Promocionar mejor", dog: "Evaluar rediseño o retiro" }[classification]
    return { ...row, classification, recommendation }
  }))
}

export async function getAreaPerformanceReport(filters = {}) {
  const [production, inventory, requisitions, orders, areas] = await Promise.all([
    getProductionReport(filters),
    getInventoryReport(filters),
    getRequisitionReport(filters),
    fetchOrders(filters),
    supabase.from("areas").select("id,name").eq("active", true)
  ])
  const error = production.error || inventory.error || requisitions.error || (orders.error && message(orders.error)) || (areas.error && message(areas.error))
  const ticketAreas = new Map((production.data.areas || []).map((row) => [row.area, row]))
  return empty((areas.data || []).map((area) => {
    const ticket = ticketAreas.get(area.name) || { tickets: 0, averageMinutes: 0 }
    const consumed = (inventory.data.movements || []).filter((row) => row.movement_type === "consumption" && row.from_area_id === area.id).reduce((sum, row) => sum + number(row.quantity), 0)
    const lowStock = (inventory.data.low || []).filter((row) => row.area_id === area.id).length + (inventory.data.out || []).filter((row) => row.area_id === area.id).length
    const received = (requisitions.data.rows || []).filter((row) => row.to_area_id === area.id).length
    const sales = (orders.data || []).flatMap((order) => order.items || []).filter((item) => item.production_area_id === area.id && item.status !== "cancelled").reduce((sum, item) => sum + number(item.total_price), 0)
    return { area: area.name, sales, tickets: ticket.tickets, averageMinutes: ticket.averageMinutes, consumed, requisitions: received, lowStock }
  }), error)
}

export async function getEmployeePerformanceReport(filters = {}) {
  const [sales, tickets] = await Promise.all([
    getSalesByWaiter(filters),
    withDates(supabase.from("production_tickets").select("waiter_name,status"), filters)
  ])
  if (sales.error || tickets.error) return empty([], sales.error || tickets.error)
  const ticketMap = new Map()
  ;(tickets.data || []).forEach((ticket) => ticketMap.set(ticket.waiter_name || "Sin asignar", number(ticketMap.get(ticket.waiter_name || "Sin asignar")) + 1))
  return empty(sales.data.map((row) => ({ ...row, tickets: ticketMap.get(row.waiter) || 0 })))
}

export async function getOperationalAlerts() {
  const [inventory, production, requisitions, products, recipes] = await Promise.all([
    getInventoryReport({ preset: "today" }),
    getProductionReport({ preset: "today" }),
    getRequisitionReport({ preset: "month" }),
    supabase.from("pos_products").select("name,production_ready,active,production_area_id,recipe_id").eq("active", true),
    supabase.from("standard_recipes").select("name,estimated_cost,active").eq("active", true)
  ])
  const errors = [inventory.error, production.error, requisitions.error, products.error && message(products.error), recipes.error && message(recipes.error)].filter(Boolean)
  const alerts = []
  inventory.data.out.forEach((row) => alerts.push({ priority: "critical", type: "Stock agotado", area: row.area?.name || row.area_id, detail: row.item?.name, action: "Generar requisición" }))
  inventory.data.low.forEach((row) => alerts.push({ priority: "high", type: "Stock bajo", area: row.area?.name || row.area_id, detail: row.item?.name, action: "Revisar abastecimiento" }))
  if (production.data.summary.late) alerts.push({ priority: "high", type: "KDS atrasado", area: "Producción", detail: `${production.data.summary.late} ticket(s) con más de 15 min`, action: "Revisar estación" })
  if (requisitions.data.summary.pending) alerts.push({ priority: "medium", type: "Requisiciones", area: "Inventario", detail: `${requisitions.data.summary.pending} pendiente(s)`, action: "Aprobar o completar" })
  ;(products.data || []).filter((product) => !product.production_ready || !product.recipe_id || !product.production_area_id).forEach((product) => alerts.push({ priority: "high", type: "Producto POS incompleto", area: "POS", detail: product.name, action: "Conectar receta y área" }))
  ;(recipes.data || []).filter((recipe) => number(recipe.estimated_cost) === 0).forEach((recipe) => alerts.push({ priority: "medium", type: "Receta sin costo", area: "Recetas", detail: recipe.name, action: "Actualizar ingredientes/costos" }))
  return empty(alerts, errors[0])
}
