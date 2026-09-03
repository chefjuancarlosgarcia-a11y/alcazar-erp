import { formatDate, formatMoney, formatTime } from "./cateringUtils.js"
import {
  formatOptionDisplayTitle,
  formatQuantityLine,
  getLineTotal,
  groupQuoteItemsForDisplay,
  itemTypeLabel,
  QUOTE_STATUS_LABELS
} from "./cateringQuoteTemplates.js"

export const QUOTE_DOC_COLORS = {
  accent: "#0d9488",
  accentLight: "#ecfdf5",
  ink: "#0f172a",
  muted: "#64748b",
  border: "#e2e8f0",
  panelBg: "#f8fafc",
  tableHead: "#0f766e",
  tableStripe: "#f8fafc",
  optionGroup: "#ecfdf5",
  templateSection: "#eff6ff"
}

export function buildQuoteDocumentMeta({ quoteNumber, quoteStatus, validUntil, issuedAt = new Date() }) {
  const isDraft = !quoteNumber || quoteNumber === "BORRADOR" || quoteStatus === "draft"
  return {
    isDraft,
    quoteNumber: quoteNumber || "BORRADOR",
    quoteStatus,
    statusLabel: QUOTE_STATUS_LABELS[quoteStatus] || quoteStatus || "Borrador",
    issuedLabel: formatDate(issuedAt instanceof Date ? issuedAt.toISOString().slice(0, 10) : issuedAt),
    validUntilLabel: formatDate(validUntil)
  }
}

export function buildQuoteClientPanel(request = {}) {
  return [
    { label: "Nombre", value: request.customer_name },
    { label: "Teléfono", value: request.customer_phone },
    { label: "Correo", value: request.customer_email }
  ]
}

export function buildQuoteEventPanel(request = {}) {
  const dateTime = [
    formatDate(request.event_date),
    request.event_time ? formatTime(request.event_time) : ""
  ].filter(Boolean).join(" · ")

  return [
    { label: "Tipo de evento", value: request.event_type },
    { label: "Fecha y hora", value: dateTime || "—" },
    { label: "Ubicación", value: request.event_location },
    { label: "Invitados", value: request.guest_count ?? "—" }
  ]
}

export function buildQuoteTableRows(items = []) {
  const sections = groupQuoteItemsForDisplay(items)
  const rows = []

  sections.forEach((section) => {
    if (section.type === "template_section") {
      rows.push({
        kind: "section",
        title: section.sectionName.toUpperCase(),
        tone: "template"
      })
    }

    section.blocks.forEach((block) => {
      if (block.type === "normal") {
        rows.push(buildNormalRow(block.item))
        return
      }

      rows.push({
        kind: "section",
        title: block.groupName.toUpperCase(),
        tone: "option"
      })

      block.options.forEach((item) => {
        rows.push(buildOptionRow(item))
      })
    })
  })

  return rows
}

function buildNormalRow(item) {
  return {
    kind: "line",
    description: item.description,
    subtitle: itemTypeLabel(item.item_type),
    quantity: formatQuantityLine(item).split(" x ")[0],
    unitPrice: formatMoney(Number(item.unit_price) || 0),
    total: formatMoney(getLineTotal(item))
  }
}

function buildOptionRow(item) {
  const selected = Boolean(item.is_selected_option)
  return {
    kind: "line",
    description: formatOptionDisplayTitle(item),
    subtitle: `${itemTypeLabel(item.item_type)}${selected ? " · Seleccionada" : ""}`,
    quantity: formatQuantityLine(item).split(" x ")[0],
    unitPrice: formatMoney(Number(item.unit_price) || 0),
    total: formatMoney(getLineTotal(item)),
    isOption: true,
    isSelected: selected
  }
}

export function buildQuoteTotalsRows(totals = {}) {
  const rows = [
    { label: "Subtotal", value: formatMoney(totals.subtotal) },
    ...(Number(totals.discount_amount) > 0
      ? [{ label: "Descuento", value: `-${formatMoney(totals.discount_amount)}`, tone: "discount" }]
      : []),
    {
      label: "Total",
      value: totals.has_unresolved_option_groups ? "Según opción elegida" : formatMoney(totals.total),
      tone: "total"
    }
  ]
  return rows
}
