import PaginationControls from "../../components/PaginationControls"
import { journalStatusBadgeClass, JOURNAL_STATUS_LABELS } from "../../utils/financeJournalConstants"
import { JOURNAL_BRANCH_FILTER_DEFERRED } from "../../utils/financeJournalValidation"
import { DEFAULT_PAGE_SIZE, pageItems } from "../../utils/pagination"
import { formatMoney, labelFor } from "./financeUtils"
import { Field } from "./FinanceJournalField"
import { formatDateTime, formatUserRef, periodLabel, sumEntryLines } from "./financeJournalUiUtils"
import { lineTotals } from "../../utils/financeJournalValidation"

export default function FinanceJournalEntryList({
  entries,
  periods,
  filters,
  onFiltersChange,
  page,
  onPageChange,
  loadingList,
  selectedId,
  onSelectEntry,
  onRefresh,
  onNewDraft,
  canCreate,
  pendingAction
}) {
  const pagedEntries = pageItems(entries, page, DEFAULT_PAGE_SIZE)

  return (
    <article className="finance-panel finance-journal-list">
      <div className="finance-panel__head">
        <div>
          <h2>Partidas contables</h2>
          <p className="tasks-muted">Partidas manuales con flujo controlado vía RPC contable.</p>
          <p className="tasks-muted finance-journal-list-note">{JOURNAL_BRANCH_FILTER_DEFERRED}</p>
        </div>
        <div className="finance-actions">
          {canCreate ? (
            <button type="button" className="tasks-primary" onClick={onNewDraft} disabled={!!pendingAction}>
              Nueva partida
            </button>
          ) : null}
          <button type="button" className="tasks-secondary" onClick={onRefresh} disabled={loadingList}>
            {loadingList ? "Actualizando…" : "Actualizar"}
          </button>
        </div>
      </div>

      <div className="finance-filters finance-journal-filters">
        <Field label="Desde" htmlFor="journal-filter-from">
          <input
            id="journal-filter-from"
            type="date"
            value={filters.fromDate}
            onChange={(e) => onFiltersChange({ fromDate: e.target.value })}
          />
        </Field>
        <Field label="Hasta" htmlFor="journal-filter-to">
          <input
            id="journal-filter-to"
            type="date"
            value={filters.toDate}
            onChange={(e) => onFiltersChange({ toDate: e.target.value })}
          />
        </Field>
        <Field label="Periodo" htmlFor="journal-filter-period">
          <select
            id="journal-filter-period"
            value={filters.periodId}
            onChange={(e) => onFiltersChange({ periodId: e.target.value })}
          >
            <option value="">Todos</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.period_year}-{String(period.period_month).padStart(2, "0")} (
                {labelFor({ open: "Abierto", soft_closed: "Cierre suave", closed: "Cerrado" }, period.status)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Estado" htmlFor="journal-filter-status">
          <select
            id="journal-filter-status"
            value={filters.status}
            onChange={(e) => onFiltersChange({ status: e.target.value })}
          >
            <option value="">Todos</option>
            {Object.entries(JOURNAL_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field label="Búsqueda" className="finance-field--full" htmlFor="journal-filter-search">
          <input
            id="journal-filter-search"
            type="search"
            placeholder="Descripción, referencia o número"
            value={filters.search}
            onChange={(e) => onFiltersChange({ search: e.target.value })}
          />
        </Field>
      </div>

      <div className="finance-table-wrap finance-journal-table-wrap">
        <table className="finance-table finance-journal-table">
          <thead>
            <tr>
              <th scope="col">Número</th>
              <th scope="col">Fecha</th>
              <th scope="col">Periodo</th>
              <th scope="col">Descripción</th>
              <th scope="col">Referencia</th>
              <th scope="col">Estado</th>
              <th scope="col" className="finance-journal-num">Debe</th>
              <th scope="col" className="finance-journal-num">Haber</th>
              <th scope="col">Creador</th>
              <th scope="col">Creado</th>
            </tr>
          </thead>
          <tbody>
            {pagedEntries.map((row) => {
              const sums = sumEntryLines(row, lineTotals)
              const isSelected = selectedId === row.id
              return (
                <tr
                  key={row.id}
                  className={`finance-journal-row finance-journal-row--${row.status} ${isSelected ? "is-selected" : ""}`.trim()}
                  onClick={() => onSelectEntry(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onSelectEntry(row)
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-selected={isSelected}
                  aria-label={`Partida ${row.entry_number || row.description || row.id}`}
                >
                  <td>{row.entry_number || "—"}</td>
                  <td>{row.entry_date}</td>
                  <td>{periodLabel(periods, row.period_id)}</td>
                  <td>{row.description}</td>
                  <td>{row.reference || "—"}</td>
                  <td>
                    <span className={`finance-badge ${journalStatusBadgeClass(row.status)}`}>
                      {labelFor(JOURNAL_STATUS_LABELS, row.status)}
                    </span>
                  </td>
                  <td className="finance-journal-num">{formatMoney(sums.debit, row.currency || "GTQ")}</td>
                  <td className="finance-journal-num">{formatMoney(sums.credit, row.currency || "GTQ")}</td>
                  <td>{formatUserRef(row.created_by)}</td>
                  <td>{formatDateTime(row.created_at)}</td>
                </tr>
              )
            })}
            {!pagedEntries.length && !loadingList ? (
              <tr><td colSpan={10} className="tasks-muted">Sin partidas para los filtros actuales.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <PaginationControls page={page} total={entries.length} onChange={onPageChange} />
    </article>
  )
}
