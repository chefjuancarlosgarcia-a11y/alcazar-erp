import { formatMoney, leadSourceLabel } from "./cateringUtils"

export default function CateringLeadsBySource({ rows, loading }) {
  const items = Array.isArray(rows) ? rows : []

  if (loading) {
    return (
      <section className="catering-panel">
        <h2>Leads por origen</h2>
        <p className="catering-empty">Cargando origenes...</p>
      </section>
    )
  }

  const hasLeads = items.some((row) => Number(row.lead_count || 0) > 0)

  return (
    <section className="catering-panel">
      <h2>Leads por origen</h2>
      {!hasLeads ? (
        <p className="catering-empty">Sin leads en el periodo seleccionado.</p>
      ) : (
        <div className="catering-table-wrap">
          <table className="catering-table catering-table--compact">
            <thead>
              <tr>
                <th>Origen</th>
                <th>Leads</th>
                <th>Valor potencial</th>
                <th>Aprobados</th>
                <th>Valor aprobado</th>
              </tr>
            </thead>
            <tbody>
              {items
                .filter((row) => Number(row.lead_count || 0) > 0)
                .map((row) => (
                  <tr key={row.lead_source}>
                    <td>{leadSourceLabel(row.lead_source)}</td>
                    <td>{row.lead_count ?? 0}</td>
                    <td>{formatMoney(row.potential_value)}</td>
                    <td>{row.approved_count ?? 0}</td>
                    <td>{formatMoney(row.approved_value)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
