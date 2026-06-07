import { useEffect, useState } from "react"
import { getPublicMonthlyGoalProgress } from "../services/salesGoalsService"
import "./GoalWidgets.css"

function GoalEnergyWidget() {
  const [state, setState] = useState({ loading: true, error: "", data: null })

  useEffect(() => {
    let mounted = true
    getPublicMonthlyGoalProgress().then((result) => {
      if (!mounted) return
      setState({ loading: false, error: result.error, data: result.data })
    }).catch((error) => {
      if (!mounted) return
      setState({ loading: false, error: error?.message || "No fue posible cargar la meta.", data: null })
    })
    return () => { mounted = false }
  }, [])

  if (state.loading) return <article className="goal-widget"><span>Cargando meta...</span></article>
  if (state.error) return <article className="goal-widget muted"><strong>Meta mensual</strong><span>{state.error}</span></article>

  const progress = Math.max(0, Math.min(100, Number(state.data?.progress_percent || 0)))
  const label = state.data?.status_label || "Meta mensual"

  return (
    <article className="goal-widget">
      <div className="goal-widget-header">
        <span>Meta del mes</span>
        <strong>{progress.toFixed(0)}%</strong>
      </div>
      <div className="goal-progress" aria-label={`Progreso ${progress.toFixed(0)}%`}>
        <i style={{ width: `${progress}%` }} />
      </div>
      <p>{label}</p>
      <small>{Number(state.data?.days_remaining || 0)} dias restantes</small>
    </article>
  )
}

export default GoalEnergyWidget
