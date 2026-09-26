import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import PaginationControls from "../../components/PaginationControls"
import { getFinanceGeneralLedger } from "../../services/financeGeneralLedgerService"
import {
  listBranches,
  listFinanceAccountingPeriods,
  listFinanceCostCenters
} from "../../services/financeAccountingFoundationService"
import { listFinanceChartAccounts } from "../../services/financeChartAccountsService"
import { canViewAccountingJournal } from "../../utils/financePermissions"
import { GENERAL_JOURNAL_BRANCH_SCOPE_NOTE } from "../../utils/financeGeneralJournalConstants"
import {
  GENERAL_LEDGER_DEFAULT_PAGE_SIZE,
  GENERAL_LEDGER_PAGE_SIZES
} from "../../utils/financeGeneralLedgerConstants"
import {
  createGeneralLedgerLoadController,
  fetchGeneralLedgerReport
} from "../../utils/financeGeneralLedgerLoad"
import {
  buildGeneralLedgerCsv,
  buildLedgerEntryHref,
  fetchAllGeneralLedgerRows,
  filterReportDetailAccounts,
  ledgerScopeLabel,
  reportAccountStatusMarks,
  resolveLedgerScreen,
  validateGeneralLedgerQuery
} from "../../utils/financeGeneralLedgerUtils"
import { accountSelectionLabel } from "../../utils/financeJournalAccountMenu"
import { defaultMonthRange, formatMoney, labelFor } from "./financeUtils"
import { Field } from "./FinanceJournalField"
import FinanceReportAccountInput from "./FinanceReportAccountInput"
import "./Finance.css"

const BALANCE_SIDE_LABELS = {
  debit: "Deudor",
  credit: "Acreedor",
  zero: "Cero"
}

function downloadCsv(filename, content) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function sideLabel(side) {
  return BALANCE_SIDE_LABELS[side] || ""
}

export default function FinanceGeneralLedgerTab({ user, notify }) {
  const canView = canViewAccountingJournal(user)
  const defaultRange = useMemo(() => defaultMonthRange(), [])
  const createInitialFilters = useCallback(() => ({
    fromDate: defaultRange.from,
    toDate: defaultRange.to,
    periodId: "",
    branchId: "",
    costCenterId: "",
    accountId: "",
    accountQuery: "",
    search: "",
    pageSize: GENERAL_LEDGER_DEFAULT_PAGE_SIZE
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
  const [accounts, setAccounts] = useState([])
  const loadControllerRef = useRef(null)
  if (!loadControllerRef.current) {
    loadControllerRef.current = createGeneralLedgerLoadController()
  }

  const reportAccounts = useMemo(() => filterReportDetailAccounts(accounts), [accounts])
  const selectedAccount = reportAccounts.find((account) => account.id === appliedFilters.accountId) || report?.account || null
  const accountMarks = reportAccountStatusMarks(selectedAccount)
  const screen = resolveLedgerScreen({
    canView,
    accountId: appliedFilters.accountId,
    loading,
    error,
    report
  })
  const scopeLabel = ledgerScopeLabel({
    branchId: appliedFilters.branchId,
    costCenterId: appliedFilters.costCenterId
  })

  const loadReferenceData = useCallback(async () => {
    const [periodsRes, branchesRes, ccRes, accountsRes] = await Promise.all([
      listFinanceAccountingPeriods({}),
      listBranches({ includeInactive: true }),
      listFinanceCostCenters({ includeInactive: true }),
      listFinanceChartAccounts({ includeInactive: true })
    ])
    if (periodsRes.error) notify(periodsRes.error, "error")
    else setPeriods(periodsRes.data)
    if (branchesRes.error) notify(branchesRes.error, "error")
    else setBranches(branchesRes.data)
    if (ccRes.error) notify(ccRes.error, "error")
    else setCostCenters(ccRes.data)
    if (accountsRes.error) notify(accountsRes.error, "error")
    else setAccounts(accountsRes.data)
  }, [notify])

  const loadReport = useCallback(async (filters, targetPage = 1, options = {}) => {
    const period = periods.find((item) => item.id === filters.periodId) || null
    if (filters.periodId && !period) {
      const message = "El periodo contable no existe."
      setError(message)
      notify(message, "error")
      return
    }
    await fetchGeneralLedgerReport({
      canView,
      filters,
      period,
      targetPage,
      options,
      controller: loadControllerRef.current,
      fetchReport: getFinanceGeneralLedger,
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
    if (!canView || !appliedFilters.accountId) {
      setReport(null)
      return
    }
    loadReport(appliedFilters, page, { reuseSnapshot: page > 1 })
  }, [appliedFilters, canView, loadReport, page])

  function updateDraft(patch) {
    setDraftFilters((current) => ({ ...current, ...patch }))
  }

  function handleAccountQuery(nextQuery) {
    const selected = reportAccounts.find((account) => account.id === draftFilters.accountId)
    const label = selected ? accountSelectionLabel(selected) : ""
    if (draftFilters.accountId && nextQuery !== label) {
      updateDraft({ accountQuery: nextQuery, accountId: "" })
      return
    }
    updateDraft({ accountQuery: nextQuery })
  }

  function handleAccountSelect(account) {
    updateDraft({
      accountId: account.id,
      accountQuery: accountSelectionLabel(account)
    })
  }

  function applyFilters() {
    const period = periods.find((item) => item.id === draftFilters.periodId) || null
    const check = validateGeneralLedgerQuery({
      accountId: draftFilters.accountId,
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
    if (!report || !appliedFilters.accountId) return
    setExporting(true)
    try {
      const exportFilters = {
        fromDate: appliedFilters.fromDate || null,
        toDate: appliedFilters.toDate || null,
        periodId: appliedFilters.periodId || null,
        branchId: appliedFilters.branchId || null,
        costCenterId: appliedFilters.costCenterId || null,
        accountId: appliedFilters.accountId,
        search: appliedFilters.search || null
      }
      const outcome = await fetchAllGeneralLedgerRows(
        getFinanceGeneralLedger,
        exportFilters,
        report.matchCount,
        loadControllerRef.current.snapshotAt || report.snapshotAt || null
      )
      if (!outcome.ok) {
        notify(outcome.error, "error")
        return
      }
      const csv = buildGeneralLedgerCsv({
        rows: outcome.rows,
        report,
        searchApplied: Boolean(report.searchApplied)
      })
      const suffix = appliedFilters.fromDate && appliedFilters.toDate
        ? `${appliedFilters.fromDate}_a_${appliedFilters.toDate}`
        : "filtrado"
      downloadCsv(`libro_mayor_${suffix}.csv`, csv)
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
    <article className="finance-panel finance-general-ledger">
      <div className="finance-panel__head">
        <div>
          <h2>Libro Mayor</h2>
          <p className="tasks-muted">
            Movimientos contabilizados de una cuenta de detalle. El saldo se calcula sobre el alcance completo antes de la búsqueda.
          </p>
          <p className="tasks-muted finance-journal-list-note">{GENERAL_JOURNAL_BRANCH_SCOPE_NOTE}</p>
        </div>
        <div className="finance-actions">
          <button
            type="button"
            className="tasks-secondary"
            onClick={() => loadReport(appliedFilters, page, { fresh: true })}
            disabled={loading || !appliedFilters.accountId}
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
        <Field label="Cuenta de detalle" htmlFor="gl-filter-account" className="finance-field--wide">
          <FinanceReportAccountInput
            id="gl-filter-account"
            query={draftFilters.accountQuery}
            accountId={draftFilters.accountId}
            accounts={reportAccounts}
            onQueryChange={handleAccountQuery}
            onSelectAccount={handleAccountSelect}
          />
        </Field>
        <Field label="Desde" htmlFor="gl-filter-from">
          <input
            id="gl-filter-from"
            type="date"
            value={draftFilters.fromDate}
            onChange={(event) => updateDraft({ fromDate: event.target.value })}
          />
        </Field>
        <Field label="Hasta" htmlFor="gl-filter-to">
          <input
            id="gl-filter-to"
            type="date"
            value={draftFilters.toDate}
            onChange={(event) => updateDraft({ toDate: event.target.value })}
          />
        </Field>
        <Field label="Periodo" htmlFor="gl-filter-period">
          <select
            id="gl-filter-period"
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
        <Field label="Sucursal" htmlFor="gl-filter-branch">
          <select
            id="gl-filter-branch"
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
        <Field label="Centro de costo" htmlFor="gl-filter-cc">
          <select
            id="gl-filter-cc"
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
        <Field label="Búsqueda" htmlFor="gl-filter-search" className="finance-field--wide">
          <input
            id="gl-filter-search"
            type="search"
            placeholder="Partida, referencia o descripción"
            value={draftFilters.search}
            onChange={(event) => updateDraft({ search: event.target.value })}
          />
        </Field>
        <Field label="Tamaño de página" htmlFor="gl-filter-page-size">
          <select
            id="gl-filter-page-size"
            value={draftFilters.pageSize}
            onChange={(event) => updateDraft({ pageSize: Number(event.target.value) })}
          >
            {GENERAL_LEDGER_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
        </Field>
        <div className="finance-field finance-field--actions">
          <span aria-hidden="true">&nbsp;</span>
          <button type="button" className="tasks-primary" onClick={applyFilters} disabled={loading}>
            Aplicar filtros
          </button>
        </div>
      </div>

      {screen.state === "needs-account" ? (
        <p className="tasks-muted finance-general-ledger-status">Seleccione una cuenta contable de detalle.</p>
      ) : null}

      {screen.state === "loading" ? (
        <p className="tasks-muted finance-general-ledger-status">Cargando Libro Mayor…</p>
      ) : null}

      {screen.state === "error" ? (
        <p className="tasks-muted finance-general-ledger-status" role="alert">{error}</p>
      ) : null}

      {screen.showReport && report ? (
        <>
          <div className="finance-ledger-scope" role="status">
            <strong>{scopeLabel}</strong>
            {selectedAccount ? (
              <span>
                {selectedAccount.code || report.account?.code} — {selectedAccount.name || report.account?.name}
              </span>
            ) : null}
            {accountMarks.map((mark) => (
              <span key={mark} className="finance-badge finance-ledger-account-mark">{mark}</span>
            ))}
            <span className="tasks-muted">
              Ventana {report.effectiveFrom || "sin inicio"} a {report.effectiveTo || "sin fin"}
            </span>
          </div>

          <div className="finance-journal-totals finance-ledger-totals">
            <div>
              <span>Saldo inicial</span>
              <strong>{formatMoney(report.openingBalance)} {sideLabel(report.openingSide)}</strong>
              {report.openingContrary ? <em>Contrario a la naturaleza</em> : null}
            </div>
            <div>
              <span>Debe del periodo</span>
              <strong>{formatMoney(report.periodDebit)}</strong>
            </div>
            <div>
              <span>Haber del periodo</span>
              <strong>{formatMoney(report.periodCredit)}</strong>
            </div>
            <div>
              <span>Saldo final</span>
              <strong>{formatMoney(report.closingBalance)} {sideLabel(report.closingSide)}</strong>
              {report.closingContrary ? <em>Contrario a la naturaleza</em> : null}
            </div>
          </div>

          {report.searchApplied ? (
            <p className="tasks-muted finance-general-ledger-status">
              Coincidencias: {report.matchCount} de {report.movementCount} movimientos.
              Los totales y el saldo final corresponden al libro completo, antes de la búsqueda.
            </p>
          ) : (
            <p className="tasks-muted finance-general-ledger-status">
              Movimientos del alcance: {report.movementCount}.
            </p>
          )}

          {report.matchCount === 0 ? (
            <p className="tasks-muted finance-general-ledger-status">
              No hay filas para mostrar en esta consulta. El saldo inicial y el saldo final siguen siendo los del alcance completo.
            </p>
          ) : (
            <div className="finance-general-ledger-table-wrap" role="region" aria-label="Libro Mayor">
              <table className="finance-general-ledger-table">
                <thead>
                  <tr>
                    <th scope="col">Fecha</th>
                    <th scope="col">Partida</th>
                    <th scope="col">Concepto</th>
                    <th scope="col" className="finance-general-ledger-num">Debe</th>
                    <th scope="col" className="finance-general-ledger-num">Haber</th>
                    <th scope="col" className="finance-general-ledger-num">Saldo acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={5}>Saldo inicial del alcance</td>
                    <td className="finance-general-ledger-num">
                      {formatMoney(report.openingBalance)} {sideLabel(report.openingSide)}
                    </td>
                  </tr>
                  {report.rows.map((row) => (
                    <tr key={row.lineId} className={row.isReversal ? "finance-general-ledger-row--reversal" : ""}>
                      <td data-label="Fecha">{row.entryDate}</td>
                      <td data-label="Partida">
                        <Link to={buildLedgerEntryHref(row.entryId)} className="tasks-link">
                          {row.entryNumber || "—"}
                        </Link>
                        {row.isReversal ? (
                          <span className="finance-badge finance-ledger-account-mark">
                            Reversión{row.reversalOfEntryNumber ? ` de ${row.reversalOfEntryNumber}` : ""}
                          </span>
                        ) : null}
                      </td>
                      <td data-label="Concepto">
                        <div>{row.lineDescription || row.entryDescription || "—"}</div>
                        {row.branchName || row.branchCode ? (
                          <div className="tasks-muted">Sucursal: {row.branchName || row.branchCode}</div>
                        ) : null}
                        {row.costCenterName || row.costCenterCode ? (
                          <div className="tasks-muted">Centro: {row.costCenterName || row.costCenterCode}</div>
                        ) : null}
                      </td>
                      <td className="finance-general-ledger-num" data-label="Debe">{row.debit > 0 ? formatMoney(row.debit) : "—"}</td>
                      <td className="finance-general-ledger-num" data-label="Haber">{row.credit > 0 ? formatMoney(row.credit) : "—"}</td>
                      <td className="finance-general-ledger-num" data-label="Saldo acumulado">
                        {formatMoney(row.runningBalance)} {row.balanceSideLabel}
                        {row.contraryToNature ? <div className="tasks-muted">Contrario a la naturaleza</div> : null}
                      </td>
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
