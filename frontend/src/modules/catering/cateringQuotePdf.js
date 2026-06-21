import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { buildCompanyFooterLines } from "./cateringQuoteSettings"
import { detectImageFormat, loadQuoteLogoDataUrl, resolveQuoteLogoUrl } from "./cateringQuoteLogo"
import { PDF_FONT_FAMILY, registerPdfFonts, setPdfFont } from "./cateringQuotePdfFonts"
import {
  repairCateringCompanySettings,
  repairCateringQuote,
  repairCateringQuoteItems,
  repairCateringRequest,
  repairSpanishText
} from "./cateringTextEncoding"
import { formatDate, formatMoney, formatTime } from "./cateringUtils"
import {
  calculateQuoteTotals,
  formatOptionDisplayTitle,
  formatQuantityLine,
  groupQuoteItemsForDisplay,
  itemTypeLabel,
  QUOTE_STATUS_LABELS
} from "./cateringQuoteTemplates"

const ACCENT = [20, 184, 166]
const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const PAGE_BOTTOM = 280
const MARGIN_LEFT = 14
const MARGIN_RIGHT = 14
const CONTENT_WIDTH = 182

async function addLogo(doc, logoUrl, x, y, width = 30, height = 22) {
  const dataUrl = await loadQuoteLogoDataUrl(logoUrl)
  if (!dataUrl) return false

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x - 2, y - 2, width + 4, height + 4, 2, 2, "F")

  try {
    doc.addImage(dataUrl, detectImageFormat(dataUrl, logoUrl), x, y, width, height)
    return true
  } catch {
    return false
  }
}

function paintHeaderBand(doc) {
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, 210, 36, "F")
}

function paintHeaderText(doc, quoteNumber, company, hasLogo) {
  const textX = hasLogo ? 50 : 14

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

async function paintQuoteLogo(doc, logoUrl) {
  if (!logoUrl) return false
  return addLogo(doc, logoUrl, 14, 9, 30, 22)
}

function addSectionTitle(doc, title, y) {
  doc.setTextColor(...INK)
  setPdfFont(doc, "bold")
  doc.setFontSize(11)
  doc.text(title, MARGIN_LEFT, y)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.line(MARGIN_LEFT, y + 2, 196, y + 2)
  return y + 10
}

function addInfoBlock(doc, rows, startY, x = MARGIN_LEFT, width = 88) {
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

function ensurePageSpace(doc, y, neededHeight = 20) {
  if (y + neededHeight <= PAGE_BOTTOM) return y
  doc.addPage()
  return 44
}

function measureWrappedText(doc, text, maxWidth, lineHeight = 4.2) {
  const lines = doc.splitTextToSize(String(text || ""), maxWidth)
  return { lines, height: Math.max(lines.length, 1) * lineHeight }
}

function addWrappedBlock(doc, {
  title,
  text,
  y,
  titleSize = 10,
  bodySize = 9,
  lineHeight = 4.2,
  titleGap = 6,
  blockGap = 10
}) {
  const safeText = String(text || "").trim()
  if (!safeText) return y

  setPdfFont(doc, "bold")
  doc.setFontSize(titleSize)
  doc.setTextColor(...INK)
  const titleHeight = titleSize * 0.45 + 2
  y = ensurePageSpace(doc, y, titleHeight + titleGap + lineHeight * 2)

  doc.text(title, MARGIN_LEFT, y)
  y += titleGap

  setPdfFont(doc, "normal")
  doc.setFontSize(bodySize)
  doc.setTextColor(...INK)
  const { lines, height } = measureWrappedText(doc, safeText, CONTENT_WIDTH, lineHeight)
  y = ensurePageSpace(doc, y, height + 2)
  doc.text(lines, MARGIN_LEFT, y)
  return y + height + blockGap
}

function buildQuoteTableBody(sections) {
  const body = []

  sections.forEach((section) => {
    if (section.type === "normal") {
      const item = section.item
      body.push([
        itemTypeLabel(item.item_type),
        item.description,
        formatQuantityLine(item),
        formatMoney(item.total_price ?? Number(item.quantity) * Number(item.unit_price))
      ])
      return
    }

    body.push([
      { content: section.groupName.toUpperCase(), colSpan: 4, styles: { fontStyle: "bold", fillColor: [236, 253, 245], textColor: INK } }
    ])

    section.options.forEach((item) => {
      const selectedMark = item.is_selected_option ? " ✓" : ""
      body.push([
        itemTypeLabel(item.item_type),
        `${formatOptionDisplayTitle(item)}${selectedMark}`,
        formatQuantityLine(item),
        formatMoney(item.total_price ?? Number(item.quantity) * Number(item.unit_price))
      ])
    })
  })

  return body
}

function addCompanyFooter(doc, company, startY) {
  const lines = buildCompanyFooterLines(company)
  if (!lines.length) return startY

  let y = ensurePageSpace(doc, startY + 8, 24)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.8)
  doc.line(MARGIN_LEFT, y, 196, y)
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
    y = ensurePageSpace(doc, y, 6)
    doc.text(line, 105, y, { align: "center" })
    y += 4.5
  })

  return y
}

export async function downloadCateringQuotePdf({
  quote,
  items = [],
  request = {},
  company = {},
  branding = {}
}) {
  const doc = new jsPDF()
  await registerPdfFonts(doc)

  const quoteRow = repairCateringQuote(quote || {})
  const requestRow = repairCateringRequest(request || {})
  const companyRow = repairCateringCompanySettings(company || {})
  const logoUrl = resolveQuoteLogoUrl(companyRow, { ...branding, ...companyRow })
  const safeItems = repairCateringQuoteItems(items || [])
  const quoteNumber = repairSpanishText(quoteRow.quote_number || "cotizacion")
  const sections = groupQuoteItemsForDisplay(safeItems)
  const computedTotals = calculateQuoteTotals(
    safeItems,
    quoteRow.discount_amount ?? quoteRow.discountAmount ?? 0
  )
  const totalsRow = {
    subtotal: computedTotals.subtotal,
    discount_amount: computedTotals.discount_amount,
    total: computedTotals.total,
    has_unresolved_option_groups: computedTotals.has_unresolved_option_groups
  }

  paintHeaderBand(doc)
  const hasLogo = await paintQuoteLogo(doc, logoUrl)
  paintHeaderText(doc, quoteNumber, companyRow, hasLogo)

  let y = 44
  y = addSectionTitle(doc, "Cliente", y)
  const clientBottom = addInfoBlock(doc, [
    ["Nombre", requestRow.customer_name],
    ["Teléfono", requestRow.customer_phone],
    ["Correo", requestRow.customer_email]
  ], y, MARGIN_LEFT, 88)

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
    body: buildQuoteTableBody(sections),
    styles: { font: PDF_FONT_FAMILY, fontSize: 9, cellPadding: 3, textColor: INK, overflow: "linebreak" },
    headStyles: { font: PDF_FONT_FAMILY, fontStyle: "bold", fillColor: ACCENT, textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 78 },
      2: { cellWidth: 44 },
      3: { cellWidth: 28, halign: "right" }
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) {
        setPdfFont(doc, "normal")
        doc.setFontSize(8)
        doc.setTextColor(...MUTED)
        doc.text(`${quoteNumber} — página ${data.pageNumber}`, 196, 12, { align: "right" })
      }
    }
  })

  let totalsY = doc.lastAutoTable.finalY + 10
  totalsY = ensurePageSpace(doc, totalsY, 40)
  const totalsX = 130

  setPdfFont(doc, "normal")
  doc.setFontSize(10)
  doc.setTextColor(...INK)

  const totalValue = totalsRow.has_unresolved_option_groups
    ? "Según opción elegida"
    : formatMoney(totalsRow.total)

  const totals = [
    ["Subtotal", formatMoney(totalsRow.subtotal)],
    ...(Number(totalsRow.discount_amount) > 0 ? [["Descuento", `-${formatMoney(totalsRow.discount_amount)}`]] : []),
    ["Total", totalValue]
  ]

  totals.forEach(([label, value], index) => {
    const isTotal = index === totals.length - 1
    totalsY = ensurePageSpace(doc, totalsY, 8)
    setPdfFont(doc, isTotal ? "bold" : "normal")
    doc.text(label, totalsX, totalsY)
    doc.text(value, 196, totalsY, { align: "right" })
    totalsY += isTotal ? 8 : 6
  })

  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text("Precios incluyen IVA", totalsX, totalsY + 2)
  if (totalsRow.has_unresolved_option_groups) {
    doc.text("El total final depende de la opción de menú seleccionada.", totalsX, totalsY + 7)
    totalsY += 5
  }

  totalsY += 14
  totalsY = ensurePageSpace(doc, totalsY, 16)
  setPdfFont(doc, "bold")
  doc.setFontSize(10)
  doc.setTextColor(...INK)
  doc.text("Vigencia", MARGIN_LEFT, totalsY)
  setPdfFont(doc, "normal")
  doc.text(formatDate(quoteRow.valid_until), MARGIN_LEFT, totalsY + 6)

  setPdfFont(doc, "bold")
  doc.text("Estado", 80, totalsY)
  setPdfFont(doc, "normal")
  doc.text(QUOTE_STATUS_LABELS[quoteRow.status] || quoteRow.status || "—", 80, totalsY + 6)

  totalsY += 16
  totalsY = addWrappedBlock(doc, {
    title: "Notas comerciales",
    text: quoteRow.notes,
    y: totalsY,
    titleSize: 10,
    bodySize: 9,
    blockGap: 12
  })

  totalsY = addWrappedBlock(doc, {
    title: "Términos y condiciones",
    text: quoteRow.terms || "Precios incluyen IVA.",
    y: totalsY,
    titleSize: 10,
    bodySize: 8,
    lineHeight: 4,
    blockGap: 12
  })

  totalsY = ensurePageSpace(doc, totalsY + 10, 28)
  const signatureY = totalsY + 10
  doc.setDrawColor(...MUTED)
  doc.line(MARGIN_LEFT, signatureY, 90, signatureY)
  doc.line(116, signatureY, 196, signatureY)
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text("Firma cliente", MARGIN_LEFT, signatureY + 5)
  doc.text(`Autorizado — ${companyRow?.commercialName || "Empresa"}`, 116, signatureY + 5)

  addCompanyFooter(doc, companyRow, signatureY + 14)

  doc.save(`${quoteNumber}.pdf`)
}
