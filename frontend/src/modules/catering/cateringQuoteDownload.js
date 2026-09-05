import { downloadCateringQuotePdf } from "./cateringQuotePdf.js"
import { getCateringQuoteDetail } from "./cateringService.js"
import { getCateringQuoteSettings, mergeQuoteSettings } from "./cateringQuoteSettings.js"
import { calculateQuoteTotals } from "./cateringQuoteTemplates.js"
import { buildQuotePdfRow, isDraftQuoteStatus } from "./cateringQuoteModalUtils.js"
import { mapQuoteItemsFromApi } from "./cateringQuoteHistoryUtils.js"
import { repairCateringRequest } from "./cateringTextEncoding.js"

function buildPdfItems(items = []) {
  return items.map((item) => ({
    ...item,
    total_price: item.quantity * item.unit_price
  }))
}

export async function downloadCateringQuotePdfById({
  quoteId,
  request,
  branding = {}
}) {
  if (!quoteId) {
    return { ok: false, error: "Identificador de cotización inválido." }
  }

  const [detailResult, settingsResult] = await Promise.all([
    getCateringQuoteDetail(quoteId),
    getCateringQuoteSettings()
  ])

  if (detailResult.error) {
    return { ok: false, error: detailResult.error }
  }

  const quoteRow = detailResult.data?.quote || {}
  const pdfItems = mapQuoteItemsFromApi(detailResult.data?.items || [])
  const totals = calculateQuoteTotals(pdfItems, quoteRow.discount_amount ?? 0)
  const company = mergeQuoteSettings(settingsResult.data || {}, branding)
  const safeRequest = repairCateringRequest(
    detailResult.data?.request || request || {}
  )

  await downloadCateringQuotePdf({
    quote: buildQuotePdfRow({
      quote: quoteRow,
      totals,
      validUntil: quoteRow.valid_until,
      notes: quoteRow.notes,
      terms: quoteRow.terms,
      statusOverride: isDraftQuoteStatus(quoteRow.status) ? "draft" : quoteRow.status
    }),
    items: buildPdfItems(pdfItems),
    request: safeRequest,
    company,
    branding
  })

  return { ok: true }
}
