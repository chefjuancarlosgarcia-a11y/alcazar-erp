import {
  buildCompanyFooterLines,
  mergeQuoteSettings
} from "./cateringQuoteSettings"
import {
  calculateQuoteTotals,
  formatQuantityLine,
  itemTypeLabel,
  QUOTE_STATUS_LABELS
} from "./cateringQuoteTemplates"
import {
  repairCateringCompanySettings,
  repairCateringQuoteItems,
  repairCateringRequest,
  repairSpanishText
} from "./cateringTextEncoding"
import { formatDate, formatMoney, formatTime } from "./cateringUtils"

export default function CateringQuotePreview({
  quoteNumber,
  quoteStatus,
  request,
  items,
  discountAmount,
  validUntil,
  notes,
  terms,
  company
}) {
  const safeRequest = repairCateringRequest(request || {})
  const safeItems = repairCateringQuoteItems(items)
  const safeNotes = repairSpanishText(notes)
  const safeTerms = repairSpanishText(terms)
  const safeQuoteNumber = repairSpanishText(quoteNumber)
  const safeQuoteStatus = repairSpanishText(quoteStatus)

  const totals = calculateQuoteTotals(safeItems, discountAmount)
  const brand = repairCateringCompanySettings(mergeQuoteSettings(company || {}))
  const commercialName = brand.commercialName || "Empresa"
  const headerText = brand.headerText || "Cotización de Catering"
  const footerLines = buildCompanyFooterLines(brand).map(repairSpanishText)

  return (
    <aside className="catering-quote-preview" aria-label="Vista previa de cotización" lang="es">
      <div className="catering-quote-preview__paper">
        <header className="catering-quote-preview__header catering-quote-preview__header--brand">
          <div className="catering-quote-preview__brand">
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt="" className="catering-quote-preview__logo" />
            ) : (
              <div className="catering-quote-preview__logo-placeholder">GA</div>
            )}
            <div>
              <strong>{commercialName}</strong>
              <p>{headerText}</p>
              {brand.nit ? <small>NIT: {brand.nit}</small> : null}
            </div>
          </div>
          <div className="catering-quote-preview__meta">
            <span>{safeQuoteNumber || "BORRADOR"}</span>
            {safeQuoteStatus ? <small>{QUOTE_STATUS_LABELS[safeQuoteStatus] || safeQuoteStatus}</small> : null}
          </div>
        </header>

        <section className="catering-quote-preview__block">
          <h4>Cliente</h4>
          <p>{safeRequest.customer_name || "—"}</p>
          <small>{[safeRequest.customer_phone, safeRequest.customer_email].filter(Boolean).join(" · ") || "—"}</small>
        </section>

        <section className="catering-quote-preview__block">
          <h4>Evento</h4>
          <p>{safeRequest.event_type || "—"}</p>
          <small>
            {formatDate(safeRequest.event_date)}
            {safeRequest.event_time ? ` ${formatTime(safeRequest.event_time)}` : ""}
            {safeRequest.event_location ? ` · ${safeRequest.event_location}` : ""}
          </small>
        </section>

        <section className="catering-quote-preview__lines">
          <h4>Detalle</h4>
          {safeItems.filter((item) => item.description).map((item, index) => (
            <article key={`${index}-${item.description}`} className="catering-quote-preview__line">
              <div>
                <strong>{item.description}</strong>
                <small>{itemTypeLabel(item.item_type)}</small>
              </div>
              <div className="catering-quote-preview__line-values">
                <span>{formatQuantityLine(item)}</span>
                <strong>{formatMoney((Number(item.quantity) || 0) * (Number(item.unit_price) || 0))}</strong>
              </div>
            </article>
          ))}
        </section>

        <section className="catering-quote-preview__totals">
          <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
          {totals.discount_amount > 0 ? (
            <div><span>Descuento</span><strong>-{formatMoney(totals.discount_amount)}</strong></div>
          ) : null}
          <div className="is-total"><span>Total</span><strong>{formatMoney(totals.total)}</strong></div>
          <small className="catering-quote-preview__vat">Precios incluyen IVA</small>
        </section>

        <section className="catering-quote-preview__block">
          <h4>Vigencia</h4>
          <p>{formatDate(validUntil)}</p>
        </section>

        {safeNotes ? (
          <section className="catering-quote-preview__block">
            <h4>Notas comerciales</h4>
            <p className="catering-quote-preview__text">{safeNotes}</p>
          </section>
        ) : null}

        {safeTerms ? (
          <section className="catering-quote-preview__block">
            <h4>Términos y condiciones</h4>
            <pre className="catering-quote-preview__terms">{safeTerms}</pre>
          </section>
        ) : null}

        {footerLines.length ? (
          <footer className="catering-quote-preview__footer">
            {footerLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </footer>
        ) : null}
      </div>
    </aside>
  )
}
