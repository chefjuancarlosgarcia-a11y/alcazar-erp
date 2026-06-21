export const QUOTE_ITEM_TYPES = [
  { value: "food", label: "Alimentos" },
  { value: "beverage", label: "Bebidas" },
  { value: "staff", label: "Personal" },
  { value: "equipment", label: "Equipo" },
  { value: "transport", label: "Transporte" },
  { value: "other", label: "Otros" }
]

export const QUANTITY_UNITS = [
  { value: "personas", label: "personas" },
  { value: "platos", label: "platos" },
  { value: "pizzas", label: "pizzas" },
  { value: "unidades", label: "unidades" },
  { value: "horas", label: "horas" },
  { value: "servicios", label: "servicios" }
]

export const QUOTE_LINE_KINDS = [
  { value: "normal", label: "Producto normal" },
  { value: "option", label: "Opción dentro de grupo" }
]

export const QUOTE_STATUS_OPTIONS = [
  { value: "draft", label: "Borrador", tone: "gray" },
  { value: "sent", label: "Enviada", tone: "blue" },
  { value: "approved", label: "Aprobada", tone: "green" },
  { value: "rejected", label: "Rechazada", tone: "red" },
  { value: "expired", label: "Vencida", tone: "orange" }
]

export const QUOTE_STATUS_LABELS = Object.fromEntries(
  QUOTE_STATUS_OPTIONS.map((item) => [item.value, item.label])
)

/** TAX_RATE = 0.12 reservado para calculo interno futuro. Precios al cliente incluyen IVA. */
export const TAX_RATE = 0.12
export const PRICES_INCLUDE_VAT = true

export const DEFAULT_QUOTE_TERMS = `- Cotización válida hasta la fecha indicada.
- Reserva sujeta a disponibilidad de fecha y equipo.
- Para confirmar el evento se requiere anticipo.
- Cambios en menú, cantidad o locación están sujetos a disponibilidad y pueden ajustar el total.
- Precios incluyen IVA.
- Transporte fuera de Quetzaltenango (Xela) puede tener costo adicional.`

export function defaultValidUntil(days = 14) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function createEmptyQuoteItem(sortOrder = 1, sectionMeta = {}) {
  return {
    item_type: "food",
    description: "",
    quantity: 1,
    quantity_unit: "unidades",
    unit_price: 0,
    sort_order: sortOrder,
    line_kind: "normal",
    option_group_name: "",
    option_label: "",
    is_selected_option: false,
    source_template_id: sectionMeta.source_template_id || null,
    source_template_name: sectionMeta.source_template_name || "",
    section_name: sectionMeta.section_name || "",
    section_order: sectionMeta.section_order ?? 0
  }
}

export function isQuoteOptionLine(item) {
  return (item?.line_kind || "normal") === "option"
}

export function getQuoteOptionGroupName(item) {
  return String(item?.option_group_name || "").trim() || "Opciones"
}

export function getQuoteSectionKey(item) {
  const sectionName = String(item?.section_name || "").trim()
  const templateId = item?.source_template_id || ""
  const sectionOrder = Number(item?.section_order) || 0
  if (!sectionName && !templateId) return null
  return `${templateId}|${sectionOrder}|${sectionName}`
}

export function getQuoteSectionLabel(item) {
  return String(item?.section_name || item?.source_template_name || "").trim()
}

export function getQuoteOptionGroupScopeKey(item) {
  const sectionKey = getQuoteSectionKey(item) || "general"
  return `${sectionKey}::${getQuoteOptionGroupName(item)}`
}

export function normalizeQuoteItems(items = []) {
  return items.map((item, index) => {
    const quantity = Number(item.quantity) || 0
    const unitPrice = Number(item.unit_price ?? item.unitPrice) || 0
    const lineKind = item.line_kind || item.lineKind || "normal"
    return {
      item_type: item.item_type || item.itemType || "other",
      description: String(item.description || "").trim(),
      quantity,
      quantity_unit: item.quantity_unit || item.quantityUnit || "unidades",
      unit_price: unitPrice,
      sort_order: item.sort_order ?? item.sortOrder ?? index + 1,
      line_kind: lineKind === "option" ? "option" : "normal",
      option_group_name: String(item.option_group_name || item.optionGroupName || "").trim(),
      option_label: String(item.option_label || item.optionLabel || "").trim(),
      is_selected_option: Boolean(item.is_selected_option ?? item.isSelectedOption),
      source_template_id: item.source_template_id || item.sourceTemplateId || null,
      source_template_name: String(item.source_template_name || item.sourceTemplateName || "").trim(),
      section_name: String(item.section_name || item.sectionName || "").trim(),
      section_order: Number(item.section_order ?? item.sectionOrder) || 0
    }
  })
}

export function getLineTotal(item) {
  return roundMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))
}

export function lineCountsTowardTotal(item) {
  if (!isQuoteOptionLine(item)) return true
  return Boolean(item.is_selected_option)
}

export function hasUnresolvedOptionGroups(items = []) {
  const groups = new Map()

  normalizeQuoteItems(items).forEach((item) => {
    if (!isQuoteOptionLine(item)) return
    const scopeKey = getQuoteOptionGroupScopeKey(item)
    if (!groups.has(scopeKey)) {
      groups.set(scopeKey, { hasOptions: false, hasSelected: false })
    }
    const group = groups.get(scopeKey)
    group.hasOptions = true
    if (item.is_selected_option) group.hasSelected = true
  })

  return [...groups.values()].some((group) => group.hasOptions && !group.hasSelected)
}

export function calculateQuoteTotals(items = [], discountAmount = 0) {
  const normalized = normalizeQuoteItems(items)
  const subtotal = normalized
    .filter(lineCountsTowardTotal)
    .reduce((sum, item) => sum + getLineTotal(item), 0)
  const discount = Math.max(Number(discountAmount) || 0, 0)
  const total = roundMoney(Math.max(subtotal - discount, 0))
  return {
    subtotal,
    discount_amount: discount,
    tax_amount: 0,
    tax_included: true,
    total,
    has_unresolved_option_groups: hasUnresolvedOptionGroups(normalized)
  }
}

function groupItemsIntoBlocks(items = []) {
  const blocks = []
  const seenOptionGroups = new Set()

  items.forEach((item) => {
    if (!isQuoteOptionLine(item)) {
      blocks.push({ type: "normal", item })
      return
    }

    const scopeKey = getQuoteOptionGroupScopeKey(item)
    if (seenOptionGroups.has(scopeKey)) return

    seenOptionGroups.add(scopeKey)
    blocks.push({
      type: "option_group",
      groupName: getQuoteOptionGroupName(item),
      options: items.filter(
        (candidate) => isQuoteOptionLine(candidate) && getQuoteOptionGroupScopeKey(candidate) === scopeKey
      )
    })
  })

  return blocks
}

export function groupQuoteItemsForDisplay(items = []) {
  const normalized = normalizeQuoteItems(items).filter((item) => item.description)
  const sections = []
  const seenSectionKeys = new Set()

  normalized.forEach((item) => {
    const sectionKey = getQuoteSectionKey(item)
    if (!sectionKey) return
    if (seenSectionKeys.has(sectionKey)) return
    seenSectionKeys.add(sectionKey)
    const sectionItems = normalized.filter((candidate) => getQuoteSectionKey(candidate) === sectionKey)
    sections.push({
      type: "template_section",
      sectionKey,
      sectionName: getQuoteSectionLabel(sectionItems[0]) || "Plantilla",
      sectionOrder: sectionItems[0]?.section_order ?? 0,
      blocks: groupItemsIntoBlocks(sectionItems)
    })
  })

  const manualItems = normalized.filter((item) => !getQuoteSectionKey(item))
  if (manualItems.length) {
    sections.push({
      type: "manual_section",
      sectionKey: null,
      sectionName: null,
      sectionOrder: Number.MAX_SAFE_INTEGER,
      blocks: groupItemsIntoBlocks(manualItems)
    })
  }

  return sections.sort((a, b) => (a.sectionOrder ?? 0) - (b.sectionOrder ?? 0))
}

export function groupQuoteItemsForEditor(items = []) {
  const normalized = normalizeQuoteItems(items)
  const groups = []
  const seenSectionKeys = new Set()

  normalized.forEach((item, index) => {
    const sectionKey = getQuoteSectionKey(item)
    if (sectionKey) {
      if (seenSectionKeys.has(sectionKey)) return
      seenSectionKeys.add(sectionKey)
      const sectionItems = normalized
        .map((candidate, candidateIndex) => ({ item: candidate, index: candidateIndex }))
        .filter(({ item: candidate }) => getQuoteSectionKey(candidate) === sectionKey)
      groups.push({
        type: "template_section",
        sectionKey,
        sectionName: getQuoteSectionLabel(sectionItems[0]?.item) || "Plantilla",
        sectionOrder: sectionItems[0]?.item?.section_order ?? 0,
        lines: sectionItems
      })
      return
    }

    groups.push({
      type: "manual_line",
      sectionKey: null,
      sectionName: null,
      sectionOrder: item.sort_order ?? index,
      lines: [{ item, index }]
    })
  })

  return groups.sort((a, b) => {
    const orderA = a.type === "template_section" ? a.sectionOrder : a.lines[0]?.item?.sort_order ?? 0
    const orderB = b.type === "template_section" ? b.sectionOrder : b.lines[0]?.item?.sort_order ?? 0
    return orderA - orderB
  })
}

export function getNextTemplateSectionOrder(items = [], templateId = null) {
  const normalized = normalizeQuoteItems(items)
  const matching = normalized.filter((item) => item.source_template_id === templateId)
  if (!matching.length) {
    const maxOrder = normalized.reduce((max, item) => Math.max(max, Number(item.section_order) || 0), 0)
    return maxOrder + 1
  }
  return Math.max(...matching.map((item) => Number(item.section_order) || 0)) + 1
}

export function templateAlreadyAdded(items = [], templateId) {
  if (!templateId) return false
  return normalizeQuoteItems(items).some((item) => item.source_template_id === templateId)
}

export function stripEmptyPlaceholderItems(items = []) {
  const normalized = normalizeQuoteItems(items)
  const meaningful = normalized.filter((item) => item.description)
  return meaningful.length ? meaningful : [createEmptyQuoteItem()]
}

export function appendTemplateToQuoteItems(items = [], templateItems = [], templateMeta = {}) {
  const baseItems = stripEmptyPlaceholderItems(items)
  const sectionOrder = templateMeta.section_order ?? getNextTemplateSectionOrder(baseItems, templateMeta.source_template_id)
  const sectionName = templateMeta.section_name || templateMeta.source_template_name || "Plantilla"
  const startSortOrder = baseItems.reduce((max, item) => Math.max(max, Number(item.sort_order) || 0), 0) + 1
  const appended = mapTemplateItemsToQuoteItems(templateItems, {
    ...templateMeta,
    section_name: sectionName,
    section_order: sectionOrder,
    startSortOrder
  })
  return [...baseItems, ...appended]
}

export function removeQuoteSection(items = [], sectionKey) {
  if (!sectionKey) return stripEmptyPlaceholderItems(items)
  const next = normalizeQuoteItems(items).filter((item) => getQuoteSectionKey(item) !== sectionKey)
  return next.length ? next : [createEmptyQuoteItem()]
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function quoteStatusClass(status) {
  return `catering-quote-status catering-quote-status--${status || "draft"}`
}

export function itemTypeLabel(value) {
  return QUOTE_ITEM_TYPES.find((item) => item.value === value)?.label || value || "—"
}

export function quantityUnitLabel(value) {
  return QUANTITY_UNITS.find((item) => item.value === value)?.label || value || "unidades"
}

export function formatQuantityLine(item) {
  const qty = Number(item.quantity) || 0
  const unit = quantityUnitLabel(item.quantity_unit)
  const price = Number(item.unit_price) || 0
  return `${qty.toLocaleString("es-GT")} ${unit} x Q${price.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function formatOptionDisplayTitle(item) {
  const label = item.option_label?.trim()
  if (label) return `${label} — ${item.description}`
  return item.description
}

export function buildQuotePayload(items, discountAmount, validUntil, notes, terms) {
  return {
    items: normalizeQuoteItems(items).filter((item) => item.description),
    discountAmount: Number(discountAmount) || 0,
    validUntil: validUntil || null,
    notes: notes || null,
    terms: terms || null
  }
}

export function mapTemplateItemsToQuoteItems(items = [], sectionMeta = {}) {
  const startSortOrder = sectionMeta.startSortOrder ?? 1
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit || "unidades",
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? startSortOrder + index,
    line_kind: item.line_kind || "normal",
    option_group_name: item.option_group_name || "",
    option_label: item.option_label || "",
    is_selected_option: Boolean(item.is_selected_option),
    source_template_id: sectionMeta.source_template_id || null,
    source_template_name: sectionMeta.source_template_name || "",
    section_name: sectionMeta.section_name || sectionMeta.source_template_name || "",
    section_order: sectionMeta.section_order ?? 0
  }))
}
