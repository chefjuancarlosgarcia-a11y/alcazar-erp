import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getFinanceBalanceSheet } from "../../services/financeBalanceSheetService"
import { listBranches, listFinanceCostCenters } from "../../services/financeAccountingFoundationService"
import { canViewAccountingJournal } from "../../utils/financePermissions"
import { GENERAL_JOURNAL_BRANCH_SCOPE_NOTE } from "../../utils/financeGeneralJournalConstants"
import {
  BALANCE_SHEET_ACCUMULATED_LABEL,
  BALANCE_SHEET_CLASSIFIED_NOTE,
  BALANCE_SHEET_DIMENSION_NOTE,
  BALANCE_SHEET_PROVISIONAL_LABEL,
  BALANCE_SHEET_SCOPE_LABELS,
  defaultCutoffDate
} from "../../utils/financeBalanceSheetConstants"
import {
  createBalanceSheetLoadController,
  fetchBalanceSheetReport
} from "../../utils/financeBalanceSheetLoad"
import {
  balanceSheetScopeKey,
  buildBalanceSheetCsv,
  resolveBalanceSheetScreen,
  validateBalanceSheetQuery
} from "../../utils/financeBalanceSheetUtils"
import { formatMoney } from "./financeUtils"
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

function AccountTable({ accounts }) {
  if (!accounts.length) return <p className="tasks-muted">Sin cuentas en esta sección.</p>
  return (
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
          {accounts.map((account) => (
            <tr key={account.accountId} className={account.isActive ? "" : "finance-chart-row--inactive"}>
              <td>{account.code}</td>
              <td>
                {account.name}
                {account.isActive ? "" : " (Inactiva)"}
                {account.contrary ? <span className="finance-badge finance-badge--overdue">Saldo contrario</span> : null}
              </td>
              <td className="finance-income-statement-num">{formatMoney(account.debit)}</td>
              <td className="finance-income-statement-num">{formatMoney(account.credit)}</td>
              <td className="finance-income-statement-num">{formatMoney(account.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function FinanceBalanceSheetTab({ user, notify }) {
  const canView = canViewAccountingJournal(user)
  const initialCutoff = useMemo(() => defaultCutoffDate(), [])
  const createInitialFilters = useCallback(() => ({
    cutoffDate: initialCutoff,
    branchId: "",
    costCenterId: "",
    includeZeroAccounts: false
  }), [initialCutoff])

  const [draftFilters, setDraftFilters] = useState(createInitialFilters)
  const [appliedFilters, setAppliedFilters] = useState(createInitialFilters)
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [branches, setBranches] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [openSections, setOpenSections] = useState({})
  const loadControllerRef = useRef(null)
  if (!loadControllerRef.current) {
    loadControllerRef.current = createBalanceSheetLoadController()
  }

  const screen = resolveBalanceSheetScreen({ canView, loading, error, report })
  const dimensional = balanceSheetScopeKey({
    branchId: appliedFilters.branchId,
    costCenterId: appliedFilters.costCenterId
  }) !== "global"

  const loadReferenceData = useCallback(async () => {
    const [branchesRes, ccRes] = await Promise.all([
      listBranches({ includeInactive: true }),
      listFinanceCostCenters({ includeInactive: true })
    ])
    if (branchesRes.error) notify(branchesRes.error, "error")
    else setBranches(branchesRes.data)
    if (ccRes.error) notify(ccRes.error, "error")
    else setCostCenters(ccRes.data)
  }, [notify])

  const loadReport = useCallback(async (filters, options = {}) => {
    await fetchBalanceSheetReport({
      canView,
      filters,
      options,
      controller: loadControllerRef.current,
      fetchReport: getFinanceBalanceSheet,
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
  }, [canView, notify])

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
    const check = validateBalanceSheetQuery({ cutoffDate: draftFilters.cutoffDate })
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
      const csv = buildBalanceSheetCsv(report)
      downloadCsv(`balance_general_${appliedFilters.cutoffDate || "corte"}.csv`, csv)
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

  const title = report && !report.reportComplete ? BALANCE_SHEET_PROVISIONAL_LABEL : "Balance General"

  return (
    <article className="finance-panel finance-income-statement">
      <div className="finance-panel__head">
        <div>
          <h2>{title}</h2>
          <p className="tasks-muted">
            Saldos acumulados hasta la fecha de corte. Los subtotales clasificados y la ecuación de control se muestran por separado.
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
        <Field label="Fecha de corte" htmlFor="bs-filter-cutoff">
          <input id="bs-filter-cutoff" type="date" value={draftFilters.cutoffDate} onChange={(event) => updateDraft({ cutoffDate: event.target.value })} required />
        </Field>
        <Field label="Sucursal" htmlFor="bs-filter-branch">
          <select id="bs-filter-branch" value={draftFilters.branchId} onChange={(event) => updateDraft({ branchId: event.target.value })}>
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}{branch.is_active === false ? " (Inactiva)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Centro de costo" htmlFor="bs-filter-cc">
          <select id="bs-filter-cc" value={draftFilters.costCenterId} onChange={(event) => updateDraft({ costCenterId: event.target.value })}>
            <option value="">Todos</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.id}>
                {center.code} — {center.name}{center.is_active === false ? " (Inactivo)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <label className="finance-income-statement-zero" htmlFor="bs-filter-zeros">
          <input
            id="bs-filter-zeros"
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

      {screen.state === "loading" ? <p className="tasks-muted">Cargando Balance General…</p> : null}
      {screen.state === "error" ? <p className="finance-message error">{error}</p> : null}
      {dimensional ? <p className="tasks-muted finance-journal-list-note">{BALANCE_SHEET_DIMENSION_NOTE}</p> : null}

      {screen.showReport && report ? (
        <div className="finance-income-statement-body">
          <div className="finance-income-statement-meta">
            <span>Corte: {report.cutoffDate}</span>
            <span>Alcance: {BALANCE_SHEET_SCOPE_LABELS[report.scope] || report.scope}</span>
            <span className={`finance-badge ${report.reportComplete ? "finance-badge--paid" : "finance-badge--overdue"}`}>
              {report.reportComplete ? "Completo" : "Incompleto"}
            </span>
            <span className={`finance-badge ${report.isSquare ? "finance-badge--paid" : "finance-badge--overdue"}`}>
              {report.balanceStatus}
            </span>
          </div>
          <p className="tasks-muted">{BALANCE_SHEET_CLASSIFIED_NOTE}</p>
          {report.warnings.map((warning) => (
            <p key={warning} className="finance-message warning">{warning}</p>
          ))}
          {screen.state === "empty" ? <p className="tasks-muted">No hay saldos hasta la fecha de corte.</p> : null}

          {report.sections.map((section) => {
            const open = openSections[section.key] !== false
            return (
              <section key={section.key} className="finance-income-statement-section">
                <button type="button" className="finance-income-statement-section__head" onClick={() => toggleSection(section.key)} aria-expanded={open}>
                  <span>{section.label}</span>
                  <strong>{formatMoney(section.subtotal)}</strong>
                </button>
                {open ? <AccountTable accounts={section.accounts} /> : null}
                {section.key === "noncurrent_asset" ? (
                  <p className="finance-income-statement-meta">Total activos clasificados: {formatMoney(report.classifiedTotalAssets)}</p>
                ) : null}
                {section.key === "noncurrent_liability" ? (
                  <p className="finance-income-statement-meta">Total pasivos clasificados: {formatMoney(report.classifiedTotalLiabilities)}</p>
                ) : null}
              </section>
            )
          })}

          <dl className="finance-income-statement-totals">
            <div><dt>Total activos clasificados</dt><dd>{formatMoney(report.classifiedTotalAssets)}</dd></div>
            <div><dt>Total pasivos clasificados</dt><dd>{formatMoney(report.classifiedTotalLiabilities)}</dd></div>
            <div><dt>Patrimonio registrado clasificado</dt><dd>{formatMoney(report.classifiedRegisteredEquity)}</dd></div>
            <div><dt>{BALANCE_SHEET_ACCUMULATED_LABEL}</dt><dd>{formatMoney(report.accumulatedResult)}</dd></div>
            <div><dt>Total patrimonio clasificado</dt><dd>{formatMoney(report.classifiedTotalEquity)}</dd></div>
            <div><dt>Total pasivo y patrimonio clasificado</dt><dd>{formatMoney(report.classifiedTotalLiabilitiesAndEquity)}</dd></div>
            <div><dt>Diferencia clasificada</dt><dd>{formatMoney(report.classifiedDifference)}</dd></div>
          </dl>

          <section className="finance-income-statement-unclassified">
            <h3>Cuentas sin clasificar</h3>
            <p>
              {report.unclassifiedAccountCount} cuentas · Activo {formatMoney(report.unclassifiedAssetAmount)} · Pasivo {formatMoney(report.unclassifiedLiabilityAmount)} · Patrimonio {formatMoney(report.unclassifiedEquityAmount)}
            </p>
            {report.unclassifiedAccounts.length ? <AccountTable accounts={report.unclassifiedAccounts} /> : <p className="tasks-muted">No hay cuentas de balance con saldo sin sección.</p>}
          </section>

          <section className="finance-income-statement-unclassified">
            <h3>Ecuación de control</h3>
            <dl className="finance-income-statement-totals">
              <div><dt>Total activos</dt><dd>{formatMoney(report.controlTotalAssets)}</dd></div>
              <div><dt>Total pasivos</dt><dd>{formatMoney(report.controlTotalLiabilities)}</dd></div>
              <div><dt>Patrimonio registrado</dt><dd>{formatMoney(report.controlRegisteredEquity)}</dd></div>
              <div><dt>{BALANCE_SHEET_ACCUMULATED_LABEL}</dt><dd>{formatMoney(report.accumulatedResult)}</dd></div>
              <div><dt>Total patrimonio</dt><dd>{formatMoney(report.controlTotalEquity)}</dd></div>
              <div><dt>Total pasivo y patrimonio</dt><dd>{formatMoney(report.controlTotalLiabilitiesAndEquity)}</dd></div>
              <div><dt>Diferencia</dt><dd>{formatMoney(report.difference)}</dd></div>
              <div><dt>Estado</dt><dd>{report.balanceStatus}</dd></div>
            </dl>
          </section>
        </div>
      ) : null}
    </article>
  )
}
