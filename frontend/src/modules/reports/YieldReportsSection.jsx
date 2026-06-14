import { useEffect, useState } from "react"
import { getYieldDashboardMetrics } from "../../services/yieldCostingService"
import "../../pages/YieldCosting.css"

function formatMoney(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

export default function YieldReportsSection({ filters = {}, data: externalData = null }) {
  const [data, setData] = useState(externalData)
  const [loading, setLoading] = useState(!externalData)
  const [error, setError] = useState("")

  useEffect(() => {
    if (externalData) {
      setData(externalData)
      setLoading(false)
      return undefined
    }
    let mounted = true
    async function load() {
      setLoading(true)
      const result = await getYieldDashboardMetrics(filters)
      if (!mounted) return
      if (result.error) setError(result.error.message || "No se pudo cargar el dashboard de rendimientos.")
      else {
        setData(result.data)
        setError("")
      }
      setLoading(false)
    }
    load()
    return () => { mounted = false }
  }, [externalData, filters.start, filters.end, filters.preset])

  if (loading) return <div className="reports-loading">Cargando rendimientos...</div>
  if (error) return <p className="yield-toast yield-toast--error">{error}</p>
  if (!data) return <p className="yield-empty">Sin datos de rendimientos.</p>

  return (
    <div className="yield-page" style={{ padding: 0 }}>
      <div className="yield-metrics">
        <div className="yield-metric"><span>Merma financiera</span><strong>{formatMoney(data.summary.financialImpact)}</strong></div>
        <div className="yield-metric"><span>Auditorías</span><strong>{data.summary.totalAudits}</strong></div>
        <div className="yield-metric"><span>Rendimiento promedio</span><strong>{Number(data.summary.averageYield || 0).toFixed(1)}%</strong></div>
        <div className="yield-metric"><span>Bajo mínimo</span><strong>{data.summary.belowMinimumCount}</strong></div>
        <div className="yield-metric"><span>Campañas activas</span><strong>{data.summary.activeCampaigns}</strong></div>
      </div>

      <div className="yield-layout" style={{ marginTop: 18 }}>
        <section className="yield-panel">
          <h2>Top productos con pérdidas</h2>
          {!data.topLossItems.length && <p className="yield-empty">Sin pérdidas registradas en el periodo.</p>}
          <div className="yield-table-wrap">
            <table className="yield-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Auditorías</th>
                  <th>Promedio</th>
                  <th>Impacto Q</th>
                </tr>
              </thead>
              <tbody>
                {data.topLossItems.map((row) => (
                  <tr key={row.itemId}>
                    <td>{row.itemName}</td>
                    <td>{row.audits}</td>
                    <td>{Number(row.avgYield || 0).toFixed(1)}%</td>
                    <td>{formatMoney(row.financialLoss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="yield-panel">
          <h2>Scorecard colaboradores</h2>
          {!data.employeeScorecard.length && <p className="yield-empty">Sin auditorías por colaborador.</p>}
          <div className="yield-table-wrap">
            <table className="yield-table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Auditorías</th>
                  <th>Promedio</th>
                  <th>Desviación</th>
                  <th>Puntaje</th>
                </tr>
              </thead>
              <tbody>
                {data.employeeScorecard.map((row) => (
                  <tr key={row.employeeId}>
                    <td>{row.employeeName}</td>
                    <td>{row.audits}</td>
                    <td>{Number(row.avgYield || 0).toFixed(1)}%</td>
                    <td>{Number(row.avgVariance || 0).toFixed(1)}%</td>
                    <td>{row.score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {data.alerts.length > 0 && (
        <section className="yield-panel" style={{ marginTop: 18 }}>
          <h2>Alertas activas</h2>
          <div className="yield-grid">
            {data.alerts.map((alert) => (
              <article key={alert.auditId} className="yield-card">
                <strong>Rendimiento bajo mínimo</strong>
                <p>{alert.message}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
