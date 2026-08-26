import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { buildCompanyFooterLines } from "./cateringQuoteSettings"
import {
  buildQuoteClientPanel,
  buildQuoteDocumentMeta,
  buildQuoteEventPanel,
  buildQuoteTableRows,
  buildQuoteTotalsRows
} from "./cateringQuoteDocumentLayout"
import { detectImageFormat, loadQuoteLogoDataUrl, resolveQuoteLogoUrl } from "./cateringQuoteLogo"
import { PDF_FONT_FAMILY, registerPdfFonts, setPdfFont } from "./cateringQuotePdfFonts"
import {
  repairCateringCompanySettings,
  repairCateringQuote,
  repairCateringQuoteItems,
  repairCateringRequest,
  repairSpanishText
} from "./cateringTextEncoding"
import { calculateQuoteTotals } from "./cateringQuoteTemplates"

const ACCENT = [13, 148, 136]
const INK = [15, 23, 42]
const MUTED = [100, 116, 139]
const BORDER = [226, 232, 240]
const PANEL_BG = [248, 250, 252]
const PAGE_BOTTOM = 278
const MARGIN_LEFT = 16
const MARGIN_RIGHT = 16
const CONTENT_WIDTH = 178

async function addLogo(doc, logoUrl, x, y, width = 28, height = 28) {
  const dataUrl = await loadQuoteLogoDataUrl(logoUrl)
  if (!dataUrl) return false

  doc.setDrawColor(...BORDER)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, width, height, 2, 2, "S")

  try {
    doc.addImage(dataUrl, detectImageFormat(dataUrl, logoUrl), x + 1, y + 1, width - 2, height - 2)
    return true
  } catch {
    return false
  }
}

function paintDraftWatermark(doc) {
  doc.setTextColor(220, 226, 232)
  setPdfFont(doc, "bold")
  doc.setFontSize(56)
  doc.text("BORRADOR", 105, 160, { align: "center", angle: 35 })
}

function paintAccentBar(doc) {
  doc.setFillColor(...ACCENT)
  doc.rect(0, 0, 210, 4, "F")
}

async function paintLetterhead(doc, company, meta, logoUrl) {
  let y = 14
  const hasLogo = logoUrl ? await addLogo(doc, logoUrl, MARGIN_LEFT, y, 28, 28) : false
  const textX = hasLogo ? MARGIN_LEFT + 34 : MARGIN_LEFT

  setPdfFont(doc, "bold")
  doc.setFontSize(14)
  doc.setTextColor(...INK)
  doc.text(company?.commercialName || "Empresa", textX, y + 6)

  setPdfFont(doc, "normal")
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(company?.headerText || "Cotización de Catering", textX, y + 12)

  let subY = y + 17
  if (company?.nit) {
    doc.setFontSize(8)
    doc.text(`NIT: ${company.nit}`, textX, subY)
    subY += 4
  }
  if (company?.address) {
    doc.setFontSize(8)
    const lines = doc.splitTextToSize(company.address, 92)
    doc.text(lines, textX, subY)
  }

  const boxX = 128
  const boxW = 66
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.setFillColor(...PANEL_BG)
  doc.roundedRect(boxX, y, boxW, 34, 2, 2, "FD")

  setPdfFont(doc, "bold")
  doc.setFontSize(8)
  doc.setTextColor(...ACCENT)
  doc.text("COTIZACIÓN", boxX + 4, y + 7)

  setPdfFont(doc, "bold")
  doc.setFontSize(11)
  doc.setTextColor(...INK)
  doc.text(meta.quoteNumber, boxX + 4, y + 14)

  setPdfFont(doc, "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  doc.text(`Fecha: ${meta.issuedLabel}`, boxX + 4, y + 20)
  doc.text(`Vigencia: ${meta.validUntilLabel}`, boxX + 4, y + 25)
  doc.text(`Estado: ${meta.statusLabel}`, boxX + 4, y + 30)

  return 52
}

function paintInfoPanels(doc, clientPanel, eventPanel, startY) {
  const panelW = 86
  const panelH = 38
  const gap = 6

  function drawPanel(title, rows, x) {
    doc.setDrawColor(...BORDER)
    doc.setLineWidth(0.4)
    doc.setFillColor(...PANEL_BG)
    doc.roundedRect(x, startY, panelW, panelH, 2, 2, "FD")

    setPdfFont(doc, "bold")
    doc.setFontSize(8)
    doc.setTextColor(...ACCENT)
    doc.text(title.toUpperCase(), x + 4, startY + 6)

    let rowY = startY + 12
    rows.forEach(({ label, value }) => {
      setPdfFont(doc, "bold")
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(`${label}:`, x + 4, rowY)

      setPdfFont(doc, "normal")
      doc.setTextColor(...INK)
      const lines = doc.splitTextToSize(String(value || "—"), panelW - 28)
      doc.text(lines, x + 22, rowY)
      rowY += Math.max(lines.length * 3.8, 4.2)
    })
  }

  drawPanel("Cliente", clientPanel, MARGIN_LEFT)
  drawPanel("Evento", eventPanel, MARGIN_LEFT + panelW + gap)

  return startY + panelH + 8
}

function buildPdfTableBody(tableRows) {
  return tableRows.map((row) => {
    if (row.kind === "section") {
      const fillColor = row.tone === "template" ? [239, 246, 255] : [236, 253, 245]
      return [{
        content: row.title,
        colSpan: 4,
        styles: { fontStyle: "bold", fillColor, textColor: INK, fontSize: 8 }
      }]
    }

    const description = row.subtitle
      ? `${row.description}\n${row.subtitle}`
      : row.description

    return [
      description,
      row.quantity,
      row.unitPrice,
      row.total
    ]
  })
}

function ensurePageSpace(doc, y, neededHeight = 20) {
  if (y + neededHeight <= PAGE_BOTTOM) return y
  doc.addPage()
  paintAccentBar(doc)
  return 16
}

function measureWrappedText(doc, text, maxWidth, lineHeight = 4) {
  const lines = doc.splitTextToSize(String(text || ""), maxWidth)
  return { lines, height: Math.max(lines.length, 1) * lineHeight }
}

function addWrappedBlock(doc, { title, text, y, bodySize = 8, lineHeight = 3.8, blockGap = 10 }) {
  const safeText = String(text || "").trim()
  if (!safeText) return y

  y = ensurePageSpace(doc, y, 16)
  setPdfFont(doc, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ACCENT)
  doc.text(title.toUpperCase(), MARGIN_LEFT, y)
  y += 6

  setPdfFont(doc, "normal")
  doc.setFontSize(bodySize)
  doc.setTextColor(...INK)
  const { lines, height } = measureWrappedText(doc, safeText, CONTENT_WIDTH, lineHeight)
  y = ensurePageSpace(doc, y, height + 2)
  doc.text(lines, MARGIN_LEFT, y)
  return y + height + blockGap
}

function paintTotalsBox(doc, totalsRows, totalsMeta, startY) {
  const boxW = 72
  const boxX = 196 - boxW
  let y = ensurePageSpace(doc, startY, 28)

  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.5)
  doc.setFillColor(255, 255, 255)
  const boxH = 8 + totalsRows.length * 6 + (totalsMeta.has_unresolved_option_groups ? 8 : 4)
  doc.roundedRect(boxX, y - 4, boxW, boxH, 2, 2, "S")

  totalsRows.forEach((row, index) => {
    const isTotal = row.tone === "total"
    setPdfFont(doc, isTotal ? "bold" : "normal")
    doc.setFontSize(isTotal ? 11 : 9)
    doc.setTextColor(...INK)
    doc.text(row.label, boxX + 4, y + index * 6)
    doc.text(row.value, boxX + boxW - 4, y + index * 6, { align: "right" })
  })

  y += totalsRows.length * 6 + 2
  doc.setFontSize(7)
  doc.setTextColor(...MUTED)
  doc.text("Precios incluyen IVA", boxX + 4, y)
  if (totalsMeta.has_unresolved_option_groups) {
    y += 4
    const note = doc.splitTextToSize("El total depende de la opción de menú seleccionada.", boxW - 8)
    doc.text(note, boxX + 4, y)
  }

  return y + 12
}

function paintSignatures(doc, companyName, startY) {
  let y = ensurePageSpace(doc, startY, 24)
  doc.setDrawColor(...MUTED)
  doc.setLineWidth(0.4)
  doc.line(MARGIN_LEFT, y, 88, y)
  doc.line(118, y, 196, y)

  setPdfFont(doc, "normal")
  doc.setFontSize(8)
  doc.setTextColor(...MUTED)
  doc.text("Firma del cliente", MARGIN_LEFT, y + 5)
  doc.text(`Autorizado — ${companyName || "Empresa"}`, 118, y + 5)
  return y + 16
}

function addCompanyFooter(doc, company, startY) {
  const lines = buildCompanyFooterLines(company)
  if (!lines.length) return startY

  let y = ensurePageSpace(doc, startY, 20)
  doc.setDrawColor(...ACCENT)
  doc.setLineWidth(0.6)
  doc.line(MARGIN_LEFT, y, 196, y)
  y += 8

  setPdfFont(doc, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...INK)
  doc.text(lines[0], 105, y, { align: "center" })
  y += 5

  setPdfFont(doc, "normal")
  doc.setFontSize(7.5)
  doc.setTextColor(...MUTED)
  lines.slice(1).forEach((line) => {
    y = ensurePageSpace(doc, y, 5)
    doc.text(line, 105, y, { align: "center" })
    y += 4
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
  const quoteNumber = repairSpanishText(quoteRow.quote_number || "BORRADOR")

  const computedTotals = calculateQuoteTotals(
    safeItems,
    quoteRow.discount_amount ?? quoteRow.discountAmount ?? 0
  )

  const meta = buildQuoteDocumentMeta({
    quoteNumber,
    quoteStatus: quoteRow.status,
    validUntil: quoteRow.valid_until
  })

  const tableRows = buildQuoteTableRows(safeItems)
  const totalsRows = buildQuoteTotalsRows(computedTotals)
  const clientPanel = buildQuoteClientPanel(requestRow)
  const eventPanel = buildQuoteEventPanel(requestRow)

  paintAccentBar(doc)
  if (meta.isDraft) paintDraftWatermark(doc)

  let y = await paintLetterhead(doc, companyRow, meta, logoUrl)
  y = paintInfoPanels(doc, clientPanel, eventPanel, y)

  setPdfFont(doc, "bold")
  doc.setFontSize(9)
  doc.setTextColor(...ACCENT)
  doc.text("DETALLE DE SERVICIOS", MARGIN_LEFT, y)
  y += 4

  autoTable(doc, {
    startY: y,
    head: [["Descripción", "Cantidad", "P. unit.", "Total"]],
    body: buildPdfTableBody(tableRows),
    styles: {
      font: PDF_FONT_FAMILY,
      fontSize: 8.5,
      cellPadding: { top: 3, right: 3, bottom: 3, left: 3 },
      textColor: INK,
      overflow: "linebreak",
      lineColor: BORDER,
      lineWidth: 0.2
    },
    headStyles: {
      font: PDF_FONT_FAMILY,
      fontStyle: "bold",
      fillColor: ACCENT,
      textColor: [255, 255, 255],
      fontSize: 8
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 88 },
      1: { cellWidth: 32, halign: "center" },
      2: { cellWidth: 28, halign: "right" },
      3: { cellWidth: 30, halign: "right", fontStyle: "bold" }
    },
    margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
    didDrawPage: (data) => {
      if (data.pageNumber === 1) return
      paintAccentBar(doc)
      setPdfFont(doc, "normal")
      doc.setFontSize(7)
      doc.setTextColor(...MUTED)
      doc.text(`${quoteNumber} — página ${data.pageNumber}`, 196, 10, { align: "right" })
    }
  })

  let totalsY = doc.lastAutoTable.finalY + 10
  totalsY = paintTotalsBox(doc, totalsRows, computedTotals, totalsY)

  totalsY = addWrappedBlock(doc, {
    title: "Notas comerciales",
    text: quoteRow.notes,
    y: totalsY
  })

  totalsY = addWrappedBlock(doc, {
    title: "Términos y condiciones",
    text: quoteRow.terms || "Precios incluyen IVA.",
    y: totalsY,
    bodySize: 7.5,
    lineHeight: 3.6
  })

  totalsY = paintSignatures(doc, companyRow?.commercialName, totalsY)
  addCompanyFooter(doc, companyRow, totalsY)

  doc.save(`${quoteNumber.replace(/\s+/g, "-")}.pdf`)
}
