const DRAFT_PREFIX = "checklist-draft:"
const META_PREFIX = "checklist-run-meta:"
const ACTIVE_SESSION_PREFIX = "checklist-active-session:"
const LAST_ACTIVE_KEY = "checklist-last-active"
const RETRY_QUEUE_KEY = "checklist-retry-queue"
const LOCAL_AUDIT_KEY = "checklist-session-audit"
const LOCAL_AUDIT_LIMIT = 120
const PHOTO_PREFIX = "checklist-photo:"

const flushCallbacks = new Set()

export function registerChecklistFlushCallback(callback) {
  flushCallbacks.add(callback)
  return () => flushCallbacks.delete(callback)
}

export async function flushAllChecklistPendingSaves() {
  const callbacks = [...flushCallbacks]
  await Promise.all(callbacks.map(async (callback) => {
    try {
      await callback()
    } catch (error) {
      console.warn("checklist flush callback failed", error)
    }
  }))
}

function draftKey(runId, itemId) {
  return `${DRAFT_PREFIX}${runId}:${itemId}`
}

function metaKey(runId) {
  return `${META_PREFIX}${runId}`
}

function photoKey(runId, itemId) {
  return `${PHOTO_PREFIX}${runId}:${itemId}`
}

function activeSessionKey(profileId) {
  return `${ACTIVE_SESSION_PREFIX}${profileId}`
}

function readJson(key, fallback, storage = localStorage) {
  try {
    const raw = storage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

function writeJson(key, value, storage = localStorage) {
  try {
    storage.setItem(key, JSON.stringify(value))
    return true
  } catch (error) {
    console.warn("checklist storage write failed", key, error)
    return false
  }
}

function writeSessionPhoto(runId, itemId, photoUrl) {
  if (!runId || !itemId || !photoUrl) return false
  try {
    sessionStorage.setItem(photoKey(runId, itemId), photoUrl)
    return true
  } catch (error) {
    console.warn("checklist photo session storage failed", error)
    return false
  }
}

function readSessionPhoto(runId, itemId) {
  if (!runId || !itemId) return ""
  try {
    return sessionStorage.getItem(photoKey(runId, itemId)) || ""
  } catch {
    return ""
  }
}

function clearSessionPhoto(runId, itemId) {
  if (!runId || !itemId) return
  try {
    sessionStorage.removeItem(photoKey(runId, itemId))
  } catch {
    // ignore
  }
}

function preparePayloadForLocalDraft(runId, itemId, payload) {
  const copy = { ...payload }
  if (typeof copy.photo_url === "string" && copy.photo_url.startsWith("data:")) {
    writeSessionPhoto(runId, itemId, copy.photo_url)
    copy.has_local_photo = true
    delete copy.photo_url
  }
  return copy
}

export function hydrateDraftPayload(runId, itemId, payload = {}) {
  const hydrated = { ...payload }
  if (!hydrated.photo_url && hydrated.has_local_photo) {
    const photo = readSessionPhoto(runId, itemId)
    if (photo) hydrated.photo_url = photo
  }
  delete hydrated.has_local_photo
  return hydrated
}

export function persistChecklistItemDraft({ runId, itemId, payload, profileId, meta = {} }) {
  if (!runId || !itemId || !payload) return false
  const now = new Date().toISOString()
  const localPayload = preparePayloadForLocalDraft(runId, itemId, payload)
  const draftSaved = writeJson(draftKey(runId, itemId), {
    runId,
    itemId,
    payload: localPayload,
    profileId: profileId || null,
    savedAt: now,
    synced: false
  })
  const existingMeta = readJson(metaKey(runId), {})
  writeJson(metaKey(runId), {
    ...existingMeta,
    ...meta,
    runId,
    profileId: profileId || existingMeta.profileId || null,
    lastLocalSaveAt: now,
    lastSuccessfulAutosaveAt: existingMeta.lastSuccessfulAutosaveAt || null
  })
  return draftSaved
}

export function markChecklistItemDraftSynced(runId, itemId) {
  if (!runId || !itemId) return
  try {
    localStorage.removeItem(draftKey(runId, itemId))
  } catch {
    // ignore
  }
  clearSessionPhoto(runId, itemId)
}

export function recordChecklistSuccessfulAutosave(runId, profileId) {
  if (!runId) return
  const now = new Date().toISOString()
  const existingMeta = readJson(metaKey(runId), {})
  writeJson(metaKey(runId), {
    ...existingMeta,
    runId,
    profileId: profileId || existingMeta.profileId || null,
    lastSuccessfulAutosaveAt: now,
    lastLocalSaveAt: existingMeta.lastLocalSaveAt || now
  })
}

export function getChecklistRunMeta(runId) {
  return readJson(metaKey(runId), null)
}

export function listChecklistDraftsForRun(runId) {
  if (!runId) return []
  const prefix = `${DRAFT_PREFIX}${runId}:`
  const drafts = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      const draft = readJson(key, null)
      if (draft) drafts.push(draft)
    }
  } catch (error) {
    console.warn("checklist draft listing failed", error)
  }
  return drafts.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)))
}

export function listAllUnsyncedChecklistDrafts(profileId) {
  const drafts = []
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(DRAFT_PREFIX)) continue
      const draft = readJson(key, null)
      if (!draft || draft.synced) continue
      if (profileId && draft.profileId && draft.profileId !== profileId) continue
      drafts.push(draft)
    }
  } catch (error) {
    console.warn("checklist unsynced draft listing failed", error)
  }
  return drafts
}

export function persistActiveChecklistSession(profileId, runId, extra = {}) {
  if (!profileId || !runId) return
  const now = new Date().toISOString()
  const payload = {
    profileId,
    runId,
    openedAt: extra.openedAt || now,
    lastInteractionAt: now,
    templateTitle: extra.templateTitle || "",
    area: extra.area || ""
  }
  writeJson(activeSessionKey(profileId), payload)
  writeJson(LAST_ACTIVE_KEY, payload)
}

export function getLastActiveChecklistSession() {
  return readJson(LAST_ACTIVE_KEY, null)
}

export function touchActiveChecklistSession(profileId, runId) {
  if (!profileId || !runId) return
  const current = readJson(activeSessionKey(profileId), null)
  if (!current || current.runId !== runId) return
  writeJson(activeSessionKey(profileId), {
    ...current,
    lastInteractionAt: new Date().toISOString()
  })
}

export function getActiveChecklistSession(profileId) {
  if (!profileId) return null
  return readJson(activeSessionKey(profileId), null)
}

export function clearActiveChecklistSession(profileId, runId) {
  if (!profileId) return
  const current = readJson(activeSessionKey(profileId), null)
  if (!current) return
  if (runId && current.runId !== runId) return
  try {
    localStorage.removeItem(activeSessionKey(profileId))
  } catch {
    // ignore
  }
}

export function enqueueChecklistRetry(entry) {
  const queue = readJson(RETRY_QUEUE_KEY, [])
  const filtered = queue.filter((item) => !(item.runId === entry.runId && item.itemId === entry.itemId))
  filtered.push({
    ...entry,
    queuedAt: new Date().toISOString(),
    attempts: Number(entry.attempts || 0)
  })
  writeJson(RETRY_QUEUE_KEY, filtered.slice(-200))
}

export function listChecklistRetryQueue(profileId) {
  const queue = readJson(RETRY_QUEUE_KEY, [])
  if (!profileId) return queue
  return queue.filter((item) => !item.profileId || item.profileId === profileId)
}

export function removeChecklistRetry(runId, itemId) {
  const queue = readJson(RETRY_QUEUE_KEY, [])
  writeJson(RETRY_QUEUE_KEY, queue.filter((item) => !(item.runId === runId && item.itemId === itemId)))
}

export function appendLocalChecklistAudit(event) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event
  }
  const current = readJson(LOCAL_AUDIT_KEY, [])
  writeJson(LOCAL_AUDIT_KEY, [entry, ...current].slice(0, LOCAL_AUDIT_LIMIT))
  return entry
}

export function getLocalChecklistAudit(limit = 30) {
  return readJson(LOCAL_AUDIT_KEY, []).slice(0, limit)
}

export function itemPayloadHasAnswer(payload = {}) {
  const hydrated = payload.has_local_photo
    ? { ...payload, photo_url: payload.photo_url || "pending" }
    : payload
  const jsonValue = hydrated.response_json && Object.keys(hydrated.response_json).length > 0
  return Boolean(
    hydrated.checked
    || hydrated.response_text
    || hydrated.response_number != null && hydrated.response_number !== ""
    || hydrated.response_date
    || hydrated.response_time
    || hydrated.photo_url
    || jsonValue
  )
}

export function mergeRunWithLocalDrafts(run, drafts = []) {
  if (!run || !drafts.length) return run
  const draftByItem = new Map(drafts.map((draft) => [draft.itemId, draft]))
  return {
    ...run,
    checklist_run_items: (run.checklist_run_items || []).map((item) => {
      const draft = draftByItem.get(item.id)
      if (!draft?.payload) return item
      const mergedPayload = hydrateDraftPayload(run.id, item.id, draft.payload)
      const serverHasAnswer = itemHasAnswerFromRecord(item)
      const draftHasAnswer = itemPayloadHasAnswer(mergedPayload)
      if (serverHasAnswer && !draftHasAnswer) return item
      if (serverHasAnswer && draftHasAnswer && draft.savedAt && item.completed_at) {
        if (new Date(item.completed_at) >= new Date(draft.savedAt)) return item
      }
      return { ...item, ...mergedPayload }
    })
  }
}

function itemHasAnswerFromRecord(item) {
  const jsonValue = item.response_json && Object.keys(item.response_json).length > 0
  return Boolean(
    item.checked
    || item.response_text
    || item.response_number != null
    || item.response_date
    || item.response_time
    || item.photo_url
    || jsonValue
  )
}

const WIZARD_DRAFT_PREFIX = "checklist-wizard:"

function wizardDraftKey(profileId, templateId = "new") {
  return `${WIZARD_DRAFT_PREFIX}${profileId || "anon"}:${templateId || "new"}`
}

export function persistChecklistWizardDraft(profileId, templateId, payload) {
  if (!payload) return false
  const safePayload = {
    step: Number(payload.step) || 1,
    form: payload.form || {},
    items: Array.isArray(payload.items) ? payload.items : [],
    savedAt: new Date().toISOString()
  }
  return writeJson(wizardDraftKey(profileId, templateId), safePayload, sessionStorage)
}

export function getChecklistWizardDraft(profileId, templateId) {
  return readJson(wizardDraftKey(profileId, templateId), null, sessionStorage)
}

export function clearChecklistWizardDraft(profileId, templateId) {
  try {
    sessionStorage.removeItem(wizardDraftKey(profileId, templateId))
  } catch {
    // ignore
  }
}

export function installChecklistLifecycleGuards() {
  if (typeof window === "undefined" || window.__checklistLifecycleGuardsInstalled) return () => {}
  window.__checklistLifecycleGuardsInstalled = true

  const flush = () => {
    flushAllChecklistPendingSaves().catch((error) => {
      console.warn("checklist lifecycle flush failed", error)
    })
  }
  window.addEventListener("pagehide", flush)
  window.addEventListener("beforeunload", flush)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush()
  })

  return () => {
    window.removeEventListener("pagehide", flush)
    window.removeEventListener("beforeunload", flush)
    window.__checklistLifecycleGuardsInstalled = false
  }
}
