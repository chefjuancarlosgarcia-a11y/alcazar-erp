import { useBrandingContext } from "../../context/BrandingProvider"
import {
  buildCompanyFooterLines,
  mergeQuoteSettings
} from "./cateringQuoteSettings"
import {
  buildQuoteClientPanel,
  buildQuoteDocumentMeta,
  buildQuoteEventPanel,
  buildQuoteTableRows,
  buildQuoteTotalsRows
} from "./cateringQuoteDocumentLayout"
import QuoteLogoImage from "./QuoteLogoImage"
import { calculateQuoteTotals } from "./cateringQuoteTemplates"
import {
  repairCateringCompanySettings,
  repairCateringQuoteItems,
  repairCateringRequest,
  repairSpanishText
} from "./cateringTextEncoding"

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

  const totals = calculateQuoteTotals(safeItems, discountAmount)
  const brand = repairCateringCompanySettings(mergeQuoteSettings(company || {}, branding))
  const meta = buildQuoteDocumentMeta({
    quoteNumber: repairSpanishText(quoteNumber),
    quoteStatus: repairSpanishText(quoteStatus),
    validUntil
  })
  const tableRows = buildQuoteTableRows(safeItems)
  const totalsRows = buildQuoteTotalsRows(totals)
  const clientPanel = buildQuoteClientPanel(safeRequest)
  const eventPanel = buildQuoteEventPanel(safeRequest)
  const footerLines = buildCompanyFooterLines(brand).map(repairSpanishText)

  return (
    <aside className="catering-quote-preview" aria-label="Vista previa de cotización" lang="es">
      <div className={`catering-quote-preview__paper${meta.isDraft ? " is-draft" : ""}`}>
        {meta.isDraft ? (
          <div className="catering-quote-preview__watermark" aria-hidden="true">BORRADOR</div>
        ) : null}

        <div className="catering-quote-preview__accent-bar" aria-hidden="true" />

        <header className="catering-quote-preview__letterhead">
          <div className="catering-quote-preview__brand">
            <QuoteLogoImage
              logoUrl={brand.logoUrl || ""}
              className="catering-quote-preview__logo"
              placeholder={brand.commercialName?.slice(0, 2)?.toUpperCase() || "GA"}
            />
            <div className="catering-quote-preview__brand-text">
              <strong>{brand.commercialName || "Empresa"}</strong>
              <p>{brand.headerText || "Cotización de Catering"}</p>
              {brand.nit ? <small>NIT: {brand.nit}</small> : null}
              {brand.address ? <small>{brand.address}</small> : null}
            </div>
          </div>

          <div className="catering-quote-preview__meta-box">
            <span className="catering-quote-preview__meta-label">Cotización</span>
            <strong className="catering-quote-preview__meta-number">{meta.quoteNumber}</strong>
            <dl>
              <div>
                <dt>Fecha</dt>
                <dd>{meta.issuedLabel}</dd>
              </div>
              <div>
                <dt>Vigencia</dt>
                <dd>{meta.validUntilLabel}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{meta.statusLabel}</dd>
              </div>
            </dl>
          </div>
        </header>

        <div className="catering-quote-preview__panels">
          <section className="catering-quote-preview__panel">
            <h4>Cliente</h4>
            <dl>
              {clientPanel.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="catering-quote-preview__panel">
            <h4>Evento</h4>
            <dl>
              {eventPanel.map(({ label, value }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>

        <section className="catering-quote-preview__table-wrap">
          <h4>Detalle de servicios</h4>
          <table className="catering-quote-preview__table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Cantidad</th>
                <th>P. unit.</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, index) => {
                if (row.kind === "section") {
                  return (
                    <tr key={`section-${index}-${row.title}`} className={`is-section is-section--${row.tone}`}>
                      <td colSpan={4}>{row.title}</td>
                    </tr>
                  )
                }

                return (
                  <tr
                    key={`line-${index}-${row.description}`}
                    className={[
                      row.isOption ? "is-option" : "",
                      row.isSelected ? "is-selected" : ""
                    ].filter(Boolean).join(" ")}
                  >
                    <td>
                      <strong>{row.description || "—"}</strong>
                      {row.subtitle ? <small>{row.subtitle}</small> : null}
                    </td>
                    <td>{row.quantity}</td>
                    <td>{row.unitPrice}</td>
                    <td className="is-amount">{row.total}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <section className="catering-quote-preview__totals-box">
          {totalsRows.map((row) => (
            <div key={row.label} className={row.tone ? `is-${row.tone}` : undefined}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
          {totals.has_unresolved_option_groups ? (
            <small className="catering-quote-preview__option-note">
              El total final depende de la opción de menú seleccionada.
            </small>
          ) : null}
          <small className="catering-quote-preview__vat">Precios incluyen IVA</small>
        </section>

        {safeNotes ? (
          <section className="catering-quote-preview__notes">
            <h4>Notas comerciales</h4>
            <p>{safeNotes}</p>
          </section>
        ) : null}

        {safeTerms ? (
          <section className="catering-quote-preview__terms-block">
            <h4>Términos y condiciones</h4>
            <div className="catering-quote-preview__terms">{safeTerms}</div>
          </section>
        ) : null}

        <section className="catering-quote-preview__signatures">
          <div>
            <span className="catering-quote-preview__sign-line" />
            <small>Firma del cliente</small>
          </div>
          <div>
            <span className="catering-quote-preview__sign-line" />
            <small>Autorizado — {brand.commercialName || "Empresa"}</small>
          </div>
        </section>

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
