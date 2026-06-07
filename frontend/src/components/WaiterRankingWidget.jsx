import { useEffect, useState } from "react"
import { getWaiterSalesRanking } from "../services/salesGoalsService"
import "./GoalWidgets.css"

function WaiterRankingWidget() {
  const [state, setState] = useState({ loading: true, error: "", rows: [] })

  useEffect(() => {
    let mounted = true
    getWaiterSalesRanking(undefined, true).then((result) => {
      if (!mounted) return
      setState({ loading: false, error: result.error, rows: result.data || [] })
    }).catch((error) => {
      if (!mounted) return
      setState({ loading: false, error: error?.message || "No fue posible cargar el ranking.", rows: [] })
    })
    return () => { mounted = false }
  }, [])

  if (state.loading) return <article className="goal-widget"><span>Cargando ranking...</span></article>
  if (state.error) return <article className="goal-widget muted"><strong>Ranking del mes</strong><span>{state.error}</span></article>

  const rows = state.rows.slice(0, 5)

  return (
    <article className="goal-widget">
      <div className="goal-widget-header">
        <span>Ranking del mes</span>
        <strong>Top {rows.length || 0}</strong>
      </div>
      {!rows.length ? (
        <p>Aun no hay ventas pagadas este mes.</p>
      ) : (
        <ol className="goal-ranking-list">
          {rows.map((row) => (
            <li key={row.profile_id || row.rank_position}>
              <span>#{row.rank_position}</span>
              <strong>{row.display_name || row.full_name || "Colaborador"}</strong>
              <small>{Number(row.order_count || 0)} ordenes</small>
            </li>
          ))}
        </ol>
      )}
    </article>
  )
}

export default WaiterRankingWidget
