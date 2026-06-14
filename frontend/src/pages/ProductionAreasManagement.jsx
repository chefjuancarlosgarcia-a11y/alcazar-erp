import { useEffect, useState } from "react"
import ProductionBackButton from "../components/production/ProductionBackButton"
import ProductionToast from "../components/production/ProductionToast"
import { useAuth } from "../context/AuthContext"
import { canManageProductionAreas } from "../utils/kds"
import {
  deactivateProductionArea,
  getProductionAreasEnriched,
  saveProductionArea
} from "../services/productionAreasService"
import "./Production.css"

const EMPTY_FORM = {
  id: "",
  name: "",
  description: "",
  sortOrder: 0,
  active: true
}

export default function ProductionAreasManagement() {
  const { user } = useAuth()
  const [areas, setAreas] = useState([])
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")
  const [toastTone, setToastTone] = useState("info")

  async function refresh() {
    setLoading(true)
    const { data, error } = await getProductionAreasEnriched()
    if (error) {
      setMessage(error.message || "No se pudieron cargar las áreas.")
      setToastTone("error")
    } else {
      setAreas(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    refresh()
  }, [])

  if (!canManageProductionAreas(user)) {
    return (
      <section className="production-admin">
        <ProductionBackButton />
        <article className="production-empty-card"><p>No tienes permiso para administrar áreas de producción.</p></article>
      </section>
    )
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setMessage("El nombre del área es obligatorio.")
      setToastTone("error")
      return
    }
    setSaving(true)
    try {
      await saveProductionArea(form, editingId)
      setMessage(editingId ? "Área actualizada correctamente." : "Área creada correctamente.")
      setToastTone("success")
      setForm(EMPTY_FORM)
      setEditingId("")
      await refresh()
    } catch (error) {
      setMessage(error.message || "No se pudo guardar el área.")
      setToastTone("error")
    } finally {
      setSaving(false)
    }
  }

  async function handleDeactivate(area) {
    const confirmed = window.confirm(`¿Desactivar el área "${area.name}"?\n\nLos tickets históricos se conservan, pero dejará de aparecer en Producción.`)
    if (!confirmed) return
    const { error } = await deactivateProductionArea(area.id)
    if (error) {
      setMessage(error.message || "No se pudo desactivar el área.")
      setToastTone("error")
      return
    }
    setMessage(`Área "${area.name}" desactivada.`)
    setToastTone("success")
    if (editingId === area.id) {
      setEditingId("")
      setForm(EMPTY_FORM)
    }
    refresh()
  }

  return (
    <section className="production-admin">
      <ProductionBackButton />
      <header className="production-admin__header">
        <div>
          <p className="kds-eyebrow">Administración</p>
          <h1>Gestión de áreas de producción</h1>
          <p className="production-hub__subtitle">Crea y organiza las estaciones KDS del restaurante.</p>
        </div>
      </header>

      <ProductionToast message={message} tone={toastTone} />

      <div className="production-admin__layout">
        <form className="production-admin__panel" onSubmit={handleSave}>
          <h2>{editingId ? "Editar área" : "Nueva área de producción"}</h2>
          <label>
            Nombre
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} required />
          </label>
          {!editingId && (
            <label>
              Clave (slug)
              <input
                value={form.id}
                placeholder="Ej. cocina, barra, cafeteria"
                onChange={(event) => setForm((current) => ({ ...current, id: event.target.value.trim().toLowerCase() }))}
              />
            </label>
          )}
          <label>
            Descripción
            <textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} rows={3} />
          </label>
          <label>
            Orden
            <input type="number" value={form.sortOrder} onChange={(event) => setForm((current) => ({ ...current, sortOrder: Number(event.target.value || 0) }))} />
          </label>
          <div className="production-admin__actions">
            <button type="submit" className="production-hub__quick-btn" disabled={saving}>
              {saving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear área"}
            </button>
            {editingId && (
              <button type="button" className="production-hub__secondary-btn" onClick={() => { setEditingId(""); setForm(EMPTY_FORM) }}>
                Cancelar edición
              </button>
            )}
          </div>
        </form>

        <div className="production-admin__panel">
          <h2>Áreas activas</h2>
          {loading ? <p>Cargando...</p> : !areas.length ? (
            <p className="production-empty-inline">No hay áreas de producción configuradas.</p>
          ) : (
            <div className="production-admin__list">
              {areas.map((area) => (
                <article key={area.id} className="production-admin__list-item">
                  <div>
                    <strong>{area.name}</strong>
                    <p>{area.description || area.cardSubtitle || "Sin descripción"}</p>
                    <small>Clave: {area.id} · Orden: {area.sortOrder ?? 0}</small>
                  </div>
                  <div className="production-admin__actions">
                    <button
                      type="button"
                      className="production-hub__secondary-btn"
                      onClick={() => {
                        setEditingId(area.id)
                        setForm({
                          id: area.id,
                          name: area.name,
                          description: area.description || "",
                          sortOrder: area.sortOrder ?? 0,
                          active: area.active !== false
                        })
                      }}
                    >
                      Editar
                    </button>
                    <button type="button" className="production-hub__danger-btn" onClick={() => handleDeactivate(area)}>
                      Desactivar
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
