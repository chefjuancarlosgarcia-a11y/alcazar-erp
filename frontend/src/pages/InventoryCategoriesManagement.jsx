import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import {
  createInventoryCategory,
  deactivateInventoryCategory,
  listInventoryCategoriesWithUsage,
  reactivateInventoryCategory,
  updateInventoryCategory
} from "../services/inventoryCategoriesService"
import {
  findSimilarInventoryCategory,
  slugifyInventoryCategoryCode
} from "../utils/inventoryCategoryUtils"
import "./RolesManagement.css"
import "./InventoryCategoriesManagement.css"

const MANAGER_ROLES = ["admin", "gerente_general", "encargado_almacen"]

const EMPTY_FORM = {
  name: "",
  code: "",
  sortOrder: "",
  isActive: true,
  codeTouched: false
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

export default function InventoryCategoriesManagement() {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)

  const previewCode = useMemo(() => {
    if (formData.codeTouched || editingCategory) return formData.code
    return slugifyInventoryCategoryCode(formData.name)
  }, [editingCategory, formData.code, formData.codeTouched, formData.name])

  const editingUsageCount = editingCategory?.productCount || 0

  useEffect(() => {
    if (canManage) loadCategories()
  }, [canManage])

  async function loadCategories() {
    try {
      setLoading(true)
      setError("")
      const { data, error: loadError } = await listInventoryCategoriesWithUsage({ includeInactive: true })
      if (loadError) throw loadError
      setCategories(data || [])
    } catch (err) {
      console.error("Error loading inventory categories:", err)
      setError(err.message || "Error al cargar las categorías de inventario")
    } finally {
      setLoading(false)
    }
  }

  const filteredCategories = useMemo(() => {
    const query = search.trim().toLowerCase()
    return categories.filter((category) => {
      if (filter === "active" && !category.isActive) return false
      if (filter === "inactive" && category.isActive) return false
      if (!query) return true
      return (
        String(category.name || "").toLowerCase().includes(query)
        || String(category.code || "").toLowerCase().includes(query)
      )
    })
  }, [categories, filter, search])

  const filterCounts = useMemo(() => ({
    all: categories.length,
    active: categories.filter((category) => category.isActive).length,
    inactive: categories.filter((category) => !category.isActive).length
  }), [categories])

  function openCreate() {
    setEditingCategory(null)
    setFormData(EMPTY_FORM)
    setShowForm(true)
    setError("")
  }

  function openEdit(category) {
    setEditingCategory(category)
    setFormData({
      name: category.name,
      code: category.code,
      sortOrder: String(category.sortOrder ?? 0),
      isActive: category.isActive !== false,
      codeTouched: true
    })
    setShowForm(true)
    setError("")
  }

  function closeForm() {
    setShowForm(false)
    setEditingCategory(null)
    setFormData(EMPTY_FORM)
    setError("")
  }

  async function handleSave() {
    const payload = {
      name: formData.name,
      code: previewCode,
      sortOrder: formData.sortOrder,
      isActive: formData.isActive
    }

    const similar = findSimilarInventoryCategory(payload.name, categories, editingCategory?.id || "")
    if (similar) {
      setError(`Ya existe una categoría similar: "${similar.name}".`)
      return
    }

    try {
      setSaving(true)
      setError("")

      const result = editingCategory
        ? await updateInventoryCategory(editingCategory.id, payload, {
            existingCategories: categories,
            productCount: editingCategory.productCount || 0
          })
        : await createInventoryCategory(payload, { existingCategories: categories })

      if (result.error) throw result.error

      setCategories((current) => {
        const next = editingCategory
          ? current.map((category) => (category.id === result.data.id ? { ...result.data, productCount: editingCategory.productCount || 0 } : category))
          : [...current, { ...result.data, productCount: 0 }]
        return next.sort((left, right) => {
          const orderDiff = Number(left.sortOrder || 0) - Number(right.sortOrder || 0)
          if (orderDiff !== 0) return orderDiff
          return String(left.name || "").localeCompare(String(right.name || ""), "es")
        })
      })
      setMessage(`Categoría "${result.data.name}" ${editingCategory ? "actualizada" : "creada"} correctamente`)
      closeForm()
      await loadCategories()
    } catch (err) {
      console.error("Error saving inventory category:", err)
      setError(err.message || "Error al guardar la categoría")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(category) {
    if (category.isActive) {
      const productCount = category.productCount || 0
      const confirmMessage = productCount > 0
        ? `¿Desactivar "${category.name}"?\n\nHay ${productCount} producto(s) usando esta categoría. Seguirán mostrándola, pero ya no aparecerá en productos nuevos.`
        : `¿Desactivar la categoría "${category.name}"?`
      if (!window.confirm(confirmMessage)) return
    }

    try {
      setSaving(true)
      setError("")
      const result = category.isActive
        ? await deactivateInventoryCategory(category.id)
        : await reactivateInventoryCategory(category.id)
      if (result.error) throw result.error
      setMessage(`Categoría ${result.data.isActive ? "activada" : "desactivada"} correctamente`)
      await loadCategories()
    } catch (err) {
      console.error("Error toggling inventory category:", err)
      setError(err.message || "Error al cambiar el estado de la categoría")
    } finally {
      setSaving(false)
    }
  }

  if (!canManage) {
    return (
      <section className="roles-management">
        <article className="roles-empty inventory-categories-denied">
          <h1>Categorías de inventario</h1>
          <p>Solo Administración, Gerencia General o el Encargado de Almacén pueden administrar categorías.</p>
          <Link className="roles-secondary-btn" to="/inventory?section=inventario">Volver a productos</Link>
        </article>
      </section>
    )
  }

  return (
    <section className="roles-management inventory-categories-page">
      <header className="roles-header">
        <div>
          <p className="roles-eyebrow">Inventario · Catálogos</p>
          <h1>Categorías de inventario</h1>
          <p>
            Administra las categorías usadas en productos, reportes, requisiciones e importaciones.
            Los productos existentes conservan su categoría aunque esté inactiva.
          </p>
        </div>
        <div className="inventory-categories-header-actions">
          <Link className="roles-secondary-btn" to="/inventory?section=inventario">Volver a productos</Link>
          <button type="button" className="roles-primary-btn" onClick={openCreate} disabled={loading || saving}>
            + Crear categoría
          </button>
        </div>
      </header>

      {message && <div className="roles-success" role="status">{message}</div>}
      {error && !showForm && <div className="roles-error" role="alert">{error}</div>}

      <div className="roles-toolbar">
        <input
          type="search"
          className="roles-search"
          placeholder="Buscar por nombre o código..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="roles-filters">
        {[
          ["all", "Todas"],
          ["active", "Activas"],
          ["inactive", "Inactivas"]
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
        <div className="roles-empty">Cargando categorías...</div>
      ) : filteredCategories.length === 0 ? (
        <div className="roles-empty">
          {categories.length === 0
            ? "No hay categorías configuradas todavía. Crea la primera categoría para usarla en productos."
            : "No hay categorías que mostrar con los filtros seleccionados."}
        </div>
      ) : (
        <div className="roles-table categories-table">
          <div className="roles-table-header categories-table-header">
            <div>Nombre</div>
            <div>Código</div>
            <div>Estado</div>
            <div>Orden</div>
            <div>Productos</div>
            <div>Acciones</div>
          </div>
          {filteredCategories.map((category) => (
            <div key={category.id} className={`roles-table-row categories-table-row ${!category.isActive ? "inactive" : ""}`}>
              <div className="roles-name">
                <strong>{category.name}</strong>
                <small>Actualizada: {formatDate(category.updatedAt)}</small>
              </div>
              <div className="roles-key"><code>{category.code}</code></div>
              <div>
                <span className={`roles-status-badge ${category.isActive ? "active" : "inactive"}`}>
                  {category.isActive ? "Activa" : "Inactiva"}
                </span>
              </div>
              <div>{category.sortOrder ?? 0}</div>
              <div>{category.productCount || 0}</div>
              <div className="roles-actions">
                <button type="button" className="roles-action-btn edit" onClick={() => openEdit(category)} disabled={saving}>
                  Editar
                </button>
                <button
                  type="button"
                  className={`roles-action-btn ${category.isActive ? "deactivate" : "activate"}`}
                  onClick={() => handleToggleActive(category)}
                  disabled={saving}
                >
                  {category.isActive ? "Desactivar" : "Activar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <div className="roles-modal-overlay">
          <div className="roles-modal">
            <header className="roles-modal-header">
              <div>
                <p className="roles-eyebrow">{editingCategory ? "Editar categoría" : "Nueva categoría"}</p>
                <h2>{editingCategory ? editingCategory.name : "Crear categoría de inventario"}</h2>
              </div>
              <button type="button" className="roles-close-btn" onClick={closeForm} disabled={saving}>✕</button>
            </header>

            <div className="roles-modal-body">
              <div className="roles-form-field">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(event) => setFormData((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Ej: Lácteos, Carnes, Empaques"
                  disabled={saving}
                  required
                />
              </div>

              <div className="roles-form-field">
                <label>
                  Código {editingCategory && editingUsageCount > 0 ? "(bloqueado por uso)" : editingCategory ? "" : "(generado automáticamente)"}
                </label>
                <input
                  type="text"
                  value={previewCode || ""}
                  onChange={(event) => setFormData((current) => ({
                    ...current,
                    code: event.target.value.toLowerCase(),
                    codeTouched: true
                  }))}
                  placeholder="lacteos"
                  disabled={saving || Boolean(editingCategory && editingUsageCount > 0)}
                />
                {!editingCategory && (
                  <small className="inventory-categories-hint">
                    Se genera en minúsculas, sin tildes ni espacios. Puedes editarlo antes de guardar.
                  </small>
                )}
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
                    checked={formData.isActive}
                    onChange={(event) => setFormData((current) => ({ ...current, isActive: event.target.checked }))}
                    disabled={saving}
                  />
                  Categoría activa
                </label>
              </div>

              {editingCategory && editingUsageCount > 0 && (
                <div className="inventory-categories-warning">
                  Hay {editingUsageCount} producto(s) con la categoría «{editingCategory.name}».
                  Cambiar el nombre no actualiza esos productos automáticamente.
                </div>
              )}

              {error && <div className="roles-error compact">{error}</div>}
            </div>

            <footer className="roles-modal-footer">
              <button type="button" className="roles-secondary-btn" onClick={closeForm} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="roles-primary-btn" onClick={handleSave} disabled={saving || !formData.name.trim()}>
                {saving ? "Guardando..." : editingCategory ? "Guardar cambios" : "Crear categoría"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}
