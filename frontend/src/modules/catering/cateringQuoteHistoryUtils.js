export const EMPTY_QUOTES_SUMMARY = { count: 0, latest: null, quotes: [] }

export const SYNC_EXPIRED_WARNING_COPY =
  "No se pudieron registrar algunos vencimientos. Los indicadores se calcularon con el estado efectivo; vuelve a intentarlo."

export function normalizeCateringRequestQuotesPayload(data) {
  if (!data || typeof data !== "object") {
    return { ...EMPTY_QUOTES_SUMMARY }
  }

  const quotes = Array.isArray(data.quotes) ? data.quotes : []

  return {
    count: Number(data.count ?? quotes.length) || 0,
    latest: data.latest ?? null,
    quotes
  }
}

export function applyQuotesLoadResult(_current, quotesResult) {
  if (quotesResult?.error) {
    return { summary: { ...EMPTY_QUOTES_SUMMARY }, error: quotesResult.error }
  }

  return {
    summary: normalizeCateringRequestQuotesPayload(quotesResult.data),
    error: ""
  }
}

export function resolveSyncExpiredWarning(syncResult) {
  if (syncResult?.error) return SYNC_EXPIRED_WARNING_COPY
  return ""
}

export async function runQuotePdfDownload({ quoteId, downloadFn, onStart, onFinish }) {
  if (!quoteId) {
    return { ok: false, error: "Identificador de cotización inválido." }
  }

  onStart?.(quoteId)

  try {
    const result = await downloadFn(quoteId)
    if (!result?.ok) {
      return { ok: false, error: result.error || "No fue posible descargar el PDF." }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: "No se pudo generar el PDF." }
  } finally {
    onFinish?.()
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
