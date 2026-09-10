import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import PaginationControls from "../../components/PaginationControls"
import { getFinanceGeneralJournal } from "../../services/financeGeneralJournalService"
import {
  listBranches,
  listFinanceAccountingPeriods,
  listFinanceCostCenters
} from "../../services/financeAccountingFoundationService"
import { listFinanceChartAccounts } from "../../services/financeChartAccountsService"
import { canViewAccountingJournal } from "../../utils/financePermissions"
import {
  GENERAL_JOURNAL_BRANCH_SCOPE_NOTE,
  GENERAL_JOURNAL_DEFAULT_PAGE_SIZE,
  GENERAL_JOURNAL_PAGE_SIZES
} from "../../utils/financeGeneralJournalConstants"
import {
  createGeneralJournalLoadController,
  fetchGeneralJournalReport
} from "../../utils/financeGeneralJournalLoad"
import {
  buildGeneralJournalCsv,
  fetchAllGeneralJournalRows,
  formatGeneralJournalSummary,
  groupGeneralJournalRows,
  resolveGeneralJournalPageSize,
  validateGeneralJournalDateRange
} from "../../utils/financeGeneralJournalUtils"
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

export default function FinanceGeneralJournalTab({ user, notify }) {
  const canView = canViewAccountingJournal(user)
  const defaultRange = useMemo(() => defaultMonthRange(), [])
  const createInitialFilters = useCallback(() => ({
    fromDate: defaultRange.from,
    toDate: defaultRange.to,
    periodId: "",
    branchId: "",
    costCenterId: "",
    accountId: "",
    search: "",
    pageSize: GENERAL_JOURNAL_DEFAULT_PAGE_SIZE
  }), [defaultRange.from, defaultRange.to])

  const [draftFilters, setDraftFilters] = useState(createInitialFilters)
  const [appliedFilters, setAppliedFilters] = useState(createInitialFilters)
  const [page, setPage] = useState(1)
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const [periods, setPeriods] = useState([])
  const [branches, setBranches] = useState([])
  const [costCenters, setCostCenters] = useState([])
  const [accounts, setAccounts] = useState([])
  const loadControllerRef = useRef(null)
  if (!loadControllerRef.current) {
    loadControllerRef.current = createGeneralJournalLoadController()
  }

  const groupedRows = useMemo(
    () => groupGeneralJournalRows(report?.rows || []),
    [report?.rows]
  )

  const loadReferenceData = useCallback(async () => {
    const [periodsRes, branchesRes, ccRes, accountsRes] = await Promise.all([
      listFinanceAccountingPeriods({}),
      listBranches({ isActive: true }),
      listFinanceCostCenters({ includeInactive: true }),
      listFinanceChartAccounts({ includeInactive: true })
    ])
    if (periodsRes.error) notify(periodsRes.error, "error")
    else setPeriods(periodsRes.data)
    if (branchesRes.error) notify(branchesRes.error, "error")
    else setBranches(branchesRes.data.filter((row) => row.is_active))
    if (ccRes.error) notify(ccRes.error, "error")
    else setCostCenters(ccRes.data)
    if (accountsRes.error) notify(accountsRes.error, "error")
    else setAccounts(accountsRes.data.filter((row) => row.accepts_entries))
  }, [notify])

  const loadReport = useCallback(async (filters, targetPage = 1, options = {}) => {
    await fetchGeneralJournalReport({
      canView,
      filters,
      targetPage,
      options,
      controller: loadControllerRef.current,
      fetchReport: getFinanceGeneralJournal,
      onError: (message) => notify(message, "error"),
      setLoading,
      onSuccess: (data, nextPage) => {
        setReport(data)
        setPage(nextPage)
      }
    })
  }, [canView, notify])

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
    const dateCheck = validateGeneralJournalDateRange(draftFilters.fromDate, draftFilters.toDate)
    if (!dateCheck.ok) {
      notify(dateCheck.message, "error")
      return
    }
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
        accountId: appliedFilters.accountId || null,
        search: appliedFilters.search || null
      }
      const outcome = await fetchAllGeneralJournalRows(
        getFinanceGeneralJournal,
        exportFilters,
        report.totalRows,
        loadControllerRef.current.snapshotAt || report.snapshotAt || null
      )
      if (!outcome.ok) {
        notify(outcome.error, "error")
        return
      }
      const csv = buildGeneralJournalCsv(outcome.rows, outcome.totals || {
        totalDebit: report.totalDebit,
        totalCredit: report.totalCredit,
        difference: report.difference,
        isBalanced: report.isBalanced
      })
      const suffix = appliedFilters.fromDate && appliedFilters.toDate
        ? `${appliedFilters.fromDate}_a_${appliedFilters.toDate}`
        : "filtrado"
      downloadCsv(`libro_diario_${suffix}.csv`, csv)
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
    <article className="finance-panel finance-general-journal">
      <div className="finance-panel__head">
        <div>
          <h2>Libro Diario</h2>
          <p className="tasks-muted">
            Movimientos contabilizados (solo partidas con estado contabilizada). Orden cronológico server-side.
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
            disabled={loading || exporting || !report?.totalRows}
          >
            {exporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>
      </div>

      <div className="finance-filters finance-journal-filters">
        <Field label="Desde" htmlFor="gj-filter-from">
          <input
            id="gj-filter-from"
            type="date"
            value={draftFilters.fromDate}
            onChange={(e) => updateDraft({ fromDate: e.target.value })}
          />
        </Field>
        <Field label="Hasta" htmlFor="gj-filter-to">
          <input
            id="gj-filter-to"
            type="date"
            value={draftFilters.toDate}
            onChange={(e) => updateDraft({ toDate: e.target.value })}
          />
        </Field>
        <Field label="Periodo" htmlFor="gj-filter-period">
          <select
            id="gj-filter-period"
            value={draftFilters.periodId}
            onChange={(e) => updateDraft({ periodId: e.target.value })}
          >
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.period_year}-{String(period.period_month).padStart(2, "0")} ({labelFor({ open: "Abierto", soft_closed: "Cierre suave", closed: "Cerrado" }, period.status)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sucursal" htmlFor="gj-filter-branch">
          <select
            id="gj-filter-branch"
            value={draftFilters.branchId}
            onChange={(e) => updateDraft({ branchId: e.target.value })}
          >
            <option value="">Todas</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.code} — {branch.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Centro de costo" htmlFor="gj-filter-cc">
          <select
            id="gj-filter-cc"
            value={draftFilters.costCenterId}
            onChange={(e) => updateDraft({ costCenterId: e.target.value })}
          >
            <option value="">Todos</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.id}>{center.code} — {center.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cuenta contable" htmlFor="gj-filter-account">
          <select
            id="gj-filter-account"
            value={draftFilters.accountId}
            onChange={(e) => updateDraft({ accountId: e.target.value })}
          >
            <option value="">Todas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Búsqueda" htmlFor="gj-filter-search" className="finance-field--wide">
          <input
            id="gj-filter-search"
            type="search"
            placeholder="Partida, referencia, descripción o cuenta"
            value={draftFilters.search}
            onChange={(e) => updateDraft({ search: e.target.value })}
          />
        </Field>
        <Field label="Tamaño de página" htmlFor="gj-filter-page-size">
          <select
            id="gj-filter-page-size"
            value={draftFilters.pageSize}
            onChange={(e) => updateDraft({ pageSize: Number(e.target.value) })}
          >
            {GENERAL_JOURNAL_PAGE_SIZES.map((size) => (
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

      {loading && !report ? (
        <p className="tasks-muted finance-general-journal-status">Cargando Libro Diario…</p>
      ) : null}

      {!loading && report && report.totalRows === 0 ? (
        <p className="tasks-muted finance-general-journal-status">
          No hay movimientos contabilizados para los filtros seleccionados.
        </p>
      ) : null}

      {report && report.totalRows > 0 ? (
        <>
          <div className="finance-general-journal-table-wrap" role="region" aria-label="Libro Diario">
            <table className="finance-general-journal-table">
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Partida / descripción / cuenta</th>
                  <th scope="col" className="finance-general-journal-num">Debe (Q.)</th>
                  <th scope="col" className="finance-general-journal-num">Haber (Q.)</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((group) => (
                  group.lines.map((line, index) => (
                    <tr key={line.lineId} className={group.isReversal ? "finance-general-journal-row--reversal" : ""}>
                      <td>{index === 0 ? group.entryDate : ""}</td>
                      <td>
                        {index === 0 ? (
                          <div className="finance-general-journal-entry-head">
                            <Link
                              to={`/finance?tab=partidas&entry=${encodeURIComponent(group.entryId)}`}
                              className="tasks-link finance-general-journal-entry-link"
                            >
                              {group.entryNumber || "—"}
                            </Link>
                            {group.entryReference ? <span className="tasks-muted"> · {group.entryReference}</span> : null}
                            {group.isReversal ? (
                              <span className="finance-badge finance-general-journal-badge--reversal">
                                Reversión{group.reversalOfEntryNumber ? ` de ${group.reversalOfEntryNumber}` : ""}
                              </span>
                            ) : null}
                            {!group.isReversal && group.reversedByEntryId ? (
                              <span className="finance-badge finance-general-journal-badge--reversed">Revertida</span>
                            ) : null}
                            <div className="finance-general-journal-entry-desc">{group.entryDescription || "—"}</div>
                          </div>
                        ) : null}
                        <div className="finance-general-journal-line-detail">
                          <strong>{line.accountCode}</strong> {line.accountName}
                          {line.lineDescription || line.lineReference ? (
                            <div className="tasks-muted">{line.lineDescription || line.lineReference}</div>
                          ) : null}
                          {line.branchName || line.branchCode ? (
                            <div className="tasks-muted">Sucursal: {line.branchName || line.branchCode}</div>
                          ) : null}
                          {line.costCenterName || line.costCenterCode ? (
                            <div className="tasks-muted">Centro: {line.costCenterName || line.costCenterCode}</div>
                          ) : null}
                        </div>
                      </td>
                      <td className="finance-general-journal-num">{line.debit > 0 ? formatMoney(line.debit) : "—"}</td>
                      <td className="finance-general-journal-num">{line.credit > 0 ? formatMoney(line.credit) : "—"}</td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          </div>

          <div className={`finance-journal-totals ${report.isBalanced ? "is-balanced" : "is-unbalanced"}`}>
            <div>
              <span>Total debe</span>
              <strong>{formatMoney(report.totalDebit)}</strong>
            </div>
            <div>
              <span>Total haber</span>
              <strong>{formatMoney(report.totalCredit)}</strong>
            </div>
            <div>
              <span>Diferencia</span>
              <strong>{formatMoney(report.difference)}</strong>
            </div>
            <div>
              <span>Estado</span>
              <strong>{report.isBalanced ? "Cuadrado" : "Advertencia — descuadre"}</strong>
            </div>
          </div>

          <p className="tasks-muted finance-general-journal-summary">
            {formatGeneralJournalSummary(report.totalRows, report.totalEntries)}
          </p>
          <PaginationControls
            page={page}
            total={report.totalRows}
            pageSize={resolveGeneralJournalPageSize(report, appliedFilters)}
            onChange={setPage}
          />
        </>
      ) : null}
    </article>
  )
}
