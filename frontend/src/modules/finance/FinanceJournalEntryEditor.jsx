import FinanceJournalLinesEditor from "./FinanceJournalLinesEditor"
import FinanceJournalEntryActions from "./FinanceJournalEntryActions"
import FinanceJournalAuditTrail from "./FinanceJournalAuditTrail"
import { journalStatusBadgeClass, JOURNAL_STATUS_LABELS } from "../../utils/financeJournalConstants"
import { formatMoney, labelFor } from "./financeUtils"
import { Field } from "./FinanceJournalField"

export default function FinanceJournalEntryEditor({
  isLocalDraft,
  entry,
  form,
  onFormChange,
  loadingDetail,
  isEditable,
  allowedActions,
  totals,
  difference,
  branches,
  costCenters,
  postableAccounts,
  accountsById,
  accountQueries,
  onAccountQueriesChange,
  onUpdateLine,
  onAddLine,
  onDuplicateLine,
  onRemoveLine,
  onSelectAccount,
  onClose,
  pendingAction,
  onSaveDraft,
  onSubmit,
  onApprove,
  onRejectOpen,
  onPostOpen,
  onReverseOpen,
  hasSelection
}) {
  if (!hasSelection) {
    return (
      <article className="finance-panel finance-journal-editor">
        <p className="tasks-muted">Seleccione una partida de la lista o cree una nueva.</p>
      </article>
    )
  }

  return (
    <article className="finance-panel finance-journal-editor" aria-labelledby="journal-editor-title">
      <div className="finance-panel__head">
        <div>
          <h2 id="journal-editor-title">{isLocalDraft ? "Nueva partida" : entry?.entry_number || "Detalle de partida"}</h2>
          {!isLocalDraft && entry ? (
            <p className="tasks-muted">
              <span className={`finance-badge ${journalStatusBadgeClass(entry.status)}`}>
                {labelFor(JOURNAL_STATUS_LABELS, entry.status)}
              </span>
            </p>
          ) : (
            <p className="tasks-muted">Borrador local — aún no se guarda en base de datos.</p>
          )}
        </div>
        <button type="button" className="tasks-link" onClick={onClose}>Cerrar</button>
      </div>

      {loadingDetail ? (
        <p className="tasks-muted" aria-live="polite">Cargando detalle…</p>
      ) : (
        <>
          <div className="finance-form-grid">
            <Field label="Fecha contable" htmlFor="journal-entry-date">
              <input
                id="journal-entry-date"
                type="date"
                value={form.entry_date}
                disabled={!isEditable}
                onChange={(e) => onFormChange({ entry_date: e.target.value })}
              />
            </Field>
            <Field label="Referencia" htmlFor="journal-entry-reference">
              <input
                id="journal-entry-reference"
                type="text"
                value={form.reference}
                disabled={!isEditable}
                onChange={(e) => onFormChange({ reference: e.target.value })}
              />
            </Field>
            <Field label="Descripción" className="finance-field--full" htmlFor="journal-entry-description">
              <input
                id="journal-entry-description"
                type="text"
                value={form.description}
                disabled={!isEditable}
                onChange={(e) => onFormChange({ description: e.target.value })}
                required
                aria-required="true"
              />
            </Field>
          </div>

          <FinanceJournalLinesEditor
            lines={form.lines}
            isEditable={isEditable}
            branches={branches}
            costCenters={costCenters}
            postableAccounts={postableAccounts}
            accountsById={accountsById}
            accountQueries={accountQueries}
            onAccountQueriesChange={onAccountQueriesChange}
            onUpdateLine={onUpdateLine}
            onAddLine={onAddLine}
            onDuplicateLine={onDuplicateLine}
            onRemoveLine={onRemoveLine}
            onSelectAccount={onSelectAccount}
          />

          <div className="finance-journal-totals" aria-live="polite">
            <div><span>Total debe</span><strong>{formatMoney(totals.debit, entry?.currency || "GTQ")}</strong></div>
            <div><span>Total haber</span><strong>{formatMoney(totals.credit, entry?.currency || "GTQ")}</strong></div>
            <div className={difference === 0 ? "is-balanced" : "is-unbalanced"}>
              <span>Diferencia</span><strong>{formatMoney(difference, entry?.currency || "GTQ")}</strong>
            </div>
          </div>

          {!isLocalDraft && entry ? <FinanceJournalAuditTrail entry={entry} /> : null}

          <FinanceJournalEntryActions
            allowedActions={allowedActions}
            pendingAction={pendingAction}
            difference={difference}
            entry={entry}
            onSaveDraft={onSaveDraft}
            onSubmit={onSubmit}
            onApprove={onApprove}
            onRejectOpen={onRejectOpen}
            onPostOpen={onPostOpen}
            onReverseOpen={onReverseOpen}
          />
        </>
      )}
    </article>
  )
}
