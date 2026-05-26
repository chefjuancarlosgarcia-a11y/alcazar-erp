const INVENTORY_KEY = "ingredientes"
const INVENTORY_BACKUP_KEY = "ingredientesBackup"
const MOVEMENTS_KEY = "inventoryMovements"
const ORDERS_KEY = "posOrdenes"
const RECIPES_KEY = "recetas"
const TICKETS_KEY = "productionTickets"
const ALERTS_KEY = "inventoryAlerts"
const REQUISITIONS_KEY = "requisiciones"

const AREA_NAMES = {
  almacen: "Almacén",
  cocina: "Cocina",
  pizzeria: "Pizzería",
  barra: "Barra",
  cafeteria: "Cafetería",
  reposteria: "Repostería",
  panaderia: "Panadería",
  limpieza: "Limpieza"
}

function parseArray(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function nextId(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

export function normalizeProductionArea(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function getProductionAreaName(areaId) {
  return AREA_NAMES[normalizeProductionArea(areaId)] || areaId || "Área operativa"
}

function normalizeUnit(unit) {
  const normalized = String(unit || "").trim().toLowerCase()
  const map = {
    gramos: "g", gramo: "g", g: "g",
    kilogramos: "kg", kilogramo: "kg", kg: "kg",
    libras: "lb", libra: "lb", lb: "lb",
    onzas: "oz", onza: "oz", oz: "oz",
    mililitros: "ml", mililitro: "ml", ml: "ml",
    litros: "l", litro: "l", l: "l",
    unidad: "unidad", unidades: "unidad"
  }
  return map[normalized] || normalized || "unidad"
}

function conversionFactor(unit) {
  return {
    g: { group: "weight", factor: 1 },
    kg: { group: "weight", factor: 1000 },
    lb: { group: "weight", factor: 453.592 },
    oz: { group: "weight", factor: 28.3495 },
    ml: { group: "volume", factor: 1 },
    l: { group: "volume", factor: 1000 },
    unidad: { group: "unit", factor: 1 }
  }[normalizeUnit(unit)]
}

function convertQuantity(quantity, sourceUnit, targetUnit) {
  const from = conversionFactor(sourceUnit)
  const to = conversionFactor(targetUnit)
  if (!from || !to || from.group !== to.group) return Number(quantity) || 0
  return ((Number(quantity) || 0) * from.factor) / to.factor
}

function roundQuantity(quantity) {
  return Math.round((Number(quantity) || 0) * 10000) / 10000
}

export function loadStandardRecipes() {
  return parseArray(RECIPES_KEY).map((recipe) => ({
    ...recipe,
    id: recipe.id,
    name: recipe.name || recipe.nombre,
    type: recipe.type || (recipe.tipo === "Receta Final" ? "final" : "prep"),
    productionAreaId: recipe.productionAreaId || normalizeProductionArea(recipe.areaEncargada),
    active: recipe.active !== false
  }))
}

export function calculateRecipeConsumption(recipe, quantitySold) {
  const grouped = new Map()
  ;(recipe?.ingredients || recipe?.ingredientes || []).forEach((ingredient) => {
    const itemId = ingredient.itemId ?? ingredient.ingredienteId ?? ingredient.id
    const itemName = ingredient.itemName || ingredient.nombre || ingredient.name || "Ingrediente"
    const unit = normalizeUnit(ingredient.unit || ingredient.unidad)
    const key = `${itemId || itemName}:${unit}`
    const requiredQuantity = (Number(ingredient.quantity ?? ingredient.cantidad ?? 0) || 0) * (Number(quantitySold) || 0)
    const current = grouped.get(key)
    grouped.set(key, current
      ? { ...current, requiredQuantity: roundQuantity(current.requiredQuantity + requiredQuantity) }
      : { itemId, itemName, requiredQuantity: roundQuantity(requiredQuantity), unit, productionAreaId: recipe.productionAreaId })
  })
  return [...grouped.values()]
}

export function validateAreaStock(consumptionItems, productionAreaId, inventory) {
  const areaId = normalizeProductionArea(productionAreaId)
  const errors = []
  const normalizedConsumption = consumptionItems.map((consumption) => {
    const item = inventory.find((inventoryItem) => String(inventoryItem.id) === String(consumption.itemId)) ||
      inventory.find((inventoryItem) => String(inventoryItem.nombre || "").toLowerCase() === String(consumption.itemName).toLowerCase())
    const inventoryUnit = normalizeUnit(item?.unidadCompra || consumption.unit)
    const required = roundQuantity(convertQuantity(consumption.requiredQuantity, consumption.unit, inventoryUnit))
    const available = roundQuantity(Number(item?.stockByLocation?.[areaId] ?? 0))
    if (!item || available < required) {
      errors.push({
        itemId: consumption.itemId,
        itemName: consumption.itemName,
        available,
        required,
        unit: inventoryUnit,
        areaName: getProductionAreaName(areaId),
        areaId
      })
    }
    return { ...consumption, itemId: item?.id ?? consumption.itemId, requiredQuantity: required, unit: inventoryUnit }
  })
  return { valid: errors.length === 0, errors, consumptionItems: normalizedConsumption }
}

export function consumeInventoryFromArea(consumptionItems, productionAreaId, source) {
  const areaId = normalizeProductionArea(productionAreaId)
  const inventory = parseArray(INVENTORY_KEY)
  const movements = parseArray(MOVEMENTS_KEY)
  const createdMovements = []
  const updated = inventory.map((item) => {
    const consumption = consumptionItems.find((entry) => String(entry.itemId) === String(item.id))
    if (!consumption) return item
    const previousStock = Number(item.stockByLocation?.[areaId] ?? 0)
    const newStock = roundQuantity(previousStock - consumption.requiredQuantity)
    createdMovements.push({
      id: nextId("movement"),
      date: new Date().toISOString(),
      type: "consumption",
      source: "pos_order",
      sourceId: source.orderId,
      orderItemId: source.orderItemId,
      recipeId: source.recipeId,
      itemId: item.id,
      itemName: item.nombre || consumption.itemName,
      fromLocation: areaId,
      toLocation: null,
      quantity: consumption.requiredQuantity,
      unit: consumption.unit,
      previousStock,
      newStock,
      previousStockFrom: previousStock,
      newStockFrom: newStock,
      previousStockTo: 0,
      newStockTo: 0,
      performedBy: source.performedBy,
      notes: "Consumo por comanda POS"
    })
    return {
      ...item,
      stockByLocation: { ...(item.stockByLocation || {}), [areaId]: newStock },
      stockActual: Object.entries({ ...(item.stockByLocation || {}), [areaId]: newStock }).reduce((total, [, quantity]) => total + Number(quantity || 0), 0),
      totalUnidades: Object.entries({ ...(item.stockByLocation || {}), [areaId]: newStock }).reduce((total, [, quantity]) => total + Number(quantity || 0), 0),
      ultimaEdicion: new Date().toLocaleString()
    }
  })
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(updated))
  localStorage.setItem(INVENTORY_BACKUP_KEY, JSON.stringify(updated))
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify([...createdMovements, ...movements]))
  createLowStockAlerts(updated, createdMovements, areaId)
  window.dispatchEvent(new Event("inventory-updated"))
  return { inventory: updated, movements: createdMovements }
}

function createLowStockAlerts(inventory, movements, areaId) {
  const alerts = parseArray(ALERTS_KEY)
  movements.forEach((movement) => {
    const item = inventory.find((entry) => String(entry.id) === String(movement.itemId))
    const minimum = Number(item?.minimumStockByLocation?.[areaId] ?? 0)
    if (minimum > 0 && movement.newStock <= minimum) {
      alerts.unshift({
        id: nextId("alert"),
        type: "low_stock_area",
        areaId,
        itemId: movement.itemId,
        itemName: movement.itemName,
        currentStock: movement.newStock,
        minimumStock: minimum,
        source: "pos_order",
        createdAt: new Date().toISOString()
      })
    }
  })
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts))
}

function createInsufficientStockAlerts(errors, orderId) {
  const alerts = parseArray(ALERTS_KEY)
  errors.forEach((error) => alerts.unshift({
    id: nextId("alert"),
    type: "insufficient_area_stock",
    areaId: error.areaId,
    itemId: error.itemId,
    itemName: error.itemName,
    required: error.required,
    available: error.available,
    source: "pos_order",
    sourceId: orderId,
    createdAt: new Date().toISOString()
  }))
  localStorage.setItem(ALERTS_KEY, JSON.stringify(alerts))
}

function makeProductionTickets(order, sentItems) {
  const byArea = new Map()
  sentItems.forEach((item) => {
    const areaId = normalizeProductionArea(item.productionAreaId || item.areaProduccion)
    byArea.set(areaId, [...(byArea.get(areaId) || []), item])
  })
  return [...byArea.entries()].map(([areaId, items]) => ({
    id: nextId("ticket"),
    orderId: order.id,
    tableId: order.mesaId,
    tableName: order.mesa ? `Mesa ${order.mesa}` : order.tipoOrden || "Orden",
    areaId,
    areaName: getProductionAreaName(areaId),
    waiterId: order.usuario || "",
    waiterName: order.usuarioNombre || order.usuario || "POS",
    priority: "normal",
    items: items.map((item) => ({
      ...item,
      id: item.lineId || item.id,
      orderItemId: item.lineId || item.id,
      productId: item.id,
      productName: item.nombre,
      quantity: item.cantidad,
      notes: item.modificaciones || "",
      modifiers: item.modificaciones ? [item.modificaciones] : [],
      status: "pending"
    })),
    status: "pending",
    createdAt: new Date().toISOString(),
    startedAt: "",
    readyAt: "",
    servedAt: "",
    estimatedMinutes: Math.max(...items.map((item) => Number.parseInt(item.tiempoPreparacion, 10) || 0), 0),
    problemReason: "",
    assignedTo: "",
    completedAt: ""
  }))
}

export function finalizeSupabaseProductionOrder(orderId, orders, sentItems) {
  const order = orders.find((entry) => String(entry.id) === String(orderId))
  if (!order) return { ok: false, errors: ["No se encontró la orden."], orders, tickets: [] }
  const sentByLine = new Map(sentItems.map((item) => [String(item.lineId), item]))
  const nextItems = (order.items || []).map((item) => sentByLine.get(String(item.lineId)) || item)
  const tickets = makeProductionTickets(order, sentItems)
  const previousTickets = parseArray(TICKETS_KEY).filter((ticket) => !ticket.isDemo)
  localStorage.setItem(TICKETS_KEY, JSON.stringify([...tickets, ...previousTickets]))
  if (tickets.length) window.dispatchEvent(new Event("production-tickets-updated"))
  const nextOrder = {
    ...order,
    items: nextItems,
    status: sentItems.length ? "sent" : order.status || "open",
    estado: sentItems.length ? "en preparación" : order.estado || "abierta",
    fechaEnvioISO: sentItems.length ? new Date().toISOString() : order.fechaEnvioISO,
    horaEnviada: sentItems.length ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : order.horaEnviada,
    productionTickets: [...(order.productionTickets || []), ...tickets.map((ticket) => ticket.id)]
  }
  const nextOrders = orders.map((entry) => String(entry.id) === String(orderId) ? nextOrder : entry)
  localStorage.setItem(ORDERS_KEY, JSON.stringify(nextOrders))
  return { ok: sentItems.length > 0, errors: [], order: nextOrder, orders: nextOrders, sentItems, tickets }
}

export function sendOrderToProduction(orderId, options = {}) {
  const orders = options.orders || parseArray(ORDERS_KEY)
  const recipes = options.recipes || loadStandardRecipes()
  const inventory = options.inventory || parseArray(INVENTORY_KEY)
  const order = orders.find((entry) => String(entry.id) === String(orderId))
  if (!order) return { ok: false, errors: ["No se encontró la orden."], orders }
  const errors = []
  const sentItems = []
  let liveInventory = inventory
  const nextItems = (order.items || []).map((item) => {
    if ((item.status && item.status !== "draft") || item.inventoryConsumed === true) return item
    const recipeId = item.recipeId
    if (!recipeId) {
      errors.push({ orderItemId: item.lineId, product: item.nombre, message: "Este producto no tiene receta estandarizada conectada." })
      return item
    }
    const recipe = recipes.find((entry) => String(entry.id) === String(recipeId) && entry.active !== false)
    if (!recipe) {
      errors.push({ orderItemId: item.lineId, product: item.nombre, message: "Este producto no tiene receta estandarizada conectada." })
      return item
    }
    const productionAreaId = normalizeProductionArea(item.productionAreaId || item.areaProduccion || recipe.productionAreaId)
    if (!productionAreaId) {
      errors.push({ orderItemId: item.lineId, product: item.nombre, message: "Este producto no tiene área de producción asignada." })
      return item
    }
    const consumption = calculateRecipeConsumption({ ...recipe, productionAreaId }, item.cantidad)
    if (consumption.length === 0 || consumption.every((ingredient) => ingredient.requiredQuantity <= 0)) {
      errors.push({ orderItemId: item.lineId, product: item.nombre, message: "La receta conectada no tiene ingredientes consumibles definidos." })
      return item
    }
    const validation = validateAreaStock(consumption, productionAreaId, liveInventory)
    if (!validation.valid) {
      createInsufficientStockAlerts(validation.errors, order.id)
      validation.errors.forEach((stockError) => errors.push({
        orderItemId: item.lineId,
        product: item.nombre,
        stockError,
        message: `No hay suficiente ${stockError.itemName} en ${stockError.areaName}. Disponible: ${stockError.available} ${stockError.unit}. Requerido: ${stockError.required} ${stockError.unit}.`
      }))
      return item
    }
    const consumed = consumeInventoryFromArea(validation.consumptionItems, productionAreaId, {
      orderId: order.id,
      orderItemId: item.lineId,
      recipeId,
      performedBy: options.performedBy || "POS"
    })
    liveInventory = consumed.inventory
    const sentItem = {
      ...item,
      productionAreaId,
      areaProduccion: productionAreaId,
      status: "sent_to_production",
      enviado: true,
      inventoryConsumed: true,
      inventoryMovements: consumed.movements.map((movement) => movement.id),
      fechaEnvioISO: new Date().toISOString()
    }
    sentItems.push(sentItem)
    return sentItem
  })
  const tickets = makeProductionTickets(order, sentItems)
  const previousTickets = parseArray(TICKETS_KEY).filter((ticket) => !ticket.isDemo)
  localStorage.setItem(TICKETS_KEY, JSON.stringify([...tickets, ...previousTickets]))
  if (tickets.length) window.dispatchEvent(new Event("production-tickets-updated"))
  const nextOrder = {
    ...order,
    items: nextItems,
    status: sentItems.length ? "sent" : order.status || "open",
    estado: sentItems.length ? "en preparación" : order.estado || "abierta",
    fechaEnvioISO: sentItems.length ? new Date().toISOString() : order.fechaEnvioISO,
    horaEnviada: sentItems.length ? new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : order.horaEnviada,
    productionTickets: [...(order.productionTickets || []), ...tickets.map((ticket) => ticket.id)]
  }
  const nextOrders = orders.map((entry) => String(entry.id) === String(orderId) ? nextOrder : entry)
  localStorage.setItem(ORDERS_KEY, JSON.stringify(nextOrders))
  return { ok: sentItems.length > 0, errors, order: nextOrder, orders: nextOrders, sentItems, tickets }
}

export function reverseInventoryConsumption(orderId, orderItemId, reason, performedBy) {
  const orders = parseArray(ORDERS_KEY)
  const order = orders.find((entry) => String(entry.id) === String(orderId))
  const item = order?.items?.find((entry) => String(entry.lineId) === String(orderItemId))
  if (!item || !item.inventoryConsumed || item.inventoryReversed) return { ok: false, orders }
  const movementIds = new Set(item.inventoryMovements || [])
  const movements = parseArray(MOVEMENTS_KEY)
  const originalMovements = movements.filter((movement) => movementIds.has(movement.id) && movement.type === "consumption")
  let inventory = parseArray(INVENTORY_KEY)
  const reversals = []
  originalMovements.forEach((movement) => {
    inventory = inventory.map((inventoryItem) => {
      if (String(inventoryItem.id) !== String(movement.itemId)) return inventoryItem
      const location = movement.fromLocation
      const previousStock = Number(inventoryItem.stockByLocation?.[location] ?? 0)
      const newStock = roundQuantity(previousStock + Number(movement.quantity || 0))
      reversals.push({
        id: nextId("movement"),
        date: new Date().toISOString(),
        type: "reversal",
        source: "pos_order_cancelled",
        sourceId: orderId,
        orderItemId,
        itemId: inventoryItem.id,
        itemName: inventoryItem.nombre,
        location,
        quantity: movement.quantity,
        unit: movement.unit,
        previousStock,
        newStock,
        previousStockFrom: previousStock,
        newStockFrom: newStock,
        previousStockTo: 0,
        newStockTo: 0,
        performedBy,
        reason
      })
      const stockByLocation = { ...(inventoryItem.stockByLocation || {}), [location]: newStock }
      const total = Object.values(stockByLocation).reduce((sum, quantity) => sum + Number(quantity || 0), 0)
      return { ...inventoryItem, stockByLocation, stockActual: total, totalUnidades: total, ultimaEdicion: new Date().toLocaleString() }
    })
  })
  const updatedOrders = orders.map((entry) => String(entry.id) !== String(orderId) ? entry : ({
    ...entry,
    items: entry.items.map((orderItem) => String(orderItem.lineId) !== String(orderItemId) ? orderItem : ({ ...orderItem, status: "cancelled", inventoryReversed: true, reversalReason: reason }))
  }))
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory))
  localStorage.setItem(INVENTORY_BACKUP_KEY, JSON.stringify(inventory))
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify([...reversals, ...movements]))
  localStorage.setItem(ORDERS_KEY, JSON.stringify(updatedOrders))
  window.dispatchEvent(new Event("inventory-updated"))
  return { ok: true, orders: updatedOrders, movements: reversals }
}

export function recordWasteForCancelledItem(orderId, orderItemId, reason, performedBy) {
  const orders = parseArray(ORDERS_KEY)
  const movements = parseArray(MOVEMENTS_KEY)
  const order = orders.find((entry) => String(entry.id) === String(orderId))
  const item = order?.items?.find((entry) => String(entry.lineId) === String(orderItemId))
  if (!item) return { ok: false, orders }
  const wasteMovement = {
    id: nextId("movement"),
    date: new Date().toISOString(),
    type: "waste",
    source: "pos_order_cancelled",
    sourceId: orderId,
    orderItemId,
    quantity: item.cantidad,
    unit: "producto",
    previousStockFrom: 0,
    newStockFrom: 0,
    previousStockTo: 0,
    newStockTo: 0,
    performedBy,
    reason,
    notes: "Cancelación sin reversión: producto ya preparado o comprometido"
  }
  const updatedOrders = orders.map((entry) => String(entry.id) !== String(orderId) ? entry : ({
    ...entry,
    items: entry.items.map((orderItem) => String(orderItem.lineId) !== String(orderItemId) ? orderItem : ({ ...orderItem, status: "cancelled", cancellationReason: reason, inventoryReversed: false }))
  }))
  localStorage.setItem(MOVEMENTS_KEY, JSON.stringify([wasteMovement, ...movements]))
  localStorage.setItem(ORDERS_KEY, JSON.stringify(updatedOrders))
  return { ok: true, orders: updatedOrders }
}

export function createStockRequisition(stockError, user) {
  const requisitions = parseArray(REQUISITIONS_KEY)
  const suggestedQuantity = roundQuantity(Math.max(stockError.required - stockError.available, stockError.required))
  const now = new Date()
  const requisition = {
    id: now.getTime(),
    fromLocation: "almacen",
    toLocation: stockError.areaId,
    requestedBy: user?.name || user?.username || "POS",
    username: user?.username || "",
    date: now.toISOString().slice(0, 10),
    fechaSolicitud: now.toISOString().slice(0, 10),
    fechaNecesita: now.toISOString().slice(0, 10),
    status: "pending",
    source: "pos_order",
    items: [{
      itemId: stockError.itemId,
      itemName: stockError.itemName,
      unit: stockError.unit,
      requestedQty: suggestedQuantity,
      approvedQty: suggestedQuantity,
      notes: "Sugerida por faltante al enviar comanda POS"
    }],
    createdAt: now.toISOString()
  }
  localStorage.setItem(REQUISITIONS_KEY, JSON.stringify([requisition, ...requisitions]))
  return requisition
}
