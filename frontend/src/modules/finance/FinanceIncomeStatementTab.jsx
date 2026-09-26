import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getFinanceIncomeStatement } from "../../services/financeIncomeStatementService"
import {
  listBranches,
  listFinanceAccountingPeriods,
  listFinanceCostCenters
} from "../../services/financeAccountingFoundationService"
import { canViewAccountingJournal } from "../../utils/financePermissions"
import { GENERAL_JOURNAL_BRANCH_SCOPE_NOTE } from "../../utils/financeGeneralJournalConstants"
import {
  INCOME_STATEMENT_DIMENSION_NOTE,
  INCOME_STATEMENT_PROVISIONAL_LABEL,
  INCOME_STATEMENT_SCOPE_LABELS,
  INCOME_STATEMENT_TAX_NOTE
} from "../../utils/financeIncomeStatementConstants"
import {
  createIncomeStatementLoadController,
  fetchIncomeStatementReport
} from "../../utils/financeIncomeStatementLoad"
import {
  buildIncomeStatementCsv,
  incomeStatementScopeKey,
  resolveIncomeStatementScreen,
  validateIncomeStatementQuery
} from "../../utils/financeIncomeStatementUtils"
import { defaultMonthRange, formatMoney, labelFor } from "./financeUtils"
import { Field } from "./FinanceJournalField"
import "./Finance.css"

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function FinanceIncomeStatementTab({ user, notify }) {
  const canView = canViewAccountingJournal(user)
  const defaultRange = useMemo(() => defaultMonthRange(), [])
  const createInitialFilters = useCallback(() => ({
    fromDate: defaultRange.from,
    toDate: defaultRange.to,
    periodId: "",
    branchId: "",
    costCenterId: "",
    includeZeroAccounts: false
  }), [defaultRange.from, defaultRange.to])

  const [draftFilters, setDraftFilters] = useState(createInitialFilters)
  const [appliedFilters, setAppliedFilters] = useState(createInitialFilters)
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [periods, setPeriods] = useState([])
  const [branches, setBranches] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [openSections, setOpenSections] = useState({})
  const loadControllerRef = useRef(null)
  if (!loadControllerRef.current) {
    loadControllerRef.current = createIncomeStatementLoadController()
  }

  const screen = resolveIncomeStatementScreen({ canView, loading, error, report })
  const dimensional = incomeStatementScopeKey({
    branchId: appliedFilters.branchId,
    costCenterId: appliedFilters.costCenterId
  }) !== "global"

  const loadReferenceData = useCallback(async () => {
    const [periodsRes, branchesRes, ccRes] = await Promise.all([
      listFinanceAccountingPeriods({}),
      listBranches({ includeInactive: true }),
      listFinanceCostCenters({ includeInactive: true })
    ])
    if (periodsRes.error) notify(periodsRes.error, "error")
    else setPeriods(periodsRes.data)
    if (branchesRes.error) notify(branchesRes.error, "error")
    else setBranches(branchesRes.data)
    if (ccRes.error) notify(ccRes.error, "error")
    else setCostCenters(ccRes.data)
  }, [notify])

  const loadReport = useCallback(async (filters, options = {}) => {
    const period = periods.find((item) => item.id === filters.periodId) || null
    if (filters.periodId && !period) {
      const message = "El periodo contable no existe."
      setError(message)
      notify(message, "error")
      return
    }
    await fetchIncomeStatementReport({
      canView,
      filters,
      period,
      options,
      controller: loadControllerRef.current,
      fetchReport: getFinanceIncomeStatement,
      onError: (message) => {
        setError(message)
        setReport(null)
        notify(message, "error")
      },
      onStart: () => {
        setError("")
        setReport(null)
      },
      setLoading,
      onSuccess: (data) => {
        setError("")
        setReport(data)
      }
    })
  }, [canView, notify, periods])

  useEffect(() => {
    if (!canView) return
    loadReferenceData()
  }, [canView, loadReferenceData])

  useEffect(() => {
    if (!canView) return
    loadReport(appliedFilters)
  }, [appliedFilters, canView, loadReport])

  function updateDraft(patch) {
    setDraftFilters((current) => ({ ...current, ...patch }))
  }

  function applyFilters() {
    const period = periods.find((item) => item.id === draftFilters.periodId) || null
    const check = validateIncomeStatementQuery({
      fromDate: draftFilters.fromDate,
      toDate: draftFilters.toDate,
      period: draftFilters.periodId ? period : null
    })
    if (draftFilters.periodId && !period) {
      setError("El periodo contable no existe.")
      setReport(null)
      notify("El periodo contable no existe.", "error")
      return
    }
    if (!check.ok) {
      setError(check.message)
      setReport(null)
      notify(check.message, "error")
      return
    }
    setError("")
    setAppliedFilters({ ...draftFilters })
  }

  function handleExportCsv() {
    if (!report) return
    setExporting(true)
    try {
      const csv = buildIncomeStatementCsv(report)
      const suffix = appliedFilters.fromDate && appliedFilters.toDate
        ? `${appliedFilters.fromDate}_a_${appliedFilters.toDate}`
        : "filtrado"
      downloadCsv(`estado_resultados_${suffix}.csv`, csv)
      notify("Exportación CSV generada.", "success")
    } finally {
      setExporting(false)
    }
  }

  function toggleSection(key) {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }))
  }

  if (!canView) {
    return (
      <article className="finance-panel">
        <p className="tasks-muted">No tienes permiso para consultar reportes contables.</p>
      </article>
    )
  }

  const resultAmount = report?.reportComplete ? report.netIncome : report?.classifiedNetResult

  return (
    <article className="finance-panel finance-income-statement">
      <div className="finance-panel__head">
        <div>
          <h2>Estado de Resultados</h2>
          <p className="tasks-muted">
            Resultado de las cuentas de detalle contabilizadas. Los subtotales los calcula el servidor.
          </p>
          <p className="tasks-muted finance-journal-list-note">{GENERAL_JOURNAL_BRANCH_SCOPE_NOTE}</p>
        </div>
        <div className="finance-actions">
          <button type="button" className="tasks-secondary" onClick={() => loadReport(appliedFilters, { fresh: true })} disabled={loading}>
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button type="button" className="tasks-secondary" onClick={handleExportCsv} disabled={loading || exporting || !report}>
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      <div className="finance-filters finance-journal-filters">
        <Field label="Desde" htmlFor="is-filter-from">
          <input id="is-filter-from" type="date" value={draftFilters.fromDate} onChange={(event) => updateDraft({ fromDate: event.target.value })} />
        </Field>
        <Field label="Hasta" htmlFor="is-filter-to">
          <input id="is-filter-to" type="date" value={draftFilters.toDate} onChange={(event) => updateDraft({ toDate: event.target.value })} />
        </Field>
        <Field label="Periodo" htmlFor="is-filter-period">
          <select id="is-filter-period" value={draftFilters.periodId} onChange={(event) => updateDraft({ periodId: event.target.value })}>
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.period_year}-{String(period.period_month).padStart(2, "0")} ({labelFor({ open: "Abierto", soft_closed: "Cierre suave", closed: "Cerrado" }, period.status)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sucursal" htmlFor="is-filter-branch">
          <select id="is-filter-branch" value={draftFilters.branchId} onChange={(event) => updateDraft({ branchId: event.target.value })}>
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}{branch.is_active === false ? " (Inactiva)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Centro de costo" htmlFor="is-filter-cc">
          <select id="is-filter-cc" value={draftFilters.costCenterId} onChange={(event) => updateDraft({ costCenterId: event.target.value })}>
            <option value="">Todos</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.id}>
                {center.code} — {center.name}{center.is_active === false ? " (Inactivo)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <label className="finance-income-statement-zero" htmlFor="is-filter-zeros">
          <input
            id="is-filter-zeros"
            type="checkbox"
            checked={draftFilters.includeZeroAccounts}
            onChange={(event) => updateDraft({ includeZeroAccounts: event.target.checked })}
          />
          Mostrar cuentas en cero
        </label>
        <div className="finance-actions">
          <button type="button" className="tasks-primary" onClick={applyFilters} disabled={loading}>Aplicar</button>
        </div>
      </div>

      {screen.state === "loading" ? <p className="tasks-muted">Cargando Estado de Resultados…</p> : null}
      {screen.state === "error" ? <p className="finance-message error">{error}</p> : null}
      {dimensional ? <p className="tasks-muted finance-journal-list-note">{INCOME_STATEMENT_DIMENSION_NOTE}</p> : null}

      {screen.showReport && report ? (
        <div className="finance-income-statement-body">
          <div className="finance-income-statement-meta">
            <span>Periodo efectivo: {report.effectiveFrom || "—"} a {report.effectiveTo || "—"}</span>
            <span>Alcance: {INCOME_STATEMENT_SCOPE_LABELS[report.scope] || report.scope}</span>
            <span className={`finance-badge ${report.reportComplete ? "finance-badge--paid" : "finance-badge--overdue"}`}>
              {report.reportComplete ? "Completo" : "Incompleto"}
            </span>
          </div>

          {report.warnings.filter((warning) => warning !== INCOME_STATEMENT_TAX_NOTE).map((warning) => (
            <p key={warning} className="finance-message warning">{warning}</p>
          ))}
          {!report.incomeTaxClassified ? <p className="tasks-muted">{INCOME_STATEMENT_TAX_NOTE} Impuesto Q0.00.</p> : null}
          {screen.state === "empty" ? <p className="tasks-muted">No hay movimientos en el periodo seleccionado.</p> : null}

          {report.sections.map((section) => {
            const open = Boolean(openSections[section.key])
            return (
              <section key={section.key} className="finance-income-statement-section">
                <button type="button" className="finance-income-statement-section__head" onClick={() => toggleSection(section.key)} aria-expanded={open}>
                  <span>{section.label}</span>
                  <strong>{formatMoney(section.subtotal)}</strong>
                </button>
                {open ? (
                  section.accounts.length ? (
                    <div className="finance-table-wrap">
                      <table className="finance-table finance-income-statement-table">
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Cuenta</th>
                            <th>Debe</th>
                            <th>Haber</th>
                            <th>Importe</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.accounts.map((account) => (
                            <tr key={account.accountId}>
                              <td>{account.code}</td>
                              <td>
                                {account.name}
                                {account.isActive ? "" : " (Inactiva)"}
                                {account.contrary ? <span className="finance-badge finance-badge--overdue">Saldo contrario</span> : null}
                              </td>
                              <td className="finance-income-statement-num">{formatMoney(account.periodDebit)}</td>
                              <td className="finance-income-statement-num">{formatMoney(account.periodCredit)}</td>
                              <td className="finance-income-statement-num">{formatMoney(account.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="tasks-muted">Sin cuentas en esta sección.</p>
                ) : null}
              </section>
            )
          })}

          <dl className="finance-income-statement-totals">
            <div><dt>Ventas netas</dt><dd>{formatMoney(report.netRevenue)}</dd></div>
            <div><dt>Utilidad bruta</dt><dd>{formatMoney(report.grossProfit)}</dd></div>
            <div><dt>Gastos operativos</dt><dd>{formatMoney(report.operatingExpensesTotal)}</dd></div>
            <div><dt>Utilidad operativa</dt><dd>{formatMoney(report.operatingProfit)}</dd></div>
            <div><dt>Otros resultados</dt><dd>{formatMoney(report.otherResult)}</dd></div>
            <div><dt>Utilidad antes de impuestos</dt><dd>{formatMoney(report.profitBeforeTax)}</dd></div>
            <div><dt>Impuesto sobre la renta</dt><dd>{formatMoney(report.incomeTaxTotal)}</dd></div>
            <div>
              <dt>{report.reportComplete ? report.netResultLabel : INCOME_STATEMENT_PROVISIONAL_LABEL}</dt>
              <dd>{formatMoney(resultAmount)}</dd>
            </div>
          </dl>

          {!report.reportComplete ? (
            <section className="finance-income-statement-unclassified">
              <h3>Cuentas no clasificadas</h3>
              <p>
                {report.unclassifiedAccountCount} cuentas · Debe {formatMoney(report.unclassifiedDebit)} · Haber {formatMoney(report.unclassifiedCredit)} · Movimiento neto {formatMoney(report.unclassifiedNetMovement)}
              </p>
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr><th>Código</th><th>Cuenta</th><th>Debe</th><th>Haber</th></tr>
                  </thead>
                  <tbody>
                    {report.unclassifiedAccounts.map((account) => (
                      <tr key={account.accountId}>
                        <td>{account.code}</td>
                        <td>{account.name}</td>
                        <td>{formatMoney(account.periodDebit)}</td>
                        <td>{formatMoney(account.periodCredit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
