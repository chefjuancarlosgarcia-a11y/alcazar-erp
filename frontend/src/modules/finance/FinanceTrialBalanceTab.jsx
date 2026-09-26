import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import PaginationControls from "../../components/PaginationControls"
import { getFinanceTrialBalance } from "../../services/financeTrialBalanceService"
import {
  listBranches,
  listFinanceAccountingPeriods,
  listFinanceCostCenters
} from "../../services/financeAccountingFoundationService"
import { canViewAccountingJournal } from "../../utils/financePermissions"
import { GENERAL_JOURNAL_BRANCH_SCOPE_NOTE } from "../../utils/financeGeneralJournalConstants"
import {
  TRIAL_BALANCE_DEFAULT_PAGE_SIZE,
  TRIAL_BALANCE_DIMENSION_NOTE,
  TRIAL_BALANCE_PAGE_SIZES,
  TRIAL_BALANCE_TOTALS_NOTE
} from "../../utils/financeTrialBalanceConstants"
import {
  createTrialBalanceLoadController,
  fetchTrialBalanceReport
} from "../../utils/financeTrialBalanceLoad"
import {
  buildTrialBalanceCsv,
  fetchAllTrialBalanceRows,
  resolveTrialBalanceScreen,
  trialBalanceScopeKey,
  validateTrialBalanceQuery
} from "../../utils/financeTrialBalanceUtils"
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

function moneyOrDash(value) {
  return Number(value) > 0 ? formatMoney(value) : "—"
}

export default function FinanceTrialBalanceTab({ user, notify }) {
  const canView = canViewAccountingJournal(user)
  const defaultRange = useMemo(() => defaultMonthRange(), [])
  const createInitialFilters = useCallback(() => ({
    fromDate: defaultRange.from,
    toDate: defaultRange.to,
    periodId: "",
    branchId: "",
    costCenterId: "",
    search: "",
    includeZeroAccounts: false,
    pageSize: TRIAL_BALANCE_DEFAULT_PAGE_SIZE
  }), [defaultRange.from, defaultRange.to])

  const [draftFilters, setDraftFilters] = useState(createInitialFilters)
  const [appliedFilters, setAppliedFilters] = useState(createInitialFilters)
  const [page, setPage] = useState(1)
  const [report, setReport] = useState(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [periods, setPeriods] = useState([])
  const [branches, setBranches] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const loadControllerRef = useRef(null)
  if (!loadControllerRef.current) {
    loadControllerRef.current = createTrialBalanceLoadController()
  }

  const screen = resolveTrialBalanceScreen({ canView, loading, error, report })
  const dimensional = trialBalanceScopeKey({
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

  const loadReport = useCallback(async (filters, targetPage = 1, options = {}) => {
    const period = periods.find((item) => item.id === filters.periodId) || null
    if (filters.periodId && !period) {
      const message = "El periodo contable no existe."
      setError(message)
      notify(message, "error")
      return
    }
    await fetchTrialBalanceReport({
      canView,
      filters,
      period,
      targetPage,
      options,
      controller: loadControllerRef.current,
      fetchReport: getFinanceTrialBalance,
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
      onSuccess: (data, nextPage) => {
        setError("")
        setReport(data)
        setPage(nextPage)
      }
    })
  }, [canView, notify, periods])

  useEffect(() => {
    if (!canView) return
    loadReferenceData()
  }, [canView, loadReferenceData])

  useEffect(() => {
    if (!canView) return
    loadReport(appliedFilters, page, { reuseSnapshot: page > 1 })
  }, [appliedFilters, canView, loadReport, page])

  function updateDraft(patch) {
    setDraftFilters((current) => ({ ...current, ...patch }))
  }

  function applyFilters() {
    const period = periods.find((item) => item.id === draftFilters.periodId) || null
    const check = validateTrialBalanceQuery({
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
    setPage(1)
  }

  async function handleExportCsv() {
    if (!report) return
    setExporting(true)
    try {
      const exportFilters = {
        fromDate: appliedFilters.fromDate || null,
        toDate: appliedFilters.toDate || null,
        periodId: appliedFilters.periodId || null,
        branchId: appliedFilters.branchId || null,
        costCenterId: appliedFilters.costCenterId || null,
        search: appliedFilters.search || null,
        includeZeroAccounts: appliedFilters.includeZeroAccounts
      }
      const outcome = await fetchAllTrialBalanceRows(
        getFinanceTrialBalance,
        exportFilters,
        report.matchCount,
        loadControllerRef.current.snapshotAt || report.snapshotAt || null
      )
      if (!outcome.ok) {
        notify(outcome.error, "error")
        return
      }
      const csv = buildTrialBalanceCsv({ rows: outcome.rows, report })
      const suffix = appliedFilters.fromDate && appliedFilters.toDate
        ? `${appliedFilters.fromDate}_a_${appliedFilters.toDate}`
        : "filtrado"
      downloadCsv(`balanza_comprobacion_${suffix}.csv`, csv)
      notify("Exportación CSV generada.", "success")
    } finally {
      setExporting(false)
    }
  }

  if (!canView) {
    return (
      <article className="finance-panel">
        <p className="tasks-muted">No tienes permiso para consultar reportes contables.</p>
      </article>
    )
  }

  return (
    <article className="finance-panel finance-trial-balance">
      <div className="finance-panel__head">
        <div>
          <h2>Balanza de Comprobación</h2>
          <p className="tasks-muted">
            Saldos de las cuentas de detalle contabilizadas. Los totales se calculan sobre el alcance completo antes de la búsqueda y de la página.
          </p>
          <p className="tasks-muted finance-journal-list-note">{GENERAL_JOURNAL_BRANCH_SCOPE_NOTE}</p>
        </div>
        <div className="finance-actions">
          <button
            type="button"
            className="tasks-secondary"
            onClick={() => loadReport(appliedFilters, page, { fresh: true })}
            disabled={loading}
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <button
            type="button"
            className="tasks-secondary"
            onClick={handleExportCsv}
            disabled={loading || exporting || !report}
          >
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      <div className="finance-filters finance-journal-filters">
        <Field label="Desde" htmlFor="tb-filter-from">
          <input
            id="tb-filter-from"
            type="date"
            value={draftFilters.fromDate}
            onChange={(event) => updateDraft({ fromDate: event.target.value })}
          />
        </Field>
        <Field label="Hasta" htmlFor="tb-filter-to">
          <input
            id="tb-filter-to"
            type="date"
            value={draftFilters.toDate}
            onChange={(event) => updateDraft({ toDate: event.target.value })}
          />
        </Field>
        <Field label="Periodo" htmlFor="tb-filter-period">
          <select
            id="tb-filter-period"
            value={draftFilters.periodId}
            onChange={(event) => updateDraft({ periodId: event.target.value })}
          >
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.period_year}-{String(period.period_month).padStart(2, "0")} ({labelFor({ open: "Abierto", soft_closed: "Cierre suave", closed: "Cerrado" }, period.status)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sucursal" htmlFor="tb-filter-branch">
          <select
            id="tb-filter-branch"
            value={draftFilters.branchId}
            onChange={(event) => updateDraft({ branchId: event.target.value })}
          >
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} — {branch.name}{branch.is_active === false ? " (Inactiva)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Centro de costo" htmlFor="tb-filter-cc">
          <select
            id="tb-filter-cc"
            value={draftFilters.costCenterId}
            onChange={(event) => updateDraft({ costCenterId: event.target.value })}
          >
            <option value="">Todos</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.id}>
                {center.code} — {center.name}{center.is_active === false ? " (Inactivo)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Búsqueda" htmlFor="tb-filter-search" className="finance-field--wide">
          <input
            id="tb-filter-search"
            type="search"
            placeholder="Código o nombre de cuenta"
            value={draftFilters.search}
            onChange={(event) => updateDraft({ search: event.target.value })}
          />
        </Field>
        <Field label="Tamaño de página" htmlFor="tb-filter-page-size">
          <select
            id="tb-filter-page-size"
            value={draftFilters.pageSize}
            onChange={(event) => updateDraft({ pageSize: Number(event.target.value) })}
          >
            {TRIAL_BALANCE_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </Field>
        <label className="finance-trial-balance-zero" htmlFor="tb-filter-zeros">
          <input
            id="tb-filter-zeros"
            type="checkbox"
            checked={draftFilters.includeZeroAccounts}
            onChange={(event) => updateDraft({ includeZeroAccounts: event.target.checked })}
          />
          Mostrar cuentas en cero
        </label>
        <div className="finance-field finance-field--actions">
          <span aria-hidden="true">&nbsp;</span>
          <button type="button" className="tasks-primary" onClick={applyFilters} disabled={loading}>
            Aplicar filtros
          </button>
        </div>
      </div>

      {screen.state === "loading" ? (
        <p className="tasks-muted finance-trial-balance-status">Cargando Balanza de Comprobación…</p>
      ) : null}

      {screen.state === "error" ? (
        <p className="tasks-muted finance-trial-balance-status" role="alert">{error}</p>
      ) : null}

      {screen.showReport && report ? (
        <>
          <div className="finance-trial-balance-status-row" role="status">
            <span className={`finance-badge ${report.isSquare ? "finance-trial-balance-square" : "finance-trial-balance-unbalanced"}`}>
              {report.isSquare ? "Cuadrada" : "Descuadrada"}
            </span>
            <span className="tasks-muted">
              Ventana {report.effectiveFrom || "sin inicio"} a {report.effectiveTo || "sin fin"}
            </span>
            <span className="tasks-muted">
              {report.matchCount} cuenta{report.matchCount === 1 ? "" : "s"} mostrada{report.matchCount === 1 ? "" : "s"} de {report.accountCount} del alcance.
            </span>
          </div>

          <p className="tasks-muted finance-trial-balance-status">{TRIAL_BALANCE_TOTALS_NOTE}</p>

          {dimensional ? (
            <p className="finance-trial-balance-warning" role="note">{TRIAL_BALANCE_DIMENSION_NOTE}</p>
          ) : null}

          {report.searchApplied ? (
            <p className="tasks-muted finance-trial-balance-status">
              La búsqueda filtra las filas de esta página. Los totales de control no cambian.
            </p>
          ) : null}

          <div className="finance-journal-totals finance-ledger-totals">
            <div>
              <span>Saldo inicial deudor</span>
              <strong>{formatMoney(report.openingDebitTotal)}</strong>
            </div>
            <div>
              <span>Saldo inicial acreedor</span>
              <strong>{formatMoney(report.openingCreditTotal)}</strong>
            </div>
            <div>
              <span>Diferencia inicial</span>
              <strong>{formatMoney(report.openingDifference)}</strong>
            </div>
            <div>
              <span>Debe del periodo</span>
              <strong>{formatMoney(report.periodDebitTotal)}</strong>
            </div>
            <div>
              <span>Haber del periodo</span>
              <strong>{formatMoney(report.periodCreditTotal)}</strong>
            </div>
            <div>
              <span>Diferencia del periodo</span>
              <strong>{formatMoney(report.periodDifference)}</strong>
            </div>
            <div>
              <span>Saldo final deudor</span>
              <strong>{formatMoney(report.closingDebitTotal)}</strong>
            </div>
            <div>
              <span>Saldo final acreedor</span>
              <strong>{formatMoney(report.closingCreditTotal)}</strong>
            </div>
            <div>
              <span>Diferencia final</span>
              <strong>{formatMoney(report.closingDifference)}</strong>
            </div>
          </div>

          {report.matchCount === 0 ? (
            <p className="tasks-muted finance-trial-balance-status">
              No hay cuentas para mostrar en esta consulta. Los totales siguen siendo los del alcance completo.
            </p>
          ) : (
            <div className="finance-trial-balance-table-wrap" role="region" aria-label="Balanza de Comprobación">
              <table className="finance-trial-balance-table">
                <thead>
                  <tr>
                    <th scope="col">Código</th>
                    <th scope="col">Cuenta</th>
                    <th scope="col">Naturaleza</th>
                    <th scope="col" className="finance-trial-balance-num">Inicial deudor</th>
                    <th scope="col" className="finance-trial-balance-num">Inicial acreedor</th>
                    <th scope="col" className="finance-trial-balance-num">Debe</th>
                    <th scope="col" className="finance-trial-balance-num">Haber</th>
                    <th scope="col" className="finance-trial-balance-num">Final deudor</th>
                    <th scope="col" className="finance-trial-balance-num">Final acreedor</th>
                    <th scope="col">Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row) => (
                    <tr key={row.accountId}>
                      <td data-label="Código">{row.code}</td>
                      <td data-label="Cuenta">
                        <div>{row.name}</div>
                        {row.isActive === false ? <span className="finance-badge finance-ledger-account-mark">Inactiva</span> : null}
                        {row.openingContrary || row.closingContrary ? (
                          <span className="finance-badge finance-ledger-account-mark">Saldo contrario</span>
                        ) : null}
                      </td>
                      <td data-label="Naturaleza">{row.naturalBalance === "credit" ? "Acreedora" : "Deudora"}</td>
                      <td className="finance-trial-balance-num" data-label="Inicial deudor">{moneyOrDash(row.openingDebit)}</td>
                      <td className="finance-trial-balance-num" data-label="Inicial acreedor">{moneyOrDash(row.openingCredit)}</td>
                      <td className="finance-trial-balance-num" data-label="Debe">{moneyOrDash(row.periodDebit)}</td>
                      <td className="finance-trial-balance-num" data-label="Haber">{moneyOrDash(row.periodCredit)}</td>
                      <td className="finance-trial-balance-num" data-label="Final deudor">{moneyOrDash(row.closingDebit)}</td>
                      <td className="finance-trial-balance-num" data-label="Final acreedor">{moneyOrDash(row.closingCredit)}</td>
                      <td data-label="Movimientos">{row.movementCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <PaginationControls
            page={page}
            total={report.matchCount}
            pageSize={report.pageSize || appliedFilters.pageSize}
            onChange={setPage}
          />
        </>
      ) : null}
    </article>
  )
}
