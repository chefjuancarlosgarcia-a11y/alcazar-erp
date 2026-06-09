import { useEffect, useState } from "react"
import { useAuth } from "../context/AuthContext"
import * as userRolesService from "../services/userRolesService"
import { canManageRoleCatalog } from "../utils/profilePermissions"
import "./RolesManagement.css"

const ROLE_CATALOG_DENIED_MESSAGE = "Solo Administración puede crear roles personalizados."

function RolesManagement() {
  const { user } = useAuth()
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [editingRole, setEditingRole] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState({
    role_name: "",
    category: "Personalizado",
    description: ""
  })
  const [filter, setFilter] = useState("all")

  useEffect(() => {
    loadRoles()
  }, [])

  async function loadRoles() {
    try {
      setLoading(true)
      setError("")
      const data = await userRolesService.getAllUserRoles()
      setRoles(data || [])
    } catch (err) {
      console.error("Error loading roles:", err)
      setError("Error al cargar los roles")
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    if (!canManageRoleCatalog(user)) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    try {
      setSaving(true)
      setError("")

      if (!formData.role_name.trim()) {
        setError("El nombre del rol es obligatorio")
        setSaving(false)
        return
      }

      if (editingRole) {
        // Update existing role
        const updated = await userRolesService.updateUserRole(editingRole.id, {
          role_name: formData.role_name.trim(),
          category: formData.category || "Personalizado",
          description: formData.description || ""
        })

        setRoles(
          roles.map((r) => (r.id === editingRole.id ? updated : r))
        )

        setMessage("Rol actualizado exitosamente")
      } else {
        // Create new role
        const newRole = await userRolesService.createUserRole({
          role_name: formData.role_name.trim(),
          category: formData.category || "Personalizado",
          description: formData.description || ""
        })

        setRoles([...roles, newRole])
        setMessage("Rol creado exitosamente")
      }

      closeForm()
    } catch (err) {
      console.error("Error saving role:", err)
      setError(err.message || "Error al guardar el rol")
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(role) {
    if (!canManageRoleCatalog(user)) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    try {
      setSaving(true)
      setError("")

      const updated = await userRolesService.updateUserRole(role.id, {
        is_active: !role.is_active
      })

      setRoles(roles.map((r) => (r.id === role.id ? updated : r)))
      setMessage(
        `Rol ${updated.is_active ? "activado" : "desactivado"} exitosamente`
      )
    } catch (err) {
      console.error("Error toggling role:", err)
      setError(err.message || "Error al cambiar el estado del rol")
    } finally {
      setSaving(false)
    }
  }

  function openEdit(role) {
    if (!canManageRoleCatalog(user)) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    setEditingRole(role)
    setFormData({
      role_name: role.role_name,
      category: role.category || "Personalizado",
      description: role.description || ""
    })
    setShowCreate(true)
  }

  function openCreate() {
    if (!canManageRoleCatalog(user)) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    setEditingRole(null)
    setFormData({
      role_name: "",
      category: "Personalizado",
      description: ""
    })
    setShowCreate(true)
  }

  function closeForm() {
    setShowCreate(false)
    setEditingRole(null)
    setFormData({
      role_name: "",
      category: "Personalizado",
      description: ""
    })
    setError("")
  }

  const canManageCatalog = canManageRoleCatalog(user)
  const filteredRoles = roles.filter((role) => {
    if (filter === "active") return role.is_active
    if (filter === "inactive") return !role.is_active
    if (filter === "system") return role.is_system
    return true
  })

  if (!canManageCatalog) {
    return (
      <section className="roles-management">
        <h1>Gestión de Roles</h1>
        <div className="roles-error">
          No tienes permiso para administrar el catálogo de roles.
        </div>
      </section>
    )
  }

  return (
    <section className="roles-management">
      <header className="roles-header">
        <div>
          <h1>Gestión de Roles de Usuario</h1>
          <p>Crear, editar y administrar roles personalizados para tu organización.</p>
        </div>
        <button 
          className="roles-primary-btn"
          onClick={openCreate}
          disabled={loading || saving}
        >
          + Crear Rol
        </button>
      </header>

      {message && <div className="roles-success" role="status">{message}</div>}
      {error && <div className="roles-error" role="alert">{error}</div>}

      <div className="roles-filters">
        <button 
          className={`roles-filter-btn ${filter === "all" ? "active" : ""}`}
          onClick={() => setFilter("all")}
        >
          Todos ({roles.length})
        </button>
        <button 
          className={`roles-filter-btn ${filter === "active" ? "active" : ""}`}
          onClick={() => setFilter("active")}
        >
          Activos ({roles.filter((r) => r.is_active).length})
        </button>
        <button 
          className={`roles-filter-btn ${filter === "inactive" ? "active" : ""}`}
          onClick={() => setFilter("inactive")}
        >
          Inactivos ({roles.filter((r) => !r.is_active).length})
        </button>
        <button 
          className={`roles-filter-btn ${filter === "system" ? "active" : ""}`}
          onClick={() => setFilter("system")}
        >
          Sistema ({roles.filter((r) => r.is_system).length})
        </button>
      </div>

      {loading ? (
        <div className="roles-empty">Cargando roles...</div>
      ) : filteredRoles.length === 0 ? (
        <div className="roles-empty">No hay roles que mostrar con los filtros seleccionados.</div>
      ) : (
        <div className="roles-table">
          <div className="roles-table-header">
            <div>Nombre del Rol</div>
            <div>Categoría</div>
            <div>Clave</div>
            <div>Estado</div>
            <div>Tipo</div>
            <div>Acciones</div>
          </div>
          {filteredRoles.map((role) => (
            <div key={role.id} className={`roles-table-row ${!role.is_active ? "inactive" : ""}`}>
              <div className="roles-name">
                <strong>{role.role_name}</strong>
                {role.description && <small>{role.description}</small>}
              </div>
              <div>{role.category || "-"}</div>
              <div className="roles-key">
                <code>{role.role_key}</code>
              </div>
              <div>
                <span className={`roles-status-badge ${role.is_active ? "active" : "inactive"}`}>
                  {role.is_active ? "Activo" : "Inactivo"}
                </span>
              </div>
              <div>
                <span className={`roles-type-badge ${role.is_system ? "system" : "custom"}`}>
                  {role.is_system ? "Sistema" : "Personalizado"}
                </span>
              </div>
              <div className="roles-actions">
                {!role.is_system && (
                  <>
                    <button 
                      className="roles-action-btn edit"
                      onClick={() => openEdit(role)}
                      title="Editar rol"
                    >
                      Editar
                    </button>
                    <button 
                      className={`roles-action-btn ${role.is_active ? "deactivate" : "activate"}`}
                      onClick={() => handleToggleActive(role)}
                      disabled={saving}
                      title={role.is_active ? "Desactivar rol" : "Activar rol"}
                    >
                      {role.is_active ? "Desactivar" : "Activar"}
                    </button>
                  </>
                )}
                {role.is_system && (
                  <span className="roles-system-note">Rol del sistema (No editable)</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <div className="roles-modal-overlay">
          <div className="roles-modal">
            <header className="roles-modal-header">
              <div>
                <p className="roles-eyebrow">{editingRole ? "Editar rol" : "Nuevo rol"}</p>
                <h2>{editingRole ? editingRole.role_name : "Crear rol personalizado"}</h2>
              </div>
              <button 
                type="button"
                className="roles-close-btn"
                onClick={closeForm}
                disabled={saving}
              >
                ✕
              </button>
            </header>

            <div className="roles-modal-body">
              <div className="roles-form-field">
                <label>Nombre del rol *</label>
                <input 
                  type="text"
                  value={formData.role_name}
                  onChange={(e) => setFormData({ ...formData, role_name: e.target.value })}
                  placeholder="Ej: Closing Concierge"
                  disabled={saving}
                  required
                />
              </div>

              <div className="roles-form-field">
                <label>Categoría</label>
                <input 
                  type="text"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="Ej: Servicio"
                  disabled={saving}
                />
              </div>

              <div className="roles-form-field">
                <label>Descripción</label>
                <textarea 
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Descripción opcional del rol"
                  disabled={saving}
                  rows="4"
                />
              </div>

              {error && <div className="roles-error compact">{error}</div>}
            </div>

            <footer className="roles-modal-footer">
              <button 
                type="button"
                className="roles-secondary-btn"
                onClick={closeForm}
                disabled={saving}
              >
                Cancelar
              </button>
              <button 
                type="button"
                className="roles-primary-btn"
                onClick={handleSave}
                disabled={saving || !formData.role_name.trim()}
              >
                {saving ? "Guardando..." : editingRole ? "Actualizar" : "Crear Rol"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

export default RolesManagement
