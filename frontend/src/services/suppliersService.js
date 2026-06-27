import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"

const DAY_KEYS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function deliveryDaysToArray(days) {
  if (Array.isArray(days)) return days.filter(Boolean)
  if (!days || typeof days !== "object") return []
  return Object.entries(days).filter(([, enabled]) => enabled).map(([day]) => day)
}

function deliveryDaysToObject(days) {
  const enabled = new Set(Array.isArray(days) ? days : [])
  return Object.fromEntries(DAY_KEYS.map((day) => [day, enabled.has(day)]))
}

function supplierPayload(supplier) {
  const phones = Array.isArray(supplier.telefonos) ? supplier.telefonos : []
  return {
    code: String(supplier.code || supplier.codigo || "").trim() || null,
    name: String(supplier.name || supplier.nombreComercial || "").trim(),
    legal_name: String(supplier.legalName || supplier.razonSocial || "").trim() || null,
    tax_id: String(supplier.taxId || supplier.nit || "").trim() || null,
    supplier_type: String(supplier.supplierType || supplier.tipo || "").trim() || null,
    contact_name: String(supplier.contactName || supplier.encargado || "").trim() || null,
    phone: String(supplier.phone || supplier.telefono || phones[0] || "").trim() || null,
    phone_2: String(supplier.phone2 || supplier.telefono2 || phones[1] || "").trim() || null,
    phone_3: String(supplier.phone3 || supplier.telefono3 || phones[2] || "").trim() || null,
    whatsapp: String(supplier.whatsapp || supplier.whatsApp || "").trim() || null,
    email: String(supplier.email || supplier.correo || "").trim() || null,
    website: String(supplier.website || supplier.paginaWeb || "").trim() || null,
    address: String(supplier.address || supplier.direccion || "").trim() || null,
    delivery_days: deliveryDaysToArray(supplier.deliveryDays || supplier.diasEntrega),
    payment_methods: supplier.paymentMethods || supplier.metodosPago || {},
    bank_account: String(supplier.bankAccount || supplier.cuentaBancaria || "").trim() || null,
    bank: String(supplier.bank || supplier.banco || "").trim() || null,
    lead_time: String(supplier.leadTime || supplier.tiempoEntrega || "").trim() || null,
    rating: Number(supplier.rating || supplier.estrellas || 3),
    purchase_history: Array.isArray(supplier.purchaseHistory)
      ? supplier.purchaseHistory
      : Array.isArray(supplier.historialCompras)
        ? supplier.historialCompras
        : [],
    notes: String(supplier.notes || supplier.notas || "").trim() || null,
    status: supplier.status || "active"
  }
}

export function mapSupplier(row) {
  if (!row) return row
  const phones = [row.phone, row.phone_2, row.phone_3].filter(Boolean)
  return {
    ...row,
    codigo: row.code || "",
    nombreComercial: row.name || "",
    razonSocial: row.legal_name || "",
    nit: row.tax_id || "",
    tipo: row.supplier_type || "",
    encargado: row.contact_name || "",
    telefono: row.phone || "",
    telefono2: row.phone_2 || "",
    telefono3: row.phone_3 || "",
    telefonos: phones,
    correo: row.email || "",
    paginaWeb: row.website || "",
    direccion: row.address || "",
    diasEntrega: deliveryDaysToObject(row.delivery_days),
    metodosPago: row.payment_methods || {},
    cuentaBancaria: row.bank_account || "",
    banco: row.bank || "",
    tiempoEntrega: row.lead_time || "",
    estrellas: Number(row.rating || 3),
    historialCompras: Array.isArray(row.purchase_history) ? row.purchase_history : [],
    creado: row.created_at ? new Date(row.created_at).toLocaleString("es-GT") : "",
    updatedAt: row.updated_at || ""
  }
}

export function getSuppliers() {
  return cachedQuery(CACHE_KEYS.SUPPLIERS_ACTIVE, async () => {
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("status", "active")
      .order("name", { ascending: true })
    return { data: (data || []).map(mapSupplier), error }
  }, CACHE_TTL.CATALOG)
}

function invalidateSuppliersCache() {
  invalidateQueryCache(CACHE_KEYS.SUPPLIERS_PREFIX)
}

export async function createSupplier(supplier) {
  const { data, error } = await supabase
    .from("suppliers")
    .insert(supplierPayload(supplier))
    .select("*")
    .single()
  if (!error) invalidateSuppliersCache()
  return { data: mapSupplier(data), error }
}

export async function updateSupplier(id, updates) {
  const { data, error } = await supabase
    .from("suppliers")
    .update(supplierPayload(updates))
    .eq("id", id)
    .select("*")
    .single()
  if (!error) invalidateSuppliersCache()
  return { data: mapSupplier(data), error }
}

export async function deactivateSupplier(id) {
  const { data, error } = await supabase
    .from("suppliers")
    .update({ status: "inactive" })
    .eq("id", id)
    .select("*")
    .single()
  if (!error) invalidateSuppliersCache()
  return { data: mapSupplier(data), error }
}

export async function migrateLocalSuppliers(localSuppliers) {
  const legacyRows = Array.isArray(localSuppliers) ? localSuppliers : []
  if (!legacyRows.length) return { data: [], error: null, imported: 0 }

  const existingResult = await getSuppliers()
  if (existingResult.error) return { data: [], error: existingResult.error, imported: 0 }

  const existingNames = new Set(existingResult.data.map((supplier) => normalizeName(supplier.name || supplier.nombreComercial)))
  const rowsToCreate = legacyRows.filter((supplier) => {
    const name = normalizeName(supplier.name || supplier.nombreComercial)
    if (!name || existingNames.has(name)) return false
    existingNames.add(name)
    return true
  })

  if (!rowsToCreate.length) return { data: existingResult.data, error: null, imported: 0 }

  const payload = rowsToCreate.map(supplierPayload)
  const { data, error } = await supabase
    .from("suppliers")
    .insert(payload)
    .select("*")
  if (!error) invalidateSuppliersCache()
  return { data: (data || []).map(mapSupplier), error, imported: error ? 0 : rowsToCreate.length }
}
