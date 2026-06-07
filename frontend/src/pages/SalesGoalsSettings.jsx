import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { currentGoalMonth, listSalesGoals, saveSalesGoal } from "../services/salesGoalsService"
import "./SalesGoalsSettings.css"

const EMPTY_FORM = {
  id: "",
  goal_month: currentGoalMonth().slice(0, 7),
  target_amount: "",
  notes: "",
  status: "active"
}

function SalesGoalsSettings() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const canManage = ["admin", "gerente_general"].includes(user?.role)
  const [form, setForm] = useState(EMPTY_FORM)
  const [goals, setGoals] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const monthLabel = useMemo(() => {
    const date = new Date(`${form.goal_month}-01T00:00:00`)
    return Number.isNaN(date.getTime()) ? "Meta mensual" : date.toLocaleDateString("es-GT", { month: "long", year: "numeric" })
  }, [form.goal_month])

  useEffect(() => {
    refreshGoals()
  }, [])

  async function refreshGoals() {
    setLoading(true)
    const result = await listSalesGoals()
    setGoals(result.data || [])
    setError(result.error || "")
    setLoading(false)
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function editGoal(goal) {
    setForm({
      id: goal.id,
      goal_month: String(goal.goal_month || "").slice(0, 7),
      target_amount: goal.target_amount ?? "",
      notes: goal.description || "",
      status: goal.status || "active"
    })
    setMessage("")
    setError("")
  }

  async function submit(event) {
    event.preventDefault()
    setMessage("")
    setError("")
    if (!canManage) {
      setError("Solo Admin o Gerente General pueden gestionar metas.")
      return
    }
    if (!form.goal_month || Number(form.target_amount) <= 0) {
      setError("Selecciona mes y un monto objetivo mayor que cero.")
      return
    }

    setSaving(true)
    const result = await saveSalesGoal({
      ...form,
      goal_month: `${form.goal_month}-01`,
      target_amount: Number(form.target_amount)
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setMessage("Meta guardada correctamente.")
    setForm(EMPTY_FORM)
    await refreshGoals()
  }

  if (!canManage) {
    return (
      <section className="sales-goals-settings">
        <button type="button" className="ghost" onClick={() => navigate("/reports")}>Volver</button>
        <article className="sales-goals-panel">
          <h1>Metas de ventas</h1>
          <p>No tienes permiso para configurar metas.</p>
        </article>
      </section>
    )
  }

  return (
    <section className="sales-goals-settings">
      <header className="sales-goals-header">
        <div>
          <p>Reportes</p>
          <h1>Metas de ventas</h1>
          <span>Configura el objetivo mensual que alimenta el dashboard motivacional.</span>
        </div>
        <button type="button" className="ghost" onClick={() => navigate("/reports")}>Volver a reportes</button>
      </header>

      <div className="sales-goals-layout">
        <form className="sales-goals-panel" onSubmit={submit}>
          <h2>{form.id ? "Editar meta" : "Nueva meta"}</h2>
          <label>
            Mes
            <input type="month" value={form.goal_month} onChange={(event) => updateField("goal_month", event.target.value)} />
          </label>
          <label>
            Monto objetivo
            <input type="number" min="0" step="0.01" value={form.target_amount} onChange={(event) => updateField("target_amount", event.target.value)} placeholder="Q0.00" />
          </label>
          <label>
            Estado
            <select value={form.status} onChange={(event) => updateField("status", event.target.value)}>
              <option value="active">Activa</option>
              <option value="inactive">Inactiva</option>
            </select>
          </label>
          <label>
            Nota
            <textarea value={form.notes} onChange={(event) => updateField("notes", event.target.value)} rows={3} placeholder="Mensaje interno para gerencia" />
          </label>
          {message && <p className="success">{message}</p>}
          {error && <p className="error">{error}</p>}
          <div className="sales-goals-actions">
            <button type="submit" disabled={saving}>{saving ? "Guardando..." : `Guardar ${monthLabel}`}</button>
            {form.id && <button type="button" className="ghost" onClick={() => setForm(EMPTY_FORM)}>Cancelar</button>}
          </div>
        </form>

        <article className="sales-goals-panel">
          <h2>Metas existentes</h2>
          {loading ? <p>Cargando metas...</p> : null}
          {!loading && !goals.length ? <p>No hay metas configuradas.</p> : null}
          <div className="sales-goals-list">
            {goals.map((goal) => (
              <button type="button" key={goal.id} onClick={() => editGoal(goal)}>
                <span>{String(goal.goal_month || "").slice(0, 7)}</span>
                <strong>Q{Number(goal.target_amount || 0).toFixed(2)}</strong>
                <em>{goal.status === "active" ? "Activa" : "Inactiva"}</em>
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}

export default SalesGoalsSettings
