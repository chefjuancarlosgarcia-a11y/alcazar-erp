const STORAGE_KEY = "alcazar:operations-center:v1"
const MAX_MEMORY_EVENTS = 800
const MAX_STORAGE_EVENTS = 400
const DEBOUNCE_MS = 1000
const MAX_STRING_LENGTH = 200

const METADATA_ALLOWLIST = new Set([
  "cache_key_prefix",
  "cache_key",
  "ttl_ms",
  "format",
  "tab",
  "route",
  "http_status",
  "error_code",
  "source",
  "invalidate_origin",
  "keys_removed",
  "miss_reason",
  "channel",
  "table",
  "operation",
  "record_id",
  "subscription_instance_id"
])

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const PHONE_GT_RE = /(?:\+502[\s-]?)?(?:[2-9]\d{3}[\s-]?\d{4}|\d{8})/g
const BEARER_RE = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const SENSITIVE_RE = /password|authorization|cookie|session|token|jwt|bearer|vite_/i

let events = []
const subscribers = new Set()
let persistTimer = null

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function looksSensitive(value) {
  return SENSITIVE_RE.test(value)
}

export function sanitizePerformanceString(value) {
  if (value == null) return ""
  let text = String(value)
  if (looksSensitive(text) || EMAIL_RE.test(text) || BEARER_RE.test(text) || JWT_RE.test(text)) {
    return "Error sanitizado"
  }
  text = text.replace(BEARER_RE, "[token]")
  text = text.replace(JWT_RE, "[jwt]")
  text = text.replace(EMAIL_RE, "[email]")
  text = text.replace(PHONE_GT_RE, "[phone]")
  text = text.replace(UUID_RE, "[id]")
  text = text.replace(/\?[^\s#]+/g, "")
  if (looksSensitive(text)) return "Error sanitizado"
  return text.slice(0, MAX_STRING_LENGTH)
}

function sanitizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {}
  const sanitized = {}
  for (const [key, value] of Object.entries(metadata)) {
    if (!METADATA_ALLOWLIST.has(key)) continue
    if (typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value
      continue
    }
    if (typeof value === "string") {
      sanitized[key] = sanitizePerformanceString(value)
    }
  }
  return sanitized
}

function notifySubscribers() {
  const snapshot = [...events]
  subscribers.forEach((callback) => {
    try {
      callback(snapshot)
    } catch {
      // Never break subscribers.
    }
  })
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.events)) {
      events = parsed.events.slice(-MAX_MEMORY_EVENTS)
    }
  } catch {
    events = []
  }
}

function schedulePersist() {
  try {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: 1,
            events: events.slice(-MAX_STORAGE_EVENTS)
          })
        )
      } catch {
        // Ignore storage quota or privacy mode errors.
      } finally {
        persistTimer = null
      }
    }, DEBOUNCE_MS)
  } catch {
    // Ignore timer failures.
  }
}

export function logPerformanceEvent(partial = {}) {
  try {
    const event = {
      id: partial.id || generateId(),
      timestamp: partial.timestamp || new Date().toISOString(),
      module: sanitizePerformanceString(partial.module || "unknown") || "unknown",
      action: sanitizePerformanceString(partial.action || partial.event_type || "event") || "event",
      event_type: partial.event_type || "info",
      status: partial.status || "info",
      severity: partial.severity || "info",
      duration_ms: typeof partial.duration_ms === "number" ? Math.round(partial.duration_ms) : null,
      error_message: partial.error_message ? sanitizePerformanceString(partial.error_message) : "",
      message: partial.message ? sanitizePerformanceString(partial.message) : "",
      metadata: sanitizeMetadata(partial.metadata)
    }

    events.push(event)
    if (events.length > MAX_MEMORY_EVENTS) {
      events = events.slice(-MAX_MEMORY_EVENTS)
    }

    schedulePersist()
    notifySubscribers()
  } catch {
    // Never break the main operation.
  }
}

export function getPerformanceEvents() {
  try {
    return [...events]
  } catch {
    return []
  }
}

export function clearPerformanceEvents() {
  try {
    events = []
    localStorage.removeItem(STORAGE_KEY)
    notifySubscribers()
  } catch {
    // Ignore clear failures.
  }
}

export function exportPerformanceDiagnostics() {
  try {
    return {
      exported_at: new Date().toISOString(),
      version: "v1",
      coverage: "partial",
      note: "Local browser diagnostics only. No centralized logging in V1.",
      event_count: events.length,
      events: events.map((event) => ({ ...event }))
    }
  } catch {
    return {
      exported_at: new Date().toISOString(),
      version: "v1",
      coverage: "partial",
      event_count: 0,
      events: []
    }
  }
}

export function subscribePerformanceEvents(callback) {
  if (typeof callback !== "function") return () => {}
  subscribers.add(callback)
  try {
    callback([...events])
  } catch {
    // Ignore initial callback failures.
  }
  return () => subscribers.delete(callback)
}

export function cacheKeyPrefix(key) {
  try {
    if (!key || typeof key !== "string") return "unknown"
    const colonIndex = key.indexOf(":")
    if (colonIndex > 0) return key.slice(0, colonIndex + 1)
    if (UUID_RE.test(key)) return "key:"
    return key.slice(0, 32)
  } catch {
    return "unknown"
  }
}

loadFromStorage()
