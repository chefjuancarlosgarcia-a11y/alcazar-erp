import { formatMinutes, formatMoney } from "./cateringUtils"

function KpiCard({ label, value, tone = "" }) {
  return (
    <article className={`catering-kpi-card ${tone ? `catering-kpi-card--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  )
}

export default function CateringCommercialKpis({ summary, loading }) {
  const placeholder = loading ? "…" : "0"

  return (
    <>
      <section className="catering-kpi-grid catering-kpi-grid--crm">
        <KpiCard label="Nuevos hoy" tone="blue" value={summary?.new_leads_today ?? placeholder} />
        <KpiCard label="Contactados" tone="yellow" value={summary?.contacted_leads ?? placeholder} />
        <KpiCard label="Cotizando" tone="orange" value={summary?.quoted_leads ?? placeholder} />
        <KpiCard label="En negociacion" tone="purple" value={summary?.negotiating_leads ?? placeholder} />
        <KpiCard label="Aprobados" tone="green" value={summary?.approved_leads ?? placeholder} />
        <KpiCard label="Perdidos" tone="red" value={summary?.lost_leads ?? placeholder} />
      </section>

      <section className="catering-kpi-grid catering-kpi-grid--values">
        <KpiCard label="Conversion %" value={summary ? `${Number(summary.conversion_rate || 0).toFixed(1)}%` : placeholder} />
        <KpiCard label="Pipeline bruto" value={formatMoney(summary?.gross_pipeline_value ?? summary?.total_potential_value)} />
        <KpiCard label="Pipeline ponderado" value={formatMoney(summary?.weighted_pipeline_value)} />
        <KpiCard label="Valor aprobado" tone="green" value={formatMoney(summary?.approved_total_value)} />
        <KpiCard
          label="Promedio respuesta"
          value={summary?.avg_response_time_minutes != null ? formatMinutes(summary.avg_response_time_minutes) : placeholder}
        />
      </section>
    </>
  )
}
