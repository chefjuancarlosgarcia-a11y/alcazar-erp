import { useState, useEffect, useCallback, useRef } from "react"
import { useNavigate } from "react-router-dom"
import Cropper from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"
import SuppliersModule from "./suppliers/SuppliersModule"
import UsersModule from "./users/UsersModule"
import AttendanceReportsModule from "./attendance/AttendanceReportsModule"
import PurchaseOrdersModule from "./purchase-orders/PurchaseOrdersModule"
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

function createImage(imageSrc) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener("load", () => resolve(image))
    image.addEventListener("error", (error) => reject(error))
    image.src = imageSrc
  })
}

async function getCroppedImg(imageSrc, croppedAreaPixels) {
  const image = await createImage(imageSrc)
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")

  if (!context || !croppedAreaPixels) return imageSrc

  canvas.width = croppedAreaPixels.width
  canvas.height = croppedAreaPixels.height

  context.drawImage(
    image,
    croppedAreaPixels.x,
    croppedAreaPixels.y,
    croppedAreaPixels.width,
    croppedAreaPixels.height,
    0,
    0,
    croppedAreaPixels.width,
    croppedAreaPixels.height
  )

  return canvas.toDataURL("image/jpeg", 0.92)
}

const HR_PERFORMANCE_FIELDS = [
  { key: "punctuality", label: "Puntualidad" },
  { key: "attendance", label: "Asistencia" },
  { key: "productivity", label: "Productividad" },
  { key: "teamwork", label: "Trabajo en equipo" },
  { key: "cleanliness", label: "Limpieza / orden" },
  { key: "checklistCompliance", label: "Cumplimiento de checklists" },
  { key: "training", label: "Capacitación" },
  { key: "discipline", label: "Disciplina" },
  { key: "culture", label: "Actitud / cultura" }
]

const HR_DOCUMENT_TYPES = [
  { key: "dpi", label: "DPI", legacyKeys: ["dpiFrontal", "dpiReverso"], requiresExpiration: false },
  { key: "contract", label: "Contrato", legacyKeys: ["contrato"], requiresExpiration: false },
  { key: "healthCard", label: "Tarjeta de salud", legacyKeys: ["tarjetaSalud"], requiresExpiration: true },
  { key: "foodHandling", label: "Manipulación de alimentos", legacyKeys: ["tarjetaManipulacionAlimentos"], requiresExpiration: true },
  { key: "backgroundCheck", label: "Antecedentes", legacyKeys: ["antecedentes"], requiresExpiration: true },
  { key: "cv", label: "CV", legacyKeys: ["cv"], requiresExpiration: false },
  { key: "certifications", label: "Certificaciones", legacyKeys: ["certificaciones"], requiresExpiration: false }
]

const MOCK_HR_EMPLOYEES = [
  {
    id: "mock-rrhh-1",
    nombre: "Ana Morales",
    username: "ana.morales",
    correo: "ana@alcazar.test",
    telefono: "5551-2211",
    puesto: "Mesero I",
    departamento: "Servicio",
    rol: "Servicio",
    estado: "Activo",
    activo: true,
    fechaInicioLabores: "2025-08-12",
    fechaCumpleanos: "1998-05-26",
    supervisorDirecto: "Supervisor FOH",
    contactoEmergencia: "Luis Morales · 5550-1100",
    schedules: [{ startTime: "08:00", startPeriod: "AM", endTime: "05:00", endPeriod: "PM" }],
    documentosRRHH: {
      dpi: { file: "registrado", issueDate: "2025-08-12" },
      healthCard: { file: "registrado", issueDate: "2026-01-10", expirationDate: "2026-06-05" },
      foodHandling: { file: "registrado", issueDate: "2025-09-01", expirationDate: "2026-09-01" },
      contract: { file: "registrado", issueDate: "2025-08-12" }
    },
    performance: { punctuality: 92, attendance: 96, productivity: 88, teamwork: 94, cleanliness: 90, checklistCompliance: 86, training: 82, discipline: 95, culture: 91 },
    attendanceRecords: [
      { date: "2026-05-03", scheduledStart: "08:00 AM", actualStart: "08:04 AM", scheduledEnd: "05:00 PM", actualEnd: "05:02 PM", status: "present", minutesLate: 4, notes: "" }
    ],
    trainingRecords: [{ id: "tr-1", title: "Servicio al cliente", category: "FOH", date: "2026-05-10", status: "completed", score: 91, instructor: "RRHH", certificateFile: "", notes: "" }],
    recognitionRecords: [{ fecha: "2026-05-15", tipo: "excelente servicio", descripcion: "Mención positiva de cliente frecuente.", registradoPor: "Gerencia" }],
    moodRecords: [{ date: "2026-05-18", mood: "happy", comment: "Buen ambiente" }],
    careerPath: { currentLevel: "Mesero I", nextLevel: "Mesero II", progress: 70, requirements: [{ title: "6 meses de antigüedad", completed: true }, { title: "Evaluación de servicio >= 85", completed: true }, { title: "Puntualidad >= 90%", completed: true }, { title: "Curso de ventas sugeridas", completed: false }] }
  },
  {
    id: "mock-rrhh-2",
    nombre: "Carlos Pérez",
    username: "carlos.perez",
    puesto: "Cocinero I",
    departamento: "Cocina",
    rol: "Cocina",
    estado: "Activo",
    activo: true,
    fechaInicioLabores: "2024-11-02",
    fechaCumpleanos: "1994-10-12",
    supervisorDirecto: "Chef de turno",
    contactoEmergencia: "María Pérez · 5552-4040",
    schedules: [{ startTime: "12:00", startPeriod: "PM", endTime: "09:00", endPeriod: "PM" }],
    documentosRRHH: {
      dpi: { file: "registrado", issueDate: "2024-11-02" },
      healthCard: { file: "registrado", issueDate: "2025-01-12", expirationDate: "2026-04-30" },
      foodHandling: { file: "registrado", issueDate: "2026-01-05", expirationDate: "2027-01-05" }
    },
    performance: { punctuality: 62, attendance: 78, productivity: 76, teamwork: 72, cleanliness: 74, checklistCompliance: 69, training: 65, discipline: 70, culture: 75 },
    attendanceRecords: [
      { date: "2026-05-04", scheduledStart: "12:00 PM", actualStart: "12:18 PM", scheduledEnd: "09:00 PM", actualEnd: "09:02 PM", status: "late", minutesLate: 18, notes: "" },
      { date: "2026-05-11", scheduledStart: "12:00 PM", actualStart: "", scheduledEnd: "09:00 PM", actualEnd: "", status: "absent", minutesLate: 0, notes: "Sin justificación" }
    ],
    trainingRecords: [{ id: "tr-2", title: "Inocuidad alimentaria", category: "BOH", date: "", status: "pending", score: null, instructor: "Chef", certificateFile: "", notes: "Obligatoria" }],
    incidentRecords: [{ fecha: "2026-05-11", tipo: "ausencia", severidad: "media", descripcion: "Ausencia sin aviso previo.", accionTomada: "Seguimiento RRHH", registradoPor: "Supervisor" }],
    moodRecords: [{ date: "2026-05-17", mood: "stressed", comment: "Carga alta en cocina" }],
    careerPath: { currentLevel: "Cocinero I", nextLevel: "Cocinero II", progress: 45, requirements: [{ title: "6 meses de antigüedad", completed: true }, { title: "Curso de inocuidad aprobado", completed: false }, { title: "Evaluación práctica >= 85", completed: false }, { title: "Puntualidad >= 90%", completed: false }] }
  },
  {
    id: "mock-rrhh-3",
    nombre: "Lucía Gómez",
    username: "lucia.gomez",
    puesto: "Barista I",
    departamento: "Cafeteria",
    rol: "Cafeteria",
    estado: "Activo",
    activo: true,
    fechaInicioLabores: "2026-01-20",
    fechaCumpleanos: "2000-07-04",
    documentosRRHH: { dpi: { file: "registrado" }, healthCard: { file: "registrado", expirationDate: "2026-12-18" }, foodHandling: { file: "registrado", expirationDate: "2026-12-18" } },
    performance: { punctuality: 86, attendance: 90, productivity: 84, teamwork: 88, cleanliness: 92, checklistCompliance: 80, training: 78, discipline: 92, culture: 90 },
    trainingRecords: [{ id: "tr-3", title: "Bebidas calientes estándar", category: "Barista", date: "", status: "pending", score: null, instructor: "Supervisor", certificateFile: "", notes: "" }],
    moodRecords: [{ date: "2026-05-19", mood: "neutral", comment: "" }]
  },
  {
    id: "mock-rrhh-4",
    nombre: "Mateo Ruiz",
    username: "mateo.ruiz",
    puesto: "Panadero I",
    departamento: "Panaderia",
    rol: "Panaderia",
    estado: "Suspendido",
    activo: false,
    fechaInicioLabores: "2023-03-09",
    fechaCumpleanos: "1991-01-20",
    documentosRRHH: { dpi: { file: "" }, healthCard: { file: "registrado", expirationDate: "2026-11-12" } },
    performance: { punctuality: 73, attendance: 75, productivity: 82, teamwork: 70, cleanliness: 79, checklistCompliance: 72, training: 80, discipline: 68, culture: 74 },
    incidentRecords: [{ fecha: "2026-05-08", tipo: "uniforme incompleto", severidad: "baja", descripcion: "Falta de uniforme completo.", accionTomada: "Recordatorio", registradoPor: "Supervisor" }],
    moodRecords: [{ date: "2026-05-14", mood: "sad", comment: "Situación personal" }]
  },
  {
    id: "mock-rrhh-5",
    nombre: "Sofía Herrera",
    username: "sofia.herrera",
    puesto: "Caja I",
    departamento: "Servicio",
    rol: "FOH",
    estado: "Inactivo",
    activo: false,
    fechaInicioLabores: "2022-06-01",
    fechaCumpleanos: "1996-12-02",
    documentosRRHH: { contract: { file: "registrado" } },
    performance: { punctuality: 80, attendance: 82, productivity: 79, teamwork: 84, cleanliness: 86, checklistCompliance: 78, training: 76, discipline: 82, culture: 80 },
    trainingRecords: [],
    moodRecords: []
  }
]

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

function toDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function daysBetween(from, to) {
  const start = toDate(from)
  const end = toDate(to)
  if (!start || !end) return null
  return Math.ceil((end - start) / 86400000)
}

function calculateEmployeeScore(employee) {
  const performance = employee?.performance || {}
  const values = HR_PERFORMANCE_FIELDS
    .map((field) => Number(performance[field.key]))
    .filter((value) => Number.isFinite(value) && value > 0)
  if (values.length === 0) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function getScoreLabel(score) {
  if (score === null || score === undefined) return { label: "Sin datos", tone: "muted" }
  if (score >= 90) return { label: "Excelente", tone: "good" }
  if (score >= 80) return { label: "Bueno", tone: "good" }
  if (score >= 70) return { label: "En observación", tone: "warning" }
  return { label: "Riesgo", tone: "danger" }
}

function getDocumentStatus(document) {
  if (!document?.file || (document.requiresExpiration && !document.expirationDate)) return "pendiente"
  if (!document.expirationDate) return "vigente"
  const days = daysBetween(new Date(), document.expirationDate)
  if (days === null) return "pendiente"
  if (days < 0) return "vencido"
  if (days <= 30) return "por vencer"
  return "vigente"
}

function getEmployeeDocuments(employee) {
  const legacy = employee?.documentos || {}
  const structured = employee?.documentosRRHH || employee?.documents || {}
  return HR_DOCUMENT_TYPES.map((type) => {
    const data = structured[type.key] || {}
    const legacyFile = type.legacyKeys.map((key) => legacy[key]).find(Boolean)
    const document = {
      key: type.key,
      nombre: type.label,
      file: data.file || data.archivo || legacyFile || "",
      issueDate: data.issueDate || data.fechaEmision || "",
      expirationDate: data.expirationDate || data.fechaVencimiento || "",
      requiresExpiration: type.requiresExpiration
    }
    return { ...document, status: getDocumentStatus(document) }
  })
}

function getUpcomingBirthdays(employees, days = 30) {
  const today = new Date()
  return employees.filter((employee) => {
    const birth = toDate(employee.fechaCumpleanos || employee.birthDate)
    if (!birth) return false
    const next = new Date(today.getFullYear(), birth.getMonth(), birth.getDate())
    if (next < today) next.setFullYear(today.getFullYear() + 1)
    const diff = daysBetween(today, next)
    return diff !== null && diff <= days
  })
}

function getExpiredDocuments(employees) {
  return employees.flatMap((employee) =>
    getEmployeeDocuments(employee)
      .filter((document) => document.status === "vencido")
      .map((document) => ({ employee, document }))
  )
}

function getDocumentsExpiringSoon(employees, days = 30) {
  return employees.flatMap((employee) =>
    getEmployeeDocuments(employee)
      .filter((document) => document.status === "por vencer" && daysBetween(new Date(), document.expirationDate) <= days)
      .map((document) => ({ employee, document }))
  )
}

function getEmployeeSeniority(startDate) {
  const start = toDate(startDate)
  if (!start) return "Sin información"
  const today = new Date()
  let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth()
  if (today.getDate() < start.getDate()) months -= 1
  if (months < 1) return "Menos de 1 mes"
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} meses`
  return `${years} año${years > 1 ? "s" : ""}${rest ? ` y ${rest} meses` : ""}`
}

function getEmployeeAge(birthDate) {
  const birth = toDate(birthDate)
  if (!birth) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDelta = today.getMonth() - birth.getMonth()
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) age -= 1
  return age
}

function getMonthlyAttendanceStats(employee) {
  const records = employee?.attendanceRecords || []
  const now = new Date()
  const monthly = records.filter((record) => {
    const date = toDate(record.date)
    return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()
  })
  const late = monthly.filter((record) => record.status === "late")
  const absent = monthly.filter((record) => record.status === "absent")
  const presentLike = monthly.filter((record) => ["present", "late"].includes(record.status)).length
  const requiredDays = monthly.filter((record) => !["day_off", "vacation"].includes(record.status)).length
  return {
    tardanzas: late.length,
    ausencias: absent.length,
    minutosTarde: late.reduce((sum, record) => sum + Number(record.minutesLate || 0), 0),
    asistenciaMensual: requiredDays ? Math.round((presentLike / requiredDays) * 100) : null
  }
}

function getTrainingStats(employee) {
  const records = employee?.trainingRecords || []
  const completed = records.filter((item) => item.status === "completed")
  const pending = records.filter((item) => item.status === "pending")
  const scores = completed.map((item) => Number(item.score)).filter((score) => Number.isFinite(score))
  return {
    completed: completed.length,
    pending: pending.length,
    averageScore: scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null,
    criticalPending: pending.filter((item) => /obligatoria|inocuidad|seguridad|salud/i.test(`${item.title} ${item.notes}`)).length
  }
}

function getCareerProgress(employee) {
  const career = employee?.careerPath || {}
  const requirements = career.requirements || []
  const completed = requirements.filter((item) => item.completed).length
  const progress = Number.isFinite(Number(career.progress))
    ? Number(career.progress)
    : requirements.length
      ? Math.round((completed / requirements.length) * 100)
      : 0
  return { ...career, progress, requirements }
}

function getHRAlerts(employees, resolvedIds = []) {
  const resolved = new Set(resolvedIds)
  const alerts = []
  employees.forEach((employee) => {
    getEmployeeDocuments(employee).forEach((document) => {
      if (document.status === "vencido" || document.status === "por vencer" || document.status === "pendiente") {
        const priority = document.status === "vencido" ? "alta" : document.status === "por vencer" ? "media" : "media"
        alerts.push({
          id: `${employee.id}-${document.key}-${document.status}`,
          tipo: document.status === "vencido" ? `${document.nombre} vencido` : document.status === "por vencer" ? `${document.nombre} por vencer` : `${document.nombre} pendiente`,
          colaborador: employee.nombre,
          employeeId: employee.id,
          prioridad: priority,
          fecha: document.expirationDate || "Sin fecha",
          estado: "pendiente"
        })
      }
    })
    const attendance = getMonthlyAttendanceStats(employee)
    if (attendance.tardanzas >= 3) alerts.push({ id: `${employee.id}-tardanzas`, tipo: "Muchas tardanzas", colaborador: employee.nombre, employeeId: employee.id, prioridad: "alta", fecha: new Date().toISOString().slice(0, 10), estado: "pendiente" })
    if (attendance.ausencias >= 1) alerts.push({ id: `${employee.id}-ausencias`, tipo: "Ausencias frecuentes", colaborador: employee.nombre, employeeId: employee.id, prioridad: "media", fecha: new Date().toISOString().slice(0, 10), estado: "pendiente" })
    if (getTrainingStats(employee).pending > 0) alerts.push({ id: `${employee.id}-training`, tipo: "Capacitación pendiente", colaborador: employee.nombre, employeeId: employee.id, prioridad: "media", fecha: new Date().toISOString().slice(0, 10), estado: "pendiente" })
    const score = calculateEmployeeScore(employee)
    if (score !== null && score < 70) alerts.push({ id: `${employee.id}-evaluacion`, tipo: "Evaluación pendiente", colaborador: employee.nombre, employeeId: employee.id, prioridad: "alta", fecha: new Date().toISOString().slice(0, 10), estado: "pendiente" })
  })
  getUpcomingBirthdays(employees).forEach((employee) => {
    alerts.push({ id: `${employee.id}-birthday`, tipo: "Cumpleaños cercano", colaborador: employee.nombre, employeeId: employee.id, prioridad: "baja", fecha: employee.fechaCumpleanos || "Sin fecha", estado: "pendiente" })
  })
  return alerts.map((alert) => ({ ...alert, estado: resolved.has(alert.id) ? "resuelta" : alert.estado }))
}

function getEmployeeTimeline(employee) {
  const events = []
  if (employee?.fechaInicioLabores) events.push({ fecha: employee.fechaInicioLabores, tipo: "Ingreso", titulo: "Ingreso a la empresa", descripcion: employee.puesto || "Inicio de labores", registradoPor: employee.creadoPor || "sistema" })
  ;(employee?.trainingRecords || []).forEach((record) => {
    if (record.status === "completed") events.push({ fecha: record.date || new Date().toISOString().slice(0, 10), tipo: "Capacitación", titulo: record.title, descripcion: `Resultado: ${record.score ?? "Sin nota"}`, registradoPor: record.instructor || "RRHH" })
  })
  ;(employee?.securityEvents || []).forEach((record) => events.push({ fecha: record.date || record.fecha, tipo: record.type || "security", titulo: record.title, descripcion: record.description, registradoPor: record.registeredBy || record.registradoPor || "Sistema" }))
  ;(employee?.incidentRecords || []).forEach((record) => events.push({ fecha: record.fecha, tipo: "Incidente", titulo: record.tipo, descripcion: record.descripcion, registradoPor: record.registradoPor || "Supervisor" }))
  ;(employee?.recognitionRecords || []).forEach((record) => events.push({ fecha: record.fecha, tipo: "Reconocimiento", titulo: record.tipo, descripcion: record.descripcion, registradoPor: record.registradoPor || "Gerencia" }))
  if (employee?.fechaCumpleanos) events.push({ fecha: employee.fechaCumpleanos, tipo: "Cumpleaños", titulo: "Cumpleaños registrado", descripcion: "Fecha de cumpleaños del colaborador", registradoPor: "RRHH" })
  return events.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))
}

function getMoodStats(employees) {
  const records = employees.flatMap((employee) => employee.moodRecords || [])
  const stressed = employees.filter((employee) => (employee.moodRecords || []).some((record) => record.mood === "stressed" || record.mood === "sad")).length
  const scoreMap = { happy: 100, neutral: 70, stressed: 35, sad: 25 }
  const average = records.length ? Math.round(records.reduce((sum, record) => sum + (scoreMap[record.mood] || 60), 0) / records.length) : null
  return { average, stressed, trend: average === null ? "Sin datos" : average >= 75 ? "Estable" : average >= 50 ? "Atención" : "Riesgo" }
}

function normalizeAccessRole(user) {
  const role = String(user?.role || user?.rol || "").trim().toLowerCase()
  return role
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_")
}

function canManageUsers(currentUser) {
  const role = normalizeAccessRole(currentUser)
  return role === "admin" || role === "administrador" || role === "gerente_general"
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

function formatLastLogin(date) {
  if (!date) return "Sin acceso registrado"
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return String(date)
  return parsed.toLocaleString("es-GT", {
    dateStyle: "medium",
    timeStyle: "short"
  })
}

function generateTemporaryPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$"
  return Array.from({ length: 12 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
}


function LegacyInventoryApp({ initialSeccion = "dashboard", initialPurchaseOrderView = "", initialPurchaseOrderId = "", hideLegacyNavigation = false, focusEmployeeId = "", editFocusedEmployee = false }) {
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
    getPurchaseOrders().then(({ data, error }) => {
      if (!active || error || !data?.length) return
      setOrdenesCompraManual((localOrders) => {
        const remoteIds = new Set(data.map((order) => String(order.id)))
        return [...data, ...localOrders.filter((order) => !remoteIds.has(String(order.id)))]
      })
    })
    return () => {
      active = false
    }
  }, [seccionActiva])

  const usuariosAutorizados = [
    { username: "admin", passwordHash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", nombre: "Administrador" },
    { username: "colaborador", passwordHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", nombre: "Colaborador autorizado" }
  ]

  const [users, setUsers] = useState([])

  const [userSearch, setUserSearch] = useState("")
  const [editUserId, setEditUserId] = useState(null)
  const [mostrarFormularioColaborador, setMostrarFormularioColaborador] = useState(false)
  const [mostrarPerfilColaborador, setMostrarPerfilColaborador] = useState(true)
  const [currentHRView, setCurrentHRView] = useState("dashboard")
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [hrProfileTab, setHrProfileTab] = useState("resumen")
  const [hrFilters, setHrFilters] = useState({ puesto: "", departamento: "", estado: "", especial: "", ordenar: "nombre" })
  const [hrResolvedAlerts, setHrResolvedAlerts] = useState([])
  const [passwordResetUserId, setPasswordResetUserId] = useState(null)
  const [passwordResetMode, setPasswordResetMode] = useState("auto")
  const [passwordResetManual, setPasswordResetManual] = useState("")
  const [passwordResetResult, setPasswordResetResult] = useState("")
  const [accessRequests, setAccessRequests] = useState([])
  const [colaboradorPerfilId, setColaboradorPerfilId] = useState(null)
  const [perfilColaboradorEditando, setPerfilColaboradorEditando] = useState(false)
  const [mensajePerfilColaborador, setMensajePerfilColaborador] = useState("")
  const [erroresColaborador, setErroresColaborador] = useState({})
  const [cropImageSrc, setCropImageSrc] = useState("")
  const [cropTarget, setCropTarget] = useState("form")
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [cropZoom, setCropZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null)
  const [asistenciaBusqueda, setAsistenciaBusqueda] = useState("")
  const [asistenciaFechaFiltro, setAsistenciaFechaFiltro] = useState(() => obtenerFechaLocal())
  const [asistenciaReporteColaboradorId, setAsistenciaReporteColaboradorId] = useState("")
  const [asistenciaRecoveryType, setAsistenciaRecoveryType] = useState("")
  const [asistenciaRecoveryValue, setAsistenciaRecoveryValue] = useState("")
  const [asistenciaRecoveryMessage, setAsistenciaRecoveryMessage] = useState("")
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
  const turnoInicial = { day: "lunes", startHour: "08", startMinute: "00", startPeriod: "AM", endHour: "05", endMinute: "00", endPeriod: "PM", crossesMidnight: false }
  const [turnoTemp, setTurnoTemp] = useState(turnoInicial)
  const [documentoTemp, setDocumentoTemp] = useState({ tipo: "dpiFrontal", archivo: "" })
  const [userForm, setUserForm] = useState({
    nombre: "",
    username: "",
    correo: "",
    telefono: "",
    puesto: "",
    departamento: "Administracion",
    rol: "FOH",
    password: "",
    activo: true,
    observaciones: "",
    fotoColaborador: "",
    fechaInicioLabores: "",
    fechaCumpleanos: "",
    supervisorDirecto: "",
    contactoEmergencia: "",
    turnos: [],
    schedules: [],
    performance: {
      punctuality: 0,
      attendance: 0,
      productivity: 0,
      teamwork: 0,
      cleanliness: 0,
      checklistCompliance: 0,
      training: 0,
      discipline: 0,
      culture: 0
    },
    attendanceRecords: [],
    trainingRecords: [],
    incidentRecords: [],
    recognitionRecords: [],
    moodRecords: [],
    securityEvents: [],
    careerPath: {
      currentLevel: "",
      nextLevel: "",
      progress: 0,
      requirements: []
    },
    diasLaborales: ["lunes", "martes", "miercoles", "jueves", "viernes"],
    diaDescanso: "sabado",
    documentos: {
      dpiFrontal: "",
      dpiReverso: "",
      tarjetaSalud: "",
      tarjetaManipulacionAlimentos: "",
      otros: []
    },
    estado: "Activo"
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

  function generarIdUsuario() {
    return Date.now() + Math.floor(Math.random() * 999)
  }

  const rolesDisponibles = [
    "Administrador",
    "Gerente General",
    "Gerente",
    "Recursos Humanos",
    "Supervisor",
    "Encargado de Almacén",
    "Cocina",
    "Servicio",
    "Barra",
    "Cafeteria",
    "Panaderia",
    "Reposteria",
    "Contabilidad",
    "FOH",
    "BOH"
  ]

  const departamentosDisponibles = [
    "Administracion",
    "Recursos Humanos",
    "Cocina",
    "Pizzeria",
    "Panaderia",
    "Reposteria",
    "Barra",
    "Cafeteria",
    "Servicio",
    "Almacen",
    "Limpieza",
    "Contabilidad"
  ]

  const diasSemanaTurnos = [
    { value: "lunes", label: "Lunes" },
    { value: "martes", label: "Martes" },
    { value: "miercoles", label: "Miércoles" },
    { value: "jueves", label: "Jueves" },
    { value: "viernes", label: "Viernes" },
    { value: "sabado", label: "Sábado" },
    { value: "domingo", label: "Domingo" }
  ]
  const ordenDiasTurnos = diasSemanaTurnos.reduce((mapa, dia, index) => ({ ...mapa, [dia.value]: index }), {})
  const horasTurno = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"))
  const minutosTurno = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"))
  const periodosTurno = ["AM", "PM"]

  function obtenerFechaLocal(fecha = new Date()) {
    const fechaLocal = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000)
    return fechaLocal.toISOString().slice(0, 10)
  }

  function obtenerHoraLocal(fecha = new Date()) {
    return fecha.toLocaleTimeString("es-GT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    })
  }

  function obtenerMinutosDesdeHora(hora) {
    if (!hora) return null
    const [horas, minutos] = String(hora).split(":").map(Number)
    if (Number.isNaN(horas) || Number.isNaN(minutos)) return null
    return horas * 60 + minutos
  }

  function obtenerHora24DesdeTurno(turno, tipo = "start") {
    if (!turno) return ""
    const valorDirecto = tipo === "start" ? turno.entrada : turno.salida
    if (valorDirecto) return valorDirecto

    const time = tipo === "start" ? turno.startTime : turno.endTime
    const period = tipo === "start" ? turno.startPeriod : turno.endPeriod
    if (!time) return ""

    const [horaTexto, minutoTexto = "00"] = String(time).split(":")
    let hora = Number(horaTexto)
    const minuto = String(minutoTexto).padStart(2, "0")
    if (Number.isNaN(hora)) return ""
    if (period === "PM" && hora < 12) hora += 12
    if (period === "AM" && hora === 12) hora = 0
    return `${String(hora).padStart(2, "0")}:${minuto}`
  }

  function formatearTurno(turno) {
    if (!turno) return "Sin horario"
    if (typeof turno === "string") return turno
    if (turno.startTime && turno.endTime) {
      return `${turno.startTime} ${turno.startPeriod || ""} - ${turno.endTime} ${turno.endPeriod || ""}`.replace(/\s+/g, " ").trim()
    }
    if (turno.entrada || turno.salida) return `${turno.entrada || "Sin entrada"} - ${turno.salida || "Sin salida"}`
    return "Horario sin formato"
  }

  function obtenerDiaTurno(turno) {
    const day = turno?.day || turno?.dia || ""
    return diasSemanaTurnos.find((dia) => dia.value === day) || null
  }

  function normalizarSchedule(turno, index = 0) {
    if (typeof turno === "string") return turno
    if (!turno) return turno
    const entrada = turno.startTime || (turno.entrada ? convertirHora24AHora12(turno.entrada).time : "")
    const salida = turno.endTime || (turno.salida ? convertirHora24AHora12(turno.salida).time : "")
    const entradaCompat = turno.startPeriod || (turno.entrada ? convertirHora24AHora12(turno.entrada).period : "")
    const salidaCompat = turno.endPeriod || (turno.salida ? convertirHora24AHora12(turno.salida).period : "")
    const dia = obtenerDiaTurno(turno)
    const idBase = [dia?.value || turno.day || "legacy", entrada, entradaCompat, salida, salidaCompat, index].join("-")
    return {
      id: turno.id || `schedule-${idBase}`,
      day: dia?.value || turno.day || "",
      dayLabel: dia?.label || turno.dayLabel || "",
      startTime: entrada,
      startPeriod: entradaCompat,
      endTime: salida,
      endPeriod: salidaCompat,
      crossesMidnight: Boolean(turno.crossesMidnight || turno.cruzaMedianoche)
    }
  }

  function ordenarSchedules(turnos) {
    return [...(turnos || [])].sort((a, b) => {
      if (typeof a === "string" || typeof b === "string") return typeof a === "string" ? 1 : -1
      const diaA = ordenDiasTurnos[a.day] ?? 99
      const diaB = ordenDiasTurnos[b.day] ?? 99
      if (diaA !== diaB) return diaA - diaB
      return (obtenerMinutosDesdeHora(obtenerHora24DesdeTurno(a, "start")) ?? 0) - (obtenerMinutosDesdeHora(obtenerHora24DesdeTurno(b, "start")) ?? 0)
    })
  }

  function obtenerMinutosTurno12(time, period) {
    if (!time || !period) return null
    const [horaTexto, minutoTexto = "00"] = String(time).split(":")
    let hora = Number(horaTexto)
    const minuto = Number(minutoTexto)
    if (!Number.isFinite(hora) || !Number.isFinite(minuto)) return null
    if (period === "PM" && hora < 12) hora += 12
    if (period === "AM" && hora === 12) hora = 0
    return hora * 60 + minuto
  }

  function calculateShiftDuration(schedule) {
    if (!schedule || typeof schedule === "string") return { ok: false, label: "Inválido", minutes: 0, error: "Horario inválido." }
    const startMinutes = obtenerMinutosTurno12(schedule.startTime, schedule.startPeriod)
    let endMinutes = obtenerMinutosTurno12(schedule.endTime, schedule.endPeriod)
    if (startMinutes === null || endMinutes === null) return { ok: false, label: "Inválido", minutes: 0, error: "Ingresa entrada y salida del turno." }
    if (startMinutes === endMinutes) return { ok: false, label: "Inválido", minutes: 0, error: "La entrada y salida no pueden ser iguales." }
    if (endMinutes < startMinutes && schedule.crossesMidnight) endMinutes += 24 * 60
    if (endMinutes < startMinutes) return { ok: false, label: "Inválido", minutes: 0, error: "La salida debe ser mayor que la entrada o marca turno cruza medianoche." }
    const minutes = endMinutes - startMinutes
    const hours = minutes / 60
    return { ok: true, minutes, label: `${Number.isInteger(hours) ? hours : Number(hours.toFixed(1))} h` }
  }

  function obtenerTurnosColaborador(colaborador) {
    if (!colaborador) return []
    if (Array.isArray(colaborador.schedules) && colaborador.schedules.length > 0) return colaborador.schedules
    if (Array.isArray(colaborador.turnos) && colaborador.turnos.length > 0) return colaborador.turnos
    if (colaborador.horario) return [colaborador.horario]
    if (colaborador.horarios) return Array.isArray(colaborador.horarios) ? colaborador.horarios : [colaborador.horarios]
    return []
  }

  function construirScheduleDesdeTemp() {
    const dia = diasSemanaTurnos.find((item) => item.value === turnoTemp.day)
    return {
      id: `schedule-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      day: dia?.value || "",
      dayLabel: dia?.label || "",
      startTime: `${turnoTemp.startHour}:${turnoTemp.startMinute}`,
      startPeriod: turnoTemp.startPeriod,
      endTime: `${turnoTemp.endHour}:${turnoTemp.endMinute}`,
      endPeriod: turnoTemp.endPeriod,
      crossesMidnight: Boolean(turnoTemp.crossesMidnight)
    }
  }

  function convertirHora24AHora12(hora) {
    const [horaTexto, minutoTexto = "00"] = String(hora || "").split(":")
    let horaNumero = Number(horaTexto)
    if (Number.isNaN(horaNumero)) return { time: String(hora || ""), period: "" }
    const period = horaNumero >= 12 ? "PM" : "AM"
    if (horaNumero === 0) horaNumero = 12
    if (horaNumero > 12) horaNumero -= 12
    return { time: `${String(horaNumero).padStart(2, "0")}:${String(minutoTexto).padStart(2, "0")}`, period }
  }

  function convertirSchedulesNuevos(turnos) {
    return ordenarSchedules((turnos || []).map((turno, index) => {
      if (typeof turno === "string") return turno
      if (turno.startTime || turno.endTime) return normalizarSchedule(turno, index)
      const entrada = convertirHora24AHora12(turno.entrada)
      const salida = convertirHora24AHora12(turno.salida)
      return normalizarSchedule({
        ...turno,
        startTime: entrada.time,
        startPeriod: entrada.period,
        endTime: salida.time,
        endPeriod: salida.period
      }, index)
    }))
  }

  function convertirTurnosCompatibles(turnos) {
    return (turnos || []).map((turno) => {
      if (typeof turno === "string") return turno
      if (turno.entrada || turno.salida) return turno
      return {
        entrada: obtenerHora24DesdeTurno(turno, "start"),
        salida: obtenerHora24DesdeTurno(turno, "end")
      }
    })
  }

  function calcularMinutosEntre(inicioISO, finISO) {
    const inicio = new Date(inicioISO).getTime()
    const fin = new Date(finISO).getTime()
    if (Number.isNaN(inicio) || Number.isNaN(fin)) return 0
    return Math.max(0, Math.round((fin - inicio) / 60000))
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

  function validarUnicos(username, correo, excludingId = null) {
    const u = users.find((x) => x.username === username && x.id !== excludingId)
    if (u) return { ok: false, mensaje: "El username ya existe." }
    const correoNormalizado = String(correo || "").trim().toLowerCase()
    if (correoNormalizado) {
      const c = users.find((x) => String(x.correo || "").trim().toLowerCase() === correoNormalizado && x.id !== excludingId)
      if (c) return { ok: false, mensaje: "El correo ya está registrado." }
    }
    return { ok: true }
  }

  function correoTieneFormatoValido(correo) {
    const valor = String(correo || "").trim()
    if (!valor) return true
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valor)
  }

  function actualizarCampoColaborador(campo, valor) {
    setUserForm((s) => ({ ...s, [campo]: valor }))
    setErroresColaborador((actuales) => {
      if (!actuales[campo]) return actuales
      const siguientes = { ...actuales }
      delete siguientes[campo]
      return siguientes
    })
  }

  function cargarFormularioColaborador(usuario) {
    setTurnoTemp(turnoInicial)
    setUserForm({
      nombre: usuario.nombre || "",
      username: usuario.username || "",
      correo: usuario.correo || "",
      telefono: usuario.telefono || "",
      puesto: usuario.puesto || "",
      departamento: usuario.departamento || "Administracion",
      rol: usuario.rol || "FOH",
      password: "",
      activo: usuario.activo ?? true,
      observaciones: usuario.observaciones || "",
      fotoColaborador: usuario.fotoColaborador || "",
      fechaInicioLabores: usuario.fechaInicioLabores || "",
      fechaCumpleanos: usuario.fechaCumpleanos || "",
      supervisorDirecto: usuario.supervisorDirecto || "",
      contactoEmergencia: usuario.contactoEmergencia || "",
      turnos: usuario.turnos || [],
      schedules: Array.isArray(usuario.schedules) ? usuario.schedules : [],
      performance: usuario.performance || {
        punctuality: 0,
        attendance: 0,
        productivity: 0,
        teamwork: 0,
        cleanliness: 0,
        checklistCompliance: 0,
        training: 0,
        discipline: 0,
        culture: 0
      },
      attendanceRecords: usuario.attendanceRecords || [],
      trainingRecords: usuario.trainingRecords || [],
      incidentRecords: usuario.incidentRecords || [],
      recognitionRecords: usuario.recognitionRecords || [],
      moodRecords: usuario.moodRecords || [],
      securityEvents: usuario.securityEvents || [],
      careerPath: usuario.careerPath || {
        currentLevel: usuario.puesto || "",
        nextLevel: "",
        progress: 0,
        requirements: []
      },
      diasLaborales: usuario.diasLaborales || ["lunes", "martes", "miercoles", "jueves", "viernes"],
      diaDescanso: usuario.diaDescanso || "sabado",
      documentos: usuario.documentos || {
        dpiFrontal: "",
        dpiReverso: "",
        tarjetaSalud: "",
        tarjetaManipulacionAlimentos: "",
        otros: []
      },
      estado: usuario.estado || (usuario.activo === false ? "Inactivo" : "Activo")
    })
  }

  function validarFormularioColaborador() {
    const faltantes = {}
    if (!userForm.nombre.trim()) faltantes.nombre = "Nombre completo"
    if (!userForm.username.trim()) faltantes.username = "Username"
    if (!correoTieneFormatoValido(userForm.correo)) faltantes.correo = "Correo con formato válido"
    if (!editUserId && !userForm.password) faltantes.password = "Contraseña"
    if (!userForm.rol) faltantes.rol = "Rol"
    if (!userForm.departamento) faltantes.departamento = "Departamento"
    if (!userForm.fechaInicioLabores) faltantes.fechaInicioLabores = "Fecha de ingreso"
    if (!userForm.estado) faltantes.estado = "Estado"
    if (obtenerTurnosColaborador(userForm).length === 0) faltantes.turnos = "Horario/turnos"
    return faltantes
  }

  function guardarColaboradorValidado(event) {
    event.preventDefault()
    const faltantes = validarFormularioColaborador()
    setErroresColaborador(faltantes)
    if (Object.keys(faltantes).length > 0) return
    crearOActualizarUsuario(event)
    setMostrarFormularioColaborador(false)
  }

  async function guardarCambiosPerfilColaborador(event) {
    event.preventDefault()
    if (!colaboradorPerfil) return

    const faltantes = validarFormularioColaborador()
    setErroresColaborador(faltantes)
    setMensajePerfilColaborador("")
    if (Object.keys(faltantes).length > 0) return

    const valid = validarUnicos(userForm.username, userForm.correo, colaboradorPerfil.id)
    if (!valid.ok) {
      setErroresColaborador({ general: valid.mensaje })
      return
    }

    if (usuarioActual && usuarioActual.rol === "Recursos Humanos") {
      const prohibidos = ["Administrador", "Gerente General", "Encargado de Almacén"]
      if (prohibidos.includes(userForm.rol) || prohibidos.includes(colaboradorPerfil.rol)) {
        setErroresColaborador({ general: "Recursos Humanos no puede editar usuarios Administrador o Gerente General." })
        return
      }
    }

    const schedulesActualizados = convertirSchedulesNuevos(obtenerTurnosColaborador(userForm))
    const passwordActualizada = userForm.password ? await hashPassword(userForm.password) : (colaboradorPerfil.auth?.passwordHash || colaboradorPerfil.password)
    const authActualizado = {
      ...getUserAuth(colaboradorPerfil),
      username: userForm.username,
      passwordHash: passwordActualizada,
      status: userForm.estado === "Activo" ? "active" : userForm.estado === "Suspendido" ? "suspended" : "inactive"
    }
    const actualizado = {
      ...colaboradorPerfil,
      ...userForm,
      correo: userForm.correo.trim(),
      schedules: schedulesActualizados,
      turnos: convertirTurnosCompatibles(schedulesActualizados),
      password: passwordActualizada,
      auth: authActualizado,
      activo: userForm.estado === "Activo",
      securityEvents: userForm.rol !== colaboradorPerfil.rol
        ? [...(colaboradorPerfil.securityEvents || []), crearEventoSeguridad("Acceso actualizado", "Se actualizó la contraseña o permisos del usuario")]
        : (colaboradorPerfil.securityEvents || []),
      ultimaEdicion: new Date().toLocaleString()
    }

    setUsers((actuales) => actuales.map((usuario) => (usuario.id === colaboradorPerfil.id ? actualizado : usuario)))
    setPerfilColaboradorEditando(false)
    setEditUserId(null)
    setErroresColaborador({})
    setMensajePerfilColaborador("Perfil actualizado correctamente.")
  }

  function crearOActualizarUsuario(e) {
    e && e.preventDefault()
    if (!userForm.username.trim() || !userForm.nombre.trim()) {
      alert("Nombre y username son obligatorios.")
      return
    }

    if (!correoTieneFormatoValido(userForm.correo)) {
      alert("Ingresa un correo válido o deja el campo vacío.")
      return
    }

    if (!editUserId && !userForm.password) {
      alert("La contraseña es obligatoria al crear un usuario.")
      return
    }

    if (!userForm.rol) {
      alert("Rol es obligatorio.")
      return
    }

    if (!userForm.departamento) {
      alert("Departamento es obligatorio.")
      return
    }

    if (!userForm.fechaInicioLabores) {
      alert("Fecha de inicio de labores es obligatoria.")
      return
    }

    const schedulesActualizados = convertirSchedulesNuevos(obtenerTurnosColaborador(userForm))
    if (schedulesActualizados.length === 0) {
      alert("Agrega al menos un turno.")
      return
    }

    if (!userForm.estado) {
      alert("Estado es obligatorio.")
      return
    }

    const valid = validarUnicos(userForm.username, userForm.correo, editUserId)
    if (!valid.ok) {
      alert(valid.mensaje)
      return
    }

    // restricciones para Recursos Humanos
    if (usuarioActual && usuarioActual.rol === "Recursos Humanos") {
      const prohibidos = ["Administrador", "Gerente General", "Encargado de Almacén"]
      if (prohibidos.includes(userForm.rol)) {
        alert("Recursos Humanos no puede crear ni asignar roles de Administrador o Gerente General.")
        return
      }
      if (editUserId) {
        const usuarioEdit = users.find((u) => u.id === editUserId)
        if (usuarioEdit && prohibidos.includes(usuarioEdit.rol)) {
          alert("Recursos Humanos no puede editar usuarios Administrador o Gerente General.")
          return
        }
      }
    }

    (async () => {
      if (editUserId) {
        const updated = users.map((u) => {
          if (u.id !== editUserId) return u
          const passwordHash = userForm.password ? hashPassword(userForm.password) : Promise.resolve(u.auth?.passwordHash || u.password || "")
          return { ...u, ...userForm, correo: userForm.correo.trim(), schedules: schedulesActualizados, turnos: convertirTurnosCompatibles(schedulesActualizados), auth: { ...getUserAuth(u), username: userForm.username, passwordHash: u.auth?.passwordHash || u.password || "", status: userForm.estado === "Activo" ? "active" : userForm.estado === "Suspendido" ? "suspended" : "inactive" }, securityEvents: userForm.rol !== u.rol ? [...(u.securityEvents || []), crearEventoSeguridad("Acceso actualizado", "Se actualizó la contraseña o permisos del usuario")] : (u.securityEvents || []), ultimaEdicion: new Date().toLocaleString(), _pendingPasswordHash: passwordHash }
        })
        const resolvedUpdated = await Promise.all(updated.map(async (u) => {
          if (!u._pendingPasswordHash) return u
          const passwordHash = await u._pendingPasswordHash
          const { _pendingPasswordHash, ...clean } = u
          return { ...clean, password: passwordHash, auth: { ...clean.auth, passwordHash } }
        }))
        setUsers(resolvedUpdated)
        setEditUserId(null)
        alert("Usuario actualizado.")
      } else {
        const pwd = userForm.password ? await hashPassword(userForm.password) : ""
        const nuevo = { ...userForm, correo: userForm.correo.trim(), schedules: schedulesActualizados, turnos: convertirTurnosCompatibles(schedulesActualizados), password: pwd, auth: { username: userForm.username, passwordHash: pwd, temporaryPassword: "", mustChangePassword: false, lastLogin: null, isOnline: false, status: userForm.estado === "Activo" ? "active" : "inactive" }, id: generarIdUsuario(), creadoEn: new Date().toLocaleString(), ultimaEdicion: new Date().toLocaleString(), creadoPor: usuarioActual ? usuarioActual.username : "sistema" }
        setUsers([nuevo, ...users])
        alert("Usuario creado.")
      }
    })()

    limpiarFormularioUsuario()
  }

  function editarUsuario(usuario) {
    setEditUserId(usuario.id)
    setMostrarFormularioColaborador(true)
    setMostrarPerfilColaborador(false)
    setErroresColaborador({})
    cargarFormularioColaborador(usuario)
    setErroresColaborador({})
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function iniciarEdicionPerfilColaborador(usuario) {
    setEditUserId(usuario.id)
    setColaboradorPerfilId(usuario.id)
    setMostrarFormularioColaborador(false)
    setMostrarPerfilColaborador(true)
    setPerfilColaboradorEditando(true)
    setMensajePerfilColaborador("")
    setErroresColaborador({})
    cargarFormularioColaborador(usuario)
  }

  function cancelarEdicionPerfilColaborador() {
    setPerfilColaboradorEditando(false)
    setEditUserId(null)
    setErroresColaborador({})
    setMensajePerfilColaborador("")
    if (colaboradorPerfil) cargarFormularioColaborador(colaboradorPerfil)
  }

  function toggleUsuarioActivo(id) {
    setUsers(users.map((u) => (u.id === id ? { ...u, activo: !u.activo, ultimaEdicion: new Date().toLocaleString() } : u)))
  }

  function abrirRecuperacionAsistencia(type) {
    setAsistenciaRecoveryType(type)
    setAsistenciaRecoveryValue("")
    setAsistenciaRecoveryMessage("")
  }

  function crearSolicitudRecuperacionAsistencia(type, query) {
    const normalized = query.trim().toLowerCase()
    const matchedUser = users.find((user) =>
      [user.correo, user.telefono, user.nombre, user.username, user.auth?.username]
        .filter(Boolean)
        .some((value) => String(value).trim().toLowerCase() === normalized)
    )

    const request = {
      id: `${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      type,
      status: "pendiente",
      priority: "media",
      query,
      matchedUserId: matchedUser?.id || null,
      matchedUserName: matchedUser?.nombre || "",
      matchedUsername: matchedUser?.auth?.username || matchedUser?.username || "",
      date: new Date().toISOString(),
      createdFrom: "attendance"
    }

    setAccessRequests((actuales) => [request, ...actuales])
  }

  function enviarRecuperacionAsistencia(event) {
    event.preventDefault()
    if (!asistenciaRecoveryValue.trim()) return
    crearSolicitudRecuperacionAsistencia(asistenciaRecoveryType, asistenciaRecoveryValue)
    setAsistenciaRecoveryMessage("Si la información coincide con un usuario registrado, se enviará una solicitud de recuperación.")
  }

  function agregarTurno() {
    if (!turnoTemp.day) {
      alert("Selecciona el día del turno.")
      return
    }
    if (!turnoTemp.startHour || !turnoTemp.startMinute || !turnoTemp.startPeriod || !turnoTemp.endHour || !turnoTemp.endMinute || !turnoTemp.endPeriod) {
      alert("Ingresa entrada y salida del turno.")
      return
    }
    const nuevoTurno = construirScheduleDesdeTemp()
    const duracion = calculateShiftDuration(nuevoTurno)
    if (!duracion.ok) {
      alert(duracion.error)
      return
    }
    const turnosActuales = convertirSchedulesNuevos(obtenerTurnosColaborador(userForm))
    const duplicado = turnosActuales.some((turno) =>
      typeof turno !== "string" &&
      turno.day === nuevoTurno.day &&
      turno.startTime === nuevoTurno.startTime &&
      turno.startPeriod === nuevoTurno.startPeriod &&
      turno.endTime === nuevoTurno.endTime &&
      turno.endPeriod === nuevoTurno.endPeriod &&
      Boolean(turno.crossesMidnight) === Boolean(nuevoTurno.crossesMidnight)
    )
    if (duplicado) {
      alert("Ese turno ya existe para el mismo día y rango.")
      return
    }
    const schedulesActualizados = convertirSchedulesNuevos([...turnosActuales, nuevoTurno])
    setUserForm(s => ({
      ...s,
      schedules: schedulesActualizados,
      turnos: convertirTurnosCompatibles(schedulesActualizados)
    }))
    setTurnoTemp(turnoInicial)
    setErroresColaborador((actuales) => {
      if (!actuales.turnos) return actuales
      const siguientes = { ...actuales }
      delete siguientes.turnos
      return siguientes
    })
  }

  function eliminarTurno(id) {
    const schedulesActualizados = convertirSchedulesNuevos(obtenerTurnosColaborador(userForm).filter((turno, index) => {
      if (typeof turno === "string") return id !== `legacy-${index}`
      if (!turno.id && !turno.day) return id !== `legacy-${index}`
      return turno.id !== id
    }))
    setUserForm(s => ({
      ...s,
      schedules: schedulesActualizados,
      turnos: convertirTurnosCompatibles(schedulesActualizados)
    }))
  }

  function obtenerInicialesColaborador(nombre) {
    const partes = String(nombre || "Colaborador")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)

    return partes.map((parte) => parte.charAt(0).toUpperCase()).join("") || "?"
  }

  function renderSelectTiempo(campo, opciones, etiqueta) {
    return (
      <label style={scheduleSelectLabelStyle}>
        <span>{etiqueta}</span>
        <select value={turnoTemp[campo]} onChange={(e) => setTurnoTemp((s) => ({ ...s, [campo]: e.target.value }))} style={scheduleSelectStyle}>
          {opciones.map((opcion) => <option key={opcion} value={opcion}>{opcion}</option>)}
        </select>
      </label>
    )
  }

  function renderControlesTurno(botonTexto = "Agregar turno") {
    return (
      <div style={scheduleEditorStyle}>
        <div style={scheduleGroupStyle}>
          <span style={scheduleGroupTitleStyle}>Día</span>
          <label style={scheduleSelectLabelStyle}>
            <span>Día</span>
            <select value={turnoTemp.day} onChange={(e) => setTurnoTemp((s) => ({ ...s, day: e.target.value }))} style={scheduleSelectStyle}>
              {diasSemanaTurnos.map((dia) => <option key={dia.value} value={dia.value}>{dia.label}</option>)}
            </select>
          </label>
        </div>
        <div style={scheduleGroupStyle}>
          <span style={scheduleGroupTitleStyle}>Entrada</span>
          <div style={scheduleSelectRowStyle}>
            {renderSelectTiempo("startHour", horasTurno, "Hora")}
            {renderSelectTiempo("startMinute", minutosTurno, "Min")}
            {renderSelectTiempo("startPeriod", periodosTurno, "AM/PM")}
          </div>
        </div>
        <div style={scheduleGroupStyle}>
          <span style={scheduleGroupTitleStyle}>Salida</span>
          <div style={scheduleSelectRowStyle}>
            {renderSelectTiempo("endHour", horasTurno, "Hora")}
            {renderSelectTiempo("endMinute", minutosTurno, "Min")}
            {renderSelectTiempo("endPeriod", periodosTurno, "AM/PM")}
          </div>
        </div>
        <label style={scheduleMidnightToggleStyle}>
          <input type="checkbox" checked={turnoTemp.crossesMidnight} onChange={(e) => setTurnoTemp((s) => ({ ...s, crossesMidnight: e.target.checked }))} />
          <span>Turno cruza medianoche</span>
        </label>
        <button type="button" onClick={agregarTurno} style={scheduleAddButtonStyle}>{botonTexto}</button>
      </div>
    )
  }

  function renderTurnosColaborador(turnos, editable = false) {
    const lista = ordenarSchedules(convertirSchedulesNuevos(turnos || []))
    if (lista.length === 0) return <p style={scheduleEmptyStyle}>No hay turnos registrados.</p>

    const grupos = lista.reduce((acc, turno) => {
      if (typeof turno === "string" || !turno.day) return acc
      if (!acc[turno.day]) acc[turno.day] = { label: turno.dayLabel || obtenerDiaTurno(turno)?.label || turno.day, items: [] }
      acc[turno.day].items.push(turno)
      return acc
    }, {})

    if (!editable) {
      const legacy = lista.filter((turno) => typeof turno === "string" || !turno.day)
      return (
        <div style={scheduleProfileGroupListStyle}>
          {diasSemanaTurnos.filter((dia) => grupos[dia.value]).map((dia) => (
            <div key={dia.value} style={scheduleProfileDayStyle}>
              <span style={scheduleDayBadgeStyle}>{dia.label}</span>
              <ul style={scheduleProfileTimesStyle}>
                {grupos[dia.value].items.map((turno) => (
                  <li key={turno.id}>{turno.startTime} {turno.startPeriod} - {turno.endTime} {turno.endPeriod}{turno.crossesMidnight ? " · cruza medianoche" : ""}</li>
                ))}
              </ul>
            </div>
          ))}
          {legacy.length > 0 && (
            <div style={scheduleProfileDayStyle}>
              <span style={scheduleDayBadgeStyle}>Horario anterior</span>
              <ul style={scheduleProfileTimesStyle}>{legacy.map((turno, idx) => <li key={`legacy-profile-${idx}`}>{formatearTurno(turno)}</li>)}</ul>
            </div>
          )}
        </div>
      )
    }

    return (
      <div style={scheduleTableStyle}>
        <div style={scheduleTableHeaderStyle}>
          <span>Día</span>
          <span>Entrada</span>
          <span>Salida</span>
          <span>Duración</span>
          <span>Acciones</span>
        </div>
        {lista.map((turno, idx) => {
          const isLegacy = typeof turno === "string" || !turno.day
          const duracion = isLegacy ? null : calculateShiftDuration(turno)
          return (
            <div key={isLegacy ? `legacy-${idx}` : turno.id} style={scheduleTableRowStyle}>
              <span>{isLegacy ? <span style={scheduleDayBadgeStyle}>Anterior</span> : <span style={scheduleDayBadgeStyle}>{turno.dayLabel || obtenerDiaTurno(turno)?.label}</span>}</span>
              <span>{isLegacy ? formatearTurno(turno) : `${turno.startTime} ${turno.startPeriod}`}</span>
              <span>{isLegacy ? "Compatible" : `${turno.endTime} ${turno.endPeriod}`}</span>
              <span>{duracion?.ok ? duracion.label : "N/A"}</span>
              <span>
                <button type="button" onClick={() => eliminarTurno(isLegacy ? `legacy-${idx}` : turno.id)} style={scheduleDeleteButtonStyle}>
                  Eliminar
                </button>
              </span>
            </div>
          )
        })}
      </div>
    )
  }

  function getToneStyle(tone) {
    const tones = {
      good: { border: "#22c55e", background: "#052e1a", color: "#bbf7d0" },
      warning: { border: "#f59e0b", background: "#422006", color: "#fde68a" },
      danger: { border: "#ef4444", background: "#450a0a", color: "#fecaca" },
      info: { border: "#38bdf8", background: "#082f49", color: "#bae6fd" },
      muted: { border: "#64748b", background: "#111827", color: "#cbd5e1" }
    }
    return tones[tone] || tones.muted
  }

  function renderStatusBadge(label, tone = "muted") {
    const colors = getToneStyle(tone)
    return <span style={{ ...hrBadgeStyle, borderColor: colors.border, backgroundColor: colors.background, color: colors.color }}>{label}</span>
  }

  function openEmployeeProfile(employee) {
    if (!employee) return
    setSelectedEmployee(employee)
    setColaboradorPerfilId(employee.id)
    setCurrentHRView("employeeProfile")
    setHrProfileTab("resumen")
    setPerfilColaboradorEditando(false)
    setMensajePerfilColaborador("")
    setErroresColaborador({})
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  async function copiarUsernameColaborador(username) {
    if (!username) return
    try {
      await navigator.clipboard.writeText(username)
      setMensajePerfilColaborador(`Usuario copiado: ${username}`)
    } catch {
      window.prompt("Copia el nombre de usuario:", username)
    }
  }

  function backToCollaborators() {
    setSelectedEmployee(null)
    setColaboradorPerfilId(null)
    setCurrentHRView("collaborators")
    setPerfilColaboradorEditando(false)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function getHRViewTitle() {
    if (currentHRView === "alerts") return "Alertas de RRHH"
    if (currentHRView === "collaborators") return "Colaboradores"
    if (currentHRView === "users") return "Gestión de usuarios"
    if (currentHRView === "employeeProfile") return "Perfil de colaborador"
    return "Dashboard RRHH"
  }

  function getHRBreadcrumb() {
    if (currentHRView === "employeeProfile") return `Recursos Humanos / Colaboradores / ${selectedEmployee?.nombre || colaboradorPerfil?.nombre || "Perfil"}`
    if (currentHRView === "alerts") return "Recursos Humanos / Alertas"
    if (currentHRView === "collaborators") return "Recursos Humanos / Colaboradores"
    if (currentHRView === "users") return "Recursos Humanos / Gestión de usuarios"
    return "Recursos Humanos / Dashboard RRHH"
  }

  function renderProgress(value, label) {
    const safeValue = Math.max(0, Math.min(100, Number(value || 0)))
    const tone = safeValue >= 85 ? "good" : safeValue >= 70 ? "warning" : "danger"
    const colors = getToneStyle(tone)
    return (
      <div style={hrProgressItemStyle}>
        <div style={hrProgressHeaderStyle}>
          <span>{label}</span>
          <strong>{safeValue}%</strong>
        </div>
        <div style={hrProgressTrackStyle}>
          <div style={{ ...hrProgressFillStyle, width: `${safeValue}%`, backgroundColor: colors.border }} />
        </div>
      </div>
    )
  }

  function renderHRDashboard() {
    return (
      <div style={hrSectionStackStyle}>
        <div style={hrDashboardGridStyle}>
          {hrDashboardCards.map((card) => {
            const colors = getToneStyle(card.tone)
            return (
              <div key={card.title} style={{ ...hrMetricCardStyle, borderColor: colors.border }}>
                <div style={hrMetricTopStyle}>
                  <span style={{ ...hrMetricIconStyle, backgroundColor: colors.background, color: colors.color }}>{card.icon}</span>
                  {renderStatusBadge(card.tone === "good" ? "Bien" : card.tone === "danger" ? "Urgente" : card.tone === "warning" ? "Atención" : "Info", card.tone)}
                </div>
                <h3 style={hrMetricTitleStyle}>{card.title}</h3>
                <div style={hrMetricValueStyle}>{card.value}</div>
                <p style={hrMetricNoteStyle}>{card.note}</p>
              </div>
            )
          })}
        </div>
        <div style={hrTwoColumnStyle}>
          <div style={profileCardStyle}>
            <h3>Alertas importantes</h3>
            {renderHRAlerts(hrOpenAlerts.slice(0, 6))}
          </div>
          <div style={profileCardStyle}>
            <h3>Clima laboral</h3>
            <div style={hrMoodScoreStyle}>{hrMood.average === null ? "Sin datos" : `${hrMood.average}%`}</div>
            <p style={{ color: "#cbd5e1" }}>Tendencia semanal: {hrMood.trend}</p>
            <p style={{ color: "#94a3b8" }}>Colaboradores con señales de estrés: {hrMood.stressed}</p>
          </div>
        </div>
      </div>
    )
  }

  function renderHRAlerts(alerts) {
    if (!alerts.length) return <p style={hrMutedTextStyle}>No hay alertas pendientes.</p>
    return (
      <div style={hrAlertListStyle}>
        {alerts.map((alert) => {
          const tone = alert.prioridad === "alta" ? "danger" : alert.prioridad === "media" ? "warning" : "info"
          return (
            <div key={alert.id} style={{ ...hrAlertItemStyle, borderColor: getToneStyle(tone).border }}>
              <div>
                <strong>{alert.tipo}</strong>
                <p style={hrMutedParagraphStyle}>{alert.colaborador} · {alert.fecha}</p>
                {renderStatusBadge(`Prioridad ${alert.prioridad}`, tone)}
              </div>
              <div style={hrAlertActionsStyle}>
                <button type="button" style={editButtonStyle} onClick={() => openEmployeeProfile(hrEmployees.find((employee) => employee.id === alert.employeeId))}>Ver colaborador</button>
                <button type="button" style={cancelButtonStyle} onClick={() => setHrResolvedAlerts((actuales) => [...new Set([...actuales, alert.id])])}>Marcar resuelta</button>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderDocumentCards(employee) {
    return (
      <div style={hrMiniGridStyle}>
        {getEmployeeDocuments(employee).map((document) => {
          const tone = document.status === "vigente" ? "good" : document.status === "por vencer" ? "warning" : document.status === "vencido" ? "danger" : "muted"
          return (
            <div key={document.key} style={hrDocumentCardStyle}>
              <div style={hrDocumentHeaderStyle}>
                <strong>{document.nombre}</strong>
                {renderStatusBadge(document.status, tone)}
              </div>
              <p style={hrMutedParagraphStyle}>Archivo: {document.file ? "Registrado" : "Pendiente"}</p>
              <p style={hrMutedParagraphStyle}>Emisión: {document.issueDate || "Sin información"}</p>
              <p style={hrMutedParagraphStyle}>Vence: {document.expirationDate || "No aplica"}</p>
            </div>
          )
        })}
      </div>
    )
  }

  function renderPerformance(employee) {
    const score = calculateEmployeeScore(employee)
    const scoreLabel = getScoreLabel(score)
    return (
      <div style={hrSectionStackStyle}>
        <div style={hrScorePanelStyle}>
          <div>
            <span style={hrMutedTextStyle}>Score general</span>
            <div style={hrScoreValueStyle}>{score === null ? "Sin datos" : `${score}%`}</div>
          </div>
          {renderStatusBadge(scoreLabel.label, scoreLabel.tone)}
        </div>
        <div style={hrMiniGridStyle}>
          {HR_PERFORMANCE_FIELDS.map((field) => renderProgress(employee.performance?.[field.key] ?? 0, field.label))}
        </div>
      </div>
    )
  }

  function renderTraining(employee) {
    const stats = getTrainingStats(employee)
    const records = employee.trainingRecords || []
    return (
      <div style={hrSectionStackStyle}>
        <div style={hrMiniGridStyle}>
          <div style={hrStatCardStyle}><strong>{stats.completed}</strong><span>Completadas</span></div>
          <div style={hrStatCardStyle}><strong>{stats.pending}</strong><span>Pendientes</span></div>
          <div style={hrStatCardStyle}><strong>{stats.averageScore ?? "Sin datos"}</strong><span>Promedio evaluación</span></div>
          <div style={hrStatCardStyle}><strong>{stats.criticalPending}</strong><span>Críticas pendientes</span></div>
        </div>
        <div style={hrTableLikeStyle}>
          {records.length ? records.map((record) => (
            <div key={record.id || record.title} style={hrRowStyle}>
              <div><strong>{record.title}</strong><p style={hrMutedParagraphStyle}>{record.category || "General"} · {record.instructor || "Sin instructor"}</p></div>
              {renderStatusBadge(record.status || "pending", record.status === "completed" ? "good" : record.status === "failed" ? "danger" : "warning")}
              <span>{record.score ?? "Sin nota"}</span>
            </div>
          )) : <p style={hrMutedTextStyle}>Sin capacitaciones registradas.</p>}
        </div>
      </div>
    )
  }

  function renderAttendance(employee) {
    const stats = getMonthlyAttendanceStats(employee)
    return (
      <div style={hrSectionStackStyle}>
        <div style={hrMiniGridStyle}>
          <div style={hrStatCardStyle}><strong>{stats.tardanzas}</strong><span>Tardanzas del mes</span></div>
          <div style={hrStatCardStyle}><strong>{stats.ausencias}</strong><span>Ausencias del mes</span></div>
          <div style={hrStatCardStyle}><strong>{stats.minutosTarde}</strong><span>Minutos tarde</span></div>
          <div style={hrStatCardStyle}><strong>{stats.asistenciaMensual === null ? "Sin datos" : `${stats.asistenciaMensual}%`}</strong><span>Asistencia mensual</span></div>
        </div>
        {(employee.attendanceRecords || []).length ? (employee.attendanceRecords || []).map((record) => (
          <div key={`${record.date}-${record.status}`} style={hrRowStyle}>
            <div><strong>{record.date}</strong><p style={hrMutedParagraphStyle}>{record.scheduledStart || "Sin entrada"} - {record.scheduledEnd || "Sin salida"}</p></div>
            {renderStatusBadge(record.status, record.status === "late" ? "warning" : record.status === "absent" ? "danger" : "good")}
            <span>{record.minutesLate || 0} min tarde</span>
          </div>
        )) : <p style={hrMutedTextStyle}>Sin registros de asistencia cargados.</p>}
      </div>
    )
  }

  function renderIncidents(employee) {
    const incidents = employee.incidentRecords || []
    const recognitions = employee.recognitionRecords || []
    return (
      <div style={hrTwoColumnStyle}>
        <div style={profileCardStyle}>
          <h3>Incidentes</h3>
          {incidents.length ? incidents.map((record) => (
            <div key={`${record.fecha}-${record.tipo}`} style={hrTimelineItemStyle}>
              <strong>{record.tipo}</strong>
              <p style={hrMutedParagraphStyle}>{record.fecha} · Severidad {record.severidad}</p>
              <p>{record.descripcion}</p>
            </div>
          )) : <p style={hrMutedTextStyle}>Sin incidentes registrados.</p>}
        </div>
        <div style={profileCardStyle}>
          <h3>Reconocimientos</h3>
          {recognitions.length ? recognitions.map((record) => (
            <div key={`${record.fecha}-${record.tipo}`} style={hrTimelineItemStyle}>
              <strong>{record.tipo}</strong>
              <p style={hrMutedParagraphStyle}>{record.fecha} · {record.registradoPor || "Gerencia"}</p>
              <p>{record.descripcion}</p>
            </div>
          )) : <p style={hrMutedTextStyle}>Sin reconocimientos registrados.</p>}
        </div>
      </div>
    )
  }

  function renderCareer(employee) {
    const career = getCareerProgress(employee)
    return (
      <div style={hrSectionStackStyle}>
        <div style={hrScorePanelStyle}>
          <div><span style={hrMutedTextStyle}>Nivel actual</span><h3 style={{ margin: "6px 0 0" }}>{career.currentLevel || employee.puesto || "Sin nivel"}</h3></div>
          <div><span style={hrMutedTextStyle}>Siguiente nivel</span><h3 style={{ margin: "6px 0 0" }}>{career.nextLevel || "Sin definir"}</h3></div>
        </div>
        {renderProgress(career.progress, "Progreso de carrera")}
        <div style={hrTableLikeStyle}>
          {(career.requirements || []).length ? career.requirements.map((item) => (
            <div key={item.title} style={hrRowStyle}>
              <span>{item.title}</span>
              {renderStatusBadge(item.completed ? "Cumplido" : "Pendiente", item.completed ? "good" : "warning")}
            </div>
          )) : <p style={hrMutedTextStyle}>Sin requisitos configurados.</p>}
        </div>
      </div>
    )
  }

  function renderTimeline(employee) {
    const events = getEmployeeTimeline(employee)
    if (!events.length) return <p style={hrMutedTextStyle}>Sin eventos en timeline.</p>
    return (
      <div style={hrTimelineStyle}>
        {events.map((event, idx) => (
          <div key={`${event.fecha}-${event.titulo}-${idx}`} style={hrTimelineItemStyle}>
            <div style={hrTimelineDotStyle} />
            <strong>{event.titulo}</strong>
            <p style={hrMutedParagraphStyle}>{event.fecha} · {event.tipo} · {event.registradoPor}</p>
            <p>{event.descripcion || "Sin descripción"}</p>
          </div>
        ))}
      </div>
    )
  }

  function renderMoodHistory(employee) {
    const records = employee.moodRecords || []
    return records.length ? (
      <div style={hrTableLikeStyle}>
        {records.map((record) => (
          <div key={`${record.date}-${record.mood}`} style={hrRowStyle}>
            <strong>{record.date}</strong>
            {renderStatusBadge(record.mood, record.mood === "happy" ? "good" : record.mood === "neutral" ? "info" : "warning")}
            <span>{record.comment || "Sin comentario"}</span>
          </div>
        ))}
      </div>
    ) : <p style={hrMutedTextStyle}>Sin registros de clima.</p>
  }

  function renderHRProfile(employee) {
    if (!employee) return <p style={hrMutedTextStyle}>Selecciona un colaborador para ver su perfil.</p>
    const score = calculateEmployeeScore(employee)
    const age = getEmployeeAge(employee.fechaCumpleanos)
    const employeeAuth = getUserAuth(employee)
    const employeeUsername = employeeAuth.username || employee.username || "Sin usuario"
    const tabs = ["resumen", "documentos", "horarios", "desempeño", "capacitaciones", "incidentes", "timeline", "carrera"]
    return (
      <div style={profileShellStyle}>
        <div style={employeeProfileBackBarStyle}>
          <button type="button" onClick={backToCollaborators} style={employeeBackButtonStyle}>← Volver a colaboradores</button>
        </div>
        <div style={profileHeaderStyle}>
          <div style={profilePhotoPanelStyle}>
            {employee.fotoColaborador ? <img src={employee.fotoColaborador} alt={employee.nombre} style={profileAvatarStyle} /> : <div style={profileAvatarPlaceholderStyle}>{obtenerInicialesColaborador(employee.nombre)}</div>}
            <div style={profilePhotoActionsStyle}>
              <label style={profilePhotoButtonStyle}>
                {employee.fotoColaborador ? "Cambiar imagen" : "Subir imagen"}
                <input type="file" accept="image/*" onChange={cambiarFotoPerfilColaborador} style={{ display: "none" }} />
              </label>
              {employee.fotoColaborador && <button type="button" onClick={eliminarFotoPerfilColaborador} style={profilePhotoDeleteButtonStyle}>Eliminar imagen</button>}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: "240px" }}>
            <h2 style={{ margin: 0 }}>{employee.nombre}</h2>
            <p style={{ color: "#cbd5e1" }}>{employee.puesto || "Sin puesto"} · {employee.departamento || "Sin departamento"}</p>
            <div style={profileUsernameRowStyle}>
              <span style={profileUsernameBadgeStyle}>@{employeeUsername}</span>
              {employeeUsername !== "Sin usuario" && (
                <button type="button" onClick={() => copiarUsernameColaborador(employeeUsername)} style={profileCopyUsernameButtonStyle}>
                  Copiar usuario
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              {renderStatusBadge(employee.estado || (employee.activo ? "Activo" : "Inactivo"), employee.estado === "Activo" || employee.activo ? "good" : employee.estado === "Suspendido" ? "warning" : "danger")}
              {renderStatusBadge(score === null ? "Sin score" : `${score}% · ${getScoreLabel(score).label}`, getScoreLabel(score).tone)}
            </div>
            {puedeGestionarUsuarios && !String(employee.id).startsWith("mock-") && <button type="button" onClick={() => editarUsuario(employee)} style={{ ...editButtonStyle, marginTop: "12px" }}>Editar perfil</button>}
            {String(employee.id).startsWith("mock-") && <p style={hrMutedParagraphStyle}>Registro temporal de demostración.</p>}
          </div>
        </div>
        <div style={hrTabBarStyle}>
          {tabs.map((tab) => <button key={tab} type="button" onClick={() => setHrProfileTab(tab)} style={hrProfileTab === tab ? activeTabButtonStyle : sectionButtonStyle}>{tab}</button>)}
        </div>
        <div style={{ padding: "16px" }}>
          {hrProfileTab === "resumen" && (
            <div style={profileGridStyle}>
              <div style={profileCardStyle}><h3>Información básica</h3><p>Usuario: <strong>@{employeeUsername}</strong></p><p>Teléfono: {employee.telefono || "Sin información"}</p><p>Correo: {employee.correo || "No registrado"}</p><p>Ingreso: {employee.fechaInicioLabores || "Sin información"}</p><p>Antigüedad: {getEmployeeSeniority(employee.fechaInicioLabores)}</p><p>Cumpleaños: {employee.fechaCumpleanos || "Sin información"}</p><p>Edad: {age ?? "Sin información"}</p></div>
              <div style={profileCardStyle}><h3>Organización</h3><p>Supervisor: {employee.supervisorDirecto || "Sin información"}</p><p>Área: {employee.departamento || "Sin información"}</p><p>Rol: {employee.rol || "Sin información"}</p><p>Contacto emergencia: {employee.contactoEmergencia || "Sin información"}</p></div>
              <div style={profileCardStyle}><h3>Asistencia</h3>{renderAttendance(employee)}</div>
              <div style={profileCardStyle}><h3>Clima laboral</h3>{renderMoodHistory(employee)}</div>
            </div>
          )}
          {hrProfileTab === "documentos" && renderDocumentCards(employee)}
          {hrProfileTab === "horarios" && <div style={profileCardStyle}><h3>Horario / turnos</h3>{renderTurnosColaborador(obtenerTurnosColaborador(employee))}</div>}
          {hrProfileTab === "desempeño" && renderPerformance(employee)}
          {hrProfileTab === "capacitaciones" && renderTraining(employee)}
          {hrProfileTab === "incidentes" && renderIncidents(employee)}
          {hrProfileTab === "timeline" && renderTimeline(employee)}
          {hrProfileTab === "carrera" && renderCareer(employee)}
        </div>
      </div>
    )
  }

  function renderRoleBadge(role) {
    const normalized = normalizeAccessRole({ rol: role })
    const labels = {
      administrador: "Admin",
      admin: "Admin",
      gerente_general: "Gerente General",
      recursos_humanos: "RRHH",
      supervisor: "Supervisor",
      caja: "Caja",
      foh: "Mesero",
      servicio: "Mesero",
      cocina: "Cocina",
      barra: "Barra",
      cafeteria: "Cafetería",
      colaborador: "Colaborador"
    }
    const tone = normalized === "administrador" || normalized === "admin" || normalized === "gerente_general" ? "danger" : normalized === "recursos_humanos" || normalized === "supervisor" ? "warning" : "info"
    return renderStatusBadge(labels[normalized] || role || "Colaborador", tone)
  }

  function renderUserStatusBadge(user) {
    const auth = getUserAuth(user)
    const label = user.estado || (auth.status === "active" ? "Activo" : auth.status === "suspended" ? "Suspendido" : auth.status === "pending" ? "Pendiente" : "Inactivo")
    const tone = label === "Activo" ? "good" : label === "Suspendido" ? "warning" : label === "Pendiente" ? "info" : "muted"
    return renderStatusBadge(label, tone)
  }

  function getAccessRequestTypeLabel(type) {
    if (type === "forgot_username") return "Olvidó usuario"
    if (type === "forgot_password") return "Olvidó contraseña"
    return "Solicitud de acceso"
  }

  function getAccessRequestUser(request) {
    return users.find((user) => user.id === request.matchedUserId) || null
  }

  function updateAccessRequestStatus(requestId, status) {
    setAccessRequests((actuales) => actuales.map((request) => (
      request.id === requestId
        ? { ...request, status, resolvedAt: new Date().toISOString(), resolvedBy: usuarioActual?.nombre || usuarioActual?.username || "Sistema" }
        : request
    )))
  }

  function renderAccessRequestsPanel() {
    const sortedRequests = [...accessRequests].sort((a, b) => new Date(b.date) - new Date(a.date))
    return (
      <div style={profileCardStyle}>
        <h3>Solicitudes de acceso</h3>
        <p style={hrMutedParagraphStyle}>No se revela información sensible al solicitante. Valida la identidad antes de resetear.</p>
        <div style={hrTableLikeStyle}>
          {sortedRequests.length ? sortedRequests.map((request) => {
            const relatedUser = getAccessRequestUser(request)
            const statusTone = request.status === "resuelta" ? "good" : request.status === "rechazada" ? "danger" : "warning"
            return (
              <div key={request.id} style={accessRequestRowStyle}>
                <div>
                  <strong>{relatedUser?.nombre || request.matchedUserName || "Sin coincidencia confirmada"}</strong>
                  <p style={hrMutedParagraphStyle}>{getAccessRequestTypeLabel(request.type)} · {formatLastLogin(request.date)}</p>
                  <p style={hrMutedParagraphStyle}>Dato recibido: {request.query || "Sin dato"}</p>
                </div>
                <div style={userManagementBadgeStackStyle}>
                  {renderStatusBadge(request.status, statusTone)}
                  {renderStatusBadge(`Prioridad ${request.priority || "media"}`, "warning")}
                </div>
                <div style={accessRequestActionsStyle}>
                  <button type="button" onClick={() => relatedUser && openEmployeeProfile(relatedUser)} disabled={!relatedUser} style={userActionSecondaryButtonStyle}>Ver usuario</button>
                  <button type="button" onClick={() => relatedUser && abrirModalResetPassword(relatedUser.id)} disabled={!relatedUser} style={userActionPrimaryButtonStyle}>Resetear</button>
                  <button type="button" onClick={() => updateAccessRequestStatus(request.id, "resuelta")} style={userActionSecondaryButtonStyle}>Marcar resuelta</button>
                  <button type="button" onClick={() => updateAccessRequestStatus(request.id, "rechazada")} style={userActionDangerButtonStyle}>Rechazar</button>
                </div>
              </div>
            )
          }) : <p style={hrMutedTextStyle}>No hay solicitudes de acceso.</p>}
        </div>
      </div>
    )
  }

  function renderUserManagementView() {
    if (!puedeGestionarUsuarios) {
      return <div style={profileCardStyle}><p style={{ color: "#fca5a5" }}>No tienes permiso para ver esta sección.</p></div>
    }

    return (
      <div style={hrSectionStackStyle}>
        {renderAccessRequestsPanel()}
        <div style={profileCardStyle}>
          <h3>Gestión de usuarios</h3>
          <p style={hrMutedParagraphStyle}>Las contraseñas reales y hashes nunca se muestran. Usa reset para administrar accesos.</p>
        </div>
        <div className="user-management-list" style={userManagementTableStyle}>
          <div className="user-management-header" style={userManagementHeaderStyle}>
            <span>Foto</span>
            <span>Información</span>
            <span>Rol / estado</span>
            <span>Acceso</span>
            <span>Acciones</span>
          </div>
          {users.map((user) => {
            const auth = getUserAuth(user)
            return (
              <div key={user.id} className="user-management-row" style={userManagementRowStyle}>
                <div className="user-management-photo">{user.fotoColaborador ? <img src={user.fotoColaborador} alt={user.nombre} style={userManagementAvatarStyle} /> : <div style={userManagementAvatarPlaceholderStyle}>{obtenerInicialesColaborador(user.nombre)}</div>}</div>
                <div style={userManagementInfoStyle}>
                  <strong style={userManagementNameStyle}>{user.nombre || "Sin nombre"}</strong>
                  <span style={userManagementMetaStyle}>{user.puesto || "Sin puesto"}</span>
                  <span style={userManagementMetaStyle}>{user.correo || "Sin correo"} · {user.telefono || "Sin teléfono"}</span>
                  <span style={userManagementUsernameStyle}>@{auth.username} · Creado: {user.creadoEn || "Sin fecha"}</span>
                </div>
                <div style={userManagementBadgeStackStyle}>
                  {renderRoleBadge(user.rol)}
                  {renderUserStatusBadge(user)}
                </div>
                <div style={userManagementAccessStyle}>
                  {auth.isOnline ? (
                    <>
                      {renderStatusBadge("En línea", "good")}
                      <span style={userManagementAccessHintStyle}>Sesión activa</span>
                    </>
                  ) : (
                    <>
                      {renderStatusBadge("Offline", "muted")}
                      <span style={userManagementAccessHintStyle}>Último acceso</span>
                      <span style={userManagementAccessDateStyle}>{formatLastLogin(auth.lastLogin)}</span>
                    </>
                  )}
                </div>
                <div style={userManagementActionsStyle}>
                  <button type="button" onClick={() => openEmployeeProfile(user)} style={userActionSecondaryButtonStyle}>Ver perfil</button>
                  <button type="button" onClick={() => editarUsuario(user)} style={userActionPrimaryButtonStyle}>Editar</button>
                  <button type="button" onClick={() => abrirModalResetPassword(user.id)} style={userActionSecondaryButtonStyle}>Resetear</button>
                  <button type="button" onClick={() => toggleUsuarioActivoSeguro(user.id)} style={userActionDangerButtonStyle}>{user.activo === false || user.estado === "Inactivo" ? "Activar" : "Desactivar"}</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const onCropComplete = useCallback((_, areaPixels) => {
    setCroppedAreaPixels(areaPixels)
  }, [])

  function abrirCropFoto(file, target = "form") {
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setCropImageSrc(e.target.result)
      setCropTarget(target)
      setCrop({ x: 0, y: 0 })
      setCropZoom(1)
      setCroppedAreaPixels(null)
    }
    reader.readAsDataURL(file)
  }

  function cancelarCropFoto() {
    setCropImageSrc("")
    setCroppedAreaPixels(null)
    setCrop({ x: 0, y: 0 })
    setCropZoom(1)
  }

  async function guardarRecorteFoto() {
    if (!cropImageSrc) return

    try {
      const imagenRecortada = await getCroppedImg(cropImageSrc, croppedAreaPixels)
      if (cropTarget === "profile" && colaboradorPerfil) {
        setUsers((actuales) =>
          actuales.map((usuario) =>
            usuario.id === colaboradorPerfil.id
              ? { ...usuario, fotoColaborador: imagenRecortada, ultimaEdicion: new Date().toLocaleString() }
              : usuario
          )
        )
      } else {
        setUserForm((s) => ({
          ...s,
          fotoColaborador: imagenRecortada
        }))
      }
      cancelarCropFoto()
    } catch {
      alert("No se pudo recortar la imagen. Intenta con otra foto.")
    }
  }

  function subirFotoColaborador(event) {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    abrirCropFoto(file, "form")
    event.target.value = ""
  }

  function cambiarFotoPerfilColaborador(event) {
    const file = event.target.files && event.target.files[0]
    if (!file || !colaboradorPerfil) return

    abrirCropFoto(file, "profile")
    event.target.value = ""
  }

  function eliminarFotoPerfilColaborador() {
    if (!colaboradorPerfil) return

    setUsers((actuales) =>
      actuales.map((usuario) =>
        usuario.id === colaboradorPerfil.id
          ? { ...usuario, fotoColaborador: "", ultimaEdicion: new Date().toLocaleString() }
          : usuario
      )
    )
  }

  function subirDocumentoColaborador(event) {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setUserForm(s => ({
        ...s,
        documentos: {
          ...s.documentos,
          [documentoTemp.tipo]: e.target.result
        }
      }))
    }
    reader.readAsDataURL(file)
  }

  function limpiarFormularioUsuario() {
    setTurnoTemp(turnoInicial)
    setUserForm({
      nombre: "",
      username: "",
      correo: "",
      telefono: "",
      puesto: "",
      departamento: "Administracion",
      rol: "FOH",
      password: "",
      activo: true,
      observaciones: "",
      fotoColaborador: "",
      fechaInicioLabores: "",
      fechaCumpleanos: "",
      supervisorDirecto: "",
      contactoEmergencia: "",
      turnos: [],
      schedules: [],
      performance: {
        punctuality: 0,
        attendance: 0,
        productivity: 0,
        teamwork: 0,
        cleanliness: 0,
        checklistCompliance: 0,
        training: 0,
        discipline: 0,
        culture: 0
      },
      attendanceRecords: [],
      trainingRecords: [],
      incidentRecords: [],
      recognitionRecords: [],
      moodRecords: [],
      securityEvents: [],
      careerPath: {
        currentLevel: "",
        nextLevel: "",
        progress: 0,
        requirements: []
      },
      diasLaborales: ["lunes", "martes", "miercoles", "jueves", "viernes"],
      diaDescanso: "sabado",
      documentos: {
        dpiFrontal: "",
        dpiReverso: "",
        tarjetaSalud: "",
        tarjetaManipulacionAlimentos: "",
        otros: []
      },
      estado: "Activo"
    })
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function cambiarContrasena(id, nueva) {
    if (!nueva) { alert("Contraseña vacía."); return }
    ;(async () => {
      const hp = await hashPassword(nueva)
      setUsers(users.map((u) => (u.id === id ? {
        ...u,
        password: hp,
        auth: { ...getUserAuth(u), passwordHash: hp, temporaryPassword: "", mustChangePassword: true },
        securityEvents: [...(u.securityEvents || []), crearEventoSeguridad("Acceso actualizado", "Se actualizó la contraseña del usuario")],
        ultimaEdicion: new Date().toLocaleString()
      } : u)))
      alert("Contraseña cambiada.")
    })()
  }

  function crearEventoSeguridad(title, description) {
    return {
      type: "security",
      title,
      description,
      date: new Date().toISOString().slice(0, 10),
      registeredBy: usuarioActual?.nombre || usuarioActual?.username || "Sistema"
    }
  }

  function abrirModalResetPassword(userId) {
    setPasswordResetUserId(userId)
    setPasswordResetMode("auto")
    setPasswordResetManual("")
    setPasswordResetResult("")
  }

  function cerrarModalResetPassword() {
    setPasswordResetUserId(null)
    setPasswordResetManual("")
    setPasswordResetResult("")
    setPasswordResetMode("auto")
  }

  async function guardarResetPassword() {
    const usuario = users.find((u) => u.id === passwordResetUserId)
    if (!usuario || !canManageUsers(usuarioActual)) return
    const temporaryPassword = passwordResetMode === "auto" ? generateTemporaryPassword() : passwordResetManual.trim()
    if (!temporaryPassword) {
      alert("Ingresa una contraseña temporal.")
      return
    }
    const passwordHash = await hashPassword(temporaryPassword)
    const evento = crearEventoSeguridad("Acceso actualizado", "Se actualizó la contraseña o permisos del usuario")
    setUsers((actuales) => actuales.map((u) => (
      u.id === usuario.id
        ? {
            ...u,
            password: passwordHash,
            auth: {
              ...getUserAuth(u),
              passwordHash,
              temporaryPassword: "",
              mustChangePassword: true,
              status: getUserAuth(u).status || "active"
            },
            securityEvents: [...(u.securityEvents || []), evento],
            ultimaEdicion: new Date().toLocaleString()
          }
        : u
    )))
    setPasswordResetResult(temporaryPassword)
  }

  async function copiarPasswordTemporal() {
    if (!passwordResetResult) return
    try {
      await navigator.clipboard.writeText(passwordResetResult)
      alert("Contraseña temporal copiada.")
    } catch {
      alert(`Copia manualmente la contraseña temporal: ${passwordResetResult}`)
    }
  }

  function toggleUsuarioActivoSeguro(id) {
    if (!canManageUsers(usuarioActual)) return
    setUsers((actuales) => actuales.map((u) => {
      if (u.id !== id) return u
      const activo = !(u.activo === false || u.estado === "Inactivo")
      const nuevoEstado = activo ? "Inactivo" : "Activo"
      return {
        ...u,
        activo: !activo,
        estado: nuevoEstado,
        auth: { ...getUserAuth(u), status: nuevoEstado === "Activo" ? "active" : "inactive" },
        securityEvents: [...(u.securityEvents || []), crearEventoSeguridad("Acceso actualizado", `Usuario ${nuevoEstado.toLowerCase()}`)],
        ultimaEdicion: new Date().toLocaleString()
      }
    }))
  }

  function hasRole(roles) {
    if (!usuarioActual) return false
    if (!Array.isArray(roles)) roles = [roles]
    return roles.includes(usuarioActual.rol)
  }

  const puedeVerPOS = hasRole(["Administrador", "Gerente General", "Supervisor", "FOH"])
  const puedeGestionarUsuarios = hasRole(["Administrador", "Gerente General", "Recursos Humanos"])
  const puedeAdministrarAccesos = canManageUsers(usuarioActual)
  const puedeVerModuloRRHH = hasRole(["Administrador", "Gerente General", "Recursos Humanos", "Supervisor", "FOH", "BOH", "Cocina", "Servicio", "Barra", "Cafeteria", "Panaderia", "Reposteria"])
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
    { key: "usuarios", label: "RRHH", icon: "👥", roles: ["Administrador", "Gerente General", "Recursos Humanos", "Supervisor", "FOH", "BOH", "Cocina", "Servicio", "Barra", "Cafeteria", "Panaderia", "Reposteria"] }
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
    usuarios: ["Recursos Humanos", "Gestión del equipo, asistencia, desempeño y documentos"]
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



  const hrVisibleUsers = puedeGestionarUsuarios || hasRole("Supervisor")
    ? users
    : users.filter((user) => user.username === usuarioActual?.username)
  const hrEmployeesBase = hrVisibleUsers
  const hrEmployees = hrEmployeesBase.map((employee) => ({
    ...employee,
    performance: employee.performance || {},
    attendanceRecords: employee.attendanceRecords || [],
    trainingRecords: employee.trainingRecords || [],
    incidentRecords: employee.incidentRecords || [],
    recognitionRecords: employee.recognitionRecords || [],
    moodRecords: employee.moodRecords || [],
    securityEvents: employee.securityEvents || [],
    auth: getUserAuth(employee),
    careerPath: employee.careerPath || { currentLevel: employee.puesto || "", nextLevel: "", progress: 0, requirements: [] }
  }))
  const colaboradorPerfil = hrEmployees.find((user) => user.id === colaboradorPerfilId) || null
  const selectedEmployeeProfile = selectedEmployee ? (hrEmployees.find((user) => user.id === selectedEmployee.id) || selectedEmployee) : colaboradorPerfil
  useEffect(() => {
    if (!focusEmployeeId || seccionActiva !== "usuarios") return
    const employee = hrEmployees.find((item) => item.id === focusEmployeeId)
    if (!employee || colaboradorPerfilId === employee.id) return
    openEmployeeProfile(employee)
    if (editFocusedEmployee) iniciarEdicionPerfilColaborador(employee)
  }, [colaboradorPerfilId, editFocusedEmployee, focusEmployeeId, hrEmployees, seccionActiva])
  const hrAlerts = getHRAlerts(hrEmployees, hrResolvedAlerts)
  const hrOpenAlerts = hrAlerts.filter((alert) => alert.estado !== "resuelta")
  const hrExpiredDocuments = getExpiredDocuments(hrEmployees)
  const hrExpiringDocuments = getDocumentsExpiringSoon(hrEmployees)
  const hrUpcomingBirthdays = getUpcomingBirthdays(hrEmployees)
  const hrMood = getMoodStats(hrEmployees)
  const hrAverageScore = (() => {
    const scores = hrEmployees.map(calculateEmployeeScore).filter((score) => score !== null)
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0
  })()
  const hrDashboardCards = [
    { title: "Colaboradores activos", value: hrEmployees.filter((u) => (u.estado || (u.activo ? "Activo" : "Inactivo")) === "Activo" || u.activo === true).length, icon: "✓", note: "Equipo disponible", tone: "good" },
    { title: "Colaboradores inactivos", value: hrEmployees.filter((u) => (u.estado || "").includes("Inactivo") || u.activo === false).length, icon: "–", note: "Fuera de operación", tone: "muted" },
    { title: "Suspendidos", value: hrEmployees.filter((u) => u.estado === "Suspendido").length, icon: "!", note: "Revisar seguimiento", tone: hrEmployees.some((u) => u.estado === "Suspendido") ? "warning" : "good" },
    { title: "Cumpleaños próximos", value: hrUpcomingBirthdays.length, icon: "◎", note: "Próximos 30 días", tone: hrUpcomingBirthdays.length ? "info" : "good" },
    { title: "Documentos vencidos", value: hrExpiredDocuments.length, icon: "!", note: "Requieren seguimiento inmediato", tone: hrExpiredDocuments.length ? "danger" : "good" },
    { title: "Documentos por vencer", value: hrExpiringDocuments.length, icon: "◷", note: "Vencen dentro de 30 días", tone: hrExpiringDocuments.length ? "warning" : "good" },
    { title: "Tardanzas del mes", value: hrEmployees.reduce((sum, employee) => sum + getMonthlyAttendanceStats(employee).tardanzas, 0), icon: "↘", note: "Marcajes tarde registrados", tone: "warning" },
    { title: "Ausencias del mes", value: hrEmployees.reduce((sum, employee) => sum + getMonthlyAttendanceStats(employee).ausencias, 0), icon: "×", note: "Ausencias registradas", tone: "danger" },
    { title: "Capacitaciones pendientes", value: hrEmployees.reduce((sum, employee) => sum + getTrainingStats(employee).pending, 0), icon: "▣", note: "Pendientes por completar", tone: "warning" },
    { title: "Score promedio", value: `${hrAverageScore}%`, icon: "★", note: "Promedio del equipo", tone: hrAverageScore >= 85 ? "good" : hrAverageScore >= 70 ? "warning" : "danger" }
  ]

  const ordenManualSeleccionada = ordenesCompraManual.find(
    (orden) => orden.id === manualPedidoSeleccionadoId
  )
  const purchaseOrderRole = authenticatedUser?.role || normalizeAccessRole(usuarioActual)
  const puedeCrearOrdenCompra = PURCHASE_ORDER_CREATOR_ROLES.includes(purchaseOrderRole)
  const puedeAprobarOrdenCompra = PURCHASE_ORDER_APPROVER_ROLES.includes(purchaseOrderRole)
  const puedeRecibirOrdenCompra = ["admin", "gerente_general", "encargado_almacen"].includes(purchaseOrderRole)
  const requiereAprobacionOrdenCompra = ["gerente", "encargado_almacen"].includes(purchaseOrderRole)

  useEffect(() => {
    if (initialSeccion !== "ordenes") return
    if (["automatic", "manual", "history"].includes(initialPurchaseOrderView)) {
      setPurchaseOrderView(initialPurchaseOrderView)
    }
    if (!initialPurchaseOrderId) return
    getPurchaseOrders().then(({ data, error }) => {
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
      recepcion: null
    }

    const saveResult = await savePurchaseOrder(nuevaOrden)
    if (saveResult.error) {
      alert("No se pudo guardar la orden en Supabase. Verifica que la migración de órdenes y notificaciones esté aplicada.")
      return
    }
    setOrdenesCompraManual([nuevaOrden, ...ordenesCompraManual])
    limpiarFormularioOrdenManual()
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
    alert("Orden de compra manual creada.")
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

    if (manualRecepcionEstado === "bueno") {
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
      <style>
        {`
          .user-management-list {
            container-type: inline-size;
          }

          .user-management-header,
          .user-management-row {
            grid-template-columns: 56px minmax(260px, 1.55fr) minmax(150px, 0.7fr) minmax(165px, 0.8fr) 132px;
          }

          @media (max-width: 980px) {
            .user-management-header {
              display: none !important;
            }

            .user-management-row {
              grid-template-columns: 56px minmax(0, 1fr) !important;
            }

            .user-management-row > div:nth-child(3),
            .user-management-row > div:nth-child(4),
            .user-management-row > div:nth-child(5) {
              grid-column: 1 / -1;
            }
          }

          @media (max-width: 560px) {
            .user-management-row {
              grid-template-columns: 1fr !important;
            }

            .user-management-photo {
              justify-self: start;
            }
          }
        `}
      </style>
      <header style={appBrandHeaderStyle}>
        <div>
          <div style={appBrandNameStyle}>{BRANDING.logo} {BRANDING.appName}</div>
          <div style={appBrandTaglineStyle}>{BRANDING.tagline}</div>
        </div>
        <div style={moduleHeaderStyle}>
          <h1 style={moduleTitleStyle}>{moduleTitle}</h1>
          <p style={moduleSubtitleStyle}>{moduleSubtitle}</p>
        </div>
      </header>

      {cropImageSrc && (
        <div style={cropModalOverlayStyle}>
          <div style={cropModalStyle}>
            <div style={cropModalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>Recortar foto</h3>
                <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>Ajusta la imagen para el avatar cuadrado.</p>
              </div>
            </div>
            <div style={cropAreaStyle}>
              <Cropper
                image={cropImageSrc}
                crop={crop}
                zoom={cropZoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setCropZoom}
                onCropComplete={onCropComplete}
              />
            </div>
            <div style={cropPreviewRowStyle}>
              <div style={cropPreviewInfoStyle}>
                <span>Vista previa</span>
                <div style={cropPreviewAvatarStyle}>
                  <img src={cropImageSrc} alt="Vista previa sin recortar" style={cropPreviewImageStyle} />
                </div>
              </div>
              <label style={cropZoomLabelStyle}>
                Zoom
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={cropZoom}
                  onChange={(e) => setCropZoom(Number(e.target.value))}
                  style={cropZoomInputStyle}
                />
              </label>
            </div>
            <div style={cropModalActionsStyle}>
              <button type="button" onClick={guardarRecorteFoto} style={buttonStyle}>Guardar recorte</button>
              <button type="button" onClick={cancelarCropFoto} style={cancelButtonStyle}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {passwordResetUserId && (
        <div style={cropModalOverlayStyle}>
          <div style={passwordModalStyle}>
            <div style={cropModalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>Resetear contraseña</h3>
                <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>Esta contraseña temporal solo se mostrará una vez.</p>
              </div>
            </div>
            <div style={passwordModalBodyStyle}>
              <label style={passwordOptionStyle}>
                <input type="radio" checked={passwordResetMode === "auto"} onChange={() => setPasswordResetMode("auto")} />
                Generar contraseña temporal automáticamente
              </label>
              <label style={passwordOptionStyle}>
                <input type="radio" checked={passwordResetMode === "manual"} onChange={() => setPasswordResetMode("manual")} />
                Escribir contraseña manualmente
              </label>
              {passwordResetMode === "manual" && (
                <input type="password" value={passwordResetManual} onChange={(e) => setPasswordResetManual(e.target.value)} placeholder="Nueva contraseña temporal" style={inputStyle} />
              )}
              <label style={passwordOptionStyle}>
                <input type="checkbox" checked readOnly />
                Requerir cambio al iniciar sesión
              </label>
              {passwordResetResult && (
                <div style={temporaryPasswordBoxStyle}>
                  <span>Contraseña temporal</span>
                  <strong>{passwordResetResult}</strong>
                  <p>Mensaje de seguridad: compártela por un canal seguro. Al cerrar este modal no se volverá a mostrar.</p>
                  <button type="button" onClick={copiarPasswordTemporal} style={buttonStyle}>Copiar contraseña temporal</button>
                </div>
              )}
            </div>
            <div style={cropModalActionsStyle}>
              <button type="button" onClick={guardarResetPassword} style={buttonStyle}>Guardar nueva contraseña</button>
              <button type="button" onClick={cerrarModalResetPassword} style={cancelButtonStyle}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {asistenciaRecoveryType && (
        <div style={cropModalOverlayStyle}>
          <form onSubmit={enviarRecuperacionAsistencia} style={attendanceRecoveryModalStyle}>
            <div>
              <h3 style={{ margin: 0 }}>
                {asistenciaRecoveryType === "forgot_username" ? "Recuperar usuario" : "Solicitar reset de contraseña"}
              </h3>
              <p style={{ margin: "6px 0 0", color: "#94a3b8" }}>
                {asistenciaRecoveryType === "forgot_username"
                  ? "Ingresa correo, teléfono o nombre completo."
                  : "Ingresa usuario, correo o teléfono."}
              </p>
            </div>
            <input
              value={asistenciaRecoveryValue}
              onChange={(e) => setAsistenciaRecoveryValue(e.target.value)}
              style={inputStyle}
              placeholder="Dato de recuperación"
            />
            {asistenciaRecoveryMessage && <div style={profileSuccessMessageStyle}>{asistenciaRecoveryMessage}</div>}
            <div style={cropModalActionsStyle}>
              <button type="submit" style={buttonStyle}>Enviar solicitud</button>
              <button type="button" onClick={() => setAsistenciaRecoveryType("")} style={cancelButtonStyle}>Cerrar</button>
            </div>
          </form>
        </div>
      )}

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

      {seccionActiva === "usuarios" && (
        <UsersModule
          usuarioActual={usuarioActual}
          puedeVerModuloRRHH={puedeVerModuloRRHH}
          puedeGestionarUsuarios={puedeGestionarUsuarios}
          puedeVerReportesRRHH={puedeVerReportesRRHH}
          navigate={navigate}
          setSeccionActiva={setSeccionActiva}
          mostrarFormularioColaborador={mostrarFormularioColaborador}
          setMostrarFormularioColaborador={setMostrarFormularioColaborador}
          setMostrarPerfilColaborador={setMostrarPerfilColaborador}
          setPerfilColaboradorEditando={setPerfilColaboradorEditando}
          setMensajePerfilColaborador={setMensajePerfilColaborador}
          setErroresColaborador={setErroresColaborador}
          setSelectedEmployee={setSelectedEmployee}
          editUserId={editUserId}
          userForm={userForm}
          setUserForm={setUserForm}
          erroresColaborador={erroresColaborador}
          documentoTemp={documentoTemp}
          setDocumentoTemp={setDocumentoTemp}
          mostrarPerfilColaborador={mostrarPerfilColaborador}
          currentHRView={currentHRView}
          setCurrentHRView={setCurrentHRView}
          hrEmployees={hrEmployees}
          userSearch={userSearch}
          setUserSearch={setUserSearch}
          hrFilters={hrFilters}
          setHrFilters={setHrFilters}
          hrOpenAlerts={hrOpenAlerts}
          selectedEmployeeProfile={selectedEmployeeProfile}
          perfilColaboradorEditando={perfilColaboradorEditando}
          mensajePerfilColaborador={mensajePerfilColaborador}
          departamentosDisponibles={departamentosDisponibles}
          rolesDisponibles={rolesDisponibles}
          guardarColaboradorValidado={guardarColaboradorValidado}
          limpiarFormularioUsuario={limpiarFormularioUsuario}
          setEditUserId={setEditUserId}
          actualizarCampoColaborador={actualizarCampoColaborador}
          subirFotoColaborador={subirFotoColaborador}
          subirDocumentoColaborador={subirDocumentoColaborador}
          openEmployeeProfile={openEmployeeProfile}
          editarUsuario={editarUsuario}
          toggleUsuarioActivo={toggleUsuarioActivo}
          obtenerTurnosColaborador={obtenerTurnosColaborador}
          renderControlesTurno={renderControlesTurno}
          renderTurnosColaborador={renderTurnosColaborador}
          renderHRDashboard={renderHRDashboard}
          renderHRAlerts={renderHRAlerts}
          renderHRProfile={renderHRProfile}
          renderUserManagementView={renderUserManagementView}
          renderStatusBadge={renderStatusBadge}
          getHRBreadcrumb={getHRBreadcrumb}
          getHRViewTitle={getHRViewTitle}
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
            <>
              <div style={cardStyle}>
                <h2>Áreas operativas</h2>
                <p style={{ margin: "0 0 16px", color: "#94a3b8", lineHeight: 1.5 }}>
                  Estas áreas se usan para inventario, producción, requisiciones y colaboradores. No son zonas físicas del restaurante.
                </p>
                {areasError && <p style={attendanceWarningStyle}>{areasError}</p>}
                <div style={hrFilterGridStyle}>
                  <input value={areaForm.name} onChange={(e) => setAreaForm((actual) => ({ ...actual, name: e.target.value }))} placeholder="Nombre del área" style={inputStyle} />
                  <select value={areaForm.type} onChange={(e) => setAreaForm((actual) => ({ ...actual, type: e.target.value }))} style={inputStyle}>
                    <option value="principal">Principal</option>
                    <option value="operativa">Operativa</option>
                    <option value="produccion">Producción</option>
                    <option value="servicio">Servicio</option>
                    <option value="administrativa">Administrativa</option>
                    <option value="limpieza">Limpieza</option>
                  </select>
                  <select value={areaForm.responsibleUserId} onChange={(e) => setAreaForm((actual) => ({ ...actual, responsibleUserId: e.target.value }))} style={inputStyle}>
                    <option value="">Sin responsable asignado</option>
                    {areaProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>)}
                  </select>
                  <input value={areaForm.description} onChange={(e) => setAreaForm((actual) => ({ ...actual, description: e.target.value }))} placeholder="Descripción" style={inputStyle} />
                </div>
                <div style={areaOptionRowStyle}>
                  <label style={passwordOptionStyle}><input type="checkbox" checked={areaForm.canRequestInventory} onChange={(e) => setAreaForm((actual) => ({ ...actual, canRequestInventory: e.target.checked }))} /> Puede hacer requisiciones</label>
                  <label style={passwordOptionStyle}><input type="checkbox" checked={areaForm.isProductionArea} onChange={(e) => setAreaForm((actual) => ({ ...actual, isProductionArea: e.target.checked }))} /> Área de producción</label>
                  <label style={passwordOptionStyle}><input type="checkbox" checked={areaForm.active} onChange={(e) => setAreaForm((actual) => ({ ...actual, active: e.target.checked }))} /> Área activa</label>
                </div>
                <div style={buttonRowStyle}>
                  <button type="button" onClick={guardarArea} style={buttonStyle}>{editingAreaId ? "Guardar área" : "Crear área"}</button>
                  <button type="button" onClick={cargarAreasSupabase} style={cancelButtonStyle}>Actualizar lista</button>
                  {editingAreaId && <button type="button" onClick={() => { setEditingAreaId(""); setAreaForm({ id: "", name: "", type: "operativa", description: "", responsibleUserId: "", canRequestInventory: true, isProductionArea: false, active: true }) }} style={cancelButtonStyle}>Cancelar</button>}
                </div>
              </div>
              <div style={cardStyle}>
                <h2>Áreas operativas registradas</h2>
                {areasLoading && <p>Cargando áreas desde Supabase...</p>}
                <div style={registeredAreasGridStyle}>
                  {areas.map((area) => (
                    <div key={area.id} style={registeredAreaCardStyle}>
                      <div style={registeredAreaContentStyle}>
                        <h3 style={registeredAreaTitleStyle}>{area.name}</h3>
                        <p><strong>Tipo:</strong> {area.type}</p>
                        <p><strong>Estado:</strong> {area.active ? "Activa" : "Inactiva"}</p>
                        <p><strong>Requisiciones:</strong> {area.canRequestInventory ? "Permitidas" : "No permitidas"}</p>
                        <p><strong>Producción:</strong> {area.isProductionArea ? "Sí" : "No"}</p>
                        <p><strong>Responsable:</strong> {areaProfiles.find((profile) => profile.id === area.responsibleUserId)?.full_name || "Sin asignar"}</p>
                      </div>
                      <div style={registeredAreaActionsStyle}>
                        <button type="button" onClick={() => editarArea(area)} style={registeredAreaEditButtonStyle}>Editar</button>
                        <button type="button" onClick={() => window.location.assign(`/inventory?section=inventarioAreas&area=${encodeURIComponent(area.id)}`)} style={registeredAreaInventoryButtonStyle}>Ver inventario</button>
                        {area.id !== "almacen" && area.active && <button type="button" onClick={() => desactivarArea(area)} style={registeredAreaDeactivateButtonStyle}>Desactivar</button>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
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


const profileShellStyle = {
  marginTop: "20px",
  borderRadius: "16px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  overflow: "hidden"
}

const profileSuccessMessageStyle = {
  margin: "16px 16px 0",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #34d399",
  backgroundColor: "#064e3b",
  color: "#d1fae5",
  fontWeight: 700
}

const profileEditFormStyle = {
  display: "block"
}

const cropModalOverlayStyle = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "18px",
  backgroundColor: "rgba(2, 6, 23, 0.78)",
  backdropFilter: "blur(4px)"
}

const cropModalStyle = {
  width: "min(92vw, 640px)",
  borderRadius: "14px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  color: "#e5e7eb",
  boxShadow: "0 24px 70px rgba(0, 0, 0, 0.45)",
  overflow: "hidden"
}

const cropModalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
  padding: "16px",
  borderBottom: "1px solid #1f2937"
}

const cropAreaStyle = {
  position: "relative",
  height: "360px",
  backgroundColor: "#020617"
}

const cropPreviewRowStyle = {
  display: "grid",
  gridTemplateColumns: "auto 1fr",
  gap: "16px",
  alignItems: "center",
  padding: "14px 16px",
  borderTop: "1px solid #1f2937"
}

const cropPreviewInfoStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  color: "#cbd5e1",
  fontWeight: 700
}

const cropPreviewAvatarStyle = {
  width: "56px",
  height: "56px",
  borderRadius: "999px",
  overflow: "hidden",
  border: "2px solid #67e8f9",
  backgroundColor: "#111827"
}

const cropPreviewImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
}

const cropZoomLabelStyle = {
  display: "grid",
  gap: "6px",
  color: "#cbd5e1",
  fontWeight: 700,
  fontSize: "0.9rem"
}

const cropZoomInputStyle = {
  width: "100%",
  accentColor: "#0ea5a4"
}

const cropModalActionsStyle = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "10px",
  flexWrap: "wrap",
  padding: "16px",
  borderTop: "1px solid #1f2937"
}

const passwordModalStyle = {
  ...cropModalStyle,
  width: "min(92vw, 560px)"
}

const passwordModalBodyStyle = {
  display: "grid",
  gap: "12px",
  padding: "16px"
}

const passwordOptionStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  color: "#e5e7eb",
  fontWeight: 700
}

const temporaryPasswordBoxStyle = {
  display: "grid",
  gap: "8px",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #f59e0b",
  backgroundColor: "#422006",
  color: "#fef3c7"
}

const profileHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "18px",
  padding: "22px",
  background: "linear-gradient(135deg, #0f766e, #1e293b)",
  flexWrap: "wrap"
}

const profilePhotoPanelStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "12px",
  minWidth: "180px"
}

const profileAvatarStyle = {
  width: "156px",
  height: "156px",
  borderRadius: "999px",
  objectFit: "cover",
  border: "4px solid #e2e8f0",
  boxShadow: "0 18px 38px rgba(15, 23, 42, 0.45)"
}

const profileAvatarPlaceholderStyle = {
  ...profileAvatarStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#1f2937",
  color: "#e2e8f0",
  fontSize: "46px",
  fontWeight: 800,
  letterSpacing: "0"
}

const profilePhotoActionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  justifyContent: "center"
}

const profilePhotoButtonStyle = {
  padding: "9px 12px",
  borderRadius: "999px",
  border: "1px solid #67e8f9",
  backgroundColor: "#155e75",
  color: "#ecfeff",
  fontWeight: 700,
  cursor: "pointer"
}

const profilePhotoDeleteButtonStyle = {
  ...profilePhotoButtonStyle,
  borderColor: "#fca5a5",
  backgroundColor: "#7f1d1d",
  color: "#fee2e2"
}

const profileUsernameRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  margin: "8px 0 12px"
}

const profileUsernameBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "28px",
  padding: "4px 10px",
  borderRadius: "7px",
  border: "1px solid #67e8f9",
  backgroundColor: "#083344",
  color: "#cffafe",
  fontSize: "0.88rem",
  fontWeight: 900
}

const profileCopyUsernameButtonStyle = {
  minHeight: "28px",
  padding: "4px 10px",
  borderRadius: "7px",
  border: "1px solid #334155",
  backgroundColor: "#111827",
  color: "#e5e7eb",
  fontSize: "0.78rem",
  fontWeight: 800,
  cursor: "pointer"
}

const collaboratorListAvatarStyle = {
  width: "54px",
  height: "54px",
  borderRadius: "999px",
  objectFit: "cover",
  border: "2px solid #334155",
  backgroundColor: "#111827",
  flexShrink: 0
}

const collaboratorListAvatarPlaceholderStyle = {
  ...collaboratorListAvatarStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#e2e8f0",
  fontWeight: 800,
  backgroundColor: "#334155"
}

const profileGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "14px",
  padding: "16px"
}

const profileCardStyle = {
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#111827"
}

const attendanceGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  gap: "14px"
}

const attendanceCardStyle = {
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const attendanceLoginCardStyle = {
  display: "grid",
  gap: "10px",
  maxWidth: "460px",
  padding: "18px",
  borderRadius: "14px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const attendanceTerminalSelectorStyle = {
  display: "grid",
  gap: "18px",
  padding: "20px",
  borderRadius: "16px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const attendanceEmployeeGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
  gap: "12px"
}

const attendanceTerminalDeviceStyle = {
  margin: 0,
  padding: "10px 12px",
  borderRadius: "9px",
  border: "1px solid #253449",
  backgroundColor: "#111c2d",
  color: "#94a3b8",
  fontSize: "12px",
  overflowWrap: "anywhere"
}

const attendanceEmployeeButtonStyle = {
  display: "grid",
  justifyItems: "center",
  gap: "8px",
  minHeight: "158px",
  padding: "14px",
  border: "1px solid #334155",
  borderRadius: "13px",
  backgroundColor: "#111c2d",
  color: "#e2e8f0",
  cursor: "pointer",
  textAlign: "center"
}

const attendanceEmployeeAvatarStyle = {
  width: "72px",
  height: "72px",
  objectFit: "cover",
  borderRadius: "50%",
  border: "2px solid #14b8a6"
}

const attendanceEmployeeAvatarPlaceholderStyle = {
  ...attendanceEmployeeAvatarStyle,
  display: "grid",
  placeContent: "center",
  backgroundColor: "#134e4a",
  color: "#99f6e4",
  fontWeight: 700
}

const attendancePinBoxStyle = {
  maxWidth: "360px",
  margin: "16px",
  padding: "14px",
  borderRadius: "11px",
  backgroundColor: "#111c2d",
  border: "1px solid #253449"
}

const attendanceRecoveryLinksStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap",
  marginTop: "2px"
}

const attendanceRecoveryLinkStyle = {
  border: "none",
  backgroundColor: "transparent",
  color: "#67e8f9",
  cursor: "pointer",
  padding: 0,
  fontWeight: 800,
  fontSize: "0.88rem"
}

const attendanceRecoveryModalStyle = {
  ...passwordModalStyle,
  display: "grid",
  gap: "14px",
  padding: "18px"
}

const attendanceMiniProfileStyle = {
  borderRadius: "16px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  overflow: "hidden"
}

const attendanceCameraBoxStyle = {
  display: "grid",
  gap: "12px",
  padding: "0 16px 16px"
}

const attendanceCameraPreviewStyle = {
  position: "relative",
  overflow: "hidden",
  borderRadius: "12px"
}

const attendanceCountdownStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeContent: "center",
  gap: "8px",
  backgroundColor: "rgba(2, 6, 23, .42)",
  color: "#f8fafc",
  textAlign: "center"
}

const attendanceCountdownNumberStyle = {
  fontSize: "4rem"
}

const attendanceSavingOverlayStyle = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeContent: "center",
  backgroundColor: "rgba(2, 6, 23, .7)",
  color: "#99f6e4",
  fontWeight: 700
}

const attendanceAutoCaptureTextStyle = {
  flex: 1,
  color: "#99f6e4",
  fontSize: "13px",
  alignSelf: "center"
}

const attendanceWarningStyle = {
  marginTop: "12px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #f59e0b",
  backgroundColor: "#422006",
  color: "#fef3c7"
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "10px",
  borderRadius: "8px",
  border: "none"
}

const inputErrorStyle = {
  ...inputStyle,
  border: "1px solid #f87171",
  boxShadow: "0 0 0 3px rgba(248, 113, 113, 0.18)",
  marginBottom: "4px"
}

const fieldErrorStyle = {
  color: "#fca5a5",
  fontSize: "0.85rem",
  margin: "0 0 10px"
}

const appBrandHeaderStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(240px, 0.8fr) minmax(260px, 1.2fr)",
  gap: "18px",
  alignItems: "end",
  marginBottom: "18px",
  padding: "18px",
  borderRadius: "14px",
  border: "1px solid #263244",
  backgroundColor: "#0f172a",
  boxShadow: "0 18px 48px rgba(2, 6, 23, 0.22)"
}

const appBrandNameStyle = {
  color: "#f8fafc",
  fontSize: "1.45rem",
  fontWeight: 900,
  lineHeight: 1.1
}

const appBrandTaglineStyle = {
  color: "#94a3b8",
  marginTop: "6px",
  fontSize: "0.92rem"
}

const moduleHeaderStyle = {
  display: "grid",
  gap: "4px",
  justifyItems: "end",
  textAlign: "right"
}

const moduleTitleStyle = {
  margin: 0,
  color: "#f8fafc",
  fontSize: "1.6rem"
}

const moduleSubtitleStyle = {
  margin: 0,
  color: "#cbd5e1",
  fontSize: "0.95rem"
}

const scheduleEditorStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 0.8fr) repeat(2, minmax(230px, 1.2fr)) minmax(190px, 0.9fr) minmax(160px, auto)",
  gap: "12px",
  alignItems: "end",
  marginBottom: "12px",
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0b1220"
}

const scheduleGroupStyle = {
  display: "grid",
  gap: "8px"
}

const scheduleGroupTitleStyle = {
  color: "#e5e7eb",
  fontWeight: 700,
  fontSize: "0.9rem"
}

const scheduleSelectRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr",
  gap: "8px"
}

const scheduleSelectLabelStyle = {
  display: "grid",
  gap: "4px",
  color: "#94a3b8",
  fontSize: "0.75rem",
  fontWeight: 700
}

const scheduleSelectStyle = {
  ...inputStyle,
  marginBottom: 0,
  padding: "10px",
  backgroundColor: "#111827",
  border: "1px solid #334155",
  color: "#e5e7eb"
}

const scheduleMidnightToggleStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  minHeight: "42px",
  padding: "9px 10px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#111827",
  color: "#cbd5e1",
  fontSize: "0.82rem",
  fontWeight: 800,
  cursor: "pointer"
}

const scheduleAddButtonStyle = {
  minHeight: "42px",
  padding: "10px 14px",
  borderRadius: "8px",
  border: "1px solid #34d399",
  backgroundColor: "#15803d",
  color: "#ecfdf5",
  fontWeight: 900,
  cursor: "pointer",
  whiteSpace: "nowrap"
}

const scheduleTableStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "12px",
  overflowX: "auto"
}

const scheduleTableHeaderStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 0.8fr 0.8fr",
  gap: "10px",
  minWidth: "680px",
  padding: "8px 10px",
  borderRadius: "8px",
  backgroundColor: "#111827",
  color: "#94a3b8",
  fontSize: "0.72rem",
  fontWeight: 900,
  textTransform: "uppercase"
}

const scheduleTableRowStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr 1fr 0.8fr 0.8fr",
  gap: "10px",
  alignItems: "center",
  minWidth: "680px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0f1724",
  color: "#e5e7eb"
}

const scheduleDayBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  width: "fit-content",
  minHeight: "24px",
  padding: "3px 8px",
  borderRadius: "7px",
  border: "1px solid #0f766e",
  backgroundColor: "#134e4a",
  color: "#ccfbf1",
  fontSize: "0.76rem",
  fontWeight: 900,
  whiteSpace: "nowrap"
}

const scheduleProfileGroupListStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "10px"
}

const scheduleProfileDayStyle = {
  display: "grid",
  gap: "8px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0b1220"
}

const scheduleProfileTimesStyle = {
  margin: 0,
  paddingLeft: "20px",
  color: "#e5e7eb",
  lineHeight: 1.7
}

const scheduleDeleteButtonStyle = {
  background: "#7f1d1d",
  color: "#fee2e2",
  border: "1px solid #fca5a5",
  padding: "5px 9px",
  borderRadius: "6px",
  cursor: "pointer",
  fontWeight: 700
}

const scheduleEmptyStyle = {
  color: "#94a3b8",
  margin: "10px 0 0"
}

const hrSectionStackStyle = {
  display: "grid",
  gap: "14px"
}

const hrDashboardGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "12px"
}

const hrMetricCardStyle = {
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const hrMetricTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "10px"
}

const hrMetricIconStyle = {
  width: "34px",
  height: "34px",
  borderRadius: "999px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontWeight: 900
}

const hrMetricTitleStyle = {
  margin: "12px 0 8px",
  color: "#cbd5e1",
  fontSize: "0.92rem"
}

const hrMetricValueStyle = {
  color: "#f8fafc",
  fontSize: "2rem",
  fontWeight: 900
}

const hrMetricNoteStyle = {
  margin: "6px 0 0",
  color: "#94a3b8",
  fontSize: "0.85rem"
}

const hrBadgeStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "fit-content",
  minHeight: "24px",
  padding: "3px 8px",
  borderRadius: "7px",
  border: "1px solid #64748b",
  fontSize: "0.72rem",
  fontWeight: 800,
  lineHeight: 1,
  whiteSpace: "nowrap"
}

const hrTwoColumnStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "14px"
}

const hrAlertListStyle = {
  display: "grid",
  gap: "10px"
}

const hrAlertItemStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0b1220",
  flexWrap: "wrap"
}

const hrAlertActionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap"
}

const hrMoodScoreStyle = {
  color: "#f8fafc",
  fontSize: "2.4rem",
  fontWeight: 900,
  margin: "8px 0"
}

const hrMutedTextStyle = {
  color: "#94a3b8"
}

const hrMutedParagraphStyle = {
  color: "#94a3b8",
  margin: "4px 0"
}

const hrFilterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: "10px"
}

const hrTabBarStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  marginBottom: "4px"
}

const hrContextHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "14px 16px",
  borderRadius: "10px",
  border: "1px solid #263244",
  backgroundColor: "#0b1220"
}

const hrBreadcrumbStyle = {
  color: "#94a3b8",
  fontSize: "0.82rem",
  marginBottom: "5px"
}

const hrContextTitleStyle = {
  margin: 0,
  color: "#f8fafc",
  fontSize: "1.35rem"
}

const employeeProfileBackBarStyle = {
  padding: "14px 16px 0",
  backgroundColor: "#0f172a"
}

const employeeBackButtonStyle = {
  width: "auto",
  minWidth: "180px",
  height: "32px",
  padding: "0 12px",
  borderRadius: "7px",
  border: "1px solid #334155",
  backgroundColor: "#111827",
  color: "#e5e7eb",
  fontWeight: 800,
  fontSize: "0.8rem",
  cursor: "pointer",
  lineHeight: 1
}

const hrMiniGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "12px"
}

const hrDocumentCardStyle = {
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#111827"
}

const hrDocumentHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  alignItems: "center",
  marginBottom: "8px"
}

const hrProgressItemStyle = {
  display: "grid",
  gap: "7px",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0f1724"
}

const hrProgressHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  color: "#e5e7eb"
}

const hrProgressTrackStyle = {
  height: "9px",
  borderRadius: "999px",
  overflow: "hidden",
  backgroundColor: "#1f2937"
}

const hrProgressFillStyle = {
  height: "100%",
  borderRadius: "999px"
}

const hrScorePanelStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "14px",
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0b1220",
  flexWrap: "wrap"
}

const hrScoreValueStyle = {
  color: "#f8fafc",
  fontSize: "2rem",
  fontWeight: 900
}

const hrStatCardStyle = {
  display: "grid",
  gap: "4px",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#0f1724",
  color: "#cbd5e1"
}

const hrTableLikeStyle = {
  display: "grid",
  gap: "8px"
}

const hrRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0b1220",
  flexWrap: "wrap"
}

const hrTimelineStyle = {
  display: "grid",
  gap: "10px"
}

const hrTimelineItemStyle = {
  position: "relative",
  padding: "12px 12px 12px 28px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0b1220"
}

const hrTimelineDotStyle = {
  position: "absolute",
  left: "10px",
  top: "17px",
  width: "8px",
  height: "8px",
  borderRadius: "999px",
  backgroundColor: "#38bdf8"
}

const userManagementTableStyle = {
  display: "grid",
  gap: "8px"
}

const userManagementHeaderStyle = {
  display: "grid",
  gap: "14px",
  alignItems: "center",
  padding: "8px 14px",
  borderRadius: "8px",
  backgroundColor: "#0b1220",
  color: "#94a3b8",
  fontSize: "0.72rem",
  fontWeight: 900,
  letterSpacing: "0",
  textTransform: "uppercase"
}

const userManagementRowStyle = {
  display: "grid",
  gap: "14px",
  alignItems: "center",
  minHeight: "82px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #243044",
  backgroundColor: "#0f1724",
  color: "#e5e7eb",
  boxShadow: "0 10px 26px rgba(2, 6, 23, 0.16)"
}

const userManagementAvatarStyle = {
  width: "48px",
  height: "48px",
  borderRadius: "999px",
  objectFit: "cover",
  border: "2px solid #334155"
}

const userManagementAvatarPlaceholderStyle = {
  ...userManagementAvatarStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#334155",
  color: "#e2e8f0",
  fontWeight: 900
}

const userManagementActionsStyle = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: "6px",
  justifySelf: "stretch"
}

const accessRequestRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 1fr) minmax(160px, auto) minmax(260px, auto)",
  gap: "12px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #263244",
  backgroundColor: "#0b1220"
}

const accessRequestActionsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(110px, 1fr))",
  gap: "6px"
}

const userManagementInfoStyle = {
  display: "grid",
  gap: "3px",
  minWidth: 0
}

const userManagementNameStyle = {
  color: "#f8fafc",
  fontSize: "0.98rem",
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const userManagementMetaStyle = {
  color: "#cbd5e1",
  fontSize: "0.82rem",
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const userManagementUsernameStyle = {
  color: "#7dd3fc",
  fontSize: "0.76rem",
  lineHeight: 1.25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const userManagementBadgeStackStyle = {
  display: "flex",
  alignItems: "center",
  gap: "6px",
  flexWrap: "wrap"
}

const userManagementAccessStyle = {
  display: "grid",
  gap: "4px",
  alignContent: "center",
  minWidth: 0
}

const userManagementAccessHintStyle = {
  color: "#94a3b8",
  fontSize: "0.74rem",
  lineHeight: 1.15,
  whiteSpace: "nowrap"
}

const userManagementAccessDateStyle = {
  color: "#cbd5e1",
  fontSize: "0.78rem",
  lineHeight: 1.2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const userActionBaseButtonStyle = {
  width: "100%",
  minWidth: "112px",
  height: "30px",
  padding: "0 10px",
  borderRadius: "7px",
  border: "1px solid #334155",
  color: "#e5e7eb",
  fontWeight: 800,
  fontSize: "0.76rem",
  cursor: "pointer",
  lineHeight: 1,
  whiteSpace: "nowrap"
}

const userActionPrimaryButtonStyle = {
  ...userActionBaseButtonStyle,
  borderColor: "#2dd4bf",
  backgroundColor: "#0f766e",
  color: "#ecfeff"
}

const userActionSecondaryButtonStyle = {
  ...userActionBaseButtonStyle,
  backgroundColor: "#111827"
}

const userActionDangerButtonStyle = {
  ...userActionBaseButtonStyle,
  borderColor: "#fca5a5",
  backgroundColor: "#7f1d1d",
  color: "#fee2e2"
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

const registeredAreasGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))",
  gap: "14px",
  marginTop: "16px"
}

const registeredAreaCardStyle = {
  display: "flex",
  flexDirection: "column",
  minHeight: "292px",
  padding: "18px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  boxShadow: "0 5px 14px rgba(2, 6, 23, 0.2)"
}

const registeredAreaContentStyle = {
  display: "grid",
  gap: "8px",
  flex: 1
}

const registeredAreaTitleStyle = {
  margin: "0 0 6px",
  fontSize: "18px",
  color: "#f8fafc"
}

const registeredAreaActionsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "8px",
  paddingTop: "16px",
  marginTop: "12px",
  borderTop: "1px solid #1e293b"
}

const registeredAreaButtonBaseStyle = {
  minHeight: "44px",
  padding: "10px 12px",
  border: "1px solid transparent",
  borderRadius: "9px",
  color: "#ffffff",
  fontWeight: 700,
  cursor: "pointer",
  lineHeight: 1.25
}

const registeredAreaEditButtonStyle = {
  ...registeredAreaButtonBaseStyle,
  backgroundColor: "#b45309",
  borderColor: "#d97706"
}

const registeredAreaInventoryButtonStyle = {
  ...registeredAreaButtonBaseStyle,
  backgroundColor: "#0f766e",
  borderColor: "#14b8a6"
}

const registeredAreaDeactivateButtonStyle = {
  ...registeredAreaButtonBaseStyle,
  gridColumn: "1 / -1",
  backgroundColor: "#991b1b",
  borderColor: "#dc2626"
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

const areaOptionRowStyle = {
  display: "flex",
  gap: "18px",
  flexWrap: "wrap",
  margin: "14px 0"
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
