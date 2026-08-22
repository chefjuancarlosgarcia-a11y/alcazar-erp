/**
 * Editor selection state after a persist/submit RPC result.
 * Keeps selectedId/isLocalDraft in sync so a saved draft is reused (no duplicate create).
 */
export function selectionPatchAfterPersistResult(result) {
  if (!result?.entryId) {
    return null
  }
  return {
    selectedId: result.entryId,
    isLocalDraft: false
  }
}

/**
 * Apply selection patch to a mutable editor-selection snapshot (for tests and callers).
 */
export function applySelectionPatchAfterPersistResult(selection, result) {
  const patch = selectionPatchAfterPersistResult(result)
  if (!patch) {
    return { ...selection }
  }
  return {
    ...selection,
    selectedId: patch.selectedId,
    isLocalDraft: patch.isLocalDraft
  }
}
