import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import { getActiveRecipes } from "../../services/recipesService"
import { BAKERY_DOUGH_STATUSES, COLD_ROOM_ALERT_HOURS } from "./bakeryPermissions"
import {
  createBakeryDoughBatch,
  listBakeryDoughBatches,
  updateBakeryDoughStatus
} from "./bakeryService"

const EMPTY_FORM = {
  dough_type: "",
  recipe_id: "",
  quantity_units: "",
  unit_weight: "",
  total_weight: "",
  notes: ""
}

function hoursSince(value) {
  if (!value) return null
  return Math.round((Date.now() - new Date(value).getTime()) / 3600000)
}

export default function BakeryDoughPanel() {
  const { user } = useAuth()
  const [rows, setRows] = useState([])
  const [recipes, setRecipes] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const load = useCallback(async () => {
    setLoading(true)
    const [doughResult, recipesResult] = await Promise.all([
      listBakeryDoughBatches(),
      getActiveRecipes()
    ])
    if (doughResult.error) setError(doughResult.error.message)
    else setRows(doughResult.data || [])
    setRecipes((recipesResult.data || []).filter((recipe) => recipe.production_area_id === "panaderia"))
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleCreate(event) {
    event.preventDefault()
    if (!form.dough_type.trim()) {
      setError("Indica el tipo de masa.")
      return
    }
    setSaving(true)
    const { error: createError } = await createBakeryDoughBatch({
      dough_type: form.dough_type.trim(),
      recipe_id: form.recipe_id || null,
      quantity_units: Number(form.quantity_units),
      unit_weight: form.unit_weight === "" ? null : Number(form.unit_weight),
      total_weight: form.total_weight === "" ? null : Number(form.total_weight),
      responsible_user_id: user?.id,
      notes: form.notes || null
    })
    setSaving(false)
    if (createError) setError(createError.message)
    else {
      setMessage("Lote de masa creado.")
      setShowForm(false)
      setForm(EMPTY_FORM)
      load()
    }
  }

  async function moveStatus(row, status) {
    setSaving(true)
    const { error: updateError } = await updateBakeryDoughStatus(row.id, status)
    setSaving(false)
    if (updateError) setError(updateError.message)
    else load()
  }

  function statusLabel(value) {
    return BAKERY_DOUGH_STATUSES.find((entry) => entry.value === value)?.label || value
  }

  return (
    <div className="bakery-module">
      <div className="bakery-card">
        <div className="bakery-toolbar" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Gestión de masas</h3>
          <button type="button" className="bakery-btn" onClick={() => setShowForm(true)}>Crear lote de masa</button>
        </div>
        {message && <div className="bakery-success">{message}</div>}
        {error && <div className="bakery-error">{error}</div>}
        {loading ? (
          <p>Cargando masas...</p>
        ) : (
          <div className="bakery-list">
            {rows.map((row) => {
              const coldHours = row.status === "cold_room" ? hoursSince(row.cold_room_started_at) : null
              const alert = coldHours != null && coldHours >= COLD_ROOM_ALERT_HOURS
              return (
                <div key={row.id} className={`bakery-list-item ${alert ? "cold-alert" : ""}`}>
                  <div>
                    <strong>{row.batch_code}</strong>
                    <div>{row.dough_type} · {row.quantity_units} u · {statusLabel(row.status)}</div>
                    {row.cold_room_started_at && (
                      <div>{coldHours} h en cuarto frío</div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {row.status === "mixed" && (
                      <button type="button" className="bakery-btn secondary" disabled={saving} onClick={() => moveStatus(row, "cold_room")}>Mover a cuarto frío</button>
                    )}
                    {["cold_room", "resting", "balled"].includes(row.status) && (
                      <button type="button" className="bakery-btn secondary" disabled={saving} onClick={() => moveStatus(row, "ready")}>Marcar lista</button>
                    )}
                    {row.status === "ready" && (
                      <button type="button" className="bakery-btn secondary" disabled={saving} onClick={() => moveStatus(row, "used")}>Marcar usada</button>
                    )}
                    {!["used", "discarded"].includes(row.status) && (
                      <button type="button" className="bakery-btn secondary" disabled={saving} onClick={() => moveStatus(row, "discarded")}>Descartar</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <div className="bakery-modal-backdrop">
          <form className="bakery-modal" onSubmit={handleCreate}>
            <h3>Nuevo lote de masa</h3>
            <div className="bakery-form-grid">
              <label>
                Tipo de masa *
                <input value={form.dough_type} onChange={(e) => setForm((c) => ({ ...c, dough_type: e.target.value }))} placeholder="PIZZA, CAMPESINO..." required />
              </label>
              <label>
                Receta
                <select value={form.recipe_id} onChange={(e) => setForm((c) => ({ ...c, recipe_id: e.target.value }))}>
                  <option value="">—</option>
                  {recipes.map((recipe) => (
                    <option key={recipe.id} value={recipe.id}>{recipe.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Unidades *
                <input type="number" min="0.01" step="0.01" required value={form.quantity_units} onChange={(e) => setForm((c) => ({ ...c, quantity_units: e.target.value }))} />
              </label>
              <label>
                Peso unitario (g)
                <input type="number" min="0" step="0.01" value={form.unit_weight} onChange={(e) => setForm((c) => ({ ...c, unit_weight: e.target.value }))} />
              </label>
              <label>
                Peso total (g)
                <input type="number" min="0" step="0.01" value={form.total_weight} onChange={(e) => setForm((c) => ({ ...c, total_weight: e.target.value }))} />
              </label>
            </div>
            <label>
              Notas
              <textarea rows={2} value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} />
            </label>
            <div className="bakery-modal-actions">
              <button type="button" className="bakery-btn secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button type="submit" className="bakery-btn" disabled={saving}>Crear masa</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
