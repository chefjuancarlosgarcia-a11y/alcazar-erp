const DEFAULT_RESTAURANT_NAME = "Alcazar Restaurante"

function money(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function orderItems(order) {
  return (order?.items || []).filter((item) => item.status !== "cancelled")
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

function buildReceiptHtml({ title, width, lines, footer }) {
  const body = lines.map((line) => {
    if (line.type === "hr") return "<hr />"
    if (line.type === "total") return `<div class="row total"><span>${line.label}</span><strong>${line.value}</strong></div>`
    if (line.type === "item") return `<div class="item"><span>${line.name}</span><small>${line.qty} x ${line.price}</small><strong>${line.total}</strong></div>`
    return `<p class="${line.className || ""}">${line.text}</p>`
  }).join("")
  return `<!doctype html><html><head><title>${title}</title><style>
    @page { size: ${width}; margin: 6mm; }
    body { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; color: #111; }
    .ticket { width: 100%; font-size: 12px; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 8px; }
    p { margin: 3px 0; }
    .center { text-align: center; }
    .muted { color: #555; }
    .row, .item { display: grid; grid-template-columns: 1fr auto; gap: 6px; margin: 4px 0; }
    .item small { grid-column: 1 / -1; color: #555; }
    .total { font-size: 15px; border-top: 1px dashed #333; padding-top: 7px; }
    hr { border: 0; border-top: 1px dashed #333; margin: 8px 0; }
  </style></head><body><section class="ticket"><h1>${title}</h1>${body}<hr /><p class="center muted">${footer}</p></section></body></html>`
}

function printHtml(html) {
  const popup = window.open("", "_blank", "width=420,height=680")
  if (!popup) {
    window.alert("No se pudo abrir la ventana de impresión. Revisa el bloqueador de ventanas.")
    return false
  }
  try {
    popup.document.write(html)
    popup.document.close()
    popup.addEventListener("afterprint", () => {
      try {
        popup.close()
        window.focus()
      } catch (error) {
        console.warn("[POS Print] No se pudo cerrar la ventana de impresión.", error)
      }
    }, { once: true })
    popup.focus()
    window.setTimeout(() => {
      try {
        popup.print()
      } catch (error) {
        console.error("[POS Print] Error al abrir impresión.", error)
        popup.close()
        window.focus()
      }
    }, 150)
  } catch (error) {
    console.error("[POS Print] Error preparando impresión.", error)
    popup.close()
    window.focus()
    return false
  }
  return true
}

export function printPreCheck(order, options = {}) {
  const width = options.paperWidth || "80mm"
  const items = orderItems(order)
  const subtotal = Number(order?.subtotal ?? order?.total ?? items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))
  const taxes = Number(order?.taxes || 0)
  const total = Number(order?.total ?? subtotal + taxes)
  return printHtml(buildReceiptHtml({
    title: options.restaurantName || DEFAULT_RESTAURANT_NAME,
    width,
    footer: "Documento informativo - No válido como factura.",
    lines: [
      { text: "PRECUENTA", className: "center" },
      { text: `Mesa: ${order?.tableName || order?.mesa || "-"}` },
      { text: `Mesero: ${order?.waiterName || order?.usuarioNombre || "-"}` },
      { text: `Fecha: ${new Date().toLocaleString()}` },
      { text: `Personas: ${order?.peopleCount || order?.personas || "-"}` },
      { type: "hr" },
      ...items.map((item) => ({ type: "item", name: itemName(item), qty: itemQuantity(item), price: money(itemPrice(item)), total: money(itemQuantity(item) * itemPrice(item)) })),
      { type: "hr" },
      { type: "total", label: "Subtotal", value: money(subtotal) },
      { type: "total", label: "Impuestos", value: money(taxes) },
      { type: "total", label: "Total", value: money(total) }
    ]
  }))
}

export function printFinalCheck(order, payment = {}, options = {}) {
  const width = options.paperWidth || "80mm"
  const items = orderItems(order)
  const subtotal = Number(order?.subtotal ?? items.reduce((sum, item) => sum + itemQuantity(item) * itemPrice(item), 0))
  const discounts = Number(payment.discountAmount || order?.discounts || 0)
  const paid = Number(payment.totalAmount ?? order?.total ?? subtotal - discounts)
  const methods = (payment.methods || []).map((method) => method.method).join(", ") || payment.method || "-"
  return printHtml(buildReceiptHtml({
    title: options.restaurantName || DEFAULT_RESTAURANT_NAME,
    width,
    footer: "Gracias por su visita.",
    lines: [
      { text: "CUENTA FINAL", className: "center" },
      { text: `Orden: ${order?.id || payment.orderId || "-"}` },
      { text: `Mesa: ${order?.tableName || order?.mesa || "-"}` },
      { text: `Fecha: ${new Date().toLocaleString()}` },
      { text: `Mesero: ${order?.waiterName || order?.usuarioNombre || "-"}` },
      { text: `Pago: ${methods}` },
      { type: "hr" },
      ...items.map((item) => ({ type: "item", name: itemName(item), qty: itemQuantity(item), price: money(itemPrice(item)), total: money(itemQuantity(item) * itemPrice(item)) })),
      { type: "hr" },
      { type: "total", label: "Subtotal", value: money(subtotal) },
      { type: "total", label: "Descuentos", value: money(discounts) },
      { type: "total", label: "Total pagado", value: money(paid) }
    ]
  }))
}
