import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getActiveAreas } from "../services/areasService"
import { getActiveInventoryItems } from "../services/inventoryService"
import {
  approveRequisition,
  cancelRequisition,
  completeRequisition,
  createRequisition,
  getRequisitions,
  rejectRequisition,
  submitRequisition,
  updateRequisition
} from "../services/requisitionsService"
import "./RequisitionsSupabase.css"

const TABS = [
  ["all", "Todas"],
  ["draft", "Borradores"],
  ["pending", "Pendientes"],
  ["approved", "Aprobadas"],
  ["completed", "Completadas"],
  ["rejected", "Rechazadas"],
  ["cancelled", "Canceladas"]
]

const STATUS_LABELS = {
  draft: "Borrador",
  pending: "Pendiente",
  approved: "Aprobada",
  completed: "Completada",
  rejected: "Rechazada",
  cancelled: "Cancelada"
}

const PRIORITY_LABELS = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente"
}

function RequisitionsSupabase() {
  const { user } = useAuth()
  const [requisitions, setRequisitions] = useState([])
  const [areas, setAreas] = useState([])
  const [inventory, setInventory] = useState([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState("")
  const [tab, setTab] = useState("all")
  const [filters, setFilters] = useState({ date: "", fromAreaId: "", toAreaId: "", priority: "", search: "" })
  const [formRequest, setFormRequest] = useState(null)
  const [detail, setDetail] = useState(null)
  const [approval, setApproval] = useState(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  const manager = ["admin", "gerente_general"].includes(user?.role)
  const ownResponsibleAreas = areas.filter((area) => area.responsibleUserId === user?.id)
  const canCreate = manager || (user?.role === "supervisor" && Boolean(user?.areaId)) || ownResponsibleAreas.length > 0
  const allowedDestinationAreas = manager
    ? areas
    : areas.filter((area) => area.id === user?.areaId || area.responsibleUserId === user?.id)
  const hasLegacy = readLegacyRequests().length > 0

  const loadData = useCallback(async () => {
    setLoading(true)
    const [requestsResult, areasResult, inventoryResult] = await Promise.all([
      getRequisitions(),
      getActiveAreas(),
      getActiveInventoryItems()
    ])
    const loadError = requestsResult.error || areasResult.error || inventoryResult.error
    if (loadError) setError(`No se pudieron cargar requisiciones: ${loadError.message}`)
    else {
      setRequisitions(requestsResult.data)
      setAreas(areasResult.data)
      setInventory(inventoryResult.data)
      setError("")
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      loadData()
    }, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadData])

  const visibleRequests = useMemo(() => requisitions.filter((request) => {
    if (tab !== "all" && request.status !== tab) return false
    if (filters.date && !String(request.created_at || "").startsWith(filters.date)) return false
    if (filters.fromAreaId && request.from_area_id !== filters.fromAreaId) return false
    if (filters.toAreaId && request.to_area_id !== filters.toAreaId) return false
    if (filters.priority && request.priority !== filters.priority) return false
    const term = filters.search.trim().toLowerCase()
    return !term || [request.requisition_number, request.requestedByName, areaName(areas, request.to_area_id)]
      .some((value) => String(value || "").toLowerCase().includes(term))
  }), [areas, filters, requisitions, tab])

  function openNew() {
    setFormRequest({
      id: "",
      fromAreaId: areas.find((area) => area.id === "almacen")?.id || areas[0]?.id || "",
      toAreaId: allowedDestinationAreas.find((area) => area.id !== "almacen")?.id || "",
      priority: "normal",
      notes: "",
      items: []
    })
  }

  function openEdit(request) {
    setFormRequest({
      id: request.id,
      fromAreaId: request.from_area_id,
      toAreaId: request.to_area_id,
      priority: request.priority,
      notes: request.notes || "",
      items: request.items.map((item) => ({
        itemId: item.item_id,
        requestedQuantity: item.requested_quantity,
        notes: item.notes || ""
      }))
    })
  }

  async function saveRequest(data, submit) {
    setError("")
    setMessage("")
    const validation = validateRequest(data, inventory, areas)
    if (validation) {
      setError(validation)
      return
    }
    setWorkingId(data.id || "new")
    const result = data.id
      ? await updateRequisition(data.id, data, data.items)
      : await createRequisition(data, data.items, submit)
    let actionError = result.error
    if (!actionError && data.id && submit) {
      const submitResult = await submitRequisition(data.id)
      actionError = submitResult.error
    }
    setWorkingId("")
    if (actionError) {
      setError(actionError.message)
      return
    }
    setFormRequest(null)
    setMessage(submit ? "Requisición enviada para aprobación." : "Borrador guardado correctamente.")
    await loadData()
  }

  async function runAction(id, action, successMessage) {
    setWorkingId(id)
    setError("")
    const result = await action()
    setWorkingId("")
    if (result.error) {
      setError(result.error.message)
      return
    }
    setMessage(successMessage)
    setDetail(null)
    await loadData()
  }

  function askReason(label, action) {
    const reason = window.prompt(`Motivo para ${label.toLowerCase()}:`)
    if (reason?.trim()) action(reason.trim())
  }

  async function handleApprove(values) {
    await runAction(approval.id, () => approveRequisition(approval.id, values), "Requisición aprobada. Ya puede completarse el traslado.")
    setApproval(null)
  }

  return (
    <section className="requisitions-page">
      <header className="requisitions-header">
        <div>
          <p className="requisitions-eyebrow">Supabase Inventory</p>
          <h1>Requisiciones</h1>
          <p className="requisitions-muted">Traslados internos de inventario entre áreas con kardex auditable.</p>
        </div>
        <div className="requisitions-actions">
          {canCreate && <button type="button" className="primary" onClick={openNew}>Nueva requisición</button>}
          <button type="button" onClick={loadData}>Actualizar</button>
        </div>
      </header>

      {hasLegacy && <div className="requisitions-warning">Existen requisiciones locales antiguas. Deben migrarse a Supabase.</div>}
      {message && <div className="requisitions-success">{message}</div>}
      {error && <div className="requisitions-error">{error}</div>}

      <nav className="requisitions-tabs" aria-label="Estados de requisición">
        {TABS.map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>
            {label}<strong>{countStatus(requisitions, value)}</strong>
          </button>
        ))}
      </nav>

      <div className="requisitions-filters">
        <input value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Buscar número, solicitante o área" />
        <input type="date" value={filters.date} onChange={(event) => setFilters({ ...filters, date: event.target.value })} />
        <select value={filters.fromAreaId} onChange={(event) => setFilters({ ...filters, fromAreaId: event.target.value })}>
          <option value="">Todos los orígenes</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <select value={filters.toAreaId} onChange={(event) => setFilters({ ...filters, toAreaId: event.target.value })}>
          <option value="">Todos los destinos</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </select>
        <select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
          <option value="">Todas las prioridades</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      <div className="requisitions-list">
        {loading && <p className="requisitions-empty">Cargando requisiciones...</p>}
        {!loading && visibleRequests.map((request) => (
          <article className="requisition-card" key={request.id}>
            <div className="requisition-summary">
              <strong>{request.requisition_number}</strong>
              <StatusBadge status={request.status} />
              <PriorityBadge priority={request.priority} />
            </div>
            <div className="requisition-route">
              <span>{areaName(areas, request.from_area_id)}</span>
              <b aria-hidden="true">→</b>
              <span>{areaName(areas, request.to_area_id)}</span>
            </div>
            <div className="requisition-meta">
              <span>Solicitante: <strong>{request.requestedByName}</strong></span>
              <span>{formatDate(request.created_at)}</span>
              <span>{request.items.length} productos</span>
            </div>
            <div className="requisition-buttons">
              <button type="button" onClick={() => setDetail(request)}>Ver detalle</button>
              {request.status === "draft" && request.requested_by === user?.id && <button type="button" onClick={() => openEdit(request)}>Editar</button>}
              {request.status === "draft" && request.requested_by === user?.id && <button type="button" className="primary" disabled={workingId === request.id} onClick={() => runAction(request.id, () => submitRequisition(request.id), "Requisición enviada para aprobación.")}>Enviar</button>}
              {manager && request.status === "pending" && <button type="button" className="primary" onClick={() => setApproval(request)}>Aprobar</button>}
              {manager && request.status === "approved" && <button type="button" className="primary" disabled={workingId === request.id} onClick={() => runAction(request.id, () => completeRequisition(request.id), "Requisición completada. Inventario actualizado.")}>Completar traslado</button>}
              {manager && ["pending", "approved"].includes(request.status) && <button type="button" className="danger" onClick={() => askReason("rechazar", (reason) => runAction(request.id, () => rejectRequisition(request.id, reason), "Requisición rechazada."))}>Rechazar</button>}
              {["draft", "pending", "approved"].includes(request.status) && (manager || request.requested_by === user?.id) && <button type="button" className="danger" onClick={() => askReason("cancelar", (reason) => runAction(request.id, () => cancelRequisition(request.id, reason), "Requisición cancelada."))}>Cancelar</button>}
            </div>
          </article>
        ))}
        {!loading && !visibleRequests.length && <p className="requisitions-empty">No hay requisiciones para esta selección.</p>}
      </div>

      {formRequest && (
        <RequestForm
          request={formRequest}
          areas={areas}
          destinationAreas={allowedDestinationAreas}
          inventory={inventory}
          saving={Boolean(workingId)}
          onClose={() => setFormRequest(null)}
          onSave={saveRequest}
        />
      )}
      {detail && <RequestDetail request={detail} areas={areas} inventory={inventory} onClose={() => setDetail(null)} />}
      {approval && <ApprovalModal request={approval} saving={workingId === approval.id} onClose={() => setApproval(null)} onApprove={handleApprove} />}
    </section>
  )
}

function RequestForm({ request, areas, destinationAreas, inventory, saving, onClose, onSave }) {
  const [form, setForm] = useState(request)
  const [selectedItemId, setSelectedItemId] = useState(inventory[0]?.id || "")
  const selectedItem = inventory.find((item) => item.id === selectedItemId)

  function addItem() {
    if (!selectedItem || form.items.some((item) => item.itemId === selectedItem.id)) return
    setForm({ ...form, items: [...form.items, { itemId: selectedItem.id, requestedQuantity: 1, notes: "" }] })
  }

  function updateItem(itemId, updates) {
    setForm({ ...form, items: form.items.map((item) => item.itemId === itemId ? { ...item, ...updates } : item) })
  }

  return (
    <div className="requisitions-backdrop">
      <form className="requisitions-modal request-form" onSubmit={(event) => { event.preventDefault(); onSave(form, false) }}>
        <header>
          <div><p className="requisitions-eyebrow">Traslado interno</p><h2>{form.id ? "Editar borrador" : "Nueva requisición"}</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        <div className="requisition-form-grid">
          <Field label="Origen">
            <select value={form.fromAreaId} onChange={(event) => setForm({ ...form, fromAreaId: event.target.value })}>
              {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </Field>
          <Field label="Destino">
            <select value={form.toAreaId} onChange={(event) => setForm({ ...form, toAreaId: event.target.value })}>
              <option value="">Selecciona destino</option>
              {destinationAreas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Notas">
            <input value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Motivo o instrucciones" />
          </Field>
        </div>
        <div className="requisition-picker">
          <select value={selectedItemId} onChange={(event) => setSelectedItemId(event.target.value)}>
            {inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.base_unit})</option>)}
          </select>
          <span>Disponible origen: <strong>{stockOf(selectedItem, form.fromAreaId)}</strong> {selectedItem?.base_unit || ""}</span>
          <button type="button" className="primary" onClick={addItem}>Agregar producto</button>
        </div>
        <div className="requisition-items">
          <div className="requisition-items-head"><span>Producto</span><span>Origen / destino actual</span><span>Cantidad</span><span>Notas</span><span /></div>
          {form.items.map((line) => {
            const item = inventory.find((inventoryItem) => inventoryItem.id === line.itemId)
            return (
              <div className="requisition-item-row" key={line.itemId}>
                <strong>{item?.name || "Producto"}</strong>
                <span>{stockOf(item, form.fromAreaId)} / {stockOf(item, form.toAreaId)} {item?.base_unit}</span>
                <input type="number" min="0.001" step="any" value={line.requestedQuantity} onChange={(event) => updateItem(line.itemId, { requestedQuantity: event.target.value })} />
                <input value={line.notes} onChange={(event) => updateItem(line.itemId, { notes: event.target.value })} placeholder="Opcional" />
                <button type="button" className="danger" onClick={() => setForm({ ...form, items: form.items.filter((itemLine) => itemLine.itemId !== line.itemId) })}>Quitar</button>
              </div>
            )
          })}
          {!form.items.length && <p className="requisitions-empty">Agrega al menos un producto inventariable.</p>}
        </div>
        <div className="requisitions-modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" disabled={saving}>Guardar borrador</button>
          <button type="button" className="primary" disabled={saving} onClick={() => onSave(form, true)}>Enviar requisición</button>
        </div>
      </form>
    </div>
  )
}

function RequestDetail({ request, areas, inventory, onClose }) {
  return (
    <div className="requisitions-backdrop">
      <section className="requisitions-modal detail">
        <header>
          <div><p className="requisitions-eyebrow">{request.requisition_number}</p><h2>Detalle de requisición</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        <div className="requisition-detail-meta">
          <span>Estado <StatusBadge status={request.status} /></span>
          <span>Ruta <strong>{areaName(areas, request.from_area_id)} → {areaName(areas, request.to_area_id)}</strong></span>
          <span>Solicitante <strong>{request.requestedByName}</strong></span>
          <span>Aprobado por <strong>{request.approvedByName || "Pendiente"}</strong></span>
          <span>Completado por <strong>{request.completedByName || "Pendiente"}</strong></span>
          <span>Creada <strong>{formatDate(request.created_at)}</strong></span>
        </div>
        {request.notes && <p className="requisition-note">{request.notes}</p>}
        <div className="requisition-detail-table">
          <div><strong>Producto</strong><strong>Solicitado / aprobado</strong><strong>Origen ahora / después</strong><strong>Destino ahora / después</strong></div>
          {request.items.map((line) => {
            const item = inventory.find((entry) => entry.id === line.item_id)
            const quantity = Number(line.approved_quantity || line.requested_quantity)
            const origin = stockOf(item, request.from_area_id)
            const destination = stockOf(item, request.to_area_id)
            const insufficient = origin < quantity && request.status !== "completed"
            return (
              <div className={insufficient ? "insufficient" : ""} key={line.id}>
                <strong>{line.item_name}</strong>
                <span>{line.requested_quantity} / {line.approved_quantity || "-"} {line.unit}</span>
                <span>{origin} / {origin - quantity} {line.unit}</span>
                <span>{destination} / {destination + quantity} {line.unit}</span>
                {insufficient && <small>Stock insuficiente en origen.</small>}
              </div>
            )
          })}
        </div>
        {request.rejection_reason && <div className="requisitions-error">Motivo: {request.rejection_reason}</div>}
      </section>
    </div>
  )
}

function ApprovalModal({ request, saving, onClose, onApprove }) {
  const [items, setItems] = useState(() => request.items.map((item) => ({
    ...item,
    approvedQuantity: item.approved_quantity || item.requested_quantity
  })))
  return (
    <div className="requisitions-backdrop">
      <form className="requisitions-modal approval" onSubmit={(event) => { event.preventDefault(); onApprove(items) }}>
        <header>
          <div><p className="requisitions-eyebrow">{request.requisition_number}</p><h2>Aprobar cantidades</h2></div>
          <button type="button" onClick={onClose}>Cerrar</button>
        </header>
        {items.map((item) => (
          <label className="approval-line" key={item.id}>
            <span>{item.item_name}<small>Solicitado: {item.requested_quantity} {item.unit}</small></span>
            <input type="number" step="any" min="0.001" value={item.approvedQuantity} onChange={(event) => setItems(items.map((line) => line.id === item.id ? { ...line, approvedQuantity: event.target.value } : line))} />
          </label>
        ))}
        <div className="requisitions-modal-actions">
          <button type="button" onClick={onClose}>Cancelar</button>
          <button type="submit" className="primary" disabled={saving}>Aprobar requisición</button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return <label className="requisition-field"><span>{label}</span>{children}</label>
}

function StatusBadge({ status }) {
  return <span className={`req-badge status-${status}`}>{STATUS_LABELS[status] || status}</span>
}

function PriorityBadge({ priority }) {
  return <span className={`req-badge priority-${priority}`}>{PRIORITY_LABELS[priority] || priority}</span>
}

function areaName(areas, areaId) {
  return areas.find((area) => area.id === areaId)?.name || areaId || "Sin área"
}

function stockOf(item, areaId) {
  return Number(item?.stockByArea?.[areaId] || 0)
}

function countStatus(requests, status) {
  return status === "all" ? requests.length : requests.filter((request) => request.status === status).length
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString("es-GT") : "-"
}

function readLegacyRequests() {
  try {
    const value = JSON.parse(localStorage.getItem("requisiciones") || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function validateRequest(request, inventory, areas) {
  if (!request.fromAreaId || !request.toAreaId || request.fromAreaId === request.toAreaId) return "Origen y destino deben ser áreas diferentes."
  if (!areas.some((area) => area.id === request.toAreaId && area.active)) return "El área destino no está activa."
  if (!request.items.length) return "Agrega al menos un producto."
  for (const line of request.items) {
    if (!inventory.some((item) => item.id === line.itemId && item.active)) return "La requisición contiene un producto inactivo."
    if (Number(line.requestedQuantity) <= 0) return "Cada cantidad solicitada debe ser mayor que cero."
  }
  return ""
}

export default RequisitionsSupabase
