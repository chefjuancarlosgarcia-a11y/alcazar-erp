export const JOURNAL_STATUSES = ["draft", "pending_approval", "approved", "posted"]

export const JOURNAL_STATUS_LABELS = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobada",
  posted: "Contabilizada"
}

export function journalStatusBadgeClass(status) {
  if (status === "posted") return "finance-journal-badge--posted"
  if (status === "approved") return "finance-journal-badge--approved"
  if (status === "pending_approval") return "finance-journal-badge--pending"
  return "finance-journal-badge--draft"
}
