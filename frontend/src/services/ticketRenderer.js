import { DEFAULT_TICKET_SETTINGS, defaultTicketTemplate, normalizeTicketTemplate } from "./ticketTemplatesService"

const SAMPLE_ORDER = {
  id: "prebill-1780787058136-63518",
  tableName: "Delivery - Juan Carlos Garcia",
  waiterName: "Juan Carlos",
  cashierName: "Juan Carlos",
  salesChannel: "delivery",
  peopleCount: "1",
  paymentMethod: "cash",
  delivery: {
    customerName: "Juan Carlos Garcia",
    phone: "5555-5555",
    address: "Zona 10, Ciudad de Guatemala",
    reference: "Casa azul, frente al porton negro",
    mapsLink: "https://maps.google.com/?q=El+Gran+Alcazar",
    paymentMethod: "cash",
    deliveryNotes: "Tocar timbre al llegar."
  },
  items: [
    { nombre: "Prueba de Platillo KDS", cantidad: 1, precio: 100, notes: "Sin cebolla" }
  ],
  subtotal: 100,
  total: 100
}

function money(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
}

function itemName(item) {
  return item.nombre || item.productName || item.product_name || "Producto"
}

function itemQuantity(item) {
  return Number(item.cantidad ?? item.quantity ?? 0)
}

function itemPrice(item) {
  return Number(item.precio ?? item.unitPrice ?? item.unit_price ?? 0)
}

function orderItems(order) {
  return (order?.items || []).filter((item) => item.status !== "cancelled")
}

function paperWidth(template) {
  if (template.paper_width === "58mm") return "58mm"
  if (template.paper_width === "letter") return "190mm"
  return "80mm"
}

function fontSize(settings) {
  return ({ small: "10.5px", medium: "12px", large: "14px" })[settings.layout.fontSize] || "12px"
}

function divider(settings) {
  if (!settings.layout.showDividers) return ""
  return `<hr class="ticket-divider ${esc(settings.layout.dividerStyle)}" />`
}

function line(label, value, enabled = true) {
  if (!enabled || value === undefined || value === null || value === "") return ""
  return `<p class="ticket-line"><span>${esc(label)}</span><strong>${esc(value)}</strong></p>`
}

function textLine(text, className = "") {
  if (!String(text || "").trim()) return ""
  return `<p class="${className}">${esc(text)}</p>`
}

function qrImage(url) {
  if (!url) return ""
  return `https://api.qrserver.com/v1/create-qr-code/?size=128x128&data=${encodeURIComponent(url)}`
}

export function sampleTicketOrder() {
  return SAMPLE_ORDER
}

export function renderTicketHtml(orderInput = SAMPLE_ORDER, templateInput = defaultTicketTemplate("prebill"), ticketType = "prebill", payment = {}) {
  const template = normalizeTicketTemplate(templateInput)
  const settings = { ...DEFAULT_TICKET_SETTINGS, ...template.settings }
  const order = orderInput || SAMPLE_ORDER
  const items = orderItems(order)
  const subtotal = Number(order.subtotal ?? items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))
  const discounts = Number(payment.discountAmount || order.discounts || 0)
  const tax = Number(order.taxes || order.tax || 0)
  const paid = Number(payment.totalAmount ?? order.total ?? subtotal - discounts + tax)
  const channel = order.salesChannel || order.sales_channel || (ticketType === "delivery" ? "delivery" : "dine_in")
  const delivery = order.delivery || {}
  const paymentMethod = delivery.paymentMethod || order.paymentMethod || payment.method || (payment.methods || []).map((method) => method.method).join(", ")
  const business = settings.business
  const blocks = settings.blocks || {}
  const compact = settings.layout.compactMode
  const title = ticketType === "final_bill" ? "CUENTA FINAL" : ticketType === "delivery" ? "DELIVERY" : ticketType === "takeout" ? "PARA LLEVAR" : "PRECUENTA"
  const qrSrc = blocks.showQr && settings.qr.enabled && settings.qr.showQr ? qrImage(settings.qr.url) : ""
  const width = paperWidth(template)
  const logoClass = ({ small: "logo-small", medium: "logo-medium", large: "logo-large" })[business.logoSize] || "logo-medium"
  const fontFamily = settings.layout.fontFamily === "sans-serif" ? "Arial, Helvetica, sans-serif" : "ui-monospace, SFMono-Regular, Consolas, monospace"
  const headerAlign = settings.layout.alignment === "left" ? "left" : "center"
  const itemRows = items.map((item) => {
    const qty = itemQuantity(item)
    const price = itemPrice(item)
    const total = qty * price
    return `<div class="ticket-item">
      <div><strong>${esc(itemName(item))}</strong>${settings.items.showItemNotes && item.notes ? `<small>${esc(item.notes)}</small>` : ""}</div>
      <div class="ticket-item-meta">
        ${settings.items.showQuantity ? `<span>${qty}x</span>` : ""}
        ${settings.items.showUnitPrice ? `<span>${money(price)}</span>` : ""}
        ${settings.items.showLineTotal ? `<strong>${money(total)}</strong>` : ""}
      </div>
    </div>`
  }).join("")

  const headerBlock = blocks.showHeader
    ? `<section class="ticket-block ticket-header">
        <h2>${esc(title)}</h2>
      </section>`
    : ""

  const businessBlock = blocks.showBusiness
    ? `<header class="ticket-block ticket-business">
        ${business.showLogo && business.logoUrl ? `<img class="ticket-logo ${logoClass}" src="${esc(business.logoUrl)}" alt="" />` : ""}
        ${business.showBusinessName ? `<h1>${esc(business.businessName)}</h1>` : ""}
        ${business.showSubtitle ? textLine(business.subtitle, "ticket-muted") : ""}
        ${business.showNit ? line("NIT", business.nit, Boolean(business.nit)) : ""}
        ${business.showAddress ? textLine(business.address, "ticket-muted") : ""}
        ${business.showPhone ? textLine(business.phone, "ticket-muted") : ""}
        ${business.showWebsite ? textLine(business.website, "ticket-muted") : ""}
        ${business.showInstagram ? textLine(business.instagram, "ticket-muted") : ""}
      </header>`
    : ""

  const orderBlock = blocks.showOrderInfo
    ? `<section class="ticket-block">
        ${line("Orden", order.id || payment.orderId, settings.orderInfo.showOrderId)}
        ${line("Fecha", new Date().toLocaleString(), settings.orderInfo.showDate)}
        ${line("Cajero", order.cashierName || payment.cashierName, settings.orderInfo.showCashier)}
        ${line("Mesero", order.waiterName || order.usuarioNombre, settings.orderInfo.showWaiter)}
        ${line("Mesa", order.tableName || order.mesa, settings.orderInfo.showTable)}
        ${line("Canal", channel, settings.orderInfo.showSalesChannel)}
        ${line("Pago", paymentMethod, settings.orderInfo.showPaymentMethod)}
      </section>`
    : ""

  const customerBlock = blocks.showCustomer && (channel === "delivery" || ticketType === "delivery")
    ? `<section class="ticket-block">
      <h3>Cliente / delivery</h3>
      ${[
        line("Cliente", delivery.customerName, settings.orderInfo.showCustomerName),
        line("Telefono", delivery.phone || delivery.whatsapp, settings.orderInfo.showCustomerPhone),
        line("Direccion", delivery.address, settings.orderInfo.showDeliveryAddress),
        line("Referencia", delivery.reference, settings.orderInfo.showDeliveryReference),
        line("Maps", delivery.mapsLink, settings.orderInfo.showMapsLink),
        textLine(settings.orderInfo.showDeliveryNotes ? delivery.deliveryNotes : "", "ticket-note")
      ].join("")}
    </section>`
    : ""

  const productsBlock = blocks.showProducts
    ? `<section class="ticket-block">
        <h3>Productos</h3>
        ${itemRows}
      </section>`
    : ""

  const totalsBlock = blocks.showTotals
    ? `<section class="ticket-block">
        ${line("Subtotal", money(subtotal), settings.totals.showSubtotal)}
        ${line("Descuentos", money(discounts), settings.totals.showDiscounts)}
        ${line("Impuesto", money(tax), settings.totals.showTax)}
        ${settings.totals.showServiceCharge ? line("Servicio", money(order.serviceCharge || 0), true) : ""}
        ${settings.totals.showTipSuggestion ? textLine(`Propina sugerida: ${settings.totals.tipSuggestions.map((tip) => `${tip}% ${money(paid * Number(tip) / 100)}`).join(" | ")}`, "ticket-muted") : ""}
        ${settings.totals.showTotal ? `<p class="ticket-total final"><span>Total</span><strong>${money(paid)}</strong></p>` : ""}
      </section>`
    : ""

  const messagesBlock = blocks.showMessages
    ? `<section class="ticket-block">
        ${textLine(settings.messages.headerMessage, "ticket-note")}
        ${channel === "delivery" || ticketType === "delivery" ? textLine(settings.messages.deliveryMessage, "ticket-note") : ""}
        ${textLine(settings.messages.reviewMessage, "ticket-muted")}
        ${textLine(settings.messages.vipMessage, "ticket-muted")}
      </section>`
    : ""

  const couponBlock = blocks.showCoupon && settings.coupon.enabled
    ? `<div class="ticket-coupon">
        ${textLine(settings.coupon.title, "ticket-coupon-title")}
        ${line("Codigo", settings.coupon.code, Boolean(settings.coupon.code))}
        ${textLine(settings.coupon.description)}
        ${textLine(settings.coupon.expiresText, "ticket-muted")}
      </div>`
    : ""

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <style>
    @page { size: ${width} auto; margin: ${template.paper_width === "letter" ? "12mm" : "3mm"}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #fff; color: #111; font-family: ${fontFamily}; }
    .ticket { width: ${width}; max-width: ${width}; margin: 0 auto; padding: ${compact ? "4px" : "6px"}; font-size: ${fontSize(settings)}; line-height: ${compact ? "1.2" : "1.32"}; }
    .ticket-business, .ticket-header { text-align: ${headerAlign}; }
    .ticket-block { page-break-inside: avoid; padding: ${compact ? "3px 0" : "6px 0"}; }
    .ticket-block + .ticket-block { border-top: ${settings.layout.showDividers ? `1px ${settings.layout.dividerStyle} #111` : "0"}; }
    .ticket-logo { display: block; object-fit: contain; margin: 0 auto 4px; }
    .logo-small { max-width: 34mm; max-height: 14mm; }
    .logo-medium { max-width: 46mm; max-height: 20mm; }
    .logo-large { max-width: 62mm; max-height: 28mm; }
    h1, h2, p { margin: 0 0 ${compact ? "2px" : "4px"}; }
    h1 { font-size: 1.35em; }
    h2 { font-size: 1.05em; text-align: center; letter-spacing: .04em; }
    h3 { font-size: .88em; text-transform: uppercase; margin: 0 0 ${compact ? "3px" : "6px"}; color: #333; }
    .ticket-muted, small { color: #555; }
    .ticket-divider { border: 0; border-top: 1px dashed #111; margin: ${compact ? "5px" : "8px"} 0; }
    .ticket-divider.solid { border-top-style: solid; }
    .ticket-divider.dotted { border-top-style: dotted; }
    .ticket-line, .ticket-total, .ticket-item, .ticket-item-meta { display: flex; justify-content: space-between; gap: 6px; align-items: baseline; }
    .ticket-line span, .ticket-total span { color: #333; }
    .ticket-item { padding: ${compact ? "2px 0" : "4px 0"}; page-break-inside: avoid; }
    .ticket-item > div:first-child { min-width: 0; }
    .ticket-item-meta { flex: 0 0 auto; min-width: 28mm; text-align: right; }
    .ticket-note { white-space: pre-wrap; }
    .ticket-total.final { font-size: 1.18em; border-top: 1px solid #111; padding-top: 5px; margin-top: 4px; }
    .ticket-coupon { border: 1px dashed #111; padding: 6px; margin: 7px 0; text-align: center; page-break-inside: avoid; }
    .ticket-coupon-title { font-weight: 800; text-transform: uppercase; }
    .ticket-qr { display: grid; justify-items: center; gap: 3px; margin-top: 7px; page-break-inside: avoid; }
    .ticket-qr img { width: 25mm; height: 25mm; }
    @media print {
      body { margin: 0; }
      .ticket { margin: 0; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <section class="ticket">
    ${businessBlock}
    ${headerBlock}
    ${orderBlock}
    ${customerBlock}
    ${productsBlock}
    ${totalsBlock}
    ${messagesBlock}
    ${couponBlock}
    ${qrSrc ? `<section class="ticket-block ticket-qr"><img src="${qrSrc}" alt="QR" /><small>${esc(settings.qr.label)}</small></section>` : ""}
    ${blocks.showFinalText ? `<section class="ticket-block">${textLine(settings.messages.footerMessage, "ticket-muted")}${settings.print.cutPaperHint ? textLine("Corte aqui", "ticket-muted") : ""}</section>` : ""}
  </section>
</body>
</html>`
}
