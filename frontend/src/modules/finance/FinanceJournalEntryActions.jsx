export default function FinanceJournalEntryActions({
  allowedActions,
  pendingAction,
  difference,
  entry,
  onSaveDraft,
  onSubmit,
  onApprove,
  onRejectOpen,
  onPostOpen,
  onReverseOpen
}) {
  return (
    <div className="finance-actions finance-journal-actions">
      {allowedActions.includes("save_draft") ? (
        <button type="button" className="tasks-secondary" disabled={!!pendingAction} onClick={onSaveDraft}>
          {pendingAction === "save" ? "Guardando…" : "Guardar borrador"}
        </button>
      ) : null}
      {allowedActions.includes("submit") ? (
        <button
          type="button"
          className="tasks-primary"
          disabled={!!pendingAction || difference !== 0}
          onClick={onSubmit}
        >
          {pendingAction === "submit" ? "Enviando…" : "Enviar a aprobación"}
        </button>
      ) : null}
      {allowedActions.includes("approve") ? (
        <button type="button" className="tasks-primary" disabled={!!pendingAction} onClick={onApprove}>
          {pendingAction === "approve" ? "Aprobando…" : "Aprobar"}
        </button>
      ) : null}
      {allowedActions.includes("reject") ? (
        <button type="button" className="tasks-secondary" disabled={!!pendingAction} onClick={onRejectOpen}>
          Rechazar
        </button>
      ) : null}
      {allowedActions.includes("post") ? (
        <button type="button" className="tasks-primary" disabled={!!pendingAction} onClick={onPostOpen}>
          Contabilizar
        </button>
      ) : null}
      {allowedActions.includes("reverse") ? (
        <button
          type="button"
          className="tasks-secondary"
          disabled={!!pendingAction || !!entry?.reversed_by_entry_id}
          onClick={onReverseOpen}
        >
          Revertir
        </button>
      ) : null}
    </div>
  )
}
