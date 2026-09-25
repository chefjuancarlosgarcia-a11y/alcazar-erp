export const UNSAVED_JOURNAL_CONFIRM =
  "Hay cambios sin guardar en la partida. ¿Desea descartarlos?"

export function confirmDiscardJournalChanges(isDirty) {
  if (!isDirty) return true
  return window.confirm(UNSAVED_JOURNAL_CONFIRM)
}

export function createJournalLeaveGuard(isDirty) {
  return {
    isDirty,
    confirmLeave: () => confirmDiscardJournalChanges(isDirty)
  }
}
