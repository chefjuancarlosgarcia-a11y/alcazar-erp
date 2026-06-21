import { useBrandingContext } from "../../context/BrandingProvider"
import {
  buildCompanyFooterLines,
  mergeQuoteSettings
} from "./cateringQuoteSettings"
import QuoteLogoImage from "./QuoteLogoImage"
import {
  calculateQuoteTotals,
  formatOptionDisplayTitle,
  formatQuantityLine,
  getLineTotal,
  groupQuoteItemsForDisplay,
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
  const branding = useBrandingContext()
  const safeRequest = repairCateringRequest(request || {})
  const safeItems = repairCateringQuoteItems(items)
  const safeNotes = repairSpanishText(notes)
  const safeTerms = repairSpanishText(terms)
  const safeQuoteNumber = repairSpanishText(quoteNumber)
  const safeQuoteStatus = repairSpanishText(quoteStatus)

  const totals = calculateQuoteTotals(safeItems, discountAmount)
  const sections = groupQuoteItemsForDisplay(safeItems)
  const brand = repairCateringCompanySettings(mergeQuoteSettings(company || {}, branding))
  const logoUrl = brand.logoUrl || ""
  const commercialName = brand.commercialName || "Empresa"
  const headerText = brand.headerText || "Cotización de Catering"
  const footerLines = buildCompanyFooterLines(brand).map(repairSpanishText)

  return (
    <aside className="catering-quote-preview" aria-label="Vista previa de cotización" lang="es">
      <div className="catering-quote-preview__paper">
        <header className="catering-quote-preview__header catering-quote-preview__header--brand">
          <div className="catering-quote-preview__brand">
            <QuoteLogoImage
              logoUrl={logoUrl}
              className="catering-quote-preview__logo"
              placeholder={brand.commercialName?.slice(0, 2)?.toUpperCase() || "GA"}
            />
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
          {sections.map((section, sectionIndex) => {
            if (section.type === "normal") {
              const item = section.item
              return (
                <article key={`normal-${sectionIndex}-${item.description}`} className="catering-quote-preview__line">
                  <div>
                    <strong>{item.description}</strong>
                    <small>{itemTypeLabel(item.item_type)}</small>
                  </div>
                  <div className="catering-quote-preview__line-values">
                    <span>{formatQuantityLine(item)}</span>
                    <strong>{formatMoney(getLineTotal(item))}</strong>
                  </div>
                </article>
              )
            }

            return (
              <section key={`group-${sectionIndex}-${section.groupName}`} className="catering-quote-preview__option-group">
                <h5>{section.groupName.toUpperCase()}</h5>
                {section.options.map((item, optionIndex) => (
                  <article
                    key={`option-${sectionIndex}-${optionIndex}-${item.description}`}
                    className={`catering-quote-preview__line catering-quote-preview__line--option${item.is_selected_option ? " is-selected" : ""}`}
                  >
                    <div>
                      <strong>{formatOptionDisplayTitle(item)}</strong>
                      <small>
                        {itemTypeLabel(item.item_type)}
                        {item.is_selected_option ? " · Seleccionada" : ""}
                      </small>
                    </div>
                    <div className="catering-quote-preview__line-values">
                      <span>{formatQuantityLine(item)}</span>
                      <strong>{formatMoney(getLineTotal(item))}</strong>
                    </div>
                  </article>
                ))}
              </section>
            )
          })}
        </section>

        <section className="catering-quote-preview__totals">
          <div><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
          {totals.discount_amount > 0 ? (
            <div><span>Descuento</span><strong>-{formatMoney(totals.discount_amount)}</strong></div>
          ) : null}
          <div className="is-total">
            <span>Total</span>
            <strong>
              {totals.has_unresolved_option_groups ? "Según opción elegida" : formatMoney(totals.total)}
            </strong>
          </div>
          {totals.has_unresolved_option_groups ? (
            <small className="catering-quote-preview__option-note">
              El total final depende de la opción de menú seleccionada.
            </small>
          ) : null}
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
