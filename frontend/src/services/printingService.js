import { supabase } from "../lib/supabase"

export const PRINT_JOB_TYPES = ["test", "prebill", "receipt", "delivery_order"]

export function normalizeSupportedJobTypes(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || "").trim()).filter(Boolean)
  }
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed)
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry || "").trim()).filter(Boolean) : []
      } catch {
        // fall through
      }
    }
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((entry) => entry.trim().replace(/^"|"$/g, ""))
        .filter(Boolean)
    }
    return trimmed.split(",").map((entry) => entry.trim()).filter(Boolean)
  }
  return []
}

export function printerSupportsJobType(printer, jobType) {
  if (!jobType) return true
  return normalizeSupportedJobTypes(printer?.supported_job_types).includes(jobType)
}

export async function getPosPrinters() {
  const { data, error } = await supabase
    .from("pos_printers")
    .select("*")
    .order("is_active", { ascending: false })
    .order("name", { ascending: true })
  return { data: data || [], error }
}

export async function getActivePosPrinters({ jobType = "" } = {}) {
  const { data, error } = await supabase
    .from("pos_printers")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true })

  const printers = jobType
    ? (data || []).filter((printer) => printerSupportsJobType(printer, jobType))
    : (data || [])

  return { data: printers, error }
}

export function pickPosPrinterForJob(printers, { jobType = "", locationHint = "CAJA" } = {}) {
  const candidates = (printers || []).filter((printer) => !jobType || printerSupportsJobType(printer, jobType))
  if (!candidates.length) return null

  const hint = String(locationHint || "").trim().toUpperCase()
  const matchers = hint
    ? [
      (printer) => String(printer.location || "").trim().toUpperCase() === hint,
      (printer) => String(printer.windows_printer_name || "").trim().toUpperCase() === hint,
      (printer) => String(printer.name || "").trim().toUpperCase() === hint,
      (printer) => String(printer.location || "").toUpperCase().includes(hint),
      (printer) => String(printer.name || "").toUpperCase().includes(hint),
      (printer) => String(printer.windows_printer_name || "").toUpperCase().includes(hint)
    ]
    : []

  for (const match of matchers) {
    const selected = candidates.find(match)
    if (selected) return selected
  }

  return candidates[0] || null
}

export async function getPosPrinterById(printerId) {
  if (!printerId) return { data: null, error: { message: "printer_id requerido" } }
  const { data, error } = await supabase
    .from("pos_printers")
    .select("id, name, windows_printer_name, location, supported_job_types, is_active")
    .eq("id", printerId)
    .maybeSingle()
  return { data, error }
}

export async function savePosPrinter(printer) {
  const payload = {
    name: printer.name?.trim(),
    windows_printer_name: printer.windows_printer_name?.trim(),
    location: printer.location?.trim() || null,
    printer_type: printer.printer_type || "windows_usb",
    ip_address: printer.ip_address?.trim() || null,
    port: Number(printer.port || 9100),
    paper_width: printer.paper_width || "80mm",
    supported_job_types: Array.isArray(printer.supported_job_types) && printer.supported_job_types.length
      ? printer.supported_job_types
      : ["test", "prebill"],
    is_active: printer.is_active !== false
  }

  const query = printer.id
    ? supabase.from("pos_printers").update(payload).eq("id", printer.id).select("*").single()
    : supabase.from("pos_printers").insert(payload).select("*").single()

  const { data, error } = await query
  return { data, error }
}

export async function setPosPrinterActive(id, isActive) {
  const { data, error } = await supabase
    .from("pos_printers")
    .update({ is_active: Boolean(isActive) })
    .eq("id", id)
    .select("*")
    .single()
  return { data, error }
}

export async function createPrintJob({ printerId, jobType = "test", payload = {} }) {
  const normalizedJobType = String(jobType || "test").trim().toLowerCase()
  const { data: printerRow, error: printerError } = await getPosPrinterById(printerId)
  const supportedTypes = normalizeSupportedJobTypes(printerRow?.supported_job_types)

  if (printerError) {
    return { data: null, error: printerError }
  }
  if (!printerRow?.is_active) {
    return { data: null, error: { message: "Impresora no encontrada o inactiva." } }
  }
  if (!supportedTypes.includes(normalizedJobType)) {
    const message = `La impresora "${printerRow.name}" (${printerId}) no incluye "${normalizedJobType}" en supported_job_types: [${supportedTypes.join(", ")}]`
    return { data: null, error: { message } }
  }

  const { data, error } = await supabase.rpc("create_print_job", {
    p_printer_id: printerId,
    p_job_type: normalizedJobType,
    p_payload: payload
  })

  if (error) {
    console.error("[printingService] createPrintJob failed:", error.message, { printerId, jobType: normalizedJobType })
  }

  return { data, error }
}

export function buildTestPrintPayload(printer) {
  return {
    title: "PRUEBA DE IMPRESIÓN ERP",
    business_name: "EL GRAN ALCÁZAR",
    printer_name: printer.name,
    windows_printer_name: printer.windows_printer_name,
    requested_at: new Date().toISOString()
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function itemName(item) {
  return item.nombre || item.name || item.productName || item.product_name || item.title || "Producto"
}

function itemNotes(item) {
  return [
    item.notas,
    item.notes,
    item.comment,
    item.instrucciones,
    item.instructions,
    item.modificacionesTexto
  ].filter(Boolean).join(" | ")
}

export function buildPrebillPrintPayload(order, options = {}) {
  const rawItems = Array.isArray(order?.items) ? order.items : []
  const items = rawItems
    .filter((item) => item.status !== "cancelled")
    .map((item) => {
      const quantity = toNumber(item.cantidad ?? item.quantity ?? item.qty, 1)
      const unitPrice = toNumber(item.precio ?? item.price ?? item.unitPrice ?? item.unit_price, 0)
      const subtotal = toNumber(item.subtotal ?? item.line_total ?? item.total, quantity * unitPrice)

      return {
        name: itemName(item),
        quantity,
        unit_price: unitPrice,
        subtotal,
        notes: itemNotes(item)
      }
    })

  const itemsSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
  const total = toNumber(order?.total ?? options.total, itemsSubtotal)

  return {
    business_name: options.restaurantName || "EL GRAN ALCÁZAR",
    order_id: options.orderId || order?.id || order?.order_id || null,
    table_id: options.tableId || order?.mesaId || order?.table_id || null,
    table_name: order?.tableName || order?.mesa || order?.table_name || "Mesa",
    waiter_name: order?.waiterName || order?.usuarioNombre || order?.waiter_name || "POS",
    printed_at_gt: new Date().toLocaleString("es-GT", {
      timeZone: "America/Guatemala",
      dateStyle: "short",
      timeStyle: "medium"
    }),
    items,
    subtotal: toNumber(order?.subtotal, itemsSubtotal),
    total,
    people_count: order?.peopleCount || null,
    notes: order?.notes || order?.notas || ""
  }
}
