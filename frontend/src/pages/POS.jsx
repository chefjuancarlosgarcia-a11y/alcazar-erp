import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import { createStockRequisition } from "../utils/posProduction"
import { getProductionAreas } from "../services/areasService"
import { getActiveRecipes, getPOSRecipeLink } from "../services/recipesService"
import {
  createOrUpdatePOSProductFromRecipe,
  createPOSProduct,
  deactivatePOSProduct,
  getPOSProductById,
  getPOSProducts,
  updatePOSProduct
} from "../services/posProductsService"
import { getProductionTickets } from "../services/productionTicketsService"
import {
  addItemToOrder,
  clearDraftItems,
  clearLegacyPOSOrders,
  createOrGetOpenOrder,
  getOpenOrderByTable,
  getTableOrderEvents,
  getOrderWithItems,
  getTableOrderHistory,
  markOrderItemServed,
  removeOrderItem,
  recordOrderEvent,
  requestOrderBill,
  sendOrderToCashier,
  sendOrderToProduction,
  updateOrderItemNotes,
  updateOrderItemQuantity
} from "../services/posOrdersService"
import "./POS.css"

const POS_CATEGORIES_KEY = "posCategories"
const POS_LAYOUT_KEY = "posLayout"
const DEFAULT_LAYOUT_SETTINGS = { snapToGrid: true, gridSize: 24, zoom: 1 }
const DEFAULT_POS_CATEGORIES = [
  { id: "entradas", name: "Entradas", description: "", productionAreaId: "cocina", active: true, sortOrder: 1, color: "#0ea5a4", icon: "🥗" },
  { id: "pizzas", name: "Pizzas", description: "Pizzas de la casa", productionAreaId: "pizzeria", active: true, sortOrder: 2, color: "#f97316", icon: "🍕" },
  { id: "sandwiches", name: "Sándwiches", description: "", productionAreaId: "cocina", active: true, sortOrder: 3, color: "#eab308", icon: "🍔" },
  { id: "postres", name: "Postres", description: "", productionAreaId: "reposteria", active: true, sortOrder: 4, color: "#ec4899", icon: "🍰" },
  { id: "cafeteria", name: "Cafetería", description: "", productionAreaId: "cafeteria", active: true, sortOrder: 5, color: "#14b8a6", icon: "☕" },
  { id: "barra", name: "Barra", description: "", productionAreaId: "barra", active: true, sortOrder: 6, color: "#38bdf8", icon: "🍹" },
  { id: "extras", name: "Extras", description: "", productionAreaId: "cocina", active: true, sortOrder: 7, color: "#a78bfa", icon: "🍟" }
]
const POS_ROLES = ["admin", "gerente_general", "supervisor", "mesero", "cajero"]
const CROQUIS_ROLES = ["admin", "gerente", "gerente_general", "gerente_operaciones"]
const CATEGORY_ADMIN_ROLES = ["admin", "gerente", "gerente_general", "gerente_operaciones"]
const CATEGORY_ICON_OPTIONS = [
  { icon: "🍕", label: "Pizzas" }, { icon: "🥗", label: "Entradas" }, { icon: "🍔", label: "Sándwiches" },
  { icon: "🍝", label: "Pastas" }, { icon: "🥩", label: "Platos fuertes" }, { icon: "🍰", label: "Postres" },
  { icon: "☕", label: "Cafetería" }, { icon: "🍹", label: "Barra" }, { icon: "🍺", label: "Cervezas" },
  { icon: "🍷", label: "Vinos" }, { icon: "🍦", label: "Helados" }, { icon: "🍟", label: "Extras" },
  { icon: "🔥", label: "Especiales" }, { icon: "🌱", label: "Vegetarianos" }, { icon: "🧒", label: "Niños" },
  { icon: "🧾", label: "Caja" }, { icon: "🧼", label: "Limpieza" }, { icon: "📦", label: "Productos" },
  { icon: "⭐", label: "Temporada" }
]
const CATEGORY_COLOR_OPTIONS = ["#0ea5a4", "#f97316", "#eab308", "#ec4899", "#38bdf8", "#a78bfa", "#22c55e", "#ef4444", "#64748b"]
const CATEGORY_QUICK_OPTIONS = [
  { name: "Pizzas", icon: "🍕", description: "Pizzas disponibles en el punto de venta", color: "#f97316", productionAreaId: "pizzeria" },
  { name: "Entradas", icon: "🥗", description: "Entradas y aperitivos disponibles para ordenar", color: "#22c55e", productionAreaId: "cocina" },
  { name: "Barra", icon: "🍹", description: "Bebidas, cocteles y productos preparados en barra", color: "#38bdf8", productionAreaId: "barra" },
  { name: "Cafetería", icon: "☕", description: "Bebidas calientes y productos de cafetería", color: "#0ea5a4", productionAreaId: "cafeteria" },
  { name: "Postres", icon: "🍰", description: "Postres y opciones dulces del menú", color: "#ec4899", productionAreaId: "reposteria" },
  { name: "Extras", icon: "🍟", description: "Complementos y extras del menú", color: "#eab308", productionAreaId: "cocina" },
  { name: "Especiales de temporada", icon: "⭐", description: "Especiales disponibles por temporada", color: "#a78bfa", productionAreaId: "cocina" },
  { name: "Helados", icon: "🍦", description: "Helados y postres fríos", color: "#38bdf8", productionAreaId: "reposteria" },
  { name: "Sándwiches", icon: "🍔", description: "Sándwiches preparados al momento", color: "#f97316", productionAreaId: "cocina" }
]

function normalizeId(value) {
  return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

const POS_DEBUG = import.meta.env.DEV

function posDebug(label, payload) {
  if (POS_DEBUG) console.log(`[POS -> KDS] ${label}`, payload)
}

function productRecipeId(product) {
  return product?.recipeId || product?.recipe_id || ""
}

function productProductionAreaId(product) {
  return product?.productionAreaId || product?.production_area_id || product?.areaProduccion || ""
}

function productCategoryId(product) {
  return product?.categoriaId || product?.categoryId || product?.category_id || normalizeId(product?.categoria)
}

function getProductProductionState(product, recipes, areas, categories) {
  const recipeId = productRecipeId(product)
  const areaId = productProductionAreaId(product)
  const categoryId = productCategoryId(product)
  const recipe = recipes.find((entry) => String(entry.id) === String(recipeId) && entry.active !== false)
  const link = recipe?.links?.find((entry) => String(entry.pos_product_id) === String(product?.id))
  const area = areas.find((entry) => entry.id === areaId)
  const category = categories.find((entry) => entry.id === categoryId && entry.active !== false)
  const active = product?.estado === "activo" || product?.active === true
  const issues = []
  if (!recipe) issues.push("Sin receta válida")
  if (!area) issues.push("Sin área válida")
  if (!category) issues.push("Sin categoría activa")
  if (active && product?.productionReady !== true) issues.push("No validado para producción")
  return {
    active,
    recipeId,
    areaId,
    categoryId,
    recipe,
    link,
    area,
    category,
    issues,
    productionReady: active && product?.productionReady === true && issues.length === 0
  }
}

function loadPosCategories(products = []) {
  const stored = JSON.parse(localStorage.getItem(POS_CATEGORIES_KEY) || "[]")
  const storedCategories = Array.isArray(stored) ? stored : []
  const byId = new Map(DEFAULT_POS_CATEGORIES.map((category) => [category.id, { ...category, ...storedCategories.find((storedCategory) => storedCategory.id === category.id) }]))
  storedCategories.filter((category) => !byId.has(category.id)).forEach((category) => byId.set(category.id, category))
  products.forEach((product) => {
    const id = product.categoriaId || normalizeId(product.categoria)
    if (id && !byId.has(id)) {
      byId.set(id, {
        id,
        name: product.categoria || id,
        description: "Categoría migrada del menú existente",
        productionAreaId: product.areaProduccion || "cocina",
        active: true,
        sortOrder: byId.size + 1,
        color: "#64748b",
        icon: "M"
      })
    }
  })
  return [...byId.values()].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
}

function readLegacyPOSProducts() {
  try {
    const stored = JSON.parse(localStorage.getItem("posItems") || "[]")
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

const emptyItemForm = {
  nombre: "",
  categoria: "Entradas",
  categoriaId: "entradas",
  precio: "",
  descripcion: "",
  imagen: "",
  estado: "activo",
  sku: "",
  areaProduccion: "cocina",
  tiempoPreparacion: "",
  costoEstimado: "",
  ingredientesRelacionados: "",
  recipeId: ""
}

const emptyCategoryForm = {
  name: "",
  description: "",
  productionAreaId: "cocina",
  active: true,
  color: "#0ea5a4",
  icon: ""
}

const emptyAreaForm = {
  name: "",
  description: "",
  width: "900",
  height: "520",
  active: true
}

const emptyMesaForm = {
  name: "",
  capacity: "4",
  status: "disponible",
  shape: "square",
  areaId: ""
}

const emptyDeliveryForm = {
  tipoOrden: "Domicilio",
  cliente: "",
  nit: "",
  telefono: "",
  direccion1: "",
  direccion2: "",
  referencias: "",
  formaPago: "",
  fechaProgramada: "",
  horaProgramada: ""
}

function getOrderItemStatusLabel(status) {
  return ({
    draft: "Nuevo",
    sent_to_production: "Enviado",
    in_production: "En producción",
    ready: "Listo",
    prepared: "Preparado",
    served: "Servido",
    paid: "Pagado",
    cancelled: "Cancelado",
    error: "Error"
  })[status || "draft"] || status
}

function getOrderItemStatusStyle(status) {
  const styles = {
    draft: { background: "#1e293b", color: "#cbd5e1" },
    sent_to_production: { background: "#1e3a8a", color: "#dbeafe" },
    in_production: { background: "#075985", color: "#e0f2fe" },
    ready: { background: "#065f46", color: "#d1fae5" },
    prepared: { background: "#065f46", color: "#d1fae5" },
    served: { background: "#064e3b", color: "#d1fae5" },
    paid: { background: "#064e3b", color: "#d1fae5" },
    cancelled: { background: "#7f1d1d", color: "#fee2e2" },
    error: { background: "#7f1d1d", color: "#fee2e2" }
  }
  return styles[status || "draft"] || styles.draft
}

function normalizeLayoutTable(table, areaId, index = 0) {
  const capacity = Math.max(1, Number(table.capacity ?? table.capacidad ?? 4))
  const status = table.status || table.estado || "disponible"
  const fallbackNumber = String(index + 1)
  const number = String(table.numero || String(table.name || "").replace(/^M/i, "") || fallbackNumber)
  const name = table.name || `M${number}`
  return {
    ...table,
    id: table.id || `${areaId}-mesa-${index + 1}`,
    areaId,
    name,
    numero: number,
    capacity,
    capacidad: capacity,
    status,
    estado: status,
    x: Number(table.x ?? 12 + (index % 5) * 18),
    y: Number(table.y ?? 16 + Math.floor(index / 5) * 20),
    shape: table.shape || "square"
  }
}

function normalizeLayoutArea(area, index, layoutTables = []) {
  const id = area.id || `area-${index + 1}`
  const nestedTables = Array.isArray(area.mesas) ? area.mesas : layoutTables.filter((table) => table.areaId === id)
  return {
    ...area,
    id,
    name: area.name || area.nombre || `Area ${index + 1}`,
    nombre: area.name || area.nombre || `Area ${index + 1}`,
    description: area.description || "",
    sortOrder: Number(area.sortOrder ?? index + 1),
    active: area.active !== false,
    width: Number(area.width || 900),
    height: Number(area.height || 520),
    mesasTotales: nestedTables.length,
    mesas: nestedTables.map((table, tableIndex) => normalizeLayoutTable(table, id, tableIndex))
  }
}

function loadPosLayout() {
  try {
    const stored = JSON.parse(localStorage.getItem(POS_LAYOUT_KEY) || "null")
    if (stored?.areas && Array.isArray(stored.areas)) {
      const tables = Array.isArray(stored.tables) ? stored.tables : []
      return {
        areas: stored.areas.map((area, index) => normalizeLayoutArea(area, index, tables)),
        settings: { ...DEFAULT_LAYOUT_SETTINGS, ...(stored.settings || {}) }
      }
    }
  } catch {
    // Use the previous POS storage as a migration source below.
  }
  try {
    const legacyAreas = JSON.parse(localStorage.getItem("posRestaurantAreas") || "[]")
    return {
      areas: (Array.isArray(legacyAreas) ? legacyAreas : []).map((area, index) => normalizeLayoutArea(area, index)),
      settings: DEFAULT_LAYOUT_SETTINGS
    }
  } catch {
    return { areas: [], settings: DEFAULT_LAYOUT_SETTINGS }
  }
}

function buildPosLayoutPayload(areas, settings) {
  return {
    areas: areas.map(({ mesas, ...area }) => ({ ...area, mesasTotales: mesas.length })),
    tables: areas.flatMap((area) => area.mesas.map((table, index) => normalizeLayoutTable(table, area.id, index))),
    settings
  }
}

function TableWithChairs({ table, selected = false, editing = false, zoom = 1, onPointerDown, onClick }) {
  const capacity = Math.max(1, Number(table.capacity ?? table.capacidad ?? 1))
  const status = table.status || table.estado || "disponible"
  const shape = table.shape || "square"
  const radiusX = shape === "rectangular" ? 56 : shape === "round" ? 47 : 46
  const radiusY = shape === "rectangular" ? 39 : shape === "round" ? 47 : 40
  const surfaceStyle = shape === "round"
    ? { ...tableSurfaceStyle, width: "76px", height: "76px", borderRadius: "50%" }
    : shape === "rectangular"
      ? { ...tableSurfaceStyle, width: "110px", height: "58px", borderRadius: "8px" }
      : tableSurfaceStyle
  return (
    <button
      className={`pos-floor-table ${selected ? "selected" : ""} state-${status}`}
      type="button"
      onPointerDown={onPointerDown}
      onClick={onClick}
      style={{
        ...tableAssemblyStyle,
        left: `${table.x}%`,
        top: `${table.y}%`,
        transform: `translate(-50%, -50%) scale(${zoom})`,
        cursor: editing ? "grab" : "pointer",
        outline: selected ? "3px solid #22d3ee" : "none",
        filter: selected ? "drop-shadow(0 0 10px rgba(34,211,238,.6))" : "none"
      }}
    >
      {Array.from({ length: capacity }, (_, index) => {
        const angle = ((index / capacity) * Math.PI * 2) - (Math.PI / 2)
        return (
          <span
            key={`${table.id}-chair-${index}`}
            style={{
              ...chairStyle,
              transform: `translate(${Math.cos(angle) * radiusX}px, ${Math.sin(angle) * radiusY}px)`
            }}
          />
        )
      })}
      <span style={{ ...surfaceStyle, ...tableStatusStyles[status] }}>
        <strong>{table.name || `M${table.numero}`}</strong>
        <small>{capacity} pax</small>
        {table.orderTotal > 0 && <small>Q{Number(table.orderTotal).toFixed(0)}</small>}
        {table.activeMinutes != null && <small>{table.activeMinutes} min</small>}
        {table.readyCount > 0 && <small style={tableReadyCountStyle}>{table.readyCount} listo(s)</small>}
      </span>
    </button>
  )
}

function POS() {
  const location = useLocation()
  const { user } = useAuth()
  const params = new URLSearchParams(location.search)
  const section = params.get("section") || "pos"

  const [items, setItems] = useState([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [migratingLocalProducts, setMigratingLocalProducts] = useState(false)
  const [mostrarFormulario, setMostrarFormulario] = useState(false)
  const [form, setForm] = useState(emptyItemForm)
  const [editandoId, setEditandoId] = useState(null)
  const [errores, setErrores] = useState({})
  const [posCategories, setPosCategories] = useState(() => loadPosCategories())
  const [productionAreas, setProductionAreas] = useState([])
  const [standardRecipes, setStandardRecipes] = useState([])
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm)
  const [editingCategoryId, setEditingCategoryId] = useState("")
  const [categoryError, setCategoryError] = useState("")
  const [categoriaActiva, setCategoriaActiva] = useState("entradas")
  const [productSearch, setProductSearch] = useState("")
  const [orden, setOrden] = useState([])
  const [ordenesEnviadas, setOrdenesEnviadas] = useState([])
  const [currentOrder, setCurrentOrder] = useState(null)
  const [orderDetail, setOrderDetail] = useState(null)
  const [orderEvents, setOrderEvents] = useState([])
  const [activeOrderId, setActiveOrderId] = useState("")
  const posSession = user
  const [areasRestaurante, setAreasRestaurante] = useState(() => loadPosLayout().areas)
  const [layoutSettings, setLayoutSettings] = useState(() => loadPosLayout().settings)
  const [mostrarAreaForm, setMostrarAreaForm] = useState(false)
  const [areaForm, setAreaForm] = useState(emptyAreaForm)
  const [areaErrors, setAreaErrors] = useState({})
  const [editandoAreaId, setEditandoAreaId] = useState(null)
  const [areaActivaId, setAreaActivaId] = useState(() => {
    const layout = loadPosLayout()
    return layout.areas.find((area) => area.active !== false)?.id || layout.areas[0]?.id || null
  })
  const [editandoCroquis, setEditandoCroquis] = useState(true)
  const [mesaSeleccionada, setMesaSeleccionada] = useState(null)
  const [mesaForm, setMesaForm] = useState(emptyMesaForm)
  const [mesaError, setMesaError] = useState("")
  const [layoutMessage, setLayoutMessage] = useState("")
  const [draggingTableId, setDraggingTableId] = useState(null)
  const floorPlanRef = useRef(null)
  const [ordenMesa, setOrdenMesa] = useState(null)
  const [personasOrden, setPersonasOrden] = useState("1")
  const [deliveryForm, setDeliveryForm] = useState(emptyDeliveryForm)
  const [deliveryErrors, setDeliveryErrors] = useState({})
  const [ordenError, setOrdenError] = useState("")
  const [ordenMessage, setOrdenMessage] = useState("")
  const [realtimeNotice, setRealtimeNotice] = useState("")
  const [productionErrors, setProductionErrors] = useState([])
  const [sendingOrder, setSendingOrder] = useState(false)
  const [diagnostic, setDiagnostic] = useState(null)
  const [productDiagnostic, setProductDiagnostic] = useState(null)
  const [trasladoActivo, setTrasladoActivo] = useState(false)
  const [mesaDestinoId, setMesaDestinoId] = useState("")
  const [tick, setTick] = useState(() => Date.now())
  const [itemPendiente, setItemPendiente] = useState(null)
  const [modificacionesPendientes, setModificacionesPendientes] = useState("")
  const [editandoModificacionLineId, setEditandoModificacionLineId] = useState(null)
  const [modificacionActualTexto, setModificacionActualTexto] = useState("")
  const [edicionEnviada, setEdicionEnviada] = useState(null)
  const [showTechnicalAudit, setShowTechnicalAudit] = useState(false)
  const [collapsedOrderSections, setCollapsedOrderSections] = useState({ served: true, closed: true })
  const realtimeNoticeTimerRef = useRef(null)

  const activeCategories = useMemo(() => posCategories.filter((category) => category.active !== false).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)), [posCategories])
  const finalRecipes = standardRecipes.filter((recipe) => recipe.recipe_type === "final_product" && recipe.active !== false)
  const itemsCategoria = useMemo(
    () => items.filter((item) => {
      const matchesCategory = !productSearch.trim() || productCategoryId(item) === categoriaActiva
      const matchesSearch = !productSearch.trim() || normalizarTexto(item.nombre || item.name).includes(normalizarTexto(productSearch))
      return matchesCategory && matchesSearch && getProductProductionState(item, finalRecipes, productionAreas, activeCategories).productionReady
    }),
    [items, categoriaActiva, productSearch, finalRecipes, productionAreas, activeCategories]
  )
  const totalOrden = Number(currentOrder?.total ?? orden.reduce((total, item) => total + item.precio * item.cantidad, 0))
  const draftItems = orden.filter((item) => (item.status || "draft") === "draft")
  const sentItems = orden.filter((item) => !["draft", "cancelled"].includes(item.status || "draft"))
  const allowHistoricalOrderActions = false
  const orderSections = [
    { id: "draft", title: "Productos nuevos / sin enviar", statuses: ["draft"] },
    { id: "production", title: "En producción", statuses: ["sent_to_production", "in_production"] },
    { id: "ready", title: "Listos para servir", statuses: ["ready"] },
    { id: "served", title: "Servidos", statuses: ["served"], collapsible: true },
    { id: "closed", title: "Cancelados / Error", statuses: ["cancelled", "error"], collapsible: true }
  ].map((sectionItem) => ({
    ...sectionItem,
    items: orden.filter((item) => sectionItem.statuses.includes(item.status || "draft"))
  }))
  const activeFloorAreas = areasRestaurante.filter((area) => area.active !== false).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
  const areaActiva = areasRestaurante.find((area) => area.id === areaActivaId && area.active !== false) || activeFloorAreas[0] || null
  const mesaSeleccionadaActual = areaActiva?.mesas?.find((mesa) => mesa.id === mesaSeleccionada) || null
  const puedeAdministrarCroquis = CROQUIS_ROLES.includes(user?.role)
  const puedeAdministrarCategorias = CATEGORY_ADMIN_ROLES.includes(user?.role)
  const puedeEditarOrdenes = ["admin", "gerente", "gerente_general", "gerente_operaciones", "supervisor", "rrhh"].includes(user?.role)
  const puedeVerAuditoria = ["admin", "gerente", "gerente_general", "gerente_operaciones", "supervisor"].includes(user?.role)
  const esMesaDelivery = ordenMesa ? esPedidoDomicilioParaLlevar(ordenMesa.areaNombre) || esPedidoDomicilioParaLlevar(ordenMesa.mesaNumero) : false
  const esOrdenProgramada = Boolean(deliveryForm.fechaProgramada || deliveryForm.horaProgramada)
  const mesaKeyActual = ordenMesa ? obtenerMesaKey(ordenMesa.areaId, ordenMesa.mesaId) : ""
  const historialMesaActual = mesaKeyActual ? ordenesEnviadas.filter((ordenItem) => ordenItem.mesaKey === mesaKeyActual && ordenItem.id !== currentOrder?.id).slice(0, 5) : []
  const mesaBloqueadaPorCobro = ["awaiting_bill", "sent_to_cashier", "payment_in_progress"].includes(currentOrder?.status)
    || historialMesaActual.some((order) => ["sent_to_cashier", "payment_in_progress"].includes(order.status))
  const invalidActiveProducts = items.filter((item) => {
    const state = getProductProductionState(item, finalRecipes, productionAreas, activeCategories)
    return state.active && !state.productionReady
  })
  const selectedRecipe = finalRecipes.find((recipe) => String(recipe.id) === String(productRecipeId(form)))
  const selectedProductionArea = productionAreas.find((area) => area.id === productProductionAreaId(form))
  const formReadyForValidation = Boolean(selectedRecipe && selectedProductionArea && form.estado === "activo")
  const storedLocalPOSProducts = readLegacyPOSProducts()
  const localPOSProducts = storedLocalPOSProducts.filter((product) => !product.supabaseProductId)
  const mesasDestinoDisponibles = activeFloorAreas.flatMap((area) =>
    (area.mesas || [])
      .filter((mesa) => obtenerMesaKey(area.id, mesa.id) !== mesaKeyActual && mesa.estado === "disponible" && !mesaTieneOrdenesActivas(area.id, mesa.id))
      .map((mesa) => ({ area, mesa }))
  )
  const selectedLayoutTable = areaActiva?.mesas?.find((mesa) => mesa.id === ordenMesa?.mesaId)
  const activeMinutes = currentOrder ? minutosTranscurridos(currentOrder.created_at) : null
  const readyItemsCount = orden.filter((item) => item.status === "ready").length
  const serviceEventTypes = ["item_added", "sent_to_production", "production_ready", "production_served", "bill_requested", "sent_to_cashier", "order_paid"]
  const serviceEvents = orderEvents.filter((event) => serviceEventTypes.includes(event.event_type)).slice(0, 8)
  const nextServiceAction = !currentOrder
    ? "Agrega productos para iniciar el servicio."
    : readyItemsCount > 0
      ? "Hay productos listos: entrégalos y marca servido."
      : draftItems.length > 0
        ? "Envía los productos nuevos a cocina."
        : currentOrder.status === "awaiting_bill"
          ? "Envía la cuenta a caja."
          : currentOrder.status === "sent_to_cashier"
            ? "Cuenta en caja, esperando pago."
            : "En preparación. Espera aviso de cocina."

  function showPOSRealtimeNotice(text) {
    setRealtimeNotice(text)
    window.clearTimeout(realtimeNoticeTimerRef.current)
    realtimeNoticeTimerRef.current = window.setTimeout(() => setRealtimeNotice(""), 4500)
  }

  async function refreshSelectedTableLive() {
    if (!ordenMesa) return
    try {
      await cargarMesaDesdeSupabase(ordenMesa)
    } catch (realtimeError) {
      console.error("POS realtime refresh error:", realtimeError)
      setOrdenError(`No se pudo actualizar la mesa en vivo: ${realtimeError.message}`)
    }
  }

  const ordersRealtime = useSupabaseRealtime({
    table: "pos_orders",
    event: "*",
    filter: ordenMesa?.mesaId ? `table_id=eq.${ordenMesa.mesaId}` : undefined,
    enabled: Boolean(posSession && ordenMesa?.mesaId),
    onChange: refreshSelectedTableLive
  })
  const orderItemsRealtime = useSupabaseRealtime({
    table: "pos_order_items",
    event: "*",
    filter: currentOrder?.id ? `order_id=eq.${currentOrder.id}` : undefined,
    enabled: Boolean(posSession && currentOrder?.id),
    onChange: refreshSelectedTableLive
  })
  const readyTicketsRealtime = useSupabaseRealtime({
    table: "production_tickets",
    event: "UPDATE",
    filter: user?.id ? `waiter_id=eq.${user.id}` : undefined,
    enabled: Boolean(posSession && user?.id),
    onChange: (payload) => {
      if (payload.new?.status !== "ready" || payload.old?.status === "ready") return
      showPOSRealtimeNotice(`${payload.new.table_name || "Una mesa"} tiene productos listos.`)
      if (String(payload.new.table_id) === String(ordenMesa?.mesaId)) refreshSelectedTableLive()
    }
  })
  const posRealtimeActive = ordersRealtime.isLive && (!currentOrder || orderItemsRealtime.isLive) && readyTicketsRealtime.isLive

  useEffect(() => {
    const interval = setInterval(() => setTick(Date.now()), 60 * 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => () => window.clearTimeout(realtimeNoticeTimerRef.current), [])

  useEffect(() => {
    let mounted = true
    getProductionAreas().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setCategoryError("No se pudieron cargar las áreas de producción desde Supabase.")
        setProductionAreas([])
        return
      }
      setProductionAreas((data || []).map((area) => ({ id: area.id, name: area.name })))
    })
    getActiveRecipes().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setOrdenError("No se pudieron cargar las recetas oficiales desde Supabase.")
        return
      }
      setStandardRecipes(data || [])
    })
    getPOSProducts().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        setOrdenError(`No se pudo cargar el catálogo POS desde Supabase: ${error.message}`)
        setItems([])
      } else {
        setItems(data || [])
        setPosCategories(loadPosCategories(data || []))
      }
      setItemsLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    async function refreshProducts() {
      const { data, error } = await getPOSProducts()
      if (error) {
        setOrdenError(`No se pudo actualizar el catálogo POS: ${error.message}`)
        return
      }
      setItems(data || [])
      setPosCategories(loadPosCategories(data || []))
      posDebug("catálogo POS sincronizado", { source: "Supabase: pos_products", items: data })
    }
    window.addEventListener("pos-products-updated", refreshProducts)
    return () => window.removeEventListener("pos-products-updated", refreshProducts)
  }, [])

  useEffect(() => {
    localStorage.setItem(POS_CATEGORIES_KEY, JSON.stringify(posCategories))
    if (!activeCategories.some((category) => category.id === categoriaActiva)) {
      const timeout = window.setTimeout(() => setCategoriaActiva(activeCategories[0]?.id || ""), 0)
      return () => window.clearTimeout(timeout)
    }
    return undefined
  }, [posCategories, activeCategories, categoriaActiva])

  useEffect(() => {
    localStorage.setItem(POS_LAYOUT_KEY, JSON.stringify(buildPosLayoutPayload(areasRestaurante, layoutSettings)))
    localStorage.setItem("posRestaurantAreas", JSON.stringify(areasRestaurante))
  }, [areasRestaurante, layoutSettings])

  function obtenerMesaKey(areaId, mesaId) {
    return `${areaId}:${mesaId}`
  }

  function mesaTieneOrdenesActivas(areaId, mesaId) {
    const key = obtenerMesaKey(areaId, mesaId)
    return ordenesEnviadas.some((ordenItem) => ordenItem.mesaKey === key && !["entregada", "pagada", "cancelada"].includes(ordenItem.estado))
  }

  function guardarOrdenes(nextOrdenes) {
    setOrdenesEnviadas(nextOrdenes)
  }

  function minutosTranscurridos(fechaISO) {
    if (!fechaISO) return 0
    return Math.max(0, Math.floor((tick - new Date(fechaISO).getTime()) / 60000))
  }

  function normalizarTexto(texto) {
    return String(texto || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim()
  }

  function esPedidoDomicilioParaLlevar(texto) {
    const normalizado = normalizarTexto(texto)
    return normalizado.includes("pedidos a domicilio o para llevar")
  }

  function seleccionarCategoriaProducto(categoryId) {
    const category = posCategories.find((item) => item.id === categoryId)
    setForm((actual) => ({
      ...actual,
      categoriaId: categoryId,
      categoria: category?.name || "",
      areaProduccion: category?.productionAreaId || actual.areaProduccion
    }))
    setErrores((actuales) => {
      const siguientes = { ...actuales }
      delete siguientes.categoria
      return siguientes
    })
  }

  function guardarCategoria(event) {
    event.preventDefault()
    const name = categoryForm.name.trim()
    if (!name) {
      setCategoryError("Ingresa el nombre de la categoría.")
      return
    }
    if (!categoryForm.icon) {
      setCategoryError("Selecciona un icono para esta categoría.")
      return
    }
    if (!categoryForm.productionAreaId) {
      setCategoryError("Selecciona el área que recibirá el ticket.")
      return
    }
    if (!categoryForm.color) {
      setCategoryError("Selecciona un color para esta categoría.")
      return
    }
    const id = editingCategoryId || normalizeId(name)
    const duplicate = posCategories.some((category) => category.id !== editingCategoryId && category.active !== false && normalizeId(category.name) === normalizeId(name))
    if (duplicate) {
      setCategoryError("Ya existe una categoría activa con ese nombre.")
      return
    }
    const existing = posCategories.find((category) => category.id === editingCategoryId)
    const next = { ...categoryForm, id, name, sortOrder: existing?.sortOrder || (posCategories.length + 1) }
    setPosCategories((actuales) => editingCategoryId ? actuales.map((category) => category.id === editingCategoryId ? next : category) : [...actuales, next])
    setCategoryForm(emptyCategoryForm)
    setEditingCategoryId("")
    setCategoryError("")
  }

  function aplicarCategoriaRapida(option) {
    const productionAreaId = productionAreas.some((area) => area.id === option.productionAreaId)
      ? option.productionAreaId
      : productionAreas[0]?.id || ""
    setCategoryForm((actual) => ({ ...actual, ...option, productionAreaId }))
    setCategoryError("")
  }

  function editarCategoria(category) {
    setEditingCategoryId(category.id)
    setCategoryForm({
      name: category.name,
      description: category.description || "",
      productionAreaId: category.productionAreaId || "cocina",
      active: category.active !== false,
      color: category.color || "#0ea5a4",
      icon: category.icon || ""
    })
    setCategoryError("")
  }

  function desactivarCategoria(category) {
    setPosCategories((actuales) => actuales.map((item) => item.id === category.id ? { ...item, active: false } : item))
  }

  function eliminarCategoria(category) {
    const associated = items.filter((item) => (item.categoriaId || normalizeId(item.categoria)) === category.id).length
    if (associated > 0) {
      setCategoryError(`No se puede eliminar ${category.name}; tiene ${associated} producto(s) asociado(s).`)
      return
    }
    setPosCategories((actuales) => actuales.filter((item) => item.id !== category.id).map((item, index) => ({ ...item, sortOrder: index + 1 })))
  }

  function moverCategoria(categoryId, direction) {
    const ordered = [...posCategories].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
    const index = ordered.findIndex((category) => category.id === categoryId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return
    ;[ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]]
    setPosCategories(ordered.map((category, position) => ({ ...category, sortOrder: position + 1 })))
  }

  function guardarAreas(nextAreas) {
    setAreasRestaurante(nextAreas)
    if (!areaActivaId && nextAreas.length > 0) setAreaActivaId(nextAreas.find((area) => area.active !== false)?.id || nextAreas[0].id)
  }

  function guardarArea(event) {
    event.preventDefault()
    const faltantes = {}
    const areaName = areaForm.name.trim()
    if (!areaName) faltantes.name = "Nombre del area"
    if (Number(areaForm.width) < 400) faltantes.width = "Ancho minimo 400 px"
    if (Number(areaForm.height) < 300) faltantes.height = "Alto minimo 300 px"
    if (areasRestaurante.some((area) => area.id !== editandoAreaId && area.nombre.toLowerCase() === areaName.toLowerCase())) {
      faltantes.name = "Ya existe un area con ese nombre"
    }
    setAreaErrors(faltantes)
    if (Object.keys(faltantes).length > 0) return

    if (editandoAreaId) {
      guardarAreas(areasRestaurante.map((area) =>
        area.id === editandoAreaId
          ? { ...area, name: areaName, nombre: areaName, description: areaForm.description.trim(), width: Number(areaForm.width), height: Number(areaForm.height), active: areaForm.active }
          : area
      ))
    } else {
      const nuevaArea = {
        id: `${normalizeId(areaName) || "area"}-${Date.now()}`,
        name: areaName,
        nombre: areaName,
        description: areaForm.description.trim(),
        sortOrder: areasRestaurante.length + 1,
        active: true,
        width: Number(areaForm.width),
        height: Number(areaForm.height),
        mesasTotales: 0,
        mesas: []
      }

      guardarAreas([...areasRestaurante, nuevaArea])
      setAreaActivaId(nuevaArea.id)
    }
    setAreaForm(emptyAreaForm)
    setEditandoAreaId(null)
    setMostrarAreaForm(false)
    setAreaErrors({})
  }

  function editarArea(area) {
    setEditandoAreaId(area.id)
    setAreaForm({
      name: area.nombre,
      description: area.description || "",
      width: String(area.width || 900),
      height: String(area.height || 520),
      active: area.active !== false
    })
    setMostrarAreaForm(true)
    setAreaErrors({})
  }

  function desactivarArea(areaId) {
    const area = areasRestaurante.find((item) => item.id === areaId)
    if (!area) return
    if ((area.mesas || []).some((mesa) => mesaTieneOrdenesActivas(area.id, mesa.id)) && !window.confirm("Esta area tiene ordenes activas. Deseas desactivarla de todos modos?")) return
    const nextAreas = areasRestaurante.map((item) => item.id === areaId ? { ...item, active: false } : item)
    guardarAreas(nextAreas)
    if (areaActivaId === areaId) setAreaActivaId(nextAreas.find((item) => item.active !== false)?.id || null)
    if (ordenMesa?.areaId === areaId) setOrdenMesa(null)
    setMesaSeleccionada(null)
  }

  function moverArea(areaId, direction) {
    const ordered = [...areasRestaurante].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder))
    const index = ordered.findIndex((area) => area.id === areaId)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ordered.length) return
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    guardarAreas(ordered.map((area, position) => ({ ...area, sortOrder: position + 1 })))
  }

  function actualizarArea(areaId, updater) {
    setAreasRestaurante((actuales) => actuales.map((area) => area.id === areaId ? updater(area) : area))
  }

  function agregarMesa() {
    if (!areaActiva) return
    const siguienteNumero = String((areaActiva.mesas?.length || 0) + 1)
    const nuevaMesa = normalizeLayoutTable({
      id: `mesa-${areaActiva.id}-${siguienteNumero}`,
      name: `M${siguienteNumero}`,
      numero: siguienteNumero,
      capacity: 4,
      status: "disponible",
      shape: "square",
      x: 14 + ((areaActiva.mesas?.length || 0) % 4) * 18,
      y: 16 + Math.floor((areaActiva.mesas?.length || 0) / 4) * 20
    }, areaActiva.id)
    actualizarArea(areaActiva.id, (area) => ({
      ...area,
      mesasTotales: (area.mesas?.length || 0) + 1,
      mesas: [...(area.mesas || []), nuevaMesa]
    }))
    seleccionarMesaParaEditar(nuevaMesa)
  }

  function seleccionarMesaParaEditar(mesa) {
    setMesaSeleccionada(mesa.id)
    setMesaForm({
      name: mesa.name || `M${mesa.numero}`,
      capacity: String(mesa.capacity ?? mesa.capacidad),
      status: mesa.status || mesa.estado,
      shape: mesa.shape || "square",
      areaId: mesa.areaId || areaActiva?.id || ""
    })
    setMesaError("")
  }

  function guardarMesaEditada(event) {
    event.preventDefault()
    if (!areaActiva || !mesaSeleccionada) return
    const name = mesaForm.name.trim()
    const capacity = Number(mesaForm.capacity)
    if (!name) {
      setMesaError("Ingresa un nombre para la mesa.")
      return
    }
    if (!Number.isFinite(capacity) || capacity < 1) {
      setMesaError("La capacidad debe ser de al menos 1 persona.")
      return
    }
    const destinationId = mesaForm.areaId || areaActiva.id
    const duplicate = areasRestaurante.find((area) => area.id === destinationId)?.mesas.some((mesa) => mesa.id !== mesaSeleccionada && String(mesa.name || `M${mesa.numero}`).toLowerCase() === name.toLowerCase())
    if (duplicate) {
      setMesaError("Ya existe una mesa con ese nombre en el area seleccionada.")
      return
    }
    const sourceTable = areaActiva.mesas.find((mesa) => mesa.id === mesaSeleccionada)
    if (!sourceTable) return
    const updatedTable = normalizeLayoutTable({
      ...sourceTable,
      name,
      numero: name.replace(/^M/i, "") || name,
      capacity,
      status: mesaForm.status,
      shape: mesaForm.shape
    }, destinationId)
    setAreasRestaurante((actuales) => actuales.map((area) => {
      const remaining = area.mesas.filter((mesa) => mesa.id !== mesaSeleccionada)
      if (area.id === destinationId) {
        const mesas = [...remaining, updatedTable]
        return { ...area, mesas, mesasTotales: mesas.length }
      }
      return remaining.length !== area.mesas.length ? { ...area, mesas: remaining, mesasTotales: remaining.length } : area
    }))
    setAreaActivaId(destinationId)
    setMesaSeleccionada(updatedTable.id)
    setMesaError("")
    setLayoutMessage("Mesa guardada.")
  }

  function eliminarMesa(mesaId) {
    if (!areaActiva) return
    if (mesaTieneOrdenesActivas(areaActiva.id, mesaId) && !window.confirm("Esta mesa tiene una orden activa. Deseas eliminarla?")) return
    actualizarArea(areaActiva.id, (area) => ({
      ...area,
      mesasTotales: Math.max(0, area.mesas.length - 1),
      mesas: area.mesas.filter((mesa) => mesa.id !== mesaId)
    }))
    if (ordenMesa?.mesaId === mesaId) setOrdenMesa(null)
    setMesaSeleccionada(null)
    setMesaForm(emptyMesaForm)
  }

  function duplicarMesa() {
    if (!areaActiva || !mesaSeleccionada) return
    const source = areaActiva.mesas.find((mesa) => mesa.id === mesaSeleccionada)
    if (!source) return
    const copyNameBase = `${source.name || `M${source.numero}`} copia`
    let copyName = copyNameBase
    let count = 2
    while (areaActiva.mesas.some((mesa) => (mesa.name || `M${mesa.numero}`).toLowerCase() === copyName.toLowerCase())) {
      copyName = `${copyNameBase} ${count}`
      count += 1
    }
    const copy = normalizeLayoutTable({ ...source, id: `mesa-${areaActiva.id}-${normalizeId(copyName)}`, name: copyName, x: Math.min(91, source.x + 9), y: Math.min(88, source.y + 9) }, areaActiva.id)
    actualizarArea(areaActiva.id, (area) => ({ ...area, mesas: [...area.mesas, copy], mesasTotales: area.mesas.length + 1 }))
    seleccionarMesaParaEditar(copy)
  }

  function iniciarArrastreMesa(event, mesa) {
    if (!editandoCroquis) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setDraggingTableId(mesa.id)
    seleccionarMesaParaEditar(mesa)
  }

  function moverMesa(event) {
    if (!editandoCroquis || !draggingTableId || !areaActiva || !floorPlanRef.current) return
    const plano = floorPlanRef.current.getBoundingClientRect()
    let pixelX = event.clientX - plano.left
    let pixelY = event.clientY - plano.top
    if (layoutSettings.snapToGrid) {
      pixelX = Math.round(pixelX / layoutSettings.gridSize) * layoutSettings.gridSize
      pixelY = Math.round(pixelY / layoutSettings.gridSize) * layoutSettings.gridSize
    }
    const x = Math.min(93, Math.max(7, (pixelX / plano.width) * 100))
    const y = Math.min(90, Math.max(10, (pixelY / plano.height) * 100))
    actualizarArea(areaActiva.id, (area) => ({
      ...area,
      mesas: area.mesas.map((mesa) => mesa.id === draggingTableId ? { ...mesa, x, y } : mesa)
    }))
  }

  function terminarArrastreMesa() {
    if (!draggingTableId) return
    setDraggingTableId(null)
    setLayoutMessage("Posicion guardada.")
  }

  function guardarLayoutManual() {
    localStorage.setItem(POS_LAYOUT_KEY, JSON.stringify(buildPosLayoutPayload(areasRestaurante, layoutSettings)))
    localStorage.setItem("posRestaurantAreas", JSON.stringify(areasRestaurante))
    setLayoutMessage("Layout guardado.")
  }

  function estadoMesaPorOrden(order) {
    if (!order || !order.items?.some((item) => item.status !== "cancelled")) return "disponible"
    if (order.status === "paid") return "pagada"
    if (order.status === "sent_to_cashier") return "pago_en_proceso"
    if (order.status === "awaiting_bill") return "esperando_cuenta"
    if (order.items.some((item) => item.status === "error")) return "problema"
    if (order.items.some((item) => item.status === "ready")) return "lista_para_servir"
    if (order.items.some((item) => ["sent_to_production", "in_production"].includes(item.status))) return "en_produccion"
    if (order.items.some((item) => item.status === "draft")) return "nuevos_sin_enviar"
    return "en_servicio"
  }

  function etiquetaEstadoMesa(status) {
    return ({
      disponible: "Disponible",
      ocupada: "Ocupada",
      en_servicio: "En servicio",
      nuevos_sin_enviar: "Productos nuevos sin enviar",
      esperando_cuenta: "Esperando cuenta",
      pago_en_proceso: "Pago en proceso",
      pagada: "Pagada",
      problema: "Problema",
      en_produccion: "En producción",
      lista_para_servir: "Lista para servir"
    })[status] || status
  }

  function sincronizarEstadoVisualMesa(tableData, order) {
    const estado = estadoMesaPorOrden(order)
    actualizarArea(tableData.areaId, (area) => ({
      ...area,
      mesas: area.mesas.map((item) => item.id === tableData.mesaId ? {
        ...item,
        estado,
        status: estado,
        orderTotal: Number(order?.total || 0),
        orderCreatedAt: order?.created_at || null,
        activeMinutes: order ? minutosTranscurridos(order.created_at) : null,
        readyCount: (order?.items || []).filter((detail) => detail.status === "ready").length
      } : item)
    }))
    return estado
  }

  async function cargarMesaDesdeSupabase(tableData, orderId = "") {
    const orderResult = orderId
      ? await getOrderWithItems(orderId)
      : await getOpenOrderByTable(tableData.mesaId)
    if (orderResult.error) throw orderResult.error
    const order = orderResult.data || null
    const history = await getTableOrderHistory(tableData.mesaId)
    if (history.error) throw history.error
    const events = await getTableOrderEvents(tableData.mesaId)
    if (events.error) throw events.error
    setCurrentOrder(order)
    setActiveOrderId(order?.status === "open" ? order.id : "")
    setOrden(order?.items || [])
    setOrderEvents(events.data || [])
    setOrdenesEnviadas(history.data || [])
    sincronizarEstadoVisualMesa(tableData, order)
    return order
  }

  async function verDetalleOrdenAnterior(orderId) {
    const result = await getOrderWithItems(orderId)
    if (result.error) {
      setOrdenError(`No se pudo cargar el detalle: ${result.error.message}`)
      return
    }
    setOrderDetail(result.data)
  }

  async function seleccionarMesaOperacion(mesa) {
    if (!areaActiva) return
    const selectedTable = { areaId: areaActiva.id, mesaId: mesa.id, areaNombre: areaActiva.nombre, mesaNumero: mesa.name || mesa.numero }
    setOrdenMesa(selectedTable)
    setOrdenError("")
    setOrdenMessage("")
    setOrderDetail(null)
    setTrasladoActivo(false)
    setMesaDestinoId("")
    if (!esPedidoDomicilioParaLlevar(areaActiva.nombre) && !esPedidoDomicilioParaLlevar(mesa.numero)) {
      setDeliveryErrors({})
    }
    try {
      const order = await cargarMesaDesdeSupabase(selectedTable)
      if (order) {
        await recordOrderEvent(order.id, "table_selected", `${selectedTable.mesaNumero} seleccionada en POS.`)
        const events = await getTableOrderEvents(selectedTable.mesaId)
        if (!events.error) setOrderEvents(events.data || [])
      } else {
        setOrdenMessage("Mesa disponible. Agrega productos para iniciar orden.")
      }
    } catch (error) {
      console.error("Supabase POS table order error:", error)
      setActiveOrderId("")
      setCurrentOrder(null)
      setOrden([])
      setOrderEvents([])
      setOrdenError(`No se pudo cargar la orden de la mesa: ${error.message}`)
    }
  }

  function actualizarDelivery(campo, valor) {
    setDeliveryForm((actual) => ({ ...actual, [campo]: valor }))
    setDeliveryErrors((actuales) => {
      if (!actuales[campo]) return actuales
      const siguientes = { ...actuales }
      delete siguientes[campo]
      return siguientes
    })
  }

  function validarDelivery() {
    if (!esMesaDelivery) return {}
    const faltantes = {}
    if (!deliveryForm.cliente.trim()) faltantes.cliente = "Nombre del cliente"
    if (!deliveryForm.telefono.trim()) faltantes.telefono = "Teléfono / WhatsApp"
    if (!deliveryForm.formaPago) faltantes.formaPago = "Forma de pago"
    if (deliveryForm.tipoOrden === "Domicilio" && !deliveryForm.direccion1.trim()) {
      faltantes.direccion1 = "Dirección de entrega 1"
    }
    return faltantes
  }

  function actualizarCampo(campo, valor) {
    setForm((actual) => ({ ...actual, [campo]: valor }))
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales
      const siguientes = { ...actuales }
      delete siguientes[campo]
      return siguientes
    })
  }

  function emptyActiveItemForm() {
    const category = activeCategories[0]
    return {
      ...emptyItemForm,
      categoriaId: category?.id || "",
      categoria: category?.name || "",
      areaProduccion: category?.productionAreaId || "cocina"
    }
  }

  function cargarImagen(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => actualizarCampo("imagen", e.target.result)
    reader.readAsDataURL(file)
  }

  function validarItem() {
    const faltantes = {}
    const recipeId = productRecipeId(form)
    const productionAreaId = productProductionAreaId(form)
    if (!form.nombre.trim()) faltantes.nombre = "Nombre del item"
    if (!form.categoriaId) faltantes.categoria = "Categoría POS"
    if (form.estado === "activo" && !activeCategories.some((category) => category.id === form.categoriaId)) faltantes.categoria = "Categoría POS activa"
    if (!form.precio || Number(form.precio) <= 0) faltantes.precio = "Precio de venta"
    if (!form.descripcion.trim()) faltantes.descripcion = "Descripción"
    if (!form.imagen) faltantes.imagen = "Imagen del item"
    if (!form.estado) faltantes.estado = "Estado"
    if (!productionAreaId || (form.estado === "activo" && !productionAreas.some((area) => area.id === productionAreaId))) faltantes.areaProduccion = "Área de producción válida"
    if (!form.tiempoPreparacion.trim()) faltantes.tiempoPreparacion = "Tiempo estimado de preparación"
    if (form.estado === "activo" && !finalRecipes.some((recipe) => String(recipe.id) === String(recipeId))) faltantes.recipeId = "Receta final activa válida"
    const recipe = finalRecipes.find((entry) => String(entry.id) === String(recipeId))
    if (form.estado === "activo" && recipe && recipe.production_area_id !== productionAreaId) faltantes.areaProduccion = "Área que coincida con la receta"
    return faltantes
  }

  async function guardarItem(event) {
    event.preventDefault()
    const faltantes = validarItem()
    setErrores(faltantes)
    if (Object.keys(faltantes).length > 0) return

    const recipeId = productRecipeId(form)
    const productionAreaId = productProductionAreaId(form)
    const categoryId = productCategoryId(form)
    const item = {
      ...form,
      categoriaId: categoryId,
      categoryId,
      category_id: categoryId,
      categoria: posCategories.find((category) => category.id === categoryId)?.name || form.categoria,
      id: editandoId || null,
      precio: Number(form.precio),
      price: Number(form.precio),
      recipeId,
      recipe_id: recipeId,
      productionAreaId,
      production_area_id: productionAreaId,
      areaProduccion: productionAreaId,
      active: form.estado === "activo",
      productionReady: false,
      costoEstimado: form.costoEstimado ? Number(form.costoEstimado) : "",
      actualizadoEn: new Date().toLocaleString()
    }
    posDebug("producto a guardar", {
      item,
      recipeId: productRecipeId(item),
      productionAreaId: productProductionAreaId(item)
    })

    const selectedFinalRecipe = finalRecipes.find((recipe) => String(recipe.id) === String(recipeId))
    const savedResult = item.active
      ? await createOrUpdatePOSProductFromRecipe({
          ...selectedFinalRecipe,
          id: recipeId,
          name: item.nombre,
          description: item.descripcion,
          salePrice: item.precio,
          imageUrl: item.imagen,
          posCategoryId: categoryId,
          categoryName: item.categoria
        }, editandoId)
      : editandoId
        ? await updatePOSProduct(editandoId, item)
        : await createPOSProduct(item)
    if (savedResult.error) {
      console.error("Supabase POS product save error:", savedResult.error)
      setOrdenError(`Producto no guardado: ${savedResult.error.message}`)
      return
    }
    const savedProduct = savedResult.data
    if (item.active && !savedProduct?.productionReady) {
      setOrdenError("Producto guardado, pero Supabase no lo marcó listo para producción.")
      return
    }
    const nextItems = editandoId
      ? items.map((actual) => (actual.id === editandoId ? savedProduct : actual))
      : [savedProduct, ...items]
    setItems(nextItems)
    setPosCategories(loadPosCategories(nextItems))
    posDebug("producto POS guardado en Supabase", savedProduct)
    setForm(emptyActiveItemForm())
    setEditandoId(null)
    setMostrarFormulario(false)
    setErrores({})
    setOrdenError("Producto POS guardado y validado para producción.")
  }

  function editarItem(item) {
    const recipeId = productRecipeId(item)
    const productionAreaId = productProductionAreaId(item)
    setForm({
      ...emptyItemForm,
      ...item,
      categoriaId: productCategoryId(item),
      precio: String(item.precio ?? item.price ?? ""),
      costoEstimado: item.costoEstimado ? String(item.costoEstimado) : "",
      recipeId,
      recipe_id: recipeId,
      areaProduccion: productionAreaId,
      productionAreaId,
      production_area_id: productionAreaId
    })
    setEditandoId(item.id)
    setMostrarFormulario(true)
    setErrores({})
  }

  async function desactivarItem(item) {
    if (!window.confirm(`¿Desactivar "${item.nombre}" del catálogo POS?`)) return
    const result = await deactivatePOSProduct(item.id)
    if (result.error) {
      setOrdenError(`No se pudo desactivar el producto: ${result.error.message}`)
      return
    }
    setItems((current) => current.map((entry) => entry.id === item.id ? result.data : entry))
    setOrdenError("Producto POS desactivado.")
  }

  function agregarAOrden(item) {
    if (item.estado !== "activo") return
    const productionState = getProductProductionState(item, finalRecipes, productionAreas, activeCategories)
    if (!productionState.productionReady) {
      setOrdenError(`Producto ${item.nombre} no está listo para producción: ${productionState.issues.join(", ")}.`)
      return
    }
    if (mesaBloqueadaPorCobro) {
      setOrdenError("Esta mesa está en proceso de cobro. Devuelve la precuenta antes de agregar productos.")
      return
    }
    posDebug("producto seleccionado", {
      producto: item,
      recipeId: productRecipeId(item),
      productionAreaId: productProductionAreaId(item),
      mesa: ordenMesa,
      ordenActual: orden
    })
    setItemPendiente(item)
    setModificacionesPendientes("")
  }

  async function confirmarAgregarItem(modificaciones = "") {
    if (!itemPendiente) return
    if (!ordenMesa) {
      setOrdenError("Selecciona una mesa antes de agregar productos.")
      return
    }
    const notas = modificaciones.trim()
    let itemSaved = false
    try {
      let orderId = activeOrderId
      if (!orderId) {
        const created = await createOrGetOpenOrder({
          tableId: ordenMesa.mesaId,
          tableName: `Mesa ${ordenMesa.mesaNumero}`,
          areaId: ordenMesa.areaId,
          areaName: ordenMesa.areaNombre
        }, user)
        if (created.error) throw new Error(created.message || created.error.message)
        if (!created.data?.id) throw new Error("Supabase no devolvió la orden creada. Verifica la migración 010_pos_orders.sql.")
        orderId = created.data.id
        setCurrentOrder(created.data)
        setActiveOrderId(orderId)
      }
      const existe = orden.find((ordenItem) => ordenItem.id === itemPendiente.id && (ordenItem.modificaciones || "") === notas && ordenItem.status === "draft")
      if (existe) {
        const result = await updateOrderItemQuantity(existe.lineId, existe.cantidad + 1, existe.precio)
        if (result.error) throw new Error(result.message || result.error.message)
      } else {
        const result = await addItemToOrder(orderId, itemPendiente, 1, notas)
        if (result.error) throw new Error(result.message || result.error.message)
      }
      await cargarMesaDesdeSupabase(ordenMesa, orderId)
      itemSaved = true
    } catch (error) {
      console.error("Supabase POS add item error:", error)
      setOrdenError(`No se pudo agregar el producto: ${error.message}`)
    } finally {
      setItemPendiente(null)
      setModificacionesPendientes("")
    }
    if (!itemSaved) return
    setOrdenMessage("Producto agregado.")
    setOrdenError("")
    posDebug("orderItem creado", {
      productId: itemPendiente.id,
      recipeId: productRecipeId(itemPendiente),
      productionAreaId: productProductionAreaId(itemPendiente),
      cantidad: 1,
      mesa: ordenMesa
    })
  }

  async function cambiarCantidad(lineId, delta) {
    const item = orden.find((entry) => entry.lineId === lineId)
    if (!item) return
    const quantity = item.cantidad + delta
    try {
      if (quantity <= 0) {
        const result = await removeOrderItem(lineId)
        if (result.error) throw new Error(result.message || result.error.message)
        await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
        return
      }
      const result = await updateOrderItemQuantity(lineId, quantity, item.precio)
      if (result.error) throw new Error(result.message || result.error.message)
      await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
    } catch (error) {
      console.error("Supabase POS quantity error:", error)
      setOrdenError(`No se pudo actualizar la cantidad: ${error.message}`)
    }
  }

  async function eliminarItemActual(lineId) {
    try {
      const result = await removeOrderItem(lineId)
      if (result.error) throw new Error(result.message || result.error.message)
      await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
    } catch (error) {
      console.error("Supabase POS remove item error:", error)
      setOrdenError(`No se pudo eliminar el producto: ${error.message}`)
    }
  }

  async function guardarModificacionActual(lineId) {
    const result = await updateOrderItemNotes(lineId, modificacionActualTexto.trim())
    if (result.error) {
      setOrdenError(`No se pudo guardar la modificacion: ${result.message || result.error.message}`)
      return
    }
    await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
    setEditandoModificacionLineId(null)
    setModificacionActualTexto("")
  }

  async function handleSendOrderToProduction() {
    console.log("🔥 CLICK Enviar/preparar orden", {
      selectedTable: ordenMesa,
      currentOrder,
      orderItems: orden
    })
    if (sendingOrder) return
    setSendingOrder(true)
    setOrdenMessage("Procesando envío a producción...")
    setOrdenError("")
    setProductionErrors([])
    try {
      console.log("START send order")
      console.log("STEP 1 selectedTable", ordenMesa)
      console.log("STEP 2 currentOrder", currentOrder)
      if (!ordenMesa) throw new Error("Selecciona una mesa antes de enviar la orden.")
      if (!draftItems.length) throw new Error("No hay productos nuevos para enviar.")
      if (mesaBloqueadaPorCobro) throw new Error("Esta mesa está en proceso de cobro y no admite nuevas comandas.")

      const erroresDelivery = validarDelivery()
      setDeliveryErrors(erroresDelivery)
      if (Object.keys(erroresDelivery).length > 0) {
        throw new Error(`Faltan campos requeridos: ${Object.values(erroresDelivery).join(", ")}.`)
      }

      if (!activeOrderId) throw new Error("No existe una orden abierta en Supabase para esta mesa.")
      console.log("STEP 3 draftItems", draftItems)
      console.log("STEP 4 calling transactional RPC", activeOrderId)
      const result = await sendOrderToProduction(activeOrderId)
      if (result.error) throw new Error(result.message || result.error.message)
      console.log("STEP 5 RPC completed", result.data)
      setProductionErrors([])
      setDeliveryErrors({})
      if (esMesaDelivery) setDeliveryForm(emptyDeliveryForm)
      setOrdenMessage(`Orden enviada a producción. Inventario descontado. Tickets creados: ${(result.data.ticket_ids || []).length}.`)
      setOrdenError("")
      window.dispatchEvent(new Event("production-tickets-updated"))
      window.dispatchEvent(new Event("inventory-updated"))
      try {
        await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
      } catch (refreshError) {
        console.error("POS order sent but history refresh failed:", refreshError)
        setOrdenMessage(`Orden enviada a producción. Inventario descontado. No se pudo refrescar el historial: ${refreshError.message}`)
      }
    } catch (error) {
      console.error("SEND ORDER ERROR", error)
      setOrdenMessage("")
      setOrdenError(error?.message || "Error desconocido enviando orden.")
    } finally {
      console.log("END send order")
      setSendingOrder(false)
    }
  }

  async function handleClearDraftItems() {
    if (!activeOrderId || draftItems.length === 0) return
    if (sentItems.length > 0) {
      setOrdenError("Esta orden ya tiene productos enviados. Para cancelar debes solicitar autorizacion.")
      return
    }
    try {
      const result = await clearDraftItems(activeOrderId)
      if (result.error) throw result.error
      await cargarMesaDesdeSupabase(ordenMesa, activeOrderId)
      setOrdenMessage("Productos nuevos eliminados de la orden.")
      setOrdenError("")
    } catch (error) {
      setOrdenError(error.message || "No se pudo limpiar la orden.")
    }
  }

  async function handleMarkServed(item) {
    try {
      const result = await markOrderItemServed(item.lineId)
      if (result.error) throw new Error(result.message || result.error.message)
      await cargarMesaDesdeSupabase(ordenMesa, currentOrder.id)
      setOrdenMessage(`${item.nombre} marcado como servido.`)
      setOrdenError("")
    } catch (error) {
      setOrdenError(`No se pudo marcar servido: ${error.message}`)
    }
  }

  async function procesarOrdenExistente(orderId) {
    if (sendingOrder) return
    posDebug("click reenviar comanda detectado", { orderId })
    setSendingOrder(true)
    setOrdenError("Enviando productos pendientes y validando inventario...")
    try {
      const result = await sendOrderToProduction(orderId)
      if (result.error) throw new Error(result.message || result.error.message)
      setOrdenError("Orden enviada a producción. Inventario descontado.")
      window.dispatchEvent(new Event("production-tickets-updated"))
      window.dispatchEvent(new Event("inventory-updated"))
    } catch (error) {
      setOrdenError(error.message)
    } finally {
      setSendingOrder(false)
    }
  }

  async function openDiagnostic() {
    const ticketResult = await getProductionTickets()
    const tickets = ticketResult.data || []
    const productsWithRecipe = items.filter((item) => Boolean(productRecipeId(item)))
    const productsWithArea = items.filter((item) => Boolean(productProductionAreaId(item)))
    const productsReady = items.filter((item) => getProductProductionState(item, finalRecipes, productionAreas, activeCategories).productionReady)
    const result = {
      fuenteTicketsKDS: "Supabase: production_tickets",
      consumoInventario: "Supabase RPC transaccional: send_pos_order_to_production",
      fuenteProductosPOS: "Supabase: pos_products",
      productosPOS: items.length,
      productosConReceta: productsWithRecipe.length,
      productosConArea: productsWithArea.length,
      productosListos: productsReady.length,
      recetasFinalesSupabase: finalRecipes.length,
      areasProductivas: productionAreas.map((area) => area.name),
      ticketsRecientes: tickets.slice(0, 5),
      erroresActuales: ticketResult.error
        ? [...productionErrors, { message: ticketResult.error.message }]
        : productionErrors
    }
    posDebug("diagnóstico manual", result)
    setDiagnostic(result)
  }

  async function limpiarOrdenesLocalesAntiguas() {
    await clearLegacyPOSOrders()
    setOrdenMessage("Órdenes locales antiguas eliminadas. Las órdenes oficiales permanecen en Supabase.")
    setOrdenError("")
  }

  async function openProductDiagnostic(item) {
    const [productResult, linkResult] = await Promise.all([getPOSProductById(item.id), getPOSRecipeLink(item.id)])
    const officialProduct = productResult.data || item
    const localState = getProductProductionState(officialProduct, finalRecipes, productionAreas, activeCategories)
    const officialRecipe = officialProduct.recipe || localState.recipe
    const valid = Boolean(
      localState.active &&
      officialProduct.productionReady &&
      officialRecipe?.active &&
      String(officialRecipe?.id) === String(localState.recipeId) &&
      officialRecipe?.production_area_id === localState.areaId &&
      localState.area &&
      localState.category
    )
    const result = {
      productId: officialProduct.id,
      productName: officialProduct.nombre,
      source: "Supabase: pos_products",
      recipeId: productRecipeId(officialProduct) || "Sin receta",
      productionAreaId: productProductionAreaId(officialProduct) || "Sin área",
      posRecipeLink: linkResult.data ? `Encontrado (${linkResult.data.id})` : "No encontrado",
      recipe: officialRecipe?.name || "No encontrada",
      category: localState.category?.name || "No encontrada",
      area: localState.area?.name || "No encontrada",
      error: productResult.error?.message || linkResult.error?.message || "",
      issues: localState.issues,
      valid
    }
    posDebug("diagnóstico producto POS", result)
    setProductDiagnostic(result)
  }

  async function migrateLocalPOSProducts() {
    if (!localPOSProducts.length || migratingLocalProducts) return
    if (!window.confirm("Se crearán productos en Supabase a partir del catálogo POS local. Los incompletos quedarán inactivos. ¿Continuar?")) return
    setMigratingLocalProducts(true)
    let created = 0
    let incomplete = 0
    const failures = []
    const migratedIds = new Map()
    for (const legacyProduct of localPOSProducts) {
      const recipeId = productRecipeId(legacyProduct)
      const areaId = productProductionAreaId(legacyProduct)
      const recipe = finalRecipes.find((entry) => String(entry.id) === String(recipeId))
      const validForProduction = Boolean(
        recipe &&
        recipe.production_area_id === areaId &&
        productionAreas.some((area) => area.id === areaId) &&
        Number(legacyProduct.precio ?? legacyProduct.price ?? 0) > 0
      )
      const result = validForProduction
        ? await createOrUpdatePOSProductFromRecipe({
            ...recipe,
            id: recipe.id,
            name: legacyProduct.nombre || legacyProduct.name,
            description: legacyProduct.descripcion || legacyProduct.description,
            salePrice: legacyProduct.precio ?? legacyProduct.price,
            imageUrl: legacyProduct.imagen || legacyProduct.image,
            posCategoryId: productCategoryId(legacyProduct),
            categoryName: legacyProduct.categoria || productCategoryId(legacyProduct)
          })
        : await createPOSProduct({
            ...legacyProduct,
            name: legacyProduct.nombre || legacyProduct.name,
            price: Number(legacyProduct.precio ?? legacyProduct.price ?? 0),
            recipeId: recipe?.id || "",
            productionAreaId: productionAreas.some((area) => area.id === areaId) ? areaId : "",
            active: false,
            estado: "inactivo"
          })
      if (result.error) {
        failures.push(`${legacyProduct.nombre || legacyProduct.name}: ${result.error.message}`)
      } else {
        created += 1
        migratedIds.set(String(legacyProduct.id), result.data.id)
        if (!validForProduction) incomplete += 1
      }
    }
    if (migratedIds.size) {
      const markedProducts = storedLocalPOSProducts.map((product) => migratedIds.has(String(product.id))
        ? {
            ...product,
            supabaseProductId: migratedIds.get(String(product.id)),
            migratedToSupabaseAt: new Date().toISOString()
          }
        : product)
      localStorage.setItem("posItems", JSON.stringify(markedProducts))
    }
    localStorage.setItem("posItemsMigrationStatus", JSON.stringify({ migratedAt: new Date().toISOString(), imported: created, incomplete, failures }))
    setMigratingLocalProducts(false)
    const { data, error } = await getPOSProducts()
    if (error) {
      setOrdenError(`Migración terminada, pero no se pudo refrescar el catálogo: ${error.message}`)
      return
    }
    setItems(data || [])
    setPosCategories(loadPosCategories(data || []))
    setOrdenError(failures.length
      ? `Migración parcial: ${created} producto(s) creados; errores: ${failures.join(" | ")}`
      : `Migración completada: ${created} producto(s) creados en Supabase; ${incomplete} quedaron inactivos por configuración incompleta.`)
  }

  function solicitarRequisicion(error) {
    createStockRequisition(error.stockError, user)
    setOrdenError(`Requisición creada para ${error.stockError.itemName} hacia ${error.stockError.areaName}.`)
  }

  async function solicitarCuenta(order) {
    try {
      const result = await requestOrderBill(order.id)
      if (result.error) throw new Error(result.message || result.error.message)
      await cargarMesaDesdeSupabase(ordenMesa, order.id)
      setOrdenMessage("Cuenta solicitada. Lista para enviar a caja.")
      setOrdenError("")
    } catch (error) {
      setOrdenError(`No se pudo solicitar la cuenta: ${error.message}`)
    }
  }

  function imprimirPrecuenta(order) {
    setOrdenError(`No se imprimió ${order.tableName || "la orden"}: Caja aún requiere migración a pos_orders.`)
  }

  async function enviarCuentaACaja(order) {
    try {
      const result = await sendOrderToCashier(order.id)
      if (result.error) throw new Error(result.message || result.error.message)
      await cargarMesaDesdeSupabase(ordenMesa, order.id)
      setOrdenMessage("Cuenta enviada a caja.")
      setOrdenError("")
    } catch (error) {
      setOrdenError(`No se pudo enviar a caja: ${error.message}`)
    }
  }

  function cancelarItemEnviado(orderId, item) {
    const reason = window.prompt("Motivo de cancelación:")
    if (!reason) return
    if (!puedeEditarOrdenes) {
      guardarOrdenes(ordenesEnviadas.map((order) => order.id !== orderId ? order : ({
        ...order,
        items: order.items.map((line) => line.lineId !== item.lineId ? line : ({
          ...line,
          cancellationRequested: true,
          cancellationReason: reason
        }))
      })))
      setOrdenError("Solicitud de cancelación registrada. Un supervisor debe autorizar reversión o merma.")
      return
    }
    if (!item.inventoryConsumed || item.status === "draft") {
      guardarOrdenes(ordenesEnviadas.map((order) => order.id !== orderId ? order : ({ ...order, items: order.items.map((line) => line.lineId !== item.lineId ? line : ({ ...line, status: "cancelled", cancellationReason: reason })) })))
      return
    }
    if (item.inventoryConsumed) {
      setOrdenError("El consumo ya está registrado en Supabase. La reversión requiere una operación auditada y no se modificó inventario.")
      return
    }
    setOrdenError("Cancelación pendiente de migrar a la operación auditada de Supabase.")
  }

  function cambiarEstadoOrden(ordenId, estado) {
    if (!puedeEditarOrdenes) return
    if (estado === "cancelada") {
      setOrdenError("Cancela cada producto indicando si corresponde reversión o merma.")
      return
    }
    const statusByOrderState = {
      enviada: "sent_to_production",
      "en preparación": "in_production",
      preparada: "prepared",
      entregada: "served",
    }
    guardarOrdenes(ordenesEnviadas.map((ordenItem) =>
      ordenItem.id === ordenId
        ? {
            ...ordenItem,
            estado,
            status: ordenItem.status,
            items: ordenItem.items.map((item) => (
              ["draft", "cancelled"].includes(item.status || "draft")
                ? item
                : { ...item, status: statusByOrderState[estado] || item.status }
            )),
            actualizadoEn: new Date().toLocaleString(),
            actualizadoPor: posSession?.username || user?.username
          }
        : ordenItem
    ))
  }

  function cambiarCantidadOrdenEnviada(ordenId, lineId, delta) {
    if (!puedeEditarOrdenes) {
      setOrdenError("Esta orden ya fue enviada y no puede modificarse. Solicita autorización de supervisor.")
      return
    }
    const line = ordenesEnviadas.find((order) => order.id === ordenId)?.items.find((item) => item.lineId === lineId)
    if (line?.inventoryConsumed || line?.status !== "draft") {
      setOrdenError("No puedes cambiar la cantidad después de enviar la comanda. Cancela y registra reversión o merma si aplica.")
      return
    }
    guardarOrdenes(ordenesEnviadas.map((ordenItem) => {
      if (ordenItem.id !== ordenId) return ordenItem
      const itemsActualizados = ordenItem.items
        .map((item) => item.lineId === lineId ? { ...item, cantidad: item.cantidad + delta } : item)
        .filter((item) => item.cantidad > 0)
      return {
        ...ordenItem,
        items: itemsActualizados,
        total: itemsActualizados.reduce((total, item) => total + item.precio * item.cantidad, 0),
        actualizadoEn: new Date().toLocaleString(),
        actualizadoPor: posSession?.username || user?.username
      }
    }))
  }

  function iniciarEdicionModificacionEnviada(ordenId, item) {
    if (!puedeEditarOrdenes) {
      setOrdenError("Esta orden ya fue enviada y no puede modificarse. Solicita autorización de supervisor.")
      return
    }
    setEdicionEnviada({
      ordenId,
      lineId: item.lineId,
      modificaciones: item.modificaciones || "",
      motivo: "",
      error: ""
    })
  }

  function guardarModificacionEnviada() {
    if (!edicionEnviada) return
    if (!edicionEnviada.motivo.trim()) {
      setEdicionEnviada((actual) => ({ ...actual, error: "El motivo de edición es obligatorio." }))
      return
    }

    const ahora = new Date()
    guardarOrdenes(ordenesEnviadas.map((ordenItem) => {
      if (ordenItem.id !== edicionEnviada.ordenId) return ordenItem
      const itemsActualizados = ordenItem.items.map((item) => {
        if (item.lineId !== edicionEnviada.lineId) return item
        return {
          ...item,
          modificaciones: edicionEnviada.modificaciones.trim(),
          historialCambios: [
            ...(item.historialCambios || []),
            {
              id: ahora.getTime(),
              campo: "modificaciones",
              anterior: item.modificaciones || "",
              nuevo: edicionEnviada.modificaciones.trim(),
              motivo: edicionEnviada.motivo.trim(),
              usuario: posSession?.username || user?.username,
              fechaHora: ahora.toLocaleString()
            }
          ]
        }
      })
      return {
        ...ordenItem,
        items: itemsActualizados,
        actualizadoEn: ahora.toLocaleString(),
        actualizadoPor: posSession?.username || user?.username
      }
    }))
    setEdicionEnviada(null)
  }

  function trasladarMesa() {
    if (!puedeEditarOrdenes || !ordenMesa || !mesaDestinoId) return
    const [destinoAreaIdRaw, destinoMesaIdRaw] = mesaDestinoId.split(":")
    const destinoArea = areasRestaurante.find((area) => String(area.id) === destinoAreaIdRaw)
    const destinoMesa = destinoArea?.mesas.find((mesa) => String(mesa.id) === destinoMesaIdRaw)
    if (!destinoArea || !destinoMesa || mesaTieneOrdenesActivas(destinoArea.id, destinoMesa.id)) return

    const origenKey = obtenerMesaKey(ordenMesa.areaId, ordenMesa.mesaId)
    const destinoKey = obtenerMesaKey(destinoArea.id, destinoMesa.id)
    guardarOrdenes(ordenesEnviadas.map((ordenItem) =>
      ordenItem.mesaKey === origenKey
        ? {
            ...ordenItem,
            mesaKey: destinoKey,
            areaId: destinoArea.id,
            mesaId: destinoMesa.id,
            area: destinoArea.nombre,
            mesa: destinoMesa.name || destinoMesa.numero,
            trasladadaDesde: `${ordenMesa.areaNombre} · Mesa ${ordenMesa.mesaNumero}`,
            trasladadaEn: new Date().toLocaleString(),
            trasladadaPor: posSession?.username || user?.username
          }
        : ordenItem
    ))
    guardarAreas(areasRestaurante.map((area) => ({
      ...area,
      mesas: area.mesas.map((mesa) => {
        if (area.id === ordenMesa.areaId && mesa.id === ordenMesa.mesaId) return { ...mesa, estado: "disponible", status: "disponible" }
        if (area.id === destinoArea.id && mesa.id === destinoMesa.id) return { ...mesa, estado: "ocupada", status: "ocupada" }
        return mesa
      })
    })))
    setOrdenMesa({ areaId: destinoArea.id, mesaId: destinoMesa.id, areaNombre: destinoArea.nombre, mesaNumero: destinoMesa.name || destinoMesa.numero })
    setMesaDestinoId("")
    setTrasladoActivo(false)
  }

  if (!POS_ROLES.includes(user?.role)) {
    return <section style={pageStyle}><h1>Punto de Venta</h1><div style={errorBoxStyle}>No tienes permiso para acceder al Punto de Venta.</div></section>
  }

  return (
    <section style={pageStyle}>
      {section === "agregar-item" ? (
        <>
          <header style={headerStyle}>
            <h1>Agregar Item</h1>
            <div style={buttonRowStyle}>
              {user?.role === "admin" && localPOSProducts.length > 0 && <button type="button" disabled={migratingLocalProducts} onClick={migrateLocalPOSProducts} style={secondaryButtonStyle}>{migratingLocalProducts ? "Migrando..." : "Migrar productos POS locales"}</button>}
              <button type="button" onClick={() => { setMostrarFormulario((actual) => !actual); setEditandoId(null); setForm(emptyActiveItemForm()); setErrores({}); setOrdenError("") }} style={primaryButtonStyle}>
                + Nuevo producto POS
              </button>
            </div>
          </header>
          <div style={successInlineStyle}>Fuente oficial del catálogo POS: <strong>Supabase `public.pos_products`</strong>.</div>
          {localPOSProducts.length > 0 && <div style={warningBoxStyle}>Existen productos POS locales antiguos. Deben migrarse a Supabase; no se usan como catálogo oficial.</div>}
          {ordenError && <div style={errorBoxStyle}>{ordenError}</div>}

          {mostrarFormulario && (
            <form onSubmit={guardarItem} style={formCardStyle}>
              {Object.keys(errores).length > 0 && (
                <div style={errorBoxStyle}>Faltan campos requeridos: {Object.values(errores).join(", ")}.</div>
              )}
              <div style={formGridStyle}>
                <input placeholder="Nombre del item" value={form.nombre} onChange={(e) => actualizarCampo("nombre", e.target.value)} style={errores.nombre ? inputErrorStyle : inputStyle} />
                <select value={form.categoriaId} onChange={(e) => seleccionarCategoriaProducto(e.target.value)} style={errores.categoria ? inputErrorStyle : inputStyle}>
                  <option value="">Categoría POS</option>
                  {posCategories.filter((category) => category.active !== false || category.id === form.categoriaId).sort((a, b) => a.sortOrder - b.sortOrder).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <input type="number" min="0" step="0.01" placeholder="Precio de venta" value={form.precio} onChange={(e) => actualizarCampo("precio", e.target.value)} style={errores.precio ? inputErrorStyle : inputStyle} />
                <select value={form.estado} onChange={(e) => actualizarCampo("estado", e.target.value)} style={errores.estado ? inputErrorStyle : inputStyle}><option value="activo">Activo</option><option value="inactivo">Inactivo</option></select>
                <input placeholder="Código/SKU opcional" value={form.sku} onChange={(e) => actualizarCampo("sku", e.target.value)} style={inputStyle} />
                <select value={form.areaProduccion} onChange={(e) => actualizarCampo("areaProduccion", e.target.value)} style={errores.areaProduccion ? inputErrorStyle : inputStyle}>
                  <option value="">Área de producción</option>
                  {productionAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
                <select
                  value={form.recipeId}
                  onChange={(e) => {
                    const recipe = finalRecipes.find((entry) => String(entry.id) === e.target.value)
                    setForm((actual) => ({ ...actual, recipeId: e.target.value, areaProduccion: recipe?.production_area_id || actual.areaProduccion }))
                    setErrores((actual) => {
                      const next = { ...actual }
                      delete next.recipeId
                      delete next.areaProduccion
                      return next
                    })
                  }}
                  style={errores.recipeId ? inputErrorStyle : inputStyle}
                >
                  <option value="">Receta estandarizada conectada</option>
                  {finalRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
                </select>
                <input placeholder="Tiempo estimado de preparación" value={form.tiempoPreparacion} onChange={(e) => actualizarCampo("tiempoPreparacion", e.target.value)} style={errores.tiempoPreparacion ? inputErrorStyle : inputStyle} />
                <input type="number" min="0" step="0.01" placeholder="Costo estimado si existe" value={form.costoEstimado} onChange={(e) => actualizarCampo("costoEstimado", e.target.value)} style={inputStyle} />
              </div>
              <textarea placeholder="Descripción" value={form.descripcion} onChange={(e) => actualizarCampo("descripcion", e.target.value)} style={errores.descripcion ? textAreaErrorStyle : textAreaStyle} />
              <textarea placeholder="Ingredientes relacionados si aplica" value={form.ingredientesRelacionados} onChange={(e) => actualizarCampo("ingredientesRelacionados", e.target.value)} style={textAreaStyle} />
              <input type="file" accept="image/*" onChange={cargarImagen} style={errores.imagen ? inputErrorStyle : inputStyle} />
              {form.imagen && <img src={form.imagen} alt={form.nombre || "Item"} style={previewStyle} />}
              <div style={readinessPanelStyle}>
                <strong>Estado producción</strong>
                <span style={selectedRecipe ? availableStyle : unavailableStyle}>{selectedRecipe ? `✓ Receta conectada: ${selectedRecipe.name}` : "✗ Sin receta válida"}</span>
                <span style={selectedProductionArea ? availableStyle : unavailableStyle}>{selectedProductionArea ? `✓ Área producción: ${selectedProductionArea.name}` : "✗ Sin área válida"}</span>
                <span style={formReadyForValidation ? availableStyle : unavailableStyle}>{formReadyForValidation ? "✓ Se validará vínculo Supabase al guardar" : "✗ Configuración incompleta"}</span>
              </div>
              <div style={buttonRowStyle}>
                <button type="submit" style={primaryButtonStyle}>{editandoId ? "Guardar cambios" : "Agregar item"}</button>
                <button type="button" onClick={() => { setMostrarFormulario(false); setEditandoId(null); setForm(emptyActiveItemForm()); setErrores({}) }} style={secondaryButtonStyle}>Cancelar</button>
              </div>
            </form>
          )}

          <div style={itemListStyle}>
                {items.map((item) => {
                  const state = getProductProductionState(item, finalRecipes, productionAreas, activeCategories)
                  return (
                  <article key={item.id} style={itemRowStyle}>
                <img src={item.imagen} alt={item.nombre} style={thumbStyle} />
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: "0 0 4px" }}>{item.nombre}</h3>
                  <p style={mutedStyle}>{item.categoria} · {productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || productProductionAreaId(item)} · Q{item.precio.toFixed(2)} · {item.estado}</p>
                  <ProductionBadges state={state} />
                </div>
                <button type="button" onClick={() => editarItem(item)} style={secondaryButtonStyle}>Editar</button>
                {state.active && <button type="button" onClick={() => desactivarItem(item)} style={dangerMiniButtonStyle}>Desactivar</button>}
                {user?.role === "admin" && <button type="button" onClick={() => openProductDiagnostic(item)} style={secondaryButtonStyle}>Diagnóstico producto POS</button>}
              </article>
                  )
                })}
          </div>
        </>
      ) : section === "categorias" ? (
        puedeAdministrarCategorias ? (
          <>
            <header style={headerStyle}>
              <div>
                <h1>Secciones del menú</h1>
                <p style={mutedStyle}>Define categorías visibles y el área que recibe cada ticket de producción.</p>
              </div>
            </header>
            <form onSubmit={guardarCategoria} style={categoryEditorStyle}>
              {categoryError && <div style={errorBoxStyle}>{categoryError}</div>}
              <div style={quickChoiceSectionStyle}>
                <label style={fieldTitleStyle}>Sugerencias rápidas</label>
                <div style={quickChoiceGridStyle}>
                  {CATEGORY_QUICK_OPTIONS.map((option) => (
                    <button key={option.name} type="button" onClick={() => aplicarCategoriaRapida(option)} style={quickChoiceButtonStyle}>
                      <span>{option.icon}</span>
                      {option.name}
                    </button>
                  ))}
                </div>
              </div>
              <div style={categoryEditorColumnsStyle}>
                <div style={categoryFieldsStyle}>
                  <label style={fieldStackStyle}>
                    <span style={fieldTitleStyle}>Nombre de la categoría</span>
                    <input placeholder="Ej. Pizzas, Entradas, Barra, Cafetería, Postres" value={categoryForm.name} onChange={(e) => setCategoryForm((actual) => ({ ...actual, name: e.target.value }))} style={inputStyle} />
                  </label>
                  <div style={fieldStackStyle}>
                    <span style={fieldTitleStyle}>Icono de la categoría</span>
                    <span style={fieldHintStyle}>Selecciona un icono</span>
                    <div style={iconPickerGridStyle}>
                      {CATEGORY_ICON_OPTIONS.map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          onClick={() => setCategoryForm((actual) => ({ ...actual, icon: option.icon }))}
                          title={option.label}
                          style={categoryForm.icon === option.icon ? iconPickerSelectedStyle : iconPickerButtonStyle}
                        >
                          <span style={iconPickerEmojiStyle}>{option.icon}</span>
                          <span>{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <label style={fieldStackStyle}>
                    <span style={fieldTitleStyle}>Área que recibe el ticket</span>
                    <select value={categoryForm.productionAreaId} onChange={(e) => setCategoryForm((actual) => ({ ...actual, productionAreaId: e.target.value }))} style={inputStyle}>
                      <option value="">Selecciona el área de producción</option>
                      {productionAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                    </select>
                  </label>
                  <div style={fieldStackStyle}>
                    <span style={fieldTitleStyle}>Color de la categoría</span>
                    <span style={fieldHintStyle}>Selecciona un color</span>
                    <div style={colorControlsStyle}>
                      <input type="color" value={categoryForm.color} onChange={(e) => setCategoryForm((actual) => ({ ...actual, color: e.target.value }))} style={colorInputStyle} />
                      <div style={colorPaletteStyle}>
                        {CATEGORY_COLOR_OPTIONS.map((color) => (
                          <button key={color} type="button" title={color} onClick={() => setCategoryForm((actual) => ({ ...actual, color }))} style={{ ...colorSwatchButtonStyle, backgroundColor: color, outline: categoryForm.color === color ? "2px solid #f8fafc" : "none" }} />
                        ))}
                      </div>
                    </div>
                  </div>
                  <label style={fieldStackStyle}>
                    <span style={fieldTitleStyle}>Descripción de la categoría</span>
                    <textarea placeholder="Ej. Productos que se muestran en esta sección del POS" value={categoryForm.description} onChange={(e) => setCategoryForm((actual) => ({ ...actual, description: e.target.value }))} style={textAreaStyle} />
                  </label>
                  <label style={activeToggleStyle}>
                    <input type="checkbox" checked={categoryForm.active} onChange={(e) => setCategoryForm((actual) => ({ ...actual, active: e.target.checked }))} />
                    <span>
                      <strong>Categoría activa</strong>
                      <small>Visible como sección en el POS operativo</small>
                    </span>
                  </label>
                </div>
                <aside style={categoryPreviewPanelStyle}>
                  <span style={fieldTitleStyle}>Vista previa</span>
                  <div style={{ ...categoryPreviewTabStyle, backgroundColor: categoryForm.color || "#334155" }}>
                    <span style={categoryPreviewIconStyle}>{categoryForm.icon || "?"}</span>
                    <strong>{categoryForm.name || "Nombre de categoría"}</strong>
                  </div>
                  <p style={mutedStyle}>Área: {productionAreas.find((area) => area.id === categoryForm.productionAreaId)?.name || "Selecciona un área"}</p>
                  <p style={mutedStyle}>{categoryForm.description || "La descripción aparecerá aquí."}</p>
                  <span style={categoryForm.active ? activeCategoryBadgeStyle : inactiveCategoryBadgeStyle}>{categoryForm.active ? "Activa en POS" : "Oculta en POS"}</span>
                </aside>
              </div>
              <div style={buttonRowStyle}>
                <button type="submit" style={primaryButtonStyle}>{editingCategoryId ? "Guardar categoría" : "Crear categoría"}</button>
                {editingCategoryId && <button type="button" onClick={() => { setEditingCategoryId(""); setCategoryForm(emptyCategoryForm); setCategoryError("") }} style={secondaryButtonStyle}>Cancelar</button>}
              </div>
            </form>
            <div style={categoryTableStyle}>
              <div style={categoryHeaderStyle}>
                <span>Orden</span><span>Sección</span><span>Área de producción</span><span>Estado</span><span>Productos</span><span>Acciones</span>
              </div>
              {[...posCategories].sort((a, b) => a.sortOrder - b.sortOrder).map((category) => {
                const productCount = items.filter((item) => (item.categoriaId || normalizeId(item.categoria)) === category.id).length
                return (
                  <div key={category.id} style={categoryRowStyle}>
                    <span>{category.sortOrder}</span>
                    <span style={categoryIdentityStyle}><span style={{ ...categorySwatchStyle, backgroundColor: category.color }}>{category.icon || category.name.charAt(0)}</span><strong>{category.name}</strong></span>
                    <span>{productionAreas.find((area) => area.id === category.productionAreaId)?.name || category.productionAreaId}</span>
                    <span>{category.active ? "Activa" : "Inactiva"}</span>
                    <span>{productCount}</span>
                    <span style={buttonRowStyle}>
                      <button type="button" onClick={() => moverCategoria(category.id, -1)} style={smallButtonStyle} title="Subir orden">↑</button>
                      <button type="button" onClick={() => moverCategoria(category.id, 1)} style={smallButtonStyle} title="Bajar orden">↓</button>
                      <button type="button" onClick={() => editarCategoria(category)} style={secondaryButtonStyle}>Editar</button>
                      {category.active && <button type="button" onClick={() => desactivarCategoria(category)} style={dangerMiniButtonStyle}>Desactivar</button>}
                      <button type="button" onClick={() => eliminarCategoria(category)} style={dangerMiniButtonStyle}>Eliminar</button>
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div style={errorBoxStyle}>No tienes permiso para administrar secciones del menú.</div>
        )
      ) : section === "croquis" ? (
        puedeAdministrarCroquis ? (
          <>
            <header style={headerStyle}>
              <h1>Croquis del Restaurante</h1>
            </header>

            <section style={floorPlanSectionStyle}>
              <div style={layoutToolbarStyle}>
                <div style={buttonRowStyle}>
                  <button type="button" onClick={agregarMesa} style={primaryButtonStyle} disabled={!areaActiva || !editandoCroquis}>+ Mesa</button>
                  <button type="button" onClick={() => { setMostrarAreaForm((actual) => !actual); setEditandoAreaId(null); setAreaForm(emptyAreaForm); setAreaErrors({}) }} style={secondaryButtonStyle}>+ Area / nivel</button>
                  <button type="button" onClick={() => setEditandoCroquis((actual) => !actual)} style={editandoCroquis ? activeTabStyle : secondaryButtonStyle}>
                    {editandoCroquis ? "Modo edicion" : "Modo operacion"}
                  </button>
                </div>
                <div style={buttonRowStyle}>
                  <label style={snapToggleStyle}>
                    <input type="checkbox" checked={layoutSettings.snapToGrid} onChange={(event) => setLayoutSettings((actual) => ({ ...actual, snapToGrid: event.target.checked }))} />
                    Snap grid
                  </label>
                  <button type="button" title="Alejar" onClick={() => setLayoutSettings((actual) => ({ ...actual, zoom: Math.max(0.7, Number((actual.zoom - 0.1).toFixed(1))) }))} style={smallButtonStyle}>-</button>
                  <span style={zoomValueStyle}>{Math.round(layoutSettings.zoom * 100)}%</span>
                  <button type="button" title="Acercar" onClick={() => setLayoutSettings((actual) => ({ ...actual, zoom: Math.min(1.4, Number((actual.zoom + 0.1).toFixed(1))) }))} style={smallButtonStyle}>+</button>
                  <button type="button" onClick={() => setLayoutSettings((actual) => ({ ...actual, zoom: 1 }))} style={secondaryButtonStyle}>Reset</button>
                  <button type="button" onClick={guardarLayoutManual} style={secondaryButtonStyle}>Guardar layout</button>
                </div>
              </div>
              {layoutMessage && <div style={successInlineStyle}>{layoutMessage}</div>}
              {mostrarAreaForm && (
                <form onSubmit={guardarArea} style={areaFormStyle}>
                  {Object.keys(areaErrors).length > 0 && <div style={errorBoxStyle}>Faltan campos requeridos: {Object.values(areaErrors).join(", ")}.</div>}
                  <label style={fieldStackStyle}><span style={fieldTitleStyle}>Nombre del area / nivel</span><input placeholder="Ej. Primer nivel, Terraza" value={areaForm.name} onChange={(e) => setAreaForm((actual) => ({ ...actual, name: e.target.value }))} style={areaErrors.name ? inputErrorStyle : inputStyle} /></label>
                  <label style={fieldStackStyle}><span style={fieldTitleStyle}>Descripcion</span><input placeholder="Ej. Salon principal" value={areaForm.description} onChange={(e) => setAreaForm((actual) => ({ ...actual, description: e.target.value }))} style={inputStyle} /></label>
                  <label style={fieldStackStyle}><span style={fieldTitleStyle}>Ancho del plano</span><input type="number" min="400" value={areaForm.width} onChange={(e) => setAreaForm((actual) => ({ ...actual, width: e.target.value }))} style={areaErrors.width ? inputErrorStyle : inputStyle} /></label>
                  <label style={fieldStackStyle}><span style={fieldTitleStyle}>Alto del plano</span><input type="number" min="300" value={areaForm.height} onChange={(e) => setAreaForm((actual) => ({ ...actual, height: e.target.value }))} style={areaErrors.height ? inputErrorStyle : inputStyle} /></label>
                  {editandoAreaId && <label style={snapToggleStyle}><input type="checkbox" checked={areaForm.active} onChange={(e) => setAreaForm((actual) => ({ ...actual, active: e.target.checked }))} />Area activa</label>}
                  <button type="submit" style={primaryButtonStyle}>{editandoAreaId ? "Guardar área" : "Crear área"}</button>
                </form>
              )}

              <div style={tabsStyle}>
                {[...areasRestaurante].sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder)).map((area) => (
                  <div key={area.id} style={areaTabGroupStyle}>
                    <button type="button" disabled={area.active === false} onClick={() => { setAreaActivaId(area.id); setMesaSeleccionada(null) }} style={areaActiva?.id === area.id ? activeTabStyle : area.active === false ? disabledButtonStyle : tabStyle}>{area.nombre}</button>
                    <button type="button" onClick={() => moverArea(area.id, -1)} style={smallButtonStyle} title="Subir">↑</button>
                    <button type="button" onClick={() => moverArea(area.id, 1)} style={smallButtonStyle} title="Bajar">↓</button>
                    <button type="button" onClick={() => editarArea(area)} style={smallButtonStyle}>Editar</button>
                    {area.active !== false && <button type="button" onClick={() => desactivarArea(area.id)} style={dangerMiniButtonStyle}>Desactivar</button>}
                  </div>
                ))}
              </div>

              {areaActiva ? (
                <div style={floorPlanLayoutStyle}>
                  <div
                    ref={floorPlanRef}
                    onPointerMove={moverMesa}
                    onPointerUp={terminarArrastreMesa}
                    onPointerCancel={terminarArrastreMesa}
                    style={{
                      ...floorPlanStyle,
                      minHeight: `${Math.max(360, areaActiva.height || 520)}px`,
                      backgroundSize: `${layoutSettings.gridSize * layoutSettings.zoom}px ${layoutSettings.gridSize * layoutSettings.zoom}px`
                    }}
                  >
                    {areaActiva.mesas.map((mesa, index) => (
                      <TableWithChairs
                        key={mesa.id}
                        table={normalizeLayoutTable(mesa, areaActiva.id, index)}
                        selected={mesaSeleccionada === mesa.id}
                        editing={editandoCroquis}
                        zoom={layoutSettings.zoom}
                        onPointerDown={(event) => iniciarArrastreMesa(event, mesa)}
                        onClick={() => editandoCroquis ? seleccionarMesaParaEditar(mesa) : seleccionarMesaOperacion(mesa)}
                      />
                    ))}
                  </div>
                  {mesaSeleccionadaActual ? (
                    <form onSubmit={guardarMesaEditada} style={tableEditPanelStyle}>
                      <h3 style={{ marginTop: 0 }}>Editar mesa</h3>
                      <div style={tablePreviewStyle}><TableWithChairs table={{ ...mesaSeleccionadaActual, x: 50, y: 50, name: mesaForm.name || mesaSeleccionadaActual.name, capacity: Number(mesaForm.capacity || 1), status: mesaForm.status, shape: mesaForm.shape }} selected zoom={0.9} /></div>
                      {mesaError && <div style={errorBoxStyle}>{mesaError}</div>}
                      <label style={fieldStackStyle}><span style={fieldTitleStyle}>Nombre de mesa</span><input placeholder="Ej. M1, Terraza 1, Barra 3" value={mesaForm.name} onChange={(e) => setMesaForm((actual) => ({ ...actual, name: e.target.value }))} style={inputStyle} /></label>
                      <label style={fieldStackStyle}><span style={fieldTitleStyle}>Capacidad / personas</span><input type="number" min="1" value={mesaForm.capacity} onChange={(e) => setMesaForm((actual) => ({ ...actual, capacity: e.target.value }))} style={inputStyle} /></label>
                      <label style={fieldStackStyle}><span style={fieldTitleStyle}>Estado</span><select value={mesaForm.status} onChange={(e) => setMesaForm((actual) => ({ ...actual, status: e.target.value }))} style={inputStyle}>
                        <option value="disponible">Disponible</option>
                        <option value="ocupada">Ocupada</option>
                        <option value="reservada">Reservada</option>
                        <option value="limpieza">Limpieza</option>
                        <option value="inactiva">Inactiva</option>
                      </select></label>
                      <label style={fieldStackStyle}><span style={fieldTitleStyle}>Forma de mesa</span><select value={mesaForm.shape} onChange={(e) => setMesaForm((actual) => ({ ...actual, shape: e.target.value }))} style={inputStyle}>
                        <option value="square">Cuadrada</option>
                        <option value="round">Redonda</option>
                        <option value="rectangular">Rectangular</option>
                      </select></label>
                      <label style={fieldStackStyle}><span style={fieldTitleStyle}>Area / nivel</span><select value={mesaForm.areaId} onChange={(e) => setMesaForm((actual) => ({ ...actual, areaId: e.target.value }))} style={inputStyle}>
                        {activeFloorAreas.map((area) => <option key={area.id} value={area.id}>{area.nombre}</option>)}
                      </select></label>
                      <div style={buttonRowStyle}>
                        <button type="submit" style={primaryButtonStyle}>Guardar mesa</button>
                        <button type="button" onClick={duplicarMesa} style={secondaryButtonStyle}>Duplicar</button>
                        <button type="button" onClick={() => eliminarMesa(mesaSeleccionada)} style={dangerButtonStyle}>Eliminar mesa</button>
                      </div>
                    </form>
                  ) : (
                    <aside style={tableEditPanelStyle}>
                      <h3 style={{ margin: 0 }}>Editar mesa</h3>
                      <p style={mutedStyle}>Selecciona una mesa para editarla.</p>
                    </aside>
                  )}
                </div>
              ) : (
                <div style={emptyPlanStyle}>Agrega un área para crear el croquis del restaurante.</div>
              )}
            </section>
          </>
        ) : (
          <section style={pageStyle}><h1>Croquis del Restaurante</h1><div style={errorBoxStyle}>No tienes permiso para administrar el croquis del restaurante.</div></section>
        )
      ) : (
        <>
          <header className="pos-operation-header" style={headerStyle}>
            <div>
              <p className="pos-operation-eyebrow">Servicio de mesas</p>
              <h1>Punto de Venta</h1>
              <p className="pos-operation-subtitle">Toma pedidos, envía a cocina y atiende productos listos.</p>
            </div>
            {user?.role === "admin" && <button type="button" onClick={limpiarOrdenesLocalesAntiguas} style={secondaryButtonStyle}>Limpiar órdenes locales antiguas</button>}
            {POS_DEBUG && user?.role === "admin" && <button type="button" onClick={openDiagnostic} style={secondaryButtonStyle}>Diagnóstico POS → KDS</button>}
            {posSession && <span style={sessionBadgeStyle}>Operador: {posSession.name || posSession.username}</span>}
            {posSession && <span style={posRealtimeActive ? liveBadgeStyle : connectingBadgeStyle}><i style={posRealtimeActive ? liveDotStyle : connectingDotStyle} />{posRealtimeActive ? "En vivo" : "Conectando..."}</span>}
          </header>
          {POS_DEBUG && puedeVerAuditoria && <div style={successInlineStyle}>Catálogo oficial conectado y consumo por receta activo.</div>}
          {realtimeNotice && <div style={liveNoticeStyle}>{realtimeNotice}</div>}
          {itemsLoading && <div style={mutedStyle}>Cargando productos POS desde Supabase...</div>}
          {invalidActiveProducts.length > 0 && (
            <div style={warningBoxStyle}>{invalidActiveProducts.length} producto(s) activo(s) no se mostrarán para venta porque no están listos para producción. Corrígelos en Agregar Item.</div>
          )}

          <div className="pos-operation-shell" style={posShellStyle}>
              <main className="pos-menu-panel" style={menuPanelStyle}>
                <div className="pos-catalog-search" style={catalogSearchStyle}>
                  <input
                    type="search"
                    placeholder="Buscar producto para agregar..."
                    value={productSearch}
                    onChange={(event) => setProductSearch(event.target.value)}
                    style={inputStyle}
                  />
                  <small style={mutedStyle}>Solo se muestran productos activos y listos para producción.</small>
                </div>
                <div className="pos-category-strip" style={tabsStyle}>
                  {activeCategories.map((category) => (
                    <button key={category.id} type="button" onClick={() => setCategoriaActiva(category.id)} style={categoriaActiva === category.id ? activeTabStyle : tabStyle}>
                      {category.icon && <span style={tabIconStyle}>{category.icon}</span>}
                      {category.name}
                    </button>
                  ))}
                </div>
                <section className="pos-floor-panel" style={floorPlanSectionStyle}>
                  <div style={headerStyle}>
                    <div>
                      <h2 style={{ margin: 0 }}>Croquis del restaurante</h2>
                      <p style={mutedStyle}>Selecciona una mesa para asociarla a la orden actual.</p>
                    </div>
                  </div>

                  <div style={tabsStyle}>
                    {activeFloorAreas.map((area) => (
                      <button key={area.id} type="button" onClick={() => { setAreaActivaId(area.id); setMesaSeleccionada(null) }} style={areaActiva?.id === area.id ? activeTabStyle : tabStyle}>{area.nombre}</button>
                    ))}
                  </div>

                  {areaActiva ? (
                    <div style={floorPlanLayoutStyle}>
                      <div className="pos-floor-canvas" style={{ ...floorPlanStyle, minHeight: `${Math.max(360, areaActiva.height || 520)}px` }}>
                        {areaActiva.mesas.map((mesa, index) => (
                          <TableWithChairs
                            key={mesa.id}
                            table={{
                              ...normalizeLayoutTable(mesa, areaActiva.id, index),
                              activeMinutes: mesa.orderCreatedAt ? minutosTranscurridos(mesa.orderCreatedAt) : null
                            }}
                            selected={ordenMesa?.mesaId === mesa.id}
                            onClick={() => seleccionarMesaOperacion(mesa)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={emptyPlanStyle}>Agrega un área para crear el croquis del restaurante.</div>
                  )}
                </section>
                <div className="pos-menu-grid" style={menuGridStyle}>
                  {itemsCategoria.map((item) => (
                    <article className="pos-product-card" key={item.id} style={menuCardStyle}>
                      <img src={item.imagen} alt={item.nombre} style={menuImageStyle} />
                      <h3>{item.nombre}</h3>
                      <p style={mutedStyle}>Q{item.precio.toFixed(2)}</p>
                      <p style={mutedStyle}>Producción: {productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || productProductionAreaId(item)}</p>
                      <span style={readyMenuBadgeStyle}>Listo para producción</span>
                      <p style={item.estado === "activo" ? availableStyle : unavailableStyle}>{item.estado === "activo" ? "Disponible" : "No disponible"}</p>
                      <button type="button" disabled={item.estado !== "activo" || mesaBloqueadaPorCobro} onClick={() => agregarAOrden(item)} style={{ ...(item.estado === "activo" && !mesaBloqueadaPorCobro ? primaryButtonStyle : disabledButtonStyle), width: "100%" }}>Agregar</button>
                    </article>
                  ))}
                  {itemsCategoria.length === 0 && (
                    <div style={emptyCatalogStyle}>
                      No hay productos listos para producción que coincidan con esta búsqueda.
                    </div>
                  )}
                </div>
              </main>
              <aside className="pos-current-order" style={orderPanelStyle}>
                <h2 className="pos-order-title">Orden actual</h2>
                <div className="pos-table-summary" style={selectedTableStyle}>
                  <div style={historyHeaderStyle}>
                    <strong>{ordenMesa ? `Mesa ${ordenMesa.mesaNumero}` : "Selecciona una mesa"}</strong>
                    {ordenMesa && <span style={{ ...tableStateBadgeStyle, ...tableStatusStyles[estadoMesaPorOrden(currentOrder)] }}>{etiquetaEstadoMesa(estadoMesaPorOrden(currentOrder))}</span>}
                  </div>
                  {ordenMesa && <p style={mutedStyle}>{ordenMesa.areaNombre}</p>}
                  {ordenMesa && (
                    <div style={tableSummaryGridStyle}>
                      <label style={summaryMetricStyle}>
                        <small>Personas / capacidad {selectedLayoutTable?.capacity || selectedLayoutTable?.capacidad || "-"}</small>
                        <input type="number" min="1" value={personasOrden} onChange={(e) => setPersonasOrden(e.target.value)} style={compactInputStyle} />
                      </label>
                      <div style={summaryMetricStyle}><small>Mesero</small><strong>{currentOrder?.usuarioNombre || user?.name || posSession?.name || "Sin asignar"}</strong></div>
                      <div style={summaryMetricStyle}><small>Tiempo</small><strong>{activeMinutes == null ? "-" : `${activeMinutes} min`}</strong></div>
                      <div style={summaryMetricStyle}><small>Total</small><strong>Q{totalOrden.toFixed(2)}</strong></div>
                      {readyItemsCount > 0 && <div style={{ ...summaryMetricStyle, ...readySummaryStyle }}><small>Por servir</small><strong>{readyItemsCount} producto(s)</strong></div>}
                    </div>
                  )}
                  {ordenMesa && <div className="pos-next-action"><small>Siguiente paso</small><strong>{nextServiceAction}</strong></div>}
                  {ordenMesa && <button type="button" onClick={refreshSelectedTableLive} style={secondaryButtonStyle}>Actualizar</button>}
                </div>
                {ordenError && <div style={errorBoxStyle}>{ordenError}</div>}
                {ordenMessage && <div style={successInlineStyle}>{ordenMessage}</div>}
                {productionErrors.length > 0 && (
                  <div style={productionErrorPanelStyle}>
                    <strong>Productos pendientes de producción</strong>
                    {productionErrors.map((error, index) => (
                      <div key={`${error.product}-${index}`} style={productionErrorItemStyle}>
                        <p style={{ margin: 0 }}><strong>{error.product}:</strong> {error.message}</p>
                        {error.stockError ? (
                          <button type="button" onClick={() => solicitarRequisicion(error)} style={secondaryButtonStyle}>Crear requisición</button>
                        ) : (
                          <small>Conecta la receta o el área desde Productos POS.</small>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {ordenMesa && (
                  <div className="pos-service-activity" style={historyPanelStyle}>
                    <strong>Actividad de servicio</strong>
                    {!currentOrder || serviceEvents.length === 0 ? (
                      <p style={mutedStyle}>Todavía no hay movimientos de servicio.</p>
                    ) : serviceEvents.map((event) => (
                      <div key={event.id} style={eventRowStyle}>
                        <span>{event.description}</span>
                        <small style={mutedStyle}>{new Date(event.created_at).toLocaleString()}</small>
                      </div>
                    ))}
                  </div>
                )}
                {ordenMesa && puedeVerAuditoria && (
                  <div className="pos-technical-audit" style={historyPanelStyle}>
                    <button type="button" onClick={() => setShowTechnicalAudit((current) => !current)} style={secondaryButtonStyle}>
                      {showTechnicalAudit ? "Ocultar" : "Mostrar"} historial técnico / auditoría
                    </button>
                    {showTechnicalAudit && orderEvents.map((event) => (
                      <div key={event.id} style={eventRowStyle}>
                        <strong>{event.event_type}</strong>
                        <span>{event.description}</span>
                        <small style={mutedStyle}>{new Date(event.created_at).toLocaleString()}</small>
                      </div>
                    ))}
                  </div>
                )}
                {ordenMesa && (
                  <div className="pos-previous-orders" style={historyPanelStyle}>
                    <div style={historyHeaderStyle}>
                      <strong>Órdenes anteriores de esta mesa</strong>
                      {allowHistoricalOrderActions && puedeEditarOrdenes && historialMesaActual.length > 0 && (
                        <button type="button" onClick={() => setTrasladoActivo((actual) => !actual)} style={secondaryButtonStyle}>
                          Trasladar a otra mesa
                        </button>
                      )}
                    </div>
                    {trasladoActivo && (
                      <div style={transferPanelStyle}>
                        <select value={mesaDestinoId} onChange={(e) => setMesaDestinoId(e.target.value)} style={inputStyle}>
                          <option value="">Selecciona mesa destino vacía</option>
                          {mesasDestinoDisponibles.map(({ area, mesa }) => (
                            <option key={obtenerMesaKey(area.id, mesa.id)} value={obtenerMesaKey(area.id, mesa.id)}>
                              {area.nombre} · Mesa {mesa.numero}
                            </option>
                          ))}
                        </select>
                        <button type="button" onClick={trasladarMesa} style={primaryButtonStyle}>Confirmar traslado</button>
                      </div>
                    )}
                    {historialMesaActual.length === 0 ? (
                      <p style={mutedStyle}>No hay órdenes anteriores registradas.</p>
                    ) : historialMesaActual.map((ordenEnviada) => {
                      const minutos = minutosTranscurridos(ordenEnviada.fechaEnvioISO)
                      const pendienteMas15 = minutos > 15 && !["entregada", "cancelada"].includes(ordenEnviada.estado)
                      return (
                        <article key={ordenEnviada.id} style={pendienteMas15 ? delayedOrderCardStyle : sentOrderCardStyle}>
                          {pendienteMas15 && <div style={delayAlertStyle}>Orden con más de 15 minutos pendiente</div>}
                          <div style={historyHeaderStyle}>
                            <strong>{ordenEnviada.horaEnviada || ordenEnviada.creadaEn}</strong>
                            <span style={orderStatusStyle}>{ordenEnviada.estado}</span>
                          </div>
                          <p style={mutedStyle}>Usuario: {ordenEnviada.usuarioNombre || ordenEnviada.usuario}</p>
                          <p style={mutedStyle}>Tiempo transcurrido: {minutos} min</p>
                          {allowHistoricalOrderActions && ordenEnviada.items.some((item) => (item.status || "draft") === "draft") && (
                            <button type="button" onClick={() => procesarOrdenExistente(ordenEnviada.id)} style={primaryButtonStyle}>Enviar productos pendientes</button>
                          )}
                          <div>
                            {ordenEnviada.items.map((item) => (
                              <div key={`${ordenEnviada.id}-${item.lineId || item.id}`} style={sentItemRowStyle}>
                                <span>{item.cantidad} x {item.nombre} · Q{(item.precio * item.cantidad).toFixed(2)}</span>
                                <span style={{ ...orderItemBadgeStyle, ...getOrderItemStatusStyle(item.status) }}>{getOrderItemStatusLabel(item.status)}</span>
                                {allowHistoricalOrderActions && puedeEditarOrdenes && (item.status || "draft") === "draft" && !item.inventoryConsumed && (
                                  <span style={qtyRowStyle}>
                                    <button type="button" onClick={() => cambiarCantidadOrdenEnviada(ordenEnviada.id, item.lineId, -1)} style={smallButtonStyle}>-</button>
                                    <button type="button" onClick={() => cambiarCantidadOrdenEnviada(ordenEnviada.id, item.lineId, 1)} style={smallButtonStyle}>+</button>
                                    <button type="button" onClick={() => iniciarEdicionModificacionEnviada(ordenEnviada.id, item)} style={smallButtonStyle}>Editar modificaciones</button>
                                  </span>
                                )}
                                {allowHistoricalOrderActions && item.status !== "cancelled" && (
                                  <button type="button" onClick={() => cancelarItemEnviado(ordenEnviada.id, item)} style={dangerMiniButtonStyle}>Cancelar producto</button>
                                )}
                                {item.modificaciones && <small style={modifierTextStyle}>Modificaciones: {item.modificaciones}</small>}
                                {item.historialCambios?.length > 0 && (
                                  <div style={auditBoxStyle}>
                                    {item.historialCambios.map((cambio) => (
                                      <small key={cambio.id}>Editado por {cambio.usuario} · {cambio.fechaHora} · Motivo: {cambio.motivo}</small>
                                    ))}
                                  </div>
                                )}
                                {allowHistoricalOrderActions && edicionEnviada?.ordenId === ordenEnviada.id && edicionEnviada?.lineId === item.lineId && (
                                  <div style={editSentModifierStyle}>
                                    {edicionEnviada.error && <div style={errorBoxStyle}>{edicionEnviada.error}</div>}
                                    <textarea
                                      value={edicionEnviada.modificaciones}
                                      onChange={(e) => setEdicionEnviada((actual) => ({ ...actual, modificaciones: e.target.value, error: "" }))}
                                      style={textAreaStyle}
                                    />
                                    <textarea
                                      placeholder="Motivo de edición obligatorio"
                                      value={edicionEnviada.motivo}
                                      onChange={(e) => setEdicionEnviada((actual) => ({ ...actual, motivo: e.target.value, error: "" }))}
                                      style={textAreaStyle}
                                    />
                                    <div style={buttonRowStyle}>
                                      <button type="button" onClick={guardarModificacionEnviada} style={primaryButtonStyle}>Guardar edición</button>
                                      <button type="button" onClick={() => setEdicionEnviada(null)} style={secondaryButtonStyle}>Cancelar</button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <strong>Total: Q{Number(ordenEnviada.total || 0).toFixed(2)}</strong>
                          <button type="button" onClick={() => verDetalleOrdenAnterior(ordenEnviada.id)} style={secondaryButtonStyle}>Ver detalle</button>
                          {allowHistoricalOrderActions && !["paid", "cancelled"].includes(ordenEnviada.status) && (
                            <div style={buttonRowStyle}>
                              <button type="button" onClick={() => solicitarCuenta(ordenEnviada)} style={secondaryButtonStyle}>Solicitar cuenta</button>
                              <button type="button" onClick={() => imprimirPrecuenta(ordenEnviada)} style={secondaryButtonStyle}>Imprimir precuenta</button>
                              <button type="button" onClick={() => enviarCuentaACaja(ordenEnviada)} style={primaryButtonStyle}>Enviar a caja</button>
                            </div>
                          )}
                          {ordenEnviada.status === "sent_to_cashier" && <div style={cashierStatusStyle}>En Caja · esperando cobro final</div>}
                          {ordenEnviada.status === "payment_in_progress" && <div style={cashierStatusStyle}>Pago en proceso · atendido por Caja</div>}
                          {ordenEnviada.status === "paid" && <div style={paidStatusStyle}>Pagada · mesa disponible</div>}
                          {allowHistoricalOrderActions && puedeEditarOrdenes && !["sent_to_cashier", "payment_in_progress", "paid"].includes(ordenEnviada.status) && (
                            <select value={ordenEnviada.estado} onChange={(e) => cambiarEstadoOrden(ordenEnviada.id, e.target.value)} style={inputStyle}>
                              <option value="enviada">Enviada</option>
                              <option value="en preparación">En preparación</option>
                              <option value="preparada">Preparada</option>
                              <option value="entregada">Entregada</option>
                            </select>
                          )}
                        </article>
                      )
                    })}
                  </div>
                )}
                {esMesaDelivery && (
                  <div style={deliveryPanelStyle}>
                    <strong>Datos de cliente</strong>
                    {Object.keys(deliveryErrors).length > 0 && (
                      <div style={errorBoxStyle}>Faltan campos requeridos: {Object.values(deliveryErrors).join(", ")}.</div>
                    )}
                    <select value={deliveryForm.tipoOrden} onChange={(e) => actualizarDelivery("tipoOrden", e.target.value)} style={inputStyle}>
                      <option value="Domicilio">Domicilio</option>
                      <option value="Para llevar">Para llevar</option>
                    </select>
                    <input placeholder="Nombre del cliente" value={deliveryForm.cliente} onChange={(e) => actualizarDelivery("cliente", e.target.value)} style={deliveryErrors.cliente ? inputErrorStyle : inputStyle} />
                    <input placeholder="NIT" value={deliveryForm.nit} onChange={(e) => actualizarDelivery("nit", e.target.value)} style={inputStyle} />
                    <input placeholder="Teléfono / WhatsApp" value={deliveryForm.telefono} onChange={(e) => actualizarDelivery("telefono", e.target.value)} style={deliveryErrors.telefono ? inputErrorStyle : inputStyle} />
                    {deliveryForm.tipoOrden === "Domicilio" && (
                      <>
                        <input placeholder="Dirección de entrega 1" value={deliveryForm.direccion1} onChange={(e) => actualizarDelivery("direccion1", e.target.value)} style={deliveryErrors.direccion1 ? inputErrorStyle : inputStyle} />
                        <input placeholder="Dirección de entrega 2" value={deliveryForm.direccion2} onChange={(e) => actualizarDelivery("direccion2", e.target.value)} style={inputStyle} />
                        <textarea placeholder="Referencias de dirección" value={deliveryForm.referencias} onChange={(e) => actualizarDelivery("referencias", e.target.value)} style={textAreaStyle} />
                      </>
                    )}
                    <select value={deliveryForm.formaPago} onChange={(e) => actualizarDelivery("formaPago", e.target.value)} style={deliveryErrors.formaPago ? inputErrorStyle : inputStyle}>
                      <option value="">Forma de pago</option>
                      <option value="Efectivo">Efectivo</option>
                      <option value="POS">POS</option>
                      <option value="Link">Link</option>
                      <option value="Transferencia">Transferencia</option>
                    </select>
                    <input type="date" value={deliveryForm.fechaProgramada} onChange={(e) => actualizarDelivery("fechaProgramada", e.target.value)} style={inputStyle} />
                    <input type="time" value={deliveryForm.horaProgramada} onChange={(e) => actualizarDelivery("horaProgramada", e.target.value)} style={inputStyle} />
                    <div style={deliverySummaryStyle}>
                      {esOrdenProgramada
                        ? `Orden programada para: ${deliveryForm.fechaProgramada || "sin fecha"} ${deliveryForm.horaProgramada || "sin hora"}`
                        : "Orden inmediata"}
                    </div>
                  </div>
                )}
                {(!currentOrder || orden.length === 0) && <p style={mutedStyle}>Mesa disponible. Agrega productos para iniciar orden.</p>}
                {orderSections.filter((sectionItem) => sectionItem.items.length > 0).map((sectionItem) => (
                  <section className={`pos-order-section section-${sectionItem.id}`} key={sectionItem.id} style={orderSectionStyle}>
                    <div style={historyHeaderStyle}>
                      <strong>{sectionItem.title} ({sectionItem.items.length})</strong>
                      {sectionItem.collapsible && (
                        <button
                          type="button"
                          onClick={() => setCollapsedOrderSections((current) => ({ ...current, [sectionItem.id]: !current[sectionItem.id] }))}
                          style={smallButtonStyle}
                        >
                          {collapsedOrderSections[sectionItem.id] ? "Mostrar" : "Ocultar"}
                        </button>
                      )}
                    </div>
                    {!collapsedOrderSections[sectionItem.id] && sectionItem.items.map((item) => {
                      const area = productionAreas.find((entry) => entry.id === item.productionAreaId)
                      const recipe = finalRecipes.find((entry) => String(entry.id) === String(item.recipeId))
                      const editable = item.status === "draft"
                      const inProduction = ["sent_to_production", "in_production"].includes(item.status)
                      return (
                        <div key={item.lineId} style={orderItemStyle}>
                          <div style={historyHeaderStyle}>
                            <strong>{item.nombre}</strong>
                            <span style={{ ...orderItemBadgeStyle, ...getOrderItemStatusStyle(item.status) }}>{getOrderItemStatusLabel(item.status)}</span>
                          </div>
                          <span>{item.cantidad} x Q{item.precio.toFixed(2)} = Q{(item.precio * item.cantidad).toFixed(2)}</span>
                          <small style={mutedStyle}>Area: {area?.name || item.productionAreaId || "Sin area"} | Receta: {recipe?.name || "Sin receta"}</small>
                          {inProduction && <small style={timerStyle}>Enviado hace {minutosTranscurridos(item.updated_at || item.created_at)} min</small>}
                          {item.modificaciones && <small style={modifierTextStyle}>Modificaciones: {item.modificaciones}</small>}
                          {editable && editandoModificacionLineId === item.lineId ? (
                            <div style={editSentModifierStyle}>
                              <textarea value={modificacionActualTexto} onChange={(e) => setModificacionActualTexto(e.target.value)} style={textAreaStyle} />
                              <div style={buttonRowStyle}>
                                <button type="button" onClick={() => guardarModificacionActual(item.lineId)} style={primaryButtonStyle}>Guardar modificaciones</button>
                                <button type="button" onClick={() => setEditandoModificacionLineId(null)} style={secondaryButtonStyle}>Cancelar</button>
                              </div>
                            </div>
                          ) : editable && (
                            <div style={qtyRowStyle}>
                              <button type="button" onClick={() => cambiarCantidad(item.lineId, -1)} style={smallButtonStyle}>-</button>
                              <span>{item.cantidad}</span>
                              <button type="button" onClick={() => cambiarCantidad(item.lineId, 1)} style={smallButtonStyle}>+</button>
                              <button type="button" onClick={() => { setEditandoModificacionLineId(item.lineId); setModificacionActualTexto(item.modificaciones || "") }} style={secondaryButtonStyle}>Notas</button>
                              <button type="button" onClick={() => eliminarItemActual(item.lineId)} style={dangerButtonStyle}>Eliminar</button>
                            </div>
                          )}
                          {item.status === "ready" && (
                            <button type="button" onClick={() => handleMarkServed(item)} style={servedButtonStyle}>Marcar servido</button>
                          )}
                        </div>
                      )
                    })}
                  </section>
                ))}
                <div className="pos-order-footer" style={orderFooterStyle}>
                  <div style={totalsBreakdownStyle}>
                    <span>Subtotal <strong>Q{totalOrden.toFixed(2)}</strong></span>
                    <span>Descuentos <strong>Q0.00</strong></span>
                    <div style={totalStyle}>Total: Q{totalOrden.toFixed(2)}</div>
                  </div>
                  <div style={buttonRowStyle}>
                    {draftItems.length > 0 && <button type="button" disabled={sendingOrder} onClick={handleClearDraftItems} style={sendingOrder ? disabledButtonStyle : secondaryButtonStyle}>Quitar productos nuevos</button>}
                    <button type="button" disabled={!draftItems.length || sendingOrder} onClick={handleSendOrderToProduction} style={!draftItems.length || sendingOrder ? disabledButtonStyle : primaryButtonStyle}>{sendingOrder ? "Enviando..." : "Enviar a cocina"}</button>
                  </div>
                  {!draftItems.length && currentOrder?.status === "open" && sentItems.length > 0 && (
                    <div style={quickActionsStyle}>
                      <button type="button" onClick={() => solicitarCuenta(currentOrder)} style={secondaryButtonStyle}>Solicitar cuenta</button>
                      <button type="button" disabled style={disabledButtonStyle} title="Disponible después de solicitar cuenta">Enviar a caja</button>
                    </div>
                  )}
                  {currentOrder?.status === "awaiting_bill" && (
                    <div style={quickActionsStyle}>
                      <button type="button" onClick={() => enviarCuentaACaja(currentOrder)} style={primaryButtonStyle}>Enviar a caja</button>
                      <button type="button" disabled style={disabledButtonStyle} title="Función pendiente de configuración">Dividir cuenta</button>
                    </div>
                  )}
                  {currentOrder?.status === "sent_to_cashier" && <div style={cashierStatusStyle}>En Caja · esperando cobro final</div>}
                  {sentItems.length > 0 && draftItems.length > 0 && (
                    <small style={mutedStyle}>Los productos enviados no se eliminan directamente; una cancelación requiere autorización.</small>
                  )}
                </div>
              </aside>
            </div>
          {orderDetail && (
            <div style={modalOverlayStyle}>
              <div style={modifierModalStyle}>
                <div style={historyHeaderStyle}>
                  <h2 style={{ margin: 0 }}>Detalle de orden anterior</h2>
                  <span style={orderStatusStyle}>{orderDetail.status}</span>
                </div>
                <p style={mutedStyle}>{orderDetail.tableName} · {new Date(orderDetail.created_at).toLocaleString()} · {orderDetail.usuarioNombre}</p>
                {orderDetail.items.map((item) => (
                  <div key={item.lineId} style={sentItemRowStyle}>
                    <span>{item.cantidad} x {item.nombre} · Q{(item.precio * item.cantidad).toFixed(2)}</span>
                    <span style={{ ...orderItemBadgeStyle, ...getOrderItemStatusStyle(item.status) }}>{getOrderItemStatusLabel(item.status)}</span>
                  </div>
                ))}
                <strong>Total: Q{Number(orderDetail.total || 0).toFixed(2)}</strong>
                <button type="button" onClick={() => setOrderDetail(null)} style={secondaryButtonStyle}>Cerrar</button>
              </div>
            </div>
          )}
          {diagnostic && (
            <div style={modalOverlayStyle}>
              <div style={modifierModalStyle}>
                <h2 style={{ marginTop: 0 }}>Diagnóstico POS → KDS</h2>
                <p>Fuente tickets: <strong>{diagnostic.fuenteTicketsKDS}</strong></p>
                <p>Consumo: <strong>{diagnostic.consumoInventario}</strong></p>
                <p>Productos: <strong>{diagnostic.fuenteProductosPOS}</strong></p>
                <p>Productos POS: <strong>{diagnostic.productosPOS}</strong></p>
                <p>Con receta: <strong>{diagnostic.productosConReceta}</strong> · Con área: <strong>{diagnostic.productosConArea}</strong></p>
                <p>Listos para producción: <strong>{diagnostic.productosListos}</strong></p>
                <p>Recetas finales Supabase: <strong>{diagnostic.recetasFinalesSupabase}</strong></p>
                <p>Áreas productivas: <strong>{diagnostic.areasProductivas.join(", ") || "Ninguna"}</strong></p>
                <p>Tickets KDS recientes: <strong>{diagnostic.ticketsRecientes.length}</strong></p>
                {diagnostic.erroresActuales.length > 0 && <div style={errorBoxStyle}>{diagnostic.erroresActuales.map((entry) => entry.message).join(" | ")}</div>}
                <button type="button" onClick={() => setDiagnostic(null)} style={secondaryButtonStyle}>Cerrar</button>
              </div>
            </div>
          )}
          {itemPendiente && (
            <div style={modalOverlayStyle}>
              <div style={modifierModalStyle}>
                <h2 style={{ marginTop: 0 }}>¿Hay modificaciones o extras para este platillo?</h2>
                <div style={modifierDishHeaderStyle}>
                  {itemPendiente.imagen && <img src={itemPendiente.imagen} alt={itemPendiente.nombre} style={modifierDishImageStyle} />}
                  <div>
                    <strong>{itemPendiente.nombre}</strong>
                    <p style={mutedStyle}>Q{Number(itemPendiente.precio || 0).toFixed(2)}</p>
                  </div>
                </div>
                <textarea
                  value={modificacionesPendientes}
                  onChange={(e) => setModificacionesPendientes(e.target.value)}
                  placeholder="Ej: sin cebolla, extra queso, salsa aparte, bien tostada..."
                  style={textAreaStyle}
                />
                <div style={buttonRowStyle}>
                  <button type="button" onClick={() => confirmarAgregarItem("")} style={secondaryButtonStyle}>Agregar sin modificaciones</button>
                  <button type="button" onClick={() => confirmarAgregarItem(modificacionesPendientes)} style={primaryButtonStyle}>Agregar con modificaciones</button>
                  <button type="button" onClick={() => { setItemPendiente(null); setModificacionesPendientes("") }} style={dangerButtonStyle}>Cancelar</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {productDiagnostic && (
        <div style={modalOverlayStyle}>
          <div style={modifierModalStyle}>
            <h2 style={{ marginTop: 0 }}>Diagnóstico producto POS</h2>
            <p><strong>{productDiagnostic.productName}</strong> · {productDiagnostic.valid ? "Válido" : "Inválido"}</p>
            <p>Fuente catálogo: <strong>{productDiagnostic.source}</strong></p>
            <p>productId: <strong>{String(productDiagnostic.productId)}</strong></p>
            <p>recipeId: <strong>{String(productDiagnostic.recipeId)}</strong></p>
            <p>productionAreaId: <strong>{String(productDiagnostic.productionAreaId)}</strong></p>
            <p>pos_recipe_link (compatibilidad): <strong>{productDiagnostic.posRecipeLink}</strong></p>
            <p>Receta: <strong>{productDiagnostic.recipe}</strong></p>
            <p>Categoría: <strong>{productDiagnostic.category}</strong></p>
            <p>Área: <strong>{productDiagnostic.area}</strong></p>
            {productDiagnostic.error && <div style={errorBoxStyle}>{productDiagnostic.error}</div>}
            {!productDiagnostic.valid && !productDiagnostic.error && <div style={errorBoxStyle}>{productDiagnostic.issues.join(", ") || "El vínculo Supabase no coincide con el producto."}</div>}
            <div style={productDiagnostic.valid ? successInlineStyle : errorBoxStyle}>
              Estado final: {productDiagnostic.valid ? "Válido y listo para producción" : "Inválido; no se enviará al KDS"}
            </div>
            <button type="button" onClick={() => setProductDiagnostic(null)} style={secondaryButtonStyle}>Cerrar</button>
          </div>
        </div>
      )}
    </section>
  )
}

function ProductionBadges({ state }) {
  return (
    <div style={readinessBadgesStyle}>
      <span style={state.recipe ? readyBadgeStyle : invalidBadgeStyle}>{state.recipe ? "✓ Receta conectada" : "✗ Sin receta"}</span>
      <span style={state.area ? readyBadgeStyle : invalidBadgeStyle}>{state.area ? "✓ Área producción configurada" : "✗ Sin área"}</span>
      <span style={state.productionReady ? readyBadgeStyle : invalidBadgeStyle}>{state.productionReady ? "✓ Listo para producción" : "✗ No enviará a KDS"}</span>
    </div>
  )
}

const pageStyle = { display: "grid", gap: "18px", color: "#e5e7eb" }
const headerStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }
const formCardStyle = { padding: "18px", borderRadius: "12px", border: "1px solid #334155", background: "#0f172a", display: "grid", gap: "12px" }
const formGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "12px" }
const inputStyle = { width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", color: "#f8fafc", boxSizing: "border-box" }
const inputErrorStyle = { ...inputStyle, borderColor: "#f87171", boxShadow: "0 0 0 3px rgba(248,113,113,.18)" }
const textAreaStyle = { ...inputStyle, minHeight: "90px", resize: "vertical" }
const textAreaErrorStyle = { ...textAreaStyle, borderColor: "#f87171" }
const primaryButtonStyle = { padding: "11px 14px", borderRadius: "8px", border: "none", background: "#0ea5a4", color: "#022c22", fontWeight: 800, cursor: "pointer" }
const secondaryButtonStyle = { padding: "10px 13px", borderRadius: "8px", border: "1px solid #334155", background: "#1f2937", color: "#e5e7eb", cursor: "pointer" }
const dangerButtonStyle = { ...secondaryButtonStyle, borderColor: "#7f1d1d", background: "#7f1d1d" }
const dangerMiniButtonStyle = { ...dangerButtonStyle, padding: "6px 10px" }
const disabledButtonStyle = { ...secondaryButtonStyle, opacity: 0.55, cursor: "not-allowed" }
const smallButtonStyle = { ...secondaryButtonStyle, padding: "6px 10px" }
const buttonRowStyle = { display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }
const categoryEditorStyle = { ...formCardStyle, gap: "18px" }
const quickChoiceSectionStyle = { display: "grid", gap: "9px" }
const quickChoiceGridStyle = { display: "flex", gap: "8px", flexWrap: "wrap" }
const quickChoiceButtonStyle = { ...secondaryButtonStyle, display: "inline-flex", alignItems: "center", gap: "7px", fontSize: ".86rem" }
const categoryEditorColumnsStyle = { display: "grid", gridTemplateColumns: "minmax(420px, 1fr) minmax(235px, 300px)", gap: "18px", alignItems: "start" }
const categoryFieldsStyle = { display: "grid", gap: "16px" }
const fieldStackStyle = { display: "grid", gap: "7px" }
const fieldTitleStyle = { color: "#f1f5f9", fontWeight: 800, fontSize: ".9rem" }
const fieldHintStyle = { color: "#94a3b8", fontSize: ".8rem" }
const iconPickerGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: "8px" }
const iconPickerButtonStyle = { display: "grid", justifyItems: "center", gap: "4px", minHeight: "66px", padding: "8px 5px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", color: "#cbd5e1", cursor: "pointer", fontSize: ".72rem" }
const iconPickerSelectedStyle = { ...iconPickerButtonStyle, borderColor: "#14b8a6", background: "#134e4a", color: "#ecfeff" }
const iconPickerEmojiStyle = { fontSize: "1.45rem" }
const colorControlsStyle = { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }
const colorInputStyle = { width: "50px", height: "40px", padding: "3px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", cursor: "pointer" }
const colorPaletteStyle = { display: "flex", gap: "8px", flexWrap: "wrap" }
const colorSwatchButtonStyle = { width: "27px", height: "27px", borderRadius: "7px", border: "1px solid rgba(255,255,255,.22)", cursor: "pointer" }
const activeToggleStyle = { display: "flex", gap: "12px", alignItems: "center", padding: "12px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", color: "#f8fafc" }
const categoryPreviewPanelStyle = { position: "sticky", top: "18px", display: "grid", gap: "12px", padding: "16px", borderRadius: "8px", border: "1px solid #334155", background: "#111827" }
const categoryPreviewTabStyle = { display: "flex", gap: "9px", alignItems: "center", padding: "12px 14px", borderRadius: "8px", color: "#fff" }
const categoryPreviewIconStyle = { fontSize: "1.35rem" }
const activeCategoryBadgeStyle = { width: "fit-content", padding: "5px 9px", borderRadius: "7px", background: "#064e3b", color: "#d1fae5", fontSize: ".78rem", fontWeight: 800 }
const inactiveCategoryBadgeStyle = { ...activeCategoryBadgeStyle, background: "#374151", color: "#cbd5e1" }
const errorBoxStyle = { padding: "12px", borderRadius: "10px", border: "1px solid #fca5a5", background: "#7f1d1d", color: "#fee2e2" }
const warningBoxStyle = { padding: "12px", borderRadius: "10px", border: "1px solid #f59e0b", background: "#451a03", color: "#fde68a" }
const readinessPanelStyle = { display: "grid", gap: "7px", padding: "12px", borderRadius: "10px", border: "1px solid #334155", background: "#111827" }
const readinessBadgesStyle = { display: "flex", gap: "7px", flexWrap: "wrap", marginTop: "7px" }
const readyBadgeStyle = { padding: "5px 8px", borderRadius: "999px", background: "#064e3b", color: "#a7f3d0", fontSize: ".76rem", fontWeight: 800 }
const invalidBadgeStyle = { ...readyBadgeStyle, background: "#7f1d1d", color: "#fecaca" }
const productionErrorPanelStyle = { display: "grid", gap: "10px", padding: "12px", borderRadius: "10px", border: "1px solid #f97316", background: "#431407", color: "#ffedd5", marginBottom: "12px" }
const productionErrorItemStyle = { display: "grid", gap: "8px", padding: "10px", borderRadius: "8px", background: "#29140c" }
const cashierStatusStyle = { padding: "9px 11px", borderRadius: "8px", border: "1px solid #0284c7", background: "#082f49", color: "#bae6fd", fontWeight: 700 }
const paidStatusStyle = { padding: "9px 11px", borderRadius: "8px", border: "1px solid #059669", background: "#052e2b", color: "#a7f3d0", fontWeight: 700 }
const previewStyle = { width: "180px", height: "130px", objectFit: "cover", borderRadius: "10px", border: "1px solid #334155" }
const itemListStyle = { display: "grid", gap: "12px" }
const itemRowStyle = { display: "flex", alignItems: "center", gap: "12px", padding: "14px", borderRadius: "12px", border: "1px solid #334155", background: "#0f172a" }
const thumbStyle = { width: "76px", height: "64px", objectFit: "cover", borderRadius: "10px", background: "#111827" }
const mutedStyle = { color: "#94a3b8", margin: "4px 0" }
const sessionBadgeStyle = { padding: "8px 12px", borderRadius: "999px", background: "#064e3b", color: "#d1fae5" }
const posShellStyle = { display: "grid", gridTemplateColumns: "minmax(520px, 1fr) minmax(340px, 410px)", gap: "16px", alignItems: "start" }
const menuPanelStyle = { display: "grid", gap: "14px" }
const catalogSearchStyle = { display: "grid", gap: "6px", padding: "12px", borderRadius: "12px", border: "1px solid #334155", background: "#0f172a" }
const tabsStyle = { display: "flex", flexWrap: "wrap", gap: "8px" }
const tabIconStyle = { display: "inline-flex", marginRight: "7px", fontWeight: 900 }
const areaTabGroupStyle = { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }
const tabStyle = { ...secondaryButtonStyle }
const activeTabStyle = { ...primaryButtonStyle }
const floorPlanSectionStyle = { display: "grid", gap: "12px", padding: "16px", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a" }
const layoutToolbarStyle = { display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", alignItems: "center", paddingBottom: "12px", borderBottom: "1px solid #1f2937" }
const snapToggleStyle = { display: "inline-flex", gap: "7px", alignItems: "center", padding: "9px 11px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", color: "#e5e7eb", fontSize: ".88rem" }
const zoomValueStyle = { minWidth: "48px", color: "#cbd5e1", fontWeight: 700, textAlign: "center" }
const successInlineStyle = { padding: "9px 12px", borderRadius: "8px", border: "1px solid #0f766e", background: "#042f2e", color: "#99f6e4", fontWeight: 700 }
const liveNoticeStyle = { ...successInlineStyle, borderColor: "#22c55e", color: "#bbf7d0", marginTop: "10px" }
const liveBadgeStyle = { display: "inline-flex", alignItems: "center", gap: "7px", padding: "7px 10px", borderRadius: "999px", border: "1px solid #166534", background: "#052e24", color: "#86efac", fontSize: ".84rem", fontWeight: 700 }
const connectingBadgeStyle = { ...liveBadgeStyle, borderColor: "#334155", background: "#111827", color: "#94a3b8" }
const liveDotStyle = { display: "inline-block", width: "9px", height: "9px", borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e" }
const connectingDotStyle = { ...liveDotStyle, background: "#64748b", boxShadow: "none" }
const areaFormStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", alignItems: "end", padding: "14px", borderRadius: "8px", border: "1px solid #334155", background: "#111827" }
const floorPlanLayoutStyle = { display: "grid", gridTemplateColumns: "minmax(420px, 1fr) minmax(285px, 340px)", gap: "14px", alignItems: "start" }
const floorPlanStyle = {
  position: "relative",
  minHeight: "360px",
  borderRadius: "8px",
  border: "1px solid #475569",
  overflow: "hidden",
  touchAction: "none",
  backgroundColor: "#111827",
  backgroundImage: "linear-gradient(#243244 1px, transparent 1px), linear-gradient(90deg, #243244 1px, transparent 1px)",
  backgroundSize: "24px 24px"
}
const tableAssemblyStyle = {
  position: "absolute",
  width: "148px",
  height: "124px",
  padding: 0,
  border: "none",
  borderRadius: "8px",
  background: "transparent",
  color: "#f8fafc",
  transition: "transform .08s ease, outline-color .12s ease",
  touchAction: "none"
}
const tableSurfaceStyle = {
  position: "absolute",
  left: "50%",
  top: "50%",
  transform: "translate(-50%, -50%)",
  width: "78px",
  minHeight: "66px",
  display: "grid",
  placeItems: "center",
  gap: "2px",
  borderRadius: "8px",
  border: "2px solid #334155",
  boxShadow: "0 12px 24px rgba(0,0,0,.32)",
  fontSize: ".84rem"
}
const tableReadyCountStyle = { padding: "2px 5px", borderRadius: "999px", background: "#14b8a6", color: "#042f2e", fontSize: ".68rem", fontWeight: 900 }
const chairStyle = {
  position: "absolute",
  left: "50%",
  top: "50%",
  width: "17px",
  height: "12px",
  marginLeft: "-8px",
  marginTop: "-6px",
  borderRadius: "5px",
  border: "1px solid #64748b",
  background: "#334155"
}
const tableStatusStyles = {
  disponible: { background: "#065f46", borderColor: "#34d399" },
  ocupada: { background: "#7f1d1d", borderColor: "#f87171" },
  en_servicio: { background: "#1d4ed8", borderColor: "#60a5fa" },
  nuevos_sin_enviar: { background: "#854d0e", borderColor: "#facc15" },
  esperando_cuenta: { background: "#581c87", borderColor: "#c084fc" },
  pago_en_proceso: { background: "#3730a3", borderColor: "#818cf8" },
  pagada: { background: "#065f46", borderColor: "#34d399" },
  problema: { background: "#7f1d1d", borderColor: "#f87171" },
  en_produccion: { background: "#9a3412", borderColor: "#fb923c" },
  lista_para_servir: { background: "#0f766e", borderColor: "#2dd4bf", boxShadow: "0 0 16px rgba(45,212,191,.45)" },
  reservada: { background: "#78350f", borderColor: "#fbbf24" },
  limpieza: { background: "#1e3a8a", borderColor: "#60a5fa" },
  inactiva: { background: "#374151", borderColor: "#94a3b8" }
}
const tableEditPanelStyle = { padding: "14px", borderRadius: "8px", border: "1px solid #334155", background: "#111827", display: "grid", gap: "12px" }
const tablePreviewStyle = { position: "relative", height: "128px", borderRadius: "8px", border: "1px solid #253347", background: "#0f172a" }
const emptyPlanStyle = { minHeight: "220px", display: "grid", placeItems: "center", borderRadius: "8px", border: "1px dashed #475569", color: "#94a3b8" }
const menuGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "14px" }
const menuCardStyle = { padding: "14px", borderRadius: "12px", border: "1px solid #334155", background: "#0f172a" }
const emptyCatalogStyle = { gridColumn: "1 / -1", padding: "20px", borderRadius: "12px", border: "1px dashed #334155", color: "#94a3b8", textAlign: "center" }
const menuImageStyle = { width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: "10px", background: "#111827" }
const availableStyle = { color: "#34d399", fontWeight: 700 }
const unavailableStyle = { color: "#f87171", fontWeight: 700 }
const readyMenuBadgeStyle = { display: "inline-block", padding: "5px 8px", borderRadius: "999px", background: "#052e24", border: "1px solid #166534", color: "#86efac", fontSize: ".74rem", fontWeight: 800 }
const orderPanelStyle = { position: "sticky", top: "20px", padding: "16px", borderRadius: "12px", border: "1px solid #334155", background: "#0f172a" }
const selectedTableStyle = { display: "grid", gap: "8px", padding: "12px", borderRadius: "10px", border: "1px solid #334155", background: "#111827", marginBottom: "12px" }
const tableStateBadgeStyle = { padding: "5px 9px", borderRadius: "999px", border: "1px solid #334155", color: "#f8fafc", fontSize: ".74rem", fontWeight: 800 }
const tableSummaryGridStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }
const summaryMetricStyle = { display: "grid", gap: "4px", padding: "8px", borderRadius: "8px", background: "#0f172a", color: "#f8fafc", fontSize: ".85rem" }
const readySummaryStyle = { gridColumn: "1 / -1", border: "1px solid #14b8a6", color: "#99f6e4", background: "#042f2e" }
const compactInputStyle = { ...inputStyle, padding: "7px" }
const historyPanelStyle = { display: "grid", gap: "10px", padding: "12px", borderRadius: "10px", border: "1px solid #334155", background: "#111827", marginBottom: "12px" }
const historyHeaderStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }
const eventRowStyle = { display: "grid", gap: "3px", padding: "8px", borderRadius: "8px", background: "#0f172a", border: "1px solid #253347" }
const sentOrderCardStyle = { display: "grid", gap: "8px", padding: "12px", borderRadius: "10px", border: "1px solid #334155", background: "#0f172a" }
const delayedOrderCardStyle = { ...sentOrderCardStyle, borderColor: "#f97316", background: "#431407" }
const delayAlertStyle = { padding: "8px 10px", borderRadius: "8px", background: "#9a3412", color: "#ffedd5", fontWeight: 800 }
const orderStatusStyle = { padding: "4px 8px", borderRadius: "999px", background: "#1f2937", color: "#e5e7eb", fontSize: "0.85rem" }
const sentItemRowStyle = { display: "flex", justifyContent: "space-between", gap: "8px", alignItems: "center", flexWrap: "wrap", color: "#d1d5db", padding: "4px 0" }
const orderItemBadgeStyle = { padding: "4px 8px", borderRadius: "999px", fontSize: ".76rem", fontWeight: 800 }
const modifierTextStyle = { display: "block", color: "#fef3c7", marginTop: "4px" }
const auditBoxStyle = { display: "grid", gap: "3px", padding: "8px", borderRadius: "8px", background: "#111827", color: "#94a3b8", width: "100%" }
const editSentModifierStyle = { display: "grid", gap: "8px", width: "100%", marginTop: "8px" }
const modalOverlayStyle = { position: "fixed", inset: 0, background: "rgba(2, 6, 23, .72)", display: "grid", placeItems: "center", zIndex: 40, padding: "20px" }
const modifierModalStyle = { width: "min(560px, 100%)", display: "grid", gap: "14px", padding: "20px", borderRadius: "14px", border: "1px solid #334155", background: "#0f172a", boxShadow: "0 24px 60px rgba(0,0,0,.38)" }
const modifierDishHeaderStyle = { display: "flex", gap: "12px", alignItems: "center" }
const modifierDishImageStyle = { width: "96px", height: "76px", objectFit: "cover", borderRadius: "10px", border: "1px solid #334155" }
const transferPanelStyle = { display: "grid", gap: "8px", padding: "10px", borderRadius: "10px", border: "1px solid #0ea5a4", background: "#082f2e" }
const deliveryPanelStyle = { display: "grid", gap: "10px", padding: "12px", borderRadius: "10px", border: "1px solid #0ea5a4", background: "#082f2e", marginBottom: "12px" }
const deliverySummaryStyle = { padding: "10px", borderRadius: "8px", background: "#0f172a", color: "#d1fae5", fontWeight: 700 }
const orderSectionStyle = { display: "grid", gap: "8px", marginBottom: "14px", padding: "10px", borderRadius: "10px", border: "1px solid #253347", background: "#111827" }
const orderFooterStyle = { position: "sticky", bottom: 0, display: "grid", gap: "10px", marginTop: "14px", padding: "12px 0 4px", background: "#0f172a" }
const orderItemStyle = { display: "grid", gap: "8px", padding: "10px 0", borderBottom: "1px solid #334155" }
const qtyRowStyle = { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }
const timerStyle = { color: "#fdba74", fontWeight: 700 }
const servedButtonStyle = { ...primaryButtonStyle, background: "#10b981", color: "#052e24" }
const totalsBreakdownStyle = { display: "grid", gap: "5px", padding: "10px", borderRadius: "10px", border: "1px solid #253347", background: "#111827" }
const totalStyle = { paddingTop: "6px", borderTop: "1px solid #334155", fontSize: "1.25rem", fontWeight: 800 }
const quickActionsStyle = { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }
const categoryTableStyle = { display: "grid", gap: "8px" }
const categoryHeaderStyle = { display: "grid", gridTemplateColumns: "72px minmax(150px, 1fr) minmax(150px, .9fr) 90px 90px minmax(300px, 1.6fr)", gap: "10px", padding: "10px 12px", color: "#94a3b8", fontSize: ".8rem", fontWeight: 800, textTransform: "uppercase" }
const categoryRowStyle = { ...categoryHeaderStyle, alignItems: "center", color: "#e5e7eb", fontSize: ".88rem", fontWeight: 400, textTransform: "none", borderRadius: "8px", border: "1px solid #334155", background: "#0f172a" }
const categoryIdentityStyle = { display: "flex", alignItems: "center", gap: "9px" }
const categorySwatchStyle = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: "32px", height: "32px", borderRadius: "7px", color: "#fff", fontWeight: 900 }

export default POS

