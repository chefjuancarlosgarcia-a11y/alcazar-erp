import { useCallback, useEffect, useState } from "react"
import {
  createBranch,
  listBranches,
  setBranchActive,
  updateBranch,
  setBranchMain
} from "../../services/financeAccountingFoundationService"
import { canManageAccountingStructure } from "../../utils/financePermissions"
import { DEFAULT_TIMEZONE } from "../../utils/financeAccountingFoundationConstants"

function Field({ label, className = "", children }) {
  return (
    <label className={`finance-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function emptyForm() {
  return {
    code: "",
    name: "",
    legal_name: "",
    address: "",
    timezone: DEFAULT_TIMEZONE,
    opened_at: ""
  }
}

export default function FinanceBranchesTab({ user, notify }) {
  const canManage = canManageAccountingStructure(user)
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ search: "", isActive: "" })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const loadBranches = useCallback(async () => {
    setLoading(true)
    const result = await listBranches({
      search: filters.search || null,
      isActive: filters.isActive === "" ? null : filters.isActive === "active",
      includeInactive: true
    })
    setLoading(false)
    if (result.error) {
      notify(result.error, "error")
      return
    }
    setBranches(result.data)
  }, [filters, notify])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(branch) {
    setEditingId(branch.id)
    setForm({
      code: branch.code,
      name: branch.name,
      legal_name: branch.legal_name || "",
      address: branch.address || "",
      timezone: branch.timezone || DEFAULT_TIMEZONE,
      opened_at: branch.opened_at || ""
    })
    setShowForm(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para administrar sucursales.", "error")

    const payload = {
      name: form.name,
      legal_name: form.legal_name,
      address: form.address,
      timezone: form.timezone,
      opened_at: form.opened_at || null
    }

    const result = editingId
      ? await updateBranch(editingId, payload)
      : await createBranch({ ...payload, code: form.code })

    if (result.error) notify(result.error, "error")
    else {
      notify(editingId ? "Sucursal actualizada." : "Sucursal creada.", "success")
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
      await loadBranches()
    }
  }

  async function makeMain(branch) {
    if (!canManage) return notify("No tienes permiso para administrar sucursales.", "error")
    const result = await setBranchMain(branch.id)
    if (result.error) notify(result.error, "error")
    else {
      notify("Sucursal principal actualizada.", "success")
      await loadBranches()
    }
  }

  async function toggleActive(branch) {
    if (!canManage) return notify("No tienes permiso para administrar sucursales.", "error")
    const result = await setBranchActive(branch.id, !branch.is_active)
    if (result.error) notify(result.error, "error")
    else {
      notify(branch.is_active ? "Sucursal desactivada." : "Sucursal reactivada.", "success")
      await loadBranches()
    }
  }

  return (
    <article className="finance-panel finance-chart-panel">
      <div className="finance-panel__head">
        <div>
          <h2>Sucursales</h2>
          <p className="tasks-muted">
            Catálogo canónico de sucursales compartido por finanzas, POS, inventario y otros módulos.
          </p>
        </div>
        {canManage ? (
          <div className="finance-actions">
            <button type="button" className="tasks-primary" onClick={openCreate}>
              Nueva sucursal
            </button>
          </div>
        ) : null}
      </div>

      <div className="finance-filters finance-chart-filters">
        <input
          type="search"
          placeholder="Buscar por código o nombre"
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
        <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
          <option value="">Activas e inactivas</option>
          <option value="active">Solo activas</option>
          <option value="inactive">Solo inactivas</option>
        </select>
        <button type="button" className="tasks-primary" onClick={loadBranches} disabled={loading}>
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {showForm && canManage ? (
        <form className="finance-form-grid finance-chart-form" onSubmit={handleSubmit}>
          <h3 className="finance-field--full">{editingId ? "Editar sucursal" : "Nueva sucursal"}</h3>
          <Field label="Código">
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              required
              disabled={Boolean(editingId)}
            />
          </Field>
          <Field label="Nombre">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Razón social (opcional)">
            <input value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} />
          </Field>
          <Field label="Dirección">
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="Zona horaria">
            <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          </Field>
          <Field label="Fecha de apertura">
            <input type="date" value={form.opened_at} onChange={(e) => setForm({ ...form, opened_at: e.target.value })} />
          </Field>
          <div className="finance-actions finance-field--full">
            <button type="submit" className="tasks-primary">{editingId ? "Guardar cambios" : "Crear sucursal"}</button>
            <button type="button" className="tasks-secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <div className="finance-table-wrap">
        <table className="finance-table finance-chart-table">
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Zona horaria</th>
              <th>Principal</th>
              <th>Estado</th>
              {canManage ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {branches.map((row) => (
              <tr key={row.id} className={row.is_active ? "" : "finance-chart-row--inactive"}>
                <td>{row.code}</td>
                <td>{row.name}</td>
                <td>{row.timezone}</td>
                <td>
                  {row.is_main ? (
                    <span className="finance-badge finance-badge--collected">Principal</span>
                  ) : "—"}
                </td>
                <td>
                  <span className={`finance-badge ${row.is_active ? "finance-badge--paid" : "finance-badge--cancelled"}`}>
                    {row.is_active ? "Activa" : "Inactiva"}
                  </span>
                </td>
                {canManage ? (
                  <td>
                    <div className="finance-actions">
                        <button type="button" className="tasks-link" onClick={() => openEdit(row)}>Editar</button>
                        {!row.is_main && row.is_active ? (
                          <button type="button" className="tasks-link" onClick={() => makeMain(row)}>
                            Hacer principal
                          </button>
                        ) : null}
                        <button type="button" className="tasks-link" onClick={() => toggleActive(row)}>
                        {row.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {!branches.length && !loading ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="tasks-muted">
                  No hay sucursales registradas.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  )
}
