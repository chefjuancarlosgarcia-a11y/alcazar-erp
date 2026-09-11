import { formatDateTime, formatUserRef } from "./financeJournalUiUtils"

export default function FinanceJournalAuditTrail({ entry }) {
  return (
    <section className="finance-journal-audit" aria-labelledby="journal-audit-title">
      <h3 id="journal-audit-title">Auditoría</h3>
      <dl>
        <div><dt>Creado</dt><dd>{formatUserRef(entry.created_by)} · {formatDateTime(entry.created_at)}</dd></div>
        {entry.submitted_at ? (
          <div><dt>Enviado</dt><dd>{formatUserRef(entry.submitted_by)} · {formatDateTime(entry.submitted_at)}</dd></div>
        ) : null}
        {entry.approved_at ? (
          <div><dt>Aprobado</dt><dd>{formatUserRef(entry.approved_by)} · {formatDateTime(entry.approved_at)}</dd></div>
        ) : null}
        {entry.posted_at ? (
          <div><dt>Contabilizado</dt><dd>{formatUserRef(entry.posted_by)} · {formatDateTime(entry.posted_at)}</dd></div>
        ) : null}
        {entry.rejected_at ? (
          <div>
            <dt>Rechazado</dt>
            <dd>{formatUserRef(entry.rejected_by)} · {formatDateTime(entry.rejected_at)} — {entry.rejection_reason}</dd>
          </div>
        ) : null}
        {entry.reversal_of_id ? <div><dt>Reversión de</dt><dd>{entry.reversal_of_id}</dd></div> : null}
        {entry.reversed_by_entry_id ? <div><dt>Revertida por</dt><dd>{entry.reversed_by_entry_id}</dd></div> : null}
        {entry.reversal_reason ? <div><dt>Motivo reversión</dt><dd>{entry.reversal_reason}</dd></div> : null}
      </dl>
    </section>
  )
}
