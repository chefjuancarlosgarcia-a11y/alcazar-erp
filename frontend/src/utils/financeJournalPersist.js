import { buildDraftPayload, buildRpcLinesPayload, validateJournalForm } from "./financeJournalValidation.js"

/**
 * Persistencia create → replace con manejo explícito de fallos parciales.
 * Un reintento con entryId existente no vuelve a crear borrador.
 */
export async function persistJournalDraft({
  form,
  accountsById,
  entryId,
  isLocalDraft,
  createDraft,
  replaceLines,
  reloadEntry
}) {
  const validation = validateJournalForm(form, accountsById)
  if (!validation.valid) {
    return { ok: false, partial: false, stage: "validate", entryId: entryId || null, error: validation.message }
  }

  const linesPayload = buildRpcLinesPayload(form.lines, accountsById)
  let workingEntryId = entryId || null
  let createdInThisRun = false

  if (isLocalDraft || !workingEntryId) {
    const draft = await createDraft(buildDraftPayload(form))
    if (draft.error) {
      return { ok: false, partial: false, stage: "create", entryId: null, error: draft.error }
    }
    workingEntryId = draft.data.id
    createdInThisRun = true
  }

  const saved = await replaceLines(workingEntryId, linesPayload)
  if (saved.error) {
    let recovered = null
    if (reloadEntry) {
      const reload = await reloadEntry(workingEntryId)
      if (reload?.data) recovered = reload.data
    }
    return {
      ok: false,
      partial: true,
      stage: "replace",
      entryId: workingEntryId,
      createdInThisRun,
      error: saved.error,
      data: recovered,
      message: createdInThisRun
        ? "Borrador creado, pero no se guardaron las líneas. Reintente guardar sin crear otra partida."
        : "No se pudieron guardar las líneas. Reintente guardar el borrador existente."
    }
  }

  return {
    ok: true,
    partial: false,
    stage: "replace",
    entryId: workingEntryId,
    createdInThisRun,
    data: saved.data,
    error: ""
  }
}

/**
 * Guardar borrador y enviar a aprobación; submit fallido deja borrador persistido.
 */
export async function submitJournalEntryFlow({
  form,
  accountsById,
  entryId,
  isLocalDraft,
  createDraft,
  replaceLines,
  submitEntry,
  reloadEntry
}) {
  const persist = await persistJournalDraft({
    form,
    accountsById,
    entryId,
    isLocalDraft,
    createDraft,
    replaceLines,
    reloadEntry
  })

  if (!persist.ok) {
    return { ...persist, submitFailed: false }
  }

  const submitted = await submitEntry(persist.entryId)
  if (submitted.error) {
    let recovered = persist.data
    if (reloadEntry) {
      const reload = await reloadEntry(persist.entryId)
      if (reload?.data) recovered = reload.data
    }
    return {
      ok: false,
      partial: true,
      stage: "submit",
      entryId: persist.entryId,
      createdInThisRun: persist.createdInThisRun,
      error: submitted.error,
      data: recovered,
      message: "Borrador guardado, pero no se pudo enviar a aprobación. Revise el estado y reintente.",
      submitFailed: true
    }
  }

  return {
    ok: true,
    partial: false,
    stage: "submit",
    entryId: persist.entryId,
    data: submitted.data,
    error: "",
    submitFailed: false
  }
}
