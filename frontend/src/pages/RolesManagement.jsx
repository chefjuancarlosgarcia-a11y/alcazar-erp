import { useEffect, useMemo, useState } from "react"
import { useAuth } from "../context/AuthContext"
import * as userRolesService from "../services/userRolesService"
import { canManageRoleCatalog } from "../utils/profilePermissions"
import "./RolesManagement.css"

const ROLE_CATALOG_DENIED_MESSAGE = "Solo Administración puede administrar el catálogo de roles."

const FUTURE_MODULES = [
  "Dashboard",
  "Inventario",
  "Punto de venta",
  "Caja",
  "Producción",
  "Recursos humanos",
  "Tareas",
  "Reportes",
  "Configuración"
]

const EMPTY_FORM = {
  role_name: "",
  description: "",
  is_active: true,
  hr_assignable: false
}

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

function RolesManagement({ embedded = false }) {
  const { user } = useAuth()
  const [roles, setRoles] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [editingRole, setEditingRole] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")

  const canManageCatalog = canManageRoleCatalog(user)
  const previewRoleKey = useMemo(
    () => userRolesService.normalizeRoleName(formData.role_name),
    [formData.role_name]
  )

  useEffect(() => {
    if (canManageCatalog) loadRoles()
  }, [canManageCatalog])

  async function loadRoles() {
    try {
      setLoading(true)
      setError("")
      const data = await userRolesService.getAllUserRoles()
      setRoles(data || [])
    } catch (err) {
      console.error("Error loading roles:", err)
      setError(err.message || "Error al cargar los roles")
    } finally {
      setLoading(false)
    }
  }

  const filteredRoles = useMemo(() => {
    const query = search.trim().toLowerCase()
    return roles.filter((role) => {
      if (filter === "active" && !role.is_active) return false
      if (filter === "inactive" && role.is_active) return false
      if (filter === "system" && !role.is_system) return false
      if (filter === "deprecated" && !userRolesService.isDeprecatedRole(role)) return false
      if (filter === "hr_assignable" && !role.hr_assignable) return false
      if (!query) return true
      return (
        String(role.role_name || "").toLowerCase().includes(query)
        || String(role.role_key || "").toLowerCase().includes(query)
      )
    })
  }, [roles, filter, search])

  const filterCounts = useMemo(() => ({
    all: roles.length,
    active: roles.filter((role) => role.is_active).length,
    inactive: roles.filter((role) => !role.is_active).length,
    system: roles.filter((role) => role.is_system).length,
    deprecated: roles.filter((role) => userRolesService.isDeprecatedRole(role)).length,
    hr_assignable: roles.filter((role) => role.hr_assignable).length
  }), [roles])

  function openCreate() {
    if (!canManageCatalog) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    setEditingRole(null)
    setFormData(EMPTY_FORM)
    setShowForm(true)
    setError("")
  }

  function openEdit(role) {
    if (!canManageCatalog) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    if (userRolesService.isProtectedRoleKey(role.role_key)) {
      setError("Los roles admin y gerente_general no se pueden editar.")
      return
    }
    setEditingRole(role)
    setFormData({
      role_name: role.role_name,
      description: role.description || "",
      is_active: role.is_active !== false,
      hr_assignable: role.hr_assignable === true
    })
    setShowForm(true)
    setError("")
  }

  function closeForm() {
    setShowForm(false)
    setEditingRole(null)
    setFormData(EMPTY_FORM)
    setError("")
  }

  async function handleSave() {
    if (!canManageCatalog) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }

    try {
      setSaving(true)
      setError("")

      const roleName = formData.role_name.trim()
      if (!roleName) {
        setError("El nombre visible del rol es obligatorio")
        return
      }

      if (!editingRole) {
        const roleKey = userRolesService.normalizeRoleName(roleName)
        if (!roleKey) {
          setError("No se pudo generar una clave válida para el rol")
          return
        }
        if (userRolesService.RESERVED_CREATE_ROLE_KEYS.has(roleKey)) {
          setError("No se pueden crear roles reservados como admin o gerente_general")
          return
        }
        if (roles.some((role) => role.role_key === roleKey)) {
          setError(`El rol con clave "${roleKey}" ya existe`)
          return
        }

        const created = await userRolesService.createUserRole({
          role_name: roleName,
          description: formData.description,
          is_active: formData.is_active,
          hr_assignable: formData.hr_assignable
        })
        setRoles((current) => [...current, created].sort((a, b) => a.role_name.localeCompare(b.role_name)))
        setMessage(`Rol "${created.role_name}" creado correctamente`)
      } else {
        const updated = await userRolesService.updateUserRole(editingRole.id, {
          role_name: roleName,
          description: formData.description,
          is_active: formData.is_active,
          hr_assignable: formData.hr_assignable
        })
        setRoles((current) => current.map((role) => (role.id === updated.id ? updated : role)))
        setMessage(`Rol "${updated.role_name}" actualizado correctamente`)
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
    if (!canManageCatalog) {
      setError(ROLE_CATALOG_DENIED_MESSAGE)
      return
    }
    if (userRolesService.isProtectedRoleKey(role.role_key)) {
      setError("Los roles admin y gerente_general no se pueden desactivar.")
      return
    }

    try {
      setSaving(true)
      setError("")

      const updated = role.is_active
        ? await userRolesService.deactivateUserRole(role.id, role.role_key)
        : await userRolesService.activateUserRole(role.id)

      setRoles((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setMessage(`Rol ${updated.is_active ? "activado" : "desactivado"} correctamente`)
    } catch (err) {
      console.error("Error toggling role:", err)
      setError(err.message || "Error al cambiar el estado del rol")
    } finally {
      setSaving(false)
    }
  }

  if (!canManageCatalog) {
    return (
      <section className="roles-management">
        <h1>Roles y permisos</h1>
        <div className="roles-error">
          No tienes permiso para administrar el catálogo de roles.
        </div>
      </section>
    )
  }

  return (
    <section className={`roles-management${embedded ? " embedded" : ""}`}>
      {!embedded && (
        <header className="roles-header">
          <div>
            <p className="roles-eyebrow">Configuración</p>
            <h1>Roles y permisos</h1>
            <p>Administra el catálogo de roles de la empresa. Solo Administración puede crear o modificar roles.</p>
          </div>
          <button
            className="roles-primary-btn"
            onClick={openCreate}
            disabled={loading || saving}
          >
            + Crear rol
          </button>
        </header>
      )}

      {embedded && (
        <div className="hr-catalogs-panel-toolbar">
          <p className="hr-catalogs-panel-copy">
            Los roles definen accesos y qué puede asignar RRHH al crear o editar colaboradores.
          </p>
          <button
            type="button"
            className="roles-primary-btn"
            onClick={openCreate}
            disabled={loading || saving}
          >
            + Crear rol
          </button>
        </div>
      )}

      {message && <div className="roles-success" role="status">{message}</div>}
      {error && !showForm && <div className="roles-error" role="alert">{error}</div>}

      <div className="roles-toolbar">
        <input
          type="search"
          className="roles-search"
          placeholder="Buscar por nombre o role_key..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="roles-filters">
        {[
          ["all", "Todos"],
          ["active", "Activos"],
          ["inactive", "Inactivos"],
          ["system", "Sistema"],
          ["deprecated", "Deprecated"],
          ["hr_assignable", "Asignables por RRHH"]
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
        <div className="roles-empty">Cargando roles...</div>
      ) : filteredRoles.length === 0 ? (
        <div className="roles-empty">No hay roles que mostrar con los filtros seleccionados.</div>
      ) : (
        <div className="roles-table">
          <div className="roles-table-header">
            <div>Nombre visible</div>
            <div>Role key</div>
            <div>Estado</div>
            <div>Etiquetas</div>
            <div>RRHH</div>
            <div>Actualización</div>
            <div>Acciones</div>
          </div>
          {filteredRoles.map((role) => {
            const protectedRole = userRolesService.isProtectedRoleKey(role.role_key)
            const deprecatedRole = userRolesService.isDeprecatedRole(role)
            const editable = !protectedRole

            return (
              <div key={role.id} className={`roles-table-row ${!role.is_active ? "inactive" : ""}`}>
                <div className="roles-name">
                  <strong>{role.role_name}</strong>
                  {role.description && <small>{role.description}</small>}
                </div>
                <div className="roles-key">
                  <code>{role.role_key}</code>
                </div>
                <div>
                  <span className={`roles-status-badge ${role.is_active ? "active" : "inactive"}`}>
                    {role.is_active ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <div className="roles-badge-group">
                  {protectedRole && <span className="roles-type-badge protected">Protegido</span>}
                  {role.is_system && <span className="roles-type-badge system">Sistema</span>}
                  {!role.is_system && <span className="roles-type-badge custom">Personalizado</span>}
                  {deprecatedRole && <span className="roles-type-badge deprecated">Deprecated</span>}
                </div>
                <div>
                  <span className={`roles-status-badge ${role.hr_assignable ? "active" : "inactive"}`}>
                    {role.hr_assignable ? "Sí" : "No"}
                  </span>
                </div>
                <div className="roles-dates">
                  <small>Creado: {formatDate(role.created_at)}</small>
                  <small>Actualizado: {formatDate(role.updated_at)}</small>
                </div>
                <div className="roles-actions">
                  {editable ? (
                    <>
                      <button
                        type="button"
                        className="roles-action-btn edit"
                        onClick={() => openEdit(role)}
                        disabled={saving}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className={`roles-action-btn ${role.is_active ? "deactivate" : "activate"}`}
                        onClick={() => handleToggleActive(role)}
                        disabled={saving}
                      >
                        {role.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </>
                  ) : (
                    <span className="roles-system-note">Rol protegido del sistema</span>
                  )}
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
                <label>Nombre visible *</label>
                <input
                  type="text"
                  value={formData.role_name}
                  onChange={(event) => setFormData((current) => ({ ...current, role_name: event.target.value }))}
                  placeholder='Ej: Jefe de Barra'
                  disabled={saving}
                  required
                />
              </div>

              {!editingRole && (
                <div className="roles-form-field">
                  <label>Role key (generado automáticamente)</label>
                  <input type="text" value={previewRoleKey || "—"} readOnly disabled />
                  <small className="roles-field-help">
                    Ejemplo: &quot;Jefe de Barra&quot; → <code>jefe_de_barra</code>
                  </small>
                </div>
              )}

              {editingRole && (
                <div className="roles-form-field">
                  <label>Role key</label>
                  <input type="text" value={editingRole.role_key} readOnly disabled />
                  {editingRole.is_system && (
                    <small className="roles-field-help">Los roles de sistema no permiten cambiar la clave.</small>
                  )}
                </div>
              )}

              <div className="roles-form-field">
                <label>Descripción</label>
                <textarea
                  value={formData.description}
                  onChange={(event) => setFormData((current) => ({ ...current, description: event.target.value }))}
                  placeholder="Descripción opcional del rol"
                  disabled={saving}
                  rows="4"
                />
              </div>

              <div className="roles-form-checks">
                <label className="roles-check">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(event) => setFormData((current) => ({ ...current, is_active: event.target.checked }))}
                    disabled={saving || (editingRole && userRolesService.isProtectedRoleKey(editingRole.role_key))}
                  />
                  Rol activo
                </label>
                <label className="roles-check">
                  <input
                    type="checkbox"
                    checked={formData.hr_assignable}
                    onChange={(event) => setFormData((current) => ({ ...current, hr_assignable: event.target.checked }))}
                    disabled={saving}
                  />
                  Permitir asignación por RRHH
                </label>
              </div>

              <div className="roles-future-modules">
                <div>
                  <strong>Módulos permitidos</strong>
                  <p>Disponible en una fase futura. Por ahora los permisos siguen la configuración estática del sistema.</p>
                </div>
                <div className="roles-future-modules-grid">
                  {FUTURE_MODULES.map((moduleName) => (
                    <label key={moduleName} className="roles-check disabled">
                      <input type="checkbox" disabled />
                      {moduleName}
                    </label>
                  ))}
                </div>
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
                {saving ? "Guardando..." : editingRole ? "Guardar cambios" : "Crear rol"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  )
}

export default RolesManagement
