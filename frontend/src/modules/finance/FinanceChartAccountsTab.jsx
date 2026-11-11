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
  BALANCE_SHEET_SECTION_LABELS,
  BALANCE_SHEET_UNCLASSIFIED_ACCOUNT_WARNING,
  CSV_TEMPLATE_HEADERS,
  CSV_TEMPLATE_SAMPLE,
  FINANCIAL_TYPE_LABELS,
  FINANCIAL_TYPES,
  INCOME_STATEMENT_SECTION_LABELS,
  INCOME_STATEMENT_UNCLASSIFIED_ACCOUNT_WARNING,
  NATURAL_BALANCE_LABELS,
  NATURAL_BALANCES,
  balanceSheetSectionsFor,
  incomeStatementSectionsFor
} from "../../utils/financeChartAccountsConstants"
import {
  DIMENSION_RULE_LABELS,
  DIMENSION_RULES
} from "../../utils/financeAccountingFoundationConstants"
import {
  defaultBranchDimensionRule,
  defaultCostCenterDimensionRule
} from "../../utils/financeAccountingFoundationValidation"
import { buildFinanceChartAccountWritePayload } from "../../utils/financeChartAccountsValidation"

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
    cost_center_dimension_rule: "optional",
    income_statement_section: "",
    balance_sheet_section: ""
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
  const [sectionNotice, setSectionNotice] = useState("")
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
    setSectionNotice("")
    setShowForm(true)
  }

  function retainSections(financialType, accountKind, incomeSection, balanceSection) {
    const incomeAllowed = incomeStatementSectionsFor(financialType, accountKind)
    const balanceAllowed = balanceSheetSectionsFor(financialType, accountKind)
    const notices = []
    let nextIncome = incomeSection
    let nextBalance = balanceSection
    if (incomeSection && !incomeAllowed.includes(incomeSection)) {
      nextIncome = ""
      notices.push("La sección del Estado de Resultados se limpió porque ya no corresponde al tipo de cuenta.")
    }
    if (balanceSection && !balanceAllowed.includes(balanceSection)) {
      nextBalance = ""
      notices.push("La sección del Balance General se limpió porque ya no corresponde al tipo de cuenta.")
    }
    setSectionNotice(notices.join(" "))
    return { income: nextIncome, balance: nextBalance }
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
      cost_center_dimension_rule: account.cost_center_dimension_rule || defaultCostCenterDimensionRule(account.financial_type),
      income_statement_section: account.income_statement_section || "",
      balance_sheet_section: account.balance_sheet_section || ""
    })
    setSectionNotice("")
    setShowForm(true)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para administrar el catálogo contable.", "error")

    const sectionChoices = incomeStatementSectionsFor(form.financial_type, form.account_kind)
    const balanceChoices = balanceSheetSectionsFor(form.financial_type, form.account_kind)
    const payload = buildFinanceChartAccountWritePayload(form)
    const wantedIncomeClear = sectionChoices.length > 0 && payload.income_statement_section === ""
    const wantedBalanceClear = balanceChoices.length > 0 && payload.balance_sheet_section === ""

    const result = editingId
      ? await updateFinanceChartAccount(editingId, payload)
      : await createFinanceChartAccount({ ...payload, code: form.code })

    if (result.error) notify(result.error, "error")
    else {
      const saved = result.data && typeof result.data === "object" ? result.data : null
      if (saved?.id) {
        setAccounts((rows) => rows.some((row) => row.id === saved.id)
          ? rows.map((row) => row.id === saved.id ? saved : row)
          : [saved, ...rows])
      }
      if ((wantedIncomeClear && saved?.income_statement_section) || (wantedBalanceClear && saved?.balance_sheet_section)) {
        notify("La sección no se eliminó. Se muestra la clasificación guardada en el servidor.", "error")
        openEdit(saved)
        await loadAccounts()
        return
      }
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
    const lines = [CSV_TEMPLATE_HEADERS.join(","), ...CSV_TEMPLATE_SAMPLE.map((row) => row.map((cell) => `"${cell}"`).join(","))]
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
                  const retained = retainSections(financialType, form.account_kind, form.income_statement_section, form.balance_sheet_section)
                  setForm({
                    ...form,
                    financial_type: financialType,
                    branch_dimension_rule: defaultBranchDimensionRule(financialType),
                    cost_center_dimension_rule: defaultCostCenterDimensionRule(financialType),
                    income_statement_section: retained.income,
                    balance_sheet_section: retained.balance
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
                  const retained = retainSections(form.financial_type, accountKind, form.income_statement_section, form.balance_sheet_section)
                  setForm({
                    ...form,
                    account_kind: accountKind,
                    accepts_entries: accountKind === "header" ? false : form.accepts_entries,
                    income_statement_section: retained.income,
                    balance_sheet_section: retained.balance
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
            {incomeStatementSectionsFor(form.financial_type, form.account_kind).length ? (
              <Field label="Sección del Estado de Resultados" className="finance-field--full">
                <select
                  value={form.income_statement_section}
                  onChange={(e) => setForm({ ...form, income_statement_section: e.target.value })}
                >
                  <option value="">Sin clasificar</option>
                  {incomeStatementSectionsFor(form.financial_type, form.account_kind).map((value) => (
                    <option key={value} value={value}>{INCOME_STATEMENT_SECTION_LABELS[value]}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {incomeStatementSectionsFor(form.financial_type, form.account_kind).length && !form.income_statement_section ? (
              <p className="finance-message warning finance-field--full">{INCOME_STATEMENT_UNCLASSIFIED_ACCOUNT_WARNING}</p>
            ) : null}
            {balanceSheetSectionsFor(form.financial_type, form.account_kind).length ? (
              <Field label="Sección del Balance General" className="finance-field--full">
                <select
                  value={form.balance_sheet_section}
                  onChange={(e) => setForm({ ...form, balance_sheet_section: e.target.value })}
                >
                  <option value="">Sin clasificar</option>
                  {balanceSheetSectionsFor(form.financial_type, form.account_kind).map((value) => (
                    <option key={value} value={value}>{BALANCE_SHEET_SECTION_LABELS[value]}</option>
                  ))}
                </select>
              </Field>
            ) : null}
            {balanceSheetSectionsFor(form.financial_type, form.account_kind).length && !form.balance_sheet_section ? (
              <p className="finance-message warning finance-field--full">{BALANCE_SHEET_UNCLASSIFIED_ACCOUNT_WARNING}</p>
            ) : null}
            {sectionNotice ? <p className="finance-message warning finance-field--full">{sectionNotice}</p> : null}
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
                <th>Resultados</th>
                <th>Balance</th>
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
                  <td>{INCOME_STATEMENT_SECTION_LABELS[row.income_statement_section] || (incomeStatementSectionsFor(row.financial_type, row.account_kind).length ? "Sin clasificar" : "—")}</td>
                  <td>{BALANCE_SHEET_SECTION_LABELS[row.balance_sheet_section] || (balanceSheetSectionsFor(row.financial_type, row.account_kind).length ? "Sin clasificar" : "—")}</td>
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
                  <td colSpan={canManage ? 10 : 9} className="tasks-muted">
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
