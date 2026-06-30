import { operationalOnly } from "../../utils/testFlowMode"
import {
  filterOrdersForWorkflowView,
  getPurchaseOrderWorkflowView,
  PO_WORKFLOW_VIEWS
} from "../../utils/inventoryNotificationRoutes"

export function getPurchaseOrderStatusLabel(status) {
  const labels = {
    borrador: "Borrador",
    pendiente: "Pendiente de aprobación",
    pendiente_aprobacion: "Pendiente de aprobación",
    aprobada: "Aprobada",
    rechazada: "Rechazada",
    enviada_proveedor: "Enviada a proveedor",
    "en tránsito": "Enviada a proveedor",
    parcialCompletada: "Recibida parcial",
    recibida_parcial: "Recibida parcial",
    recibida: "Recibida completa",
    recibida_completa: "Recibida completa",
    cancelada: "Cancelada"
  }
  return labels[status] || status
}

export function getPurchaseOrderStatusBadgeClass(status) {
  const normalized = String(status || "").toLowerCase()
  if (["pendiente", "pendiente_aprobacion", "borrador"].includes(normalized)) {
    return "po-badge po-badge--pending"
  }
  if (normalized === "aprobada") return "po-badge po-badge--approved"
  if (["enviada_proveedor", "en tránsito"].includes(normalized)) {
    return "po-badge po-badge--sent"
  }
  if (["recibida_completa", "recibida"].includes(normalized)) {
    return "po-badge po-badge--received"
  }
  if (["recibida_parcial", "parcialcompletada"].includes(normalized)) {
    return "po-badge po-badge--partial"
  }
  if (["cancelada", "rechazada"].includes(normalized)) {
    return "po-badge po-badge--cancelled"
  }
  return "po-badge po-badge--muted"
}

export function getPurchaseProductDetails(item) {
  const unitPurchase = item?.unidadCompra || item?.purchase_unit || "Unidad/Pieza"
  const unitBase = item?.unidadBase || item?.base_unit || item?.unidad || unitPurchase
  const factorValue = Number(item?.unidadesPorEmpaque ?? item?.conversion_factor ?? 1)
  const priceValue = Number(item?.precioCompra ?? item?.purchase_price ?? item?.costoUnitario ?? 0)

  return {
    productoId: item?.id,
    nombre: item?.nombre || item?.name || "",
    sku: item?.codigo || item?.sku || item?.codigoBarras || "",
    barcode: item?.barcode || "",
    categoria: item?.categoria || item?.category || "Sin categoria",
    unidadCompra: unitPurchase,
    unidadBase: unitBase,
    factorConversion: factorValue > 0 ? factorValue : 1,
    precioCompra: priceValue >= 0 ? priceValue : 0,
    proveedor: item?.proveedorNombre || item?.supplier || ""
  }
}

export function mapPurchaseInventoryItem(item) {
  const stockByLocation = item?.stockByLocation || item?.stockByArea || {}
  const minimumStockByLocation = item?.minimumStockByLocation || item?.minimumByArea || {}
  const totalStock = Number(
    item?.totalUnidades ?? item?.stockActual ?? item?.totalQuantity ??
    Object.values(stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)
  )
  const purchaseUnit = item?.purchase_unit || item?.unidadCompra || item?.base_unit || item?.unidad || "Unidad/Pieza"
  const baseUnit = item?.base_unit || item?.unidadBase || item?.unidad || purchaseUnit
  const purchasePrice = Number(item?.purchase_price ?? item?.precioCompra ?? item?.costoUnitario ?? item?.cost_per_base_unit ?? 0)

  return {
    ...item,
    nombre: item?.name || item?.nombre || "",
    codigo: item?.sku || item?.codigo || item?.codigoBarras || "",
    sku: item?.sku || item?.codigo || "",
    barcode: item?.barcode || "",
    categoria: item?.category || item?.categoria || "Sin categoria",
    unidadCompra: purchaseUnit,
    unidadBase: baseUnit,
    unidadesPorEmpaque: Number(item?.conversion_factor ?? item?.unidadesPorEmpaque ?? 1) || 1,
    precioCompra: purchasePrice >= 0 ? purchasePrice : 0,
    costoUnitario: purchasePrice >= 0 ? purchasePrice : 0,
    proveedorNombre: item?.supplier || item?.proveedorNombre || "",
    imagen: item?.image_url || item?.imagen || "",
    stockByLocation,
    minimumStockByLocation,
    stockActual: totalStock,
    totalUnidades: totalStock
  }
}

export function getPurchaseSearchScore(item, searchText) {
  const text = String(searchText || "").trim().toLowerCase()
  if (text.length < 2) return 0

  const fields = {
    name: String(item?.nombre || item?.name || "").toLowerCase(),
    code: String(item?.codigo || item?.sku || item?.codigoBarras || "").toLowerCase(),
    barcode: String(item?.barcode || "").toLowerCase(),
    category: String(item?.categoria || item?.category || "").toLowerCase(),
    supplier: String(item?.proveedorNombre || item?.supplier || "").toLowerCase()
  }
  let score = 0

  if (fields.name.startsWith(text)) score += 24
  if (fields.code.startsWith(text)) score += 20
  if (fields.barcode.startsWith(text)) score += 22
  if (fields.category.startsWith(text)) score += 10
  if (fields.name.includes(text)) score += 14
  if (fields.code.includes(text)) score += 12
  if (fields.barcode.includes(text)) score += 14
  if (fields.category.includes(text)) score += 6
  if (fields.supplier.includes(text)) score += 4

  text.split(" ").filter(Boolean).forEach((word) => {
    if (fields.name.includes(word)) score += 4
    if (fields.code.includes(word)) score += 3
    if (fields.barcode.includes(word)) score += 4
    if (fields.category.includes(word)) score += 2
    if (fields.supplier.includes(word)) score += 1
  })

  return score
}

export function getProductInitials(item) {
  const name = String(item?.nombre || item?.name || "?").trim()
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "?"
}

export function filterManualIngredientSuggestions(inventorySource, searchText) {
  const text = String(searchText || "").trim()
  if (text.length < 2) return []

  return inventorySource
    .map((ingrediente) => ({
      ingrediente,
      score: getPurchaseSearchScore(ingrediente, text)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => item.ingrediente)
}

const PENDING_STATUSES = new Set(["pendiente", "pendiente_aprobacion", "borrador"])
const TO_SEND_STATUSES = new Set(["aprobada"])
const RECEPTION_STATUSES = new Set(["enviada_proveedor", "en tránsito", "recibida_parcial", "parcialcompletada"])
const RECEIVED_STATUSES = new Set(["recibida", "recibida_completa", "recibida_parcial", "parcialCompletada"])

export function computePurchaseOrderMetrics(ordenesCompraManual = [], ordenCompra = [], totalOrdenCompra = 0) {
  const operationalOrders = operationalOnly(ordenesCompraManual)
  const pendingCount = operationalOrders.filter((orden) => PENDING_STATUSES.has(orden.status)).length
  const toSendCount = operationalOrders.filter((orden) => TO_SEND_STATUSES.has(orden.status)).length
  const receptionCount = operationalOrders.filter((orden) => RECEPTION_STATUSES.has(String(orden.status || "").toLowerCase())).length
  const receivedCount = operationalOrders.filter((orden) => RECEIVED_STATUSES.has(orden.status)).length
  const supplierNames = new Set(
    operationalOrders
      .map((orden) => String(orden?.proveedor?.nombre || "").trim())
      .filter(Boolean)
  )
  const manualEstimatedTotal = operationalOrders.reduce((sum, orden) => {
    const items = Array.isArray(orden.items) ? orden.items : []
    const orderTotal = items.reduce(
      (itemSum, item) => itemSum + Number(item.subtotal ?? Number(item.costoUnitario || 0) * Number(item.cantidadComprar || item.cantidad_compra || 0)),
      0
    )
    return sum + orderTotal
  }, 0)
  const automaticTotal = Number(totalOrdenCompra || 0)
  const estimatedAmount = automaticTotal > 0 ? automaticTotal : manualEstimatedTotal

  return {
    pendingCount,
    toSendCount,
    receptionCount,
    receivedCount,
    supplierCount: supplierNames.size,
    estimatedAmount,
    automaticLineCount: ordenCompra.length,
    manualOrderCount: operationalOrders.length
  }
}

export function filterWorkflowOrders(orders, view, options = {}) {
  return filterOrdersForWorkflowView(orders, view, options)
}

export { getPurchaseOrderWorkflowView, PO_WORKFLOW_VIEWS }

export function filterHistoryOrders(orders, { search = "", status = "all", testFlowFilter = "real", workflowView = PO_WORKFLOW_VIEWS.HISTORY } = {}) {
  const query = String(search || "").trim().toLowerCase()
  const scopedOrders = filterOrdersForWorkflowView(orders, workflowView, { testFlowFilter })

  return scopedOrders.filter((orden) => {
    if (status !== "all" && orden.status !== status) return false
    if (!query) return true

    const haystack = [
      orden.numeroOrden,
      orden?.proveedor?.nombre,
      orden.status,
      getPurchaseOrderStatusLabel(orden.status),
      orden.requester,
      orden.approver
    ]
      .map((value) => String(value || "").toLowerCase())
      .join(" ")

    return haystack.includes(query)
  })
}

export function formatCurrency(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

export function getPurchaseOrderItemKey(item) {
  return String(item?.producto_id ?? item?.inventory_item_id ?? item?.id ?? "")
}

export function getPurchaseOrderItemOrderedQty(item) {
  return Number(item?.cantidadComprar ?? item?.cantidad_compra ?? 0)
}

export function getPurchaseOrderItemUnit(item) {
  return item?.unidadCompra || item?.unidad_compra || item?.unit || "—"
}

export function buildEmptyReceptionLines(items = []) {
  return Object.fromEntries(
    (items || []).map((item) => {
      const key = getPurchaseOrderItemKey(item)
      const defaultCost = Number(item.costoUnitario ?? item.precio_unitario_compra ?? item.purchase_price ?? 0)
      return [
        key,
        {
          entered: false,
          cantidadRecibida: "",
          unitCostPurchase: Number.isFinite(defaultCost) && defaultCost >= 0 ? String(defaultCost) : ""
        }
      ]
    })
  )
}

export function summarizeReceptionLines(items = [], lines = {}) {
  const entries = (items || [])
    .map((item) => {
      const key = getPurchaseOrderItemKey(item)
      const line = lines[key] || {}
      const cantidadPedida = getPurchaseOrderItemOrderedQty(item)
      const cantidadRecibida = Number(line.cantidadRecibida || 0)
      return {
        item,
        key,
        entered: Boolean(line.entered),
        cantidadPedida,
        cantidadRecibida
      }
    })
    .filter((entry) => entry.entered && entry.cantidadRecibida > 0)

  const allItems = items || []
  const allEntered = allItems.length > 0 && allItems.every((item) => {
    const key = getPurchaseOrderItemKey(item)
    const line = lines[key] || {}
    return line.entered && Number(line.cantidadRecibida) > 0
  })
  const allMatchOrdered = allItems.every((item) => {
    const key = getPurchaseOrderItemKey(item)
    const line = lines[key] || {}
    return line.entered && Number(line.cantidadRecibida) === getPurchaseOrderItemOrderedQty(item)
  })

  return { entries, allEntered, allMatchOrdered }
}
