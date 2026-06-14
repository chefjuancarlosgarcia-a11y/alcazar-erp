import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../lib/supabase"
import {
  activateArea,
  deactivateArea,
  getAreas,
  saveOperationalArea,
  slugifyAreaId
} from "../services/areasService"

const EMPTY_FORM = {
  name: "",
  type: "operativa",
  description: "",
  responsibleUserId: "",
  canRequestInventory: true,
  isProductionArea: false,
  active: true,
  sortOrder: 0
}

const AREA_TYPE_LABELS = {
  principal: "Principal",
  operativa: "Operativa",
  produccion: "Producción",
  servicio: "Servicio",
  administrativa: "Administrativa",
  limpieza: "Limpieza"
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

export default function AreasCatalogManagement({ embedded = false }) {
  const [areas, setAreas] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingArea, setEditingArea] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)

  const previewAreaId = useMemo(
    () => (editingArea ? editingArea.id : slugifyAreaId(formData.name)),
    [editingArea, formData.name]
  )

  useEffect(() => {
    loadAreas()
    loadProfiles()
  }, [])

  async function loadAreas() {
    try {
      setLoading(true)
      setError("")
      const { data, error: loadError } = await getAreas()
      if (loadError) throw loadError
      setAreas(data || [])
    } catch (err) {
      console.error("Error loading areas:", err)
      setError(err.message || "Error al cargar las áreas")
    } finally {
      setLoading(false)
    }
  }

  async function loadProfiles() {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username")
      .eq("status", "active")
      .order("full_name", { ascending: true })
    setProfiles(data || [])
  }

  const filteredAreas = useMemo(() => {
    const query = search.trim().toLowerCase()
    return areas.filter((area) => {
      if (filter === "active" && !area.active) return false
      if (filter === "inactive" && area.active) return false
      if (filter === "production" && !area.isProductionArea) return false
      if (!query) return true
      return (
        String(area.name || "").toLowerCase().includes(query)
        || String(area.id || "").toLowerCase().includes(query)
        || String(area.type || "").toLowerCase().includes(query)
      )
    })
  }, [areas, filter, search])

  const filterCounts = useMemo(() => ({
    all: areas.length,
    active: areas.filter((area) => area.active).length,
    inactive: areas.filter((area) => !area.active).length,
    production: areas.filter((area) => area.isProductionArea).length
  }), [areas])

  function openCreate() {
    setEditingArea(null)
    setFormData(EMPTY_FORM)
    setShowForm(true)
    setError("")
  }

  function openEdit(area) {
    setEditingArea(area)
    setFormData({
      name: area.name,
      type: area.type || "operativa",
      description: area.description || "",
      responsibleUserId: area.responsibleUserId || "",
      canRequestInventory: area.canRequestInventory !== false,
      isProductionArea: area.isProductionArea === true,
      active: area.active !== false,
      sortOrder: Number(area.sortOrder || 0)
    })
    setShowForm(true)
    setError("")
  }

  function closeForm() {
    setShowForm(false)
    setEditingArea(null)
    setFormData(EMPTY_FORM)
    setError("")
  }

  async function handleSave() {
    try {
      setSaving(true)
      setError("")

      const saved = await saveOperationalArea(formData, editingArea?.id || "")
      setAreas((current) => {
        const next = editingArea
          ? current.map((area) => (area.id === saved.id ? saved : area))
          : [...current, saved]
        return next.sort((a, b) => {
          const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
          if (orderDiff !== 0) return orderDiff
          return String(a.name || "").localeCompare(String(b.name || ""), "es")
        })
      })
      setMessage(`Área "${saved.name}" ${editingArea ? "actualizada" : "creada"} correctamente`)
      closeForm()
    } catch (err) {
      console.error("Error saving area:", err)
      setError(err.message || "Error al guardar el área")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(area) {
    if (area.id === "almacen") {
      setError("El Almacén principal no puede desactivarse.")
      return
    }
    if (area.active && !window.confirm(`¿Desactivar el área "${area.name}"? Ya no aparecerá en asignaciones nuevas.`)) {
      return
    }

    try {
      setSaving(true)
      setError("")
      const result = area.active ? await deactivateArea(area.id) : await activateArea(area.id)
      if (result.error) throw result.error
      setAreas((current) => current.map((item) => (item.id === result.data.id ? result.data : item)))
      setMessage(`Área ${result.data.active ? "activada" : "desactivada"} correctamente`)
    } catch (err) {
      console.error("Error toggling area:", err)
      setError(err.message || "Error al cambiar el estado del área")
    } finally {
      setSaving(false)
    }
  }

  function getResponsibleName(userId) {
    if (!userId) return "Sin asignar"
    const profile = profiles.find((entry) => entry.id === userId)
    return profile?.full_name || profile?.username || "Sin asignar"
  }

  return (
    <section className={`roles-management${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <header className="roles-header">
          <div>
            <p className="roles-eyebrow">Catálogo operativo</p>
            <h1>Áreas operativas</h1>
            <p>Administra las áreas usadas en colaboradores, inventario, producción y requisiciones.</p>
          </div>
          <button type="button" className="roles-primary-btn" onClick={openCreate} disabled={loading || saving}>
            + Crear área
          </button>
        </header>
      )}

      {embedded && (
        <div className="hr-catalogs-panel-toolbar">
          <p className="hr-catalogs-panel-copy">
            Las áreas operativas se usan al asignar colaboradores, en inventario por área, KDS y requisiciones.
          </p>
          <button type="button" className="roles-primary-btn" onClick={openCreate} disabled={loading || saving}>
            + Crear área
          </button>
        </div>
      )}

      {message && <div className="roles-success" role="status">{message}</div>}
      {error && !showForm && <div className="roles-error" role="alert">{error}</div>}

      <div className="roles-toolbar">
        <input
          type="search"
          className="roles-search"
          placeholder="Buscar por nombre, clave o tipo..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="roles-filters">
        {[
          ["all", "Todas"],
          ["active", "Activas"],
          ["inactive", "Inactivas"],
          ["production", "Producción"]
        ].map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`roles-filter-btn ${filter === key ? "active" : ""}`}
            onClick={() => setFilter(key)}
          >
            {label} ({filterCounts[key]})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="roles-empty">Cargando áreas...</div>
      ) : filteredAreas.length === 0 ? (
        <div className="roles-empty">No hay áreas que mostrar con los filtros seleccionados.</div>
      ) : (
        <div className="roles-table areas-table">
          <div className="roles-table-header areas-table-header">
            <div>Nombre</div>
            <div>Clave</div>
            <div>Tipo</div>
            <div>Estado</div>
            <div>Opciones</div>
            <div>Responsable</div>
            <div>Actualización</div>
            <div>Acciones</div>
          </div>
          {filteredAreas.map((area) => {
            const protectedArea = area.id === "almacen"
            return (
              <div key={area.id} className={`roles-table-row areas-table-row ${!area.active ? "inactive" : ""}`}>
                <div className="roles-name">
                  <strong>{area.name}</strong>
                  {area.description && <small>{area.description}</small>}
                </div>
                <div className="roles-key"><code>{area.id}</code></div>
                <div>{AREA_TYPE_LABELS[area.type] || area.type}</div>
                <div>
                  <span className={`roles-status-badge ${area.active ? "active" : "inactive"}`}>
                    {area.active ? "Activa" : "Inactiva"}
                  </span>
                </div>
                <div className="roles-badge-group">
                  {area.isProductionArea && <span className="roles-type-badge system">Producción</span>}
                  {area.canRequestInventory && <span className="roles-type-badge custom">Requisiciones</span>}
                  {protectedArea && <span className="roles-type-badge protected">Principal</span>}
                </div>
                <div><small>{getResponsibleName(area.responsibleUserId)}</small></div>
                <div className="roles-dates">
                  <small>Creada: {formatDate(area.createdAt)}</small>
                  <small>Actualizada: {formatDate(area.updatedAt)}</small>
                </div>
                <div className="roles-actions">
                  <button type="button" className="roles-action-btn edit" onClick={() => openEdit(area)} disabled={saving}>
                    Editar
                  </button>
                  {!protectedArea && (
                    <button
                      type="button"
                      className={`roles-action-btn ${area.active ? "deactivate" : "activate"}`}
                      onClick={() => handleToggleActive(area)}
                      disabled={saving}
                    >
                      {area.active ? "Desactivar" : "Activar"}
                    </button>
                  )}
                  <Link className="roles-action-btn edit" to={`/inventory?section=inventarioAreas&area=${encodeURIComponent(area.id)}`}>
                    Inventario
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div className="roles-modal-overlay">
          <div className="roles-modal">
            <header className="roles-modal-header">
              <div>
                <p className="roles-eyebrow">{editingArea ? "Editar área" : "Nueva área"}</p>
                <h2>{editingArea ? editingArea.name : "Crear área operativa"}</h2>
              </div>
              <button type="button" className="roles-close-btn" onClick={closeForm} disabled={saving}>✕</button>
            </header>

            <div className="roles-modal-body">
              <div className="roles-form-field">
                <label>Nombre del área *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ej: Terraza, Eventos"
                  disabled={saving || editingArea?.id === "almacen"}
                  required
                />
              </div>

              <div className="roles-form-field">
                <label>Clave del área {editingArea ? "" : "(generada automáticamente)"}</label>
                <input type="text" value={previewAreaId || "—"} readOnly disabled />
              </div>

              <div className="roles-form-field">
                <label>Tipo</label>
                <select
                  value={formData.type}
                  onChange={(event) => setFormData((current) => ({ ...current, type: event.target.value }))}
                  disabled={saving || editingArea?.id === "almacen"}
                >
                  {Object.entries(AREA_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>

              <div className="roles-form-field">
                <label>Responsable</label>
                <select
                  value={formData.responsibleUserId}
                  onChange={(event) => setFormData((current) => ({ ...current, responsibleUserId: event.target.value }))}
                  disabled={saving}
                >
                  <option value="">Sin responsable asignado</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name || profile.username}
                    </option>
                  ))}
                </select>
              </div>

              <div className="roles-form-field">
                <label>Descripción</label>
                <textarea
                  value={formData.description}
                  onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Descripción opcional del área"
                  disabled={saving}
                  rows="3"
                />
              </div>

              <div className="roles-form-field">
                <label>Orden de visualización</label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={formData.sortOrder}
                  onChange={(event) => setFormData((current) => ({ ...current, sortOrder: event.target.value }))}
                  disabled={saving}
                />
              </div>

              <div className="roles-form-checks">
                <label className="roles-check">
                  <input
                    type="checkbox"
                    checked={formData.canRequestInventory}
                    onChange={(event) => setFormData((current) => ({ ...current, canRequestInventory: event.target.checked }))}
                    disabled={saving || editingArea?.id === "almacen"}
                  />
                  Puede hacer requisiciones
                </label>
                <label className="roles-check">
                  <input
                    type="checkbox"
                    checked={formData.isProductionArea}
                    onChange={(event) => setFormData((current) => ({ ...current, isProductionArea: event.target.checked }))}
                    disabled={saving || editingArea?.id === "almacen"}
                  />
                  Área de producción (KDS)
                </label>
                <label className="roles-check">
                  <input
                    type="checkbox"
                    checked={formData.active}
                    onChange={(event) => setFormData((current) => ({ ...current, active: event.target.checked }))}
                    disabled={saving || editingArea?.id === "almacen"}
                  />
                  Área activa
                </label>
              </div>

              {error && <div className="roles-error compact">{error}</div>}
            </div>

            <footer className="roles-modal-footer">
              <button type="button" className="roles-secondary-btn" onClick={closeForm} disabled={saving}>
                Cancelar
              </button>
              <button
                type="button"
                className="roles-primary-btn"
                onClick={handleSave}
                disabled={saving || !formData.name.trim()}
              >
                {saving ? "Guardando..." : editingArea ? "Guardar cambios" : "Crear área"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
