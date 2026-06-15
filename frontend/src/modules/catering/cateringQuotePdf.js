import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { buildCompanyFooterLines } from "./cateringQuoteSettings"
import { PDF_FONT_FAMILY, registerPdfFonts, setPdfFont } from "./cateringQuotePdfFonts"
import {
  repairCateringCompanySettings,
  repairCateringQuote,
  repairCateringQuoteItems,
  repairCateringRequest,
  repairSpanishText
} from "./cateringTextEncoding"
import { formatDate, formatMoney, formatTime } from "./cateringUtils"
import { formatQuantityLine, itemTypeLabel, QUOTE_STATUS_LABELS } from "./cateringQuoteTemplates"

const ACCENT = [20, 184, 166]
const INK = [15, 23, 42]
const MUTED = [100, 116, 139]

async function loadImageDataUrl(url) {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

function detectImageFormat(dataUrl) {
  if (String(dataUrl).includes("image/jpeg") || String(dataUrl).includes("image/jpg")) return "JPEG"
  if (String(dataUrl).includes("image/webp")) return "WEBP"
  if (String(dataUrl).includes("image/svg")) return "SVG"
  return "PNG"
}

async function addLogo(doc, logoUrl, x, y, width = 28, height = 18) {
  const dataUrl = await loadImageDataUrl(logoUrl)
  if (!dataUrl) return false
  try {
    doc.addImage(dataUrl, detectImageFormat(dataUrl), x, y, width, height)
    return true
  } catch {
    return false
  }
}

function addHeader(doc, quoteNumber, company, hasLogo) {
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, 210, 36, "F")

  const textX = hasLogo ? 46 : 14

  doc.setTextColor(255, 255, 255)
  setPdfFont(doc, "bold")
  doc.setFontSize(16)
  doc.text(company?.commercialName || "Empresa", textX, 14)

  setPdfFont(doc, "normal")
  doc.setFontSize(10)
  doc.text(company?.headerText || "Cotización de Catering", textX, 21)

  if (company?.nit) {
    doc.setFontSize(8)
    doc.text(`NIT: ${company.nit}`, textX, 28)
  }

  setPdfFont(doc, "bold")
  doc.setFontSize(12)
  doc.text(quoteNumber || "COTIZACIÓN", 196, 14, { align: "right" })

  setPdfFont(doc, "normal")
  doc.setFontSize(9)
  doc.text(`Generada: ${new Date().toLocaleString("es-GT")}`, 196, 21, { align: "right" })
}

function addSectionTitle(doc, title, y) {
  doc.setTextColor(...INK)
  setPdfFont(doc, "bold")
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
    setPdfFont(doc, "bold")
    doc.setTextColor(...MUTED)
    doc.text(label, x, y)
    setPdfFont(doc, "normal")
    doc.setTextColor(...INK)
    const lines = doc.splitTextToSize(String(value || "—"), width)
    doc.text(lines, x, y + 4)
    y += 4 + lines.length * 4.5 + 2
  })
  return y
}

function addCompanyFooter(doc, company, startY) {
  const lines = buildCompanyFooterLines(company)
  if (!lines.length) return startY

  let y = startY + 8
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.8)
  doc.line(14, y, 196, y)
  y += 8

  setPdfFont(doc, "bold")
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text(lines[0], 105, y, { align: "center" })
  y += 6

  setPdfFont(doc, "normal")
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  lines.slice(1).forEach((line) => {
    doc.text(line, 105, y, { align: "center" })
    y += 4.5
  })

  return y
}

export async function downloadCateringQuotePdf({ quote, items = [], request = {}, company = {} }) {
  const doc = new jsPDF()
  await registerPdfFonts(doc)

  const quoteRow = repairCateringQuote(quote || {})
  const requestRow = repairCateringRequest(request || {})
  const companyRow = repairCateringCompanySettings(company || {})
  const safeItems = repairCateringQuoteItems(items || [])
  const quoteNumber = repairSpanishText(quoteRow.quote_number || "cotizacion")

  const hasLogo = await addLogo(doc, companyRow.logoUrl, 14, 9, 28, 18)
  addHeader(doc, quoteNumber, companyRow, hasLogo)

  let y = 44
  y = addSectionTitle(doc, "Cliente", y)
  const clientBottom = addInfoBlock(doc, [
    ["Nombre", requestRow.customer_name],
    ["Teléfono", requestRow.customer_phone],
    ["Correo", requestRow.customer_email]
  ], y, 14, 88)

  y = addSectionTitle(doc, "Evento", 44)
  const eventBottom = addInfoBlock(doc, [
    ["Tipo", requestRow.event_type],
    ["Fecha", formatDate(requestRow.event_date)],
    ["Hora", formatTime(requestRow.event_time)],
    ["Ubicación", requestRow.event_location],
    ["Invitados", requestRow.guest_count ?? "—"]
  ], y, 110, 88)

  y = Math.max(clientBottom, eventBottom) + 4
  y = addSectionTitle(doc, "Detalle de cotización", y)

  autoTable(doc, {
    startY: y,
    head: [["Tipo", "Descripción", "Cantidad", "Total"]],
    body: safeItems.map((item) => [
      itemTypeLabel(item.item_type),
      item.description,
      formatQuantityLine(item),
      formatMoney(item.total_price ?? Number(item.quantity) * Number(item.unit_price))
    ]),
    styles: { font: PDF_FONT_FAMILY, fontSize: 9, cellPadding: 3, textColor: INK },
    headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: ACCENT, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 }
  })

  const tableEnd = doc.lastAutoTable.finalY + 10
  const totalsX = 130
  let totalsY = tableEnd

  setPdfFont(doc, "normal")
  doc.setFontSize(10)
  doc.setTextColor(...INK)

  const totals = [
    ["Subtotal", formatMoney(quoteRow.subtotal)],
    ...(Number(quoteRow.discount_amount) > 0 ? [["Descuento", `-${formatMoney(quoteRow.discount_amount)}`]] : []),
    ["Total", formatMoney(quoteRow.total)]
  ]

  totals.forEach(([label, value], index) => {
    const isTotal = index === totals.length - 1
    setPdfFont(doc, isTotal ? "bold" : "normal")
    doc.text(label, totalsX, totalsY)
    doc.text(value, 196, totalsY, { align: "right" })
    totalsY += isTotal ? 8 : 6
  })

  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text("Precios incluyen IVA", totalsX, totalsY + 2)

  totalsY += 12
  setPdfFont(doc, "bold")
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text("Vigencia", 14, totalsY)
  setPdfFont(doc, "normal")
  doc.text(formatDate(quoteRow.valid_until), 14, totalsY + 6)

  setPdfFont(doc, "bold")
  doc.text("Estado", 80, totalsY)
  setPdfFont(doc, "normal")
  doc.text(QUOTE_STATUS_LABELS[quoteRow.status] || quoteRow.status || "—", 80, totalsY + 6)

  totalsY += 16
  if (quoteRow.notes) {
    setPdfFont(doc, "bold")
    doc.text("Notas comerciales", 14, totalsY)
    setPdfFont(doc, "normal")
    doc.text(doc.splitTextToSize(quoteRow.notes, 182), 14, totalsY + 6)
    totalsY += 18
  }

  setPdfFont(doc, "bold")
  doc.text("Términos y condiciones", 14, totalsY)
  setPdfFont(doc, "normal")
  doc.setFontSize(8)
  const terms = quoteRow.terms || "Precios incluyen IVA."
  const termsLines = doc.splitTextToSize(terms, 182)
  doc.text(termsLines, 14, totalsY + 6)
  totalsY += 6 + termsLines.length * 4

  const signatureY = totalsY + 10
  doc.setDrawColor(...MUTED)
  doc.line(14, signatureY, 90, signatureY)
  doc.line(116, signatureY, 196, signatureY)
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text("Firma cliente", 14, signatureY + 5)
  doc.text(`Autorizado — ${companyRow?.commercialName || "Empresa"}`, 116, signatureY + 5)

  addCompanyFooter(doc, companyRow, signatureY + 14)

  doc.save(`${quoteNumber}.pdf`)
}
