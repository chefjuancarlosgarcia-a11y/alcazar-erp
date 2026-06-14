import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import {
  getActiveCampaignRequiredItems,
  getWasteReasons,
  submitYieldAudit
} from "../../services/yieldCostingService"
import "../../pages/YieldCosting.css"

const EMPTY_FORM = {
  inventoryItemId: "",
  campaignId: "",
  initialWeight: "",
  usableWeight: "",
  wasteReasonId: "",
  notes: "",
  taskId: ""
}

export default function YieldAuditFormPanel({ taskId = "", requiredItemIds = [], onSaved, compact = false }) {
  const { user } = useAuth()
  const [campaignItems, setCampaignItems] = useState([])
  const [reasons, setReasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [form, setForm] = useState({ ...EMPTY_FORM, taskId })

  useEffect(() => {
    setForm((current) => ({ ...current, taskId: taskId || "" }))
  }, [taskId])

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    const [itemsResult, reasonsResult] = await Promise.all([
      getActiveCampaignRequiredItems(),
      getWasteReasons()
    ])
    if (itemsResult.error || reasonsResult.error) {
      setError(itemsResult.error?.message || reasonsResult.error?.message || "No se pudo cargar el formulario.")
    } else {
      setCampaignItems(itemsResult.data || [])
      setReasons(reasonsResult.data || [])
      setError("")
    }
    setLoading(false)
  }

  const availableItems = useMemo(() => {
    if (requiredItemIds.length) {
      return campaignItems.filter((item) => requiredItemIds.includes(item.itemId))
    }
    return campaignItems
  }, [campaignItems, requiredItemIds])

  const selectedItem = availableItems.find((item) => item.itemId === form.inventoryItemId)
  const initialWeight = Number(form.initialWeight || 0)
  const usableWeight = Number(form.usableWeight || 0)
  const wasteWeight = Math.max(initialWeight - usableWeight, 0)
  const yieldPercent = initialWeight > 0 ? ((usableWeight / initialWeight) * 100).toFixed(2) : "0.00"

  async function handleSubmit(event) {
    event.preventDefault()
    if (!form.inventoryItemId) {
      setError("Selecciona un producto auditado.")
      return
    }
    setSaving(true)
    setMessage("")
    setError("")
    const result = await submitYieldAudit({
      campaignId: selectedItem?.campaignId || form.campaignId || null,
      inventoryItemId: form.inventoryItemId,
      taskId: form.taskId || taskId || null,
      productionAreaId: user?.areaId || user?.area_id || null,
      employeeId: user?.id || null,
      initialWeight,
      usableWeight,
      wasteReasonId: form.wasteReasonId || null,
      notes: form.notes
    })
    if (result.error) setError(result.error.message || "No se pudo guardar la auditoría.")
    else {
      setMessage("Auditoría de rendimiento registrada.")
      setForm({ ...EMPTY_FORM, taskId: taskId || "" })
      onSaved?.(result.data)
    }
    setSaving(false)
  }

  if (loading) return <p className="yield-empty">Cargando formulario de rendimiento...</p>

  return (
    <section className={compact ? "" : "yield-panel"}>
      {!compact && (
        <>
          <p className="yield-page__eyebrow">Tareas</p>
          <h2>Formulario de rendimiento</h2>
          <p className="yield-empty">Registra peso inicial, peso útil y merma para ingredientes en campaña activa.</p>
        </>
      )}

      {message && <p className="yield-toast yield-toast--success" role="status">{message}</p>}
      {error && <p className="yield-toast yield-toast--error" role="alert">{error}</p>}

      {!availableItems.length && (
        <p className="yield-empty">No hay ingredientes en campaña activa. Gerencia debe activar una campaña con productos seleccionados.</p>
      )}

      {availableItems.length > 0 && (
        <form className="yield-form-grid" onSubmit={handleSubmit}>
          <label>
            Producto
            <select
              required
              value={form.inventoryItemId}
              onChange={(event) => {
                const item = availableItems.find((row) => row.itemId === event.target.value)
                setForm((current) => ({
                  ...current,
                  inventoryItemId: event.target.value,
                  campaignId: item?.campaignId || ""
                }))
              }}
            >
              <option value="">Seleccionar</option>
              {availableItems.map((item) => (
                <option key={`${item.campaignId}-${item.itemId}`} value={item.itemId}>
                  {item.itemName} ({item.campaignName})
                </option>
              ))}
            </select>
          </label>
          <label>
            Peso inicial
            <input type="number" min="0.0001" step="any" required value={form.initialWeight} onChange={(event) => setForm((current) => ({ ...current, initialWeight: event.target.value }))} />
          </label>
          <label>
            Peso útil
            <input type="number" min="0" step="any" required value={form.usableWeight} onChange={(event) => setForm((current) => ({ ...current, usableWeight: event.target.value }))} />
          </label>
          <label>
            Merma calculada
            <input readOnly value={wasteWeight.toFixed(4)} />
          </label>
          <label>
            Rendimiento calculado (%)
            <input readOnly value={yieldPercent} />
          </label>
          <label>
            Motivo de merma
            <select value={form.wasteReasonId} onChange={(event) => setForm((current) => ({ ...current, wasteReasonId: event.target.value }))}>
              <option value="">Seleccionar</option>
              {reasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: "1 / -1" }}>
            Observaciones
            <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
          </label>
          <div className="yield-actions" style={{ gridColumn: "1 / -1" }}>
            <button type="submit" className="yield-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar auditoría"}</button>
          </div>
        </form>
      )}
    </section>
  )
}
