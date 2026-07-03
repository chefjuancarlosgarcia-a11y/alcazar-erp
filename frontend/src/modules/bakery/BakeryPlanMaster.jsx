import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { getActiveAreas } from "../../services/areasService"
import { getActiveInventoryItems } from "../../services/inventoryService"
import { getActiveRecipes } from "../../services/recipesService"
import { getTaskAssignableProfiles } from "../../services/tasksService"
import {
  canManageBakeryPlans,
  BAKERY_PLAN_STATUSES,
  BAKERY_PRIORITIES
} from "./bakeryPermissions"
import {
  createBakeryPlanItem,
  listBakeryPlanItems,
  startBakeryProductionFromPlan,
  updateBakeryPlanItem
} from "./bakeryService"

function weekRange(dateStr) {
  const date = new Date(`${dateStr}T12:00:00`)
  const day = date.getDay()
  const start = new Date(date)
  start.setDate(date.getDate() - day)
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  }
}

const EMPTY_FORM = {
  inventory_item_id: "",
  product_name: "",
  planned_quantity: "",
  unit: "Unidad",
  required_date: new Date().toISOString().slice(0, 10),
  destination_area_id: "",
  priority: "normal",
  notes: "",
  assigned_to: "",
  status: "planned"
}

export default function BakeryPlanMaster({ onBatchStarted }) {
  const { user } = useAuth()
  const canManage = canManageBakeryPlans(user?.role)
  const [viewMode, setViewMode] = useState("daily")
  const [anchorDate, setAnchorDate] = useState(new Date().toISOString().slice(0, 10))
  const [statusFilter, setStatusFilter] = useState("")
  const [assignedFilter, setAssignedFilter] = useState("")
  const [areaFilter, setAreaFilter] = useState("")
  const [items, setItems] = useState([])
  const [areas, setAreas] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  const dateRange = useMemo(() => {
    if (viewMode === "weekly") return weekRange(anchorDate)
    return { from: anchorDate, to: anchorDate }
  }, [anchorDate, viewMode])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    const [planResult, areasResult, itemsResult, profilesResult] = await Promise.all([
      listBakeryPlanItems({
        fromDate: dateRange.from,
        toDate: dateRange.to,
        status: statusFilter || undefined,
        assignedTo: assignedFilter || undefined,
        destinationAreaId: areaFilter || undefined
      }),
      getActiveAreas(),
      getActiveInventoryItems(),
      getTaskAssignableProfiles()
    ])
    if (planResult.error) setError(planResult.error.message)
    else setItems(planResult.data || [])
    setAreas(areasResult.data || [])
    setInventoryItems(itemsResult.data || [])
    setProfiles(profilesResult.data || [])
    setLoading(false)
  }, [areaFilter, assignedFilter, dateRange.from, dateRange.to, statusFilter])

  useEffect(() => {
    load()
  }, [load])

  function statusLabel(value) {
    return BAKERY_PLAN_STATUSES.find((entry) => entry.value === value)?.label || value
  }

  function priorityLabel(value) {
    return BAKERY_PRIORITIES.find((entry) => entry.value === value)?.label || value
  }

  function profileName(id) {
    const profile = profiles.find((entry) => entry.id === id)
    return profile?.full_name || profile?.username || "—"
  }

  function areaName(id) {
    return areas.find((entry) => entry.id === id)?.name || id || "—"
  }

  function selectInventoryItem(itemId) {
    const item = inventoryItems.find((entry) => entry.id === itemId)
    setForm((current) => ({
      ...current,
      inventory_item_id: itemId,
      product_name: item?.name || current.product_name,
      unit: item?.base_unit || current.unit || "Unidad"
    }))
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!canManage) return
    if (!form.product_name.trim()) {
      setError("Indica el producto.")
      return
    }
    if (Number(form.planned_quantity) <= 0) {
      setError("La cantidad planificada debe ser mayor que cero.")
      return
    }

    setSaving(true)
    setError("")
    const { error: saveError } = await createBakeryPlanItem({
      inventory_item_id: form.inventory_item_id || null,
      product_name: form.product_name.trim(),
      planned_quantity: Number(form.planned_quantity),
      unit: form.unit || "Unidad",
      required_date: form.required_date,
      destination_area_id: form.destination_area_id || null,
      priority: form.priority,
      notes: form.notes || null,
      requested_by: user?.id,
      assigned_to: form.assigned_to || null,
      status: "planned"
    })
    setSaving(false)
    if (saveError) {
      setError(saveError.message)
      return
    }
    setMessage("Plan de producción creado.")
    setShowForm(false)
    setForm(EMPTY_FORM)
    load()
  }

  async function handleStartProduction(planItem) {
    setSaving(true)
    setError("")
    const { data, error: startError } = await startBakeryProductionFromPlan(planItem.id)
    setSaving(false)
    if (startError) {
      setError(startError.message)
      return
    }
    setMessage(`Lote ${data.batch_code} creado.`)
    onBatchStarted?.(data)
    load()
  }

  async function handleCancel(planItem) {
    if (!canManage) return
    setSaving(true)
    const { error: cancelError } = await updateBakeryPlanItem(planItem.id, { status: "cancelled" })
    setSaving(false)
    if (cancelError) setError(cancelError.message)
    else load()
  }

  return (
    <div className="bakery-card">
      <div className="bakery-toolbar" style={{ justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className={`bakery-btn secondary ${viewMode === "daily" ? "active" : ""}`} onClick={() => setViewMode("daily")}>Vista diaria</button>
          <button type="button" className={`bakery-btn secondary ${viewMode === "weekly" ? "active" : ""}`} onClick={() => setViewMode("weekly")}>Vista semanal</button>
        </div>
        {canManage && (
          <button type="button" className="bakery-btn" onClick={() => setShowForm(true)}>Crear producción planificada</button>
        )}
      </div>

      <div className="bakery-toolbar">
        <label>
          Fecha {viewMode === "weekly" ? "de la semana" : ""}
          <input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} />
        </label>
        <label>
          Estado
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos</option>
            {BAKERY_PLAN_STATUSES.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
        </label>
        <label>
          Responsable
          <select value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}>
            <option value="">Todos</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
            ))}
          </select>
        </label>
        <label>
          Área destino
          <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
            <option value="">Todas</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>{area.name}</option>
            ))}
          </select>
        </label>
      </div>

      {message && <div className="bakery-success">{message}</div>}
      {error && <div className="bakery-error">{error}</div>}

      {loading ? (
        <p>Cargando plan...</p>
      ) : (
        <div className="bakery-table-wrap">
          <table className="bakery-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Prioridad</th>
                <th>Destino</th>
                <th>Responsable</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td colSpan={8}>No hay ítems en este rango.</td></tr>
              )}
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.required_date}</td>
                  <td>{item.product_name}</td>
                  <td>{item.planned_quantity} {item.unit}</td>
                  <td><span className={`bakery-badge ${item.priority === "urgent" ? "urgent" : ""}`}>{priorityLabel(item.priority)}</span></td>
                  <td>{areaName(item.destination_area_id)}</td>
                  <td>{profileName(item.assigned_to)}</td>
                  <td><span className={`bakery-badge ${item.status}`}>{statusLabel(item.status)}</span></td>
                  <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["planned", "partial"].includes(item.status) && (
                      <button type="button" className="bakery-btn" disabled={saving} onClick={() => handleStartProduction(item)}>
                        Realizar producción
                      </button>
                    )}
                    {canManage && item.status === "planned" && (
                      <button type="button" className="bakery-btn secondary" disabled={saving} onClick={() => handleCancel(item)}>
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="bakery-modal-backdrop">
          <form className="bakery-modal" onSubmit={handleCreate}>
            <h3>Crear producción planificada</h3>
            <div className="bakery-form-grid">
              <label>
                Producto del inventario
                <select value={form.inventory_item_id} onChange={(event) => selectInventoryItem(event.target.value)}>
                  <option value="">Manual / otro</option>
                  {inventoryItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Nombre producto *
                <input value={form.product_name} onChange={(event) => setForm((c) => ({ ...c, product_name: event.target.value }))} required />
              </label>
              <label>
                Cantidad *
                <input type="number" min="0.01" step="0.01" value={form.planned_quantity} onChange={(event) => setForm((c) => ({ ...c, planned_quantity: event.target.value }))} required />
              </label>
              <label>
                Unidad
                <input value={form.unit} onChange={(event) => setForm((c) => ({ ...c, unit: event.target.value }))} />
              </label>
              <label>
                Fecha requerida *
                <input type="date" value={form.required_date} onChange={(event) => setForm((c) => ({ ...c, required_date: event.target.value }))} required />
              </label>
              <label>
                Área destino
                <select value={form.destination_area_id} onChange={(event) => setForm((c) => ({ ...c, destination_area_id: event.target.value }))}>
                  <option value="">—</option>
                  {areas.map((area) => (
                    <option key={area.id} value={area.id}>{area.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Prioridad
                <select value={form.priority} onChange={(event) => setForm((c) => ({ ...c, priority: event.target.value }))}>
                  {BAKERY_PRIORITIES.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Asignar a
                <select value={form.assigned_to} onChange={(event) => setForm((c) => ({ ...c, assigned_to: event.target.value }))}>
                  <option value="">—</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.full_name || profile.username}</option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Notas
              <textarea rows={3} value={form.notes} onChange={(event) => setForm((c) => ({ ...c, notes: event.target.value }))} />
            </label>
            <div className="bakery-modal-actions">
              <button type="button" className="bakery-btn secondary" onClick={() => setShowForm(false)}>Cancelar</button>
              <button type="submit" className="bakery-btn" disabled={saving}>Guardar plan</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
