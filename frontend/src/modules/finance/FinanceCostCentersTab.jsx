import { useCallback, useEffect, useMemo, useState } from "react"
import {
  createFinanceCostCenter,
  listBranches,
  listFinanceCostCenters,
  setFinanceCostCenterActive,
  updateFinanceCostCenter
} from "../../services/financeAccountingFoundationService"
import { canManageAccountingStructure } from "../../utils/financePermissions"
import {
  COST_CENTER_KIND_LABELS,
  COST_CENTER_KINDS
} from "../../utils/financeAccountingFoundationConstants"

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
    parent_id: "",
    branch_id: "",
    maps_to_area_id: "",
    account_kind: "detail",
    description: ""
  }
}

export default function FinanceCostCentersTab({ user, notify }) {
  const canManage = canManageAccountingStructure(user)
  const [centers, setCenters] = useState([])
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({ search: "", branchId: "", isActive: "" })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())

  const parentOptions = useMemo(
    () => centers.filter((row) => row.account_kind === "header" || row.id === form.parent_id),
    [centers, form.parent_id]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    const [centersResult, branchesResult] = await Promise.all([
      listFinanceCostCenters({
        search: filters.search || null,
        branchId: filters.branchId || null,
        isActive: filters.isActive === "" ? null : filters.isActive === "active",
        includeInactive: true
      }),
      listBranches({ includeInactive: true })
    ])
    setLoading(false)
    if (centersResult.error) notify(centersResult.error, "error")
    else setCenters(centersResult.data)
    if (branchesResult.error) notify(branchesResult.error, "error")
    else setBranches(branchesResult.data)
  }, [filters, notify])

  useEffect(() => {
    loadData()
  }, [loadData])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(center) {
    setEditingId(center.id)
    setForm({
      code: center.code,
      name: center.name,
      parent_id: center.parent_id || "",
      branch_id: center.branch_id || "",
      maps_to_area_id: center.maps_to_area_id || "",
      account_kind: center.account_kind,
      description: center.description || ""
    })
    setShowForm(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para administrar centros de costo.", "error")

    const payload = {
      name: form.name,
      parent_id: form.parent_id || null,
      branch_id: form.branch_id || null,
      maps_to_area_id: form.account_kind === "header" ? null : (form.maps_to_area_id || null),
      account_kind: form.account_kind,
      description: form.description
    }

    const result = editingId
      ? await updateFinanceCostCenter(editingId, payload)
      : await createFinanceCostCenter({ ...payload, code: form.code })

    if (result.error) notify(result.error, "error")
    else {
      notify(editingId ? "Centro de costo actualizado." : "Centro de costo creado.", "success")
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
      await loadData()
    }
  }

  async function toggleActive(center) {
    if (!canManage) return notify("No tienes permiso para administrar centros de costo.", "error")
    const result = await setFinanceCostCenterActive(center.id, !center.is_active)
    if (result.error) notify(result.error, "error")
    else {
      notify(center.is_active ? "Centro desactivado." : "Centro reactivado.", "success")
      await loadData()
    }
  }

  return (
    <article className="finance-panel finance-chart-panel">
      <div className="finance-panel__head">
        <div>
          <h2>Centros de costo</h2>
          <p className="tasks-muted">
            Catálogo jerárquico para imputación contable. Los centros no se eliminan físicamente; se desactivan.
          </p>
        </div>
        {canManage ? (
          <div className="finance-actions">
            <button type="button" className="tasks-primary" onClick={openCreate}>
              Nuevo centro
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
        <select value={filters.branchId} onChange={(e) => setFilters({ ...filters, branchId: e.target.value })}>
          <option value="">Todas las sucursales</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
          ))}
        </select>
        <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
          <option value="">Activos e inactivos</option>
          <option value="active">Solo activos</option>
          <option value="inactive">Solo inactivos</option>
        </select>
        <button type="button" className="tasks-primary" onClick={loadData} disabled={loading}>
          {loading ? "Cargando..." : "Actualizar"}
        </button>
      </div>

      {showForm && canManage ? (
        <form className="finance-form-grid finance-chart-form" onSubmit={handleSubmit}>
          <h3 className="finance-field--full">{editingId ? "Editar centro de costo" : "Nuevo centro de costo"}</h3>
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
          <Field label="Centro padre">
            <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
              <option value="">Sin padre (nivel raíz)</option>
              {parentOptions.map((row) => (
                <option key={row.id} value={row.id}>
                  {"—".repeat(Math.max(0, row.level - 1))} {row.code} · {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sucursal (opcional)">
            <select value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}>
              <option value="">Global / sin sucursal</option>
              {branches.filter((b) => b.is_active).map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select
              value={form.account_kind}
              onChange={(e) => setForm({ ...form, account_kind: e.target.value })}
            >
              {COST_CENTER_KINDS.map((value) => (
                <option key={value} value={value}>{COST_CENTER_KIND_LABELS[value]}</option>
              ))}
            </select>
          </Field>
          {form.account_kind === "detail" ? (
            <Field label="Área operativa (opcional)">
              <input
                value={form.maps_to_area_id}
                onChange={(e) => setForm({ ...form, maps_to_area_id: e.target.value })}
                placeholder="ID de área (solo referencia)"
              />
            </Field>
          ) : null}
          <Field label="Descripción" className="finance-field--full">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </Field>
          <div className="finance-actions finance-field--full">
            <button type="submit" className="tasks-primary">{editingId ? "Guardar cambios" : "Crear centro"}</button>
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
              <th>Sucursal</th>
              <th>Tipo</th>
              <th>Estado</th>
              {canManage ? <th>Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {centers.map((row) => (
              <tr key={row.id} className={row.is_active ? "" : "finance-chart-row--inactive"}>
                <td>
                  <span className="finance-chart-code" style={{ paddingLeft: `${Math.max(0, row.level - 1) * 16}px` }}>
                    {row.code}
                  </span>
                </td>
                <td>{row.name}</td>
                <td>{row.branch_code || "—"}</td>
                <td>{COST_CENTER_KIND_LABELS[row.account_kind] || row.account_kind}</td>
                <td>
                  <span className={`finance-badge ${row.is_active ? "finance-badge--paid" : "finance-badge--cancelled"}`}>
                    {row.is_active ? "Activo" : "Inactivo"}
                  </span>
                </td>
                {canManage ? (
                  <td>
                    <div className="finance-actions">
                      <button type="button" className="tasks-link" onClick={() => openEdit(row)}>Editar</button>
                      <button type="button" className="tasks-link" onClick={() => toggleActive(row)}>
                        {row.is_active ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {!centers.length && !loading ? (
              <tr>
                <td colSpan={canManage ? 6 : 5} className="tasks-muted">
                  No hay centros de costo registrados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  )
}
