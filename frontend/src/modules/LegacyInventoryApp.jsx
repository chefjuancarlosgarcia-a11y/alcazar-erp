import { useState, useEffect, useCallback, useRef } from "react"
import Cropper from "react-easy-crop"
import "react-easy-crop/react-easy-crop.css"
import { BrowserMultiFormatReader } from "@zxing/browser"
import * as XLSX from "xlsx"
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
import {
  createArea as createSupabaseArea,
  deactivateArea as deactivateSupabaseArea,
  getAreas as getSupabaseAreas,
  updateArea as updateSupabaseArea
} from "../services/areasService"
import {
  generarId,
  generarCodigo,
  generarCodigoProveedor,
  generarNumeroOrdenManual,
  calcularTotales,
  limpiarNumero,
  obtenerMetodoPagoPreferido
} from "../utils"
import { normalizeProductionArea } from "../utils/posProduction"

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

function getInventoryStatus(item) {
  const normalized = normalizeInventoryItem(item || {})
  const almacen = getLocationStock(normalized, "almacen")
  const minAlmacen = getLocationMinimum(item, "almacen")

  if (getInventoryTotalStock(normalized) <= 0) return "Agotado"
  if (almacen <= minAlmacen && minAlmacen > 0) return "Bajo en almacén"
  const lowArea = Object.keys(normalized.stockByLocation).find((location) => location !== "almacen" && getLocationMinimum(normalized, location) > 0 && getLocationStock(normalized, location) <= getLocationMinimum(normalized, location))
  if (lowArea) return "Bajo en área"
  return "OK"
}

function getInventoryStatusForLocation(item, location) {
  const stock = getLocationStock(item, location)
  const minimum = getLocationMinimum(item, location)
  if (stock <= 0) return "Agotado"
  if (minimum > 0 && stock <= minimum) return "Bajo"
  return "OK"
}

function getRequisitionItems(requisition) {
  const items = Array.isArray(requisition?.items)
    ? requisition.items
    : [{
        itemId: requisition?.ingredienteId,
        ingredienteId: requisition?.ingredienteId,
        itemName: requisition?.ingredienteNombre,
        ingredienteNombre: requisition?.ingredienteNombre,
        unit: requisition?.unidad,
        unidad: requisition?.unidad,
        requestedQty: requisition?.cantidadSolicitada,
        cantidadSolicitada: requisition?.cantidadSolicitada,
        approvedQty: requisition?.cantidadSolicitada
      }]

  return items.map((item) => ({
    ...item,
    itemId: item.itemId ?? item.ingredienteId ?? item.id,
    itemName: item.itemName ?? item.ingredienteNombre ?? item.nombre,
    unit: item.unit ?? item.unidad ?? item.unidadCompra,
    requestedQty: Number(item.requestedQty ?? item.cantidadSolicitada ?? 0),
    approvedQty: Number(item.approvedQty ?? item.cantidadAprobada ?? item.requestedQty ?? item.cantidadSolicitada ?? 0),
    notes: item.notes ?? item.notas ?? ""
  }))
}

function normalizeRequisition(requisition) {
  const statusMap = {
    pendiente: "pending",
    aceptada: "completed",
    rechazada: "rejected",
    cancelada: "cancelled",
    aprobada: "approved",
    borrador: "draft"
  }
  const status = statusMap[requisition?.status] || requisition?.status || "pending"
  const items = getRequisitionItems(requisition)

  return {
    ...requisition,
    requestedBy: requisition?.requestedBy || requisition?.usuario || requisition?.username || "",
    approvedBy: requisition?.approvedBy || requisition?.aprobadoPor || requisition?.aceptadoPor || "",
    fromLocation: requisition?.fromLocation || "almacen",
    toLocation: requisition?.toLocation || "cocina",
    status,
    items,
    createdAt: requisition?.createdAt || requisition?.creado || new Date().toISOString(),
    completedAt: requisition?.completedAt || requisition?.descargadoEn || (status === "completed" ? requisition?.aceptadoEn : "")
  }
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
  const { user: authenticatedUser } = useAuth()
  const [busqueda, setBusqueda] = useState("")
  const [mostrarSugerenciasIngredientes, setMostrarSugerenciasIngredientes] = useState(false)
  const [ingredienteResaltadoId, setIngredienteResaltadoId] = useState(null)
  const buscadorIngredientesRef = useRef(null)
  const barcodeVideoRef = useRef(null)
  const barcodeControlsRef = useRef(null)
  const asistenciaVideoRef = useRef(null)
  const asistenciaCanvasRef = useRef(null)
  const asistenciaStreamRef = useRef(null)
  const [barcodeSearch, setBarcodeSearch] = useState("")
  const [barcodeScannerActive, setBarcodeScannerActive] = useState(false)
  const [barcodeMessage, setBarcodeMessage] = useState("")
  const [barcodeFoundIngredient, setBarcodeFoundIngredient] = useState(null)
  const [barcodeNotFoundCode, setBarcodeNotFoundCode] = useState("")
  const [nombre, setNombre] = useState("")
  const [codigoBarras, setCodigoBarras] = useState("")
  const [categoria, setCategoria] = useState("")
  const [unidadCompra, setUnidadCompra] = useState("lb")
  const [cantidadComprada, setCantidadComprada] = useState("")
  const [unidadesPorEmpaque, setUnidadesPorEmpaque] = useState("")
  const [stockActual, setStockActual] = useState("")
  const [costoUnitario, setCostoUnitario] = useState("")
  const [puntoMinimo, setPuntoMinimo] = useState("")
  const [puntoMinimoCocina, setPuntoMinimoCocina] = useState("")
  const [puntoOrden, setPuntoOrden] = useState("")
  const [puntoMaximo, setPuntoMaximo] = useState("")
  const [motivoEdicion, setMotivoEdicion] = useState("")
  const [imagenIngrediente, setImagenIngrediente] = useState("")
  const [editandoId, setEditandoId] = useState(null)
  const [mostrarFormularioIngrediente, setMostrarFormularioIngrediente] = useState(false)
  const [errorFormularioIngrediente, setErrorFormularioIngrediente] = useState("")
  const [camposIngredienteFaltantes, setCamposIngredienteFaltantes] = useState({})
  const [ingredienteOriginal, setIngredienteOriginal] = useState(null)
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

  const [proveedores, setProveedores] = useState(() => {
    const datos = localStorage.getItem("proveedores")
    return datos ? JSON.parse(datos) : []
  })
  const [proveedorBusqueda, setProveedorBusqueda] = useState("")
  const [proveedorSeleccionadoId, setProveedorSeleccionadoId] = useState(null)
  const [editandoProveedorId, setEditandoProveedorId] = useState(null)
  const [proveedorNombreComercial, setProveedorNombreComercial] = useState("")
  const [proveedorRazonSocial, setProveedorRazonSocial] = useState("")
  const [proveedorNit, setProveedorNit] = useState("")
  const [proveedorTipo, setProveedorTipo] = useState("Lácteos")
  const [proveedorEncargado, setProveedorEncargado] = useState("")
  const [proveedorTelefono, setProveedorTelefono] = useState("")
  const [proveedorWhatsApp, setProveedorWhatsApp] = useState("")
  const [proveedorCorreo, setProveedorCorreo] = useState("")
  const [proveedorDireccion, setProveedorDireccion] = useState("")
  const [proveedorMetodosPago, setProveedorMetodosPago] = useState({
    efectivo: false,
    transferencia: false,
    tarjeta: false,
    cheque: false
  })
  const [proveedorCuentaBancaria, setProveedorCuentaBancaria] = useState("")
  const [proveedorBanco, setProveedorBanco] = useState("")
  const [proveedorDiasEntrega, setProveedorDiasEntrega] = useState({
    lunes: false,
    martes: false,
    miercoles: false,
    jueves: false,
    viernes: false,
    sabado: false,
    domingo: false
  })
  const [proveedorTiempoEntrega, setProveedorTiempoEntrega] = useState("mismo dia")
  const [proveedorEstrellas, setProveedorEstrellas] = useState(3)
  const [proveedorSeleccionadoPrincipalId, setProveedorSeleccionadoPrincipalId] = useState(null)
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
  const [inventoryLocationFilter, setInventoryLocationFilter] = useState("todos")
  const [inventoryMovements, setInventoryMovements] = useState(() => parseStoredArray(INVENTORY_MOVEMENTS_KEY))
  const [inventarioBackupMeta, setInventarioBackupMeta] = useState(() => getInventoryBackupMeta())
  const [inventarioStorageError, setInventarioStorageError] = useState("")

  const [historialCambios, setHistorialCambios] = useState(() => {
    const datos = localStorage.getItem("historialCambios")
    return datos ? JSON.parse(datos) : []
  })

  const [seccionActiva, setSeccionActiva] = useState(() => {
    const datosUsuario = localStorage.getItem("usuarioActual")
    return datosUsuario ? initialSeccion : "inventario"
  })
  const [usuarioActual, setUsuarioActual] = useState(() => {
    const datos = localStorage.getItem("usuarioActual")
    return datos ? JSON.parse(datos) : null
  })

  useEffect(() => {
    setSeccionActiva(initialSeccion)
  }, [initialSeccion])

  useEffect(() => {
    return () => {
      barcodeControlsRef.current?.stop()
      cerrarCamaraAsistencia()
    }
  }, [])

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        buscadorIngredientesRef.current &&
        !buscadorIngredientesRef.current.contains(event.target)
      ) {
        setMostrarSugerenciasIngredientes(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setMostrarSugerenciasIngredientes(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const [usuarioLogin, setUsuarioLogin] = useState("")
  const [contrasenaLogin, setContrasenaLogin] = useState("")

  const [recetas, setRecetas] = useState(() => {
    const datos = localStorage.getItem("recetas")
    return datos ? JSON.parse(datos) : []
  })
  const [recetasSubseccion, setRecetasSubseccion] = useState("agregar")
  const [recetasBusqueda, setRecetasBusqueda] = useState("")
  const [recetasFiltro, setRecetasFiltro] = useState("Todas")

  const [recetaBusquedaIngrediente, setRecetaBusquedaIngrediente] = useState("")
  const [ingredienteRecetaSeleccionado, setIngredienteRecetaSeleccionado] = useState(null)
  const [recetaPasoTexto, setRecetaPasoTexto] = useState("")
  const [recetaForm, setRecetaForm] = useState({
    tipo: "Preparación",
    nombre: "",
    rendimiento: "",
    tiempoPreparacion: "",
    areaEncargada: "Cocina",
    disponibleEnPOS: false,
    categoriaPOS: "extras",
    areaProduccion: "cocina",
    precioVenta: "",
    imagen: "",
    ingredientes: [],
    pasos: []
  })
  const [editandoRecetaId, setEditandoRecetaId] = useState(null)
  const [recetaDetalle, setRecetaDetalle] = useState(null)

  const [requisicionBusqueda, setRequisicionBusqueda] = useState("")
  const [ingredienteSeleccionadoId, setIngredienteSeleccionadoId] = useState(null)
  const [cantidadSolicitada, setCantidadSolicitada] = useState("")
  const [fechaSolicitud, setFechaSolicitud] = useState(() => new Date().toISOString().slice(0, 10))
  const [fechaNecesita, setFechaNecesita] = useState("")
  const [requisicionDestino, setRequisicionDestino] = useState("cocina")
  const [requisicionItems, setRequisicionItems] = useState([])
  const [mostrarFormularioRequisicion, setMostrarFormularioRequisicion] = useState(false)
  const [erroresRequisicion, setErroresRequisicion] = useState({})
  const [requisiciones, setRequisiciones] = useState(() => {
    const datos = localStorage.getItem("requisiciones")
    return datos ? JSON.parse(datos).map(normalizeRequisition) : []
  })
  const [selectedReqId, setSelectedReqId] = useState(null)
  const [notificacionRequisicion, setNotificacionRequisicion] = useState(null)
  const [tipoNotificacion, setTipoNotificacion] = useState("info")
  const [notificaciones, setNotificaciones] = useState([])
  const [mostrarNotificaciones, setMostrarNotificaciones] = useState(false)

  useEffect(() => {
    try {
      const saved = persistInventorySafely(ingredientes)
      setInventarioStorageError(saved ? "" : "Se evitó guardar un inventario vacío para proteger los datos existentes.")
      setInventarioBackupMeta(getInventoryBackupMeta())
    } catch (error) {
      console.error("No se pudo guardar el inventario", error)
      setInventarioStorageError("No se pudo guardar el inventario en este navegador. Descarga un respaldo antes de continuar.")
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
    localStorage.setItem("historialCambios", JSON.stringify(historialCambios))
  }, [historialCambios])

  useEffect(() => {
    localStorage.setItem("requisiciones", JSON.stringify(requisiciones))
  }, [requisiciones])

  useEffect(() => {
    localStorage.setItem("ordenesCompraManual", JSON.stringify(ordenesCompraManual))
  }, [ordenesCompraManual])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    localStorage.setItem("proveedores", JSON.stringify(proveedores))
  }, [proveedores])

  useEffect(() => {
    localStorage.setItem("recetas", JSON.stringify(recetas))
  }, [recetas])

  const usuariosAutorizados = [
    { username: "admin", passwordHash: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918", nombre: "Administrador" },
    { username: "colaborador", passwordHash: "03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4", nombre: "Colaborador autorizado" }
  ]

  const [users, setUsers] = useState(() => {
    const datos = localStorage.getItem("users")
    if (datos) {
      try {
        const parsed = JSON.parse(datos)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      } catch {
        // ignore malformed stored users
      }
    }
    // default admin user if none — Chef Juan Carlos Garcia
    return [
      {
        id: Date.now(),
        nombre: "Chef Juan Carlos Garcia",
        username: "admin",
        correo: "chefjuancarlosgarcia@gmail.com",
        telefono: "",
        puesto: "CEO / Administrador del sistema",
        departamento: "Administración",
        rol: "Administrador",
        password: "9a31944c487c1d730c65ae7915827f5c066450440a39724be7a635d54b7cc89c",
        activo: true,
        creadoEn: new Date().toLocaleString(),
        ultimaEdicion: new Date().toLocaleString(),
        creadoPor: "sistema",
        observaciones: "Cuenta administrador inicial",
        auth: {
          username: "admin",
          passwordHash: "9a31944c487c1d730c65ae7915827f5c066450440a39724be7a635d54b7cc89c",
          temporaryPassword: "",
          mustChangePassword: false,
          lastLogin: null,
          isOnline: false,
          status: "active"
        }
      }
    ]
  })

  useEffect(() => {
    let cancelado = false
    async function recuperarUsuariosLocalhost() {
      if (localStorage.getItem("usersRecoveryAppliedLocalhost5173")) return
      try {
        const respuesta = await fetch("/recovered-users-localhost-5173.json")
        if (!respuesta.ok) return
        const recuperados = await respuesta.json()
        if (!Array.isArray(recuperados) || recuperados.length === 0) return
        const actuales = JSON.parse(localStorage.getItem("users") || "[]")
        if (!Array.isArray(actuales) || actuales.length >= recuperados.length) return
        const confirmar = window.confirm(`Se encontró un respaldo anterior con ${recuperados.length} usuarios. ¿Deseas restaurarlo ahora?`)
        if (!confirmar || cancelado) return
        const clavesRecuperadas = new Set(recuperados.map((usuario) => usuario.username || usuario.id).filter(Boolean))
        const fusionados = [
          ...recuperados,
          ...actuales.filter((usuario) => !clavesRecuperadas.has(usuario.username || usuario.id))
        ]
        localStorage.setItem("users", JSON.stringify(fusionados))
        localStorage.setItem("usersRecoveryAppliedLocalhost5173", "true")
        setUsers(fusionados)
      } catch {
        // Si no existe respaldo local, la app continúa usando los usuarios actuales.
      }
    }
    recuperarUsuariosLocalhost()
    return () => {
      cancelado = true
    }
  }, [])

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
  const [accessRequests, setAccessRequests] = useState(() => {
    try {
      const stored = localStorage.getItem("accessRecoveryRequests")
      const parsed = stored ? JSON.parse(stored) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
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
  const [asistenciaColaboradorId, setAsistenciaColaboradorId] = useState(null)
  const [asistenciaReporteColaboradorId, setAsistenciaReporteColaboradorId] = useState("")
  const [asistenciaLoginUsuario, setAsistenciaLoginUsuario] = useState("")
  const [asistenciaLoginPassword, setAsistenciaLoginPassword] = useState("")
  const [asistenciaLoginError, setAsistenciaLoginError] = useState("")
  const [asistenciaRecoveryType, setAsistenciaRecoveryType] = useState("")
  const [asistenciaRecoveryValue, setAsistenciaRecoveryValue] = useState("")
  const [asistenciaRecoveryMessage, setAsistenciaRecoveryMessage] = useState("")
  const [colaboradorMarcaje, setColaboradorMarcaje] = useState(null)
  const [asistenciaCamaraActiva, setAsistenciaCamaraActiva] = useState(false)
  const [asistenciaTipoPendiente, setAsistenciaTipoPendiente] = useState("")
  const [mensajeAsistencia, setMensajeAsistencia] = useState("")
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
    localStorage.setItem("users", JSON.stringify(users))
  }, [users])

  useEffect(() => {
    localStorage.setItem("accessRecoveryRequests", JSON.stringify(accessRequests))
  }, [accessRequests])

  useEffect(() => {
    localStorage.setItem("asistenciaMovimientos", JSON.stringify(asistenciaMovimientos))
  }, [asistenciaMovimientos])

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

  function obtenerMovimientosColaboradorHoy(colaboradorId) {
    const hoy = obtenerFechaLocal()
    return asistenciaMovimientos
      .filter((movimiento) => movimiento.colaboradorId === colaboradorId && movimiento.fecha === hoy)
      .sort((a, b) => new Date(b.fechaHoraISO) - new Date(a.fechaHoraISO))
  }

  function obtenerUltimoMovimientoEntradaSalida(colaboradorId) {
    return obtenerMovimientosColaboradorHoy(colaboradorId).find((movimiento) =>
      ["entrada", "salida"].includes(movimiento.tipo)
    )
  }

  function obtenerBanoActivo(colaboradorId) {
    const movimientosHoy = obtenerMovimientosColaboradorHoy(colaboradorId)
    return movimientosHoy.find((movimiento) =>
      movimiento.tipo === "bano_inicio" &&
      !movimientosHoy.some((item) => item.tipo === "bano_regreso" && item.banoInicioId === movimiento.id)
    )
  }

  function obtenerConteoBanosHoy(colaboradorId) {
    return obtenerMovimientosColaboradorHoy(colaboradorId).filter((movimiento) => movimiento.tipo === "bano_inicio").length
  }

  function registrarMovimientoAsistencia(colaborador, tipo, extra = {}) {
    const ahora = new Date()
    const turnosColaborador = obtenerTurnosColaborador(colaborador)
    const movimiento = {
      id: `${Date.now()}-${Math.floor(Math.random() * 9999)}`,
      colaboradorId: colaborador.id,
      colaboradorNombre: colaborador.nombre,
      colaboradorUsername: colaborador.username,
      fecha: obtenerFechaLocal(ahora),
      hora: obtenerHoraLocal(ahora),
      fechaHoraISO: ahora.toISOString(),
      tipo,
      estado: "válido",
      registradoPor: usuarioActual ? usuarioActual.username : "sistema",
      turno: turnosColaborador[0] ? formatearTurno(turnosColaborador[0]) : "Sin turno",
      ...extra
    }

    setAsistenciaMovimientos((actuales) => [movimiento, ...actuales])
    return movimiento
  }

  function marcarEntradaSalida(colaborador, fotoMarcaje = "") {
    const ultimo = obtenerUltimoMovimientoEntradaSalida(colaborador.id)

    if (!ultimo || ultimo.tipo === "salida") {
      registrarMovimientoAsistencia(colaborador, "entrada", { fotoMarcaje })
      setMensajeAsistencia(`Entrada registrada para ${colaborador.nombre}.`)
      return
    }

    if (ultimo.tipo === "entrada") {
      registrarMovimientoAsistencia(colaborador, "salida", { fotoMarcaje })
      setMensajeAsistencia(`Salida registrada para ${colaborador.nombre}.`)
    }
  }

  async function autenticarMarcajeAsistencia(event) {
    event.preventDefault()
    setAsistenciaLoginError("")
    setMensajeAsistencia("")
    const usuario = users.find((item) => String(item.username || "").toLowerCase() === asistenciaLoginUsuario.trim().toLowerCase())

    if (!usuario || !(await passwordCoincide(asistenciaLoginPassword, usuario.password))) {
      setAsistenciaLoginError("Usuario o contraseña no coinciden con un colaborador registrado.")
      return
    }

    if (usuario.activo === false || usuario.estado === "Inactivo" || usuario.estado === "Retirado") {
      setAsistenciaLoginError("El colaborador no está activo para registrar marcajes.")
      return
    }

    setColaboradorMarcaje(usuario)
    setAsistenciaColaboradorId(usuario.id)
    setAsistenciaLoginPassword("")
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

  function cerrarSesionMarcajeAsistencia() {
    cerrarCamaraAsistencia()
    setColaboradorMarcaje(null)
    setAsistenciaTipoPendiente("")
    setMensajeAsistencia("")
  }

  async function abrirCamaraAsistencia(tipo) {
    setAsistenciaTipoPendiente(tipo)
    setMensajeAsistencia("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setMensajeAsistencia("Tu navegador no permite usar cámara.")
      return
    }

    try {
      cerrarCamaraAsistencia()
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false })
      asistenciaStreamRef.current = stream
      if (asistenciaVideoRef.current) {
        asistenciaVideoRef.current.srcObject = stream
        asistenciaVideoRef.current.muted = true
        asistenciaVideoRef.current.playsInline = true
        await asistenciaVideoRef.current.play()
      }
      setAsistenciaCamaraActiva(true)
    } catch {
      setMensajeAsistencia("No se pudo abrir la cámara. Revisa permisos del dispositivo.")
      setAsistenciaCamaraActiva(false)
    }
  }

  function cerrarCamaraAsistencia() {
    if (asistenciaStreamRef.current) {
      asistenciaStreamRef.current.getTracks().forEach((track) => track.stop())
      asistenciaStreamRef.current = null
    }
    setAsistenciaCamaraActiva(false)
  }

  function tomarFotoYGuardarMarcaje() {
    if (!colaboradorMarcaje || !asistenciaVideoRef.current || !asistenciaCanvasRef.current || !asistenciaTipoPendiente) return
    const video = asistenciaVideoRef.current
    const canvas = asistenciaCanvasRef.current
    canvas.width = video.videoWidth || 960
    canvas.height = video.videoHeight || 720
    const context = canvas.getContext("2d")
    if (!context) {
      setMensajeAsistencia("No se pudo tomar la foto del marcaje.")
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const fotoMarcaje = canvas.toDataURL("image/jpeg", 0.9)
    marcarEntradaSalida(colaboradorMarcaje, fotoMarcaje)
    cerrarCamaraAsistencia()
    setAsistenciaTipoPendiente("")
  }

  function iniciarBano(colaborador) {
    const activo = obtenerBanoActivo(colaborador.id)
    if (activo) {
      setMensajeAsistencia(`${colaborador.nombre} ya tiene un baño activo.`)
      return
    }

    if (obtenerConteoBanosHoy(colaborador.id) >= 2) {
      setMensajeAsistencia(`${colaborador.nombre} ya utilizó los 2 baños permitidos por turno.`)
      return
    }

    const ultimo = obtenerUltimoMovimientoEntradaSalida(colaborador.id)
    if (!ultimo || ultimo.tipo !== "entrada") {
      setMensajeAsistencia("No se puede iniciar baño sin una entrada activa.")
      return
    }

    registrarMovimientoAsistencia(colaborador, "bano_inicio", { limiteMinutos: 10 })
    setMensajeAsistencia(`Baño iniciado para ${colaborador.nombre}. Tiempo permitido: 10 minutos.`)
  }

  function marcarRegresoBano(colaborador) {
    const activo = obtenerBanoActivo(colaborador.id)
    if (!activo) {
      setMensajeAsistencia("No hay baño activo para este colaborador.")
      return
    }

    const ahora = new Date()
    const duracionMinutos = calcularMinutosEntre(activo.fechaHoraISO, ahora.toISOString())
    registrarMovimientoAsistencia(colaborador, "bano_regreso", {
      banoInicioId: activo.id,
      duracionMinutos,
      excedido: duracionMinutos > 10,
      horaInicioBano: activo.hora
    })
    setMensajeAsistencia(
      duracionMinutos > 10
        ? `Regreso de baño registrado. Duración: ${duracionMinutos} min, excedido.`
        : `Regreso de baño registrado. Duración: ${duracionMinutos} min.`
    )
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

  const puedeGestionarRecetas = hasRole(["Administrador", "Gerente General"])
  const puedeAdministrarAreas = hasRole(["Administrador", "Gerente General"]) || ["admin", "gerente"].includes(authenticatedUser?.role)

  const modulosDisponibles = [
    { key: "inventario", label: "Inventario", icon: "📦", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
    { key: "requisicion", label: "Requisiciones", icon: "📝", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
    { key: "movimientosInventario", label: "Movimientos", icon: "↔", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "Recursos Humanos"] },
    { key: "inventarioAreas", label: "Inventario por áreas", icon: "▦", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
    { key: "areas", label: "Administrar áreas", icon: "⚙", roles: ["Administrador", "Gerente General"] },
    { key: "ordenes", label: "Órdenes de compra", icon: "📋", roles: ["Administrador", "Gerente General", "Gerente", "Encargado de Almacén"] },
    { key: "puntoVenta", label: "Punto de Venta", icon: "💳", roles: ["Administrador", "Gerente General", "Supervisor", "FOH"] },
    { key: "asistencia", label: "Marcaje de asistencia", icon: "📷", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "BOH", "Cocina", "Servicio", "Recursos Humanos"] },
    { key: "reportesAsistencia", label: "Reportes de asistencia", icon: "📊", roles: ["Administrador", "Gerente General", "Recursos Humanos"] },
    { key: "recetas", label: "Recetas Estandarizadas", icon: "📚", roles: ["Administrador", "Gerente General"] },
    { key: "proveedores", label: "Proveedores", icon: "🚚", roles: ["Administrador", "Gerente General", "Supervisor", "Encargado de Cocina", "FOH", "Recursos Humanos"] },
    { key: "usuarios", label: "RRHH", icon: "👥", roles: ["Administrador", "Gerente General", "Recursos Humanos", "Supervisor", "FOH", "BOH", "Cocina", "Servicio", "Barra", "Cafeteria", "Panaderia", "Reposteria"] }
  ]

  const modulosPermitidos = modulosDisponibles.filter((modulo) => hasRole(modulo.roles))
  const moduleContext = {
    dashboard: ["Panel principal", "Resumen de operaciones y accesos del restaurante"],
    inventario: ["Inventario", "Control de ingredientes, stock y abastecimiento"],
    requisicion: ["Requisiciones", "Traslados internos de Almacén hacia áreas operativas"],
    movimientosInventario: ["Movimientos", "Kardex y auditoría de transferencias internas"],
    inventarioAreas: ["Inventario por áreas", "Existencias operativas por ubicación"],
    areas: ["Áreas", "Administración de ubicaciones operativas y responsables"],
    ordenes: ["Órdenes de compra", "Compras, recepción y seguimiento de proveedores"],
    puntoVenta: ["Punto de Venta", "Operación de mesas, comandas y cobros"],
    asistencia: ["Asistencia", "Marcaje, entradas, salidas y control de turno"],
    reportesAsistencia: ["Reportes de asistencia", "Indicadores de puntualidad y presencia del equipo"],
    recetas: ["Recetas estandarizadas", "Preparaciones, costos y producción del restaurante"],
    proveedores: ["Proveedores", "Directorio comercial y productos asociados"],
    usuarios: ["Recursos Humanos", "Gestión del equipo, asistencia, desempeño y documentos"]
  }
  const [moduleTitle, moduleSubtitle] = moduleContext[seccionActiva] || ["Operaciones", BRANDING.tagline]

  useEffect(() => {
    if (!usuarioActual) return
    const seccionValida = modulosDisponibles.some((modulo) => modulo.key === seccionActiva && hasRole(modulo.roles))
    if (!seccionValida) {
      setSeccionActiva("dashboard")
    }
  }, [usuarioActual, seccionActiva])

  const recetasSubseccionVisible = puedeGestionarRecetas ? recetasSubseccion : "biblioteca"

  function seleccionarIngredienteReceta(ingrediente) {
    if (recetaForm.ingredientes.some((item) => item.ingredienteId === ingrediente.id)) {
      alert("Este ingrediente ya está agregado.")
      return
    }
    setIngredienteRecetaSeleccionado({
      ingredienteId: ingrediente.id,
      nombre: ingrediente.nombre || "",
      imagen: ingrediente.imagen || "",
      cantidad: "",
      unidad: "gramos"
    })
    setRecetaBusquedaIngrediente("")
  }

  function agregarIngredienteSeleccionado() {
    if (!ingredienteRecetaSeleccionado) return
    if (!ingredienteRecetaSeleccionado.cantidad.trim()) {
      alert("Ingresa la cantidad antes de agregar el ingrediente.")
      return
    }
    setRecetaForm((s) => ({
      ...s,
      ingredientes: [...s.ingredientes, { ...ingredienteRecetaSeleccionado }]
    }))
    setIngredienteRecetaSeleccionado(null)
    setRecetaBusquedaIngrediente("")
  }

  function eliminarIngredienteReceta(ingredienteId) {
    setRecetaForm((s) => ({
      ...s,
      ingredientes: s.ingredientes.filter((item) => item.ingredienteId !== ingredienteId)
    }))
  }

  function agregarPasoReceta(event) {
    event && event.preventDefault()
    const texto = recetaPasoTexto.trim()
    if (!texto) return
    setRecetaForm((s) => ({
      ...s,
      pasos: [
        ...s.pasos,
        {
          numero: s.pasos.length + 1,
          descripcion: texto
        }
      ]
    }))
    setRecetaPasoTexto("")
  }

  function eliminarPasoReceta(numero) {
    setRecetaForm((s) => ({
      ...s,
      pasos: s.pasos
        .filter((paso) => paso.numero !== numero)
        .map((paso, index) => ({ ...paso, numero: index + 1 }))
    }))
  }

  function limpiarFormularioReceta() {
    setEditandoRecetaId(null)
    setRecetaForm({
      tipo: "Preparación",
      nombre: "",
      rendimiento: "",
      tiempoPreparacion: "",
      areaEncargada: "Cocina",
      disponibleEnPOS: false,
      categoriaPOS: "extras",
      areaProduccion: "cocina",
      precioVenta: "",
      imagen: "",
      ingredientes: [],
      pasos: []
    })
    setRecetaBusquedaIngrediente("")
    setRecetaPasoTexto("")
    setRecetaDetalle(null)
  }

  function subirImagenReceta(event) {
    const archivo = event.target.files[0]
    if (!archivo) return
    if (!archivo.type.startsWith("image/")) {
      alert("Debes subir un archivo de imagen.")
      return
    }
    const lector = new FileReader()
    lector.onload = (e) => {
      setRecetaForm((s) => ({ ...s, imagen: e.target.result }))
    }
    lector.readAsDataURL(archivo)
  }

  function sincronizarRecetaConPOS(receta) {
    const itemsPOS = JSON.parse(localStorage.getItem("posItems") || "[]")
    const existente = itemsPOS.find((item) => String(item.recipeId) === String(receta.id))
    const habilitada = receta.tipo === "Receta Final" && receta.disponibleEnPOS === true
    if (!habilitada) {
      if (existente) {
        localStorage.setItem("posItems", JSON.stringify(itemsPOS.map((item) => (
          String(item.recipeId) === String(receta.id) ? { ...item, estado: "inactivo" } : item
        ))))
      }
      return
    }
    const categoryId = receta.categoriaPOS || "extras"
    const categories = JSON.parse(localStorage.getItem("posCategories") || "[]")
    const category = categories.find((item) => item.id === categoryId)
    const areaProduccion = receta.areaProduccion || category?.productionAreaId || normalizeProductionArea(receta.areaEncargada)
    const producto = {
      ...(existente || {}),
      id: existente?.id || `recipe-pos-${receta.id}`,
      nombre: receta.nombre,
      categoriaId: categoryId,
      categoria: category?.name || categoryId,
      recipeId: receta.id,
      productionAreaId: areaProduccion,
      areaProduccion,
      precio: Number(receta.precioVenta || existente?.precio || 0),
      estado: "activo",
      imagen: receta.imagen || existente?.imagen || "",
      descripcion: existente?.descripcion || `Producto generado desde receta: ${receta.nombre}`,
      tiempoPreparacion: receta.tiempoPreparacion,
      actualizadoEn: new Date().toLocaleString()
    }
    const actualizados = existente
      ? itemsPOS.map((item) => String(item.recipeId) === String(receta.id) ? producto : item)
      : [producto, ...itemsPOS]
    localStorage.setItem("posItems", JSON.stringify(actualizados))
  }

  function guardarReceta(event) {
    event && event.preventDefault()
    if (!recetaForm.nombre.trim() || !recetaForm.rendimiento.trim() || !recetaForm.tiempoPreparacion.trim() || !recetaForm.areaEncargada.trim()) {
      alert("Completa los campos obligatorios.")
      return
    }
    if (recetaForm.ingredientes.length === 0) {
      alert("Debe agregar al menos 1 ingrediente.")
      return
    }
    if (recetaForm.pasos.length === 0) {
      alert("Debe agregar al menos 1 paso.")
      return
    }
    if (recetaForm.tipo === "Receta Final" && recetaForm.disponibleEnPOS && (!recetaForm.categoriaPOS || !recetaForm.areaProduccion || Number(recetaForm.precioVenta) <= 0)) {
      alert("Para publicar en POS selecciona categoría, área de producción y precio de venta.")
      return
    }
    const ahora = new Date().toLocaleString()
    if (editandoRecetaId) {
      const actualizada = {
        ...recetas.find((receta) => receta.id === editandoRecetaId),
        ...recetaForm,
        productionAreaId: recetaForm.areaProduccion || normalizeProductionArea(recetaForm.areaEncargada),
        fechaActualizacion: ahora
      }
      const actualizadas = recetas.map((receta) =>
        receta.id === editandoRecetaId
          ? actualizada
          : receta
      )
      setRecetas(actualizadas)
      sincronizarRecetaConPOS(actualizada)
      alert("Receta actualizada correctamente")
    } else {
      const nueva = {
        ...recetaForm,
        id: generarId(),
        productionAreaId: recetaForm.areaProduccion || normalizeProductionArea(recetaForm.areaEncargada),
        creadoPor: usuarioActual ? usuarioActual.username : "sistema",
        fechaCreacion: ahora,
        fechaActualizacion: ahora
      }
      setRecetas([nueva, ...recetas])
      sincronizarRecetaConPOS(nueva)
      alert("Receta guardada correctamente")
    }
    limpiarFormularioReceta()
    setRecetasSubseccion("biblioteca")
  }

  function verReceta(receta) {
    setRecetaDetalle(receta)
  }

  function editarReceta(receta) {
    if (!puedeGestionarRecetas) return
    setRecetasSubseccion("agregar")
    setEditandoRecetaId(receta.id)
    setRecetaForm({
      tipo: receta.tipo || "Preparación",
      nombre: receta.nombre || "",
      rendimiento: receta.rendimiento || "",
      tiempoPreparacion: receta.tiempoPreparacion || "",
      areaEncargada: receta.areaEncargada || "Cocina",
      disponibleEnPOS: receta.disponibleEnPOS === true,
      categoriaPOS: receta.categoriaPOS || "extras",
      areaProduccion: receta.areaProduccion || receta.productionAreaId || normalizeProductionArea(receta.areaEncargada || "Cocina"),
      precioVenta: receta.precioVenta || "",
      imagen: receta.imagen || "",
      ingredientes: receta.ingredientes || [],
      pasos: receta.pasos || []
    })
    setRecetaBusquedaIngrediente("")
    setRecetaPasoTexto("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function eliminarReceta(id) {
    if (!puedeGestionarRecetas) return
    const confirmar = confirm("¿Estás seguro de que deseas eliminar esta receta? Esta acción no se puede deshacer.")
    if (!confirmar) return
    setRecetas(recetas.filter((receta) => receta.id !== id))
    if (recetaDetalle?.id === id) {
      setRecetaDetalle(null)
    }
  }

  function descargarRecetaPdf(receta) {
    const doc = new jsPDF({ unit: "pt", format: "a4" })
    doc.setFontSize(16)
    doc.text(BRANDING.appName, 40, 50)
    doc.setFontSize(12)
    doc.text("Receta Estandarizada", 40, 72)
    doc.setFontSize(10)
    doc.text(`Nombre: ${receta.nombre}`, 40, 96)
    doc.text(`Tipo: ${receta.tipo}`, 40, 112)
    doc.text(`Rendimiento: ${receta.rendimiento}`, 40, 128)
    doc.text(`Tiempo de preparación: ${receta.tiempoPreparacion}`, 40, 144)
    doc.text(`Área encargada: ${receta.areaEncargada}`, 40, 160)
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 40, 176)

    let contentStart = 198
    if (receta.imagen) {
      try {
        doc.addImage(receta.imagen, "JPEG", 40, 186, 160, 110)
        contentStart = 308
      } catch {
        contentStart = 198
      }
    }

    doc.autoTable({
      head: [["Ingrediente", "Cantidad", "Unidad"]],
      body: receta.ingredientes.map((item) => [item.nombre, item.cantidad || "", item.unidad || ""]),
      startY: contentStart,
      theme: "grid",
      headStyles: { fillColor: "#2563eb", textColor: 255 },
      styles: { fontSize: 9 }
    })

    const afterTableY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 20 : contentStart + 20
    doc.setFontSize(11)
    doc.text("Proceso de preparación", 40, afterTableY)
    receta.pasos.forEach((paso, index) => {
      const yOffset = afterTableY + 14 + index * 12
      doc.text(`${paso.numero}. ${paso.descripcion}`, 40, yOffset)
    })

    doc.save(`receta-estandarizada-${receta.nombre.replace(/\s+/g, "-").toLowerCase()}-${Date.now()}.pdf`)
  }

  const ingredienteSeleccionado = ingredientes.find(
    (ingrediente) => ingrediente.id === ingredienteSeleccionadoId
  )

  const requisicionSeleccionada = requisiciones.find(
    (req) => req.id === selectedReqId
  )

  const requisicionesPendientes = requisiciones.filter(
    (req) => ["pending", "approved"].includes(normalizeRequisition(req).status)
  )

  const proveedorSeleccionado = proveedores.find(
    (proveedor) => proveedor.id === proveedorSeleccionadoId
  )

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
  const colaboradoresFiltrados = hrEmployees.filter((u) => {
    const t = userSearch.toLowerCase()
    const matchesSearch = !t || String(u.nombre || "").toLowerCase().includes(t) || String(u.username || "").toLowerCase().includes(t) || String(u.rol || "").toLowerCase().includes(t) || String(u.departamento || "").toLowerCase().includes(t) || String(u.puesto || "").toLowerCase().includes(t)
    const matchesPuesto = !hrFilters.puesto || String(u.puesto || "").toLowerCase().includes(hrFilters.puesto.toLowerCase())
    const matchesDepartamento = !hrFilters.departamento || String(u.departamento || "") === hrFilters.departamento
    const estadoActual = u.estado || (u.activo ? "Activo" : "Inactivo")
    const matchesEstado = !hrFilters.estado || estadoActual === hrFilters.estado
    const docs = getEmployeeDocuments(u)
    const score = calculateEmployeeScore(u)
    const hasSpecial = !hrFilters.especial ||
      (hrFilters.especial === "docsVencidos" && docs.some((doc) => doc.status === "vencido")) ||
      (hrFilters.especial === "docsPorVencer" && docs.some((doc) => doc.status === "por vencer")) ||
      (hrFilters.especial === "bajoDesempeno" && score !== null && score < 70) ||
      (hrFilters.especial === "cumpleanos" && getUpcomingBirthdays([u]).length > 0) ||
      (hrFilters.especial === "capacitaciones" && getTrainingStats(u).pending > 0)
    return matchesSearch && matchesPuesto && matchesDepartamento && matchesEstado && hasSpecial
  }).sort((a, b) => {
    if (hrFilters.ordenar === "fechaIngreso") return String(a.fechaInicioLabores || "").localeCompare(String(b.fechaInicioLabores || ""))
    if (hrFilters.ordenar === "score") return (calculateEmployeeScore(b) || 0) - (calculateEmployeeScore(a) || 0)
    if (hrFilters.ordenar === "puntualidad") return Number(b.performance?.punctuality || 0) - Number(a.performance?.punctuality || 0)
    if (hrFilters.ordenar === "documentos") return getEmployeeDocuments(b).filter((doc) => doc.status === "vencido").length - getEmployeeDocuments(a).filter((doc) => doc.status === "vencido").length
    if (hrFilters.ordenar === "antiguedad") return new Date(a.fechaInicioLabores || Date.now()) - new Date(b.fechaInicioLabores || Date.now())
    return String(a.nombre || "").localeCompare(String(b.nombre || ""))
  })
  const colaboradorSesion = users.find((u) => u.username === usuarioActual?.username) || null
  const colaboradoresAsistenciaBase = puedeVerReportesRRHH ? users : users.filter((u) => u.id === colaboradorSesion?.id)
  const colaboradoresAsistencia = colaboradoresAsistenciaBase.filter((u) => {
    const texto = asistenciaBusqueda.toLowerCase()
    return !texto || String(u.nombre || "").toLowerCase().includes(texto) || String(u.username || "").toLowerCase().includes(texto) || String(u.departamento || "").toLowerCase().includes(texto) || String(u.puesto || "").toLowerCase().includes(texto)
  })
  const movimientosFechaFiltro = asistenciaMovimientos.filter((movimiento) => movimiento.fecha === asistenciaFechaFiltro)
  const movimientosReportesBase = asistenciaReporteColaboradorId
    ? movimientosFechaFiltro.filter((movimiento) => String(movimiento.colaboradorId) === String(asistenciaReporteColaboradorId))
    : movimientosFechaFiltro
  const movimientosReportes = movimientosReportesBase.filter((movimiento) => {
    const texto = asistenciaBusqueda.toLowerCase()
    return !texto || String(movimiento.colaboradorNombre || "").toLowerCase().includes(texto) || String(movimiento.colaboradorUsername || "").toLowerCase().includes(texto)
  })
  const colaboradoresDentroTurno = users.filter((usuario) => obtenerUltimoMovimientoEntradaSalida(usuario.id)?.tipo === "entrada")
  const colaboradoresSinSalida = colaboradoresDentroTurno
  const entradasDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "entrada")
  const salidasDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "salida")
  const banosDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "bano_inicio")
  const regresosBanoDelDia = movimientosReportes.filter((movimiento) => movimiento.tipo === "bano_regreso")
  const llegadasTarde = entradasDelDia.filter((movimiento) => {
    const colaborador = users.find((usuario) => usuario.id === movimiento.colaboradorId)
    const entradaTurno = obtenerMinutosDesdeHora(obtenerHora24DesdeTurno(obtenerTurnosColaborador(colaborador)[0], "start"))
    const entradaReal = obtenerMinutosDesdeHora(movimiento.hora)
    return entradaTurno !== null && entradaReal !== null && entradaReal > entradaTurno + 5
  })
  const salidasTempranas = salidasDelDia.filter((movimiento) => {
    const colaborador = users.find((usuario) => usuario.id === movimiento.colaboradorId)
    const salidaTurno = obtenerMinutosDesdeHora(obtenerHora24DesdeTurno(obtenerTurnosColaborador(colaborador)[0], "end"))
    const salidaReal = obtenerMinutosDesdeHora(movimiento.hora)
    return salidaTurno !== null && salidaReal !== null && salidaReal < salidaTurno
  })
  const faltasDelDia = users.filter((usuario) =>
    usuario.activo !== false &&
    !entradasDelDia.some((movimiento) => movimiento.colaboradorId === usuario.id)
  )
  const horasTrabajadas = users.map((usuario) => {
    const movimientosUsuario = movimientosFechaFiltro
      .filter((movimiento) => movimiento.colaboradorId === usuario.id && ["entrada", "salida"].includes(movimiento.tipo))
      .sort((a, b) => new Date(a.fechaHoraISO) - new Date(b.fechaHoraISO))
    let totalMinutos = 0
    let entradaAbierta = null
    movimientosUsuario.forEach((movimiento) => {
      if (movimiento.tipo === "entrada") entradaAbierta = movimiento
      if (movimiento.tipo === "salida" && entradaAbierta) {
        totalMinutos += calcularMinutosEntre(entradaAbierta.fechaHoraISO, movimiento.fechaHoraISO)
        entradaAbierta = null
      }
    })
    return { usuario, totalMinutos }
  }).filter((item) => item.totalMinutos > 0)
  const resumenSemanal = asistenciaMovimientos.filter((movimiento) => {
    const fechaMovimiento = new Date(`${movimiento.fecha}T00:00:00`)
    const fechaFiltro = new Date(`${asistenciaFechaFiltro}T00:00:00`)
    const diferenciaDias = Math.floor((fechaFiltro - fechaMovimiento) / 86400000)
    return diferenciaDias >= 0 && diferenciaDias < 7
  })
  const resumenMensual = asistenciaMovimientos.filter((movimiento) =>
    movimiento.fecha.slice(0, 7) === asistenciaFechaFiltro.slice(0, 7)
  )

  const proveedorSeleccionadoPrincipal = proveedores.find(
    (proveedor) => proveedor.id === proveedorSeleccionadoPrincipalId
  )

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

  const manualIngredienteSeleccionado = ingredientes.find(
    (ingrediente) => ingrediente.id === manualIngredienteSeleccionadoId
  )
  const manualProductoCompra = manualIngredienteSeleccionado
    ? getPurchaseProductDetails(manualIngredienteSeleccionado)
    : null
  const manualCantidadCompraNumero = Number(manualCantidadComprar || 0)
  const manualSubtotal = manualProductoCompra
    ? manualCantidadCompraNumero * manualProductoCompra.precioCompra
    : 0
  const manualCantidadBaseTotal = manualProductoCompra
    ? manualCantidadCompraNumero * manualProductoCompra.factorConversion
    : 0

  const nuevasNotificacionesCount = notificaciones.filter((item) => !item.leida).length

  const proveedoresFiltrados = proveedores.filter((proveedor) => {
    const texto = proveedorBusqueda.toLowerCase()
    return (
      String(proveedor.nombreComercial || "").toLowerCase().includes(texto) ||
      String(proveedor.razonSocial || "").toLowerCase().includes(texto) ||
      String(proveedor.codigo || "").toLowerCase().includes(texto)
    )
  })

  const productosProveedorSeleccionado = proveedorSeleccionadoPrincipal
    ? ingredientes.filter((ingrediente) => ingrediente.proveedorId === proveedorSeleccionadoPrincipal.id)
    : []

  const textoBusquedaRequisicion = String(requisicionBusqueda || "").trim().toLowerCase()

  const ingredientesSugeridos = textoBusquedaRequisicion
    ? ingredientes
        .map((ingrediente) => {
          const nombre = String(ingrediente.nombre || "").toLowerCase()
          const codigo = String(ingrediente.codigo || "").toLowerCase()
          let score = 0

          if (nombre.startsWith(textoBusquedaRequisicion)) score += 15
          if (codigo.startsWith(textoBusquedaRequisicion)) score += 12
          if (nombre.includes(textoBusquedaRequisicion)) score += 8
          if (codigo.includes(textoBusquedaRequisicion)) score += 6

          textoBusquedaRequisicion.split(" ").filter(Boolean).forEach((palabra) => {
            if (nombre.includes(palabra)) score += 2
            if (codigo.includes(palabra)) score += 1
          })

          return { ingrediente, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => item.ingrediente)
    : []

  const manualIngredientesSugeridos = manualBusqueda
    ? ingredientes
        .map((ingrediente) => {
          const texto = manualBusqueda.toLowerCase()
          const nombre = String(ingrediente.nombre || "").toLowerCase()
          const codigo = String(ingrediente.codigo || ingrediente.sku || ingrediente.codigoBarras || "").toLowerCase()
          let score = 0

          if (nombre.startsWith(texto)) score += 15
          if (codigo.startsWith(texto)) score += 12
          if (nombre.includes(texto)) score += 8
          if (codigo.includes(texto)) score += 6

          texto.split(" ").filter(Boolean).forEach((palabra) => {
            if (nombre.includes(palabra)) score += 2
            if (codigo.includes(palabra)) score += 1
          })

          return { ingrediente, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => item.ingrediente)
    : []

  const ingredientesRecetaSugeridos = recetaBusquedaIngrediente
    ? ingredientes
        .map((ingrediente) => {
          const texto = recetaBusquedaIngrediente.toLowerCase()
          const nombre = String(ingrediente.nombre || "").toLowerCase()
          const codigo = String(ingrediente.codigo || "").toLowerCase()
          let score = 0

          if (nombre.startsWith(texto)) score += 15
          if (codigo.startsWith(texto)) score += 12
          if (nombre.includes(texto)) score += 8
          if (codigo.includes(texto)) score += 6

          texto.split(" ").filter(Boolean).forEach((palabra) => {
            if (nombre.includes(palabra)) score += 2
            if (codigo.includes(palabra)) score += 1
          })

          return { ingrediente, score }
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((item) => item.ingrediente)
    : []

  const recetasFiltradas = recetas
    .filter((receta) => {
      const texto = recetasBusqueda.toLowerCase()
      return (
        !texto ||
        String(receta.nombre || "").toLowerCase().includes(texto) ||
        String(receta.tipo || "").toLowerCase().includes(texto) ||
        String(receta.areaEncargada || "").toLowerCase().includes(texto)
      )
    })
    .filter((receta) => {
      if (recetasFiltro === "Todas") return true
      if (recetasFiltro === "Preparaciones") return receta.tipo === "Preparación"
      if (recetasFiltro === "Recetas Finales") return receta.tipo === "Receta Final"
      return receta.areaEncargada === recetasFiltro
    })

  const proveedoresSimilares = proveedorSeleccionadoPrincipal
    ? obtenerProveedoresSimilares(proveedorSeleccionadoPrincipal)
    : []

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

  function limpiarFormulario() {
    setNombre("")
    setCodigoBarras("")
    setCategoria("")
    setUnidadCompra("lb")
    setCantidadComprada("")
    setUnidadesPorEmpaque("")
    setStockActual("")
    setCostoUnitario("")
    setPuntoMinimo("")
    setPuntoMinimoCocina("")
    setPuntoOrden("")
    setPuntoMaximo("")
    setMotivoEdicion("")
    setImagenIngrediente("")
    setProveedorBusqueda("")
    setProveedorSeleccionadoId(null)
    setEditandoId(null)
    setMostrarFormularioIngrediente(false)
    setErrorFormularioIngrediente("")
    setCamposIngredienteFaltantes({})
    setIngredienteOriginal(null)
  }

  function cargarImagen(event) {
    const archivo = event.target.files[0]

    if (!archivo) return

    if (!archivo.type.startsWith("image/")) {
      alert("Debes subir un archivo de imagen.")
      return
    }

    const lector = new FileReader()

    lector.onload = (e) => {
      setImagenIngrediente(e.target.result)
    }

    lector.readAsDataURL(archivo)
  }

  function eliminarImagenActual() {
    const confirmar = confirm("¿Seguro que deseas quitar la imagen de este ingrediente?")

    if (!confirmar) return

    setImagenIngrediente("")
  }

  function guardarIngrediente() {
    if (nombre.trim() === "" || categoria.trim() === "") {
      alert("Completa nombre y categoría.")
      return
    }

    const nombreNormalizado = nombre.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    const ingredienteDuplicado = ingredientes.find((ingrediente) => (
      ingrediente.id !== editandoId &&
      String(ingrediente.nombre || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "") === nombreNormalizado
    ))
    if (ingredienteDuplicado && !confirm(`Ya existe el ingrediente "${ingredienteDuplicado.nombre}". ¿Deseas ingresarlo de igual manera?`)) {
      return
    }

    const totales = calcularTotales(cantidadComprada, unidadesPorEmpaque, unidadCompra)

    if (editandoId) {
      if (motivoEdicion === "") {
        alert("Selecciona el motivo de edición.")
        return
      }

      const ingredienteActual = ingredientes.find((ingrediente) => ingrediente.id === editandoId)
      const ingredienteActualNormalizado = normalizeInventoryItem(ingredienteActual || {})
      const stockAlmacen = stockActual !== ""
        ? Number(stockActual)
        : getLocationStock(ingredienteActualNormalizado, "almacen")
      const stockCocinaActual = getLocationStock(ingredienteActualNormalizado, "cocina")
      const stockByLocation = {
        ...ingredienteActualNormalizado.stockByLocation,
        almacen: Math.max(0, stockAlmacen),
        cocina: stockCocinaActual
      }
      const stock = Object.values(stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)

      const actualizados = ingredientes.map((ingrediente) => {
        if (ingrediente.id === editandoId) {
          return {
            ...normalizeInventoryItem(ingrediente),
            codigoBarras,
            nombre,
            categoria,
            unidadCompra,
            cantidadComprada,
            unidadesPorEmpaque,
            stockByLocation,
            minimumStockByLocation: {
              almacen: Number(puntoMinimo || 0),
              cocina: Number(puntoMinimoCocina || 0)
            },
            totalUnidades: stock,
            stockActual: stock,
            costoUnitario,
            puntoMinimo,
            puntoOrden,
            puntoMaximo,
            totalGramos: totales.totalGramos,
            totalMililitros: totales.totalMililitros,
            imagen: imagenIngrediente,
            proveedorId: proveedorSeleccionadoId,
            proveedorNombre: proveedorSeleccionado?.nombreComercial || "",
            ultimaEdicion: new Date().toLocaleString()
          }
        }

        return ingrediente
      })

      const ingredienteNuevo = actualizados.find((i) => i.id === editandoId)

      const registro = {
        id: Date.now(),
        fecha: new Date().toLocaleString(),
        codigo: ingredienteOriginal.codigo,
        nombre: ingredienteOriginal.nombre,
        motivo: motivoEdicion,
        antes: ingredienteOriginal,
        despues: ingredienteNuevo
      }

      setIngredientes(actualizados)
      setHistorialCambios([registro, ...historialCambios])
      alert("Ingrediente actualizado.")
      limpiarFormulario()
      return
    }

    const stock = stockActual !== "" ? Number(stockActual) : totales.totalUnidades

    const nuevoIngrediente = normalizeInventoryItem({
      id: Date.now(),
      codigo: generarCodigo(ingredientes.length),
      codigoBarras,
      nombre,
      categoria,
      unidadCompra,
      cantidadComprada,
      unidadesPorEmpaque,
      stockActual: stock,
      totalUnidades: stock,
      stockByLocation: {
        almacen: stock,
        cocina: 0
      },
      minimumStockByLocation: {
        almacen: Number(puntoMinimo || 0),
        cocina: Number(puntoMinimoCocina || 0)
      },
      costoUnitario,
      puntoMinimo,
      puntoOrden,
      puntoMaximo,
      totalGramos: totales.totalGramos,
      totalMililitros: totales.totalMililitros,
      imagen: imagenIngrediente,
      proveedorId: proveedorSeleccionadoId,
      proveedorNombre: proveedorSeleccionado?.nombreComercial || "",
      creado: new Date().toLocaleString(),
      ultimaEdicion: ""
    })

    setIngredientes([...ingredientes, nuevoIngrediente])
    limpiarFormulario()
  }

  function guardarIngredienteDesdeFormulario() {
    const camposRequeridos = [
      { key: "nombre", label: "Nombre del ingrediente", value: nombre },
      { key: "categoria", label: "Categoría", value: categoria },
      { key: "unidadCompra", label: "Unidad de compra", value: unidadCompra },
      { key: "cantidadComprada", label: "Cantidad comprada / stock actual", value: cantidadComprada },
      { key: "unidadesPorEmpaque", label: "Unidades por caja / paquete", value: unidadesPorEmpaque },
      { key: "costoUnitario", label: "Costo unitario", value: costoUnitario },
      { key: "stockActual", label: "Stock actual disponible", value: stockActual },
      { key: "puntoMinimo", label: "Punto mínimo", value: puntoMinimo },
      { key: "puntoOrden", label: "Punto de orden", value: puntoOrden },
      { key: "puntoMaximo", label: "Punto máximo", value: puntoMaximo }
    ]
    const faltantes = camposRequeridos.filter((campo) => String(campo.value ?? "").trim() === "")

    if (faltantes.length > 0) {
      const mapaFaltantes = faltantes.reduce((acc, campo) => ({ ...acc, [campo.key]: campo.label }), {})
      setCamposIngredienteFaltantes(mapaFaltantes)
      setErrorFormularioIngrediente(`Faltan campos requeridos: ${faltantes.map((campo) => campo.label).join(", ")}.`)
      return
    }

    setErrorFormularioIngrediente("")
    setCamposIngredienteFaltantes({})
    guardarIngrediente()
  }

  function limpiarErrorCampoIngrediente(campo) {
    setCamposIngredienteFaltantes((actuales) => {
      if (!actuales[campo]) return actuales
      const siguientes = { ...actuales }
      delete siguientes[campo]

      if (Object.keys(siguientes).length === 0) {
        setErrorFormularioIngrediente("")
      } else {
        setErrorFormularioIngrediente(`Faltan campos requeridos: ${Object.values(siguientes).join(", ")}.`)
      }

      return siguientes
    })
  }

  function limpiarFormularioProveedor() {
    setEditandoProveedorId(null)
    setProveedorNombreComercial("")
    setProveedorRazonSocial("")
    setProveedorNit("")
    setProveedorTipo("Lácteos")
    setProveedorEncargado("")
    setProveedorTelefono("")
    setProveedorWhatsApp("")
    setProveedorCorreo("")
    setProveedorDireccion("")
    setProveedorMetodosPago({ efectivo: false, transferencia: false, tarjeta: false, cheque: false })
    setProveedorCuentaBancaria("")
    setProveedorBanco("")
    setProveedorDiasEntrega({ lunes: false, martes: false, miercoles: false, jueves: false, viernes: false, sabado: false, domingo: false })
    setProveedorTiempoEntrega("mismo dia")
    setProveedorEstrellas(3)
    setProveedorBusqueda("")
  }

  function guardarProveedor() {
    if (!proveedorNombreComercial.trim()) {
      alert("Ingresa el nombre comercial del proveedor.")
      return
    }

    const nuevoProveedor = {
      id: editandoProveedorId || Date.now(),
      codigo: editandoProveedorId ? proveedores.find((p) => p.id === editandoProveedorId)?.codigo : generarCodigoProveedor(proveedores.length),
      nombreComercial: proveedorNombreComercial,
      razonSocial: proveedorRazonSocial,
      nit: proveedorNit,
      tipo: proveedorTipo,
      encargado: proveedorEncargado,
      telefono: proveedorTelefono,
      whatsapp: proveedorWhatsApp,
      correo: proveedorCorreo,
      direccion: proveedorDireccion,
      metodosPago: proveedorMetodosPago,
      cuentaBancaria: proveedorCuentaBancaria,
      banco: proveedorBanco,
      diasEntrega: proveedorDiasEntrega,
      tiempoEntrega: proveedorTiempoEntrega,
      estrellas: proveedorEstrellas,
      historialCompras: editandoProveedorId ? proveedores.find((p) => p.id === editandoProveedorId)?.historialCompras || [] : [],
      creado: editandoProveedorId ? proveedores.find((p) => p.id === editandoProveedorId)?.creado : new Date().toLocaleString()
    }

    if (editandoProveedorId) {
      setProveedores(proveedores.map((p) => (p.id === editandoProveedorId ? nuevoProveedor : p)))
      alert("Proveedor actualizado.")
    } else {
      setProveedores([nuevoProveedor, ...proveedores])
      if (nuevoProveedor.correo) {
        agregarNotificacion(
          `correo-proveedor-${nuevoProveedor.id}`,
          "correo",
          `Nuevo proveedor con correo registrado: ${nuevoProveedor.nombreComercial}.`
        )
      }
      alert("Proveedor creado.")
    }
  }

  function editarProveedor(proveedor) {
    setEditandoProveedorId(proveedor.id)
    setProveedorNombreComercial(proveedor.nombreComercial || "")
    setProveedorRazonSocial(proveedor.razonSocial || "")
    setProveedorNit(proveedor.nit || "")
    setProveedorTipo(proveedor.tipo || "Lácteos")
    setProveedorEncargado(proveedor.encargado || "")
    setProveedorTelefono(proveedor.telefono || "")
    setProveedorWhatsApp(proveedor.whatsapp || "")
    setProveedorCorreo(proveedor.correo || "")
    setProveedorDireccion(proveedor.direccion || "")
    setProveedorMetodosPago(proveedor.metodosPago || { efectivo: false, transferencia: false, tarjeta: false, cheque: false })
    setProveedorCuentaBancaria(proveedor.cuentaBancaria || "")
    setProveedorBanco(proveedor.banco || "")
    setProveedorDiasEntrega(proveedor.diasEntrega || { lunes: false, martes: false, miercoles: false, jueves: false, viernes: false, sabado: false, domingo: false })
    setProveedorTiempoEntrega(proveedor.tiempoEntrega || "mismo dia")
    setProveedorEstrellas(proveedor.estrellas || 3)
    setProveedorBusqueda(proveedor.nombreComercial || "")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function toggleMetodoPago(metodo) {
    setProveedorMetodosPago((prev) => ({
      ...prev,
      [metodo]: !prev[metodo]
    }))
  }

  function toggleDiaEntrega(dia) {
    setProveedorDiasEntrega((prev) => ({
      ...prev,
      [dia]: !prev[dia]
    }))
  }

  function obtenerProveedoresSimilares(proveedor) {
    const productoNombres = ingredientes
      .filter((ingrediente) => ingrediente.proveedorId === proveedor.id)
      .map((ingrediente) => ingrediente.nombre.toLowerCase())

    return proveedores
      .filter((p) => p.id !== proveedor.id)
      .map((p) => {
        const coincidencias = ingredientes.filter(
          (ingrediente) => ingrediente.proveedorId === p.id && productoNombres.includes(ingrediente.nombre.toLowerCase())
        )
        return { proveedor: p, coincidencias }
      })
      .filter((item) => item.coincidencias.length > 0)
  }

  function obtenerUltimasComprasProveedor(proveedor) {
    return (proveedor.historialCompras || []).slice(0, 2)
  }

  function editarIngrediente(ingrediente) {
    setEditandoId(ingrediente.id)
    setIngredienteOriginal({ ...ingrediente })
    setNombre(ingrediente.nombre || "")
    setCategoria(ingrediente.categoria || "")
    setCodigoBarras(ingrediente.codigoBarras || ingrediente.codigo || "")
    setUnidadCompra(ingrediente.unidadCompra || "lb")
    setCantidadComprada(ingrediente.cantidadComprada || "")
    setUnidadesPorEmpaque(ingrediente.unidadesPorEmpaque || "")
    setStockActual(getLocationStock(ingrediente, "almacen"))
    setCostoUnitario(ingrediente.costoUnitario || "")
    setPuntoMinimo(ingrediente.puntoMinimo || "")
    setPuntoMinimoCocina(getLocationMinimum(ingrediente, "cocina") || "")
    setPuntoOrden(ingrediente.puntoOrden || "")
    setPuntoMaximo(ingrediente.puntoMaximo || "")
    setProveedorSeleccionadoId(ingrediente.proveedorId || null)
    setImagenIngrediente(ingrediente.imagen || "")
    setMotivoEdicion("")
    setMostrarFormularioIngrediente(true)
    setErrorFormularioIngrediente("")
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function eliminarIngrediente(id) {
    const ingrediente = ingredientes.find((i) => i.id === id)
    if (!ingrediente) return false

    const stockActualIngrediente = ingrediente.stockActual !== undefined && ingrediente.stockActual !== null
      ? ingrediente.stockActual
      : ingrediente.totalUnidades

    const confirmar = confirm(
      `⚠ ADVERTENCIA\n\nEstás a punto de eliminar:\n\n${ingrediente.nombre}\nCódigo: ${ingrediente.codigo}\nStock actual: ${stockActualIngrediente}\n\n¿Estás seguro?`
    )

    if (!confirmar) return false

    setIngredientes(ingredientes.filter((i) => i.id !== id))
    return true
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

  function mostrarNotificacion(mensaje, tipo = "info") {
    setNotificacionRequisicion(mensaje)
    setTipoNotificacion(tipo)
    setTimeout(() => setNotificacionRequisicion(null), 6000)
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
    setIngredienteSeleccionadoId(null)
    setRequisicionBusqueda("")
    setCantidadSolicitada("")
    setFechaSolicitud("")
    setFechaNecesita("")
    setRequisicionItems([])
    setSelectedReqId(null)
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

  function definirMinimoArea(itemId, areaId) {
    const item = ingredientes.find((ingrediente) => ingrediente.id === itemId)
    const valor = window.prompt(`Mínimo de ${item?.nombre || "producto"} en ${getAreaLabel(areaId)}:`, String(getLocationMinimum(item, areaId)))
    if (valor === null || Number(valor) < 0) return
    setIngredientes((actuales) => actuales.map((ingrediente) => ingrediente.id === itemId ? {
      ...normalizeInventoryItem(ingrediente),
      minimumStockByLocation: {
        ...normalizeInventoryItem(ingrediente).minimumStockByLocation,
        [areaId]: Number(valor)
      }
    } : ingrediente))
  }

  function crearRequisicionParaArea(areaId) {
    setRequisicionDestino(areaId)
    setSeccionActiva("requisicion")
    setMostrarFormularioRequisicion(true)
  }

  function crearRequisicion() {
    if (!usuarioActual) {
      alert("Debes iniciar sesión para crear una requisición.")
      return
    }

    if (!ingredienteSeleccionado) {
      alert("Selecciona un ingrediente válido para la requisición.")
      return
    }

    const cantidad = Number(cantidadSolicitada)
    if (!cantidad || cantidad <= 0) {
      alert("Ingresa una cantidad válida a solicitar.")
      return
    }

    const stockActual = getLocationStock(ingredienteSeleccionado, "almacen")

    if (cantidad > stockActual) {
      mostrarNotificacion(`No hay suficiente stock disponible para ${ingredienteSeleccionado.nombre}. Stock disponible: ${stockActual}. Espera a que ingrese más del ingrediente.`, "error")
      return
    }

    const estadoDisponibilidad = stockActual >= cantidad ? "Disponible" : "No disponible"

    const nuevoItem = {
      id: ingredienteSeleccionado.id,
      itemId: ingredienteSeleccionado.id,
      ingredienteId: ingredienteSeleccionado.id,
      itemName: ingredienteSeleccionado.nombre,
      ingredienteNombre: ingredienteSeleccionado.nombre,
      ingredienteCodigo: ingredienteSeleccionado.codigo,
      unit: ingredienteSeleccionado.unidadCompra,
      unidad: ingredienteSeleccionado.unidadCompra,
      requestedQty: cantidad,
      approvedQty: cantidad,
      cantidadSolicitada: cantidad,
      inventarioDisponible: stockActual,
      estadoDisponibilidad
    }

    const existeItem = requisicionItems.find(
      (item) => item.ingredienteId === nuevoItem.ingredienteId
    )

    if (existeItem) {
      const cantidadActualizada = existeItem.cantidadSolicitada + cantidad
      if (cantidadActualizada > stockActual) {
        mostrarNotificacion(`No hay suficiente stock disponible para ${ingredienteSeleccionado.nombre}. Stock disponible: ${stockActual}. Espera a que ingrese más del ingrediente.`, "error")
        return
      }

      const itemsActualizados = requisicionItems.map((item) => {
        if (item.ingredienteId === nuevoItem.ingredienteId) {
          return {
            ...item,
            cantidadSolicitada: cantidadActualizada,
            requestedQty: cantidadActualizada,
            approvedQty: cantidadActualizada,
            estadoDisponibilidad: stockActual >= cantidadActualizada ? "Disponible" : "No disponible"
          }
        }
        return item
      })

      setRequisicionItems(itemsActualizados)
    } else {
      setRequisicionItems([...requisicionItems, nuevoItem])
    }

    agregarNotificacion(
      `requisicion-${nuevoItem.id}`,
      "requisicion",
      `Nueva requisición agregada: ${nuevoItem.ingredienteNombre} (${nuevoItem.cantidadSolicitada} ${nuevoItem.unidad}).`
    )
    mostrarNotificacion("Ingrediente agregado a la requisición.", "success")
    setCantidadSolicitada("")
    setIngredienteSeleccionadoId(null)
    setRequisicionBusqueda("")
  }

  function enviarRequisicion() {
    if (!usuarioActual) {
      alert("Debes iniciar sesión para enviar una requisición.")
      return
    }

    if (requisicionItems.length === 0) {
      alert("Agrega al menos un ingrediente antes de enviar la requisición.")
      return
    }

    if (!fechaSolicitud || !fechaNecesita) {
      alert("Selecciona la fecha de solicitud y la fecha en que la necesitas.")
      return
    }
    const destino = areas.find((area) => area.id === requisicionDestino)
    if (!destino || destino.id === "almacen" || destino.active === false || destino.canRequestInventory === false) {
      alert("Selecciona un área de destino activa que pueda solicitar inventario.")
      return
    }

    const nuevaRequisicion = {
      id: Date.now(),
      date: fechaSolicitud,
      usuario: usuarioActual.nombre,
      username: usuarioActual.username,
      requestedBy: usuarioActual.nombre,
      approvedBy: "",
      departamento: usuarioActual.departamento || "",
      fromLocation: "almacen",
      toLocation: requisicionDestino,
      items: requisicionItems.map((item) => ({
        ...item,
        itemId: item.itemId ?? item.ingredienteId,
        itemName: item.itemName ?? item.ingredienteNombre,
        unit: item.unit ?? item.unidad,
        requestedQty: Number(item.requestedQty ?? item.cantidadSolicitada),
        approvedQty: Number(item.approvedQty ?? item.cantidadSolicitada),
        notes: item.notes || ""
      })),
      fechaSolicitud,
      fechaNecesita,
      status: "pending",
      comentariosAprobador: "",
      movimientos: [
        { accion: 'creada', por: usuarioActual.nombre, username: usuarioActual.username, fecha: new Date().toLocaleString(), modulo: 'requisiciones' }
      ],
      creado: new Date().toLocaleString(),
      createdAt: new Date().toISOString(),
      completedAt: "",
      aprobadoPor: "",
      aprobadoEn: "",
      descargadoPor: "",
      descargadoEn: ""
    }

    setRequisiciones([nuevaRequisicion, ...requisiciones])
    setRequisicionItems([])
    setFechaSolicitud("")
    setFechaNecesita("")
    setRequisicionBusqueda("")
    setIngredienteSeleccionadoId(null)
    setCantidadSolicitada("")
    mostrarNotificacion("Requisición enviada.", "success")
    agregarNotificacion(`requisicion-${nuevaRequisicion.id}`, 'requisicion', `Nueva requisición de ${nuevaRequisicion.usuario}`)
    alert("Requisición enviada.")
  }

  function validarYEnviarRequisicion() {
    const errores = {}

    if (requisicionItems.length === 0) {
      errores.items = "Agrega al menos un ingrediente."
    }
    if (!fechaSolicitud) {
      errores.fechaSolicitud = "Selecciona la fecha de requisición."
    }
    if (!fechaNecesita) {
      errores.fechaNecesita = "Selecciona la fecha de entrega requerida."
    }
    if (!requisicionDestino) {
      errores.destino = "Selecciona el área de destino."
    }

    setErroresRequisicion(errores)
    if (Object.keys(errores).length > 0) return

    enviarRequisicion()
    setMostrarFormularioRequisicion(false)
  }

  function cancelarFormularioRequisicion() {
    setMostrarFormularioRequisicion(false)
    setErroresRequisicion({})
    setRequisicionBusqueda("")
    setIngredienteSeleccionadoId(null)
    setCantidadSolicitada("")
    setRequisicionDestino("cocina")
  }

  function eliminarItemRequisicion(itemId) {
    setRequisicionItems(requisicionItems.filter((item) => item.ingredienteId !== itemId))
  }

  function verRequisicion(id) {
    setSelectedReqId(id)
    setSeccionActiva("inventario")
  }

  function aceptarRequisicion(requisicion) {
    const normalized = normalizeRequisition(requisicion)
    if (!["pending", "draft"].includes(normalized.status)) {
      alert("Solo se pueden aprobar requisiciones pendientes o en borrador.")
      return
    }

    setRequisiciones((actuales) => actuales.map((req) => req.id === requisicion.id ? {
      ...normalized,
      status: "approved",
      approvedBy: usuarioActual?.nombre || "Sistema",
      aprobadoPor: usuarioActual?.nombre || "Sistema",
      aprobadoEn: new Date().toLocaleString(),
      movimientos: [
        ...(normalized.movimientos || []),
        { accion: "aprobada", por: usuarioActual?.nombre || "Sistema", username: usuarioActual?.username || "sistema", fecha: new Date().toLocaleString(), modulo: "requisiciones" }
      ]
    } : req))
    mostrarNotificacion(`Requisición aprobada. Ahora puedes completar el traslado a ${getAreaLabel(normalized.toLocation)}.`, "success")
  }

  function cambiarEstadoRequisicion(requisitionId, status) {
    const requisicion = requisiciones.find((req) => req.id === requisitionId)
    if (!requisicion) return
    const normalized = normalizeRequisition(requisicion)
    if (normalized.status === "completed") {
      alert("Una requisición completada no puede modificarse.")
      return
    }

    setRequisiciones((actuales) => actuales.map((req) => req.id === requisitionId ? {
      ...normalizeRequisition(req),
      status,
      movimientos: [
        ...(req.movimientos || []),
        { accion: status, por: usuarioActual?.nombre || "Sistema", username: usuarioActual?.username || "sistema", fecha: new Date().toLocaleString(), modulo: "requisiciones" }
      ]
    } : req))
    mostrarNotificacion(`Requisición ${status === "rejected" ? "rechazada" : "cancelada"}. No se movió inventario.`, "success")
  }

  function completeRequisition(requisitionId) {
    const requisicion = requisiciones.find((req) => req.id === requisitionId)
    if (!requisicion) {
      alert("No se encontró la requisición.")
      return
    }

    const normalized = normalizeRequisition(requisicion)
    if (normalized.status === "completed") {
      alert("Esta requisición ya fue completada y no puede procesarse dos veces.")
      return
    }
    if (!["approved", "pending"].includes(normalized.status)) {
      alert("Solo se pueden completar requisiciones aprobadas o pendientes.")
      return
    }
    if (!normalized.items.length) {
      alert("No se puede completar una requisición sin insumos.")
      return
    }

    const invalidItem = normalized.items.find((item) => Number(item.approvedQty) <= 0)
    if (invalidItem) {
      alert(`La cantidad aprobada de ${invalidItem.itemName || "un insumo"} debe ser mayor a cero.`)
      return
    }

    const faltante = normalized.items.find((itemReq) => {
      const ingrediente = ingredientes.find((item) => item.id === itemReq.itemId)
      const disponible = ingrediente ? getLocationStock(ingrediente, normalized.fromLocation) : 0
      return !ingrediente || Number(itemReq.approvedQty) > disponible
    })

    if (faltante) {
      const ingrediente = ingredientes.find((item) => item.id === faltante.itemId)
      const disponible = ingrediente ? getLocationStock(ingrediente, normalized.fromLocation) : 0
      const nombre = faltante.itemName || ingrediente?.nombre || "Ingrediente"
      const unidad = faltante.unit || ingrediente?.unidadCompra || ""
      mostrarNotificacion(`No hay suficiente ${nombre} en ${getAreaLabel(normalized.fromLocation)}. Disponible: ${disponible} ${unidad}. Solicitado: ${faltante.approvedQty} ${unidad}.`, "error")
      return
    }

    const confirmacion = confirm(`¿Completar traslado de ${getAreaLabel(normalized.fromLocation)} a ${getAreaLabel(normalized.toLocation)} para ${normalized.items.length} insumo(s)?`)
    if (!confirmacion) return

    const now = new Date()
    const movimientos = []
    const inventarioActualizado = ingredientes.map((item) => {
      const itemReq = normalized.items.find((reqItem) => reqItem.itemId === item.id)
      if (!itemReq) return item

      const normalizedItem = normalizeInventoryItem(item)
      const cantidad = Number(itemReq.approvedQty)
      const previousStockFrom = getLocationStock(normalizedItem, normalized.fromLocation)
      const previousStockTo = getLocationStock(normalizedItem, normalized.toLocation)
      const newStockFrom = previousStockFrom - cantidad
      const newStockTo = previousStockTo + cantidad
      const stockByLocation = {
        ...normalizedItem.stockByLocation,
        [normalized.fromLocation]: newStockFrom,
        [normalized.toLocation]: newStockTo
      }
      const total = Object.values(stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)

      movimientos.push({
        id: `${Date.now()}-${item.id}-${Math.floor(Math.random() * 9999)}`,
        date: now.toISOString(),
        type: "transfer",
        source: "requisition",
        sourceId: requisitionId,
        itemId: item.id,
        itemName: itemReq.itemName || item.nombre,
        fromLocation: normalized.fromLocation,
        toLocation: normalized.toLocation,
        quantity: cantidad,
        unit: itemReq.unit || item.unidadCompra,
        previousStockFrom,
        newStockFrom,
        previousStockTo,
        newStockTo,
        performedBy: usuarioActual?.nombre || usuarioActual?.username || "Sistema",
        notes: itemReq.notes || ""
      })

      return {
        ...normalizedItem,
        stockByLocation,
        totalUnidades: total,
        stockActual: total,
        ultimaEdicion: new Date().toLocaleString()
      }
    })

    setIngredientes(inventarioActualizado)
    setInventoryMovements((actuales) => [...movimientos, ...actuales])
    setRequisiciones((actuales) => actuales.map((req) => req.id === requisitionId ? {
      ...normalizeRequisition(req),
      status: "completed",
      completedAt: now.toISOString(),
      aceptadoPor: req.aceptadoPor || usuarioActual?.nombre || "Sistema",
      aceptadoEn: req.aceptadoEn || new Date().toLocaleString(),
      descargadoPor: usuarioActual?.nombre || "Sistema",
      descargadoEn: new Date().toLocaleString(),
      movimientos: [
        ...(req.movimientos || []),
        { accion: "completada", por: usuarioActual?.nombre || "Sistema", username: usuarioActual?.username || "sistema", fecha: new Date().toLocaleString(), modulo: "requisiciones" }
      ]
    } : req))

    generarPDFRequisicion({ ...normalized, status: "completed", completedAt: now.toISOString(), aceptadoPor: usuarioActual?.nombre || "Sistema", aceptadoEn: new Date().toLocaleString() })
    mostrarNotificacion(`Traslado completado. Bajó ${getAreaLabel(normalized.fromLocation)} y subió ${getAreaLabel(normalized.toLocation)}.`, "success")
    alert(`Traslado completado. El inventario de ${getAreaLabel(normalized.fromLocation)} y ${getAreaLabel(normalized.toLocation)} fue actualizado.`)
  }

  function consumeFromKitchen(itemId, quantity, notes = "Consumo operativo de cocina") {
    // POS y recetas deben usar este helper para descontar producción/ventas desde Cocina, no desde Almacén.
    const cantidad = Number(quantity)
    if (!itemId || !cantidad || cantidad <= 0) return { ok: false, message: "Cantidad inválida." }

    const ingrediente = ingredientes.find((item) => item.id === itemId)
    if (!ingrediente) return { ok: false, message: "Ingrediente no encontrado." }

    const disponible = getLocationStock(ingrediente, "cocina")
    if (cantidad > disponible) {
      return { ok: false, message: `No hay suficiente ${ingrediente.nombre} en cocina. Disponible: ${disponible} ${ingrediente.unidadCompra}. Solicitado: ${cantidad} ${ingrediente.unidadCompra}.` }
    }

    setIngredientes((actuales) => actuales.map((item) => {
      if (item.id !== itemId) return item
      const normalizedItem = normalizeInventoryItem(item)
      const previousStockTo = getLocationStock(normalizedItem, "cocina")
      const stockByLocation = {
        ...normalizedItem.stockByLocation,
        cocina: previousStockTo - cantidad
      }
      const total = Object.values(stockByLocation).reduce((sum, value) => sum + Number(value || 0), 0)
      return { ...normalizedItem, stockByLocation, stockActual: total, totalUnidades: total, ultimaEdicion: new Date().toLocaleString() }
    }))

    setInventoryMovements((actuales) => [{
      id: `${Date.now()}-${itemId}-${Math.floor(Math.random() * 9999)}`,
      date: new Date().toISOString(),
      type: "consumption",
      source: "kitchen",
      sourceId: "",
      itemId,
      itemName: ingrediente.nombre,
      fromLocation: "cocina",
      toLocation: "",
      quantity: cantidad,
      unit: ingrediente.unidadCompra,
      previousStockFrom: disponible,
      newStockFrom: disponible - cantidad,
      previousStockTo: 0,
      newStockTo: 0,
      performedBy: usuarioActual?.nombre || usuarioActual?.username || "Sistema",
      notes
    }, ...actuales])

    return { ok: true }
  }

  function generarPDFRequisicion(requisicion) {
    const doc = new jsPDF()
    const fecha = new Date().toLocaleString()
    const normalized = normalizeRequisition(requisicion)
    const items = normalized.items

    doc.setFontSize(18)
    doc.text("Requisición de Ingredientes", 14, 18)
    doc.setFontSize(12)
    doc.text(`Fecha de generación: ${fecha}`, 14, 26)
    doc.text(`Solicitante: ${normalized.requestedBy}`, 14, 34)
    doc.text(`Fecha de requisición: ${requisicion.fechaSolicitud}`, 14, 42)
    doc.text(`Fecha de entrega requerida: ${requisicion.fechaNecesita}`, 14, 50)
    doc.text(`Procesado por: ${requisicion.aceptadoPor || normalized.approvedBy}`, 14, 58)
    doc.text(`Fecha aceptada: ${requisicion.aceptadoEn}`, 14, 66)

    autoTable(doc, {
      startY: 76,
      head: [["Ingrediente", "Código", "Cantidad", "Unidad", "Disponibilidad"]],
      body: items.map((item) => [
        item.itemName,
        item.ingredienteCodigo,
        item.approvedQty,
        item.unit || "",
        item.estadoDisponibilidad || ""
      ])
    })

    const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY : 76
    doc.setFontSize(12)
    doc.text(`Total de ingredientes: ${items.length}`, 14, finalY + 12)
    doc.text(`Estado de la requisición: ${requisicion.status}`, 14, finalY + 20)

    doc.save(`requisicion-${requisicion.id}.pdf`)
  }

  function importarArchivo(event) {
    const archivo = event.target.files[0]
    if (!archivo) return

    const lector = new FileReader()

    lector.onload = (e) => {
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: "array" })
      const hoja = workbook.Sheets[workbook.SheetNames[0]]
      const filas = XLSX.utils.sheet_to_json(hoja)

      const nuevos = filas.map((fila, index) => {
        const unidad = fila.unidadCompra || "unidad"
        const totales = calcularTotales(
          fila.cantidadComprada || 0,
          fila.unidadesPorEmpaque || "",
          unidad
        )

        return {
          ...normalizeInventoryItem({
            id: Date.now() + index,
            codigo: fila.codigo || `ING-${String(ingredientes.length + index + 1).padStart(4, "0")}`,
            nombre: fila.nombre || "",
            categoria: fila.categoria || "",
            unidadCompra: unidad,
            cantidadComprada: fila.cantidadComprada || 0,
            unidadesPorEmpaque: fila.unidadesPorEmpaque || "",
            totalUnidades: totales.totalUnidades,
            stockActual: totales.totalUnidades,
            costoUnitario: fila.costoUnitario || 0,
            puntoMinimo: fila.puntoMinimo || 0,
            puntoOrden: fila.puntoOrden || 0,
            puntoMaximo: fila.puntoMaximo || 0,
            totalGramos: totales.totalGramos,
            totalMililitros: totales.totalMililitros,
            imagen: fila.imagen || "",
            creado: new Date().toLocaleString(),
            ultimaEdicion: ""
          })
        }
      })

      setIngredientes((actuales) => [...actuales, ...nuevos])
      alert("Inventario importado.")
    }

    lector.readAsArrayBuffer(archivo)
  }

  function descargarRespaldoInventario() {
    const respaldo = {
      type: "alcazar-inventario-backup",
      version: 1,
      createdAt: new Date().toISOString(),
      count: ingredientes.length,
      ingredientes
    }
    const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = `respaldo-inventario-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function restaurarRespaldoInventario(event) {
    const archivo = event.target.files[0]
    if (!archivo) return

    const lector = new FileReader()
    lector.onload = (e) => {
      try {
        const parsed = JSON.parse(String(e.target.result || "{}"))
        const restaurados = Array.isArray(parsed) ? parsed : parsed.ingredientes
        if (!Array.isArray(restaurados) || restaurados.length === 0) {
          alert("El archivo no contiene un inventario válido.")
          return
        }

        const confirmar = window.confirm(`Se restaurarán ${restaurados.length} ingredientes. Esto reemplazará el inventario actual y dejará un respaldo automático del estado anterior. ¿Continuar?`)
        if (!confirmar) return

        setIngredientes(restaurados)
        alert("Inventario restaurado.")
      } catch {
        alert("No se pudo leer el respaldo. Verifica que sea un archivo JSON válido.")
      } finally {
        event.target.value = ""
      }
    }
    lector.readAsText(archivo)
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
      nombre: detalle.nombre,
      sku: detalle.sku,
      codigo: detalle.sku,
      cantidad_compra: cantidad,
      cantidadComprar: cantidad,
      unidad_compra: detalle.unidadCompra,
      unidadCompra: detalle.unidadCompra,
      precio_unitario_compra: detalle.precioCompra,
      costoUnitario: detalle.precioCompra,
      subtotal: cantidad * detalle.precioCompra,
      factor_conversion: detalle.factorConversion,
      unidad_base: detalle.unidadBase,
      cantidad_base_total: cantidad * detalle.factorConversion,
      imagen: manualIngredienteSeleccionado.imagen || ""
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

  const ingredientesFiltrados = ingredientes.filter((ingrediente) => {
    const texto = busqueda.toLowerCase()

    return (
      String(ingrediente.nombre || "").toLowerCase().includes(texto) ||
      String(ingrediente.codigo || "").toLowerCase().includes(texto) ||
      String(ingrediente.categoria || "").toLowerCase().includes(texto) ||
      String(ingrediente.proveedorNombre || "").toLowerCase().includes(texto)
    )
  })
  const ingredientesUbicacionFiltrados = ingredientesFiltrados.filter((ingrediente) => (
    inventoryLocationFilter === "todos" || getLocationStock(ingrediente, inventoryLocationFilter) > 0
  ))
  const ingredientesAreaSeleccionada = inventoryLocationFilter === "todos" ? [] : ingredientes.filter((ingrediente) => getLocationStock(ingrediente, inventoryLocationFilter) > 0 || getLocationMinimum(ingrediente, inventoryLocationFilter) > 0)
  const ultimaTransferenciaAreaPorItem = inventoryMovements.reduce((acc, movement) => {
    if (movement.type === "transfer" && movement.toLocation === inventoryLocationFilter && !acc[movement.itemId]) acc[movement.itemId] = movement
    return acc
  }, {})

  const hayBusquedaIngrediente = busqueda.trim().length > 0
  const sugerenciasIngredientes = hayBusquedaIngrediente ? ingredientesUbicacionFiltrados.slice(0, 8) : []

  function seleccionarSugerenciaIngrediente(ingrediente) {
    setBusqueda(ingrediente.nombre || "")
    setIngredienteResaltadoId(ingrediente.id)
    setMostrarSugerenciasIngredientes(false)

    window.setTimeout(() => {
      document
        .getElementById(`ingrediente-${ingrediente.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" })
    }, 0)
  }

  function buscarIngredientePorCodigo(codigo) {
    const codigoNormalizado = String(codigo || "").trim().toLowerCase()
    if (!codigoNormalizado) return null

    return ingredientes.find((ingrediente) =>
      String(ingrediente.codigo || "").trim().toLowerCase() === codigoNormalizado ||
      String(ingrediente.codigoBarras || "").trim().toLowerCase() === codigoNormalizado
    )
  }

  async function obtenerDatosProductoPorCodigo(codigo) {
    return null
  }

  function mostrarIngredienteEscaneado(ingrediente, codigo) {
    setBarcodeSearch(codigo)
    setBarcodeFoundIngredient(ingrediente || null)

    if (ingrediente) {
      setBarcodeMessage("")
      setBarcodeNotFoundCode("")
      setBusqueda(ingrediente.nombre || "")
      setIngredienteResaltadoId(ingrediente.id)
      window.setTimeout(() => {
        document
          .getElementById(`ingrediente-${ingrediente.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" })
      }, 0)
      return
    }

    setBarcodeMessage("")
    setBarcodeNotFoundCode(codigo)
  }

  function descartarCodigoBarrasNoEncontrado() {
    setBarcodeNotFoundCode("")
    setBarcodeSearch("")
    setBarcodeMessage("")
    setBarcodeFoundIngredient(null)
  }

  async function prepararIngredienteDesdeCodigoBarras() {
    const codigo = barcodeNotFoundCode || barcodeSearch
    const datosProducto = await obtenerDatosProductoPorCodigo(codigo)

    setCodigoBarras(codigo)
    if (datosProducto) {
      setNombre(datosProducto.nombre || "")
      setCategoria(datosProducto.categoria || "")
    }
    setMostrarFormularioIngrediente(true)
    setBarcodeNotFoundCode("")
    setBarcodeMessage("")
    setBarcodeFoundIngredient(null)

    window.setTimeout(() => {
      document
        .getElementById("formulario-ingrediente")
        ?.scrollIntoView({ behavior: "smooth", block: "start" })
    }, 0)
  }

  function cerrarCamaraCodigoBarras() {
    barcodeControlsRef.current?.stop()
    barcodeControlsRef.current = null
    setBarcodeScannerActive(false)
  }

  async function abrirCamaraCodigoBarras() {
    try {
      setBarcodeMessage("")
      setBarcodeFoundIngredient(null)
      setBarcodeScannerActive(true)

      const reader = new BrowserMultiFormatReader()
      const controls = await reader.decodeFromVideoDevice(
        undefined,
        barcodeVideoRef.current,
        (result) => {
          if (!result) return

          const codigo = result.getText()
          const ingrediente = buscarIngredientePorCodigo(codigo)
          mostrarIngredienteEscaneado(ingrediente, codigo)
          cerrarCamaraCodigoBarras()
        }
      )

      barcodeControlsRef.current = controls
    } catch (error) {
      setBarcodeScannerActive(false)
      setBarcodeMessage("No se pudo abrir la cámara. Revisa los permisos del dispositivo.")
    }
  }

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
        <div style={cardStyle}>
          <h2>Gestión de Usuarios</h2>
          {!usuarioActual ? (
                <p style={{ color: "#9ca3af" }}>Inicia sesión para administrar usuarios.</p>
              ) : !puedeVerModuloRRHH ? (
                <p style={{ color: "#fca5a5" }}>No tienes permisos para ver el módulo de usuarios.</p>
              ) : (
            <>
              <div style={hrActionBarStyle}>
                {puedeGestionarUsuarios && (
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarFormularioColaborador((actual) => !actual)
                      setMostrarPerfilColaborador(false)
                      setPerfilColaboradorEditando(false)
                      setMensajePerfilColaborador("")
                      setErroresColaborador({})
                    }}
                    style={addIngredientToggleButtonStyle}
                  >
                    + Agregar colaborador nuevo
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMostrarPerfilColaborador(true)
                    setMostrarFormularioColaborador(false)
                    setPerfilColaboradorEditando(false)
                    setMensajePerfilColaborador("")
                    setCurrentHRView("dashboard")
                    setSelectedEmployee(null)
                  }}
                  style={secondaryPanelButtonStyle}
                >
                  Dashboard RRHH
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSeccionActiva("asistencia")
                    setMensajeAsistencia("")
                  }}
                  style={secondaryPanelButtonStyle}
                >
                  Marcaje de asistencia
                </button>
                {puedeVerReportesRRHH && (
                  <button
                    type="button"
                    onClick={() => setSeccionActiva("reportesAsistencia")}
                    style={secondaryPanelButtonStyle}
                  >
                    Reportes de asistencia
                  </button>
                )}
              </div>

              {mostrarFormularioColaborador && (
              <form onSubmit={guardarColaboradorValidado}>
                {Object.keys(erroresColaborador).length > 0 && (
                  <div style={ingredientFormErrorStyle}>
                    Faltan campos requeridos: {Object.values(erroresColaborador).join(", ")}.
                  </div>
                )}
                {/* SECCION BASICA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Información Básica</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <input placeholder="Nombre completo" value={userForm.nombre} onChange={(e) => actualizarCampoColaborador("nombre", e.target.value)} style={erroresColaborador.nombre ? inputErrorStyle : inputStyle} />
                    <input placeholder="Username" value={userForm.username} onChange={(e) => actualizarCampoColaborador("username", e.target.value)} style={erroresColaborador.username ? inputErrorStyle : inputStyle} />
                    <input placeholder="Correo" type="email" value={userForm.correo} onChange={(e) => actualizarCampoColaborador("correo", e.target.value)} style={erroresColaborador.correo ? inputErrorStyle : inputStyle} />
                    <input placeholder="Teléfono" value={userForm.telefono} onChange={(e) => setUserForm((s) => ({ ...s, telefono: e.target.value }))} style={inputStyle} />
                    <select value={userForm.departamento} onChange={(e) => actualizarCampoColaborador("departamento", e.target.value)} style={erroresColaborador.departamento ? inputErrorStyle : inputStyle}>
                      <option value="">Selecciona departamento</option>
                      {departamentosDisponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input placeholder="Puesto/Cargo" value={userForm.puesto} onChange={(e) => setUserForm((s) => ({ ...s, puesto: e.target.value }))} style={inputStyle} />
                    <input placeholder="Supervisor directo" value={userForm.supervisorDirecto} onChange={(e) => actualizarCampoColaborador("supervisorDirecto", e.target.value)} style={inputStyle} />
                    <input placeholder="Contacto de emergencia" value={userForm.contactoEmergencia} onChange={(e) => actualizarCampoColaborador("contactoEmergencia", e.target.value)} style={inputStyle} />
                  </div>
                </div>

                {/* SECCION CONTRASENA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Credenciales y Rol</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
                    <select value={userForm.rol} onChange={(e) => actualizarCampoColaborador("rol", e.target.value)} style={erroresColaborador.rol ? inputErrorStyle : inputStyle}>
                      <option value="">Selecciona rol</option>
                      {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <input placeholder={editUserId ? "Dejar vacío para no cambiar" : "Contraseña requerida"} type="password" value={userForm.password} onChange={(e) => actualizarCampoColaborador("password", e.target.value)} style={erroresColaborador.password ? inputErrorStyle : inputStyle} />
                    <select value={userForm.estado} onChange={(e) => actualizarCampoColaborador("estado", e.target.value)} style={erroresColaborador.estado ? inputErrorStyle : inputStyle}>
                      <option value="">Estado</option>
                      <option value="Activo">Activo</option>
                      <option value="Suspendido">Suspendido</option>
                      <option value="Inactivo">Inactivo</option>
                      <option value="Retirado">Retirado</option>
                    </select>
                  </div>
                </div>

                {/* SECCION FECHAS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Fechas</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                    <div>
                      <label style={{ color: "#cbd5e1", fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>Fecha de inicio de labores</label>
                      <input type="date" value={userForm.fechaInicioLabores} onChange={(e) => actualizarCampoColaborador("fechaInicioLabores", e.target.value)} style={erroresColaborador.fechaInicioLabores ? inputErrorStyle : inputStyle} />
                    </div>
                    <div>
                      <label style={{ color: "#cbd5e1", fontSize: "0.85rem", display: "block", marginBottom: "4px" }}>Fecha de nacimiento</label>
                      <input type="date" value={userForm.fechaCumpleanos} onChange={(e) => setUserForm((s) => ({ ...s, fechaCumpleanos: e.target.value }))} style={inputStyle} />
                    </div>
                  </div>
                </div>

                {/* SECCION HORARIOS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Horario / turnos</h3>
                  {renderControlesTurno("Agregar turno")}
                  {renderTurnosColaborador(obtenerTurnosColaborador(userForm), true)}
                  {erroresColaborador.turnos && <p style={fieldErrorStyle}>{erroresColaborador.turnos}</p>}
                </div>

                {/* SECCION FOTOGRAFIA */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Fotografía</h3>
                  <input type="file" accept="image/*" onChange={subirFotoColaborador} style={inputStyle} />
                  {userForm.fotoColaborador && (
                    <div style={{ marginTop: "8px" }}>
                      <img src={userForm.fotoColaborador} alt="Foto" style={{ maxWidth: "150px", height: "auto", borderRadius: "8px" }} />
                    </div>
                  )}
                </div>

                {/* SECCION DOCUMENTOS */}
                <div style={{ marginBottom: "16px", paddingBottom: "16px", borderBottom: "1px solid #334155" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Documentos</h3>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", alignItems: "flex-end", marginBottom: "12px" }}>
                    <select value={documentoTemp.tipo} onChange={(e) => setDocumentoTemp((s) => ({ ...s, tipo: e.target.value }))} style={inputStyle}>
                      <option value="dpiFrontal">DPI Frontal</option>
                      <option value="dpiReverso">DPI Reverso</option>
                      <option value="tarjetaSalud">Tarjeta de Salud</option>
                      <option value="tarjetaManipulacionAlimentos">Tarjeta de Manipulación de Alimentos</option>
                      <option value="otros">Otros</option>
                    </select>
                    <input type="file" onChange={subirDocumentoColaborador} style={inputStyle} />
                    <button type="button" style={buttonStyle}>Subir documento</button>
                  </div>
                  <div style={{ display: "grid", gap: "6px" }}>
                    {userForm.documentos.dpiFrontal && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ DPI Frontal cargado</div>}
                    {userForm.documentos.dpiReverso && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ DPI Reverso cargado</div>}
                    {userForm.documentos.tarjetaSalud && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ Tarjeta de Salud cargada</div>}
                    {userForm.documentos.tarjetaManipulacionAlimentos && <div style={{ padding: "8px", backgroundColor: "#1a2332", borderRadius: "6px" }}>✓ Tarjeta de Manipulación cargada</div>}
                  </div>
                </div>

                {/* SECCION OBSERVACIONES */}
                <div style={{ marginBottom: "16px" }}>
                  <h3 style={{ color: "#e6eef8", marginBottom: "12px" }}>Observaciones Adicionales</h3>
                  <textarea placeholder="Notas sobre el colaborador..." value={userForm.observaciones} onChange={(e) => setUserForm((s) => ({ ...s, observaciones: e.target.value }))} style={{ ...inputStyle, minHeight: "80px" }} />
                </div>

                {/* BOTONES */}
                <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
                    <button type="submit" style={buttonStyle}>{editUserId ? "Actualizar Colaborador" : "Crear Colaborador"}</button>
                    <button type="button" onClick={() => { setEditUserId(null); limpiarFormularioUsuario(); setMostrarFormularioColaborador(false) }} style={cancelButtonStyle}>
                      Cancelar
                    </button>
                </div>
              </form>
              )}

              {mostrarPerfilColaborador && (
                <div style={hrSectionStackStyle}>
                  <div style={hrContextHeaderStyle}>
                    <div>
                      <div style={hrBreadcrumbStyle}>{getHRBreadcrumb()}</div>
                      <h2 style={hrContextTitleStyle}>{getHRViewTitle()}</h2>
                    </div>
                  </div>
                  <div style={hrTabBarStyle}>
                    {[
                      ["dashboard", "Dashboard RRHH"],
                      ["alerts", "Alertas"],
                      ["collaborators", "Colaboradores"],
                      ...(puedeGestionarUsuarios ? [["users", "Gestión de usuarios"]] : [])
                    ].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setCurrentHRView(key)
                          if (key !== "employeeProfile") setSelectedEmployee(null)
                        }}
                        style={currentHRView === key ? activeTabButtonStyle : sectionButtonStyle}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {currentHRView === "dashboard" && renderHRDashboard()}

                  {currentHRView === "alerts" && (
                    <div style={profileCardStyle}>
                      <h3>Alertas de RRHH</h3>
                      {renderHRAlerts(hrOpenAlerts)}
                    </div>
                  )}

                  {currentHRView === "collaborators" && (
                    <div style={hrSectionStackStyle}>
                      <div style={hrFilterGridStyle}>
                        <input placeholder="Buscar por nombre, puesto o área..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} style={inputStyle} />
                        <input placeholder="Filtrar por puesto" value={hrFilters.puesto} onChange={(e) => setHrFilters((s) => ({ ...s, puesto: e.target.value }))} style={inputStyle} />
                        <select value={hrFilters.departamento} onChange={(e) => setHrFilters((s) => ({ ...s, departamento: e.target.value }))} style={inputStyle}>
                          <option value="">Todas las áreas</option>
                          {[...new Set(hrEmployees.map((u) => u.departamento).filter(Boolean))].map((area) => <option key={area} value={area}>{area}</option>)}
                        </select>
                        <select value={hrFilters.estado} onChange={(e) => setHrFilters((s) => ({ ...s, estado: e.target.value }))} style={inputStyle}>
                          <option value="">Todos los estados</option>
                          <option value="Activo">Activo</option>
                          <option value="Suspendido">Suspendido</option>
                          <option value="Inactivo">Inactivo</option>
                          <option value="Retirado">Retirado</option>
                        </select>
                        <select value={hrFilters.especial} onChange={(e) => setHrFilters((s) => ({ ...s, especial: e.target.value }))} style={inputStyle}>
                          <option value="">Sin filtro especial</option>
                          <option value="docsVencidos">Documentos vencidos</option>
                          <option value="docsPorVencer">Documentos por vencer</option>
                          <option value="bajoDesempeno">Bajo desempeño</option>
                          <option value="cumpleanos">Cumpleaños próximos</option>
                          <option value="capacitaciones">Capacitaciones pendientes</option>
                        </select>
                        <select value={hrFilters.ordenar} onChange={(e) => setHrFilters((s) => ({ ...s, ordenar: e.target.value }))} style={inputStyle}>
                          <option value="nombre">Ordenar por nombre</option>
                          <option value="fechaIngreso">Fecha de ingreso</option>
                          <option value="score">Score general</option>
                          <option value="puntualidad">Puntualidad</option>
                          <option value="documentos">Documentos vencidos</option>
                          <option value="antiguedad">Antigüedad</option>
                        </select>
                      </div>
                      <div style={hrEmployeeGridStyle}>
                        {colaboradoresFiltrados.map((u) => {
                          const score = calculateEmployeeScore(u)
                          const scoreMeta = getScoreLabel(score)
                          const docsVencidos = getEmployeeDocuments(u).filter((doc) => doc.status === "vencido").length
                          return (
                            <div key={u.id} style={hrEmployeeCardStyle}>
                              <div style={hrEmployeeHeaderStyle}>
                                {u.fotoColaborador ? <img src={u.fotoColaborador} alt={u.nombre} style={collaboratorListAvatarStyle} /> : <div style={collaboratorListAvatarPlaceholderStyle}>{obtenerInicialesColaborador(u.nombre)}</div>}
                                <div>
                                  <strong>{u.nombre}</strong>
                                  <p style={userManagementUsernameStyle}>@{getUserAuth(u).username || u.username || "sin-usuario"}</p>
                                  <p style={hrMutedParagraphStyle}>{u.puesto || "Sin puesto"} · {u.departamento || "Sin área"}</p>
                                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                                    {renderStatusBadge(u.estado || (u.activo ? "Activo" : "Inactivo"), u.estado === "Activo" || u.activo ? "good" : u.estado === "Suspendido" ? "warning" : "danger")}
                                    {renderStatusBadge(score === null ? "Sin score" : `${score}%`, scoreMeta.tone)}
                                    {docsVencidos > 0 && renderStatusBadge(`${docsVencidos} docs vencidos`, "danger")}
                                  </div>
                                </div>
                              </div>
                              <div style={hrEmployeeActionsStyle}>
                                <button type="button" onClick={() => openEmployeeProfile(u)} style={userActionPrimaryButtonStyle}>Ver perfil</button>
                                {puedeGestionarUsuarios && !String(u.id).startsWith("mock-") && <button type="button" onClick={() => editarUsuario(u)} style={userActionSecondaryButtonStyle}>Editar</button>}
                                {puedeGestionarUsuarios && !String(u.id).startsWith("mock-") && <button type="button" onClick={() => toggleUsuarioActivo(u.id)} style={userActionDangerButtonStyle}>{u.activo ? "Desactivar" : "Activar"}</button>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {currentHRView === "employeeProfile" && (
                    <>
                      {mensajePerfilColaborador && <div style={profileSuccessMessageStyle}>{mensajePerfilColaborador}</div>}
                      {perfilColaboradorEditando ? null : renderHRProfile(selectedEmployeeProfile)}
                    </>
                  )}

                  {currentHRView === "users" && renderUserManagementView()}
                </div>
              )}

              {mostrarPerfilColaborador && false && (
              <div style={{ marginTop: "14px" }}>
                <input placeholder="Buscar usuarios..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} style={inputStyle} />
                <div style={{ marginTop: "12px" }}>
                  {colaboradoresFiltrados.map((u) => (
                    <div key={u.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "12px", padding: "14px", borderRadius: "8px", backgroundColor: "#0f1724", border: "1px solid #263244" }}>
                      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start", flex: 1 }}>
                        {u.fotoColaborador ? (
                          <img src={u.fotoColaborador} alt={u.nombre} style={collaboratorListAvatarStyle} />
                        ) : (
                          <div style={collaboratorListAvatarPlaceholderStyle}>{obtenerInicialesColaborador(u.nombre)}</div>
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{u.nombre} <span style={{ color: "#9ca3af", fontWeight: 400 }}>({u.username})</span></div>
                          <div style={{ color: "#cbd5e1", fontSize: "0.9rem", marginTop: "4px" }}>{u.rol} · {u.departamento}</div>
                          <div style={{ color: "#9ca3af", fontSize: "0.85rem", marginTop: "4px" }}>{[u.correo, u.telefono].filter(Boolean).join(" · ") || "Sin contacto registrado"}</div>
                          {u.fechaInicioLabores && <div style={{ color: "#cbd5e1", fontSize: "0.85rem", marginTop: "4px" }}>Desde: {u.fechaInicioLabores}</div>}
                          {obtenerTurnosColaborador(u).length > 0 && <div style={{ color: "#cbd5e1", fontSize: "0.85rem", marginTop: "4px" }}>Turnos: {obtenerTurnosColaborador(u).map(formatearTurno).join(", ")}</div>}
                          {u.diaDescanso && <div style={{ color: "#cbd5e1", fontSize: "0.85rem", marginTop: "2px" }}>Descansa: {u.diaDescanso}</div>}
                          <div style={{ marginTop: "6px", color: u.estado === "Activo" ? "#34d399" : u.estado === "Suspendido" ? "#fbbf24" : u.estado === "Retirado" ? "#ef4444" : "#f87171" }}><strong>{u.estado || (u.activo ? "Activo" : "Inactivo")}</strong></div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexDirection: "column" }}>
                        <button onClick={() => { setColaboradorPerfilId(u.id); setPerfilColaboradorEditando(false); setMensajePerfilColaborador(""); setErroresColaborador({}) }} style={buttonStyle}>Ver perfil</button>
                        {puedeGestionarUsuarios && <button onClick={() => editarUsuario(u)} style={editButtonStyle}>Editar</button>}
                        {puedeGestionarUsuarios && <button onClick={() => { const np = prompt("Nueva contraseña:"); if (np) cambiarContrasena(u.id, np) }} style={buttonStyle}>Cambiar pwd</button>}
                        {puedeGestionarUsuarios && <button onClick={() => toggleUsuarioActivo(u.id)} style={deleteButtonStyle}>{u.activo ? "Desactivar" : "Activar"}</button>}
                      </div>
                    </div>
                  ))}
                </div>
                {colaboradorPerfil && (
                  <div style={profileShellStyle}>
                    {mensajePerfilColaborador && (
                      <div style={profileSuccessMessageStyle}>{mensajePerfilColaborador}</div>
                    )}
                    {perfilColaboradorEditando ? (
                      <form onSubmit={guardarCambiosPerfilColaborador} style={profileEditFormStyle}>
                        {Object.keys(erroresColaborador).length > 0 && (
                          <div style={ingredientFormErrorStyle}>
                            {erroresColaborador.general || `Faltan campos requeridos: ${Object.values(erroresColaborador).join(", ")}.`}
                          </div>
                        )}

                        <div style={profileHeaderStyle}>
                          <div style={profilePhotoPanelStyle}>
                            {userForm.fotoColaborador ? (
                              <img src={userForm.fotoColaborador} alt={userForm.nombre} style={profileAvatarStyle} />
                            ) : (
                              <div style={profileAvatarPlaceholderStyle}>{obtenerInicialesColaborador(userForm.nombre)}</div>
                            )}
                            <label style={profilePhotoButtonStyle}>
                              {userForm.fotoColaborador ? "Cambiar imagen" : "Subir imagen"}
                              <input type="file" accept="image/*" onChange={subirFotoColaborador} style={{ display: "none" }} />
                            </label>
                            {userForm.fotoColaborador && (
                              <button type="button" onClick={() => setUserForm((s) => ({ ...s, fotoColaborador: "" }))} style={profilePhotoDeleteButtonStyle}>
                                Eliminar imagen
                              </button>
                            )}
                          </div>
                          <div style={{ flex: 1, minWidth: "240px" }}>
                            <h2 style={{ marginTop: 0 }}>Editar perfil</h2>
                            <p style={{ color: "#cbd5e1" }}>Actualiza la información del colaborador seleccionado.</p>
                          </div>
                        </div>

                        <div style={profileGridStyle}>
                          <div style={profileCardStyle}>
                            <h3>Información básica</h3>
                            <input placeholder="Nombre completo" value={userForm.nombre} onChange={(e) => actualizarCampoColaborador("nombre", e.target.value)} style={erroresColaborador.nombre ? inputErrorStyle : inputStyle} />
                            <input placeholder="Username" value={userForm.username} onChange={(e) => actualizarCampoColaborador("username", e.target.value)} style={erroresColaborador.username ? inputErrorStyle : inputStyle} />
                            <input placeholder="Correo" type="email" value={userForm.correo} onChange={(e) => actualizarCampoColaborador("correo", e.target.value)} style={erroresColaborador.correo ? inputErrorStyle : inputStyle} />
                            <input placeholder="Teléfono" value={userForm.telefono} onChange={(e) => actualizarCampoColaborador("telefono", e.target.value)} style={inputStyle} />
                            <input placeholder="Puesto/Cargo" value={userForm.puesto} onChange={(e) => actualizarCampoColaborador("puesto", e.target.value)} style={inputStyle} />
                            <input placeholder="Supervisor directo" value={userForm.supervisorDirecto} onChange={(e) => actualizarCampoColaborador("supervisorDirecto", e.target.value)} style={inputStyle} />
                            <input placeholder="Contacto de emergencia" value={userForm.contactoEmergencia} onChange={(e) => actualizarCampoColaborador("contactoEmergencia", e.target.value)} style={inputStyle} />
                          </div>

                          <div style={profileCardStyle}>
                            <h3>Rol y estado</h3>
                            <select value={userForm.departamento} onChange={(e) => actualizarCampoColaborador("departamento", e.target.value)} style={erroresColaborador.departamento ? inputErrorStyle : inputStyle}>
                              <option value="">Selecciona departamento</option>
                              {departamentosDisponibles.map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <select value={userForm.rol} onChange={(e) => actualizarCampoColaborador("rol", e.target.value)} style={erroresColaborador.rol ? inputErrorStyle : inputStyle}>
                              <option value="">Selecciona rol</option>
                              {rolesDisponibles.map((r) => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <select value={userForm.estado} onChange={(e) => actualizarCampoColaborador("estado", e.target.value)} style={erroresColaborador.estado ? inputErrorStyle : inputStyle}>
                              <option value="">Estado</option>
                              <option value="Activo">Activo</option>
                              <option value="Suspendido">Suspendido</option>
                              <option value="Inactivo">Inactivo</option>
                              <option value="Retirado">Retirado</option>
                            </select>
                            <input placeholder="Nueva contraseña (opcional)" type="password" value={userForm.password} onChange={(e) => actualizarCampoColaborador("password", e.target.value)} style={inputStyle} />
                          </div>

                          <div style={profileCardStyle}>
                            <h3>Fechas</h3>
                            <label style={fieldLabelStyle}>Fecha de inicio de labores</label>
                            <input type="date" value={userForm.fechaInicioLabores} onChange={(e) => actualizarCampoColaborador("fechaInicioLabores", e.target.value)} style={erroresColaborador.fechaInicioLabores ? inputErrorStyle : inputStyle} />
                            <label style={fieldLabelStyle}>Fecha de nacimiento</label>
                            <input type="date" value={userForm.fechaCumpleanos} onChange={(e) => actualizarCampoColaborador("fechaCumpleanos", e.target.value)} style={inputStyle} />
                          </div>

                          <div style={profileCardStyle}>
                            <h3>Horarios/turnos</h3>
                            {renderControlesTurno("Agregar turno")}
                            {renderTurnosColaborador(obtenerTurnosColaborador(userForm), true)}
                            {erroresColaborador.turnos && <p style={fieldErrorStyle}>{erroresColaborador.turnos}</p>}
                          </div>

                          <div style={profileCardStyle}>
                            <h3>Documentos adjuntos</h3>
                            <select value={documentoTemp.tipo} onChange={(e) => setDocumentoTemp((s) => ({ ...s, tipo: e.target.value }))} style={inputStyle}>
                              <option value="dpiFrontal">DPI Frontal</option>
                              <option value="dpiReverso">DPI Reverso</option>
                              <option value="tarjetaSalud">Tarjeta de Salud</option>
                              <option value="tarjetaManipulacionAlimentos">Tarjeta de Manipulación de Alimentos</option>
                              <option value="otros">Otros</option>
                            </select>
                            <input type="file" onChange={subirDocumentoColaborador} style={inputStyle} />
                            <div style={{ display: "grid", gap: "6px", color: "#cbd5e1" }}>
                              <span>DPI: {userForm.documentos.dpiFrontal || userForm.documentos.dpiReverso ? "Registrado" : "Pendiente"}</span>
                              <span>Tarjeta de salud: {userForm.documentos.tarjetaSalud ? "Registrada" : "Pendiente"}</span>
                              <span>Manipulación de alimentos: {userForm.documentos.tarjetaManipulacionAlimentos ? "Registrada" : "Pendiente"}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ padding: "0 16px 16px" }}>
                          <div style={profileCardStyle}>
                            <h3>Notas internas</h3>
                            <textarea placeholder="Notas internas..." value={userForm.observaciones} onChange={(e) => actualizarCampoColaborador("observaciones", e.target.value)} style={{ ...inputStyle, minHeight: "90px" }} />
                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                              <button type="submit" style={buttonStyle}>Guardar cambios</button>
                              <button type="button" onClick={cancelarEdicionPerfilColaborador} style={cancelButtonStyle}>Cancelar edición</button>
                            </div>
                          </div>
                        </div>
                      </form>
                    ) : (
                    <>
                    <div style={profileHeaderStyle}>
                      <div style={profilePhotoPanelStyle}>
                        {colaboradorPerfil.fotoColaborador ? (
                          <img src={colaboradorPerfil.fotoColaborador} alt={colaboradorPerfil.nombre} style={profileAvatarStyle} />
                        ) : (
                          <div style={profileAvatarPlaceholderStyle}>{obtenerInicialesColaborador(colaboradorPerfil.nombre)}</div>
                        )}
                        <div style={profilePhotoActionsStyle}>
                          <label style={profilePhotoButtonStyle}>
                            {colaboradorPerfil.fotoColaborador ? "Cambiar imagen" : "Subir imagen"}
                            <input type="file" accept="image/*" onChange={cambiarFotoPerfilColaborador} style={{ display: "none" }} />
                          </label>
                          {colaboradorPerfil.fotoColaborador && (
                            <button type="button" onClick={eliminarFotoPerfilColaborador} style={profilePhotoDeleteButtonStyle}>
                              Eliminar imagen
                            </button>
                          )}
                        </div>
                      </div>
                      <div style={{ flex: 1, minWidth: "240px" }}>
                        <h2 style={{ margin: 0 }}>{colaboradorPerfil.nombre}</h2>
                        <p style={{ color: "#cbd5e1" }}>{colaboradorPerfil.puesto || "Sin puesto"} · {colaboradorPerfil.departamento || "Sin departamento"}</p>
                        <p style={{ color: colaboradorPerfil.estado === "Activo" || colaboradorPerfil.activo ? "#34d399" : "#f87171" }}>{colaboradorPerfil.estado || (colaboradorPerfil.activo ? "Activo" : "Inactivo")}</p>
                        {puedeGestionarUsuarios && (
                          <button type="button" onClick={() => iniciarEdicionPerfilColaborador(colaboradorPerfil)} style={editButtonStyle}>
                            Editar perfil
                          </button>
                        )}
                      </div>
                    </div>
                    <div style={profileGridStyle}>
                      <div style={profileCardStyle}><h3>Datos de contacto</h3><p>Teléfono: {colaboradorPerfil.telefono || "No registrado"}</p><p>Correo: {colaboradorPerfil.correo || "No registrado"}</p><p>Rol: {colaboradorPerfil.rol}</p></div>
                      <div style={profileCardStyle}><h3>Fechas</h3><p>Ingreso: {colaboradorPerfil.fechaInicioLabores || "No registrado"}</p><p>Cumpleaños: {colaboradorPerfil.fechaCumpleanos || "No registrado"}</p></div>
                      <div style={profileCardStyle}><h3>Horario/turnos</h3>{renderTurnosColaborador(obtenerTurnosColaborador(colaboradorPerfil))}</div>
                      <div style={profileCardStyle}><h3>Documentos</h3><p>DPI: {colaboradorPerfil.documentos?.dpiFrontal || colaboradorPerfil.documentos?.dpiReverso ? "Registrado" : "Pendiente"}</p><p>Tarjeta de salud: {colaboradorPerfil.documentos?.tarjetaSalud ? "Registrada" : "Pendiente"}</p><p>Manipulación de alimentos: {colaboradorPerfil.documentos?.tarjetaManipulacionAlimentos ? "Registrada" : "Pendiente"}</p></div>
                    </div>
                    <div style={profileGridStyle}>
                      {["Asistencia", "Llegadas tarde", "Faltas", "Llamadas de atención", "Evaluaciones", "Capacitaciones", "Documentos vencidos o próximos a vencer", "Historial laboral"].map((titulo) => (
                        <div key={titulo} style={profileCardStyle}>
                          <h3>{titulo}</h3>
                          <p style={{ color: "#94a3b8" }}>Sin registros pendientes.</p>
                        </div>
                      ))}
                    </div>
                    </>
                    )}
                  </div>
                )}
              </div>
              )}
            </>
          )}
        </div>
      )}

      {seccionActiva === "recetas" && (
        <div style={cardStyle}>
          <h2>Recetas Estandarizadas</h2>
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "20px" }}>
            <button
              onClick={() => setRecetasSubseccion("agregar")}
              style={recetasSubseccionVisible === "agregar" ? activeTabButtonStyle : sectionButtonStyle}
              disabled={!puedeGestionarRecetas}
            >
              Agregar receta estandarizada
            </button>
            <button
              onClick={() => setRecetasSubseccion("biblioteca")}
              style={recetasSubseccionVisible === "biblioteca" ? activeTabButtonStyle : sectionButtonStyle}
            >
              Biblioteca de recetas
            </button>
          </div>

          {recetasSubseccionVisible === "agregar" ? (
            <>
              {!puedeGestionarRecetas && (
                <div style={{ ...infoBoxStyle, marginBottom: "16px" }}>
                  Solo Administrador y Gerente General pueden agregar recetas. Revisa la biblioteca.
                </div>
              )}
              <form onSubmit={guardarReceta} style={{ display: "grid", gap: "18px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label style={fieldLabelStyle}>Tipo de receta</label>
                    <select
                      value={recetaForm.tipo}
                      onChange={(e) => setRecetaForm((s) => ({ ...s, tipo: e.target.value }))}
                      style={inputStyle}
                      disabled={!puedeGestionarRecetas}
                    >
                      <option>Preparación</option>
                      <option>Receta Final</option>
                    </select>
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Área encargada</label>
                    <select
                      value={recetaForm.areaEncargada}
                      onChange={(e) => setRecetaForm((s) => ({ ...s, areaEncargada: e.target.value }))}
                      style={inputStyle}
                      disabled={!puedeGestionarRecetas}
                    >
                      {[
                        "Cocina",
                        "Pizzería",
                        "Panadería",
                        "Repostería",
                        "Barra",
                        "Cafetería",
                        "Mise en Place",
                        "Almacén",
                        "Administración"
                      ].map((area) => (
                        <option key={area} value={area}>
                          {area}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {recetaForm.tipo === "Receta Final" && (
                  <div style={{ ...infoBoxStyle, display: "grid", gap: "14px" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "10px", color: "#f8fafc", fontWeight: 700 }}>
                      <input
                        type="checkbox"
                        checked={recetaForm.disponibleEnPOS}
                        onChange={(e) => setRecetaForm((s) => ({ ...s, disponibleEnPOS: e.target.checked }))}
                        disabled={!puedeGestionarRecetas}
                      />
                      Disponible en POS
                    </label>
                    <p style={{ color: "#94a3b8", margin: 0 }}>
                      Al guardar, esta receta final creará o actualizará el producto vendible conectado.
                    </p>
                    {recetaForm.disponibleEnPOS && (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "14px" }}>
                        <div>
                          <label style={fieldLabelStyle}>Categoría POS</label>
                          <select
                            value={recetaForm.categoriaPOS}
                            onChange={(e) => {
                              const categoryId = e.target.value
                              const suggestedArea = {
                                pizzas: "pizzeria",
                                cafeteria: "cafeteria",
                                barra: "barra",
                                postres: "reposteria"
                              }[categoryId] || "cocina"
                              setRecetaForm((s) => ({ ...s, categoriaPOS: categoryId, areaProduccion: suggestedArea }))
                            }}
                            style={inputStyle}
                            disabled={!puedeGestionarRecetas}
                          >
                            {[
                              ["entradas", "Entradas"],
                              ["pizzas", "Pizzas"],
                              ["sandwiches", "Sándwiches"],
                              ["postres", "Postres"],
                              ["cafeteria", "Cafetería"],
                              ["barra", "Barra"],
                              ["extras", "Extras"]
                            ].map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={fieldLabelStyle}>Área de producción POS</label>
                          <select value={recetaForm.areaProduccion} onChange={(e) => setRecetaForm((s) => ({ ...s, areaProduccion: e.target.value }))} style={inputStyle} disabled={!puedeGestionarRecetas}>
                            {[
                              ["cocina", "Cocina"],
                              ["pizzeria", "Pizzería"],
                              ["barra", "Barra"],
                              ["cafeteria", "Cafetería"],
                              ["reposteria", "Repostería"],
                              ["panaderia", "Panadería"]
                            ].map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                          </select>
                        </div>
                        <div>
                          <label style={fieldLabelStyle}>Precio de venta</label>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            value={recetaForm.precioVenta}
                            onChange={(e) => setRecetaForm((s) => ({ ...s, precioVenta: e.target.value }))}
                            placeholder="0.00"
                            style={inputStyle}
                            disabled={!puedeGestionarRecetas}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label style={fieldLabelStyle}>Nombre de la receta</label>
                    <input
                      value={recetaForm.nombre}
                      onChange={(e) => setRecetaForm((s) => ({ ...s, nombre: e.target.value }))}
                      style={inputStyle}
                      disabled={!puedeGestionarRecetas}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Rendimiento</label>
                    <input
                      value={recetaForm.rendimiento}
                      onChange={(e) => setRecetaForm((s) => ({ ...s, rendimiento: e.target.value }))}
                      placeholder="5 litros, 20 porciones, 2 kg"
                      style={inputStyle}
                      disabled={!puedeGestionarRecetas}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                  <div>
                    <label style={fieldLabelStyle}>Tiempo de preparación</label>
                    <input
                      value={recetaForm.tiempoPreparacion}
                      onChange={(e) => setRecetaForm((s) => ({ ...s, tiempoPreparacion: e.target.value }))}
                      placeholder="30 minutos, 1 hora 30 minutos"
                      style={inputStyle}
                      disabled={!puedeGestionarRecetas}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Imagen final de la receta</label>
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                      <label htmlFor="imagen-receta" style={{ ...buttonStyle, marginRight: 0, opacity: puedeGestionarRecetas ? 1 : 0.5, cursor: puedeGestionarRecetas ? "pointer" : "not-allowed" }}>
                        Subir imagen de receta
                      </label>
                      <input
                        id="imagen-receta"
                        type="file"
                        accept="image/*"
                        onChange={subirImagenReceta}
                        style={{ display: "none" }}
                        disabled={!puedeGestionarRecetas}
                      />
                    </div>
                    {recetaForm.imagen && (
                      <img
                        src={recetaForm.imagen}
                        alt="Vista previa receta"
                        style={{ width: "100%", maxHeight: "220px", objectFit: "cover", borderRadius: "12px", marginTop: "12px" }}
                      />
                    )}
                  </div>
                </div>

                <div style={infoBoxStyle}>
                  <h3 style={{ marginTop: 0 }}>Ingredientes de la receta</h3>
                  <input
                    placeholder="Buscar ingrediente en inventario..."
                    value={recetaBusquedaIngrediente}
                    onChange={(e) => setRecetaBusquedaIngrediente(e.target.value)}
                    style={inputStyle}
                    disabled={!puedeGestionarRecetas}
                  />
                  {ingredientesRecetaSugeridos.length > 0 && recetaBusquedaIngrediente && (
                    <div style={suggestionsBoxStyle}>
                      {ingredientesRecetaSugeridos.map((ingrediente) => (
                        <button
                          type="button"
                          key={ingrediente.id}
                          onClick={() => seleccionarIngredienteReceta(ingrediente)}
                          style={suggestionItemStyle}
                          disabled={!puedeGestionarRecetas}
                        >
                          <img src={ingrediente.imagen || ""} alt="" style={suggestionThumbnailStyle} />
                          <div style={{ textAlign: "left" }}>
                            <div style={{ fontWeight: 700 }}>{ingrediente.nombre}</div>
                            <div style={{ color: "#9ca3af", fontSize: "0.9rem" }}>
                              {ingrediente.unidad || "Unidad base no definida"}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {ingredienteRecetaSeleccionado && (
                    <div style={{ display: "grid", gridTemplateColumns: "80px 1.2fr 1fr 1fr auto", gap: "10px", alignItems: "center", marginTop: "16px", backgroundColor: "#111827", padding: "14px", borderRadius: "12px", border: "1px solid #374151" }}>
                      <img src={ingredienteRecetaSeleccionado.imagen || ""} alt={ingredienteRecetaSeleccionado.nombre} style={{ width: "70px", height: "70px", objectFit: "cover", borderRadius: "12px", backgroundColor: "#0f172a" }} />
                      <div>
                        <div style={{ fontWeight: 700 }}>{ingredienteRecetaSeleccionado.nombre}</div>
                        <div style={{ color: "#9ca3af", fontSize: "0.9rem" }}>Edita la cantidad y unidad antes de agregar.</div>
                      </div>
                      <input
                        placeholder="Cantidad"
                        value={ingredienteRecetaSeleccionado.cantidad}
                        onChange={(e) => setIngredienteRecetaSeleccionado((s) => ({ ...s, cantidad: e.target.value }))}
                        style={inputStyle}
                      />
                      <select
                        value={ingredienteRecetaSeleccionado.unidad}
                        onChange={(e) => setIngredienteRecetaSeleccionado((s) => ({ ...s, unidad: e.target.value }))}
                        style={inputStyle}
                      >
                        {["gramos", "kilogramos", "mililitros", "litros", "onzas", "libras", "galón", "unidad", "pieza", "lata", "bolsa", "botella", "bandeja", "cucharada", "cucharadita", "taza", "porción"].map((unidad) => (
                          <option key={unidad} value={unidad}>
                            {unidad}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={agregarIngredienteSeleccionado} style={buttonStyle}>
                        Agregar ingrediente a receta
                      </button>
                    </div>
                  )}

                  <div style={{ marginTop: "22px" }}>
                    <h4 style={{ marginBottom: "12px" }}>Ingredientes agregados a la receta</h4>
                    {recetaForm.ingredientes.length > 0 ? (
                      <div style={{ display: "grid", gap: "10px" }}>
                        {recetaForm.ingredientes.map((item, index) => (
                          <div key={item.ingredienteId} style={{ display: "grid", gridTemplateColumns: "60px 1.4fr 1fr 1fr auto", gap: "10px", alignItems: "center", backgroundColor: "#0f172a", padding: "12px", borderRadius: "12px", border: "1px solid #334155" }}>
                            <img src={item.imagen || ""} alt={item.nombre} style={{ width: "52px", height: "52px", objectFit: "cover", borderRadius: "10px", backgroundColor: "#1f2937" }} />
                            <div style={{ color: "#f8fafc", fontWeight: 600 }}>{index + 1}. {item.nombre}</div>
                            <div style={{ color: "#cbd5e1" }}>{item.cantidad || "-"}</div>
                            <div style={{ color: "#cbd5e1" }}>{item.unidad || "-"}</div>
                            <button type="button" onClick={() => eliminarIngredienteReceta(item.ingredienteId)} style={deleteButtonStyle}>
                              Eliminar
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: "#9ca3af", marginTop: "10px" }}>
                        Ningún ingrediente agregado. Busca un ingrediente y agrégalo a la receta.
                      </p>
                    )}
                  </div>
                </div>

                <div style={infoBoxStyle}>
                  <h3 style={{ marginTop: 0 }}>Proceso de preparación</h3>
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <input
                      placeholder={`Paso ${recetaForm.pasos.length + 1}: escribe el paso...`}
                      value={recetaPasoTexto}
                      onChange={(e) => setRecetaPasoTexto(e.target.value)}
                      style={{ ...inputStyle, flex: 1 }}
                      disabled={!puedeGestionarRecetas}
                    />
                    <button type="button" onClick={agregarPasoReceta} style={buttonStyle} disabled={!puedeGestionarRecetas}>
                      + Agregar paso
                    </button>
                  </div>
                  {recetaForm.pasos.length > 0 && (
                    <ol style={{ marginTop: "14px", paddingLeft: "20px" }}>
                      {recetaForm.pasos.map((paso) => (
                        <li key={paso.numero} style={{ marginBottom: "10px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px" }}>
                            <span>{paso.descripcion}</span>
                            {puedeGestionarRecetas && (
                              <button type="button" onClick={() => eliminarPasoReceta(paso.numero)} style={deleteButtonStyle}>
                                Eliminar
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>

                <div style={{ backgroundColor: "#111827", border: "1px solid #374151", borderRadius: "12px", padding: "20px" }}>
                  <h3 style={{ marginTop: 0, marginBottom: "18px" }}>Vista previa de receta</h3>
                  <div style={{ display: "grid", gap: "20px" }}>
                    <div style={{ display: "grid", gap: "12px" }}>
                      <span style={{ color: "#9ca3af", fontSize: "0.95rem", letterSpacing: "0.08em" }}>RECETA ESTANDARIZADA</span>
                      <h3 style={{ margin: 0, color: "#f8fafc" }}>{recetaForm.nombre || "Nombre de la receta"}</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", color: "#cbd5e1" }}>
                        <div><strong>Tipo:</strong> {recetaForm.tipo}</div>
                        <div><strong>Rendimiento:</strong> {recetaForm.rendimiento || "-"}</div>
                        <div><strong>Tiempo:</strong> {recetaForm.tiempoPreparacion || "-"}</div>
                        <div><strong>Área encargada:</strong> {recetaForm.areaEncargada}</div>
                        {recetaForm.tipo === "Receta Final" && <div><strong>POS:</strong> {recetaForm.disponibleEnPOS ? "Disponible" : "No publicado"}</div>}
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", alignItems: "start" }}>
                      <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", overflow: "hidden", minHeight: "260px", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }}>
                        {recetaForm.imagen ? (
                          <img src={recetaForm.imagen} alt="Imagen de receta" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "14px" }} />
                        ) : (
                          <div style={{ color: "#64748b", textAlign: "center" }}>Imagen de receta</div>
                        )}
                      </div>
                      <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", padding: "16px", border: "1px solid #334155" }}>
                        <div style={{ marginBottom: "12px", color: "#f8fafc", fontWeight: 700 }}>INGREDIENTES</div>
                        {recetaForm.ingredientes.length > 0 ? (
                          <table style={{ width: "100%", borderCollapse: "collapse", color: "#e2e8f0" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Ingrediente</th>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Cantidad</th>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Unidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recetaForm.ingredientes.map((item) => (
                                <tr key={item.ingredienteId}>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.nombre}</td>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.cantidad || "-"}</td>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.unidad || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p style={{ color: "#9ca3af", margin: 0 }}>No hay ingredientes agregados.</p>
                        )}
                      </div>
                    </div>

                    <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", padding: "18px", border: "1px solid #334155" }}>
                      <div style={{ marginBottom: "12px", color: "#f8fafc", fontWeight: 700 }}>PROCESO</div>
                      {recetaForm.pasos.length > 0 ? (
                        <ol style={{ marginTop: 0, paddingLeft: "20px", color: "#e2e8f0" }}>
                          {recetaForm.pasos.map((paso) => (
                            <li key={paso.numero} style={{ marginBottom: "10px", lineHeight: 1.6 }}>{paso.descripcion}</li>
                          ))}
                        </ol>
                      ) : (
                        <p style={{ color: "#9ca3af", margin: 0 }}>No hay pasos agregados.</p>
                      )}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginTop: "10px" }}>
                  <button type="submit" style={buttonStyle} disabled={!puedeGestionarRecetas}>
                    Guardar receta en biblioteca
                  </button>
                  <button type="button" onClick={limpiarFormularioReceta} style={cancelButtonStyle}>
                    Limpiar formulario
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
                <input
                  placeholder="Buscar recetas..."
                  value={recetasBusqueda}
                  onChange={(e) => setRecetasBusqueda(e.target.value)}
                  style={inputStyle}
                />
                <select value={recetasFiltro} onChange={(e) => setRecetasFiltro(e.target.value)} style={inputStyle}>
                  {["Todas", "Preparaciones", "Recetas Finales", "Cocina", "Pizzería", "Panadería", "Repostería", "Barra", "Cafetería", "Mise en Place"].map((filtro) => (
                    <option key={filtro} value={filtro}>
                      {filtro}
                    </option>
                  ))}
                </select>
              </div>

              {recetasFiltradas.length === 0 ? (
                <p style={{ color: "#9ca3af" }}>No hay recetas que coincidan con la búsqueda o el filtro.</p>
              ) : (
                <div style={gridStyle}>
                  {recetasFiltradas.map((receta) => (
                    <div key={receta.id} style={cardInventario}>
                      {receta.imagen && (
                        <img src={receta.imagen} alt={receta.nombre} style={{ width: "100%", height: "180px", objectFit: "cover", borderRadius: "12px", marginBottom: "12px" }} />
                      )}
                      <h3 style={{ margin: "0 0 10px" }}>{receta.nombre}</h3>
                      <p style={{ margin: "6px 0", color: "#9ca3af" }}><strong>Tipo:</strong> {receta.tipo}</p>
                      <p style={{ margin: "6px 0", color: "#9ca3af" }}><strong>Rendimiento:</strong> {receta.rendimiento}</p>
                      <p style={{ margin: "6px 0", color: "#9ca3af" }}><strong>Tiempo:</strong> {receta.tiempoPreparacion}</p>
                      <p style={{ margin: "6px 0", color: "#9ca3af" }}><strong>Área:</strong> {receta.areaEncargada}</p>
                      {receta.tipo === "Receta Final" && (
                        <p style={{ margin: "6px 0", color: receta.disponibleEnPOS ? "#34d399" : "#94a3b8" }}>
                          <strong>POS:</strong> {receta.disponibleEnPOS ? "Producto conectado" : "No publicado"}
                        </p>
                      )}
                      <p style={{ margin: "6px 0", color: "#9ca3af" }}><strong>Ingredientes:</strong> {receta.ingredientes?.length || 0}</p>
                      <p style={{ margin: "6px 0 12px", color: "#9ca3af" }}><strong>Pasos:</strong> {receta.pasos?.length || 0}</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                        <button onClick={() => verReceta(receta)} style={buttonStyle}>Ver receta</button>
                        <button onClick={() => descargarRecetaPdf(receta)} style={pdfButtonStyle}>Descargar PDF</button>
                        {puedeGestionarRecetas && (
                          <button onClick={() => editarReceta(receta)} style={buttonStyle}>Editar</button>
                        )}
                        {puedeGestionarRecetas && (
                          <button onClick={() => eliminarReceta(receta.id)} style={deleteButtonStyle}>Eliminar receta</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {recetaDetalle && (
                <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.75)", zIndex: 200, padding: "24px", overflowY: "auto" }}>
                  <div style={{ maxWidth: "840px", margin: "0 auto", backgroundColor: "#0f172a", borderRadius: "16px", padding: "24px", border: "1px solid #374151" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", marginBottom: "18px" }}>
                      <h3 style={{ margin: 0 }}>{recetaDetalle.nombre}</h3>
                      <button onClick={() => setRecetaDetalle(null)} style={cancelButtonStyle}>Cerrar</button>
                    </div>
                    {recetaDetalle.imagen && (
                      <img src={recetaDetalle.imagen} alt={recetaDetalle.nombre} style={{ width: "100%", maxHeight: "240px", objectFit: "cover", borderRadius: "12px", marginBottom: "16px" }} />
                    )}
                    <div style={{ display: "grid", gap: "18px" }}>
                      <div style={{ display: "grid", gap: "8px", color: "#cbd5e1" }}>
                        <span style={{ color: "#9ca3af", letterSpacing: "0.08em", fontSize: "0.9rem" }}>RECETA ESTANDARIZADA</span>
                        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#f8fafc" }}>{recetaDetalle.nombre}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                          <div><strong>Tipo:</strong> {recetaDetalle.tipo}</div>
                          <div><strong>Rendimiento:</strong> {recetaDetalle.rendimiento}</div>
                          <div><strong>Tiempo:</strong> {recetaDetalle.tiempoPreparacion}</div>
                          <div><strong>Área encargada:</strong> {recetaDetalle.areaEncargada}</div>
                        </div>
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" }}>
                        <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", overflow: "hidden", minHeight: "240px", display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }}>
                          {recetaDetalle.imagen ? (
                            <img src={recetaDetalle.imagen} alt={recetaDetalle.nombre} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "14px" }} />
                          ) : (
                            <div style={{ color: "#64748b", textAlign: "center" }}>Imagen de receta</div>
                          )}
                        </div>
                        <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", padding: "16px", border: "1px solid #334155" }}>
                          <div style={{ marginBottom: "12px", color: "#f8fafc", fontWeight: 700 }}>INGREDIENTES</div>
                          <table style={{ width: "100%", borderCollapse: "collapse", color: "#e2e8f0" }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Ingrediente</th>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Cantidad</th>
                                <th style={{ textAlign: "left", padding: "8px 6px", borderBottom: "1px solid #334155" }}>Unidad</th>
                              </tr>
                            </thead>
                            <tbody>
                              {recetaDetalle.ingredientes.map((item) => (
                                <tr key={item.ingredienteId}>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.nombre}</td>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.cantidad || "-"}</td>
                                  <td style={{ padding: "8px 6px", borderBottom: "1px solid #334155" }}>{item.unidad || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      <div style={{ backgroundColor: "#0f172a", borderRadius: "14px", padding: "18px", border: "1px solid #334155" }}>
                        <div style={{ marginBottom: "12px", color: "#f8fafc", fontWeight: 700 }}>PROCESO</div>
                        <ol style={{ marginTop: 0, paddingLeft: "20px", color: "#e2e8f0" }}>
                          {recetaDetalle.pasos.map((paso) => (
                            <li key={paso.numero} style={{ marginBottom: "10px", lineHeight: 1.6 }}>{paso.descripcion}</li>
                          ))}
                        </ol>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "10px", marginTop: "20px", flexWrap: "wrap" }}>
                      <button onClick={() => descargarRecetaPdf(recetaDetalle)} style={pdfButtonStyle}>Descargar PDF</button>
                      {puedeGestionarRecetas && (
                        <button onClick={() => editarReceta(recetaDetalle)} style={buttonStyle}>Editar receta</button>
                      )}
                      {puedeGestionarRecetas && (
                        <button onClick={() => eliminarReceta(recetaDetalle.id)} style={deleteButtonStyle}>Eliminar receta</button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {seccionActiva === "requisicion" ? (
        <>
          <div style={cardStyle}>
            <h2>Requisición segura</h2>
            {notificacionRequisicion && (
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: "10px",
                  border: tipoNotificacion === "error"
                    ? "1px solid #fca5a5"
                    : "1px solid #34d399",
                  backgroundColor: tipoNotificacion === "error"
                    ? "#fee2e2"
                    : "#d1fae5",
                  color: tipoNotificacion === "error" ? "#991b1b" : "#065f46",
                  marginBottom: "16px"
                }}
              >
                {notificacionRequisicion}
              </div>
            )}
            {!usuarioActual ? (
              <>
                <p>
                  Solo colaboradores autorizados pueden crear requisiciones.
                  Inicia sesión para continuar.
                </p>
                <input
                  type="text"
                  placeholder="Usuario"
                  value={usuarioLogin}
                  onChange={(e) => setUsuarioLogin(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="password"
                  placeholder="Contraseña"
                  value={contrasenaLogin}
                  onChange={(e) => setContrasenaLogin(e.target.value)}
                  style={inputStyle}
                />
                <button onClick={iniciarSesion} style={buttonStyle}>
                  Iniciar sesión
                </button>
                <p style={{ color: "#9ca3af", marginTop: "12px" }}>
                  Ejemplos: admin / admin o colaborador / 1234
                </p>
              </>
            ) : (
              <>
                <div style={buttonRowStyle}>
                  <div>
                    <strong>Bienvenido:</strong> {usuarioActual.nombre}
                  </div>
                  <button onClick={cerrarSesion} style={cancelButtonStyle}>
                    Cerrar sesión
                  </button>
                </div>
                <div style={requisitionNotificationsStyle}>
                  <div style={requisitionNotificationsHeaderStyle}>
                    <h3 style={{ margin: 0 }}>Requisiciones y traslados</h3>
                    <span style={requisitionPendingBadgeStyle}>{requisicionesPendientes.length}</span>
                  </div>
                  {requisiciones.length === 0 ? (
                    <p>No hay requisiciones registradas en este momento.</p>
                  ) : (
                    requisiciones.map((req) => {
                      const requisition = normalizeRequisition(req)
                      const items = requisition.items

                      return (
                        <div key={req.id} style={orderItemStyle}>
                          <p><strong>Requisición:</strong> #{req.id}</p>
                          <p><strong>Origen:</strong> {getAreaLabel(requisition.fromLocation)} · <strong>Destino:</strong> {getAreaLabel(requisition.toLocation)}</p>
                          <p><strong>Ingredientes:</strong> {items.length}</p>
                          {items.slice(0, 3).map((item, index) => (
                            <p key={index}>{item.itemName} - {item.requestedQty} {item.unit}</p>
                          ))}
                          {items.length > 3 && <p>...y {items.length - 3} más</p>}
                          <p>Solicitante: {requisition.requestedBy}</p>
                          <p>Estado: {requisition.status}</p>
                          <div style={buttonRowStyle}>
                            <button onClick={() => verRequisicion(req.id)} style={editButtonStyle}>
                              Ver requisición
                            </button>
                            {requisition.status === "pending" && <button onClick={() => aceptarRequisicion(req)} style={purchaseButtonStyle}>Aprobar</button>}
                            {["pending", "approved"].includes(requisition.status) && <button onClick={() => completeRequisition(req.id)} style={buttonStyle}>Completar traslado</button>}
                            {["pending", "approved"].includes(requisition.status) && <button onClick={() => cambiarEstadoRequisicion(req.id, "rejected")} style={deleteButtonStyle}>Rechazar</button>}
                            {["pending", "approved"].includes(requisition.status) && <button onClick={() => cambiarEstadoRequisicion(req.id, "cancelled")} style={cancelButtonStyle}>Cancelar</button>}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
                {!mostrarFormularioRequisicion && (
                  <button
                    type="button"
                    onClick={() => {
                      setMostrarFormularioRequisicion(true)
                      setErroresRequisicion({})
                    }}
                    style={addIngredientToggleButtonStyle}
                  >
                    + Hacer requisición nueva
                  </button>
                )}
                {mostrarFormularioRequisicion && (
                  <div style={requisitionFormCardStyle}>
                <label style={fieldLabelStyle}>Origen</label>
                <input value={getAreaLabel("almacen")} style={inputStyle} disabled />
                <label style={fieldLabelStyle}>Área de destino</label>
                <select value={requisicionDestino} onChange={(e) => setRequisicionDestino(e.target.value)} style={inputStyle}>
                  <option value="">Selecciona un área</option>
                  {areas.filter((area) => area.id !== "almacen" && area.active !== false && area.canRequestInventory !== false).map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
                {erroresRequisicion.destino && <p style={fieldErrorStyle}>{erroresRequisicion.destino}</p>}
                <h3>Buscar ingrediente</h3>
                <input
                  type="text"
                  placeholder="Escribe el nombre o código..."
                  value={requisicionBusqueda}
                  onChange={(e) => {
                    setRequisicionBusqueda(e.target.value)
                    setIngredienteSeleccionadoId(null)
                    setErroresRequisicion((actuales) => {
                      const siguientes = { ...actuales }
                      delete siguientes.ingrediente
                      return siguientes
                    })
                  }}
                  style={inputStyle}
                />
                {requisicionBusqueda && (
                  <div style={suggestionsBoxStyle}>
                    {ingredientesSugeridos.length > 0 ? (
                      ingredientesSugeridos.map((ingrediente) => (
                        <button
                          key={ingrediente.id}
                          type="button"
                          onClick={() => {
                            setIngredienteSeleccionadoId(ingrediente.id)
                            setRequisicionBusqueda(ingrediente.nombre)
                          }}
                          style={suggestionItemStyle}
                        >
                          {ingrediente.imagen ? (
                            <img
                              src={ingrediente.imagen}
                              alt={ingrediente.nombre}
                              style={suggestionThumbnailStyle}
                            />
                          ) : (
                            <div style={suggestionPlaceholderThumbStyle}>
                              Sin imagen
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600 }}>{ingrediente.nombre}</div>
                            <div style={{ color: "#9ca3af", fontSize: "0.9rem" }}>
                              {ingrediente.codigo}
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <p style={{ color: "#d1d5db" }}>No se encontró ningún ingrediente.</p>
                    )}
                  </div>
                )}
                {ingredienteSeleccionado ? (
                  <div style={infoBoxStyle}>
                    <p>
                      <strong>Ingrediente:</strong> {ingredienteSeleccionado.nombre}
                    </p>
                    <p>
                      <strong>Disponible en Almacén:</strong> {getLocationStock(ingredienteSeleccionado, "almacen")} {ingredienteSeleccionado.unidadCompra}
                    </p>
                    <p>
                      {getLocationStock(ingredienteSeleccionado, "almacen") > 0 ? (
                        <span style={{ color: "#34d399" }}>Disponible para pedir</span>
                      ) : (
                        <span style={{ color: "#f87171" }}>No hay stock disponible</span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p style={{ color: "#9ca3af" }}>
                    Selecciona un ingrediente para mostrar disponibilidad.
                  </p>
                )}
                <input
                  type="number"
                  placeholder="Cantidad a solicitar"
                  value={cantidadSolicitada}
                  onChange={(e) => {
                    setCantidadSolicitada(e.target.value)
                    setErroresRequisicion((actuales) => {
                      const siguientes = { ...actuales }
                      delete siguientes.cantidad
                      return siguientes
                    })
                  }}
                  style={inputStyle}
                />
                <button onClick={crearRequisicion} style={buttonStyle}>
                  Agregar ingrediente
                </button>
                {erroresRequisicion.items && <p style={fieldErrorStyle}>{erroresRequisicion.items}</p>}

                <div style={orderBoxStyle}>
                  <h3>Lista de ingredientes</h3>
                  {requisicionItems.length === 0 ? (
                    <p>No hay ingredientes agregados todavía.</p>
                  ) : (
                    requisicionItems.map((item) => (
                      <div key={item.ingredienteId} style={orderItemStyle}>
                        <p><strong>{item.ingredienteNombre}</strong> ({item.ingredienteCodigo})</p>
                        <p>Cant: {item.cantidadSolicitada} {item.unidad}</p>
                        <p>Stock en Almacén: {item.inventarioDisponible} {item.unidad}</p>
                        <label style={fieldLabelStyle}>Cantidad aprobada</label>
                        <input
                          type="number"
                          min="0"
                          value={item.approvedQty}
                          onChange={(e) => setRequisicionItems((actuales) => actuales.map((actual) => actual.ingredienteId === item.ingredienteId ? { ...actual, approvedQty: Number(e.target.value) } : actual))}
                          style={inputStyle}
                        />
                        <p>Disponibilidad: {item.estadoDisponibilidad}</p>
                        <button onClick={() => eliminarItemRequisicion(item.ingredienteId)} style={deleteButtonStyle}>
                          Eliminar ingrediente
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <label style={dateLabelStyle}>Fecha de requisición</label>
                <input
                  type="date"
                  value={fechaSolicitud}
                  onChange={(e) => {
                    setFechaSolicitud(e.target.value)
                    setErroresRequisicion((actuales) => {
                      const siguientes = { ...actuales }
                      delete siguientes.fechaSolicitud
                      return siguientes
                    })
                  }}
                  style={erroresRequisicion.fechaSolicitud ? inputErrorStyle : inputStyle}
                />
                {erroresRequisicion.fechaSolicitud && <p style={fieldErrorStyle}>{erroresRequisicion.fechaSolicitud}</p>}
                <label style={dateLabelStyle}>Fecha de entrega requerida</label>
                <input
                  type="date"
                  value={fechaNecesita}
                  onChange={(e) => {
                    setFechaNecesita(e.target.value)
                    setErroresRequisicion((actuales) => {
                      const siguientes = { ...actuales }
                      delete siguientes.fechaNecesita
                      return siguientes
                    })
                  }}
                  style={erroresRequisicion.fechaNecesita ? inputErrorStyle : inputStyle}
                />
                {erroresRequisicion.fechaNecesita && <p style={fieldErrorStyle}>{erroresRequisicion.fechaNecesita}</p>}
                <div style={buttonRowStyle}>
                  <button onClick={validarYEnviarRequisicion} style={purchaseButtonStyle}>
                    Enviar requisición
                  </button>
                  <button onClick={cancelarFormularioRequisicion} style={cancelButtonStyle}>
                    Cancelar
                  </button>
                </div>
                  </div>
                )}
              </>
            )}
          </div>

          {usuarioActual && (
            <div style={cardStyle}>
              <h2>Mis requisiciones</h2>
              {requisiciones.filter((req) => req.username === usuarioActual.username).length === 0 ? (
                <p>No hay requisiciones registradas.</p>
              ) : (
                requisiciones
                  .filter((req) => req.username === usuarioActual.username)
                  .map((req) => {
                    const requisition = normalizeRequisition(req)
                    const items = requisition.items

                    return (
                      <div key={req.id} style={orderItemStyle}>
                        <p><strong>Destino:</strong> {getAreaLabel(requisition.toLocation)}</p>
                        <p><strong>Ingredientes:</strong> {items.length}</p>
                        {items.map((item, index) => (
                          <p key={index}>{item.itemName} - {item.requestedQty} {item.unit}</p>
                        ))}
                        <p><strong>Fecha de requisición:</strong> {req.fechaSolicitud}</p>
                        <p><strong>Fecha de entrega requerida:</strong> {req.fechaNecesita}</p>
                        <p><strong>Estado:</strong> {requisition.status}</p>
                      </div>
                    )
                  })
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {seccionActiva === "ordenes" && (
            <>
              <div style={purchaseOrdersNavigationStyle}>
                <div style={purchaseOrdersIntroStyle}>
                  <div>
                    <h2 style={{ margin: "0 0 6px" }}>Órdenes de compra</h2>
                    <p style={{ margin: 0, color: "#cbd5e1" }}>Genera propuestas por mínimos o registra compras directas a proveedor.</p>
                  </div>
                  <div style={purchaseOrdersPrimaryActionsStyle}>
                    {puedeCrearOrdenCompra && (
                      <>
                        <button type="button" onClick={() => { generarOrdenCompra(); setPurchaseOrderView("automatic") }} style={purchaseOrderAutomaticButtonStyle}>
                          Generar orden automática
                        </button>
                        <button type="button" onClick={() => setPurchaseOrderView("manual")} style={purchaseOrderManualButtonStyle}>
                          Crear orden manual
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <nav style={purchaseOrdersTabsStyle} aria-label="Vistas de órdenes de compra">
                  <button type="button" onClick={() => setPurchaseOrderView("automatic")} style={purchaseOrderView === "automatic" ? purchaseOrdersActiveTabStyle : purchaseOrdersTabStyle}>Automática</button>
                  {puedeCrearOrdenCompra && <button type="button" onClick={() => setPurchaseOrderView("manual")} style={purchaseOrderView === "manual" ? purchaseOrdersActiveTabStyle : purchaseOrdersTabStyle}>Orden manual</button>}
                  <button type="button" onClick={() => setPurchaseOrderView("history")} style={purchaseOrderView === "history" ? purchaseOrdersActiveTabStyle : purchaseOrdersTabStyle}>Historial y recepción</button>
                </nav>
              </div>

              {purchaseOrderView === "automatic" && <div style={purchaseOrderPanelStyle}>
                <h2>Orden de compra automática</h2>

                <p>
                  El sistema revisa ingredientes en punto de orden y calcula cuánto comprar
                  para llegar al punto máximo.
                </p>

                <div style={purchaseOrderToolbarStyle}>
                  <button type="button" onClick={generarOrdenCompra} style={{ ...purchaseButtonStyle, marginRight: 0 }}>
                    Actualizar propuesta
                  </button>
                  <button type="button" onClick={descargarOrdenPDF} style={{ ...pdfButtonStyle, marginRight: 0 }}>
                    Descargar PDF
                  </button>
                  <button type="button" onClick={limpiarOrdenCompra} style={{ ...cancelButtonStyle, marginRight: 0 }}>
                    Cancelar propuesta
                  </button>
                </div>

                {ordenCompra.length > 0 && (
                  <div style={orderBoxStyle}>
                    <h3>Orden generada</h3>

                    {ordenCompra.map((item) => (
                      <div key={item.id} style={orderItemStyle}>
                        <strong>{item.nombre}</strong>
                        <p>Código: {item.codigo}</p>
                        <p>Stock actual: {item.stockActual}</p>
                        <p>Punto máximo: {item.puntoMaximo}</p>
                        <p>
                          Comprar: <strong>{item.cantidadAComprar} {item.unidadCompra}</strong>
                        </p>
                        <p>Costo estimado: Q{item.costoEstimado.toFixed(2)}</p>
                      </div>
                    ))}

                    <h3>Total estimado: Q{totalOrdenCompra.toFixed(2)}</h3>
                  </div>
                )}
              </div>}

              {purchaseOrderView === "manual" && puedeCrearOrdenCompra && <div style={purchaseOrderPanelStyle}>
                <h2>Orden de compra manual</h2>
                <p>Completa los datos de la orden y selecciona ingredientes con el buscador.</p>

                <p><strong>Número de orden:</strong> {generarNumeroOrdenManual(ordenesCompraManual.length)}</p>

                <label style={fieldLabelStyle}>Buscar ingrediente</label>
                <input
                  type="text"
                  placeholder={manualProductoCompra ? "Buscar otro ingrediente..." : "Escribe nombre o código..."}
                  value={manualBusqueda}
                  onChange={(e) => {
                    setManualBusqueda(e.target.value)
                    setManualIngredienteSeleccionadoId(null)
                    setManualCantidadComprar("")
                  }}
                  style={inputStyle}
                />
                {manualBusqueda && (
                  <div style={suggestionsBoxStyle}>
                    {manualIngredientesSugeridos.length > 0 ? (
                      manualIngredientesSugeridos.map((ingrediente) => (
                        <button
                          key={ingrediente.id}
                          type="button"
                          onClick={() => seleccionarIngredienteOrdenManual(ingrediente)}
                          style={suggestionItemStyle}
                        >
                          {ingrediente.imagen ? (
                            <img
                              src={ingrediente.imagen}
                              alt={ingrediente.nombre}
                              style={suggestionThumbnailStyle}
                            />
                          ) : (
                            <div style={suggestionPlaceholderThumbStyle}>
                              Sin imagen
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 600 }}>{ingrediente.nombre}</div>
                            <div style={{ color: "#9ca3af", fontSize: "0.9rem" }}>
                              {ingrediente.codigo || ingrediente.sku || ingrediente.codigoBarras || "Sin código"}
                            </div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <p style={{ color: "#d1d5db" }}>No se encontró ningún ingrediente.</p>
                    )}
                  </div>
                )}

                {manualProductoCompra && (
                  <div style={manualSelectedProductStyle}>
                    <div style={manualSelectedProductHeaderStyle}>
                      <div>
                        <p style={manualSelectedProductLabelStyle}>Producto seleccionado</p>
                        <h3 style={manualSelectedProductTitleStyle}>{manualProductoCompra.nombre}</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setManualIngredienteSeleccionadoId(null)
                          setManualCantidadComprar("")
                          setManualBusqueda("")
                        }}
                        style={purchaseOrderSecondaryActionStyle}
                      >
                        Cambiar producto
                      </button>
                    </div>
                    <div style={manualProductDetailsGridStyle}>
                      <div style={manualProductMetricStyle}><span>Código / SKU</span><strong>{manualProductoCompra.sku || "Sin código"}</strong></div>
                      <div style={manualProductMetricStyle}><span>Categoría</span><strong>{manualProductoCompra.categoria}</strong></div>
                      <div style={manualProductMetricStyle}><span>Unidad de compra</span><strong>{manualProductoCompra.unidadCompra}</strong></div>
                      <div style={manualProductMetricStyle}><span>Unidad base</span><strong>{manualProductoCompra.unidadBase}</strong></div>
                      <div style={manualProductMetricStyle}><span>Factor conversión</span><strong>{manualProductoCompra.factorConversion}</strong></div>
                      <div style={manualProductMetricStyle}><span>Precio de compra</span><strong>Q{manualProductoCompra.precioCompra.toFixed(2)}</strong></div>
                      <div style={manualProductMetricStyle}><span>Proveedor sugerido</span><strong>{manualProductoCompra.proveedor || manualProveedorNombre || "Sin proveedor asignado"}</strong></div>
                      <div style={manualProductMetricStyle}><span>Disponible</span><strong>{manualIngredienteSeleccionado.totalUnidades || 0} {manualProductoCompra.unidadCompra}</strong></div>
                    </div>
                    {manualIngredienteSeleccionado.imagen ? (
                      <img src={manualIngredienteSeleccionado.imagen} alt="Ingrediente" style={previewImageStyle} />
                    ) : null}

                    <label style={fieldLabelStyle}>Cantidad a comprar</label>
                    <div style={purchaseQuantityRowStyle}>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        placeholder="0"
                        value={manualCantidadComprar}
                        onChange={(e) => setManualCantidadComprar(e.target.value)}
                        style={{ ...inputStyle, margin: 0, flex: "1 1 190px" }}
                      />
                      <span style={purchaseQuantityUnitStyle}>{manualProductoCompra.unidadCompra}</span>
                    </div>
                    <div style={purchaseCalculatedSummaryStyle}>
                      <div style={purchaseCalculatedMetricStyle}>
                        <span>Subtotal</span>
                        <strong>Q{manualSubtotal.toFixed(2)}</strong>
                      </div>
                      <div style={purchaseCalculatedMetricStyle}>
                        <span>Unidades base adquiridas</span>
                        <strong>{manualCantidadBaseTotal.toLocaleString("es-GT")} {manualProductoCompra.unidadBase}</strong>
                      </div>
                    </div>
                    <button onClick={agregarIngredienteOrdenManual} style={{ ...purchaseButtonStyle, marginTop: "16px" }}>
                      Agregar producto a la orden
                    </button>
                  </div>
                )}

                {manualOrdenItems.length > 0 && (
                  <div style={orderBoxStyle}>
                    <h3>Productos de la orden</h3>
                    {manualOrdenItems.map((item) => (
                      <div key={item.id} style={orderItemStyle}>
                        <p><strong>{item.nombre}</strong> ({item.sku || item.codigo || "Sin código"})</p>
                        <p>Cantidad: {item.cantidad_compra ?? item.cantidadComprar} {item.unidad_compra || item.unidadCompra}</p>
                        <p>Subtotal: <strong>Q{Number(item.subtotal ?? Number(item.costoUnitario || 0) * Number(item.cantidadComprar || 0)).toFixed(2)}</strong></p>
                        <p>Base adquirida: {Number(item.cantidad_base_total ?? item.cantidadComprar ?? 0).toLocaleString("es-GT")} {item.unidad_base || item.unidadCompra}</p>
                        <button
                          onClick={() => setManualOrdenItems(manualOrdenItems.filter((ordenItem) => ordenItem.id !== item.id))}
                          style={deleteButtonStyle}
                        >
                          Eliminar ingrediente
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {(manualProductoCompra || manualOrdenItems.length > 0) && (
                  <div style={manualSupplierSectionStyle}>
                    <div>
                      <h3 style={{ margin: "0 0 5px" }}>Proveedor</h3>
                      <p style={manualSupplierHelpStyle}>Información cargada desde el ingrediente seleccionado. Puedes completarla o corregirla antes de crear la orden.</p>
                    </div>
                    <div style={manualSupplierFieldsGridStyle}>
                      <input
                        type="text"
                        placeholder="Nombre del proveedor"
                        value={manualProveedorNombre}
                        onChange={(e) => setManualProveedorNombre(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      />
                      <input
                        type="text"
                        placeholder="Número de contacto"
                        value={manualProveedorContacto}
                        onChange={(e) => setManualProveedorContacto(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      />
                      <input
                        type="email"
                        placeholder="Correo electrónico"
                        value={manualProveedorCorreo}
                        onChange={(e) => setManualProveedorCorreo(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      />
                      <input
                        type="text"
                        placeholder="WhatsApp"
                        value={manualProveedorWhatsApp}
                        onChange={(e) => setManualProveedorWhatsApp(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      />
                      <input
                        type="text"
                        placeholder="Nombre del encargado"
                        value={manualProveedorEncargado}
                        onChange={(e) => setManualProveedorEncargado(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      />
                      <select
                        aria-label="Método de compra"
                        value={manualMetodoCompra}
                        onChange={(e) => setManualMetodoCompra(e.target.value)}
                        style={{ ...inputStyle, margin: 0 }}
                      >
                        <option value="banco">Método: Banco</option>
                        <option value="transferencia">Método: Transferencia</option>
                        <option value="tarjeta">Método: Tarjeta</option>
                        <option value="efectivo">Método: Efectivo</option>
                      </select>
                    </div>
                  </div>
                )}

                <h3 style={purchaseOrderDataTitleStyle}>Datos de la orden</h3>
                <div style={purchaseOrderDataGridStyle}>
                  <div>
                    <label style={fieldLabelStyle}>Fecha de emisión</label>
                    <input
                      type="date"
                      value={manualIssueDate}
                      onChange={(e) => setManualIssueDate(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Fecha esperada de entrega</label>
                    <input
                      type="date"
                      value={manualExpectedDate}
                      onChange={(e) => setManualExpectedDate(e.target.value)}
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={fieldLabelStyle}>Estado de la orden</label>
                    <select
                      value={manualStatus}
                      onChange={(e) => setManualStatus(e.target.value)}
                      style={inputStyle}
                      disabled={requiereAprobacionOrdenCompra}
                    >
                      <option value="borrador">Borrador</option>
                      <option value="pendiente_aprobacion">Pendiente de aprobación</option>
                      <option value="aprobada">Aprobada</option>
                    </select>
                    {requiereAprobacionOrdenCompra && <p style={manualSupplierHelpStyle}>Tu orden será enviada a aprobación de Admin o Gerente General.</p>}
                  </div>
                </div>

                <label style={fieldLabelStyle}>Solicitante</label>
                <input
                  type="text"
                  placeholder="Nombre de quien solicita"
                  value={manualRequester}
                  onChange={(e) => setManualRequester(e.target.value)}
                  style={inputStyle}
                />

                <label style={fieldLabelStyle}>Aprobado por</label>
                <input
                  type="text"
                  placeholder="Nombre de quien aprueba"
                  value={manualApprover}
                  onChange={(e) => setManualApprover(e.target.value)}
                  style={inputStyle}
                />

                <label style={fieldLabelStyle}>Prioridad</label>
                <select
                  value={manualPriority}
                  onChange={(e) => setManualPriority(e.target.value)}
                  style={inputStyle}
                >
                  <option value="normal">Normal</option>
                  <option value="urgente">Urgente</option>
                </select>

                <label style={fieldLabelStyle}>Lugar de entrega</label>
                <input
                  type="text"
                  value={manualLocation}
                  readOnly
                  style={{ ...inputStyle, backgroundColor: "#111827" }}
                />

                <div style={purchaseOrderFooterActionsStyle}>
                  <button type="button" onClick={crearOrdenCompraManual} style={{ ...purchaseButtonStyle, marginRight: 0 }}>
                    Crear orden
                  </button>
                  <button type="button" onClick={() => { limpiarFormularioOrdenManual(); setPurchaseOrderView("automatic") }} style={cancelButtonStyle}>
                    Cancelar
                  </button>
                </div>
              </div>}

              {purchaseOrderView === "history" && <div style={purchaseOrderPanelStyle}>
                <h2>Órdenes de compra manual registradas</h2>
                <div style={purchaseOrderToolbarStyle}>
                  {puedeCrearOrdenCompra && <button type="button" onClick={() => setPurchaseOrderView("manual")} style={purchaseOrderManualButtonStyle}>Nueva orden manual</button>}
                </div>
                {ordenesCompraManual.length === 0 ? (
                  <p>No hay órdenes manuales registradas.</p>
                ) : (
                  ordenesCompraManual.map((orden) => (
                    <div key={orden.id} style={orderItemStyle}>
                      <p><strong>{orden.numeroOrden}</strong></p>
                      <p><strong>Proveedor:</strong> {orden.proveedor.nombre}</p>
                      <p><strong>Estado:</strong> {getPurchaseOrderStatusLabel(orden.status)}</p>
                      <p><strong>Fecha emisión:</strong> {orden.fechaEmision}</p>
                      <p><strong>Fecha esperada:</strong> {orden.fechaEsperadaEntrega}</p>
                      <div style={purchaseOrderHistoryActionsStyle}>
                        {orden.status !== "cancelada" && (
                          <button type="button" onClick={() => seleccionarOrdenManual(orden.id)} style={registeredAreaInventoryButtonStyle}>
                            Ver / recibir
                          </button>
                        )}
                        {puedeAprobarOrdenCompra && ["pendiente", "pendiente_aprobacion", "borrador"].includes(orden.status) && (
                          <>
                            <button type="button" onClick={() => aprobarOrdenManual(orden.id)} style={registeredAreaInventoryButtonStyle}>Aprobar</button>
                            <button type="button" onClick={() => rechazarOrdenManual(orden.id)} style={registeredAreaDeactivateButtonStyle}>Rechazar</button>
                          </>
                        )}
                        {puedeCrearOrdenCompra && orden.status === "aprobada" && (
                          <button type="button" onClick={() => enviarOrdenProveedor(orden.id)} style={registeredAreaInventoryButtonStyle}>Enviar a proveedor</button>
                        )}
                        {!["cancelada", "rechazada", "recibida", "recibida_completa"].includes(orden.status) && (
                          <button type="button" onClick={() => cancelarOrdenManual(orden.id)} style={registeredAreaDeactivateButtonStyle}>
                            Cancelar orden
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}

                {ordenManualSeleccionada && (
                  <div style={{ ...orderBoxStyle, marginTop: "20px" }}>
                    <h3>Recepción de orden</h3>
                    <p><strong>Orden:</strong> {ordenManualSeleccionada.numeroOrden}</p>
                    <p><strong>Lugar:</strong> {ordenManualSeleccionada.lugar}</p>
                    <p><strong>Solicitante:</strong> {ordenManualSeleccionada.requester}</p>
                    <p><strong>Aprobador:</strong> {ordenManualSeleccionada.approver}</p>
                    <p><strong>Prioridad:</strong> {ordenManualSeleccionada.prioridad}</p>
                    <p><strong>Método:</strong> {ordenManualSeleccionada.metodoCompra}</p>
                    <p><strong>Proveedor:</strong> {ordenManualSeleccionada.proveedor.nombre}</p>

                    <h4>Ingredientes pedidos</h4>
                    {ordenManualSeleccionada.items.map((item) => (
                      <div key={item.id} style={{ marginBottom: "10px" }}>
                        <p><strong>{item.nombre}</strong> ({item.sku || item.codigo || "Sin código"})</p>
                        <p>Cantidad pedida: {item.cantidad_compra ?? item.cantidadComprar} {item.unidad_compra || item.unidadCompra}</p>
                        {item.subtotal != null && <p>Subtotal: Q{Number(item.subtotal).toFixed(2)}</p>}
                      </div>
                    ))}

                    <label style={fieldLabelStyle}>Cantidad recibida real</label>
                    <input
                      type="number"
                      placeholder="Cantidad recibida"
                      value={manualRecepcionCantidad}
                      onChange={(e) => setManualRecepcionCantidad(e.target.value)}
                      style={inputStyle}
                    />

                    <label style={fieldLabelStyle}>Estado del producto</label>
                    <select
                      value={manualRecepcionEstado}
                      onChange={(e) => setManualRecepcionEstado(e.target.value)}
                      style={inputStyle}
                    >
                      <option value="bueno">Bueno</option>
                      <option value="dañado">Dañado</option>
                      <option value="vencido">Vencido</option>
                      <option value="malo">Malo</option>
                    </select>

                    <label style={fieldLabelStyle}>Nombre de quien recibe</label>
                    <input
                      type="text"
                      placeholder="Nombre del receptor"
                      value={manualRecepcionNombre}
                      onChange={(e) => setManualRecepcionNombre(e.target.value)}
                      style={inputStyle}
                    />

                    <label style={fieldLabelStyle}>Imagen de recepción / factura</label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={cargarImagenRecepcion}
                      style={inputStyle}
                    />

                    {manualRecepcionImagen && (
                      <div style={imagePreviewBox}>
                        <img src={manualRecepcionImagen} alt="Recepción" style={previewImageStyle} />
                      </div>
                    )}

                    {puedeRecibirOrdenCompra && ["aprobada", "enviada_proveedor"].includes(ordenManualSeleccionada.status) && (
                      <button onClick={recibirOrdenManual} style={purchaseButtonStyle}>
                        Registrar recepción
                      </button>
                    )}
                  </div>
                )}
              </div>}
            </>
          )}

          {seccionActiva === "asistencia" && (
            <div style={cardStyle}>
              <h2>Marcaje de asistencia</h2>
              <p style={{ marginBottom: "18px", color: "#cbd5e1" }}>
                Ingresa tus credenciales para registrar entrada, salida y uso de baño.
              </p>

              {mensajeAsistencia && <div style={profileSuccessMessageStyle}>{mensajeAsistencia}</div>}

              {!colaboradorMarcaje ? (
                <form onSubmit={autenticarMarcajeAsistencia} style={attendanceLoginCardStyle}>
                  {asistenciaLoginError && <div style={ingredientFormErrorStyle}>{asistenciaLoginError}</div>}
                  <label style={fieldLabelStyle}>Usuario</label>
                  <input value={asistenciaLoginUsuario} onChange={(e) => setAsistenciaLoginUsuario(e.target.value)} style={inputStyle} />
                  <label style={fieldLabelStyle}>Contraseña</label>
                  <input type="password" value={asistenciaLoginPassword} onChange={(e) => setAsistenciaLoginPassword(e.target.value)} style={inputStyle} />
                  <button type="submit" style={buttonStyle}>Ingresar</button>
                  <div style={attendanceRecoveryLinksStyle}>
                    <button type="button" onClick={() => abrirRecuperacionAsistencia("forgot_username")} style={attendanceRecoveryLinkStyle}>Olvidé mi usuario</button>
                    <button type="button" onClick={() => abrirRecuperacionAsistencia("forgot_password")} style={attendanceRecoveryLinkStyle}>Olvidé mi contraseña</button>
                  </div>
                </form>
              ) : (
                <div style={attendanceMiniProfileStyle}>
                  {(() => {
                    const ultimoMovimiento = obtenerUltimoMovimientoEntradaSalida(colaboradorMarcaje.id)
                    const banoActivo = obtenerBanoActivo(colaboradorMarcaje.id)
                    const banosUsados = obtenerConteoBanosHoy(colaboradorMarcaje.id)
                    const puedeMarcarSalida = ultimoMovimiento?.tipo === "entrada"
                    const tipoPendiente = puedeMarcarSalida ? "salida" : "entrada"
                    const etiquetaMarcaje = puedeMarcarSalida ? "Tomar foto y marcar salida" : "Tomar foto y marcar entrada"

                    return (
                      <>
                        <div style={profileHeaderStyle}>
                          {colaboradorMarcaje.fotoColaborador ? (
                            <img src={colaboradorMarcaje.fotoColaborador} alt={colaboradorMarcaje.nombre} style={profileAvatarStyle} />
                          ) : (
                            <div style={profileAvatarPlaceholderStyle}>{obtenerInicialesColaborador(colaboradorMarcaje.nombre)}</div>
                          )}
                          <div style={{ flex: 1 }}>
                            <h2 style={{ margin: 0 }}>{colaboradorMarcaje.nombre}</h2>
                            <p style={{ color: "#cbd5e1" }}>{colaboradorMarcaje.puesto || "Sin puesto"} · {colaboradorMarcaje.departamento || "Sin departamento"}</p>
                            <p style={{ color: "#e5e7eb" }}>Estado del turno: {puedeMarcarSalida ? "Dentro del turno" : "Fuera del turno"}</p>
                            <p style={{ color: "#e5e7eb" }}>Último marcaje: {ultimoMovimiento ? `${ultimoMovimiento.tipo} ${ultimoMovimiento.hora}` : "Sin marcaje hoy"}</p>
                            <p style={{ color: "#e5e7eb" }}>Baños usados hoy: {banosUsados}/2</p>
                            <p style={{ color: "#94a3b8" }}>Horario: {obtenerTurnosColaborador(colaboradorMarcaje).length ? obtenerTurnosColaborador(colaboradorMarcaje).map(formatearTurno).join(", ") : "Sin horario asignado"}</p>
                          </div>
                        </div>

                        {banoActivo && <div style={attendanceWarningStyle}>Baño activo desde {banoActivo.hora}.</div>}

                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", padding: "16px" }}>
                          <button type="button" onClick={() => abrirCamaraAsistencia(tipoPendiente)} style={buttonStyle}>{etiquetaMarcaje}</button>
                          {banoActivo ? (
                            <button type="button" onClick={() => marcarRegresoBano(colaboradorMarcaje)} style={editButtonStyle}>Marcar regreso de baño</button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => iniciarBano(colaboradorMarcaje)}
                              style={banosUsados >= 2 || ultimoMovimiento?.tipo !== "entrada" ? disabledButtonStyle : editButtonStyle}
                              disabled={banosUsados >= 2 || ultimoMovimiento?.tipo !== "entrada"}
                            >
                              Utilizar 10 min de baño
                            </button>
                          )}
                          <button type="button" onClick={cerrarSesionMarcajeAsistencia} style={cancelButtonStyle}>Salir del marcaje</button>
                        </div>

                        {asistenciaCamaraActiva && (
                          <div style={attendanceCameraBoxStyle}>
                            <video ref={asistenciaVideoRef} autoPlay playsInline muted style={barcodeVideoStyle} />
                            <canvas ref={asistenciaCanvasRef} style={{ display: "none" }} />
                            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                              <button type="button" onClick={tomarFotoYGuardarMarcaje} style={buttonStyle}>Tomar foto y guardar marcaje</button>
                              <button type="button" onClick={cerrarCamaraAsistencia} style={cancelButtonStyle}>Cerrar cámara</button>
                            </div>
                          </div>
                        )}

                        <div style={{ padding: "0 16px 16px" }}>
                          <div style={profileCardStyle}>
                            <h3>Mi historial básico</h3>
                            {asistenciaMovimientos
                              .filter((movimiento) => movimiento.colaboradorId === colaboradorMarcaje.id)
                              .slice(0, 10)
                              .map((movimiento) => (
                                <p key={movimiento.id}>{movimiento.fecha} {movimiento.hora} · {movimiento.tipo}</p>
                              ))}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {seccionActiva === "reportesAsistencia" && puedeVerReportesRRHH && (
            <div style={cardStyle}>
              <h2>Reportes de asistencia</h2>
              <div style={attendanceToolbarStyle}>
                <input placeholder="Buscar colaborador..." value={asistenciaBusqueda} onChange={(e) => setAsistenciaBusqueda(e.target.value)} style={inputStyle} />
                <input type="date" value={asistenciaFechaFiltro} onChange={(e) => setAsistenciaFechaFiltro(e.target.value)} style={inputStyle} />
                <select value={asistenciaReporteColaboradorId} onChange={(e) => setAsistenciaReporteColaboradorId(e.target.value)} style={inputStyle}>
                  <option value="">Todos los colaboradores</option>
                  {users.map((usuario) => <option key={usuario.id} value={usuario.id}>{usuario.nombre}</option>)}
                </select>
              </div>

              <div style={reportGridStyle}>
                <div style={profileCardStyle}><h3>Asistencia diaria</h3><p>{entradasDelDia.length} entradas · {salidasDelDia.length} salidas</p></div>
                <div style={profileCardStyle}><h3>Llegadas tarde</h3><p>{llegadasTarde.length} registros</p></div>
                <div style={profileCardStyle}><h3>Salidas tempranas</h3><p>{salidasTempranas.length} registros</p></div>
                <div style={profileCardStyle}><h3>Faltas</h3><p>{faltasDelDia.length} colaboradores sin entrada</p></div>
                <div style={profileCardStyle}><h3>Horas trabajadas</h3>{horasTrabajadas.length ? horasTrabajadas.map((item) => <p key={item.usuario.id}>{item.usuario.nombre}: {(item.totalMinutos / 60).toFixed(2)} h</p>) : <p>Sin horas cerradas.</p>}</div>
                <div style={profileCardStyle}><h3>Uso de baño por colaborador</h3><p>{banosDelDia.length} usos registrados</p></div>
                <div style={profileCardStyle}><h3>Excesos de baño</h3><p>{regresosBanoDelDia.filter((movimiento) => movimiento.excedido).length} excesos</p></div>
                <div style={profileCardStyle}><h3>Actualmente dentro del turno</h3><p>{colaboradoresDentroTurno.length} colaboradores</p></div>
                <div style={profileCardStyle}><h3>Sin marcar salida</h3><p>{colaboradoresSinSalida.length} colaboradores</p></div>
                <div style={profileCardStyle}><h3>Resumen semanal</h3><p>{resumenSemanal.length} movimientos en 7 días</p></div>
                <div style={profileCardStyle}><h3>Resumen mensual</h3><p>{resumenMensual.length} movimientos del mes</p></div>
              </div>

              <div style={profileCardStyle}>
                <h3>Historial por colaborador</h3>
                <div style={attendanceTableWrapperStyle}>
                  <table style={attendanceTableStyle}>
                    <thead>
                      <tr>
                        <th style={attendanceThStyle}>Fecha</th>
                        <th style={attendanceThStyle}>Hora</th>
                        <th style={attendanceThStyle}>Colaborador</th>
                        <th style={attendanceThStyle}>Movimiento</th>
                        <th style={attendanceThStyle}>Registró</th>
                        <th style={attendanceThStyle}>Foto</th>
                        <th style={attendanceThStyle}>Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientosReportes.map((movimiento) => (
                        <tr key={movimiento.id}>
                          <td style={attendanceTdStyle}>{movimiento.fecha}</td>
                          <td style={attendanceTdStyle}>{movimiento.hora}</td>
                          <td style={attendanceTdStyle}>{movimiento.colaboradorNombre}</td>
                          <td style={attendanceTdStyle}>{movimiento.tipo}</td>
                          <td style={attendanceTdStyle}>{movimiento.registradoPor}</td>
                          <td style={attendanceTdStyle}>{movimiento.fotoMarcaje ? <img src={movimiento.fotoMarcaje} alt="Marcaje" style={attendancePhotoThumbStyle} /> : "-"}</td>
                          <td style={attendanceTdStyle}>{movimiento.tipo === "bano_regreso" ? `${movimiento.duracionMinutos} min ${movimiento.excedido ? "· excedido" : ""}` : movimiento.estado}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
            <>
              <div style={cardStyle}>
                <h2>{editandoProveedorId ? "Editar proveedor" : "Crear proveedor"}</h2>
                <p>Registra el proveedor con toda su información de contacto, pagos y días de entrega.</p>

                <label style={fieldLabelStyle}>Buscar proveedor</label>
                <input
                  type="text"
                  placeholder="Busca por nombre, razón social o código..."
                  value={proveedorBusqueda}
                  onChange={(e) => setProveedorBusqueda(e.target.value)}
                  style={inputStyle}
                />
                {proveedorBusqueda && proveedoresFiltrados.length > 0 && (
                  <div style={suggestionsBoxStyle}>
                    {proveedoresFiltrados.slice(0, 8).map((proveedor) => (
                      <button
                        key={proveedor.id}
                        type="button"
                        onClick={() => {
                          editarProveedor(proveedor)
                        }}
                        style={suggestionButtonStyle}
                      >
                        {proveedor.nombreComercial} ({proveedor.codigo})
                      </button>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  placeholder="Nombre comercial"
                  value={proveedorNombreComercial}
                  onChange={(e) => setProveedorNombreComercial(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Razón social"
                  value={proveedorRazonSocial}
                  onChange={(e) => setProveedorRazonSocial(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="NIT"
                  value={proveedorNit}
                  onChange={(e) => setProveedorNit(e.target.value)}
                  style={inputStyle}
                />
                <label style={fieldLabelStyle}>Tipo de proveedor</label>
                <select
                  value={proveedorTipo}
                  onChange={(e) => setProveedorTipo(e.target.value)}
                  style={inputStyle}
                >
                  <option value="Lácteos">Lácteos</option>
                  <option value="Carnes">Carnes</option>
                  <option value="Vegetales">Vegetales</option>
                  <option value="Importados">Importados</option>
                  <option value="Bebidas">Bebidas</option>
                  <option value="Empaques">Empaques</option>
                  <option value="Limpieza">Limpieza</option>
                  <option value="Equipo">Equipo</option>
                </select>

                <input
                  type="text"
                  placeholder="Persona encargada"
                  value={proveedorEncargado}
                  onChange={(e) => setProveedorEncargado(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Teléfono"
                  value={proveedorTelefono}
                  onChange={(e) => setProveedorTelefono(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="WhatsApp"
                  value={proveedorWhatsApp}
                  onChange={(e) => setProveedorWhatsApp(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="email"
                  placeholder="Correo electrónico"
                  value={proveedorCorreo}
                  onChange={(e) => setProveedorCorreo(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Dirección"
                  value={proveedorDireccion}
                  onChange={(e) => setProveedorDireccion(e.target.value)}
                  style={inputStyle}
                />

                <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                  <label style={fieldLabelStyle}>Métodos de pago</label>
                  <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" checked={proveedorMetodosPago.efectivo} onChange={() => toggleMetodoPago("efectivo")} />
                    Efectivo
                  </label>
                  <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" checked={proveedorMetodosPago.transferencia} onChange={() => toggleMetodoPago("transferencia")} />
                    Transferencia
                  </label>
                  <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" checked={proveedorMetodosPago.tarjeta} onChange={() => toggleMetodoPago("tarjeta")} />
                    Tarjeta
                  </label>
                  <label style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <input type="checkbox" checked={proveedorMetodosPago.cheque} onChange={() => toggleMetodoPago("cheque")} />
                    Cheque
                  </label>
                </div>

                <input
                  type="text"
                  placeholder="Cuenta bancaria"
                  value={proveedorCuentaBancaria}
                  onChange={(e) => setProveedorCuentaBancaria(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="text"
                  placeholder="Banco"
                  value={proveedorBanco}
                  onChange={(e) => setProveedorBanco(e.target.value)}
                  style={inputStyle}
                />

                <div style={{ display: "grid", gap: "10px", marginBottom: "10px" }}>
                  <label style={fieldLabelStyle}>Días de entrega</label>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "10px" }}>
                    {Object.keys(proveedorDiasEntrega).map((dia) => (
                      <label key={dia} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <input type="checkbox" checked={proveedorDiasEntrega[dia]} onChange={() => toggleDiaEntrega(dia)} />
                        {dia.charAt(0).toUpperCase() + dia.slice(1)}
                      </label>
                    ))}
                  </div>
                </div>

                <label style={fieldLabelStyle}>Tiempo promedio de entrega</label>
                <select
                  value={proveedorTiempoEntrega}
                  onChange={(e) => setProveedorTiempoEntrega(e.target.value)}
                  style={inputStyle}
                >
                  <option value="mismo dia">Mismo día</option>
                  <option value="1 dia">1 día</option>
                  <option value="2 dias">2 días</option>
                  <option value="1 semana">1 semana</option>
                  <option value="2 semanas">2 semanas</option>
                  <option value="mensual">Mensual</option>
                </select>

                <label style={fieldLabelStyle}>Clasificación por estrellas</label>
                <select
                  value={proveedorEstrellas}
                  onChange={(e) => setProveedorEstrellas(Number(e.target.value))}
                  style={inputStyle}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>{n} estrella{n > 1 ? "s" : ""}</option>
                  ))}
                </select>

                <div style={buttonRowStyle}>
                  <button onClick={guardarProveedor} style={buttonStyle}>
                    {editandoProveedorId ? "Actualizar proveedor" : "Guardar proveedor"}
                  </button>
                  <button onClick={limpiarFormularioProveedor} style={cancelButtonStyle}>
                    Limpiar
                  </button>
                </div>
              </div>

              <div style={cardStyle}>
                <h2>Lista de proveedores</h2>
                {proveedores.length === 0 ? (
                  <p>No hay proveedores registrados.</p>
                ) : (
                  proveedores.map((proveedor) => (
                    <div key={proveedor.id} style={orderItemStyle}>
                      <p><strong>{proveedor.nombreComercial}</strong> ({proveedor.codigo})</p>
                      <p><strong>Tipo:</strong> {proveedor.tipo}</p>
                      <p><strong>Contacto:</strong> {proveedor.telefono || proveedor.correo}</p>
                      <p><strong>Estrellas:</strong> {proveedor.estrellas} / 5</p>
                      <div style={buttonRowStyle}>
                        <button onClick={() => setProveedorSeleccionadoPrincipalId(proveedor.id)} style={editButtonStyle}>
                          Ver proveedor
                        </button>
                        <button onClick={() => editarProveedor(proveedor)} style={buttonStyle}>
                          Editar
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {proveedorSeleccionadoPrincipal && (
                  <div style={{ ...orderBoxStyle, marginTop: "20px" }}>
                    <h3>Detalles de {proveedorSeleccionadoPrincipal.nombreComercial}</h3>
                    <p><strong>Código:</strong> {proveedorSeleccionadoPrincipal.codigo}</p>
                    <p><strong>Razón social:</strong> {proveedorSeleccionadoPrincipal.razonSocial}</p>
                    <p><strong>NIT:</strong> {proveedorSeleccionadoPrincipal.nit}</p>
                    <p><strong>Encargado:</strong> {proveedorSeleccionadoPrincipal.encargado}</p>
                    <p><strong>Teléfono:</strong> {proveedorSeleccionadoPrincipal.telefono}</p>
                    <p><strong>WhatsApp:</strong> {proveedorSeleccionadoPrincipal.whatsapp}</p>
                    <p><strong>Correo:</strong> {proveedorSeleccionadoPrincipal.correo}</p>
                    <p><strong>Dirección:</strong> {proveedorSeleccionadoPrincipal.direccion}</p>
                                    <p><strong>Días de entrega:</strong> {Object.entries(proveedorSeleccionadoPrincipal.diasEntrega || {}).filter(([, enabled]) => enabled).map(([dia]) => dia.charAt(0).toUpperCase() + dia.slice(1)).join(", ") || "No definido"}</p>
                    <p><strong>Tiempo entrega:</strong> {proveedorSeleccionadoPrincipal.tiempoEntrega}</p>
                    <p><strong>Métodos de pago:</strong> {Object.entries(proveedorSeleccionadoPrincipal.metodosPago || {}).filter(([, enabled]) => enabled).map(([metodo]) => metodo).join(", ") || "No definido"}</p>

                    <div style={orderBoxStyle}>
                      <h4>Productos que vende</h4>
                      {productosProveedorSeleccionado.length === 0 ? (
                        <p>Este proveedor no tiene productos asignados en inventario.</p>
                      ) : (
                        productosProveedorSeleccionado.map((ingrediente) => (
                          <div key={ingrediente.id} style={{ marginBottom: "10px" }}>
                            <p>{ingrediente.nombre} ({ingrediente.codigo})</p>
                            <p>Precio unitario: Q{ingrediente.costoUnitario}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div style={orderBoxStyle}>
                      <h4>Proveedores similares</h4>
                      {proveedoresSimilares.length === 0 ? (
                        <p>No se encontraron proveedores con productos similares.</p>
                      ) : (
                        proveedoresSimilares.map(({ proveedor, coincidencias }) => (
                          <div key={proveedor.id} style={{ marginBottom: "12px" }}>
                            <p><strong>{proveedor.nombreComercial}</strong> - {proveedor.estrellas} estrellas</p>
                            <p>Productos en común:</p>
                            {coincidencias.map((ingrediente) => (
                              <p key={ingrediente.id}>• {ingrediente.nombre} — Q{ingrediente.costoUnitario}</p>
                            ))}
                          </div>
                        ))
                      )}
                    </div>

                    <div style={orderBoxStyle}>
                      <h4>Historial de compras</h4>
                      {obtenerUltimasComprasProveedor(proveedorSeleccionadoPrincipal).length === 0 ? (
                        <p>No hay compras registradas aún.</p>
                      ) : (
                        obtenerUltimasComprasProveedor(proveedorSeleccionadoPrincipal).map((compra) => (
                          <div key={compra.id} style={{ marginBottom: "12px" }}>
                            <p><strong>{compra.numeroOrden}</strong> — {compra.fecha}</p>
                            <p>Total: Q{compra.total.toFixed(2)}</p>
                            <p>Estado: {compra.estado}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
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
                <h2>Administrar áreas</h2>
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
                <h2>Áreas registradas</h2>
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

          {seccionActiva === "inventario" && (
            <>
              <div style={cardStyle}>
                <h2>Notificaciones de requisición</h2>
                {requisicionesPendientes.length === 0 ? (
                  <p>No hay requisiciones nuevas en este momento.</p>
                ) : (
                  requisicionesPendientes.map((req) => {
                    const requisition = normalizeRequisition(req)
                    const items = requisition.items

                    return (
                      <div key={req.id} style={orderItemStyle}>
                        <p><strong>Requisición:</strong> #{req.id} · <strong>Estado:</strong> {requisition.status}</p>
                        <p><strong>Traslado:</strong> {getAreaLabel(requisition.fromLocation)} → {getAreaLabel(requisition.toLocation)}</p>
                        <p><strong>Ingredientes:</strong> {items.length}</p>
                        {items.slice(0, 3).map((item, index) => (
                          <p key={index}>{item.itemName} - {item.approvedQty} {item.unit}</p>
                        ))}
                        {items.length > 3 && <p>...y {items.length - 3} más</p>}
                        <p>Solicitante: {requisition.requestedBy}</p>
                        <div style={buttonRowStyle}>
                          <button onClick={() => verRequisicion(req.id)} style={editButtonStyle}>
                            Ver requisición
                          </button>
                          {usuarioActual ? (
                            <>
                              {requisition.status === "pending" && <button onClick={() => aceptarRequisicion(req)} style={purchaseButtonStyle}>Aprobar</button>}
                              {["pending", "approved"].includes(requisition.status) && <button onClick={() => completeRequisition(req.id)} style={buttonStyle}>Completar traslado</button>}
                              {["pending", "approved"].includes(requisition.status) && <button onClick={() => cambiarEstadoRequisicion(req.id, "rejected")} style={deleteButtonStyle}>Rechazar</button>}
                              {["pending", "approved"].includes(requisition.status) && <button onClick={() => cambiarEstadoRequisicion(req.id, "cancelled")} style={cancelButtonStyle}>Cancelar</button>}
                            </>
                          ) : (
                            <button onClick={() => setSeccionActiva("requisicion")} style={pdfButtonStyle}>
                              Iniciar sesión para procesar
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
                {requisicionSeleccionada && (
                  <div style={orderBoxStyle}>
                    <h3>Detalle de requisición seleccionada</h3>
                    <p><strong>Origen:</strong> {getAreaLabel(normalizeRequisition(requisicionSeleccionada).fromLocation)} · <strong>Destino:</strong> {getAreaLabel(normalizeRequisition(requisicionSeleccionada).toLocation)} · <strong>Estado:</strong> {normalizeRequisition(requisicionSeleccionada).status}</p>
                    {getRequisitionItems(requisicionSeleccionada).map((item, index) => {
                      const inventoryItem = ingredientes.find((ingrediente) => ingrediente.id === item.itemId)
                      const almacen = inventoryItem ? getLocationStock(inventoryItem, "almacen") : 0
                      const destino = normalizeRequisition(requisicionSeleccionada).toLocation
                      const stockDestino = inventoryItem ? getLocationStock(inventoryItem, destino) : 0
                      return (
                        <div key={index} style={{ marginBottom: "10px" }}>
                          <p><strong>{item.itemName}</strong> ({item.ingredienteCodigo || inventoryItem?.codigo || ""})</p>
                          <p>Disponible almacén: {almacen} {item.unit} · Actual {getAreaLabel(destino)}: {stockDestino} {item.unit}</p>
                          <p>Trasladar: {item.approvedQty} {item.unit}</p>
                          <p>Después: Almacén {almacen - item.approvedQty} {item.unit} · {getAreaLabel(destino)} {stockDestino + item.approvedQty} {item.unit}</p>
                          <hr style={{ borderColor: "#374151" }} />
                        </div>
                      )
                    })}
                    <p><strong>Fecha de requisición:</strong> {requisicionSeleccionada.fechaSolicitud}</p>
                    <p><strong>Fecha de entrega requerida:</strong> {requisicionSeleccionada.fechaNecesita}</p>
                    <p><strong>Solicitante:</strong> {normalizeRequisition(requisicionSeleccionada).requestedBy}</p>
                  </div>
                )}
              </div>

              <div ref={buscadorIngredientesRef} style={searchWrapperStyle}>
                <div style={searchBoxStyle}>
                  <span style={searchIconStyle}>🔍</span>
                  <input
                    type="text"
                    placeholder="Buscar ingrediente..."
                    value={busqueda}
                    onFocus={() => setMostrarSugerenciasIngredientes(hayBusquedaIngrediente)}
                    onChange={(e) => {
                      setBusqueda(e.target.value)
                      setMostrarSugerenciasIngredientes(e.target.value.trim().length > 0)
                    }}
                    style={searchInputStyle}
                  />
                </div>

                {mostrarSugerenciasIngredientes && hayBusquedaIngrediente && (
                  <div style={searchDropdownStyle}>
                    {sugerenciasIngredientes.length === 0 ? (
                      <div style={searchEmptyStyle}>No se encontraron ingredientes</div>
                    ) : (
                      sugerenciasIngredientes.map((ingrediente) => (
                        <button
                          key={ingrediente.id}
                          type="button"
                          onClick={() => seleccionarSugerenciaIngrediente(ingrediente)}
                          style={searchResultStyle}
                        >
                          {ingrediente.imagen ? (
                            <img
                              src={ingrediente.imagen}
                              alt={ingrediente.nombre}
                              style={searchResultImageStyle}
                            />
                          ) : (
                            <span style={searchResultPlaceholderStyle}>🥫</span>
                          )}

                          <span style={searchResultContentStyle}>
                            <strong style={searchResultNameStyle}>{ingrediente.nombre}</strong>
                            <span style={searchResultMetaStyle}>
                              {ingrediente.categoria || "Sin categoría"} · Almacén: {getLocationStock(ingrediente, "almacen")} · Cocina: {getLocationStock(ingrediente, "cocina")} {ingrediente.unidadCompra || ""}
                            </span>
                            <span style={searchResultMetaStyle}>
                              {ingrediente.codigo ? `Código: ${ingrediente.codigo}` : "Sin código"}
                              {ingrediente.proveedorNombre ? ` · Proveedor: ${ingrediente.proveedorNombre}` : " · Sin proveedor"}
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              <div style={inventoryLocationToolbarStyle}>
                <strong>Ver inventario de:</strong>
                {[{ id: "todos", name: "Todos" }, ...areas].map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => setInventoryLocationFilter(location.id)}
                    style={inventoryLocationFilter === location.id ? inventoryLocationButtonActiveStyle : inventoryLocationButtonStyle}
                  >
                    {location.name}
                  </button>
                ))}
              </div>

              <div style={barcodeScannerCardStyle}>
                <div style={barcodeSearchRowStyle}>
                  <div style={barcodeInputShellStyle}>
                    <span style={searchIconStyle}>▥</span>
                    <input
                      type="text"
                      placeholder="Escanear código de barras..."
                      value={barcodeSearch}
                      onChange={(e) => {
                        const codigo = e.target.value
                        setBarcodeSearch(codigo)
                        setBarcodeNotFoundCode("")
                        if (!codigo.trim()) {
                          setBarcodeFoundIngredient(null)
                          setBarcodeMessage("")
                          return
                        }
                        mostrarIngredienteEscaneado(buscarIngredientePorCodigo(codigo), codigo)
                      }}
                      style={searchInputStyle}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={abrirCamaraCodigoBarras}
                    style={barcodeButtonStyle}
                    disabled={barcodeScannerActive}
                  >
                    Abrir cámara
                  </button>
                </div>

                {barcodeScannerActive && (
                  <div style={barcodeCameraBoxStyle}>
                    <video ref={barcodeVideoRef} style={barcodeVideoStyle} muted playsInline />
                    <button type="button" onClick={cerrarCamaraCodigoBarras} style={cancelButtonStyle}>
                      Cerrar cámara
                    </button>
                  </div>
                )}

                {barcodeMessage && <p style={barcodeMessageStyle}>{barcodeMessage}</p>}

                {barcodeNotFoundCode && (
                  <div style={barcodeConfirmCardStyle}>
                    <p style={{ marginTop: 0 }}>
                      No se encontró un ingrediente con este código de barras. ¿Deseas agregarlo al inventario?
                    </p>
                    <p><strong>Código escaneado:</strong> {barcodeNotFoundCode}</p>
                    <div style={buttonRowStyle}>
                      <button type="button" onClick={prepararIngredienteDesdeCodigoBarras} style={purchaseButtonStyle}>
                        Sí, agregar ingrediente
                      </button>
                      <button type="button" onClick={descartarCodigoBarrasNoEncontrado} style={cancelButtonStyle}>
                        No agregar
                      </button>
                    </div>
                  </div>
                )}

                {barcodeFoundIngredient && (
                  <div style={barcodeResultCardStyle}>
                    {barcodeFoundIngredient.imagen ? (
                      <img
                        src={barcodeFoundIngredient.imagen}
                        alt={barcodeFoundIngredient.nombre}
                        style={barcodeResultImageStyle}
                      />
                    ) : (
                      <div style={barcodeResultPlaceholderStyle}>🥫</div>
                    )}

                    <div>
                      <h3 style={{ marginTop: 0 }}>{barcodeFoundIngredient.nombre}</h3>
                      <p><strong>Categoría:</strong> {barcodeFoundIngredient.categoria || "Sin categoría"}</p>
                      <p><strong>Proveedor:</strong> {barcodeFoundIngredient.proveedorNombre || "Sin proveedor"}</p>
                      <p><strong>Stock almacén:</strong> {getLocationStock(barcodeFoundIngredient, "almacen")}</p>
                      <p><strong>Stock cocina:</strong> {getLocationStock(barcodeFoundIngredient, "cocina")}</p>
                      <p><strong>Stock total:</strong> {getInventoryTotalStock(barcodeFoundIngredient)}</p>
                      <p><strong>Unidad:</strong> {barcodeFoundIngredient.unidadCompra || "Sin unidad"}</p>
                      <p><strong>Código de barras:</strong> {barcodeFoundIngredient.codigo || barcodeSearch}</p>
                    </div>
                  </div>
                )}
              </div>

              <div style={cardStyle}>
                <h2>Importar Excel / CSV</h2>
                {inventarioStorageError && <p style={barcodeMessageStyle}>{inventarioStorageError}</p>}
                <div style={inventoryBackupNoticeStyle}>
                  <strong>Respaldo automático activo</strong>
                  <span>
                    {inventarioBackupMeta?.date
                      ? `Último respaldo: ${new Date(inventarioBackupMeta.date).toLocaleString()} · ${inventarioBackupMeta.count || 0} ingrediente(s)`
                      : "Aún no hay respaldo guardado en este navegador."}
                  </span>
                </div>

                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={importarArchivo}
                  style={inputStyle}
                />
                <div style={inventoryBackupActionsStyle}>
                  <button type="button" onClick={descargarRespaldoInventario} style={buttonStyle}>
                    Descargar respaldo
                  </button>
                  <label style={inventoryRestoreButtonStyle}>
                    Restaurar respaldo
                    <input
                      type="file"
                      accept=".json"
                      onChange={restaurarRespaldoInventario}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
              </div>

              {!mostrarFormularioIngrediente && !editandoId && (
                <button
                  type="button"
                  onClick={() => {
                    setMostrarFormularioIngrediente(true)
                    setErrorFormularioIngrediente("")
                    setCamposIngredienteFaltantes({})
                  }}
                  style={addIngredientToggleButtonStyle}
                >
                  + Agregar ingrediente nuevo
                </button>
              )}

              {(mostrarFormularioIngrediente || editandoId) && (
                <div style={{
                  ...cardStyle,
                  border: editandoId ? "2px solid #facc15" : "1px solid #334155"
                }} id="formulario-ingrediente">
        <h2>{editandoId ? "Editar ingrediente" : "Agregar ingrediente"}</h2>
        <p style={{ color: "#cbd5e1", marginBottom: "16px" }}>
          Completa cada campo con los datos del ingrediente. Los campos son necesarios para controlar stock, costo y puntos de pedido.
        </p>
        {errorFormularioIngrediente && (
          <div style={ingredientFormErrorStyle}>
            {errorFormularioIngrediente}
          </div>
        )}

        <label style={fieldLabelStyle}>Nombre del ingrediente</label>
        <input type="text" placeholder="Ej: Harina de trigo" value={nombre} onChange={(e) => { setNombre(e.target.value); limpiarErrorCampoIngrediente("nombre") }} style={camposIngredienteFaltantes.nombre ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.nombre && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>Código de barras</label>
        <input type="text" placeholder="Código escaneado o manual" value={codigoBarras} onChange={(e) => setCodigoBarras(e.target.value)} style={inputStyle} />

        <label style={fieldLabelStyle}>Categoría</label>
        <input type="text" placeholder="Ej: Harinas, Lácteos, Carnes" value={categoria} onChange={(e) => { setCategoria(e.target.value); limpiarErrorCampoIngrediente("categoria") }} style={camposIngredienteFaltantes.categoria ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.categoria && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>Proveedor</label>
        <input
          type="text"
          placeholder="Busca proveedor..."
          value={proveedorBusqueda}
          onChange={(e) => {
            setProveedorBusqueda(e.target.value)
            setProveedorSeleccionadoId(null)
          }}
          style={inputStyle}
        />
        {proveedorBusqueda && (
          <div style={suggestionsBoxStyle}>
            {proveedores
              .filter((proveedor) => {
                const texto = proveedorBusqueda.toLowerCase()
                return (
                  String(proveedor.nombreComercial || "").toLowerCase().includes(texto) ||
                  String(proveedor.codigo || "").toLowerCase().includes(texto)
                )
              })
              .slice(0, 8)
              .map((proveedor) => (
                <button
                  key={proveedor.id}
                  type="button"
                  onClick={() => {
                    setProveedorSeleccionadoId(proveedor.id)
                    setProveedorBusqueda(proveedor.nombreComercial)
                  }}
                  style={suggestionButtonStyle}
                >
                  {proveedor.nombreComercial} ({proveedor.codigo})
                </button>
              ))}
            {proveedores.filter((proveedor) => {
              const texto = proveedorBusqueda.toLowerCase()
              return (
                String(proveedor.nombreComercial || "").toLowerCase().includes(texto) ||
                String(proveedor.codigo || "").toLowerCase().includes(texto)
              )
            }).length === 0 && (
              <p style={{ color: "#d1d5db" }}>No se encontró ningún proveedor.</p>
            )}
          </div>
        )}

        {proveedorSeleccionado && (
          <div style={infoBoxStyle}>
            <p><strong>Proveedor seleccionado:</strong> {proveedorSeleccionado.nombreComercial}</p>
            <p><strong>Tipo:</strong> {proveedorSeleccionado.tipo}</p>
            <p><strong>Contacto:</strong> {proveedorSeleccionado.telefono || proveedorSeleccionado.correo}</p>
          </div>
        )}

        <label style={fieldLabelStyle}>
          Unidad de compra
          <InfoTooltip text="Cómo compras este producto al proveedor." />
        </label>
        <select value={unidadCompra} onChange={(e) => { setUnidadCompra(e.target.value); limpiarErrorCampoIngrediente("unidadCompra") }} style={camposIngredienteFaltantes.unidadCompra ? inputErrorStyle : inputStyle}>
          <option value="g">Gramos</option>
          <option value="kg">Kilogramos</option>
          <option value="lb">Libras</option>
          <option value="oz">Onzas</option>
          <option value="ml">Mililitros</option>
          <option value="l">Litros</option>
          <option value="gal">Galones</option>
          <option value="unidad">Unidad</option>
          <option value="caja">Caja / Bulk</option>
        </select>
        {camposIngredienteFaltantes.unidadCompra && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>Cantidad comprada / stock actual</label>
        <input type="number" placeholder="Ej: 25" value={cantidadComprada} onChange={(e) => { setCantidadComprada(e.target.value); limpiarErrorCampoIngrediente("cantidadComprada") }} style={camposIngredienteFaltantes.cantidadComprada ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.cantidadComprada && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>
          Unidades por caja / paquete
          <InfoTooltip text="Cuántas unidades base contiene la unidad de compra." />
        </label>
        <input type="number" placeholder="Ej: 12" value={unidadesPorEmpaque} onChange={(e) => { setUnidadesPorEmpaque(e.target.value); limpiarErrorCampoIngrediente("unidadesPorEmpaque") }} style={camposIngredienteFaltantes.unidadesPorEmpaque ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.unidadesPorEmpaque && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>
          Costo unitario
          <InfoTooltip text="Costo automático de una unidad pequeña utilizada por recetas." />
        </label>
        <input type="number" placeholder="Ej: 125.50" value={costoUnitario} onChange={(e) => { setCostoUnitario(e.target.value); limpiarErrorCampoIngrediente("costoUnitario") }} style={camposIngredienteFaltantes.costoUnitario ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.costoUnitario && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <label style={fieldLabelStyle}>Stock actual en Almacén</label>
        <input
          type="number"
          placeholder="Ej: 120"
          value={stockActual}
          onChange={(e) => { setStockActual(e.target.value); limpiarErrorCampoIngrediente("stockActual") }}
          style={camposIngredienteFaltantes.stockActual ? inputErrorStyle : inputStyle}
        />
        {camposIngredienteFaltantes.stockActual && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <h3>Puntos de control</h3>

        <label style={fieldLabelStyle}>
          Punto mínimo
          <InfoTooltip text="Cantidad mínima recomendada antes de alertar falta de stock." />
        </label>
        <input type="number" placeholder="Punto mínimo" value={puntoMinimo} onChange={(e) => { setPuntoMinimo(e.target.value); limpiarErrorCampoIngrediente("puntoMinimo") }} style={camposIngredienteFaltantes.puntoMinimo ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.puntoMinimo && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <input type="number" placeholder="Mínimo operativo en Cocina" value={puntoMinimoCocina} onChange={(e) => setPuntoMinimoCocina(e.target.value)} style={inputStyle} />
        <label style={fieldLabelStyle}>
          Punto orden
          <InfoTooltip text="Cantidad recomendada para volver a comprar." />
        </label>
        <input type="number" placeholder="Punto de orden" value={puntoOrden} onChange={(e) => { setPuntoOrden(e.target.value); limpiarErrorCampoIngrediente("puntoOrden") }} style={camposIngredienteFaltantes.puntoOrden ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.puntoOrden && <p style={fieldErrorStyle}>Campo requerido.</p>}
        <label style={fieldLabelStyle}>
          Punto máximo
          <InfoTooltip text="Cantidad máxima recomendada en inventario." />
        </label>
        <input type="number" placeholder="Punto máximo" value={puntoMaximo} onChange={(e) => { setPuntoMaximo(e.target.value); limpiarErrorCampoIngrediente("puntoMaximo") }} style={camposIngredienteFaltantes.puntoMaximo ? inputErrorStyle : inputStyle} />
        {camposIngredienteFaltantes.puntoMaximo && <p style={fieldErrorStyle}>Campo requerido.</p>}

        <h3>Imagen del ingrediente</h3>

        <input
          type="file"
          accept="image/*"
          onChange={cargarImagen}
          style={inputStyle}
        />

        {imagenIngrediente ? (
          <div style={imagePreviewBox}>
            <img
              src={imagenIngrediente}
              alt="Preview ingrediente"
              style={previewImageStyle}
            />

            <button
              onClick={eliminarImagenActual}
              style={deleteButtonStyle}
            >
              Quitar imagen
            </button>
          </div>
        ) : (
          <p style={{ color: "#9ca3af" }}>
            No hay imagen cargada para este ingrediente.
          </p>
        )}

        {editandoId && (
          <>
            <h3>Motivo de edición</h3>

            <select
              value={motivoEdicion}
              onChange={(e) => setMotivoEdicion(e.target.value)}
              style={inputStyle}
            >
              <option value="">Selecciona motivo</option>
              <option value="Ajuste por inventario físico">Ajuste por inventario físico</option>
              <option value="Corrección de digitación">Corrección de digitación</option>
              <option value="Ingreso incorrecto">Ingreso incorrecto</option>
              <option value="Salida incorrecta">Salida incorrecta</option>
              <option value="Cambio de costo">Cambio de costo</option>
              <option value="Actualización de punto mínimo">Actualización de punto mínimo</option>
              <option value="Actualización de punto de orden">Actualización de punto de orden</option>
              <option value="Actualización de punto máximo">Actualización de punto máximo</option>
              <option value="Cambio de unidad de compra">Cambio de unidad de compra</option>
              <option value="Merma o daño">Merma o daño</option>
              <option value="Actualización de fotografía">Actualización de fotografía</option>
              <option value="Otro">Otro</option>
            </select>
          </>
        )}

        <button
          onClick={guardarIngredienteDesdeFormulario}
          style={{
            ...buttonStyle,
            backgroundColor: editandoId ? "#f59e0b" : "#2563eb"
          }}
        >
          {editandoId ? "Guardar cambios" : "Agregar al inventario"}
        </button>

        {editandoId && (
          <button
            type="button"
            onClick={() => {
              if (eliminarIngrediente(editandoId)) limpiarFormulario()
            }}
            style={deleteButtonStyle}
          >
            Eliminar producto del inventario
          </button>
        )}

        <button onClick={limpiarFormulario} style={cancelButtonStyle}>
          Cancelar
        </button>
      </div>
              )}

      <div style={cardsContainer}>
        <h2>Inventario</h2>

        <div style={gridStyle}>
          {ingredientesUbicacionFiltrados.map((ingrediente) => (
            <div
              id={`ingrediente-${ingrediente.id}`}
              key={ingrediente.id}
              style={{
                ...cardInventario,
                ...(ingredienteResaltadoId === ingrediente.id ? highlightedInventoryCardStyle : {})
              }}
            >

              {ingrediente.imagen ? (
                <img
                  src={ingrediente.imagen}
                  alt={ingrediente.nombre}
                  style={ingredientImageStyle}
                />
              ) : (
                <div style={placeholderImageStyle}>
                  📷 Sin imagen
                </div>
              )}

              <div style={cardHeaderStyle}>
                <h3 style={{ margin: 0 }}>{ingrediente.nombre}</h3>
                <span>{inventoryLocationFilter === "todos" ? getInventoryStatus(ingrediente) : getInventoryStatusForLocation(ingrediente, inventoryLocationFilter)}</span>
              </div>

              <p><strong>Código:</strong> {ingrediente.codigo}</p>
              {ingrediente.codigoBarras && <p><strong>Código de barras:</strong> {ingrediente.codigoBarras}</p>}
              <p><strong>Categoría:</strong> {ingrediente.categoria}</p>
              <p><strong>Proveedor:</strong> {ingrediente.proveedorNombre || "Sin proveedor"}</p>
              <p><strong>Compra:</strong> {ingrediente.cantidadComprada} {ingrediente.unidadCompra}</p>
              {inventoryLocationFilter === "todos" ? (
                areas.filter((area) => area.active !== false || getLocationStock(ingrediente, area.id) > 0).map((area) => (
                  <p key={area.id}><strong>{area.name}:</strong> {getLocationStock(ingrediente, area.id)} {ingrediente.unidadCompra}</p>
                ))
              ) : (
                <p><strong>Stock {getAreaLabel(inventoryLocationFilter)}:</strong> {getLocationStock(ingrediente, inventoryLocationFilter)} {ingrediente.unidadCompra}</p>
              )}
              <p><strong>Stock total:</strong> {getInventoryTotalStock(ingrediente)} {ingrediente.unidadCompra}</p>
              <p><strong>Costo:</strong> Q{ingrediente.costoUnitario}</p>

              <hr style={{ borderColor: "#374151" }} />

              {inventoryLocationFilter === "todos" ? (
                <p><strong>Mín. almacén:</strong> {getLocationMinimum(ingrediente, "almacen")}</p>
              ) : (
                <p><strong>Mín. {getAreaLabel(inventoryLocationFilter)}:</strong> {getLocationMinimum(ingrediente, inventoryLocationFilter)}</p>
              )}
              <p><strong>Orden:</strong> {ingrediente.puntoOrden}</p>
              <p><strong>Máx:</strong> {ingrediente.puntoMaximo}</p>

              {ingrediente.ultimaEdicion && (
                <p style={{ color: "#facc15" }}>
                  <strong>Última edición:</strong> {ingrediente.ultimaEdicion}
                </p>
              )}

              <div style={buttonRowStyle}>
                {inventoryLocationFilter !== "todos" && (
                  <button onClick={() => definirMinimoArea(ingrediente.id, inventoryLocationFilter)} style={buttonStyle}>
                    Definir mínimo
                  </button>
                )}
                <button onClick={() => editarIngrediente(ingrediente)} style={editButtonStyle}>
                  Editar
                </button>

                <button onClick={() => eliminarIngrediente(ingrediente.id)} style={deleteButtonStyle}>
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {inventoryLocationFilter !== "todos" && (
      <div style={historialContainer}>
        <h2>Inventario de {getAreaLabel(inventoryLocationFilter)}</h2>
        {ingredientesAreaSeleccionada.length === 0 ? (
          <p>No hay insumos registrados en {getAreaLabel(inventoryLocationFilter)} todavía.</p>
        ) : (
          <div style={inventoryTableStyle}>
            {ingredientesAreaSeleccionada.map((ingrediente) => {
              const ultimoMovimiento = ultimaTransferenciaAreaPorItem[ingrediente.id]
              return (
                <div key={ingrediente.id} style={inventoryTableRowStyle}>
                  <strong>{ingrediente.nombre}</strong>
                  <span>{getLocationStock(ingrediente, inventoryLocationFilter)} {ingrediente.unidadCompra}</span>
                  <span>Mínimo: {getLocationMinimum(ingrediente, inventoryLocationFilter)}</span>
                  <span>{getLocationStock(ingrediente, inventoryLocationFilter) <= getLocationMinimum(ingrediente, inventoryLocationFilter) ? "Bajo" : "OK"}</span>
                  <span>{ultimoMovimiento ? `Última recepción: ${new Date(ultimoMovimiento.date).toLocaleString()}` : "Sin recepción"}</span>
                  {inventoryLocationFilter === "cocina" && <button
                    type="button"
                    style={editButtonStyle}
                    onClick={() => {
                      const requested = window.prompt(`Cantidad consumida de ${ingrediente.nombre}:`)
                      if (!requested) return
                      const result = consumeFromKitchen(ingrediente.id, requested)
                      if (!result.ok) alert(result.message)
                    }}
                  >
                    Registrar consumo
                  </button>}
                </div>
              )
            })}
          </div>
        )}
      </div>
      )}

      <div style={historialContainer}>
        <h2>Movimientos de inventario</h2>
        {inventoryMovements.length === 0 ? (
          <p>No hay traslados registrados todavía.</p>
        ) : (
          inventoryMovements.slice(0, 20).map((movement) => (
            <div key={movement.id} style={historialCard}>
              <p><strong>{movement.itemName}</strong> · {movement.quantity} {movement.unit}</p>
              <p>{getAreaLabel(movement.fromLocation)} → {movement.toLocation ? getAreaLabel(movement.toLocation) : "Consumo"}</p>
              <p>Antes: {movement.previousStockFrom} / {movement.previousStockTo} · Después: {movement.newStockFrom} / {movement.newStockTo}</p>
              <p>{new Date(movement.date).toLocaleString()} · {movement.performedBy}</p>
            </div>
          ))
        )}
      </div>

      <div style={historialContainer}>
        <h2>Historial de cambios</h2>

        {historialCambios.length === 0 ? (
          <p>No hay cambios registrados todavía.</p>
        ) : (
          historialCambios.map((cambio) => (
            <div key={cambio.id} style={historialCard}>
              <p><strong>Fecha:</strong> {cambio.fecha}</p>
              <p><strong>Ingrediente:</strong> {cambio.codigo} - {cambio.nombre}</p>
              <p><strong>Motivo:</strong> {cambio.motivo}</p>
            </div>
          ))
        )}
      </div>
            </>
          )}
        </>
      )}
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

const purchaseOrdersNavigationStyle = {
  ...cardStyle,
  display: "grid",
  gap: "18px",
  border: "1px solid #334155",
  backgroundColor: "#111b2c"
}

const purchaseOrdersIntroStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "18px"
}

const purchaseOrdersPrimaryActionsStyle = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "10px"
}

const purchaseOrderActionBaseStyle = {
  minHeight: "46px",
  padding: "12px 18px",
  border: "1px solid transparent",
  borderRadius: "10px",
  color: "#ffffff",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: "14px"
}

const purchaseOrderAutomaticButtonStyle = {
  ...purchaseOrderActionBaseStyle,
  backgroundColor: "#15803d",
  borderColor: "#22c55e"
}

const purchaseOrderManualButtonStyle = {
  ...purchaseOrderActionBaseStyle,
  backgroundColor: "#0f766e",
  borderColor: "#14b8a6"
}

const purchaseOrdersTabsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  paddingTop: "4px",
  borderTop: "1px solid #273449"
}

const purchaseOrdersTabStyle = {
  minHeight: "43px",
  padding: "10px 16px",
  border: "1px solid #334155",
  borderRadius: "9px",
  backgroundColor: "#0f172a",
  color: "#cbd5e1",
  cursor: "pointer",
  fontWeight: 700
}

const purchaseOrdersActiveTabStyle = {
  ...purchaseOrdersTabStyle,
  borderColor: "#14b8a6",
  backgroundColor: "#073234",
  color: "#99f6e4"
}

const purchaseOrderPanelStyle = {
  ...cardStyle,
  maxWidth: "1180px",
  border: "1px solid #293548",
  backgroundColor: "#182334"
}

const purchaseOrderToolbarStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px",
  margin: "18px 0"
}

const purchaseOrderFooterActionsStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px",
  paddingTop: "18px",
  marginTop: "20px",
  borderTop: "1px solid #334155"
}

const purchaseOrderHistoryActionsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "12px"
}

const manualSelectedProductStyle = {
  display: "grid",
  gap: "16px",
  margin: "14px 0 20px",
  padding: "18px",
  borderRadius: "12px",
  border: "1px solid #1f766e",
  backgroundColor: "#0f172a"
}

const manualSelectedProductHeaderStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "12px"
}

const manualSelectedProductLabelStyle = {
  margin: "0 0 5px",
  color: "#5eead4",
  fontSize: "12px",
  fontWeight: 700,
  letterSpacing: "0.08em",
  textTransform: "uppercase"
}

const manualSelectedProductTitleStyle = {
  margin: 0,
  color: "#f8fafc",
  fontSize: "20px"
}

const purchaseOrderSecondaryActionStyle = {
  minHeight: "40px",
  padding: "9px 13px",
  border: "1px solid #475569",
  borderRadius: "9px",
  backgroundColor: "#1e293b",
  color: "#e2e8f0",
  fontWeight: 700,
  cursor: "pointer"
}

const manualProductDetailsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))",
  gap: "9px"
}

const manualProductMetricStyle = {
  display: "grid",
  gap: "5px",
  padding: "10px 12px",
  border: "1px solid #263449",
  borderRadius: "9px",
  backgroundColor: "#111c2d",
  color: "#94a3b8",
  fontSize: "12px"
}

const purchaseQuantityRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "10px"
}

const purchaseQuantityUnitStyle = {
  minWidth: "120px",
  minHeight: "43px",
  display: "inline-flex",
  alignItems: "center",
  padding: "0 14px",
  borderRadius: "9px",
  border: "1px solid #334155",
  backgroundColor: "#111c2d",
  color: "#e2e8f0",
  fontWeight: 700
}

const purchaseCalculatedSummaryStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: "10px"
}

const purchaseCalculatedMetricStyle = {
  display: "grid",
  gap: "5px",
  padding: "13px 14px",
  borderRadius: "10px",
  backgroundColor: "#082f31",
  border: "1px solid #0f766e",
  color: "#99f6e4",
  fontSize: "13px"
}

const manualSupplierSectionStyle = {
  display: "grid",
  gap: "14px",
  margin: "18px 0",
  padding: "18px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#111c2d"
}

const manualSupplierHelpStyle = {
  margin: 0,
  color: "#94a3b8",
  fontSize: "13px"
}

const manualSupplierFieldsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "10px"
}

const purchaseOrderDataTitleStyle = {
  margin: "22px 0 12px",
  paddingTop: "16px",
  borderTop: "1px solid #334155"
}

const purchaseOrderDataGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "12px"
}

const addIngredientToggleButtonStyle = {
  width: "100%",
  marginTop: "20px",
  padding: "16px 20px",
  borderRadius: "12px",
  border: "1px solid #22c55e",
  backgroundColor: "#14532d",
  color: "#dcfce7",
  fontWeight: 700,
  fontSize: "1rem",
  cursor: "pointer",
  textAlign: "left"
}

const ingredientFormErrorStyle = {
  marginBottom: "16px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #fca5a5",
  backgroundColor: "#7f1d1d",
  color: "#fee2e2"
}

const requisitionFormCardStyle = {
  marginTop: "18px",
  padding: "18px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const requisitionNotificationsStyle = {
  marginTop: "18px",
  padding: "18px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const requisitionNotificationsHeaderStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  marginBottom: "12px"
}

const requisitionPendingBadgeStyle = {
  minWidth: "28px",
  height: "28px",
  borderRadius: "999px",
  backgroundColor: "#f59e0b",
  color: "#111827",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 8px",
  fontWeight: 700
}

const hrActionBarStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: "12px",
  marginBottom: "18px"
}

const secondaryPanelButtonStyle = {
  ...addIngredientToggleButtonStyle,
  borderColor: "#38bdf8",
  backgroundColor: "#0c4a6e",
  color: "#e0f2fe"
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

const attendanceToolbarStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "12px",
  marginBottom: "16px"
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

const attendancePhotoThumbStyle = {
  width: "72px",
  height: "54px",
  borderRadius: "8px",
  objectFit: "cover",
  border: "1px solid #334155"
}

const attendanceWarningStyle = {
  marginTop: "12px",
  padding: "10px 12px",
  borderRadius: "10px",
  border: "1px solid #f59e0b",
  backgroundColor: "#422006",
  color: "#fef3c7"
}

const reportGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))",
  gap: "14px",
  marginBottom: "16px"
}

const attendanceTableWrapperStyle = {
  overflowX: "auto"
}

const attendanceTableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  minWidth: "760px"
}

const attendanceThStyle = {
  textAlign: "left",
  padding: "10px",
  borderBottom: "1px solid #334155",
  color: "#cbd5e1"
}

const attendanceTdStyle = {
  padding: "10px",
  borderBottom: "1px solid #1f2937",
  color: "#e5e7eb"
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

const hrEmployeeGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "12px"
}

const hrEmployeeCardStyle = {
  display: "grid",
  gap: "12px",
  padding: "14px",
  borderRadius: "8px",
  border: "1px solid #263244",
  backgroundColor: "#0f1724"
}

const hrEmployeeHeaderStyle = {
  display: "flex",
  gap: "12px",
  alignItems: "flex-start"
}

const hrEmployeeActionsStyle = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap"
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

const searchWrapperStyle = {
  position: "relative",
  width: "100%",
  marginTop: "20px",
  marginBottom: "10px"
}

const searchBoxStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  width: "100%",
  padding: "0 14px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a",
  boxSizing: "border-box"
}

const searchIconStyle = {
  color: "#94a3b8",
  fontSize: "18px",
  lineHeight: 1,
  flex: "0 0 auto"
}

const searchInputStyle = {
  width: "100%",
  minHeight: "46px",
  padding: "12px 0",
  border: "none",
  outline: "none",
  backgroundColor: "transparent",
  color: "#e6eef8",
  fontSize: "1rem"
}

const searchDropdownStyle = {
  position: "absolute",
  top: "calc(100% + 8px)",
  left: 0,
  right: 0,
  zIndex: 50,
  display: "grid",
  gap: "6px",
  maxHeight: "360px",
  overflowY: "auto",
  padding: "10px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0b1220",
  boxShadow: "0 18px 40px rgba(0, 0, 0, 0.35)"
}

const searchResultStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  width: "100%",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid transparent",
  backgroundColor: "#111827",
  color: "#e6eef8",
  textAlign: "left",
  cursor: "pointer"
}

const searchResultImageStyle = {
  width: "56px",
  height: "56px",
  borderRadius: "10px",
  objectFit: "cover",
  border: "1px solid #334155",
  backgroundColor: "#1f2937",
  flex: "0 0 auto"
}

const searchResultPlaceholderStyle = {
  width: "56px",
  height: "56px",
  borderRadius: "10px",
  border: "1px dashed #475569",
  backgroundColor: "#1f2937",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "24px",
  flex: "0 0 auto"
}

const searchResultContentStyle = {
  display: "grid",
  gap: "4px",
  minWidth: 0
}

const searchResultNameStyle = {
  color: "#f8fafc"
}

const searchResultMetaStyle = {
  color: "#94a3b8",
  fontSize: "0.88rem"
}

const searchEmptyStyle = {
  padding: "14px",
  color: "#cbd5e1",
  textAlign: "center"
}

const barcodeScannerCardStyle = {
  marginTop: "12px",
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#0f172a"
}

const barcodeSearchRowStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "stretch",
  flexWrap: "wrap"
}

const barcodeInputShellStyle = {
  ...searchBoxStyle,
  flex: "1 1 320px"
}

const barcodeButtonStyle = {
  padding: "0 18px",
  minHeight: "48px",
  borderRadius: "10px",
  border: "1px solid #14b8a6",
  backgroundColor: "#0ea5a4",
  color: "#021",
  fontWeight: 700,
  cursor: "pointer"
}

const barcodeCameraBoxStyle = {
  display: "grid",
  gap: "12px",
  marginTop: "14px"
}

const barcodeVideoStyle = {
  width: "100%",
  maxHeight: "360px",
  borderRadius: "12px",
  border: "1px solid #334155",
  backgroundColor: "#020617",
  objectFit: "cover"
}

const barcodeMessageStyle = {
  marginTop: "12px",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #fca5a5",
  backgroundColor: "#7f1d1d",
  color: "#fee2e2"
}

const inventoryBackupNoticeStyle = {
  display: "grid",
  gap: "4px",
  margin: "12px 0",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid #34d399",
  backgroundColor: "#064e3b",
  color: "#d1fae5"
}

const inventoryBackupActionsStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center",
  flexWrap: "wrap",
  marginTop: "12px"
}

const inventoryRestoreButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#374151",
  color: "white",
  padding: "12px 20px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer",
  marginRight: 0
}

const barcodeConfirmCardStyle = {
  marginTop: "14px",
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid #facc15",
  backgroundColor: "#422006",
  color: "#fef3c7"
}

const barcodeResultCardStyle = {
  display: "flex",
  gap: "16px",
  alignItems: "flex-start",
  marginTop: "14px",
  padding: "16px",
  borderRadius: "12px",
  border: "1px solid #22d3ee",
  backgroundColor: "#111827"
}

const barcodeResultImageStyle = {
  width: "120px",
  height: "120px",
  borderRadius: "12px",
  objectFit: "cover",
  border: "1px solid #334155",
  backgroundColor: "#1f2937",
  flex: "0 0 auto"
}

const barcodeResultPlaceholderStyle = {
  ...barcodeResultImageStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "42px"
}

const dateLabelStyle = {
  marginBottom: "6px",
  display: "block",
  color: "#cbd5e1"
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

const suggestionsBoxStyle = {
  backgroundColor: "#111827",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #374151",
  marginBottom: "10px",
  display: "grid",
  gap: "8px"
}

const suggestionButtonStyle = {
  backgroundColor: "#1f2937",
  color: "white",
  border: "1px solid #374151",
  borderRadius: "8px",
  padding: "10px",
  textAlign: "left",
  cursor: "pointer"
}

const suggestionItemStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  width: "100%",
  padding: "10px",
  borderRadius: "10px",
  border: "1px solid #374151",
  backgroundColor: "#111827",
  textAlign: "left",
  cursor: "pointer"
}

const suggestionThumbnailStyle = {
  width: "52px",
  height: "52px",
  borderRadius: "10px",
  objectFit: "cover",
  border: "1px solid #374151",
  backgroundColor: "#1f2937"
}

const suggestionPlaceholderThumbStyle = {
  width: "52px",
  height: "52px",
  borderRadius: "10px",
  border: "1px solid #374151",
  backgroundColor: "#1f2937",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#9ca3af",
  fontSize: "12px"
}

const infoBoxStyle = {
  backgroundColor: "#111827",
  border: "1px solid #374151",
  borderRadius: "10px",
  padding: "12px",
  marginBottom: "10px"
}

const deleteButtonStyle = {
  backgroundColor: "#dc2626",
  color: "white",
  padding: "8px 12px",
  border: "none",
  borderRadius: "8px",
  cursor: "pointer"
}

const orderBoxStyle = {
  marginTop: "20px",
  backgroundColor: "#111827",
  padding: "15px",
  borderRadius: "10px",
  border: "1px solid #374151"
}

const orderItemStyle = {
  backgroundColor: "#1f2937",
  padding: "12px",
  borderRadius: "8px",
  marginBottom: "10px",
  border: "1px solid #374151"
}

const cardsContainer = {
  marginTop: "30px"
}

const inventoryLocationToolbarStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  flexWrap: "wrap",
  marginBottom: "16px"
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

const inventoryLocationButtonStyle = {
  padding: "9px 14px",
  borderRadius: "8px",
  border: "1px solid #334155",
  backgroundColor: "#111827",
  color: "#e5e7eb",
  cursor: "pointer"
}

const inventoryLocationButtonActiveStyle = {
  ...inventoryLocationButtonStyle,
  borderColor: "#14b8a6",
  backgroundColor: "#0f766e",
  color: "#ecfeff"
}

const inventoryTableStyle = {
  display: "grid",
  gap: "8px",
  marginTop: "12px"
}

const inventoryTableRowStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(150px, 1.3fr) repeat(3, minmax(80px, 0.7fr)) minmax(170px, 1.25fr) minmax(130px, 0.9fr)",
  gap: "10px",
  alignItems: "center",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #374151",
  backgroundColor: "#1f2937"
}

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: "20px",
  marginTop: "20px"
}

const cardInventario = {
  backgroundColor: "#1f2937",
  padding: "20px",
  borderRadius: "12px",
  border: "1px solid #374151",
  boxShadow: "0 4px 10px rgba(0,0,0,0.3)"
}

const highlightedInventoryCardStyle = {
  border: "2px solid #22d3ee",
  boxShadow: "0 0 0 4px rgba(34, 211, 238, 0.16), 0 14px 30px rgba(0,0,0,0.35)"
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

const historialCard = {
  backgroundColor: "#1f2937",
  padding: "15px",
  borderRadius: "10px",
  border: "1px solid #374151",
  marginBottom: "15px"
}

const ingredientImageStyle = {
  width: "100%",
  height: "180px",
  objectFit: "cover",
  borderRadius: "10px",
  border: "1px solid #374151",
  backgroundColor: "#111827"
}

const placeholderImageStyle = {
  width: "100%",
  height: "180px",
  borderRadius: "10px",
  border: "1px dashed #4b5563",
  backgroundColor: "#111827",
  color: "#9ca3af",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "18px"
}

const imagePreviewBox = {
  marginBottom: "15px",
  backgroundColor: "#111827",
  padding: "12px",
  borderRadius: "10px",
  border: "1px solid #374151"
}

const previewImageStyle = {
  width: "100%",
  maxWidth: "320px",
  height: "220px",
  objectFit: "cover",
  borderRadius: "10px",
  display: "block",
  marginBottom: "10px"
}

export default LegacyInventoryApp
