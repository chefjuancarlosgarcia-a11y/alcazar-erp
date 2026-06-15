import { formatDate, formatDateTime, formatMoney } from "./cateringUtils"
import { QUOTE_STATUS_LABELS } from "./cateringQuoteTemplates"
import { CateringQuoteStatusBadge } from "./CateringQuoteKpis"

export default function CateringRequestQuotes({
  summary,
  quotes,
  loading,
  onCreateQuote,
  onOpenQuote
}) {
  const latest = summary?.latest

  return (
    <section className="catering-detail-section">
      <div className="catering-quote-section-head">
        <h4>Cotizaciones</h4>
        <button type="button" className="primary" onClick={onCreateQuote}>
          Crear cotizacion
        </button>
      </div>

      {loading ? (
        <p className="catering-empty">Cargando cotizaciones...</p>
      ) : (
        <>
          <dl className="catering-detail-list catering-quote-summary">
            <div><dt>Cantidad</dt><dd>{summary?.count ?? quotes.length ?? 0}</dd></div>
            <div>
              <dt>Ultima cotizacion</dt>
              <dd>{latest?.quote_number || "—"}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>
                {latest?.status ? (
                  <CateringQuoteStatusBadge
                    status={latest.status}
                    label={QUOTE_STATUS_LABELS[latest.status] || latest.status}
                  />
                ) : "—"}
              </dd>
            </div>
            <div><dt>Monto</dt><dd>{formatMoney(latest?.total)}</dd></div>
          </dl>

          {!quotes.length ? (
            <p className="catering-empty">Aun no hay cotizaciones para esta solicitud.</p>
          ) : (
            <div className="catering-table-wrap">
              <table className="catering-table catering-quote-table">
                <thead>
                  <tr>
                    <th>Numero</th>
                    <th>Estado</th>
                    <th>Total</th>
                    <th>Vigencia</th>
                    <th>Creada</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id}>
                      <td><strong>{quote.quote_number}</strong></td>
                      <td>
                        <CateringQuoteStatusBadge
                          status={quote.status}
                          label={quote.status_label || quote.status}
                        />
                      </td>
                      <td>{formatMoney(quote.total)}</td>
                      <td>{formatDate(quote.valid_until)}</td>
                      <td>{formatDateTime(quote.created_at)}</td>
                      <td>
                        <button type="button" className="ghost" onClick={() => onOpenQuote?.(quote.id)}>
                          Abrir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
