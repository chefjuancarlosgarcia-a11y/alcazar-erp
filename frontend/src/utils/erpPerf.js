/**
 * ERP performance diagnostics — dev only.
 * Enable: VITE_ERP_PERF_DEBUG=true
 * Console filter: [ERP PERF]
 */

export const ERP_PERF_PREFIX = "[ERP PERF]"

const STORAGE_ACTIVE_ROUND_KEY = "erp_perf_active_round"
const storageRoundDataKey = (roundId) => `erp_perf_round_data_${roundId}`

const sessions = new Map()
let activeSessionId = null
let activeRound = null
let requestOrder = 0
let roundAcceptingEvents = true
let erpPerfFetchWrapper = null
let persistTimer = null

export function isErpPerfDebugEnabled() {
  return import.meta.env.VITE_ERP_PERF_DEBUG === "true"
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now()
}

function isoNow() {
  return new Date().toISOString()
}

function getRoute() {
  if (typeof window === "undefined") return ""
  return `${window.location.pathname}${window.location.search || ""}`
}

function serializeSession(session) {
  return {
    sessionId: session.sessionId,
    module: session.module,
    route: session.route,
    render_start: session.render_start,
    render_start_ms: session.render_start_ms,
    render_start_wall_ms: session.render_start_wall_ms,
    requests: session.requests.map((row) => ({
      order: row.order,
      event: row.event,
      route: row.route,
      module: row.module,
      request_name: row.request_name,
      request_id: row.request_id,
      request_start: row.request_start,
      request_end: row.request_end,
      request_ms: row.request_ms,
      payload_bytes: row.payload_bytes,
      row_count: row.row_count,
      cache_hit: row.cache_hit,
      refetch_reason: row.refetch_reason,
      dependency: row.dependency,
      needed_for_first_render: row.needed_for_first_render,
      duplicated_requests: row.duplicated_requests,
      error: row.error,
      startedAt: row.startedAt
    })),
    requestSignatures: Object.fromEntries(session.requestSignatures.entries()),
    component_render_count: session.component_render_count,
    first_contentful_module_render_ms: session.first_contentful_module_render_ms,
    interactive_ms: session.interactive_ms
  }
}

function deserializeSession(raw) {
  const signatures = new Map(Object.entries(raw.requestSignatures || {}))
  return {
    sessionId: raw.sessionId,
    module: raw.module,
    route: raw.route,
    render_start: raw.render_start,
    render_start_ms: raw.render_start_ms,
    render_start_wall_ms: raw.render_start_wall_ms,
    requests: Array.isArray(raw.requests) ? raw.requests.map((row) => ({ ...row })) : [],
    requestSignatures: signatures,
    component_render_count: raw.component_render_count || 0,
    first_contentful_module_render_ms: raw.first_contentful_module_render_ms ?? null,
    interactive_ms: raw.interactive_ms ?? null
  }
}

function sanitizeLogEntry(entry) {
  if (!entry || typeof entry !== "object") return entry
  const safe = { ...entry }
  delete safe.payload
  delete safe.headers
  delete safe.authorization
  delete safe.token
  return safe
}

function listPerfStorageKeys() {
  if (typeof window === "undefined") return []
  const keys = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key && key.startsWith("erp_perf_")) keys.push(key)
  }
  return keys
}

function clearPerfStorage() {
  if (typeof window === "undefined") return
  listPerfStorageKeys().forEach((key) => sessionStorage.removeItem(key))
}

function schedulePersistRoundState() {
  if (!isErpPerfDebugEnabled() || !activeRound || typeof window === "undefined") return
  if (persistTimer) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    persistRoundState()
  }, 0)
}

function persistRoundState() {
  if (!isErpPerfDebugEnabled() || !activeRound || typeof window === "undefined") return

  const serializedSessions = [...sessions.values()].map(serializeSession)
  const events = (window.__ERP_PERF_LOG__ || []).map(sanitizeLogEntry)

  activeRound.active_session_id = activeSessionId
  activeRound.request_order = requestOrder
  activeRound.updated_at = isoNow()

  sessionStorage.setItem(STORAGE_ACTIVE_ROUND_KEY, JSON.stringify(activeRound))
  sessionStorage.setItem(storageRoundDataKey(activeRound.id), JSON.stringify({
    sessions: serializedSessions,
    events,
    request_order: requestOrder
  }))
  window.__ERP_PERF_ROUND__ = activeRound
}

function restoreRoundState() {
  if (!isErpPerfDebugEnabled() || typeof window === "undefined") return false

  const roundRaw = sessionStorage.getItem(STORAGE_ACTIVE_ROUND_KEY)
  if (!roundRaw) return false

  try {
    activeRound = JSON.parse(roundRaw)
  } catch {
    clearPerfStorage()
    return false
  }

  if (!activeRound?.id) return false

  roundAcceptingEvents = activeRound.status !== "completed"

  const dataRaw = sessionStorage.getItem(storageRoundDataKey(activeRound.id))
  if (dataRaw) {
    try {
      const data = JSON.parse(dataRaw)
      sessions.clear()
      for (const rawSession of data.sessions || []) {
        const session = deserializeSession(rawSession)
        sessions.set(session.sessionId, session)
      }
      requestOrder = data.request_order || activeRound.request_order || 0
      window.__ERP_PERF_LOG__ = Array.isArray(data.events) ? data.events.map(sanitizeLogEntry) : []
    } catch {
      sessions.clear()
      requestOrder = activeRound.request_order || 0
      window.__ERP_PERF_LOG__ = []
    }
  } else {
    sessions.clear()
    requestOrder = activeRound.request_order || 0
    window.__ERP_PERF_LOG__ = []
  }

  activeSessionId = resolveActiveSessionId(activeRound.active_session_id)
  window.__ERP_PERF_ROUND__ = activeRound
  return true
}

function buildStableSessionId(module, roundId = activeRound?.id) {
  if (roundId) return `${module}:${roundId}`
  return `${module}:${getRoute()}:${Date.now()}`
}

function findSessionIdForRoundModule(module) {
  if (!activeRound) return null
  const stableId = buildStableSessionId(module, activeRound.id)
  if (sessions.has(stableId)) return stableId

  for (const [sessionId, session] of sessions.entries()) {
    if (session.module === module) return sessionId
  }
  return null
}

export function resolveActiveSessionId(preferredId = activeSessionId) {
  if (preferredId && sessions.has(preferredId)) return preferredId

  if (activeRound) {
    const stableId = buildStableSessionId(activeRound.module, activeRound.id)
    if (sessions.has(stableId)) return stableId

    const matched = findSessionIdForRoundModule(activeRound.module)
    if (matched) return matched
  }

  if (activeSessionId && sessions.has(activeSessionId)) return activeSessionId

  const iterator = sessions.values().next()
  if (!iterator.done) return iterator.value.sessionId

  return null
}

function getActiveRound() {
  return activeRound
}

export function estimateErpPayloadBytes(payload) {
  if (payload == null) return 0
  if (typeof payload === "string") return new TextEncoder().encode(payload).length
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length
  } catch {
    return 0
  }
}

export function estimateRowCount(payload) {
  if (payload == null) return 0
  if (Array.isArray(payload)) return payload.length
  if (Array.isArray(payload?.tasks)) return payload.tasks.length
  if (Array.isArray(payload?.labels)) return payload.labels.length
  if (Array.isArray(payload?.data)) return payload.data.length
  if (typeof payload === "object") return Object.keys(payload).length
  return 0
}

function logEntry(entry) {
  if (!isErpPerfDebugEnabled()) return entry
  if (!roundAcceptingEvents && entry.event !== "measurement_round_finish") return entry

  const safeEntry = sanitizeLogEntry(entry)
  console.info(ERP_PERF_PREFIX, safeEntry)
  if (typeof window !== "undefined") {
    window.__ERP_PERF_LOG__ = window.__ERP_PERF_LOG__ || []
    window.__ERP_PERF_LOG__.push(safeEntry)
    schedulePersistRoundState()
  }
  return safeEntry
}

function countDuplicatedRequests(session) {
  let dupes = 0
  for (const count of session.requestSignatures.values()) {
    if (count > 1) dupes += count - 1
  }
  return dupes
}

function touchSession(session) {
  if (!session) return
  schedulePersistRoundState()
}

export function startErpPerfModule({ module, route = getRoute() } = {}) {
  if (!isErpPerfDebugEnabled()) {
    return { sessionId: null, renderStart: nowMs() }
  }

  const existingId = findSessionIdForRoundModule(module)
  if (existingId && sessions.has(existingId)) {
    const session = sessions.get(existingId)
    session.route = route
    activeSessionId = existingId
    touchSession(session)
    return { sessionId: existingId, renderStart: session.render_start_ms }
  }

  const sessionId = buildStableSessionId(module)
  activeSessionId = sessionId
  const renderStart = nowMs()

  const session = {
    sessionId,
    module,
    route,
    render_start: isoNow(),
    render_start_ms: renderStart,
    render_start_wall_ms: Date.now(),
    requests: [],
    requestSignatures: new Map(),
    component_render_count: 0,
    first_contentful_module_render_ms: null,
    interactive_ms: null
  }

  sessions.set(sessionId, session)

  logEntry({
    event: "module_mount",
    route,
    module,
    render_start: session.render_start,
    request_start: session.render_start,
    round_id: activeRound?.id || null
  })

  return { sessionId, renderStart }
}

export function markErpPerfRender(sessionId, { reason = "render" } = {}) {
  if (!isErpPerfDebugEnabled() || !sessionId) return 0

  const session = sessions.get(sessionId)
  if (!session) return 0

  session.component_render_count += 1
  const elapsed = Math.round(nowMs() - session.render_start_ms)

  if (session.first_contentful_module_render_ms == null) {
    session.first_contentful_module_render_ms = elapsed
    logEntry({
      event: "first_contentful_module_render",
      route: session.route,
      module: session.module,
      first_contentful_module_render_ms: elapsed,
      component_render_count: session.component_render_count,
      reason,
      round_id: activeRound?.id || null
    })
  } else {
    touchSession(session)
  }

  return elapsed
}

export function markErpPerfInteractive(sessionId) {
  if (!isErpPerfDebugEnabled() || !sessionId) return

  const session = sessions.get(sessionId)
  if (!session || session.interactive_ms != null) return

  session.interactive_ms = Math.round(nowMs() - session.render_start_ms)
  logEntry({
    event: "interactive",
    route: session.route,
    module: session.module,
    interactive_ms: session.interactive_ms,
    requests_count: session.requests.length,
    duplicated_requests: countDuplicatedRequests(session),
    round_id: activeRound?.id || null
  })
}

function ensureSessionForModule(module) {
  if (!isErpPerfDebugEnabled() || !activeRound || !roundAcceptingEvents) return null

  const targetModule = module || activeRound.module
  const existingId = findSessionIdForRoundModule(targetModule)
  if (existingId) {
    activeSessionId = existingId
    return existingId
  }

  const sessionId = buildStableSessionId(targetModule, activeRound.id)
  const session = {
    sessionId,
    module: targetModule,
    route: getRoute(),
    render_start: isoNow(),
    render_start_ms: nowMs(),
    render_start_wall_ms: Date.now(),
    requests: [],
    requestSignatures: new Map(),
    component_render_count: 0,
    first_contentful_module_render_ms: null,
    interactive_ms: null
  }

  sessions.set(sessionId, session)
  activeSessionId = sessionId
  schedulePersistRoundState()
  return sessionId
}

export function trackErpPerfRequestStart({
  module,
  requestName,
  route = getRoute(),
  refetchReason = "initial",
  cacheHit = false,
  dependency = null,
  neededForFirstRender = null,
  sessionId = null
} = {}) {
  if (!isErpPerfDebugEnabled() || !roundAcceptingEvents) {
    return { requestId: null, startedAt: nowMs() }
  }

  ensureSessionForModule(module)
  const resolvedSessionId = resolveActiveSessionId(sessionId)
  const requestId = `${requestName}:${++requestOrder}`
  const startedAt = nowMs()
  const signature = `${module}::${requestName}`

  const session = resolvedSessionId ? sessions.get(resolvedSessionId) : null
  if (session) {
    const prev = session.requestSignatures.get(signature) || 0
    session.requestSignatures.set(signature, prev + 1)
    activeSessionId = resolvedSessionId
  }

  const entry = {
    event: "request_start",
    route,
    module,
    request_name: requestName,
    request_start: isoNow(),
    request_id: requestId,
    order: requestOrder,
    refetch_reason: refetchReason,
    cache_hit: cacheHit,
    dependency,
    needed_for_first_render: neededForFirstRender,
    duplicated_requests: session ? Math.max(0, (session.requestSignatures.get(signature) || 1) - 1) : 0,
    round_id: activeRound?.id || null
  }

  if (session) session.requests.push({ ...entry, startedAt })

  logEntry(entry)
  return { requestId, startedAt, sessionId: resolvedSessionId }
}

export function trackErpPerfRequestEnd({
  requestId,
  startedAt,
  module,
  requestName,
  route = getRoute(),
  payload = null,
  rowCount = null,
  cacheHit = false,
  refetchReason = null,
  error = null,
  sessionId = null
} = {}) {
  if (!isErpPerfDebugEnabled() || !requestId) return null

  const resolvedSessionId = resolveActiveSessionId(sessionId)
  const requestEnd = isoNow()
  const requestMs = Math.max(0, Math.round(nowMs() - (startedAt || nowMs())))
  const payloadBytes = estimateErpPayloadBytes(payload)
  const rows = rowCount ?? estimateRowCount(payload)

  const entry = {
    event: "request_end",
    route,
    module,
    request_name: requestName,
    request_id: requestId,
    request_end: requestEnd,
    request_ms: requestMs,
    payload_bytes: payloadBytes,
    row_count: rows,
    cache_hit: cacheHit,
    refetch_reason: refetchReason,
    error: error ? String(error).slice(0, 200) : null,
    round_id: activeRound?.id || null
  }

  const session = resolvedSessionId ? sessions.get(resolvedSessionId) : null
  if (session) {
    const pending = session.requests.find((row) => row.request_id === requestId)
    if (pending) Object.assign(pending, entry)
    activeSessionId = resolvedSessionId
    touchSession(session)
  }

  logEntry(entry)
  return entry
}

export async function withErpPerfRequest(meta, loader) {
  const { requestId, startedAt, sessionId } = trackErpPerfRequestStart(meta)
  try {
    const result = await loader()
    trackErpPerfRequestEnd({
      requestId,
      startedAt,
      sessionId,
      module: meta.module,
      requestName: meta.requestName,
      route: meta.route,
      payload: result?.data ?? result,
      rowCount: meta.rowCount,
      cacheHit: meta.cacheHit,
      refetchReason: meta.refetchReason
    })
    return result
  } catch (error) {
    trackErpPerfRequestEnd({
      requestId,
      startedAt,
      sessionId,
      module: meta.module,
      requestName: meta.requestName,
      route: meta.route,
      error: error?.message || error,
      refetchReason: meta.refetchReason
    })
    throw error
  }
}

export function logErpPerfCacheEvent({ key, eventType, module = "cache", ttlMs }) {
  if (!isErpPerfDebugEnabled()) return
  logEntry({
    event: "cache",
    route: getRoute(),
    module,
    request_name: key,
    cache_hit: eventType === "cache_hit",
    refetch_reason: eventType,
    request_ms: 0,
    payload_bytes: 0,
    row_count: 0,
    ttl_ms: ttlMs,
    round_id: activeRound?.id || null
  })
}

export function summarizeErpPerfSession(sessionId = resolveActiveSessionId()) {
  if (!isErpPerfDebugEnabled() || !sessionId) return null

  const session = sessions.get(sessionId)
  if (!session) return null

  const summary = {
    event: "module_summary",
    route: session.route,
    module: session.module,
    render_start: session.render_start,
    first_contentful_module_render_ms: session.first_contentful_module_render_ms,
    interactive_ms: session.interactive_ms,
    requests_count: session.requests.length,
    duplicated_requests: countDuplicatedRequests(session),
    component_render_count: session.component_render_count,
    round_id: activeRound?.id || null,
    requests: session.requests.map((row) => ({
      order: row.order,
      request_name: row.request_name,
      request_ms: row.request_ms,
      payload_bytes: row.payload_bytes,
      row_count: row.row_count,
      cache_hit: row.cache_hit,
      refetch_reason: row.refetch_reason,
      dependency: row.dependency,
      needed_for_first_render: row.needed_for_first_render
    }))
  }

  logEntry(summary)
  return summary
}

export function getActiveErpPerfSession() {
  const sessionId = resolveActiveSessionId()
  if (!sessionId) return null
  return sessions.get(sessionId) || null
}

export function createErpPerfFetchLogger(baseFetch = fetch) {
  if (!isErpPerfDebugEnabled()) return undefined
  if (erpPerfFetchWrapper) return erpPerfFetchWrapper

  erpPerfFetchWrapper = async (input, init) => {
    const requestUrl = typeof input === "string" ? input : input?.url || ""
    const shortUrl = requestUrl.replace(/^https?:\/\/[^/]+/, "")
    const isRpc = shortUrl.includes("/rest/v1/rpc/")
    const rpcName = isRpc
      ? decodeURIComponent(shortUrl.split("/rpc/")[1]?.split("?")[0] || "rpc")
      : shortUrl.split("?")[0]
    const activeSession = getActiveErpPerfSession()
    const module = activeRound?.module || activeSession?.module || "supabase"

    const { requestId, startedAt, sessionId } = trackErpPerfRequestStart({
      module,
      requestName: isRpc ? `rpc:${rpcName}` : `rest:${shortUrl.split("?")[0]}`,
      refetchReason: "network",
      neededForFirstRender: null
    })

    const response = await baseFetch(input, init)
    let payload = null
    try {
      const clone = response.clone()
      const text = await clone.text()
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    trackErpPerfRequestEnd({
      requestId,
      startedAt,
      sessionId,
      module,
      requestName: isRpc ? `rpc:${rpcName}` : `rest:${shortUrl.split("?")[0]}`,
      payload,
      rowCount: estimateRowCount(payload)
    })

    return response
  }

  return erpPerfFetchWrapper
}

export function clearErpPerfLog() {
  sessions.clear()
  activeSessionId = null
  activeRound = null
  requestOrder = 0
  roundAcceptingEvents = true

  if (persistTimer && typeof window !== "undefined") {
    window.clearTimeout(persistTimer)
    persistTimer = null
  }

  if (typeof window !== "undefined") {
    window.__ERP_PERF_LOG__ = []
    window.__ERP_PERF_ROUND__ = null
    clearPerfStorage()
  }
}

export function startMeasurementRound({ id, module, scenario = "cold", notes = "" } = {}) {
  clearErpPerfLog()

  const round = {
    id: id || `${module}-${scenario}-${Date.now()}`,
    module,
    scenario,
    notes,
    started_at: isoNow(),
    started_perf_ms: nowMs(),
    started_wall_ms: Date.now(),
    status: "active",
    route: getRoute(),
    active_session_id: null,
    request_order: 0
  }

  activeRound = round
  roundAcceptingEvents = true
  requestOrder = 0

  if (typeof window !== "undefined") {
    window.__ERP_PERF_ROUND__ = round
    persistRoundState()
  }

  logEntry({
    event: "measurement_round_start",
    module,
    route: round.route,
    refetch_reason: scenario,
    notes,
    round_id: round.id
  })

  return round
}

export function finishMeasurementRound() {
  if (!activeRound) return null

  activeRound.status = "completed"
  activeRound.finished_at = isoNow()
  roundAcceptingEvents = false

  logEntry({
    event: "measurement_round_finish",
    module: activeRound.module,
    route: getRoute(),
    round_id: activeRound.id,
    refetch_reason: activeRound.scenario
  })

  persistRoundState()
  return { ...activeRound }
}

export function formatWaterfallMarkdown(sessionId = resolveActiveSessionId()) {
  const session = sessionId ? sessions.get(sessionId) : null
  if (!session) {
    return "| Orden | Request | request_ms | payload_bytes | row_count | cache_hit | refetch_reason |\n|---:|---|---:|---:|---:|:---:|:---|\n"
  }

  const lines = [
    activeRound ? `Round: ${activeRound.id} (${activeRound.status})` : "Round: —",
    `### ${session.module} — ${session.route}`,
    "",
    "| Orden | Request | request_ms | payload_bytes | row_count | cache_hit | refetch_reason |",
    "|---:|---|---:|---:|---:|:---:|:---|"
  ]

  for (const row of session.requests) {
    if (!row.request_ms && row.event === "request_start") continue
    lines.push(
      `| ${row.order ?? ""} | ${row.request_name || ""} | ${row.request_ms ?? ""} | ${row.payload_bytes ?? ""} | ${row.row_count ?? ""} | ${row.cache_hit ? "yes" : "no"} | ${row.refetch_reason || ""} |`
    )
  }

  lines.push(
    "",
    `- first_contentful_module_render_ms: ${session.first_contentful_module_render_ms ?? "—"}`,
    `- interactive_ms: ${session.interactive_ms ?? "—"}`,
    `- requests_count: ${session.requests.length}`,
    `- duplicated_requests: ${countDuplicatedRequests(session)}`,
    `- component_render_count: ${session.component_render_count}`
  )

  return lines.join("\n")
}

export function printWaterfallMarkdown(sessionId = resolveActiveSessionId()) {
  const markdown = formatWaterfallMarkdown(sessionId)
  if (isErpPerfDebugEnabled()) {
    console.info(`${ERP_PERF_PREFIX} waterfall_markdown\n${markdown}`)
  }
  return markdown
}

export async function copyWaterfallMarkdown(sessionId = resolveActiveSessionId()) {
  const markdown = formatWaterfallMarkdown(sessionId)
  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(markdown)
  }
  return markdown
}

function measureImageLoadMs(session) {
  if (typeof performance === "undefined" || !session) return { image_ms: 0, image_count: 0 }
  const sincePerfMs = session.render_start_ms || 0
  const entries = performance.getEntriesByType("resource").filter((entry) => {
    if (entry.startTime < sincePerfMs) return false
    const name = String(entry.name || "")
    return (
      entry.initiatorType === "img"
      || /\/storage\/v1\/object\//i.test(name)
      || /\.(webp|jpe?g|png|gif)(\?|$)/i.test(name)
    )
  })
  return {
    image_ms: Math.round(entries.reduce((sum, entry) => sum + (entry.duration || 0), 0)),
    image_count: entries.length
  }
}

function analyzeQuantitativeSession(session) {
  if (!session) return null

  const completed = session.requests.filter((row) => typeof row.request_ms === "number")
  const rpcRows = completed.filter((row) => String(row.request_name || "").startsWith("rpc:"))
  const restRows = completed.filter((row) => !String(row.request_name || "").startsWith("rpc:"))

  const rpcSumMs = rpcRows.reduce((sum, row) => sum + row.request_ms, 0)
  const restSumMs = restRows.reduce((sum, row) => sum + row.request_ms, 0)

  let dupWaste = 0
  const timingsByName = new Map()
  for (const row of completed) {
    const key = row.request_name || "unknown"
    if (!timingsByName.has(key)) timingsByName.set(key, [])
    timingsByName.get(key).push(row.request_ms)
  }
  for (const times of timingsByName.values()) {
    if (times.length <= 1) continue
    const avg = times.reduce((sum, value) => sum + value, 0) / times.length
    dupWaste += avg * (times.length - 1)
  }

  const starts = completed.map((row) => row.startedAt).filter(Number.isFinite)
  const ends = completed.map((row) => row.startedAt + row.request_ms).filter(Number.isFinite)
  const networkWallMs = starts.length && ends.length
    ? Math.round(Math.max(...ends) - Math.min(...starts))
    : 0

  const totalMs = session.interactive_ms
    ?? session.first_contentful_module_render_ms
    ?? networkWallMs

  const boardRpcRows = completed.filter((row) => row.request_name === "rpc:get_operational_tasks_board")
  const boardRpcMs = boardRpcRows.reduce((sum, row) => sum + row.request_ms, 0)
  const boardRpcMaxMs = boardRpcRows.length
    ? Math.max(...boardRpcRows.map((row) => row.request_ms))
    : 0
  const boardRpcCalls = boardRpcRows.length
  const boardRpcPayloadBytes = boardRpcRows.reduce((sum, row) => sum + (row.payload_bytes || 0), 0)
  const boardRpcRowCount = boardRpcRows.length
    ? Math.max(...boardRpcRows.map((row) => row.row_count || 0))
    : 0

  const fcp = session.first_contentful_module_render_ms ?? 0
  const renderMs = Math.max(0, Math.round((session.interactive_ms ?? fcp) - networkWallMs))
  const skeletonMs = 0
  const { image_ms: imageMs, image_count: imageCount } = measureImageLoadMs(session)

  const supabaseMs = rpcSumMs
  const dominantRpcMs = rpcRows.length
    ? Math.max(...rpcRows.map((row) => row.request_ms))
    : 0

  const pct = (value, base = totalMs) => (base > 0 ? Math.round((value / base) * 1000) / 10 : 0)

  return {
    round_id: activeRound?.id || null,
    round_status: activeRound?.status || null,
    module: session.module,
    route: session.route,
    total_ms: totalMs,
    supabase_rpc_sum_ms: supabaseMs,
    supabase_rpc_wall_ms: networkWallMs,
    supabase_rpc_dominant_ms: dominantRpcMs,
    rest_sum_ms: restSumMs,
    duplicate_waste_ms: Math.round(dupWaste),
    render_react_ms: renderMs,
    skeleton_ms: skeletonMs,
    first_contentful_ms: fcp,
    interactive_ms: session.interactive_ms ?? null,
    images_ms: imageMs,
    images_count: imageCount,
    requests_count: completed.length,
    duplicated_requests: countDuplicatedRequests(session),
    component_render_count: session.component_render_count,
    board_rpc: {
      calls: boardRpcCalls,
      sum_ms: boardRpcMs,
      max_ms: boardRpcMaxMs,
      payload_bytes: boardRpcPayloadBytes,
      row_count: boardRpcRowCount
    },
    shares: {
      supabase_rpc_pct: pct(supabaseMs),
      duplicate_pct: pct(dupWaste),
      render_pct: pct(renderMs),
      images_pct: pct(imageMs),
      unaccounted_pct: pct(Math.max(0, totalMs - supabaseMs - dupWaste - renderMs - imageMs))
    },
    note: "supabase_rpc_sum_ms suma RPCs en paralelo (sobreestima). supabase_rpc_wall_ms es el reloj de pared de red+DB."
  }
}

export function buildQuantitativeBreakdown(sessionId = resolveActiveSessionId()) {
  const resolvedSessionId = resolveActiveSessionId(sessionId)
  const session = resolvedSessionId ? sessions.get(resolvedSessionId) : null
  return analyzeQuantitativeSession(session)
}

export function formatQuantitativeFunnel(sessionId = resolveActiveSessionId()) {
  const data = buildQuantitativeBreakdown(sessionId)
  if (!data) return "Sin sesión activa."

  const lines = [
    `## Embudo cuantitativo — ${data.module}`,
    activeRound ? `Round: ${activeRound.id} (${activeRound.status})` : "",
    "",
    "```",
    `Tiempo total (interactivo)     ${data.total_ms} ms`,
    "↓",
    `RPC Supabase (suma)            ${data.supabase_rpc_sum_ms} ms  (${data.shares.supabase_rpc_pct}%)`,
    `RPC reloj de pared             ${data.supabase_rpc_wall_ms} ms`,
    `RPC más lento (crítico)        ${data.supabase_rpc_dominant_ms} ms`,
    "↓",
    `REST / caché                   ${data.rest_sum_ms} ms`,
    "↓",
    `Consultas duplicadas (estim.)  ${data.duplicate_waste_ms} ms  (${data.shares.duplicate_pct}%)`,
    "↓",
    `Render React (estim.)          ${data.render_react_ms} ms  (${data.shares.render_pct}%)`,
    "↓",
    `Skeleton (delay UX)            ${data.skeleton_ms} ms`,
    "↓",
    `Primer contenido visible       ${data.first_contentful_ms} ms`,
    "↓",
    `Tiempo interactivo             ${data.interactive_ms ?? "—"} ms`,
    "↓",
    `Imágenes (${data.images_count})               ${data.images_ms} ms  (${data.shares.images_pct}%)`,
    "```",
    "",
    `requests: ${data.requests_count} | duplicated_requests: ${data.duplicated_requests} | renders: ${data.component_render_count}`,
    "",
    "### Board RPC",
    "```",
    `get_operational_tasks_board calls     ${data.board_rpc.calls}`,
    `get_operational_tasks_board sum_ms    ${data.board_rpc.sum_ms} ms`,
    `get_operational_tasks_board max_ms    ${data.board_rpc.max_ms} ms`,
    `get_operational_tasks_board rows      ${data.board_rpc.row_count}`,
    `get_operational_tasks_board bytes     ${data.board_rpc.payload_bytes}`,
    "```",
    "",
    data.note
  ].filter(Boolean)

  return lines.join("\n")
}

export function getBoardRpcMetrics(sessionId = resolveActiveSessionId()) {
  const data = buildQuantitativeBreakdown(sessionId)
  if (!data) return null

  const resolvedSessionId = resolveActiveSessionId(sessionId)
  const session = resolvedSessionId ? sessions.get(resolvedSessionId) : null
  const entries = (session?.requests || []).filter(
    (row) => row.request_name === "rpc:get_operational_tasks_board" && typeof row.request_ms === "number"
  )

  return {
    round_id: activeRound?.id || null,
    round_status: activeRound?.status || null,
    request_name: "rpc:get_operational_tasks_board",
    calls: data.board_rpc.calls,
    sum_request_ms: data.board_rpc.sum_ms,
    max_request_ms: data.board_rpc.max_ms,
    payload_bytes: data.board_rpc.payload_bytes,
    row_count: data.board_rpc.row_count,
    first_contentful_ms: data.first_contentful_ms,
    interactive_ms: data.interactive_ms,
    render_react_ms: data.render_react_ms,
    entries
  }
}

export function printBoardRpcMetrics(sessionId = resolveActiveSessionId()) {
  const metrics = getBoardRpcMetrics(sessionId)
  if (!metrics) return "Sin sesión activa."
  if (isErpPerfDebugEnabled()) {
    console.info(`${ERP_PERF_PREFIX} board_rpc`, metrics)
  }
  return metrics
}

export function printQuantitativeFunnel(sessionId = resolveActiveSessionId()) {
  const text = formatQuantitativeFunnel(sessionId)
  if (isErpPerfDebugEnabled()) {
    console.info(`${ERP_PERF_PREFIX} quantitative_funnel\n${text}`)
  }
  return text
}

export function exportErpPerfDiagnostics() {
  return {
    exported_at: isoNow(),
    enabled: isErpPerfDebugEnabled(),
    round: activeRound,
    active_session_id: resolveActiveSessionId(),
    sessions: [...sessions.values()].map((session) => ({
      sessionId: session.sessionId,
      module: session.module,
      route: session.route,
      first_contentful_module_render_ms: session.first_contentful_module_render_ms,
      interactive_ms: session.interactive_ms,
      requests_count: session.requests.length,
      duplicated_requests: countDuplicatedRequests(session),
      component_render_count: session.component_render_count,
      requests: session.requests,
      quantitative: analyzeQuantitativeSession(session)
    })),
    log: typeof window !== "undefined" ? window.__ERP_PERF_LOG__ || [] : []
  }
}

function installErpPerfGlobals() {
  if (typeof window === "undefined") return

  restoreRoundState()

  window.__ERP_PERF__ = {
    export: exportErpPerfDiagnostics,
    summarize: summarizeErpPerfSession,
    clear: clearErpPerfLog,
    startRound: startMeasurementRound,
    finishRound: finishMeasurementRound,
    getRound: getActiveRound,
    waterfall: printWaterfallMarkdown,
    copyWaterfall: copyWaterfallMarkdown,
    breakdown: buildQuantitativeBreakdown,
    boardRpc: printBoardRpcMetrics,
    funnel: printQuantitativeFunnel,
    enabled: isErpPerfDebugEnabled()
  }
}

installErpPerfGlobals()
