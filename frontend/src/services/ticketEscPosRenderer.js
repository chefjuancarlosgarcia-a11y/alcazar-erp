import {
  DEFAULT_TICKET_SETTINGS,
  getActiveTicketTemplate,
  getCachedTicketTemplate,
  normalizeTicketTemplate
} from "./ticketTemplatesService"
import { normalizeBillingCustomer } from "../utils/billingCustomer"

const PAYMENT_METHOD_LABELS = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  qr: "QR",
  gift_card: "Gift card",
  accounts_receivable: "Cuenta por cobrar",
  courtesy: "Cortesía"
}

function money(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

export function paperWidthChars(paperWidth = "58mm") {
  const normalized = String(paperWidth || "58mm").trim().toLowerCase()
  return normalized === "80mm" || normalized === "letter" ? 48 : 32
}

function resolvePaperWidth(template) {
  const width = String(template?.paper_width || "58mm").trim().toLowerCase()
  if (width === "80mm") return "80mm"
  if (width === "letter") return "80mm"
  return "58mm"
}

function padRight(text, width) {
  const value = String(text ?? "")
  if (value.length >= width) return value.slice(0, width)
  return `${value}${" ".repeat(width - value.length)}`
}

function padLeft(text, width) {
  const value = String(text ?? "")
  if (value.length >= width) return value.slice(-width)
  return `${" ".repeat(width - value.length)}${value}`
}

function wrapText(text, width) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean)
  if (!words.length) return [""]
  const lines = []
  let current = ""
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= width) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    current = word.length > width ? word.slice(0, width) : word
  }
  if (current) lines.push(current)
  return lines
}

function centerText(text, width) {
  const value = String(text || "").trim()
  if (!value) return ""
  if (value.length >= width) return value.slice(0, width)
  const pad = Math.floor((width - value.length) / 2)
  return `${" ".repeat(Math.max(0, pad))}${value}`
}

function repeatDivider(settings, width) {
  if (!settings.layout?.showDividers) return ""
  const style = settings.layout.dividerStyle === "solid" ? "=" : settings.layout.dividerStyle === "dotted" ? "." : "-"
  return repeatChar(style, width)
}

function repeatChar(char, width) {
  return String(char || "-").repeat(Math.max(0, width))
}

function pushLine(lines, text, width) {
  const value = String(text ?? "")
  if (!value) return
  lines.push(value.slice(0, width))
}

function pushWrapped(lines, text, width, compact) {
  const wrapped = wrapText(text, width)
  wrapped.forEach((entry) => pushLine(lines, entry, width))
  if (!compact && wrapped.length) lines.push("")
}

function pushBlank(lines, compact) {
  if (!compact) lines.push("")
}

function orderItems(order) {
  return (order?.items || []).filter((item) => item.status !== "cancelled")
}

function itemName(item) {
  return item.nombre || item.productName || item.product_name || item.name || "Producto"
}

function itemQuantity(item) {
  return Number(item.cantidad ?? item.quantity ?? item.qty ?? 0)
}

function itemPrice(item) {
  return Number(item.precio ?? item.unitPrice ?? item.unit_price ?? item.price ?? 0)
}

function formatPaymentMethods(payment = {}) {
  const methods = Array.isArray(payment.methods) ? payment.methods : []
  const formatted = methods
    .filter((method) => Number(method.amount) > 0)
    .map((method) => {
      const label = PAYMENT_METHOD_LABELS[method.method] || method.method || "Pago"
      return `${label}: ${money(method.amount)}`
    })
  if (formatted.length) return formatted.join(", ")
  if (payment.method) return PAYMENT_METHOD_LABELS[payment.method] || payment.method
  return ""
}

function ticketTitle(ticketType) {
  if (ticketType === "final_bill") return "CUENTA FINAL"
  if (ticketType === "delivery") return "DELIVERY"
  if (ticketType === "takeout") return "PARA LLEVAR"
  return "RECIBO"
}

export async function loadFinalBillTemplate() {
  const cached = getCachedTicketTemplate("final_bill")
  const result = await getActiveTicketTemplate("final_bill")
  if (result.source === "local" && !cached && !result.data?.id) return null
  return result.data
}

export function formatEscPosReceiptLines(orderInput = {}, templateInput = null, ticketType = "final_bill", payment = {}, options = {}) {
  const template = normalizeTicketTemplate(templateInput || { template_key: ticketType })
  const settings = {
    ...DEFAULT_TICKET_SETTINGS,
    ...template.settings,
    blocks: { ...DEFAULT_TICKET_SETTINGS.blocks, ...(template.settings?.blocks || {}) },
    business: { ...DEFAULT_TICKET_SETTINGS.business, ...(template.settings?.business || {}) },
    layout: { ...DEFAULT_TICKET_SETTINGS.layout, ...(template.settings?.layout || {}) },
    orderInfo: { ...DEFAULT_TICKET_SETTINGS.orderInfo, ...(template.settings?.orderInfo || {}) },
    items: { ...DEFAULT_TICKET_SETTINGS.items, ...(template.settings?.items || {}) },
    totals: { ...DEFAULT_TICKET_SETTINGS.totals, ...(template.settings?.totals || {}) },
    messages: { ...DEFAULT_TICKET_SETTINGS.messages, ...(template.settings?.messages || {}) }
  }

  const paperWidth = resolvePaperWidth(template)
  const width = paperWidthChars(paperWidth)
  const compact = Boolean(settings.layout.compactMode)
  const blocks = settings.blocks
  const business = settings.business
  const order = orderInput || {}
  const items = orderItems(order)
  const subtotal = Number(order.subtotal ?? items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))
  const discounts = Number(payment.discountAmount ?? order.discounts ?? 0)
  const tax = Number(order.taxes || order.tax || 0)
  const tipAmount = Number(payment.tipAmount ?? 0)
  const paid = Number(payment.totalAmount ?? order.total ?? subtotal - discounts + tax + tipAmount)
  const channel = order.salesChannel || order.sales_channel || (ticketType === "delivery" ? "delivery" : "dine_in")
  const delivery = order.delivery || {}
  const billing = normalizeBillingCustomer(payment.billingCustomer || order.billingCustomer || options.billingCustomer || {})
  const paymentMethod = formatPaymentMethods(payment) || delivery.paymentMethod || order.paymentMethod || "-"
  const printedAt = options.printedAt || new Date().toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
    dateStyle: "short",
    timeStyle: "medium"
  })

  const lines = []
  const divider = () => {
    const rule = repeatDivider(settings, width)
    if (rule) lines.push(rule)
  }

  if (blocks.showBusiness) {
    if (business.showBusinessName && business.businessName) {
      pushLine(lines, centerText(business.businessName, width), width)
    }
    if (business.showSubtitle && business.subtitle) {
      pushLine(lines, centerText(business.subtitle, width), width)
    }
    if (business.showNit && business.nit) {
      pushLine(lines, `NIT: ${business.nit}`.slice(0, width), width)
    }
    if (business.showAddress && business.address) {
      pushWrapped(lines, business.address, width, compact)
    }
    if (business.showPhone && business.phone) {
      pushLine(lines, `Tel: ${business.phone}`.slice(0, width), width)
    }
    if (business.showWebsite && business.website) {
      pushLine(lines, String(business.website).slice(0, width), width)
    }
    if (business.showInstagram && business.instagram) {
      pushLine(lines, String(business.instagram).slice(0, width), width)
    }
    pushBlank(lines, compact)
  }

  if (blocks.showHeader) {
    pushLine(lines, centerText(ticketTitle(ticketType), width), width)
    pushBlank(lines, compact)
  }

  if (blocks.showOrderInfo) {
    divider()
    if (settings.orderInfo.showOrderId) {
      pushLine(lines, `Orden: ${options.orderLabel || options.orderId || order.id || payment.orderId || "-"}`.slice(0, width), width)
    }
    if (settings.orderInfo.showDate) {
      pushLine(lines, `Fecha: ${printedAt}`.slice(0, width), width)
    }
    if (settings.orderInfo.showCashier) {
      pushLine(lines, `Cajero: ${payment.cashierName || options.cashierName || order.cashierName || "Caja"}`.slice(0, width), width)
    }
    if (settings.orderInfo.showWaiter) {
      pushLine(lines, `Mesero: ${order.waiterName || order.usuarioNombre || payment.waiterName || "-"}`.slice(0, width), width)
    }
    if (settings.orderInfo.showTable) {
      pushLine(lines, `Mesa: ${order.tableName || order.mesa || order.table_name || "Mesa"}`.slice(0, width), width)
    }
    if (settings.orderInfo.showSalesChannel) {
      pushLine(lines, `Canal: ${channel}`.slice(0, width), width)
    }
    if (settings.orderInfo.showPaymentMethod && paymentMethod && paymentMethod !== "-") {
      pushLine(lines, `Pago: ${paymentMethod}`.slice(0, width), width)
    }
    if (options.receiptNumber || payment.paymentNumber) {
      pushLine(lines, `Recibo: ${options.receiptNumber || payment.paymentNumber}`.slice(0, width), width)
    }
    pushBlank(lines, compact)
  }

  const showCustomer = blocks.showCustomer && (
    channel === "delivery"
    || ticketType === "delivery"
    || billing.name
    || billing.nit
    || delivery.customerName
  )

  if (showCustomer) {
    divider()
    pushLine(lines, "Cliente", width)
    if (billing.nit) pushLine(lines, `NIT: ${billing.nit}`.slice(0, width), width)
    if (settings.orderInfo.showCustomerName && (billing.name || delivery.customerName)) {
      pushLine(lines, `Nombre: ${billing.name || delivery.customerName}`.slice(0, width), width)
    }
    if (settings.orderInfo.showCustomerPhone && (billing.phone || delivery.phone)) {
      pushLine(lines, `Telefono: ${billing.phone || delivery.phone}`.slice(0, width), width)
    }
    if (settings.orderInfo.showDeliveryAddress && (billing.address || delivery.address)) {
      pushWrapped(lines, billing.address || delivery.address, width, compact)
    }
    if (settings.orderInfo.showDeliveryReference && delivery.reference) {
      pushWrapped(lines, delivery.reference, width, compact)
    }
    pushBlank(lines, compact)
  }

  if (blocks.showProducts && items.length) {
    divider()
    const qtyWidth = 4
    const totalWidth = 8
    const nameWidth = Math.max(8, width - qtyWidth - 1 - totalWidth)
    const indent = " ".repeat(qtyWidth + 1)
    lines.push(`${padRight("Cant", qtyWidth)} ${padRight("Producto", nameWidth)}${padLeft("Total", totalWidth)}`.slice(0, width))
    divider()

    for (const item of items) {
      const qty = itemQuantity(item)
      const price = itemPrice(item)
      const lineTotal = money(qty * price)
      const nameLines = wrapText(itemName(item), nameWidth)
      lines.push(`${padRight(String(qty), qtyWidth)} ${padRight(nameLines[0], nameWidth)}${padLeft(lineTotal, totalWidth)}`.slice(0, width))
      for (let index = 1; index < nameLines.length; index += 1) {
        lines.push(`${indent}${padRight(nameLines[index], nameWidth)}`.slice(0, width))
      }
      if (settings.items.showItemNotes && item.notes) {
        for (const noteLine of wrapText(item.notes, width - indent.length)) {
          lines.push(`${indent}${noteLine}`.slice(0, width))
        }
      }
    }
    pushBlank(lines, compact)
  }

  if (blocks.showTotals) {
    divider()
    const totalWidth = 8
    if (settings.totals.showSubtotal) {
      lines.push(`${padRight("Subtotal:", width - totalWidth)}${padLeft(money(subtotal), totalWidth)}`.slice(0, width))
    }
    if (settings.totals.showDiscounts && discounts > 0) {
      lines.push(`${padRight("Descuento:", width - totalWidth)}${padLeft(money(discounts), totalWidth)}`.slice(0, width))
    }
    if (settings.totals.showTax && tax > 0) {
      lines.push(`${padRight("Impuesto:", width - totalWidth)}${padLeft(money(tax), totalWidth)}`.slice(0, width))
    }
    if (tipAmount > 0) {
      lines.push(`${padRight("Propina:", width - totalWidth)}${padLeft(money(tipAmount), totalWidth)}`.slice(0, width))
    }
    if (settings.totals.showTotal) {
      lines.push(`${padRight("TOTAL:", width - totalWidth)}${padLeft(money(paid), totalWidth)}`.slice(0, width))
    }
    pushBlank(lines, compact)
  }

  if (blocks.showMessages) {
    if (settings.messages.headerMessage) {
      pushWrapped(lines, settings.messages.headerMessage, width, compact)
    }
    if ((channel === "delivery" || ticketType === "delivery") && settings.messages.deliveryMessage) {
      pushWrapped(lines, settings.messages.deliveryMessage, width, compact)
    }
    if (settings.messages.reviewMessage) {
      pushWrapped(lines, settings.messages.reviewMessage, width, compact)
    }
    if (settings.messages.vipMessage) {
      pushWrapped(lines, settings.messages.vipMessage, width, compact)
    }
  }

  if (blocks.showFinalText) {
    divider()
    if (settings.messages.footerMessage) {
      pushWrapped(lines, settings.messages.footerMessage, width, compact)
    }
    if (settings.print?.cutPaperHint) {
      pushLine(lines, centerText("Corte aqui", width), width)
    }
  }

  while (lines.length && lines[lines.length - 1] === "") {
    lines.pop()
  }

  return {
    lines,
    paperWidth,
    templateKey: template.template_key || ticketType,
    ticketType
  }
}
