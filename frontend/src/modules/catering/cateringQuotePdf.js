import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { BRANDING } from "../../branding"
import { formatDate, formatMoney, formatTime } from "./cateringUtils"
import { itemTypeLabel, QUOTE_STATUS_LABELS } from "./cateringQuoteTemplates"

const ACCENT = [20, 184, 166]
const INK = [15, 23, 42]
const MUTED = [100, 116, 139]

function addHeader(doc, quoteNumber) {
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, 210, 28, "F")

  doc.setTextColor(255, 255, 255)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(18)
  doc.text(BRANDING.appName, 14, 14)

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text("Cotizacion de Catering", 14, 21)

  doc.setFont("helvetica", "bold")
  doc.setFontSize(12)
  doc.text(quoteNumber || "COTIZACION", 196, 14, { align: "right" })

  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text(`Generada: ${new Date().toLocaleString("es-GT")}`, 196, 21, { align: "right" })
}

function addSectionTitle(doc, title, y) {
  doc.setTextColor(...INK)
  doc.setFont("helvetica", "bold")
  doc.setFontSize(11)
  doc.text(title, 14, y)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.line(14, y + 2, 196, y + 2)
  return y + 10
}

function addInfoBlock(doc, rows, startY, x = 14, width = 88) {
  let y = startY
  doc.setFontSize(9)
  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "bold")
    doc.setTextColor(...MUTED)
    doc.text(label, x, y)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(String(value || "—"), width)
    doc.text(lines, x, y + 4)
    y += 4 + lines.length * 4.5 + 2
  })
  return y
}

export function downloadCateringQuotePdf({ quote, items = [], request = {}, branding = BRANDING }) {
  const doc = new jsPDF()
  const quoteRow = quote || {}
  const requestRow = request || {}
  const quoteNumber = quoteRow.quote_number || "cotizacion"
  const commercialName = branding?.commercialName || branding?.appName || BRANDING.appName

  addHeader(doc, quoteNumber)

  let y = 38
  y = addSectionTitle(doc, "Cliente", y)
  const clientBottom = addInfoBlock(doc, [
    ["Nombre", requestRow.customer_name],
    ["Telefono", requestRow.customer_phone],
    ["Correo", requestRow.customer_email]
  ], y, 14, 88)

  y = addSectionTitle(doc, "Evento", 38)
  const eventBottom = addInfoBlock(doc, [
    ["Tipo", requestRow.event_type],
    ["Fecha", formatDate(requestRow.event_date)],
    ["Hora", formatTime(requestRow.event_time)],
    ["Ubicacion", requestRow.event_location],
    ["Invitados", requestRow.guest_count ?? "—"]
  ], y, 110, 88)

  y = Math.max(clientBottom, eventBottom) + 4
  y = addSectionTitle(doc, "Detalle de cotizacion", y)

  autoTable(doc, {
    startY: y,
    head: [["Tipo", "Descripcion", "Cant.", "Precio unit.", "Total"]],
    body: (items || []).map((item) => [
      itemTypeLabel(item.item_type),
      item.description,
      Number(item.quantity).toLocaleString("es-GT"),
      formatMoney(item.unit_price),
      formatMoney(item.total_price ?? Number(item.quantity) * Number(item.unit_price))
    ]),
    styles: {
      fontSize: 9,
      cellPadding: 3,
      textColor: INK
    },
    headStyles: {
      fillColor: ACCENT,
      textColor: [255, 255, 255],
      fontStyle: "bold"
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    margin: { left: 14, right: 14 }
  })

  const tableEnd = doc.lastAutoTable.finalY + 10
  const totalsX = 130
  let totalsY = tableEnd

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.setTextColor(...INK)

  const totals = [
    ["Subtotal", formatMoney(quoteRow.subtotal)],
    ["Descuento", formatMoney(quoteRow.discount_amount)],
    ["Impuestos (IVA)", formatMoney(quoteRow.tax_amount)],
    ["Total", formatMoney(quoteRow.total)]
  ]

  totals.forEach(([label, value], index) => {
    const isTotal = index === totals.length - 1
    doc.setFont("helvetica", isTotal ? "bold" : "normal")
    doc.text(label, totalsX, totalsY)
    doc.text(value, 196, totalsY, { align: "right" })
    totalsY += isTotal ? 8 : 6
  })

  totalsY += 4
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("Vigencia", 14, totalsY)
  doc.setFont("helvetica", "normal")
  doc.text(formatDate(quoteRow.valid_until), 14, totalsY + 6)

  doc.setFont("helvetica", "bold")
  doc.text("Estado", 80, totalsY)
  doc.setFont("helvetica", "normal")
  doc.text(QUOTE_STATUS_LABELS[quoteRow.status] || quoteRow.status || "—", 80, totalsY + 6)

  totalsY += 16
  doc.setFont("helvetica", "bold")
  doc.text("Notas", 14, totalsY)
  doc.setFont("helvetica", "normal")
  const notes = quoteRow.notes || "Gracias por confiar en nosotros. Esta cotizacion incluye los servicios detallados arriba."
  doc.text(doc.splitTextToSize(notes, 182), 14, totalsY + 6)

  const signatureY = Math.max(totalsY + 24, 250)
  doc.setDrawColor(...MUTED)
  doc.line(14, signatureY, 90, signatureY)
  doc.line(116, signatureY, 196, signatureY)
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text("Firma cliente", 14, signatureY + 5)
  doc.text(`Autorizado — ${commercialName}`, 116, signatureY + 5)

  doc.save(`${quoteNumber}.pdf`)
}
