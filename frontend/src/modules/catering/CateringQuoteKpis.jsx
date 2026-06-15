import { formatMoney } from "./cateringUtils"
import { quoteStatusClass } from "./cateringQuoteTemplates"

export default function CateringQuoteKpis({ summary, loading }) {
  const placeholder = loading ? "…" : "0"

  return (
    <section className="catering-kpi-grid catering-kpi-grid--quotes">
      <article className="catering-kpi-card">
        <span>Cotizaciones creadas</span>
        <strong>{summary?.quotes_created ?? placeholder}</strong>
      </article>
      <article className="catering-kpi-card catering-kpi-card--blue">
        <span>Cotizaciones enviadas</span>
        <strong>{summary?.quotes_sent ?? placeholder}</strong>
      </article>
      <article className="catering-kpi-card catering-kpi-card--green">
        <span>Cotizaciones aprobadas</span>
        <strong>{summary?.quotes_approved ?? placeholder}</strong>
      </article>
      <article className="catering-kpi-card">
        <span>Monto cotizado</span>
        <strong>{loading ? placeholder : formatMoney(summary?.quoted_amount ?? 0)}</strong>
      </article>
      <article className="catering-kpi-card catering-kpi-card--green">
        <span>Monto aprobado</span>
        <strong>{loading ? placeholder : formatMoney(summary?.approved_quote_amount ?? 0)}</strong>
      </article>
    </section>
  )
}

export function CateringQuoteStatusBadge({ status, label }) {
  return (
    <span className={quoteStatusClass(status)}>
      {label || status || "—"}
    </span>
  )
}
