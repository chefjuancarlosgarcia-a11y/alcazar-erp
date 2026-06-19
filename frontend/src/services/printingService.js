import { supabase } from "../lib/supabase"
import { withTimeout } from "./productionTicketsService"
import {
  formatEscPosReceiptLines,
  loadFinalBillTemplate
} from "./ticketEscPosRenderer"

const IS_DEV = import.meta.env.DEV

function printDebug(...args) {
  if (IS_DEV) console.log(...args)
}

function printWarn(...args) {
  if (IS_DEV) console.warn(...args)
}

export const PRINT_JOB_TYPES = ["test", "prebill", "receipt", "delivery_order"]

const RECEIPT_PRINT_QUERY_TIMEOUT_MS = 8000
const RECEIPT_PRINT_RPC_TIMEOUT_MS = 8000
const RECEIPT_PRINT_LOOKUP_TIMEOUT_MS = 5000

const ACTIVE_PRINTER_SELECT =
  "id,name,windows_printer_name,location,supported_job_types,is_active"

function logReceiptQueryChain(label, { withOrder = false } = {}) {
  printDebug("[Receipt Print] query chain", {
    label,
    terminalMethods: {
      maybeSingle: false,
      single: false,
      throwOnError: false,
      returns: false,
      overrideTypes: false,
      executed: "default filter builder (array JSON response)"
    },
    withOrder
  })
}

function sortPrintersByName(printers = []) {
  return [...printers].sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || ""), "es"))
}

function isReceiptDebug(jobType) {
  return String(jobType || "").trim().toLowerCase() === "receipt"
}

async function awaitSupabaseQuery(queryBuilder, { timeoutMs, label, receiptDebug = false }) {
  if (receiptDebug) {
    printDebug("[Receipt Print] timeout wrapper", {
      strategy: "Promise.race",
      helper: "withTimeout (productionTicketsService)",
      abortController: false,
      timeoutMs,
      label
    })
    printDebug("[Receipt Print] before supabase query", label)
  }

  const startedAt = Date.now()
  try {
    const result = await withTimeout(
      (async () => queryBuilder)(),
      timeoutMs,
      label
    )
    if (receiptDebug) {
      printDebug("[Receipt Print] after supabase query", {
        label,
        ms: Date.now() - startedAt,
        error: result.error?.message || null,
        dataLength: result.data?.length ?? 0
      })
      if (result.error) {
        printWarn("[Receipt Print] query error", result.error.message || result.error)
      } else {
        printDebug("[Receipt Print] query data length", result.data?.length ?? 0)
      }
    }
    return result
  } catch (error) {
    if (receiptDebug) {
      printWarn("[Receipt Print] query error", error?.message || error)
      printDebug("[Receipt Print] after supabase query", {
        label,
        ms: Date.now() - startedAt,
        timedOut: true
      })
    }
    throw error
  }
}

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
  const normalizedJobType = String(jobType || "").trim().toLowerCase()
  const receiptDebug = isReceiptDebug(normalizedJobType)

  if (receiptDebug) {
    printDebug("[Receipt Print] getActivePosPrinters start", { jobType: normalizedJobType })
    printDebug("[Receipt Print] query equivalent SQL", [
      "-- minimal (receipt debug)",
      "select id, name, supported_job_types",
      "from pos_printers",
      "where is_active = true;",
      "",
      "-- no-order diagnostic",
      `select ${ACTIVE_PRINTER_SELECT.replace(/,/g, ", ")}`,
      "from pos_printers",
      "where is_active = true;",
      "",
      "-- full with order (diagnostic)",
      `select ${ACTIVE_PRINTER_SELECT.replace(/,/g, ", ")}`,
      "from pos_printers",
      "where is_active = true",
      "order by name asc;"
    ].join("\n"))
    printDebug("[Receipt Print] receipt vs prebill", {
      sqlDifference: "none — same Supabase query; jobType filtered client-side",
      prebillFilter: "supported_job_types includes 'prebill'",
      receiptFilter: "supported_job_types includes 'receipt'"
    })
  }

  if (receiptDebug) {
    printDebug("[Receipt Print] minimal query start", {
      from: "pos_printers",
      select: "id,name,supported_job_types",
      eq: { is_active: true }
    })
    try {
      await awaitSupabaseQuery(
        supabase
          .from("pos_printers")
          .select("id,name,supported_job_types")
          .eq("is_active", true),
        {
          timeoutMs: RECEIPT_PRINT_QUERY_TIMEOUT_MS,
          label: "pos_printers minimal",
          receiptDebug: true
        }
      )
    } catch (error) {
      printWarn("[Receipt Print] minimal query failed", error?.message || error)
      return { data: [], error: { message: error?.message || "Timeout en consulta mínima de impresoras." } }
    }
  }

  let data
  let error

  if (receiptDebug) {
    printDebug("[Receipt Print] no-order query start", {
      from: "pos_printers",
      select: ACTIVE_PRINTER_SELECT,
      eq: { is_active: true },
      order: null
    })
    logReceiptQueryChain("pos_printers no-order", { withOrder: false })
    try {
      const noOrderResult = await awaitSupabaseQuery(
        supabase
          .from("pos_printers")
          .select(ACTIVE_PRINTER_SELECT)
          .eq("is_active", true),
        {
          timeoutMs: RECEIPT_PRINT_QUERY_TIMEOUT_MS,
          label: "pos_printers no-order",
          receiptDebug: true
        }
      )
      printDebug("[Receipt Print] no-order query result", {
        dataLength: noOrderResult.data?.length ?? 0,
        error: noOrderResult.error?.message || null
      })
    } catch (noOrderError) {
      printWarn("[Receipt Print] no-order query failed", noOrderError?.message || noOrderError)
    }

    printDebug("[Receipt Print] full query start", {
      from: "pos_printers",
      select: ACTIVE_PRINTER_SELECT,
      eq: { is_active: true },
      order: { name: "asc" }
    })
    logReceiptQueryChain("pos_printers full", { withOrder: true })

    let queryWithOrder = supabase
      .from("pos_printers")
      .select(ACTIVE_PRINTER_SELECT)
      .eq("is_active", true)
    printDebug("[Receipt Print] before order(name)")
    queryWithOrder = queryWithOrder.order("name", { ascending: true })
    printDebug("[Receipt Print] after order(name)")

    try {
      const orderedResult = await awaitSupabaseQuery(queryWithOrder, {
        timeoutMs: RECEIPT_PRINT_QUERY_TIMEOUT_MS,
        label: "pos_printers full",
        receiptDebug: true
      })
      data = orderedResult.data
      error = orderedResult.error
      printDebug("[Receipt Print] full query with order succeeded", {
        dataLength: data?.length ?? 0,
        error: error?.message || null
      })
    } catch (orderedError) {
      printWarn("[Receipt Print] full query with order failed", orderedError?.message || orderedError)
      printDebug("[Receipt Print] falling back to no-order + client sort")
      try {
        const fallbackResult = await awaitSupabaseQuery(
          supabase
            .from("pos_printers")
            .select(ACTIVE_PRINTER_SELECT)
            .eq("is_active", true),
          {
            timeoutMs: RECEIPT_PRINT_QUERY_TIMEOUT_MS,
            label: "pos_printers fallback no-order",
            receiptDebug: true
          }
        )
        data = sortPrintersByName(fallbackResult.data || [])
        error = fallbackResult.error
      } catch (fallbackError) {
        if (receiptDebug) {
          printDebug("[Receipt Print] getActivePosPrinters result", {
            error: fallbackError?.message || String(fallbackError),
            rawCount: 0,
            filteredCount: 0
          })
        }
        return { data: [], error: { message: fallbackError?.message || "Timeout listando impresoras." } }
      }
    }
  } else {
    try {
      const fullResult = await awaitSupabaseQuery(
        supabase
          .from("pos_printers")
          .select(ACTIVE_PRINTER_SELECT)
          .eq("is_active", true),
        {
          timeoutMs: RECEIPT_PRINT_QUERY_TIMEOUT_MS,
          label: "pos_printers active",
          receiptDebug: false
        }
      )
      data = sortPrintersByName(fullResult.data || [])
      error = fullResult.error
    } catch (queryError) {
      return { data: [], error: { message: queryError?.message || "Timeout listando impresoras." } }
    }
  }

  const printers = normalizedJobType
    ? (data || []).filter((printer) => printerSupportsJobType(printer, normalizedJobType))
    : (data || [])

  if (receiptDebug) {
    const allActive = data || []
    printDebug("[Receipt Print] getActivePosPrinters result", {
      ms: "see after supabase query logs",
      error: error?.message || null,
      rawCount: allActive.length,
      receiptCount: printers.length,
      prebillCount: allActive.filter((printer) => printerSupportsJobType(printer, "prebill")).length,
      printers: allActive.map((printer) => ({
        id: printer.id,
        name: printer.name,
        location: printer.location,
        supported_job_types: printer.supported_job_types
      }))
    })
  }

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
      : ["test", "prebill", "receipt"],
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
  const isReceiptJob = normalizedJobType === "receipt"
  if (isReceiptJob) {
    printDebug("[Receipt Print] createPrintJob start", { printerId, jobType: normalizedJobType })
  }

  let printerRow
  let printerError
  try {
    const lookup = await withTimeout(
      getPosPrinterById(printerId),
      RECEIPT_PRINT_LOOKUP_TIMEOUT_MS,
      "getPosPrinterById"
    )
    printerRow = lookup.data
    printerError = lookup.error
  } catch (error) {
    if (isReceiptJob) {
      printWarn("[Receipt Print] createPrintJob error", error?.message || error)
    }
    return { data: null, error: { message: error?.message || "Timeout consultando impresora." } }
  }

  const supportedTypes = normalizeSupportedJobTypes(printerRow?.supported_job_types)

  if (printerError) {
    if (isReceiptJob) printWarn("[Receipt Print] createPrintJob error", printerError.message || printerError)
    return { data: null, error: printerError }
  }
  if (!printerRow?.is_active) {
    const message = "Impresora no encontrada o inactiva."
    if (isReceiptJob) printWarn("[Receipt Print] createPrintJob error", message)
    return { data: null, error: { message } }
  }
  if (!supportedTypes.includes(normalizedJobType)) {
    const message = `La impresora "${printerRow.name}" (${printerId}) no incluye "${normalizedJobType}" en supported_job_types: [${supportedTypes.join(", ")}]`
    if (isReceiptJob) printWarn("[Receipt Print] createPrintJob error", message)
    return { data: null, error: { message } }
  }

  let data
  let error
  try {
    const rpcResult = await withTimeout(
      supabase.rpc("create_print_job", {
        p_printer_id: printerId,
        p_job_type: normalizedJobType,
        p_payload: payload
      }),
      RECEIPT_PRINT_RPC_TIMEOUT_MS,
      "create_print_job rpc"
    )
    data = rpcResult.data
    error = rpcResult.error
  } catch (rpcError) {
    if (isReceiptJob) {
      printWarn("[Receipt Print] createPrintJob error", rpcError?.message || rpcError)
    }
    return { data: null, error: { message: rpcError?.message || "Timeout en create_print_job." } }
  }

  if (error) {
    console.error("[printingService] createPrintJob failed:", error.message, { printerId, jobType: normalizedJobType })
    if (isReceiptJob) printWarn("[Receipt Print] createPrintJob error", error.message || error)
  } else if (isReceiptJob) {
    printDebug("[Receipt Print] createPrintJob result", { jobId: data?.id, status: data?.status })
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

const PAYMENT_METHOD_LABELS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  qr: "QR",
  gift_card: "Gift card",
  accounts_receivable: "Cuenta por cobrar",
  courtesy: "Cortesía"
}

function formatPaymentMethods(methods = []) {
  return (methods || [])
    .filter((method) => Number(method.amount) > 0)
    .map((method) => {
      const label = PAYMENT_METHOD_LABELS[method.method] || method.method || "Pago"
      return `${label}: Q${toNumber(method.amount).toFixed(2)}`
    })
    .join(", ")
}

export function buildReceiptPrintPayload(order, payment = {}, options = {}) {
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
  const subtotal = toNumber(order?.subtotal ?? payment?.subtotal, itemsSubtotal)
  const discountAmount = toNumber(payment.discountAmount ?? order?.discounts, 0)
  const tipAmount = toNumber(payment.tipAmount, 0)
  const total = toNumber(payment.totalAmount ?? order?.total, subtotal - discountAmount + tipAmount)
  const printedAt = new Date().toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    dateStyle: "short",
    timeStyle: "medium"
  })

  return {
    restaurant_name: options.restaurantName || "EL GRAN ALCÁZAR",
    receipt_number: options.receiptNumber || payment.paymentNumber || payment.id || null,
    order_id: options.orderId || order?.id || payment.orderId || null,
    order_label: options.orderLabel || options.receiptNumber || null,
    table_name: order?.tableName || order?.mesa || order?.table_name || "Mesa",
    waiter_name: order?.waiterName || order?.usuarioNombre || payment.waiterName || "—",
    cashier_name: payment.cashierName || options.cashierName || "Caja",
    printed_at_gt: printedAt,
    created_at: printedAt,
    items,
    subtotal,
    discount_amount: discountAmount,
    tip_amount: tipAmount,
    total,
    payment_methods: formatPaymentMethods(payment.methods),
    footer_message: "Gracias por visitarnos"
  }
}

export async function buildReceiptPrintPayloadAsync(order, payment = {}, options = {}) {
  const base = buildReceiptPrintPayload(order, payment, options)

  try {
    const template = options.template || await loadFinalBillTemplate()
    if (!template) {
      printWarn("[Ticket ESC/POS] template loaded", { templateKey: null, fallback: true })
      return base
    }

    printDebug("[Ticket ESC/POS] template loaded", {
      templateKey: template.template_key,
      name: template.name,
      paperWidth: template.paper_width
    })

    const ticketType = options.ticketType || "final_bill"
    const rendered = formatEscPosReceiptLines(
      order,
      template,
      ticketType,
      payment,
      {
        ...options,
        printedAt: base.printed_at_gt,
        billingCustomer: options.billingCustomer || payment.billingCustomer
      }
    )

    printDebug("[Ticket ESC/POS] lines generated", {
      count: rendered.lines.length,
      paperWidth: rendered.paperWidth
    })

    return {
      ...base,
      lines: rendered.lines,
      paper_width: rendered.paperWidth,
      paperWidth: rendered.paperWidth,
      template_key: rendered.templateKey,
      ticket_type: rendered.ticketType,
      footer_message: template.settings?.messages?.footerMessage || base.footer_message
    }
  } catch (error) {
    printWarn("[Ticket ESC/POS] renderer failed, using fallback payload", error?.message || error)
    return base
  }
}

export async function queueReceiptPrintJob({ payload, order, payment, options, locationHint = "CAJA" } = {}) {
  printDebug("[Receipt Print] attempting queueReceiptPrintJob", { locationHint })
  try {
    let resolvedPayload = payload
    if (!resolvedPayload && order) {
      try {
        resolvedPayload = await buildReceiptPrintPayloadAsync(order, payment || {}, options || {})
      } catch (error) {
        printWarn("[Receipt Print] payload build failed, using minimal fallback", error?.message || error)
        resolvedPayload = buildReceiptPrintPayload(order, payment || {}, options || {})
      }
    }

    if (!resolvedPayload) {
      return { ok: false, error: { message: "Payload de recibo requerido." } }
    }

    printDebug("[Receipt Print] payload lines count", resolvedPayload.lines?.length ?? 0)
    let printersResult
    try {
      printersResult = await getActivePosPrinters({ jobType: "receipt" })
    } catch (error) {
      return { ok: false, error: { message: error?.message || "Timeout listando impresoras." } }
    }

    if (printersResult.error) {
      printWarn("[Receipt Print] error", printersResult.error?.message || printersResult.error)
      return { ok: false, error: printersResult.error }
    }

    const selectedPrinter = pickPosPrinterForJob(printersResult.data || [], {
      jobType: "receipt",
      locationHint
    })

    if (!selectedPrinter) {
      const message = "No hay impresora configurada para recibos."
      printWarn("[Receipt Print] error", message)
      return { ok: false, error: { message } }
    }

    printDebug("[Receipt Print] selected printer", {
      id: selectedPrinter.id,
      name: selectedPrinter.name,
      location: selectedPrinter.location,
      windows_printer_name: selectedPrinter.windows_printer_name,
      supported_job_types: selectedPrinter.supported_job_types
    })

    const printJob = await createPrintJob({
      printerId: selectedPrinter.id,
      jobType: "receipt",
      payload: resolvedPayload
    })

    if (printJob.error) {
      return { ok: false, error: printJob.error }
    }

    printDebug("[Receipt Print] result", {
      ok: true,
      jobId: printJob.data?.id,
      printerId: selectedPrinter.id,
      printerName: selectedPrinter.name
    })
    return { ok: true, data: printJob.data, printer: selectedPrinter }
  } catch (error) {
    printWarn("[Receipt Print] error", error?.message || error)
    return { ok: false, error: { message: error?.message || "Error encolando recibo." } }
  } finally {
    printDebug("[Receipt Print] queueReceiptPrintJob complete")
  }
}
