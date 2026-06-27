import {
  clearPerformanceEvents,
  exportPerformanceDiagnostics,
  getPerformanceEvents,
  subscribePerformanceEvents
} from "../utils/performanceLogger"

const ERROR_WINDOW_MS = 60 * 60 * 1000

function parseTimestamp(value) {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

function filterByRange(events, range) {
  if (range === "all") return events
  const windowMs = range === "1h" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000
  const cutoff = Date.now() - windowMs
  return events.filter((event) => parseTimestamp(event.timestamp) >= cutoff)
}

function countByType(events, eventType) {
  return events.filter((event) => event.event_type === eventType).length
}

function averageModuleLoad(events) {
  const loads = events.filter(
    (event) => event.event_type === "module_load" && typeof event.duration_ms === "number"
  )
  if (!loads.length) return 0
  const total = loads.reduce((sum, event) => sum + event.duration_ms, 0)
  return Math.round(total / loads.length)
}

function slowestModule(events) {
  const byModule = new Map()
  events
    .filter((event) => event.event_type === "module_load" && typeof event.duration_ms === "number")
    .forEach((event) => {
      const current = byModule.get(event.module) || { total: 0, count: 0, max: 0 }
      current.total += event.duration_ms
      current.count += 1
      current.max = Math.max(current.max, event.duration_ms)
      byModule.set(event.module, current)
    })

  let slowest = null
  byModule.forEach((stats, module) => {
    const avg = stats.total / stats.count
    if (!slowest || avg > slowest.avg) {
      slowest = { module, avg: Math.round(avg), max: stats.max }
    }
  })
  return slowest
}

function cacheHitRate(events) {
  const hits = countByType(events, "cache_hit")
  const misses = countByType(events, "cache_miss")
  const total = hits + misses
  if (!total) return null
  return Math.round((hits / total) * 100)
}

function recentErrorCount(events) {
  const cutoff = Date.now() - ERROR_WINDOW_MS
  return events.filter((event) => {
    if (!["frontend_error", "api_error"].includes(event.event_type)) return false
    return parseTimestamp(event.timestamp) >= cutoff
  }).length
}

function healthStatus(kind, events) {
  switch (kind) {
    case "frontend": {
      const errors = events.filter((event) => event.event_type === "frontend_error").length
      if (!events.length) return "unknown"
      if (errors === 0) return "good"
      if (errors <= 3) return "warn"
      return "bad"
    }
    case "cache": {
      const rate = cacheHitRate(events)
      if (rate == null) return "unknown"
      if (rate >= 50) return "good"
      if (rate >= 20) return "warn"
      return "bad"
    }
    case "guards": {
      const skips = countByType(events, "guard_skipped")
      if (!events.length) return "unknown"
      if (skips === 0) return "good"
      if (skips <= 5) return "warn"
      return "bad"
    }
    case "reports": {
      const success = countByType(events, "export_success")
      const errors = countByType(events, "export_error")
      if (!success && !errors) return "unknown"
      if (!errors) return "good"
      if (errors <= success) return "warn"
      return "bad"
    }
    case "errors": {
      const recent = recentErrorCount(events)
      if (!events.length) return "unknown"
      if (recent === 0) return "good"
      if (recent <= 3) return "warn"
      return "bad"
    }
    default:
      return "unknown"
  }
}

export function getFilteredEvents(filters = {}) {
  const { module = "all", event_type = "all", severity = "all", range = "all" } = filters
  let events = filterByRange(getPerformanceEvents(), range)

  if (module !== "all") {
    events = events.filter((event) => event.module === module)
  }
  if (event_type !== "all") {
    events = events.filter((event) => event.event_type === event_type)
  }
  if (severity !== "all") {
    events = events.filter((event) => event.severity === severity)
  }

  return events.slice().reverse()
}

export function getOperationsCenterSnapshot(filters = {}) {
  const allEvents = getPerformanceEvents()
  const filteredEvents = getFilteredEvents(filters)
  const rangeEvents = filterByRange(allEvents, filters.range || "all")
  const exportSuccess = countByType(rangeEvents, "export_success")
  const exportErrors = countByType(rangeEvents, "export_error")
  const lastEvent = allEvents[allEvents.length - 1] || null
  const slowest = slowestModule(rangeEvents)

  return {
    kpis: {
      totalEvents: rangeEvents.length,
      cacheHitRate: cacheHitRate(rangeEvents),
      cacheMisses: countByType(rangeEvents, "cache_miss"),
      invalidations: countByType(rangeEvents, "cache_invalidate"),
      guardSkips: countByType(rangeEvents, "guard_skipped"),
      exportSuccess,
      exportErrors,
      recentErrors: recentErrorCount(rangeEvents),
      avgModuleLoadMs: averageModuleLoad(rangeEvents),
      slowestModule: slowest?.module || null,
      slowestModuleAvgMs: slowest?.avg || 0,
      lastEventAt: lastEvent?.timestamp || null
    },
    health: {
      frontend: healthStatus("frontend", rangeEvents),
      cache: healthStatus("cache", rangeEvents),
      guards: healthStatus("guards", rangeEvents),
      reports: healthStatus("reports", rangeEvents),
      errors: healthStatus("errors", rangeEvents)
    },
    events: filteredEvents,
    modules: [...new Set(allEvents.map((event) => event.module))].sort(),
    eventTypes: [...new Set(allEvents.map((event) => event.event_type))].sort()
  }
}

export function clearLocalOperationsLogs() {
  clearPerformanceEvents()
}

export function exportOperationsDiagnosticsJSON() {
  return exportPerformanceDiagnostics()
}

export function subscribeOperationsCenter(callback) {
  return subscribePerformanceEvents(() => {
    try {
      callback()
    } catch {
      // Ignore subscriber failures.
    }
  })
}
