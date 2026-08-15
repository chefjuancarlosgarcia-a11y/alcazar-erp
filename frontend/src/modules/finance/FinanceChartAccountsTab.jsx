import { useCallback, useEffect, useMemo, useState } from "react"
import {
  createFinanceChartAccount,
  listFinanceChartAccounts,
  setFinanceChartAccountActive,
  updateFinanceChartAccount
} from "../../services/financeChartAccountsService"
import { canManageAccountingCatalog } from "../../utils/financePermissions"
import {
  ACCOUNT_KIND_LABELS,
  ACCOUNT_KINDS,
  FINANCIAL_TYPE_LABELS,
  FINANCIAL_TYPES,
  NATURAL_BALANCE_LABELS,
  NATURAL_BALANCES
} from "../../utils/financeChartAccountsConstants"
import {
  DIMENSION_RULE_LABELS,
  DIMENSION_RULES
} from "../../utils/financeAccountingFoundationConstants"
import {
  defaultBranchDimensionRule,
  defaultCostCenterDimensionRule
} from "../../utils/financeAccountingFoundationValidation"

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
    financial_type: "asset",
    natural_balance: "debit",
    account_kind: "detail",
    accepts_entries: true,
    description: "",
    branch_dimension_rule: "optional",
    cost_center_dimension_rule: "optional"
  }
}

function typeBadgeClass(type) {
  if (type === "asset") return "finance-badge--paid"
  if (type === "liability") return "finance-badge--overdue"
  if (type === "equity") return "finance-badge--partial"
  if (type === "income") return "finance-badge--collected"
  return "finance-badge--pending"
}

export default function FinanceChartAccountsTab({ user, notify }) {
  const canManage = canManageAccountingCatalog(user)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [filters, setFilters] = useState({
    search: "",
    financialType: "",
    naturalBalance: "",
    accountKind: "",
    isActive: ""
  })
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [importOpen, setImportOpen] = useState(false)

  const parentOptions = useMemo(
    () => accounts.filter((row) => row.account_kind === "header" || row.id === form.parent_id),
    [accounts, form.parent_id]
  )

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    const result = await listFinanceChartAccounts({
      search: filters.search || null,
      financialType: filters.financialType || null,
      naturalBalance: filters.naturalBalance || null,
      accountKind: filters.accountKind || null,
      isActive: filters.isActive === "" ? null : filters.isActive === "active",
      includeInactive: true
    })
    setLoading(false)
    if (result.error) {
      notify(result.error, "error")
      return
    }
    setAccounts(result.data)
  }, [filters, notify])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm())
    setShowForm(true)
  }

  function openEdit(account) {
    setEditingId(account.id)
    setForm({
      code: account.code,
      name: account.name,
      parent_id: account.parent_id || "",
      financial_type: account.financial_type,
      natural_balance: account.natural_balance,
      account_kind: account.account_kind,
      accepts_entries: account.accepts_entries,
      description: account.description || "",
      branch_dimension_rule: account.branch_dimension_rule || defaultBranchDimensionRule(account.financial_type),
      cost_center_dimension_rule: account.cost_center_dimension_rule || defaultCostCenterDimensionRule(account.financial_type)
    })
    setShowForm(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para administrar el catálogo contable.", "error")

    const payload = {
      name: form.name,
      parent_id: form.parent_id || null,
      financial_type: form.financial_type,
      natural_balance: form.natural_balance,
      account_kind: form.account_kind,
      accepts_entries: form.account_kind === "header" ? false : form.accepts_entries,
      description: form.description,
      branch_dimension_rule: form.branch_dimension_rule,
      cost_center_dimension_rule: form.cost_center_dimension_rule
    }

    const result = editingId
      ? await updateFinanceChartAccount(editingId, payload)
      : await createFinanceChartAccount({ ...payload, code: form.code })

    if (result.error) notify(result.error, "error")
    else {
      notify(editingId ? "Cuenta actualizada." : "Cuenta creada.", "success")
      setShowForm(false)
      setEditingId(null)
      setForm(emptyForm())
      await loadAccounts()
    }
  }

  async function toggleActive(account) {
    if (!canManage) return notify("No tienes permiso para administrar el catálogo contable.", "error")
    const result = await setFinanceChartAccountActive(account.id, !account.is_active)
    if (result.error) notify(result.error, "error")
    else {
      notify(account.is_active ? "Cuenta desactivada." : "Cuenta reactivada.", "success")
      await loadAccounts()
    }
  }

  function downloadTemplate() {
    const headers = ["codigo", "nombre", "codigo_padre", "tipo_financiero", "naturaleza", "tipo_cuenta", "acepta_movimientos", "descripcion"]
    const sample = [
      ["1", "Activos", "", "asset", "debit", "header", "false", "Grupo principal"],
      ["1.01", "Caja", "1", "asset", "debit", "detail", "true", "Caja general"]
    ]
    const lines = [headers.join(","), ...sample.map((row) => row.map((cell) => `"${cell}"`).join(","))]
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "plantilla_catalogo_contable.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <article className="finance-panel finance-chart-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Catálogo contable</h2>
            <p className="tasks-muted">
              Plan de cuentas jerárquico para futuras partidas contables. Esta fase no genera movimientos ni partidas.
            </p>
          </div>
          <div className="finance-actions">
            <button type="button" className="tasks-secondary" onClick={downloadTemplate}>
              Descargar plantilla
            </button>
            {canManage ? (
              <>
                <button type="button" className="tasks-secondary" onClick={() => setImportOpen(true)}>
                  Importar CSV
                </button>
                <button type="button" className="tasks-primary" onClick={openCreate}>
                  Nueva cuenta
                </button>
              </>
            ) : null}
          </div>
        </div>

        <div className="finance-filters finance-chart-filters">
          <input
            type="search"
            placeholder="Buscar por código o nombre"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <select value={filters.financialType} onChange={(e) => setFilters({ ...filters, financialType: e.target.value })}>
            <option value="">Tipo financiero</option>
            {FINANCIAL_TYPES.map((value) => (
              <option key={value} value={value}>{FINANCIAL_TYPE_LABELS[value]}</option>
            ))}
          </select>
          <select value={filters.naturalBalance} onChange={(e) => setFilters({ ...filters, naturalBalance: e.target.value })}>
            <option value="">Naturaleza</option>
            {NATURAL_BALANCES.map((value) => (
              <option key={value} value={value}>{NATURAL_BALANCE_LABELS[value]}</option>
            ))}
          </select>
          <select value={filters.accountKind} onChange={(e) => setFilters({ ...filters, accountKind: e.target.value })}>
            <option value="">Tipo de cuenta</option>
            {ACCOUNT_KINDS.map((value) => (
              <option key={value} value={value}>{ACCOUNT_KIND_LABELS[value]}</option>
            ))}
          </select>
          <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })}>
            <option value="">Activa e inactiva</option>
            <option value="active">Solo activas</option>
            <option value="inactive">Solo inactivas</option>
          </select>
          <button type="button" className="tasks-primary" onClick={loadAccounts} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>

        {showForm && canManage ? (
          <form className="finance-form-grid finance-chart-form" onSubmit={handleSubmit}>
            <h3 className="finance-field--full">{editingId ? "Editar cuenta" : "Nueva cuenta"}</h3>
            <Field label="Código">
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                required
                disabled={Boolean(editingId)}
                inputMode="text"
              />
            </Field>
            <Field label="Nombre">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </Field>
            <Field label="Cuenta padre">
              <select value={form.parent_id} onChange={(e) => setForm({ ...form, parent_id: e.target.value })}>
                <option value="">Sin padre (nivel raíz)</option>
                {parentOptions.map((row) => (
                  <option key={row.id} value={row.id}>
                    {"—".repeat(Math.max(0, row.level - 1))} {row.code} · {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Tipo financiero">
              <select
                value={form.financial_type}
                onChange={(e) => {
                  const financialType = e.target.value
                  setForm({
                    ...form,
                    financial_type: financialType,
                    branch_dimension_rule: defaultBranchDimensionRule(financialType),
                    cost_center_dimension_rule: defaultCostCenterDimensionRule(financialType)
                  })
                }}
              >
                {FINANCIAL_TYPES.map((value) => (
                  <option key={value} value={value}>{FINANCIAL_TYPE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Naturaleza">
              <select value={form.natural_balance} onChange={(e) => setForm({ ...form, natural_balance: e.target.value })}>
                {NATURAL_BALANCES.map((value) => (
                  <option key={value} value={value}>{NATURAL_BALANCE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Tipo de cuenta">
              <select
                value={form.account_kind}
                onChange={(e) => {
                  const accountKind = e.target.value
                  setForm({
                    ...form,
                    account_kind: accountKind,
                    accepts_entries: accountKind === "header" ? false : form.accepts_entries
                  })
                }}
              >
                {ACCOUNT_KINDS.map((value) => (
                  <option key={value} value={value}>{ACCOUNT_KIND_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Acepta movimientos">
              <select
                value={form.accepts_entries ? "true" : "false"}
                disabled={form.account_kind === "header"}
                onChange={(e) => setForm({ ...form, accepts_entries: e.target.value === "true" })}
              >
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </Field>
            <Field label="Dimensión sucursal">
              <select
                value={form.branch_dimension_rule}
                onChange={(e) => setForm({ ...form, branch_dimension_rule: e.target.value })}
              >
                {DIMENSION_RULES.map((value) => (
                  <option key={value} value={value}>{DIMENSION_RULE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Dimensión centro de costo">
              <select
                value={form.cost_center_dimension_rule}
                onChange={(e) => setForm({ ...form, cost_center_dimension_rule: e.target.value })}
              >
                {DIMENSION_RULES.map((value) => (
                  <option key={value} value={value}>{DIMENSION_RULE_LABELS[value]}</option>
                ))}
              </select>
            </Field>
            <Field label="Descripción" className="finance-field--full">
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </Field>
            <div className="finance-actions finance-field--full">
              <button type="submit" className="tasks-primary">{editingId ? "Guardar cambios" : "Crear cuenta"}</button>
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
                <th>Tipo</th>
                <th>Naturaleza</th>
                <th>Cuenta</th>
                <th>Sucursal</th>
                <th>Centro</th>
                <th>Estado</th>
                {canManage ? <th>Acciones</th> : null}
              </tr>
            </thead>
            <tbody>
              {accounts.map((row) => (
                <tr key={row.id} className={row.is_active ? "" : "finance-chart-row--inactive"}>
                  <td>
                    <span className="finance-chart-code" style={{ paddingLeft: `${Math.max(0, row.level - 1) * 16}px` }}>
                      {row.code}
                    </span>
                  </td>
                  <td>{row.name}</td>
                  <td>
                    <span className={`finance-badge ${typeBadgeClass(row.financial_type)}`}>
                      {FINANCIAL_TYPE_LABELS[row.financial_type] || row.financial_type}
                    </span>
                  </td>
                  <td>{NATURAL_BALANCE_LABELS[row.natural_balance] || row.natural_balance}</td>
                  <td>{ACCOUNT_KIND_LABELS[row.account_kind] || row.account_kind}</td>
                  <td>{DIMENSION_RULE_LABELS[row.branch_dimension_rule] || row.branch_dimension_rule || "—"}</td>
                  <td>{DIMENSION_RULE_LABELS[row.cost_center_dimension_rule] || row.cost_center_dimension_rule || "—"}</td>
                  <td>
                    <span className={`finance-badge ${row.is_active ? "finance-badge--paid" : "finance-badge--cancelled"}`}>
                      {row.is_active ? "Activa" : "Inactiva"}
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
              {!accounts.length && !loading ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="tasks-muted">
                    No hay cuentas en el catálogo. {canManage ? "Crea una cuenta o importa un archivo CSV." : ""}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>

      {importOpen ? (
        <FinanceChartAccountsImportModal
          existingCodes={accounts.map((row) => row.code)}
          onClose={() => setImportOpen(false)}
          onImported={async () => {
            setImportOpen(false)
            await loadAccounts()
            notify("Importación completada.", "success")
          }}
          notify={notify}
        />
      ) : null}
    </>
  )
}
