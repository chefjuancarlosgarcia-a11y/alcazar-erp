import { CACHE_TTL } from "./cacheConfig"
import { cacheKeyPrefix, logPerformanceEvent } from "../utils/performanceLogger"

const entries = new Map()

function logCacheEvent(eventType, key, ttlMs, extra = {}) {
  logPerformanceEvent({
    module: "cache",
    action: eventType,
    event_type: eventType,
    status: "info",
    severity: "info",
    metadata: {
      cache_key_prefix: cacheKeyPrefix(key),
      ttl_ms: typeof ttlMs === "number" ? ttlMs : undefined,
      ...extra
    }
  })
}

/**
 * In-memory TTL cache with in-flight request deduplication.
 * @param {string} key
 * @param {() => Promise<unknown>|unknown} loader
 * @param {number} [ttlMs]
 */
export function cachedQuery(key, loader, ttlMs = CACHE_TTL.CATALOG) {
  const current = entries.get(key)
  if (current?.value !== undefined && current.expiresAt > Date.now()) {
    logCacheEvent("cache_hit", key, ttlMs)
    return Promise.resolve(current.value)
  }
  if (current?.promise) {
    logCacheEvent("cache_inflight", key, ttlMs)
    return current.promise
  }

  logCacheEvent("cache_miss", key, ttlMs)
  const promise = Promise.resolve()
    .then(() => loader())
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    })
    .catch((error) => {
      entries.delete(key)
      logPerformanceEvent({
        module: "cache",
        action: "loader_failed",
        event_type: "api_error",
        status: "error",
        severity: "error",
        error_message: error?.message || "Cache loader failed",
        message: "Cache loader failed",
        metadata: {
          cache_key_prefix: cacheKeyPrefix(key),
          ttl_ms: ttlMs,
          source: "queryCache"
        }
      })
      throw error
    })

  entries.set(key, { promise, expiresAt: 0 })
  return promise
}

/** Remove all entries whose key starts with `prefix` (empty prefix clears all). */
export function invalidateQueryCache(prefix = "") {
  for (const key of entries.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      entries.delete(key)
      logCacheEvent("cache_invalidate", key, undefined, { source: "prefix" })
    }
  }
}

/** Remove a single cache entry by exact key. */
export function invalidateQueryCacheExact(key) {
  entries.delete(key)
  logCacheEvent("cache_invalidate", key, undefined, { source: "exact" })
}
