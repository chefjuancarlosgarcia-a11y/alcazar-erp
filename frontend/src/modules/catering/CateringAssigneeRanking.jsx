export default function CateringAssigneeRanking({ ranking, loading }) {
  const rows = ranking?.rows || []

  if (loading) {
    return (
      <section className="catering-panel">
        <h2>Ranking comercial</h2>
        <p className="catering-empty">Cargando ranking...</p>
      </section>
    )
  }

  if (!rows.length) {
    return (
      <section className="catering-panel">
        <h2>Ranking comercial</h2>
        <p className="catering-empty">Sin asignaciones en el periodo seleccionado.</p>
      </section>
    )
  }

  return (
    <section className="catering-panel">
      <h2>Ranking comercial</h2>
      <div className="catering-table-wrap">
        <table className="catering-table">
          <thead>
            <tr>
              <th>Responsable</th>
              <th>Leads activos</th>
              <th>Leads cerrados</th>
              <th>Conversion %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.assignee_id}>
                <td>{row.assignee_name}</td>
                <td>{row.active_leads ?? 0}</td>
                <td>{row.closed_leads ?? 0}</td>
                <td>{Number(row.conversion_rate || 0).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
