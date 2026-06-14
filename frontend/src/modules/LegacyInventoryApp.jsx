import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import SuppliersModule from "./suppliers/SuppliersModule"
import AttendanceReportsModule from "./attendance/AttendanceReportsModule"
import PurchaseOrdersModule from "./purchase-orders/PurchaseOrdersModule"
import AreasModule from "./areas/AreasModule"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import Sidebar from "./LegacySidebar"
import Dashboard from "./LegacyDashboard"
import InfoTooltip from "../components/InfoTooltip"
import { BRANDING } from "../branding"
import { useAuth } from "../context/AuthContext"
import { supabase } from "../lib/supabase"
import { createNotification, notifyRoles } from "../services/notificationsService"
import { getPurchaseOrders, savePurchaseOrder } from "../services/purchaseOrdersService"
import { canCreateTestFlow, TEST_FLOW_FILTER } from "../utils/testFlowMode"
import { getInventoryItems } from "../services/inventoryService"
import {
  getSuppliers,
  migrateLocalSuppliers,
  updateSupplier
} from "../services/suppliersService"
import {
  getAttendanceDailyLateArrivals,
  getAttendanceLateArrivalsSetupStatus,
  getAttendanceLateGraceMinutes,
  getAttendanceMarks,
  getAttendanceTerminalProfiles,
  probeAttendanceLateArrival
} from "../services/attendanceService"
import {
  extractUserObservation,
  formatAttendanceDevice,
  resolveAttendanceUserAgent
} from "../utils/attendanceDevice"
import {
  createArea as createSupabaseArea,
  deactivateArea as deactivateSupabaseArea,
  getAreas as getSupabaseAreas,
  updateArea as updateSupabaseArea
} from "../services/areasService"
import {
  generarId,
  generarCodigo,
  generarNumeroOrdenManual,
  calcularTotales,
  limpiarNumero,
  obtenerMetodoPagoPreferido
} from "../utils"
import { normalizeProductionArea } from "../utils/posProduction"
import { normalizeRole } from "../utils/profilePermissions"

function readLocalSuppliers() {
  try {
    const parsed = JSON.parse(localStorage.getItem("proveedores") || "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}



const INVENTORY_STORAGE_KEY = "ingredientes"
const INVENTORY_BACKUP_KEY = "ingredientesBackup"
const INVENTORY_BACKUP_HISTORY_KEY = "ingredientesBackupHistory"
const INVENTORY_BACKUP_META_KEY = "ingredientesBackupMeta"
const INVENTORY_MAX_BACKUPS = 5
const INVENTORY_MOVEMENTS_KEY = "inventoryMovements"
const INVENTORY_AREAS_KEY = "inventoryAreas"
const DEFAULT_INVENTORY_AREAS = [
  { id: "almacen", name: "Almacén", type: "principal", canRequestInventory: false, active: true },
  { id: "cocina", name: "Cocina", type: "operativa", canRequestInventory: true, active: true },
  { id: "cafeteria", name: "Cafetería", type: "operativa", canRequestInventory: true, active: true },
  { id: "barra", name: "Barra", type: "operativa", canRequestInventory: true, active: true },
  { id: "mesas", name: "Mesas", type: "operativa", canRequestInventory: true, active: true },
  { id: "caja", name: "Caja", type: "operativa", canRequestInventory: true, active: true },
  { id: "limpieza", name: "Limpieza", type: "operativa", canRequestInventory: true, active: true }
]
const INVENTORY_LOCATIONS = {
  ...Object.fromEntries(DEFAULT_INVENTORY_AREAS.map((area) => [area.id, area.name]))
}

function slugifyAreaName(name) {
  return String(name || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function getLegacyStock(item) {
  return Number(item?.stockActual ?? item?.totalUnidades ?? item?.stock ?? 0) || 0
}

function normalizeInventoryItem(item) {
  const locationIds = Array.from(new Set([
    ...DEFAULT_INVENTORY_AREAS.map((area) => area.id),
    ...Object.keys(item?.stockByLocation || {}),
    ...Object.keys(item?.minimumStockByLocation || {})
  ]))
  const almacen = Number(item?.stockByLocation?.almacen ?? getLegacyStock(item))
  const minAlmacen = Number(item?.minimumStockByLocation?.almacen ?? item?.puntoMinimo ?? 0)
  const stockByLocation = Object.fromEntries(locationIds.map((location) => [
    location,
    location === "almacen" ? almacen : Number(item?.stockByLocation?.[location] ?? 0)
  ]))
  const minimumStockByLocation = Object.fromEntries(locationIds.map((location) => [
    location,
    location === "almacen" ? minAlmacen : Number(item?.minimumStockByLocation?.[location] ?? 0)
  ]))
  const total = Object.values(stockByLocation).reduce((sum, value) => sum + value, 0)

  return {
    ...item,
    stockByLocation,
    minimumStockByLocation,
    stockActual: total,
    totalUnidades: total
  }
}

function normalizeInventory(items) {
  return Array.isArray(items) ? items.map(normalizeInventoryItem) : []
}

function getPurchaseProductDetails(item) {
  const unitPurchase = item?.unidadCompra || item?.purchase_unit || "Unidad/Pieza"
  const unitBase = item?.unidadBase || item?.base_unit || item?.unidad || unitPurchase
  const factorValue = Number(item?.unidadesPorEmpaque ?? item?.conversion_factor ?? 1)
  const priceValue = Number(item?.precioCompra ?? item?.purchase_price ?? item?.costoUnitario ?? 0)

  return {
    productoId: item?.id,
    nombre: item?.nombre || item?.name || "",
    sku: item?.codigo || item?.sku || item?.codigoBarras || "",
    categoria: item?.categoria || item?.category || "Sin categoria",
    unidadCompra: unitPurchase,
    unidadBase: unitBase,
    factorConversion: factorValue > 0 ? factorValue : 1,
    precioCompra: priceValue >= 0 ? priceValue : 0,
    proveedor: item?.proveedorNombre || item?.supplier || ""
  }
}

function mapPurchaseInventoryItem(item) {
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

function getLocationStock(item, location) {
  const normalized = normalizeInventoryItem(item || {})
  return Number(normalized.stockByLocation?.[location] || 0)
}

function getLocationMinimum(item, location) {
  const normalized = normalizeInventoryItem(item || {})
  return Number(normalized.minimumStockByLocation?.[location] || 0)
}

function getInventoryTotalStock(item) {
  return Object.values(normalizeInventoryItem(item || {}).stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)
}



function parseStoredArray(key) {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function getInventoryBackupHistory() {
  try {
    const stored = localStorage.getItem(INVENTORY_BACKUP_HISTORY_KEY)
    const parsed = stored ? JSON.parse(stored) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadInventorySafely() {
  const primary = parseStoredArray(INVENTORY_STORAGE_KEY)
  if (primary.length > 0) return normalizeInventory(primary)

  const backup = parseStoredArray(INVENTORY_BACKUP_KEY)
  if (backup.length > 0) {
    const normalizedBackup = normalizeInventory(backup)
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(normalizedBackup))
    return normalizedBackup
  }

  const backupHistory = getInventoryBackupHistory()
  const latestBackup = backupHistory.find((entry) => Array.isArray(entry?.items) && entry.items.length > 0)
  if (latestBackup) {
    const normalizedBackup = normalizeInventory(latestBackup.items)
    localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(normalizedBackup))
    localStorage.setItem(INVENTORY_BACKUP_KEY, JSON.stringify(normalizedBackup))
    return normalizedBackup
  }

  return []
}

function persistInventorySafely(items) {
  const nextItems = normalizeInventory(items)
  const existingItems = parseStoredArray(INVENTORY_STORAGE_KEY)

  if (nextItems.length === 0 && existingItems.length > 0) {
    console.warn("Se bloqueó un guardado vacío para proteger el inventario existente.")
    return false
  }

  if (existingItems.length > 0) {
    const history = getInventoryBackupHistory()
    const snapshot = {
      date: new Date().toISOString(),
      count: existingItems.length,
      items: existingItems
    }
    localStorage.setItem(INVENTORY_BACKUP_HISTORY_KEY, JSON.stringify([snapshot, ...history].slice(0, INVENTORY_MAX_BACKUPS)))
  }

  localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(nextItems))
  localStorage.setItem(INVENTORY_BACKUP_KEY, JSON.stringify(nextItems))
  localStorage.setItem(INVENTORY_BACKUP_META_KEY, JSON.stringify({
    date: new Date().toISOString(),
    count: nextItems.length
  }))
  return true
}

function getInventoryBackupMeta() {
  try {
    const stored = localStorage.getItem(INVENTORY_BACKUP_META_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}


function normalizeAccessRole(user) {
  const role = String(user?.role || user?.rol || "").trim().toLowerCase()
  return role
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}


const PURCHASE_ORDER_CREATOR_ROLES = ["admin", "gerente_general", "gerente", "encargado_almacen"]
const PURCHASE_ORDER_APPROVER_ROLES = ["admin", "gerente_general"]

function getPurchaseOrderStatusLabel(status) {
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

function generateUsernameFromName(name) {
  const base = String(name || "usuario")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
  return base || `usuario.${Date.now()}`
}

function getUserAuth(user) {
  return {
    username: user?.auth?.username || user?.username || generateUsernameFromName(user?.nombre),
    passwordHash: user?.auth?.passwordHash || user?.password || "",
    temporaryPassword: "",
    mustChangePassword: user?.auth?.mustChangePassword ?? !user?.auth,
    lastLogin: user?.auth?.lastLogin || user?.lastLogin || null,
    isOnline: user?.auth?.isOnline ?? false,
    status: user?.auth?.status || (user?.estado === "Inactivo" || user?.activo === false ? "inactive" : user?.estado === "Suspendido" ? "suspended" : "active")
  }
}



function LegacyInventoryApp({ initialSeccion = "dashboard", initialPurchaseOrderView = "", initialPurchaseOrderId = "", hideLegacyNavigation = false }) {
  const { user: authenticatedUser, profile: authProfile } = useAuth()
  const navigate = useNavigate()
  const [ordenCompra, setOrdenCompra] = useState([])
  const [purchaseOrderView, setPurchaseOrderView] = useState("automatic")
  const [ordenesCompraManual, setOrdenesCompraManual] = useState(() => {
    const datos = localStorage.getItem("ordenesCompraManual")
    return datos ? JSON.parse(datos) : []
  })
  const [manualBusqueda, setManualBusqueda] = useState("")
  const [manualIngredienteSeleccionadoId, setManualIngredienteSeleccionadoId] = useState(null)
  const [manualCantidadComprar, setManualCantidadComprar] = useState("")
  const [manualOrdenItems, setManualOrdenItems] = useState([])
  const [manualInventoryItems, setManualInventoryItems] = useState([])
  const [manualInventoryLoading, setManualInventoryLoading] = useState(false)
  const [manualInventoryError, setManualInventoryError] = useState("")
  const [manualIssueDate, setManualIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [manualExpectedDate, setManualExpectedDate] = useState("")
  const [manualStatus, setManualStatus] = useState("pendiente_aprobacion")
  const [manualProveedorId, setManualProveedorId] = useState(null)
  const [manualProveedorNombre, setManualProveedorNombre] = useState("")
  const [manualProveedorContacto, setManualProveedorContacto] = useState("")
  const [manualProveedorCorreo, setManualProveedorCorreo] = useState("")
  const [manualProveedorWhatsApp, setManualProveedorWhatsApp] = useState("")
  const [manualProveedorEncargado, setManualProveedorEncargado] = useState("")
  const [manualMetodoCompra, setManualMetodoCompra] = useState("banco")
  const [manualRequester, setManualRequester] = useState("")
  const [manualApprover, setManualApprover] = useState("")
  const [manualPriority, setManualPriority] = useState("normal")
  const [manualLocation, setManualLocation] = useState("EL Gran Alcazar Sucursal 1 zona 09")
  const [manualPedidoSeleccionadoId, setManualPedidoSeleccionadoId] = useState(null)
  const [manualRecepcionCantidad, setManualRecepcionCantidad] = useState("")
  const [manualRecepcionEstado, setManualRecepcionEstado] = useState("bueno")
  const [manualRecepcionNombre, setManualRecepcionNombre] = useState("")
  const [manualRecepcionImagen, setManualRecepcionImagen] = useState("")
  const [testFlowFilter, setTestFlowFilter] = useState(TEST_FLOW_FILTER.REAL)
  const [manualCreateTestMode, setManualCreateTestMode] = useState(false)

  const [proveedores, setProveedores] = useState([])
  const [proveedoresLoading, setProveedoresLoading] = useState(false)
  const [proveedoresError, setProveedoresError] = useState("")
  const [proveedoresMigracion, setProveedoresMigracion] = useState("")
  const [areas, setAreas] = useState([])
  const [areasLoading, setAreasLoading] = useState(true)
  const [areasError, setAreasError] = useState("")
  const [areaProfiles, setAreaProfiles] = useState([])
  const [areaForm, setAreaForm] = useState({
    id: "",
    name: "",
    type: "operativa",
    description: "",
    responsibleUserId: "",
    canRequestInventory: true,
    isProductionArea: false,
    active: true
  })
  const [editingAreaId, setEditingAreaId] = useState("")

  const [ingredientes, setIngredientes] = useState(() => {
    return loadInventorySafely()
  })
  const [inventoryMovements, setInventoryMovements] = useState(() => parseStoredArray(INVENTORY_MOVEMENTS_KEY))

  const [seccionActiva, setSeccionActiva] = useState(() => {
    const datosUsuario = localStorage.getItem("usuarioActual")
    return datosUsuario ? initialSeccion : "ordenes"
  })
  const [usuarioActual, setUsuarioActual] = useState(() => {
    const datos = localStorage.getItem("usuarioActual")
    return datos ? JSON.parse(datos) : null
  })

  useEffect(() => {
    setSeccionActiva(initialSeccion)
  }, [initialSeccion])

  useEffect(() => {
    const raw = localStorage.getItem("usuarioActual")
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      if (!parsed?.nombre) return
      setUsuarioActual((current) => {
        if (!current) return parsed
        if (current.id !== parsed.id || current.rol !== parsed.rol || current.username !== parsed.username) return parsed
        return current
      })
    } catch (error) {
      console.warn("[legacy] usuarioActual inválido en localStorage", error)
    }
  }, [authProfile?.id, authenticatedUser?.id])

  const cargarProveedoresSupabase = useCallback(async () => {
    setProveedoresLoading(true)
    setProveedoresError("")

    const result = await getSuppliers()
    if (result.error) {
      setProveedoresError(result.error.message || "No se pudieron cargar los proveedores.")
      setProveedoresLoading(false)
      return
    }

    let remoteSuppliers = result.data || []
    const localSuppliers = readLocalSuppliers()
    if (authenticatedUser?.role === "admin" && remoteSuppliers.length === 0 && localSuppliers.length > 0) {
      const migration = await migrateLocalSuppliers(localSuppliers)
      if (migration.error) {
        setProveedoresError(migration.error.message || "No se pudieron migrar los proveedores locales.")
      } else if (migration.imported > 0) {
        setProveedoresMigracion(`${migration.imported} proveedor(es) locales migrados a Supabase.`)
        localStorage.setItem("proveedoresMigradosSupabase", new Date().toISOString())
        const refreshed = await getSuppliers()
        remoteSuppliers = refreshed.data || migration.data || []
      }
    }

    setProveedores(remoteSuppliers)
    setProveedoresLoading(false)
  }, [authenticatedUser?.role])

  useEffect(() => {
    if (!["proveedores", "ordenes"].includes(seccionActiva)) return
    cargarProveedoresSupabase()
  }, [cargarProveedoresSupabase, seccionActiva])

  useEffect(() => {
    if (seccionActiva !== "ordenes") return undefined
    let isMounted = true

    async function cargarInventarioOrdenManual() {
      setManualInventoryLoading(true)
      setManualInventoryError("")

      const result = await getInventoryItems()
      if (!isMounted) return

      if (result.error) {
        setManualInventoryError(result.error.message || "No se pudo cargar el inventario para la orden manual.")
        setManualInventoryItems([])
      } else {
        setManualInventoryItems((result.data || [])
          .filter((item) => item?.active !== false)
          .map(mapPurchaseInventoryItem)
        )
      }

      setManualInventoryLoading(false)
    }

    cargarInventarioOrdenManual()
    return () => {
      isMounted = false
    }
  }, [seccionActiva])

  const [usuarioLogin, setUsuarioLogin] = useState("")
  const [contrasenaLogin, setContrasenaLogin] = useState("")

  const [notificaciones, setNotificaciones] = useState([])
  const [mostrarNotificaciones, setMostrarNotificaciones] = useState(false)

  useEffect(() => {
    try {
      persistInventorySafely(ingredientes)
    } catch (error) {
      console.error("No se pudo guardar el inventario", error)
    }
  }, [ingredientes])

  useEffect(() => {
    localStorage.setItem(INVENTORY_MOVEMENTS_KEY, JSON.stringify(inventoryMovements))
  }, [inventoryMovements])

  useEffect(() => {
    setIngredientes((actuales) => actuales.map((item) => {
      const normalized = normalizeInventoryItem(item)
      const stockByLocation = { ...normalized.stockByLocation }
      const minimumStockByLocation = { ...normalized.minimumStockByLocation }
      areas.forEach((area) => {
        if (!(area.id in stockByLocation)) stockByLocation[area.id] = 0
        if (!(area.id in minimumStockByLocation)) minimumStockByLocation[area.id] = 0
      })
      return { ...normalized, stockByLocation, minimumStockByLocation }
    }))
  }, [areas])

  useEffect(() => {
    cargarAreasSupabase()
    cargarResponsablesAreas()
  }, [])

  useEffect(() => {
    localStorage.setItem("ordenesCompraManual", JSON.stringify(ordenesCompraManual))
  }, [ordenesCompraManual])

  useEffect(() => {
    if (seccionActiva !== "ordenes") return undefined
    let active = true
    getPurchaseOrders({ testFlowFilter }).then(({ data, error }) => {
      if (!active || error || !data?.length) return
      setOrdenesCompraManual((localOrders) => {
        const remoteIds = new Set(data.map((order) => String(order.id)))
        return [...data, ...localOrders.filter((order) => !remoteIds.has(String(order.id)))]
      })
    })
    return () => {
      active = false
    }
  }, [seccionActiva, testFlowFilter])

  const usuariosAutorizados = [
    { username: "admin", passwordHash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", nombre: "Administrador" },
    { username: "colaborador", passwordHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", nombre: "Colaborador autorizado" }
  ]

  const [users, setUsers] = useState([])

  const [asistenciaBusqueda, setAsistenciaBusqueda] = useState("")
  const [asistenciaFechaFiltro, setAsistenciaFechaFiltro] = useState(() => obtenerFechaLocal())
  const [asistenciaReporteColaboradorId, setAsistenciaReporteColaboradorId] = useState("")
  const [asistenciaPerfiles, setAsistenciaPerfiles] = useState([])
  const [asistenciaCargando, setAsistenciaCargando] = useState(false)
  const [asistenciaLlegadasTarde, setAsistenciaLlegadasTarde] = useState([])
  const [asistenciaGraceMinutes, setAsistenciaGraceMinutes] = useState(5)
  const [asistenciaFotoAmpliada, setAsistenciaFotoAmpliada] = useState("")
  const [asistenciaDetalleMarcaje, setAsistenciaDetalleMarcaje] = useState(null)
  const [asistenciaMovimientos, setAsistenciaMovimientos] = useState(() => {
    const datos = localStorage.getItem("asistenciaMovimientos")
    return datos ? JSON.parse(datos) : []
  })
  useEffect(() => {
    if (seccionActiva === "reportesAsistencia") return
    try {
      localStorage.setItem("asistenciaMovimientos", JSON.stringify(asistenciaMovimientos))
    } catch (error) {
      console.warn("[asistencia] No se pudieron guardar movimientos en localStorage", error)
    }
  }, [asistenciaMovimientos, seccionActiva])

  useEffect(() => {
    if (seccionActiva !== "reportesAsistencia") return
    cargarAsistenciaSupabase()
  }, [seccionActiva])

  useEffect(() => {
    if (seccionActiva !== "reportesAsistencia") return
    cargarLlegadasTarde()
  }, [seccionActiva, asistenciaFechaFiltro, asistenciaReporteColaboradorId])

  useEffect(() => {
    if (seccionActiva !== "reportesAsistencia") return
    const filteredCount = asistenciaLlegadasTarde.filter((row) => {
      const texto = asistenciaBusqueda.toLowerCase()
      return !texto || String(row.colaboradorNombre || "").toLowerCase().includes(texto) || String(row.area || "").toLowerCase().includes(texto)
    }).length
    console.log("[asistencia/tardanza] render state", {
      stateCount: asistenciaLlegadasTarde.length,
      filteredCount,
      busqueda: asistenciaBusqueda,
      cardCount: filteredCount,
      tableVisible: filteredCount > 0,
      rows: asistenciaLlegadasTarde
    })
    if (asistenciaLlegadasTarde.length > 0 && filteredCount === 0) {
      console.warn("[asistencia/tardanza] datos en state pero filtro de búsqueda los oculta", {
        busqueda: asistenciaBusqueda
      })
    }
  }, [seccionActiva, asistenciaLlegadasTarde, asistenciaBusqueda])

  async function cargarLlegadasTarde() {
    console.log("[asistencia/tardanza] current user", authenticatedUser?.id)
    console.log("[asistencia/tardanza] current role", authProfile?.role)

    const employeeId = asistenciaReporteColaboradorId || null
    console.log("[asistencia/tardanza] filtered employee/date", {
      date: asistenciaFechaFiltro,
      employeeId: employeeId || "todos"
    })

    const { data: setupStatus, error: setupError } = await getAttendanceLateArrivalsSetupStatus()
    if (setupError) {
      console.error("[asistencia/tardanza] setup status error", setupError)
      if (setupError.code === "PGRST202" || String(setupError.message || "").includes("attendance_late_arrivals_setup_status")) {
        console.error("[asistencia/tardanza] FALTA MIGRACION: ejecutar 071_fix_late_attendance.sql y 072_late_attendance_diagnostics.sql en Supabase")
      }
    } else {
      console.log("[asistencia/tardanza] migration/setup", setupStatus)
      if (setupStatus && setupStatus.migration_071_applied === false) {
        console.error("[asistencia/tardanza] FALTA MIGRACION 071: get_attendance_daily_late_arrivals no existe en Supabase")
      }
      if (setupStatus && setupStatus.viewer_can_view_reports === false) {
        console.error("[asistencia/tardanza] PERMISO RPC: el usuario autenticado no pasa can_view_attendance_reports (requiere admin/gerente_general/recursos_humanos en profiles.role)")
      }
    }

    const [{ data: graceData, error: graceError }, { data: lateRows, error: lateError }] = await Promise.all([
      getAttendanceLateGraceMinutes(),
      getAttendanceDailyLateArrivals(asistenciaFechaFiltro, employeeId)
    ])

    if (graceError) {
      console.error("[asistencia/tardanza] grace_minutes error", graceError)
    }
    const graceMinutes = Number(graceData ?? setupStatus?.grace_minutes ?? 5)
    setAsistenciaGraceMinutes(Number.isFinite(graceMinutes) ? graceMinutes : 5)
    console.log("[asistencia/tardanza] grace_minutes", Number.isFinite(graceMinutes) ? graceMinutes : 5)

    if (lateError) {
      console.error("[asistencia/tardanza] RPC get_attendance_daily_late_arrivals falló:", lateError.message || lateError)
      if (lateError.code === "PGRST202" || String(lateError.message || "").includes("get_attendance_daily_late_arrivals")) {
        console.error("[asistencia/tardanza] FALTA MIGRACION: aplicar supabase/schema/071_fix_late_attendance.sql")
      }
      if (String(lateError.message || "").includes("PERMISSION_DENIED")) {
        console.error("[asistencia/tardanza] PERMISO RPC: usuario sin rol admin/gerente_general/recursos_humanos en Supabase")
      }
      setAsistenciaLlegadasTarde([])
      return
    }

    const rows = (lateRows || []).map((row) => ({
      id: `${row.employee_id}-${row.shift_date}-${row.scheduled_start}`,
      colaboradorId: row.employee_id,
      colaboradorNombre: row.employee_name,
      fecha: row.shift_date,
      area: row.area || "",
      horaProgramada: row.scheduled_start?.slice?.(0, 5) || String(row.scheduled_start || "").slice(0, 5),
      horaEntrada: row.check_in_local?.slice?.(0, 5) || String(row.check_in_local || "").slice(0, 5),
      minutosTarde: row.late_minutes,
      toleranciaMinutos: row.grace_minutes,
      horarioEstado: row.schedule_status === "draft" ? "Borrador" : "Publicado",
      sinSalida: !row.has_checkout
    }))
    rows.forEach((row) => {
      console.log("[asistencia/tardanza] mapped row", {
        colaborador: row.colaboradorNombre,
        fecha: row.fecha,
        schedule_start: row.horaProgramada,
        check_in: row.horaEntrada,
        grace_minutes: row.toleranciaMinutos,
        is_late: true,
        late_minutes: row.minutosTarde
      })
    })

    if (rows.length === 0) {
      const probeName = asistenciaBusqueda.trim() || "Kimberly"
      const { data: probeRows, error: probeError } = await probeAttendanceLateArrival(asistenciaFechaFiltro, probeName)
      if (probeError) {
        console.warn("[asistencia/tardanza] probe error (aplicar 072 para habilitar)", probeError.message || probeError)
      } else {
        console.log("[asistencia/tardanza] probe steps", probeRows)
        probeRows?.forEach((step) => {
          console.log(`[asistencia/tardanza] probe ${step.step}: ${step.ok ? "OK" : "FAIL"} — ${step.detail}`)
        })
      }
    }

    console.log("[asistencia/tardanza] setState asistenciaLlegadasTarde", { count: rows.length, rows })
    setAsistenciaLlegadasTarde(rows)
  }

  async function cargarAsistenciaSupabase() {
    setAsistenciaCargando(true)
    const { data: profiles, error: profilesError } = await getAttendanceTerminalProfiles()
    if (profilesError) {
      setAsistenciaCargando(false)
      return
    }
    setAsistenciaPerfiles((profiles || []).map((profile) => ({
      id: profile.id,
      nombre: profile.full_name || "Sin nombre",
      employeeId: profile.employee_code || "",
      fotoColaborador: profile.avatar_url || "",
      departamento: profile.area_name || "",
      pinConfigurado: profile.pin_configured,
      activo: true
    })))

    const canReviewEvidence = ["admin", "gerente_general", "recursos_humanos"].includes(normalizeRole(authenticatedUser?.role))
    const { data: marks, error: marksError } = await getAttendanceMarks(canReviewEvidence)
    if (!marksError) {
      setAsistenciaMovimientos((marks || []).map((mark) => {
        const markedDate = new Date(mark.marked_at)
        return {
          id: mark.id,
          colaboradorId: mark.employee_id,
          colaboradorNombre: mark.employee_name,
          fecha: markedDate.toLocaleDateString("en-CA", { timeZone: "America/Guatemala" }),
          hora: markedDate.toLocaleTimeString("es-GT", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Guatemala" }),
          fechaHoraISO: mark.marked_at,
          tipo: mark.mark_type,
          estado: mark.device_alert ? "Dispositivo no autorizado" : "válido",
          registradoPor: mark.device_name,
          dispositivoLabel: formatAttendanceDevice(mark),
          observacion: mark.observation || "",
          notas: extractUserObservation(mark),
          userAgent: resolveAttendanceUserAgent(mark),
          fotoMarcaje: mark.photo_url,
          deviceId: mark.device_id,
          dispositivoNoAutorizado: mark.device_alert,
          banoInicioId: mark.related_mark_id,
          duracionMinutos: mark.duration_minutes,
          excedido: Number(mark.duration_minutes || 0) > 10
        }
      }))
    }
    setAsistenciaCargando(false)
  }

  // Migrar contraseñas en texto plano a hashes (solo al iniciar)
  useEffect(() => {
    let mounted = true
    async function migratePasswords() {
      try {
        const needs = users.some(u => (u && u.password && !/^[a-f0-9]{64}$/.test(String(u.password))) || (u && !u.auth))
        if (!needs) return
        const nuevos = await Promise.all(users.map(async (u) => {
          if (!u) return u
          const hp = u.password
            ? (/^[a-f0-9]{64}$/.test(String(u.password)) ? String(u.password) : await hashPassword(u.password))
            : (u.auth?.passwordHash || "")
          return {
            ...u,
            password: hp,
            auth: {
              ...getUserAuth(u),
              username: u.auth?.username || u.username || generateUsernameFromName(u.nombre),
              passwordHash: u.auth?.passwordHash || hp,
              temporaryPassword: "",
              isOnline: u.auth?.isOnline ?? false,
              status: u.auth?.status || (u.estado === "Inactivo" || u.activo === false ? "inactive" : u.estado === "Suspendido" ? "suspended" : "active")
            }
          }
        }))
        if (mounted) setUsers(nuevos)
      } catch (error) {
        console.error('Migración de contraseñas falló', error)
      }
    }
    migratePasswords()
    return () => { mounted = false }
  }, [users])

  useEffect(() => {
    if (usuarioActual) localStorage.setItem("usuarioActual", JSON.stringify(usuarioActual))
    else localStorage.removeItem("usuarioActual")
  }, [usuarioActual])

  function obtenerFechaLocal(fecha = new Date()) {
    const fechaLocal = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000)
    return fechaLocal.toISOString().slice(0, 10)
  }



  function sha256HexFallback(value) {
    const bytes = new TextEncoder().encode(String(value))
    const rightRotate = (num, bits) => (num >>> bits) | (num << (32 - bits))
    const k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ]
    const message = [...bytes, 0x80]
    while ((message.length % 64) !== 56) message.push(0)
    const bitLength = bytes.length * 8
    for (let i = 7; i >= 0; i--) message.push((bitLength / (2 ** (i * 8))) & 0xff)

    let h0 = 0x6a09e667
    let h1 = 0xbb67ae85
    let h2 = 0x3c6ef372
    let h3 = 0xa54ff53a
    let h4 = 0x510e527f
    let h5 = 0x9b05688c
    let h6 = 0x1f83d9ab
    let h7 = 0x5be0cd19

    for (let i = 0; i < message.length; i += 64) {
      const w = new Array(64).fill(0)
      for (let j = 0; j < 16; j++) {
        w[j] = ((message[i + j * 4] << 24) | (message[i + j * 4 + 1] << 16) | (message[i + j * 4 + 2] << 8) | message[i + j * 4 + 3]) >>> 0
      }
      for (let j = 16; j < 64; j++) {
        const s0 = rightRotate(w[j - 15], 7) ^ rightRotate(w[j - 15], 18) ^ (w[j - 15] >>> 3)
        const s1 = rightRotate(w[j - 2], 17) ^ rightRotate(w[j - 2], 19) ^ (w[j - 2] >>> 10)
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (let j = 0; j < 64; j++) {
        const s1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
        const ch = (e & f) ^ (~e & g)
        const temp1 = (h + s1 + ch + k[j] + w[j]) >>> 0
        const s0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const temp2 = (s0 + maj) >>> 0
        h = g
        g = f
        f = e
        e = (d + temp1) >>> 0
        d = c
        c = b
        b = a
        a = (temp1 + temp2) >>> 0
      }
      h0 = (h0 + a) >>> 0
      h1 = (h1 + b) >>> 0
      h2 = (h2 + c) >>> 0
      h3 = (h3 + d) >>> 0
      h4 = (h4 + e) >>> 0
      h5 = (h5 + f) >>> 0
      h6 = (h6 + g) >>> 0
      h7 = (h7 + h) >>> 0
    }

    return [h0, h1, h2, h3, h4, h5, h6, h7].map((item) => item.toString(16).padStart(8, "0")).join("")
  }

  // Seguridad: hashear contraseñas (SHA-256) y utilidad hex
  async function hashPassword(password) {
    if (!password) return ""
    try {
      if (!globalThis.crypto?.subtle) return sha256HexFallback(password)
      const msgUint8 = new TextEncoder().encode(String(password))
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      return hashHex
    } catch {
      return sha256HexFallback(password)
    }
  }

  async function passwordCoincide(passwordIngresado, passwordGuardado) {
    if (!passwordIngresado || !passwordGuardado) return false
    if (String(passwordIngresado) === String(passwordGuardado)) return true
    const hashIngresado = await hashPassword(passwordIngresado)
    return hashIngresado === String(passwordGuardado)
  }

  // Session inactivity handling
  const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes
  const [lastActivity, setLastActivity] = useState(() => Date.now())

  useEffect(() => {
    function touch() { setLastActivity(Date.now()) }
    window.addEventListener('mousemove', touch)
    window.addEventListener('keydown', touch)
    window.addEventListener('click', touch)

    const interval = setInterval(() => {
      if (!usuarioActual) return
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT_MS) {
        alert('Sesión expirada por inactividad.')
        setUsuarioActual(null)
      }
    }, 60 * 1000)

    return () => {
      window.removeEventListener('mousemove', touch)
      window.removeEventListener('keydown', touch)
      window.removeEventListener('click', touch)
      clearInterval(interval)
    }
  }, [lastActivity, usuarioActual, INACTIVITY_TIMEOUT_MS])




  function hasRole(roles) {
    if (!usuarioActual) return false
    if (!Array.isArray(roles)) roles = [roles]
    return roles.includes(usuarioActual.rol)
  }

  const puedeVerPOS = hasRole(["Administrador", "Gerente General", "Supervisor", "FOH"])
  const puedeVerReportesRRHH = hasRole(["Administrador", "Gerente General", "Recursos Humanos"])
    || ["admin", "gerente_general", "recursos_humanos", "rrhh"].includes(normalizeRole(authenticatedUser?.role))

  const puedeAdministrarAreas = hasRole(["Administrador", "Gerente General"]) || ["admin", "gerente"].includes(authenticatedUser?.role)

  const modulosDisponibles = [
    { key: "movimientosInventario", label: "Movimientos", icon: "↔", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "Recursos Humanos"] },
    { key: "inventarioAreas", label: "Inventario por áreas", icon: "▦", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
    { key: "areas", label: "Áreas operativas", icon: "⚙", roles: ["Administrador", "Gerente General"] },
    { key: "ordenes", label: "Órdenes de compra", icon: "📋", roles: ["Administrador", "Gerente General", "Gerente", "Encargado de Almacén"] },
    { key: "puntoVenta", label: "Punto de Venta", icon: "💳", roles: ["Administrador", "Gerente General", "Supervisor", "FOH"] },
    { key: "asistencia", label: "Marcaje de asistencia", icon: "📷", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "BOH", "Cocina", "Servicio", "Recursos Humanos"] },
    { key: "reportesAsistencia", label: "Reportes de asistencia", icon: "📊", roles: ["Administrador", "Gerente General", "Recursos Humanos"] },
    { key: "proveedores", label: "Proveedores", icon: "🚚", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
  ]

  const modulosPermitidos = modulosDisponibles.filter((modulo) => hasRole(modulo.roles))
  const moduleContext = {
    dashboard: ["Panel principal", "Resumen de operaciones y accesos del restaurante"],
    movimientosInventario: ["Movimientos", "Kardex y auditoría de transferencias internas"],
    inventarioAreas: ["Inventario por áreas", "Existencias operativas por ubicación"],
    areas: ["Áreas operativas", "Administración de ubicaciones operativas y responsables"],
    ordenes: ["Órdenes de compra", "Compras, recepción y seguimiento de proveedores"],
    puntoVenta: ["Punto de Venta", "Operación de mesas, comandas y cobros"],
    asistencia: ["Asistencia", "Marcaje, entradas, salidas y control de turno"],
    reportesAsistencia: ["Reportes de asistencia", "Indicadores de puntualidad y presencia del equipo"],
    proveedores: ["Proveedores", "Directorio comercial y productos asociados"],
  }
  const [moduleTitle, moduleSubtitle] = moduleContext[seccionActiva] || ["Operaciones", BRANDING.tagline]

  useEffect(() => {
    if (seccionActiva === "reportesAsistencia" && puedeVerReportesRRHH) return
    if (!usuarioActual) return
    const seccionValida = modulosDisponibles.some((modulo) => modulo.key === seccionActiva && hasRole(modulo.roles))
    if (!seccionValida) {
      setSeccionActiva("dashboard")
    }
  }, [usuarioActual, seccionActiva, puedeVerReportesRRHH])


  const ordenManualSeleccionada = ordenesCompraManual.find(
    (orden) => orden.id === manualPedidoSeleccionadoId
  )
  const purchaseOrderRole = authenticatedUser?.role || normalizeAccessRole(usuarioActual)
  const puedeCrearOrdenCompra = PURCHASE_ORDER_CREATOR_ROLES.includes(purchaseOrderRole)
  const puedeAprobarOrdenCompra = PURCHASE_ORDER_APPROVER_ROLES.includes(purchaseOrderRole)
  const puedeRecibirOrdenCompra = ["admin", "gerente_general", "encargado_almacen"].includes(purchaseOrderRole)
  const requiereAprobacionOrdenCompra = ["gerente", "encargado_almacen"].includes(purchaseOrderRole)
  const puedeCrearPruebaFlujo = canCreateTestFlow(authenticatedUser)

  useEffect(() => {
    if (initialSeccion !== "ordenes") return
    if (["automatic", "manual", "history"].includes(initialPurchaseOrderView)) {
      setPurchaseOrderView(initialPurchaseOrderView)
    }
    if (!initialPurchaseOrderId) return
    getPurchaseOrders({ testFlowFilter: TEST_FLOW_FILTER.ALL }).then(({ data, error }) => {
      if (error) return
      setOrdenesCompraManual((localOrders) => {
        const remoteIds = new Set((data || []).map((order) => String(order.id)))
        return [...(data || []), ...localOrders.filter((order) => !remoteIds.has(String(order.id)))]
      })
      if ((data || []).some((orden) => String(orden.id) === String(initialPurchaseOrderId))) {
        setManualPedidoSeleccionadoId(Number(initialPurchaseOrderId) || initialPurchaseOrderId)
      }
    })
  }, [initialPurchaseOrderId, initialPurchaseOrderView, initialSeccion])

  useEffect(() => {
    function processNotificationAction(event) {
      const action = event?.detail || JSON.parse(window.sessionStorage.getItem("purchase-order-notification-action") || "null")
      if (!action?.id || !puedeAprobarOrdenCompra) return
      if (!ordenesCompraManual.some((orden) => String(orden.id) === String(action.id))) return
      window.sessionStorage.removeItem("purchase-order-notification-action")
      setPurchaseOrderView("history")
      setManualPedidoSeleccionadoId(Number(action.id) || action.id)
      if (action.action === "approve") aprobarOrdenManual(action.id)
      if (action.action === "reject") rechazarOrdenManual(action.id)
    }
    processNotificationAction()
    window.addEventListener("purchase-order-action", processNotificationAction)
    return () => window.removeEventListener("purchase-order-action", processNotificationAction)
  }, [puedeAprobarOrdenCompra, ordenesCompraManual])

  const manualInventorySource = manualInventoryItems.length > 0
    ? manualInventoryItems
    : ingredientes.map(mapPurchaseInventoryItem)
  const manualIngredienteSeleccionado = manualInventorySource.find(
    (ingrediente) => ingrediente.id === manualIngredienteSeleccionadoId
  )

  const nuevasNotificacionesCount = notificaciones.filter((item) => !item.leida).length



  function completarProveedorDesdeIngrediente(ingrediente) {
    const proveedor = ingrediente?.proveedorId
      ? proveedores.find((item) => item.id === ingrediente.proveedorId)
      : null

    setManualProveedorId(proveedor?.id || null)
    setManualProveedorNombre(proveedor?.nombreComercial || ingrediente?.proveedorNombre || ingrediente?.supplier || "")
    setManualProveedorContacto(proveedor?.telefono || "")
    setManualProveedorCorreo(proveedor?.correo || "")
    setManualProveedorWhatsApp(proveedor?.whatsapp || "")
    setManualProveedorEncargado(proveedor?.encargado || "")
    setManualMetodoCompra(proveedor ? obtenerMetodoPagoPreferido(proveedor) : "banco")
  }


  async function iniciarSesion() {
    // primero buscar en usuarios creados comparando hash
    try {
      const hp = await hashPassword(contrasenaLogin)
      const usuario = users.find((u) => {
        const auth = getUserAuth(u)
        const username = auth.username || u.username
        const passwordHash = auth.passwordHash || u.password
        return username === usuarioLogin && passwordHash === hp
      })

      if (usuario) {
        const auth = getUserAuth(usuario)
        if (!usuario.activo || auth.status === "inactive" || auth.status === "suspended") {
          alert("Usuario inactivo. Contacta al administrador.")
          return
        }
        const lastLogin = new Date().toISOString()
        setUsers((actuales) => actuales.map((u) => u.id === usuario.id ? { ...u, auth: { ...getUserAuth(u), lastLogin, isOnline: true }, lastLogin } : u))
        const ua = { nombre: usuario.nombre, username: auth.username || usuario.username, rol: usuario.rol, role: normalizeAccessRole(usuario), id: usuario.id, departamento: usuario.departamento }
        setUsuarioActual(ua)
        setSeccionActiva(initialSeccion)
        setLastActivity(Date.now())
        setUsuarioLogin("")
        setContrasenaLogin("")
        if (auth.mustChangePassword) {
          alert("Debes cambiar tu contraseña. Solicita una contraseña nueva al administrador si aún no tienes flujo de autoservicio.")
        }
        return
      }

      // fallback a autorizados embebidos (solo si no existe usuario creado)
      const builtin = usuariosAutorizados.find((u) => u.username === usuarioLogin && u.passwordHash === hp)
      if (builtin) {
        setUsuarioActual({ nombre: builtin.nombre, username: builtin.username, rol: "Administrador", id: builtin.username })
        setSeccionActiva(initialSeccion)
        setLastActivity(Date.now())
        setUsuarioLogin("")
        setContrasenaLogin("")
        return
      }

      alert("Usuario o contraseña incorrectos.")
    } catch (e) {
      console.error(e)
      alert("Error al iniciar sesión.")
    }
  }


  const agregarNotificacion = useCallback((clave, tipo, mensaje) => {
    if (!clave || !mensaje) return
    setNotificaciones((prev) => {
      if (prev.some((item) => item.clave === clave)) return prev
      return [
        {
          id: Date.now() + Math.random(),
          clave,
          tipo,
          mensaje,
          fecha: new Date().toLocaleString(),
          leida: false
        },
        ...prev
      ]
    })
  }, [])

  function marcarNotificacionesComoLeidas() {
    setNotificaciones((prev) => prev.map((item) => ({ ...item, leida: true })))
  }

  function toggleNotificaciones() {
    setMostrarNotificaciones((prev) => {
      const nuevoValor = !prev
      if (!prev) {
        marcarNotificacionesComoLeidas()
      }
      return nuevoValor
    })
  }

  const evaluarAlertasStock = useCallback(() => {
    ingredientes.forEach((ingrediente) => {
      const stockAlmacen = getLocationStock(ingrediente, "almacen")
      const puntoOrden = Number(ingrediente.puntoOrden || 0)
      const puntoMinimo = getLocationMinimum(ingrediente, "almacen")

      if (puntoMinimo > 0 && stockAlmacen <= puntoMinimo) {
        agregarNotificacion(
          `stock-minimo-almacen-${ingrediente.id}`,
          "stock",
          `Stock bajo en almacén: ${ingrediente.nombre} (${stockAlmacen} ${ingrediente.unidadCompra}).`
        )
      } else if (puntoOrden > 0 && stockAlmacen <= puntoOrden) {
        agregarNotificacion(
          `stock-orden-${ingrediente.id}`,
          "stock",
          `Orden recomendada: ${ingrediente.nombre} ha llegado al punto de orden en almacén (${stockAlmacen} ${ingrediente.unidadCompra}).`
        )
      }

      areas.filter((area) => area.id !== "almacen" && area.active !== false).forEach((area) => {
        const stockArea = getLocationStock(ingrediente, area.id)
        const minimoArea = getLocationMinimum(ingrediente, area.id)
        if (stockArea <= 0) {
          agregarNotificacion(`stock-agotado-${area.id}-${ingrediente.id}`, "stock", `Insumo agotado en ${area.name}: ${ingrediente.nombre}.`)
        } else if (minimoArea > 0 && stockArea <= minimoArea) {
          agregarNotificacion(`stock-minimo-${area.id}-${ingrediente.id}`, "stock", `Stock bajo en ${area.name}: ${ingrediente.nombre} (${stockArea} ${ingrediente.unidadCompra}).`)
        }
      })
    })
  }, [ingredientes, areas, agregarNotificacion])

  const evaluarOrdenesVencidas = useCallback(() => {
    ordenesCompraManual.forEach((orden) => {
      if (!orden.fechaEsperadaEntrega) return
      const fechaEsperada = new Date(orden.fechaEsperadaEntrega)
      const ahora = new Date()
      if (fechaEsperada < ahora && !["recibida", "recibida_completa", "cancelada", "rechazada"].includes(orden.status)) {
        agregarNotificacion(
          `orden-vencida-${orden.id}`,
          "orden",
          `Recordatorio: la orden ${orden.numeroOrden} está vencida y sigue sin ser recibida.`
        )
      }
    })
  }, [ordenesCompraManual, agregarNotificacion])

  useEffect(() => {
    evaluarAlertasStock()
    evaluarOrdenesVencidas()
  }, [evaluarAlertasStock, evaluarOrdenesVencidas])

  function cerrarSesion() {
    if (usuarioActual?.id) {
      setUsers((actuales) => actuales.map((u) => (
        u.id === usuarioActual.id
          ? { ...u, auth: { ...getUserAuth(u), isOnline: false } }
          : u
      )))
    }
    setUsuarioActual(null)
    setSeccionActiva("dashboard")
  }

  function getAreaLabel(areaId) {
    return areas.find((area) => area.id === areaId)?.name || INVENTORY_LOCATIONS[areaId] || areaId
  }

  async function cargarAreasSupabase() {
    setAreasLoading(true)
    const { data, error } = await getSupabaseAreas()
    if (error) {
      setAreas([])
      setAreasError("No se pudieron cargar las áreas desde Supabase.")
    } else {
      setAreas(data || [])
      setAreasError("")
    }
    setAreasLoading(false)
  }

  async function cargarResponsablesAreas() {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .eq("status", "active")
      .order("full_name", { ascending: true })
    if (!error) setAreaProfiles(data || [])
  }

  async function guardarArea() {
    if (!puedeAdministrarAreas) return
    const name = areaForm.name.trim()
    if (!name) {
      alert("Ingresa el nombre del área.")
      return
    }
    const id = editingAreaId || slugifyAreaName(name)
    if (!id) return
    if (!editingAreaId && areas.some((area) => area.id === id)) {
      alert("Ya existe un área con ese nombre.")
      return
    }
    const nextArea = {
      ...areaForm,
      id,
      name,
      type: id === "almacen" ? "principal" : areaForm.type,
      active: id === "almacen" ? true : areaForm.active,
      canRequestInventory: id === "almacen" ? false : areaForm.canRequestInventory,
      isProductionArea: id === "almacen" ? false : areaForm.isProductionArea
    }
    const { error } = editingAreaId
      ? await updateSupabaseArea(editingAreaId, nextArea)
      : await createSupabaseArea(nextArea)
    if (error) {
      alert(error.message || "No se pudo guardar el área en Supabase.")
      return
    }
    await cargarAreasSupabase()
    setAreaForm({ id: "", name: "", type: "operativa", description: "", responsibleUserId: "", canRequestInventory: true, isProductionArea: false, active: true })
    setEditingAreaId("")
  }

  function editarArea(area) {
    setEditingAreaId(area.id)
    setAreaForm({
      id: area.id,
      name: area.name,
      type: area.type || "operativa",
      description: area.description || "",
      responsibleUserId: area.responsibleUserId || "",
      canRequestInventory: area.canRequestInventory !== false,
      isProductionArea: area.isProductionArea === true,
      active: area.active !== false
    })
  }

  async function desactivarArea(area) {
    if (area.id === "almacen") {
      alert("El Almacén principal no puede desactivarse.")
      return
    }
    const hasStock = ingredientes.some((item) => getLocationStock(item, area.id) > 0)
    if (hasStock && !window.confirm(`El área ${area.name} aún tiene existencias. ¿Deseas desactivarla de todos modos?`)) return
    const { error } = await deactivateSupabaseArea(area.id)
    if (error) {
      alert(error.message || "No se pudo desactivar el área.")
      return
    }
    await cargarAreasSupabase()
  }

  function crearRequisicionParaArea(areaId) {
    const query = areaId ? `?section=requisicion&area=${encodeURIComponent(areaId)}` : "?section=requisicion"
    navigate(`/inventory${query}`)
  }

  function generarOrdenCompra() {
    const productos = ingredientes
      .filter((ingrediente) => {
        const stock = Number(ingrediente.totalUnidades)
        const orden = Number(ingrediente.puntoOrden)
        const maximo = Number(ingrediente.puntoMaximo)

        return orden > 0 && maximo > 0 && stock <= orden
      })
      .map((ingrediente) => {
        const stock = Number(ingrediente.totalUnidades)
        const maximo = Number(ingrediente.puntoMaximo)
        const cantidadAComprar = maximo - stock
        const costo = limpiarNumero(ingrediente.costoUnitario)

        return {
          id: ingrediente.id,
          codigo: ingrediente.codigo,
          nombre: ingrediente.nombre,
          categoria: ingrediente.categoria,
          stockActual: stock,
          puntoOrden: ingrediente.puntoOrden,
          puntoMaximo: maximo,
          cantidadAComprar,
          unidadCompra: ingrediente.unidadCompra,
          costoUnitario: costo,
          costoEstimado: cantidadAComprar * costo
        }
      })

    setOrdenCompra(productos)
  }

  function limpiarOrdenCompra() {
    setOrdenCompra([])
  }

  function seleccionarIngredienteOrdenManual(ingrediente) {
    setManualIngredienteSeleccionadoId(ingrediente.id)
    setManualBusqueda("")
    setManualCantidadComprar("")
    completarProveedorDesdeIngrediente(ingrediente)
  }

  function agregarIngredienteOrdenManual() {
    if (!manualIngredienteSeleccionado) {
      alert("Selecciona un ingrediente válido para la orden manual.")
      return
    }

    const cantidad = Number(manualCantidadComprar)
    if (!cantidad || cantidad <= 0) {
      alert("Ingresa una cantidad válida para el ingrediente.")
      return
    }

    const detalle = getPurchaseProductDetails(manualIngredienteSeleccionado)
    const existeItem = manualOrdenItems.find((item) => (item.producto_id || item.id) === detalle.productoId)
    const nuevoItem = {
      id: detalle.productoId,
      producto_id: detalle.productoId,
      inventory_item_id: detalle.productoId,
      nombre: detalle.nombre,
      item_name: detalle.nombre,
      sku: detalle.sku,
      codigo: detalle.sku,
      cantidad_compra: cantidad,
      cantidadComprar: cantidad,
      unidad_compra: detalle.unidadCompra,
      unidadCompra: detalle.unidadCompra,
      unit: detalle.unidadCompra,
      precio_unitario_compra: detalle.precioCompra,
      costoUnitario: detalle.precioCompra,
      estimated_cost: detalle.precioCompra,
      subtotal: cantidad * detalle.precioCompra,
      factor_conversion: detalle.factorConversion,
      unidad_base: detalle.unidadBase,
      cantidad_base_total: cantidad * detalle.factorConversion,
      proveedor: detalle.proveedor,
      imagen: manualIngredienteSeleccionado.imagen || manualIngredienteSeleccionado.image_url || "",
      image_url: manualIngredienteSeleccionado.image_url || manualIngredienteSeleccionado.imagen || ""
    }

    if (existeItem) {
      const debeSumarse = window.confirm(
        `"${detalle.nombre}" ya está incluido en la orden. ¿Deseas sumar ${cantidad} ${detalle.unidadCompra} a la cantidad existente?`
      )
      if (!debeSumarse) return
      setManualOrdenItems((items) =>
        items.map((item) => {
          if ((item.producto_id || item.id) === detalle.productoId) {
            const cantidadActualizada = Number(item.cantidad_compra ?? item.cantidadComprar ?? 0) + cantidad
            return {
              ...item,
              ...nuevoItem,
              cantidad_compra: cantidadActualizada,
              cantidadComprar: cantidadActualizada,
              subtotal: cantidadActualizada * detalle.precioCompra,
              cantidad_base_total: cantidadActualizada * detalle.factorConversion
            }
          }
          return item
        })
      )
    } else {
      setManualOrdenItems((items) => [...items, nuevoItem])
    }

    setManualBusqueda("")
    setManualIngredienteSeleccionadoId(null)
    setManualCantidadComprar("")
  }

  function limpiarFormularioOrdenManual() {
    setManualBusqueda("")
    setManualIngredienteSeleccionadoId(null)
    setManualCantidadComprar("")
    setManualOrdenItems([])
    setManualIssueDate(new Date().toISOString().slice(0, 10))
    setManualExpectedDate("")
    setManualStatus("pendiente_aprobacion")
    setManualProveedorId(null)
    setManualProveedorNombre("")
    setManualProveedorContacto("")
    setManualProveedorCorreo("")
    setManualProveedorWhatsApp("")
    setManualProveedorEncargado("")
    setManualMetodoCompra("banco")
    setManualRequester("")
    setManualApprover("")
    setManualPriority("normal")
    setManualLocation("EL Gran Alcazar Sucursal 1 zona 09")
    setManualPedidoSeleccionadoId(null)
    setManualRecepcionCantidad("")
    setManualRecepcionEstado("bueno")
    setManualRecepcionNombre("")
    setManualRecepcionImagen("")
  }

  async function publicarNotificacionOrden(destinatarios, notification) {
    try {
      if (Array.isArray(destinatarios)) {
        await notifyRoles(destinatarios, notification)
      } else {
        await createNotification({ ...notification, userId: destinatarios })
      }
    } catch (error) {
      console.error("No se pudo registrar la notificación de orden de compra.", error)
    }
  }

  async function notificarCreadorOrden(orden, title, message, type) {
    if (orden.creadoPorId) {
      await publicarNotificacionOrden(orden.creadoPorId, {
        type,
        title,
        message,
        entityType: "purchase_order",
        entityId: orden.id
      })
    } else if (orden.creadoPorRol === "gerente" || orden.creadoPorRol === "encargado_almacen") {
      await publicarNotificacionOrden([orden.creadoPorRol], {
        type,
        title,
        message,
        entityType: "purchase_order",
        entityId: orden.id
      })
    }
  }

  async function crearOrdenCompraManual() {
    if (!puedeCrearOrdenCompra) {
      alert("No tienes permiso para crear órdenes de compra.")
      return
    }
    if (manualOrdenItems.length === 0) {
      alert("Agrega al menos un ingrediente a la orden de compra manual.")
      return
    }

    if (!manualIssueDate || !manualExpectedDate) {
      alert("Selecciona la fecha de emisión y la fecha esperada de entrega.")
      return
    }

    if (!manualProveedorNombre.trim()) {
      alert("Ingresa el nombre del proveedor.")
      return
    }

    if (!manualRequester.trim() || !manualApprover.trim()) {
      alert("Ingresa quién solicita y quién aprueba la orden.")
      return
    }

    const estadoInicial = requiereAprobacionOrdenCompra ? "pendiente_aprobacion" : manualStatus
    const nuevaOrden = {
      id: Date.now(),
      numeroOrden: generarNumeroOrdenManual(ordenesCompraManual.length),
      fechaEmision: manualIssueDate,
      fechaEsperadaEntrega: manualExpectedDate,
      status: estadoInicial,
      creadoPorId: authenticatedUser?.id || null,
      creadoPorRol: purchaseOrderRole,
      proveedorId: manualProveedorId,
      proveedor: {
        nombre: manualProveedorNombre,
        contacto: manualProveedorContacto,
        correo: manualProveedorCorreo,
        whatsapp: manualProveedorWhatsApp,
        encargado: manualProveedorEncargado
      },
      metodoCompra: manualMetodoCompra,
      requester: manualRequester,
      approver: manualApprover,
      prioridad: manualPriority,
      lugar: manualLocation,
      items: manualOrdenItems,
      creado: new Date().toLocaleString(),
      recepcion: null,
      is_test: manualCreateTestMode
    }

    const saveResult = await savePurchaseOrder(nuevaOrden)
    if (saveResult.error) {
      alert("No se pudo guardar la orden en Supabase. Verifica que la migración de órdenes y notificaciones esté aplicada.")
      return
    }
    setOrdenesCompraManual([nuevaOrden, ...ordenesCompraManual])
    limpiarFormularioOrdenManual()
    setManualCreateTestMode(false)
    setPurchaseOrderView("history")
    if (estadoInicial === "pendiente_aprobacion") {
      await publicarNotificacionOrden(["admin", "gerente_general"], {
        type: "purchase_order_pending",
        title: "Nueva orden pendiente de aprobación",
        message: `${nuevaOrden.numeroOrden} fue creada por ${authenticatedUser?.name || manualRequester} y requiere aprobación.`,
        entityType: "purchase_order",
        entityId: nuevaOrden.id
      })
    }
    if (estadoInicial === "aprobada") {
      await publicarNotificacionOrden(["encargado_almacen"], {
        type: "purchase_order_approved",
        title: "Orden aprobada",
        message: `${nuevaOrden.numeroOrden} fue creada aprobada y puede continuar a recepción de almacén.`,
        entityType: "purchase_order",
        entityId: nuevaOrden.id
      })
    }
    if (purchaseOrderRole === "gerente") {
      await notificarCreadorOrden(
        nuevaOrden,
        "Orden creada correctamente",
        `${nuevaOrden.numeroOrden} fue registrada con estado ${getPurchaseOrderStatusLabel(estadoInicial)}.`,
        "purchase_order_created"
      )
    }
    alert(manualCreateTestMode ? "Orden de prueba creada." : "Orden de compra manual creada.")
  }

  function seleccionarOrdenManual(id) {
    setManualPedidoSeleccionadoId(id)
    setManualRecepcionCantidad("")
    setManualRecepcionEstado("bueno")
    setManualRecepcionNombre("")
    setManualRecepcionImagen("")
  }

  async function cancelarOrdenManual(id) {
    const orden = ordenesCompraManual.find((item) => item.id === id)
    if (!orden || !window.confirm(`¿Cancelar la orden ${orden.numeroOrden}?`)) return
    const ordenCancelada = { ...orden, status: "cancelada" }
    const saveResult = await savePurchaseOrder(ordenCancelada)
    if (saveResult.error) {
      alert("No se pudo cancelar la orden en Supabase.")
      return
    }
    setOrdenesCompraManual((actuales) => actuales.map((item) => (
      item.id === id ? ordenCancelada : item
    )))
    if (manualPedidoSeleccionadoId === id) setManualPedidoSeleccionadoId(null)
    await publicarNotificacionOrden(["admin", "gerente_general"], {
      type: "purchase_order_cancelled",
      title: "Orden cancelada",
      message: `La orden ${orden.numeroOrden} fue cancelada.`,
      entityType: "purchase_order",
      entityId: orden.id
    })
    if (orden.creadoPorRol === "gerente") {
      await notificarCreadorOrden(orden, "Orden cancelada", `${orden.numeroOrden} fue cancelada.`, "purchase_order_cancelled")
    }
  }

  async function aprobarOrdenManual(id) {
    const orden = ordenesCompraManual.find((item) => String(item.id) === String(id))
    if (!orden || !puedeAprobarOrdenCompra) {
      alert("Solo Admin o Gerente General pueden aprobar órdenes.")
      return
    }
    if (!["pendiente", "pendiente_aprobacion", "borrador"].includes(orden.status)) return
    const ordenAprobada = { ...orden, status: "aprobada", aprobadoPor: authenticatedUser?.name || "Administración", aprobadoEn: new Date().toLocaleString() }
    const saveResult = await savePurchaseOrder(ordenAprobada)
    if (saveResult.error) {
      alert("No se pudo aprobar la orden en Supabase.")
      return
    }
    setOrdenesCompraManual((actuales) => actuales.map((item) => (
      String(item.id) === String(id)
        ? ordenAprobada
        : item
    )))
    await publicarNotificacionOrden(["encargado_almacen"], {
      type: "purchase_order_approved",
      title: "Orden aprobada",
      message: `${orden.numeroOrden} fue aprobada y puede continuar a recepción de almacén.`,
      entityType: "purchase_order",
      entityId: orden.id
    })
    await notificarCreadorOrden(orden, "Orden aprobada", `${orden.numeroOrden} fue aprobada y está lista para enviarse al proveedor.`, "purchase_order_approved")
  }

  async function rechazarOrdenManual(id) {
    const orden = ordenesCompraManual.find((item) => String(item.id) === String(id))
    if (!orden || !puedeAprobarOrdenCompra) {
      alert("Solo Admin o Gerente General pueden rechazar órdenes.")
      return
    }
    if (!["pendiente", "pendiente_aprobacion", "borrador"].includes(orden.status)) return
    const ordenRechazada = { ...orden, status: "rechazada", rechazadoPor: authenticatedUser?.name || "Administración", rechazadoEn: new Date().toLocaleString() }
    const saveResult = await savePurchaseOrder(ordenRechazada)
    if (saveResult.error) {
      alert("No se pudo rechazar la orden en Supabase.")
      return
    }
    setOrdenesCompraManual((actuales) => actuales.map((item) => (
      String(item.id) === String(id)
        ? ordenRechazada
        : item
    )))
    await notificarCreadorOrden(orden, "Orden rechazada", `${orden.numeroOrden} fue rechazada por administración.`, "purchase_order_rejected")
  }

  async function enviarOrdenProveedor(id) {
    const orden = ordenesCompraManual.find((item) => String(item.id) === String(id))
    if (!orden || orden.status !== "aprobada") return
    const ordenEnviada = { ...orden, status: "enviada_proveedor" }
    const saveResult = await savePurchaseOrder(ordenEnviada)
    if (saveResult.error) {
      alert("No se pudo registrar el envío al proveedor.")
      return
    }
    setOrdenesCompraManual((actuales) => actuales.map((item) => (
      String(item.id) === String(id) ? ordenEnviada : item
    )))
    await publicarNotificacionOrden(["encargado_almacen"], {
      type: "purchase_order_ready_to_receive",
      title: "Orden lista para recibir",
      message: `${orden.numeroOrden} fue enviada al proveedor y está lista para recepción.`,
      entityType: "purchase_order",
      entityId: orden.id
    })
    await notificarCreadorOrden(orden, "Orden lista para recibir", `${orden.numeroOrden} fue enviada al proveedor y puede recibirse en almacén.`, "purchase_order_ready_to_receive")
  }

  function cargarImagenRecepcion(event) {
    const archivo = event.target.files[0]
    if (!archivo) return

    if (!archivo.type.startsWith("image/")) {
      alert("Debes subir un archivo de imagen.")
      return
    }

    const lector = new FileReader()
    lector.onload = (e) => {
      setManualRecepcionImagen(e.target.result)
    }
    lector.readAsDataURL(archivo)
  }

  async function recibirOrdenManual() {
    if (!ordenManualSeleccionada) {
      alert("Selecciona una orden para recibir.")
      return
    }

    const cantidadReal = Number(manualRecepcionCantidad)
    if (!cantidadReal || cantidadReal <= 0) {
      alert("Ingresa la cantidad recibida real.")
      return
    }

    if (!manualRecepcionNombre.trim()) {
      alert("Ingresa el nombre de quien recibe la orden.")
      return
    }

    const ordenActualizada = ordenesCompraManual.map((orden) => {
      if (orden.id !== ordenManualSeleccionada.id) return orden

      const nuevoStatus = manualRecepcionEstado === "bueno"
        ? "recibida_completa"
        : "recibida_parcial"

      return {
        ...orden,
        status: nuevoStatus,
        recepcion: {
          cantidadRecibidaReal: cantidadReal,
          estadoProducto: manualRecepcionEstado,
          recibidoPor: manualRecepcionNombre,
          imagenRecepcion: manualRecepcionImagen,
          fechaRecepcion: new Date().toLocaleString()
        }
      }
    })

    const ordenRecibida = ordenActualizada.find((orden) => orden.id === ordenManualSeleccionada.id)
    const saveResult = await savePurchaseOrder(ordenRecibida)
    if (saveResult.error) {
      alert("No se pudo registrar la recepción en Supabase.")
      return
    }
    setOrdenesCompraManual(ordenActualizada)
    const recepcionCompleta = manualRecepcionEstado === "bueno"
    await publicarNotificacionOrden(["admin", "gerente_general"], {
      type: recepcionCompleta ? "purchase_order_received" : "purchase_order_partially_received",
      title: recepcionCompleta ? "Orden recibida completamente" : "Orden recibida parcialmente",
      message: `${ordenManualSeleccionada.numeroOrden} fue registrada como ${recepcionCompleta ? "recibida completa" : "recibida parcial"}.`,
      entityType: "purchase_order",
      entityId: ordenManualSeleccionada.id
    })
    if (ordenManualSeleccionada.creadoPorRol === "gerente") {
      await notificarCreadorOrden(
        ordenManualSeleccionada,
        recepcionCompleta ? "Orden recibida completamente" : "Orden recibida parcialmente",
        `${ordenManualSeleccionada.numeroOrden} cambió a ${recepcionCompleta ? "recibida completa" : "recibida parcial"}.`,
        recepcionCompleta ? "purchase_order_received" : "purchase_order_partially_received"
      )
    }

    if (manualRecepcionEstado === "bueno" && !ordenManualSeleccionada.is_test) {
      const inventarioActualizado = ingredientes.map((ingrediente) => {
        const itemOrden = ordenManualSeleccionada.items.find((item) => item.id === ingrediente.id)
        if (!itemOrden) return ingrediente

        const normalizedItem = normalizeInventoryItem(ingrediente)
        const stockAlmacen = getLocationStock(normalizedItem, "almacen")
        const cantidad = Number(itemOrden.cantidadComprar || 0)
        const stockByLocation = {
          ...normalizedItem.stockByLocation,
          almacen: stockAlmacen + cantidad
        }
        const total = Object.values(stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)

        return {
          ...normalizedItem,
          stockByLocation,
          stockActual: total,
          totalUnidades: total,
          ultimaEdicion: new Date().toLocaleString()
        }
      })

      setIngredientes(inventarioActualizado)

      if (ordenManualSeleccionada?.proveedorId) {
        const proveedorIndex = proveedores.findIndex((p) => p.id === ordenManualSeleccionada.proveedorId)
        if (proveedorIndex !== -1) {
          const proveedorActualizado = { ...proveedores[proveedorIndex] }
          const totalOrden = ordenManualSeleccionada.items.reduce(
            (sum, item) => sum + Number(item.costoUnitario || 0) * Number(item.cantidadComprar || 0),
            0
          )
          const nuevaCompra = {
            id: Date.now(),
            fecha: new Date().toLocaleString(),
            numeroOrden: ordenManualSeleccionada.numeroOrden,
            total: totalOrden,
            estado: "recibida",
            items: ordenManualSeleccionada.items
          }
          proveedorActualizado.historialCompras = [
            nuevaCompra,
            ...(proveedorActualizado.historialCompras || [])
          ]

          const nuevosProveedores = proveedores.map((p) =>
            p.id === proveedorActualizado.id ? proveedorActualizado : p
          )
          setProveedores(nuevosProveedores)
          const supplierUpdate = await updateSupplier(proveedorActualizado.id, proveedorActualizado)
          if (supplierUpdate.error) {
            alert("La orden se recibió, pero no se pudo actualizar el historial del proveedor.")
          }
        }
      }

      alert("Orden recibida y cantidades sumadas al inventario.")
    } else if (manualRecepcionEstado === "bueno" && ordenManualSeleccionada.is_test) {
      alert("Recepción de prueba registrada. No se modificó el inventario real.")
    } else {
      alert("Orden registrada como parcialmente completada. No se actualizaron cantidades a inventario porque el producto no está en buen estado.")
    }

    setManualRecepcionCantidad("")
    setManualRecepcionEstado("bueno")
    setManualRecepcionNombre("")
    setManualRecepcionImagen("")
  }

  function descargarOrdenPDF() {
    if (ordenCompra.length === 0) {
      alert("Primero genera una orden de compra.")
      return
    }

    const doc = new jsPDF()
    const fecha = new Date().toLocaleString()
    const total = ordenCompra.reduce((suma, item) => suma + item.costoEstimado, 0)

    doc.setFontSize(18)
    doc.text("Orden de Compra", 14, 18)

    doc.setFontSize(12)
    doc.text(BRANDING.appName, 14, 28)
    doc.text(`Fecha: ${fecha}`, 14, 36)
    doc.text("Generada automáticamente por punto de orden.", 14, 44)

    autoTable(doc, {
      startY: 52,
      head: [[
        "Código",
        "Ingrediente",
        "Categoría",
        "Stock",
        "Máximo",
        "Comprar",
        "Unidad",
        "Costo Est."
      ]],
      body: ordenCompra.map((item) => [
        item.codigo,
        item.nombre,
        item.categoria,
        item.stockActual,
        item.puntoMaximo,
        item.cantidadAComprar,
        item.unidadCompra,
        `Q${item.costoEstimado.toFixed(2)}`
      ])
    })

    const finalY = doc.lastAutoTable.finalY || 60

    doc.setFontSize(14)
    doc.text(`Total estimado: Q${total.toFixed(2)}`, 14, finalY + 12)

    doc.setFontSize(10)
    doc.text("Observaciones:", 14, finalY + 24)
    doc.text("____________________________________________________", 14, finalY + 32)
    doc.text("Autorizado por: _________________________________", 14, finalY + 48)

    doc.save(`orden-compra-${Date.now()}.pdf`)
  }

  const totalOrdenCompra = ordenCompra.reduce(
    (total, item) => total + Number(item.costoEstimado || 0),
    0
  )



  if (!usuarioActual) {
    const loginContainer = { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh" }
    const loginCard = { background: "#0f172a", padding: "24px", borderRadius: "8px", width: "420px", boxShadow: "0 6px 18px rgba(0,0,0,0.3)" }
    const inputStyleLogin = { width: "100%", padding: "8px 10px", marginBottom: "10px", borderRadius: "6px", border: "1px solid #334155", background: "#071023", color: "#e6eef8" }
    const btnLogin = { width: "100%", padding: "10px 12px", borderRadius: "6px", background: "#0ea5a4", color: "#021" }

    return (
      <div style={loginContainer}>
        <div style={loginCard}>
          <h2 style={{ marginTop: 0 }}>Iniciar sesión</h2>
          <input placeholder="Usuario" style={inputStyleLogin} value={usuarioLogin} onChange={(e) => setUsuarioLogin(e.target.value)} />
          <input placeholder="Contraseña" type="password" style={inputStyleLogin} value={contrasenaLogin} onChange={(e) => setContrasenaLogin(e.target.value)} />
          <button style={btnLogin} onClick={iniciarSesion}>Iniciar sesión</button>
          <p style={{ color: "#9ca3af", marginTop: "10px" }}>Usa las credenciales del administrador inicial si aún no hay usuarios.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={pageStyle}>

      {!hideLegacyNavigation && (
        <Sidebar
          seccionActiva={seccionActiva}
          setSeccionActiva={setSeccionActiva}
          modulosPermitidos={modulosPermitidos}
          mostrarNotificaciones={mostrarNotificaciones}
          toggleNotificaciones={toggleNotificaciones}
          nuevasNotificacionesCount={nuevasNotificacionesCount}
          notificaciones={notificaciones}
          styles={{
            headerStyle,
            tabBarStyle,
            sectionButtonStyle,
            activeTabButtonStyle,
            notificationBellWrapperStyle,
            notificationBellButtonStyle,
            notificationBadgeStyle,
            notificationPanelStyle,
            notificationPanelHeaderStyle,
            notificationItemStyle,
            cancelButtonStyle
          }}
        />
      )}
      {seccionActiva === "dashboard" && (
        <Dashboard
          usuarioActual={usuarioActual}
          modulosPermitidos={modulosPermitidos}
          seccionActiva={seccionActiva}
          setSeccionActiva={setSeccionActiva}
          cerrarSesion={cerrarSesion}
          sectionButtonStyle={sectionButtonStyle}
        />
      )}


      {seccionActiva === "reportesAsistencia" && puedeVerReportesRRHH && (
        <AttendanceReportsModule
          asistenciaBusqueda={asistenciaBusqueda}
          setAsistenciaBusqueda={setAsistenciaBusqueda}
          asistenciaFechaFiltro={asistenciaFechaFiltro}
          setAsistenciaFechaFiltro={setAsistenciaFechaFiltro}
          asistenciaReporteColaboradorId={asistenciaReporteColaboradorId}
          setAsistenciaReporteColaboradorId={setAsistenciaReporteColaboradorId}
          asistenciaPerfiles={asistenciaPerfiles}
          asistenciaMovimientos={asistenciaMovimientos}
          asistenciaLlegadasTarde={asistenciaLlegadasTarde}
          asistenciaGraceMinutes={asistenciaGraceMinutes}
          asistenciaCargando={asistenciaCargando}
          asistenciaDetalleMarcaje={asistenciaDetalleMarcaje}
          setAsistenciaDetalleMarcaje={setAsistenciaDetalleMarcaje}
          asistenciaFotoAmpliada={asistenciaFotoAmpliada}
          setAsistenciaFotoAmpliada={setAsistenciaFotoAmpliada}
        />
      )}



        <>
          {seccionActiva === "ordenes" && (
            <PurchaseOrdersModule
              purchaseOrderView={purchaseOrderView}
              setPurchaseOrderView={setPurchaseOrderView}
              puedeCrearOrdenCompra={puedeCrearOrdenCompra}
              puedeAprobarOrdenCompra={puedeAprobarOrdenCompra}
              puedeRecibirOrdenCompra={puedeRecibirOrdenCompra}
              requiereAprobacionOrdenCompra={requiereAprobacionOrdenCompra}
              ordenCompra={ordenCompra}
              totalOrdenCompra={totalOrdenCompra}
              ordenesCompraManual={ordenesCompraManual}
              ordenManualSeleccionada={ordenManualSeleccionada}
              proximoNumeroOrden={generarNumeroOrdenManual(ordenesCompraManual.length)}
              manualBusqueda={manualBusqueda}
              setManualBusqueda={setManualBusqueda}
              manualIngredienteSeleccionadoId={manualIngredienteSeleccionadoId}
              setManualIngredienteSeleccionadoId={setManualIngredienteSeleccionadoId}
              manualCantidadComprar={manualCantidadComprar}
              setManualCantidadComprar={setManualCantidadComprar}
              manualOrdenItems={manualOrdenItems}
              setManualOrdenItems={setManualOrdenItems}
              manualInventoryLoading={manualInventoryLoading}
              manualInventoryError={manualInventoryError}
              manualInventorySource={manualInventorySource}
              manualIssueDate={manualIssueDate}
              setManualIssueDate={setManualIssueDate}
              manualExpectedDate={manualExpectedDate}
              setManualExpectedDate={setManualExpectedDate}
              manualStatus={manualStatus}
              setManualStatus={setManualStatus}
              manualProveedorNombre={manualProveedorNombre}
              setManualProveedorNombre={setManualProveedorNombre}
              manualProveedorContacto={manualProveedorContacto}
              setManualProveedorContacto={setManualProveedorContacto}
              manualProveedorCorreo={manualProveedorCorreo}
              setManualProveedorCorreo={setManualProveedorCorreo}
              manualProveedorWhatsApp={manualProveedorWhatsApp}
              setManualProveedorWhatsApp={setManualProveedorWhatsApp}
              manualProveedorEncargado={manualProveedorEncargado}
              setManualProveedorEncargado={setManualProveedorEncargado}
              manualMetodoCompra={manualMetodoCompra}
              setManualMetodoCompra={setManualMetodoCompra}
              manualRequester={manualRequester}
              setManualRequester={setManualRequester}
              manualApprover={manualApprover}
              setManualApprover={setManualApprover}
              manualPriority={manualPriority}
              setManualPriority={setManualPriority}
              manualLocation={manualLocation}
              manualRecepcionCantidad={manualRecepcionCantidad}
              setManualRecepcionCantidad={setManualRecepcionCantidad}
              manualRecepcionEstado={manualRecepcionEstado}
              setManualRecepcionEstado={setManualRecepcionEstado}
              manualRecepcionNombre={manualRecepcionNombre}
              setManualRecepcionNombre={setManualRecepcionNombre}
              manualRecepcionImagen={manualRecepcionImagen}
              generarOrdenCompra={generarOrdenCompra}
              limpiarOrdenCompra={limpiarOrdenCompra}
              descargarOrdenPDF={descargarOrdenPDF}
              seleccionarIngredienteOrdenManual={seleccionarIngredienteOrdenManual}
              agregarIngredienteOrdenManual={agregarIngredienteOrdenManual}
              limpiarFormularioOrdenManual={limpiarFormularioOrdenManual}
              crearOrdenCompraManual={crearOrdenCompraManual}
              seleccionarOrdenManual={seleccionarOrdenManual}
              cancelarOrdenManual={cancelarOrdenManual}
              aprobarOrdenManual={aprobarOrdenManual}
              rechazarOrdenManual={rechazarOrdenManual}
              enviarOrdenProveedor={enviarOrdenProveedor}
              recibirOrdenManual={recibirOrdenManual}
              cargarImagenRecepcion={cargarImagenRecepcion}
              puedeCrearPruebaFlujo={puedeCrearPruebaFlujo}
              testFlowFilter={testFlowFilter}
              setTestFlowFilter={setTestFlowFilter}
              manualCreateTestMode={manualCreateTestMode}
              setManualCreateTestMode={setManualCreateTestMode}
            />
          )}

          {seccionActiva === "asistencia" && (
            <div style={cardStyle}>
              {/*
                Registro legacy desactivado (Fase 1 consolidación).
                Flujo oficial: /hr?section=asistencia y /kiosk → AttendanceTerminal.jsx
              */}
              <h2>Marcaje de asistencia</h2>
              <p style={{ marginBottom: "18px", color: "#cbd5e1" }}>
                El flujo oficial de marcaje ahora usa la terminal de asistencia.
              </p>
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                <button type="button" onClick={() => navigate("/hr?section=asistencia")} style={buttonStyle}>
                  Abrir terminal de marcaje
                </button>
                <button type="button" onClick={() => navigate("/kiosk")} style={editButtonStyle}>
                  Abrir modo kiosco
                </button>
              </div>
            </div>
          )}

          {seccionActiva === "puntoVenta" && (
            <div style={cardStyle}>
              <h2>Punto de Venta</h2>
              <p style={{ marginBottom: "18px", color: "#cbd5e1" }}>
                Editor de plano del restaurante y gestión de mesas.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", marginTop: "16px" }}>
                <button
                  type="button"
                  onClick={() => alert("Modo Operación activado")}
                  style={{ ...buttonStyle, backgroundColor: "#2563eb" }}
                >
                  Modo Operación
                </button>
                {(usuarioActual && ["Administrador", "Gerente General"].includes(usuarioActual.rol)) ? (
                  <button
                    type="button"
                    onClick={() => alert("Modo Edición de Plano activado")}
                    style={{ ...buttonStyle, backgroundColor: "#f59e0b" }}
                  >
                    Modo Edición de Plano
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    style={{ ...buttonStyle, backgroundColor: "#4b5563", cursor: "not-allowed" }}
                  >
                    Modo Edición de Plano
                  </button>
                )}
              </div>
            </div>
          )}

          {seccionActiva === "proveedores" && (
            <SuppliersModule
              ingredientes={ingredientes}
              proveedores={proveedores}
              proveedoresLoading={proveedoresLoading}
              proveedoresError={proveedoresError}
              proveedoresMigracion={proveedoresMigracion}
              onReloadProveedores={cargarProveedoresSupabase}
              onNotify={agregarNotificacion}
            />
          )}


          {seccionActiva === "inventarioAreas" && (
            <div style={cardStyle}>
              <h2>Inventario por Áreas</h2>
              <p style={{ color: "#cbd5e1", marginBottom: "18px" }}>Existencias disponibles y alertas operativas por ubicación.</p>
              <div style={areaDashboardGridStyle}>
                {areas.filter((area) => area.active !== false).map((area) => {
                  const withStock = ingredientes.filter((item) => getLocationStock(item, area.id) > 0)
                  const lowStock = withStock.filter((item) => getLocationMinimum(item, area.id) > 0 && getLocationStock(item, area.id) <= getLocationMinimum(item, area.id))
                  const outOfStock = ingredientes.filter((item) => getLocationStock(item, area.id) <= 0)
                  const lastReceipt = inventoryMovements.find((movement) => movement.toLocation === area.id)
                  return (
                    <div key={area.id} style={areaDashboardCardStyle}>
                      <div style={areaDashboardHeaderStyle}>
                        <h3 style={{ margin: 0 }}>{area.name}</h3>
                        <span style={area.active ? areaActiveBadgeStyle : areaInactiveBadgeStyle}>{area.active ? "Activa" : "Inactiva"}</span>
                      </div>
                      <p><strong>Productos disponibles:</strong> {withStock.length}</p>
                      <p><strong>Productos bajos:</strong> {lowStock.length}</p>
                      <p><strong>Productos agotados:</strong> {outOfStock.length}</p>
                      <p><strong>Última requisición recibida:</strong> {lastReceipt ? new Date(lastReceipt.date).toLocaleString() : "Sin recepción"}</p>
                      <div style={buttonRowStyle}>
                        <button type="button" onClick={() => window.location.assign(`/inventory?section=inventario&area=${encodeURIComponent(area.id)}`)} style={editButtonStyle}>Ver inventario</button>
                        {area.canRequestInventory && area.id !== "almacen" && <button type="button" onClick={() => crearRequisicionParaArea(area.id)} style={buttonStyle}>Crear requisición</button>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {seccionActiva === "areas" && puedeAdministrarAreas && (
            <AreasModule
              areas={areas}
              areaForm={areaForm}
              setAreaForm={setAreaForm}
              areasError={areasError}
              areasLoading={areasLoading}
              areaProfiles={areaProfiles}
              editingAreaId={editingAreaId}
              onGuardarArea={guardarArea}
              onEditarArea={editarArea}
              onDesactivarArea={desactivarArea}
              onReloadAreas={cargarAreasSupabase}
              onCancelEdit={() => {
                setEditingAreaId("")
                setAreaForm({
                  id: "",
                  name: "",
                  type: "operativa",
                  description: "",
                  responsibleUserId: "",
                  canRequestInventory: true,
                  isProductionArea: false,
                  active: true
                })
              }}
            />
          )}

          {seccionActiva === "movimientosInventario" && (
            <div style={cardStyle}>
              <h2>Movimientos de inventario</h2>
              {inventoryMovements.length === 0 ? <p>No hay movimientos registrados todavía.</p> : inventoryMovements.map((movement) => (
                <div key={movement.id} style={orderItemStyle}>
                  <p><strong>{movement.itemName}</strong> · {movement.quantity} {movement.unit}</p>
                  <p>{getAreaLabel(movement.fromLocation)} → {movement.toLocation ? getAreaLabel(movement.toLocation) : "Consumo"}</p>
                  <p>Antes: {movement.previousStockFrom} / {movement.previousStockTo} · Después: {movement.newStockFrom} / {movement.newStockTo}</p>
                  <p>{new Date(movement.date).toLocaleString()} · {movement.performedBy}</p>
                </div>
              ))}
            </div>
          )}

        </>
    </div>
  )
}

const pageStyle = {
  backgroundColor: "#111827",
  minHeight: "100vh",
  width: "100%",
  boxSizing: "border-box",
  color: "white",
  padding: "32px",
  fontFamily: "Arial"
}

const cardStyle = {
  backgroundColor: "#1f2937",
  padding: "20px",
  borderRadius: "10px",
  marginTop: "20px",
  width: "100%",
  boxSizing: "border-box"
}





const fieldLabelStyle = {
  marginBottom: "6px",
  display: "block",
  color: "#cbd5e1",
  fontSize: "14px"
}

const buttonStyle = {
  color: "white",
  padding: "12px 20px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  marginRight: "10px"
}

const disabledButtonStyle = {
  ...buttonStyle,
  backgroundColor: "#4b5563",
  color: "#9ca3af",
  cursor: "not-allowed",
  opacity: 0.75
}

const purchaseButtonStyle = {
  backgroundColor: "#16a34a",
  color: "white",
  padding: "12px 20px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  marginRight: "10px"
}

const pdfButtonStyle = {
  backgroundColor: "#9333ea",
  color: "white",
  padding: "12px 20px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  marginRight: "10px"
}

const cancelButtonStyle = {
  backgroundColor: "#6b7280",
  color: "white",
  padding: "12px 20px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer"
}

const editButtonStyle = {
  backgroundColor: "#f59e0b",
  color: "white",
  padding: "8px 12px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer"
}

const tabBarStyle = {
  display: "flex",
  gap: "12px",
  marginTop: "20px"
}

const sectionButtonStyle = {
  backgroundColor: "#374151",
  color: "white",
  padding: "10px 18px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer"
}

const activeTabButtonStyle = {
  ...sectionButtonStyle,
  backgroundColor: "#2563eb"
}



const deleteButtonStyle = {
  backgroundColor: "#dc2626",
  color: "white",
  padding: "8px 12px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer"
}


const orderItemStyle = {
  backgroundColor: "#1f2937",
  padding: "12px",
  borderRadius: "8px",
  marginBottom: "10px",
  border: "1px solid #374151"
}


const areaDashboardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: "12px",
  marginTop: "16px"
}

const areaDashboardCardStyle = {
  display: "grid",
  gap: "8px",
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const areaDashboardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px"
}

const areaActiveBadgeStyle = {
  padding: "4px 8px",
  borderRadius: "7px",
  backgroundColor: "#064e3b",
  color: "#d1fae5",
  fontSize: "0.75rem",
  fontWeight: 700
}

const areaInactiveBadgeStyle = {
  ...areaActiveBadgeStyle,
  backgroundColor: "#374151",
  color: "#cbd5e1"
}

const cardHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  marginTop: "12px"
}

const buttonRowStyle = {
  display: "flex",
  gap: "10px",
  marginTop: "10px"
}

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  marginTop: "20px",
  position: "relative"
}

const notificationBellWrapperStyle = {
  position: "relative",
  display: "flex",
  alignItems: "center"
}

const notificationBellButtonStyle = {
  backgroundColor: "#374151",
  color: "white",
  border: "none",
  borderRadius: "999px",
  padding: "10px 14px",
  cursor: "pointer",
  position: "relative"
}

const notificationBadgeStyle = {
  position: "absolute",
  top: "-4px",
  right: "-4px",
  minWidth: "20px",
  height: "20px",
  borderRadius: "999px",
  backgroundColor: "#f87171",
  color: "white",
  fontSize: "12px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 6px"
}

const notificationPanelStyle = {
  position: "absolute",
  top: "50px",
  right: "0",
  width: "340px",
  maxHeight: "420px",
  overflowY: "auto",
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "12px",
  padding: "16px",
  zIndex: 100,
  boxShadow: "0 14px 30px rgba(0, 0, 0, 0.35)"
}

const notificationPanelHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px",
  marginBottom: "12px"
}

const notificationItemStyle = {
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #374151",
  backgroundColor: "#1f2937",
  marginBottom: "10px"
}

const historialContainer = {
  marginTop: "40px",
  backgroundColor: "#111827",
  padding: "20px",
  borderRadius: "12px"
}


export default LegacyInventoryApp
