import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import { getActiveInventoryItems } from "../services/inventoryService"
import {
  computeUsableStock,
  getYieldProfiles,
  upsertYieldProfile
} from "../services/yieldCostingService"
import "./InventoryBase.css"
import "./YieldCosting.css"

const MANAGER_ROLES = ["admin", "gerente_general", "gerente", "encargado_almacen"]

function formatMoney(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function yieldBadge(profile, actual = null) {
  const expected = Number(profile?.expectedYieldPercent || 100)
  const minimum = Number(profile?.minimumAcceptableYieldPercent || 90)
  const value = actual == null ? expected : Number(actual)
  if (value >= expected) return "yield-badge yield-badge--ok"
  if (value >= minimum) return "yield-badge yield-badge--warn"
  return "yield-badge yield-badge--bad"
}

export default function YieldProfilesCatalog() {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role)
  const [profiles, setProfiles] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [search, setSearch] = useState("")
  const [selectedItemId, setSelectedItemId] = useState("")
  const [form, setForm] = useState({
    expectedYieldPercent: "95",
    minimumAcceptableYieldPercent: "92",
    notes: ""
  })

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    setLoading(true)
    const [profilesResult, itemsResult] = await Promise.all([
      getYieldProfiles(),
      getActiveInventoryItems()
    ])
    const loadError = profilesResult.error || itemsResult.error
    if (loadError) setError(loadError.message || "No se pudieron cargar los rendimientos.")
    else {
      setProfiles(profilesResult.data || [])
      setItems(itemsResult.data || [])
      setError("")
    }
    setLoading(false)
  }

  const profileByItem = useMemo(
    () => Object.fromEntries(profiles.map((profile) => [profile.itemId, profile])),
    [profiles]
  )

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase()
    return items.filter((item) => !term || item.name.toLowerCase().includes(term))
  }, [items, search])

  const selectedProfile = selectedItemId ? profileByItem[selectedItemId] : null
  const selectedItem = items.find((item) => item.id === selectedItemId)

  function openItem(itemId) {
    setSelectedItemId(itemId)
    const profile = profileByItem[itemId]
    setForm({
      expectedYieldPercent: String(profile?.expectedYieldPercent ?? 95),
      minimumAcceptableYieldPercent: String(profile?.minimumAcceptableYieldPercent ?? 92),
      notes: profile?.notes || ""
    })
    setMessage("")
  }

  async function saveProfile(event) {
    event.preventDefault()
    if (!canManage || !selectedItemId) return
    setSaving(true)
    setMessage("")
    setError("")
    const result = await upsertYieldProfile({
      inventoryItemId: selectedItemId,
      expectedYieldPercent: form.expectedYieldPercent,
      minimumAcceptableYieldPercent: form.minimumAcceptableYieldPercent,
      notes: form.notes
    })
    if (result.error) setError(result.error.message || "No se pudo guardar el perfil de rendimiento.")
    else {
      setMessage("Perfil de rendimiento guardado. Costos utilizable y recetas relacionadas actualizados.")
      await refresh()
    }
    setSaving(false)
  }

  const stock = selectedProfile
    ? computeUsableStock(selectedProfile.totalQuantity, selectedProfile.expectedYieldPercent)
    : selectedItem
      ? computeUsableStock(selectedItem.totalQuantity, Number(form.expectedYieldPercent))
      : null

  return (
    <section className="yield-page">
      <header className="yield-page__hero">
        <div>
          <p className="yield-page__eyebrow">Inventario</p>
          <h1>Catálogo de rendimientos</h1>
          <p>Define rendimientos esperados, mínimos aceptables y consulta el costo utilizable real de cada ingrediente.</p>
        </div>
      </header>

      {message && <p className="yield-toast yield-toast--success" role="status">{message}</p>}
      {error && <p className="yield-toast yield-toast--error" role="alert">{error}</p>}

      <div className="yield-layout">
        <aside className="yield-panel">
          <h2>Ingredientes</h2>
          <label>
            Buscar
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Mozzarella, pepperoni..." />
          </label>
          <div className="yield-grid" style={{ marginTop: 12 }}>
            {loading && <p className="yield-empty">Cargando ingredientes...</p>}
            {!loading && filteredItems.map((item) => {
              const profile = profileByItem[item.id]
              return (
                <button
                  key={item.id}
                  type="button"
                  className="yield-card"
                  style={{ textAlign: "left", cursor: "pointer", borderColor: selectedItemId === item.id ? "rgba(45,212,191,.45)" : undefined }}
                  onClick={() => openItem(item.id)}
                >
                  <strong>{item.name}</strong>
                  <p>{item.category || "Sin categoría"} · {item.base_unit}</p>
                  {profile
                    ? <span className={yieldBadge(profile, profile.historicalAverageYieldPercent)}>{profile.expectedYieldPercent}% esperado</span>
                    : <span className="yield-badge yield-badge--warn">Sin perfil</span>}
                </button>
              )
            })}
          </div>
        </aside>

        <div className="yield-panel">
          {!selectedItem && <p className="yield-empty">Selecciona un ingrediente para ver o configurar su rendimiento.</p>}
          {selectedItem && (
            <>
              <h2>{selectedItem.name}</h2>
              <div className="yield-metrics">
                <div className="yield-metric"><span>Stock físico</span><strong>{stock?.physical ?? 0} {selectedItem.base_unit}</strong></div>
                <div className="yield-metric"><span>Stock utilizable</span><strong>{stock?.usable ?? 0} {selectedItem.base_unit}</strong></div>
                <div className="yield-metric"><span>Merma esperada</span><strong>{stock?.expectedWaste ?? 0} {selectedItem.base_unit}</strong></div>
                <div className="yield-metric"><span>CPP</span><strong>{formatMoney(selectedProfile?.weightedAverageCost ?? selectedItem.cost_per_base_unit)}</strong></div>
                <div className="yield-metric"><span>CUR</span><strong>{formatMoney(selectedProfile?.usableCost ?? selectedItem.usable_cost ?? selectedItem.cost_per_base_unit)}</strong></div>
                <div className="yield-metric"><span>Promedio histórico</span><strong>{selectedProfile?.historicalAverageYieldPercent != null ? `${selectedProfile.historicalAverageYieldPercent}%` : "—"}</strong></div>
              </div>

              {canManage && (
                <form className="yield-form-grid" style={{ marginTop: 18 }} onSubmit={saveProfile}>
                  <label>
                    Rendimiento esperado (%)
                    <input type="number" min="1" max="100" step="0.1" required value={form.expectedYieldPercent} onChange={(event) => setForm((current) => ({ ...current, expectedYieldPercent: event.target.value }))} />
                  </label>
                  <label>
                    Mínimo aceptable (%)
                    <input type="number" min="1" max="100" step="0.1" required value={form.minimumAcceptableYieldPercent} onChange={(event) => setForm((current) => ({ ...current, minimumAcceptableYieldPercent: event.target.value }))} />
                  </label>
                  <label style={{ gridColumn: "1 / -1" }}>
                    Notas
                    <textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} />
                  </label>
                  <div className="yield-actions" style={{ gridColumn: "1 / -1" }}>
                    <button type="submit" className="yield-btn" disabled={saving}>{saving ? "Guardando..." : "Guardar perfil"}</button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
