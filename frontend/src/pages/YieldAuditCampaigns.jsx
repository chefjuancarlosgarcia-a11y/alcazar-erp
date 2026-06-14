import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getActiveInventoryItems } from "../services/inventoryService"
import {
  createYieldAuditCampaign,
  getYieldAuditCampaigns,
  setCampaignItems,
  updateYieldAuditCampaign
} from "../services/yieldCostingService"
import "./InventoryBase.css"
import "./YieldCosting.css"

const MANAGER_ROLES = ["admin", "gerente_general", "gerente"]

const EMPTY_FORM = {
  name: "",
  description: "",
  startDate: new Date().toISOString().slice(0, 10),
  endDate: "",
  status: "draft",
  itemIds: []
}

export default function YieldAuditCampaigns() {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role)
  const [campaigns, setCampaigns] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedCampaignId, setSelectedCampaignId] = useState("")
  const [itemSearch, setItemSearch] = useState("")

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    const [campaignsResult, itemsResult] = await Promise.all([
      getYieldAuditCampaigns(),
      getActiveInventoryItems()
    ])
    const loadError = campaignsResult.error || itemsResult.error
    if (loadError) setError(loadError.message || "No se pudieron cargar las campañas.")
    else {
      setCampaigns(campaignsResult.data || [])
      setItems(itemsResult.data || [])
      setError("")
    }
    setLoading(false)
  }

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === selectedCampaignId) || null,
    [campaigns, selectedCampaignId]
  )

  const filteredItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase()
    return items.filter((item) => !term || item.name.toLowerCase().includes(term))
  }, [items, itemSearch])

  function openCampaign(campaign) {
    setSelectedCampaignId(campaign.id)
    setForm({
      name: campaign.name || "",
      description: campaign.description || "",
      startDate: campaign.start_date || "",
      endDate: campaign.end_date || "",
      status: campaign.status || "draft",
      itemIds: (campaign.items || []).map((row) => row.inventory_item?.id).filter(Boolean)
    })
    setMessage("")
  }

  function resetForm() {
    setSelectedCampaignId("")
    setForm(EMPTY_FORM)
  }

  function toggleItem(itemId) {
    setForm((current) => ({
      ...current,
      itemIds: current.itemIds.includes(itemId)
        ? current.itemIds.filter((id) => id !== itemId)
        : [...current.itemIds, itemId]
    }))
  }

  async function saveCampaign(event) {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setMessage("")
    setError("")
    const payload = {
      name: form.name,
      description: form.description,
      startDate: form.startDate,
      endDate: form.endDate || null,
      status: form.status,
      createdBy: user?.id
    }
    const result = selectedCampaignId
      ? await updateYieldAuditCampaign(selectedCampaignId, payload)
      : await createYieldAuditCampaign(payload)
    if (result.error) {
      setError(result.error.message || "No se pudo guardar la campaña.")
      setSaving(false)
      return
    }
    const campaignId = selectedCampaignId || result.data?.id
    const itemsResult = await setCampaignItems(campaignId, form.itemIds)
    if (itemsResult.error) setError(itemsResult.error.message || "La campaña se guardó, pero no los productos.")
    else {
      setMessage(selectedCampaignId ? "Campaña actualizada." : "Campaña creada.")
      await refresh()
      if (campaignId) setSelectedCampaignId(campaignId)
    }
    setSaving(false)
  }

  async function deactivateCampaign() {
    if (!selectedCampaignId || !canManage) return
    const confirmed = window.confirm("¿Desactivar esta campaña?\n\nLas auditorías ya registradas se conservan.")
    if (!confirmed) return
    const result = await updateYieldAuditCampaign(selectedCampaignId, { ...form, status: "closed" })
    if (result.error) setError(result.error.message || "No se pudo cerrar la campaña.")
    else {
      setMessage("Campaña cerrada.")
      await refresh()
    }
  }

  return (
    <section className="yield-page">
      <header className="yield-page__hero">
        <div>
          <p className="yield-page__eyebrow">Inventario</p>
          <h1>Auditorías de rendimiento</h1>
          <p>Crea campañas semanales o por periodo para medir solo los ingredientes que gerencia seleccione.</p>
        </div>
        {canManage && (
          <button type="button" className="yield-btn" onClick={resetForm}>Nueva campaña</button>
        )}
      </header>

      {message && <p className="yield-toast yield-toast--success" role="status">{message}</p>}
      {error && <p className="yield-toast yield-toast--error" role="alert">{error}</p>}

      <div className="yield-layout">
        <aside className="yield-panel">
          <h2>Campañas</h2>
          {loading && <p className="yield-empty">Cargando...</p>}
          {!loading && !campaigns.length && <p className="yield-empty">Aún no hay campañas de auditoría.</p>}
          <div className="yield-grid">
            {campaigns.map((campaign) => (
              <button
                key={campaign.id}
                type="button"
                className="yield-card"
                style={{ textAlign: "left", cursor: "pointer" }}
                onClick={() => openCampaign(campaign)}
              >
                <strong>{campaign.name}</strong>
                <p>{campaign.start_date}{campaign.end_date ? ` → ${campaign.end_date}` : ""}</p>
                <span className={`yield-badge ${campaign.status === "active" ? "yield-badge--ok" : campaign.status === "closed" ? "yield-badge--bad" : "yield-badge--warn"}`}>
                  {campaign.status}
                </span>
                <small>{(campaign.items || []).length} productos auditados</small>
              </button>
            ))}
          </div>
        </aside>

        <div className="yield-panel">
          {!canManage && <p className="yield-empty">Solo gerencia puede administrar campañas de auditoría.</p>}
          {canManage && (
            <form onSubmit={saveCampaign}>
              <h2>{selectedCampaignId ? "Editar campaña" : "Nueva campaña"}</h2>
              <div className="yield-form-grid">
                <label>
                  Nombre
                  <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Semana 24" />
                </label>
                <label>
                  Estado
                  <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
                    <option value="draft">Borrador</option>
                    <option value="active">Activa</option>
                    <option value="closed">Cerrada</option>
                  </select>
                </label>
                <label>
                  Inicio
                  <input type="date" required value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} />
                </label>
                <label>
                  Fin
                  <input type="date" value={form.endDate} onChange={(event) => setForm((current) => ({ ...current, endDate: event.target.value }))} />
                </label>
                <label style={{ gridColumn: "1 / -1" }}>
                  Descripción
                  <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} />
                </label>
              </div>

              <h3 style={{ marginTop: 18 }}>Productos auditados</h3>
              <label>
                Buscar ingrediente
                <input value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} placeholder="Filtrar ingredientes..." />
              </label>
              <div className="yield-grid" style={{ marginTop: 12, maxHeight: 320, overflow: "auto" }}>
                {filteredItems.map((item) => (
                  <label key={item.id} className="yield-card" style={{ cursor: "pointer" }}>
                    <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={form.itemIds.includes(item.id)}
                        onChange={() => toggleItem(item.id)}
                      />
                      <strong>{item.name}</strong>
                    </span>
                    <small>{item.base_unit}</small>
                  </label>
                ))}
              </div>

              <div className="yield-actions" style={{ marginTop: 16 }}>
                <button type="submit" className="yield-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar campaña"}</button>
                {selectedCampaignId && (
                  <button type="button" className="yield-btn-danger" onClick={deactivateCampaign}>Cerrar campaña</button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    </section>
  )
}
