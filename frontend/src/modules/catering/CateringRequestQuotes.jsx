import { useState } from "react"
import { useBrandingContext } from "../../context/BrandingProvider"
import { formatDate, formatDateTime, formatMoney } from "./cateringUtils"
import { QUOTE_STATUS_LABELS } from "./cateringQuoteTemplates"
import { CateringQuoteStatusBadge } from "./CateringQuoteKpis"
import {
  canDownloadQuotePdf,
  getQuoteDownloadLabel
} from "./cateringQuoteHistoryUtils"
import { downloadCateringQuotePdfById } from "./cateringQuoteDownload"

export default function CateringRequestQuotes({
  summary,
  quotes,
  loading,
  error = "",
  request,
  onCreateQuote,
  onOpenQuote,
  onRetry
}) {
  const branding = useBrandingContext()
  const [downloadingId, setDownloadingId] = useState("")
  const [downloadError, setDownloadError] = useState("")
  const items = Array.isArray(quotes) ? quotes : []
  const latest = summary?.latest
  const count = summary?.count ?? items.length

  async function handleDownload(quote) {
    if (!quote?.id) return
    setDownloadingId(quote.id)
    setDownloadError("")
    const result = await downloadCateringQuotePdfById({
      quoteId: quote.id,
      request,
      branding
    })
    setDownloadingId("")
    if (!result.ok) {
      setDownloadError(result.error || "No fue posible descargar el PDF.")
    }
  }

  return (
    <section className="catering-detail-section catering-quote-history">
      <div className="catering-quote-section-head">
        <div>
          <h4>Cotizaciones</h4>
          {count > 0 ? (
            <p className="catering-quote-history__meta">
              {count} registrada{count === 1 ? "" : "s"}
              {latest?.quote_number ? ` · última ${latest.quote_number}` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" className="primary" onClick={onCreateQuote}>
          Crear otra cotización
        </button>
      </div>

      {loading ? (
        <p className="catering-empty">Cargando cotizaciones...</p>
      ) : null}

      {!loading && error ? (
        <div className="catering-quote-history__error" role="alert">
          <p className="catering-message error">{error}</p>
          {onRetry ? (
            <button type="button" className="ghost" onClick={onRetry}>
              Reintentar
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && !error && !items.length ? (
        <p className="catering-empty">Aún no hay cotizaciones para esta solicitud.</p>
      ) : null}

      {!loading && !error && items.length ? (
        <div className="erp-card-grid catering-quote-card-grid">
          {items.map((quote) => {
            const statusLabel = quote.status_label
              || QUOTE_STATUS_LABELS[quote.status]
              || quote.status
            const isDownloading = downloadingId === quote.id

            return (
              <article key={quote.id} className="erp-card catering-quote-card">
                <header className="catering-quote-card__head">
                  <div>
                    <strong>{quote.quote_number}</strong>
                    <span>{formatDateTime(quote.created_at)}</span>
                  </div>
                  <CateringQuoteStatusBadge status={quote.status} label={statusLabel} />
                </header>

                <dl className="catering-quote-card__meta">
                  <div>
                    <dt>Total</dt>
                    <dd>{formatMoney(quote.total)}</dd>
                  </div>
                  <div>
                    <dt>Vigencia</dt>
                    <dd>{formatDate(quote.valid_until)}</dd>
                  </div>
                </dl>

                <div className="catering-quote-card__actions">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onOpenQuote?.(quote.id)}
                  >
                    Abrir
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={isDownloading}
                    onClick={() => handleDownload(quote)}
                  >
                    {isDownloading ? "Descargando..." : getQuoteDownloadLabel(quote.status)}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      ) : null}

      {downloadError ? (
        <p className="catering-message error">{downloadError}</p>
      ) : null}

      {!loading && !error && items.some((quote) => canDownloadQuotePdf(quote.status)) ? (
        <p className="catering-quote-history__hint">
          Las cotizaciones emitidas se descargan sin marca BORRADOR.
        </p>
      ) : null}
    </section>
  )
}
