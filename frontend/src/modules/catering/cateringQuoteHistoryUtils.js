export function normalizeCateringRequestQuotesPayload(data) {
  if (!data || typeof data !== "object") {
    return { count: 0, latest: null, quotes: [] }
  }

  const quotes = Array.isArray(data.quotes) ? data.quotes : []

  return {
    count: Number(data.count ?? quotes.length) || 0,
    latest: data.latest ?? null,
    quotes
  }
}

export function canDownloadQuotePdf(status) {
  return Boolean(status) && status !== "draft"
}

export function getQuoteDownloadLabel(status) {
  return !status || status === "draft" ? "Descargar borrador" : "Descargar PDF"
}

export function mapQuoteItemsFromApi(items = []) {
  return items.map((item, index) => ({
    item_type: item.item_type,
    description: item.description,
    quantity: item.quantity,
    quantity_unit: item.quantity_unit || "unidades",
    unit_price: item.unit_price,
    sort_order: item.sort_order ?? index + 1,
    line_kind: item.line_kind || "normal",
    option_group_name: item.option_group_name || "",
    option_label: item.option_label || "",
    is_selected_option: Boolean(item.is_selected_option),
    source_template_id: item.source_template_id || null,
    source_template_name: item.source_template_name || "",
    section_name: item.section_name || "",
    section_order: Number(item.section_order) || 0
  }))
}
