import { CACHE_TTL } from "./cacheConfig.js"
import { cacheKeyPrefix, logPerformanceEvent } from "../utils/performanceLogger.js"
import { isErpPerfDebugEnabled, logErpPerfCacheEvent } from "../utils/erpPerf.js"

const entries = new Map()
const recentlyInvalidatedKeys = new Set()

let currentScope = null
let cacheGeneration = 0

function scopeKeyFromScope(scope) {
  if (!scope?.userId) return ""
  return `${scope.userId}|${scope.role || ""}|${scope.areaId || ""}`
}

/**
 * Build authenticated cache scope from normalized app user (not localStorage bridge).
 * @param {{ id?: string, role?: string, areaId?: string, area_id?: string } | null} user
 */
export function buildQueryCacheScopeFromUser(user) {
  if (!user?.id) return null
  return {
    userId: String(user.id),
    role: String(user.role || ""),
    areaId: String(user.areaId || user.area_id || "")
  }
}

/** Opaque scope key for UI-layer caches (tab cache). Do not log externally. */
export function getQueryCacheScopeKey() {
  return scopeKeyFromScope(currentScope)
}

/** @internal Test helper */
export function getQueryCacheGeneration() {
  return cacheGeneration
}

/**
 * Set authenticated cache scope. Clears entries when user, role, or area changes.
 * @param {{ userId: string, role?: string, areaId?: string } | null} scope
 */
export function setQueryCacheScope(scope) {
  const nextKey = scopeKeyFromScope(scope)
  const prevKey = scopeKeyFromScope(currentScope)
  currentScope = scope || null
  if (nextKey !== prevKey) {
    resetQueryCacheInternal({ origin: nextKey ? "scope_change" : "scope_cleared" })
  }
}

/**
 * Clear all cache entries and inflight handles; increment generation.
 * @param {object} [options]
 * @param {string} [options.origin]
 */
export function resetQueryCache(options = {}) {
  currentScope = null
  resetQueryCacheInternal({ origin: options.origin || "reset" })
}

function resetQueryCacheInternal(options = {}) {
  cacheGeneration += 1
  entries.clear()
  recentlyInvalidatedKeys.clear()
  logCacheEvent(
    "cache_invalidate",
    "",
    undefined,
    buildInvalidateMetadata("", [], { ...options, invalidationMethod: "reset" })
  )
}

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
      cache_generation: cacheGeneration,
      ...extra
    }
  })
}

function classifyCacheMiss(key, current) {
  if (recentlyInvalidatedKeys.has(key)) {
    recentlyInvalidatedKeys.delete(key)
    return "invalidated"
  }
  if (current?.scopeGeneration === cacheGeneration
    && current?.value !== undefined
    && current.expiresAt > 0
    && current.expiresAt <= Date.now()) {
    return "expired"
  }
  if (current && current.scopeGeneration !== cacheGeneration) {
    return "scope_changed"
  }
  return "initial"
}

function buildInvalidateMetadata(prefix, removedKeys, options = {}) {
  const metadata = {
    source: options.invalidationMethod || "prefix",
    invalidate_origin: options.origin || "unknown",
    keys_removed: removedKeys.length,
    cache_generation: cacheGeneration
  }
  if (removedKeys.length === 1) {
    metadata.cache_key = removedKeys[0]
  } else if (prefix) {
    metadata.cache_key = prefix
  }
  if (options.channel) metadata.channel = options.channel
  if (options.table) metadata.table = options.table
  if (options.operation) metadata.operation = options.operation
  if (options.record_id) metadata.record_id = options.record_id
  if (options.subscription_instance_id) metadata.subscription_instance_id = options.subscription_instance_id
  return metadata
}

function entryIsReadable(entry) {
  return Boolean(
    entry
    && entry.scopeGeneration === cacheGeneration
    && entry.value !== undefined
    && entry.expiresAt > Date.now()
  )
}

function entryInflightForCurrentScope(entry) {
  return Boolean(entry?.promise && entry.scopeGeneration === cacheGeneration)
}

function commitCacheValue(key, captureGeneration, promiseRef, value, ttlMs) {
  if (captureGeneration !== cacheGeneration) return value
  const existing = entries.get(key)
  if (existing?.scopeGeneration !== captureGeneration) return value
  if (existing?.promise && existing.promise !== promiseRef) return value
  entries.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    scopeGeneration: captureGeneration
  })
  return value
}

function releaseInflightOnError(key, captureGeneration, promiseRef) {
  if (captureGeneration !== cacheGeneration) return
  const existing = entries.get(key)
  if (existing?.promise === promiseRef && existing.scopeGeneration === captureGeneration) {
    entries.delete(key)
  }
}

/**
 * In-memory TTL cache with in-flight request deduplication and auth scope isolation.
 * @param {string} key
 * @param {() => Promise<unknown>|unknown} loader
 * @param {number} [ttlMs]
 */
export function cachedQuery(key, loader, ttlMs = CACHE_TTL.CATALOG) {
  const captureGeneration = cacheGeneration
  const current = entries.get(key)

  if (entryIsReadable(current)) {
    logCacheEvent("cache_hit", key, ttlMs)
    if (isErpPerfDebugEnabled()) logErpPerfCacheEvent({ key, eventType: "cache_hit", ttlMs })
    return Promise.resolve(current.value)
  }

  if (entryInflightForCurrentScope(current)) {
    logCacheEvent("cache_inflight", key, ttlMs)
    if (isErpPerfDebugEnabled()) logErpPerfCacheEvent({ key, eventType: "cache_inflight", ttlMs })
    return current.promise
  }

  const missReason = classifyCacheMiss(key, current)
  logCacheEvent("cache_miss", key, ttlMs, { miss_reason: missReason })
  if (isErpPerfDebugEnabled()) logErpPerfCacheEvent({ key, eventType: "cache_miss", ttlMs })

  const promise = Promise.resolve()
    .then(() => loader())
    .then((value) => commitCacheValue(key, captureGeneration, promise, value, ttlMs))
    .catch((error) => {
      releaseInflightOnError(key, captureGeneration, promise)
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
          source: "queryCache",
          cache_generation: captureGeneration
        }
      })
      throw error
    })

  entries.set(key, { promise, expiresAt: 0, scopeGeneration: captureGeneration })
  return promise
}

/**
 * Remove all entries whose key starts with `prefix` (empty prefix clears all).
 * @param {string} [prefix]
 * @param {object} [options]
 * @param {string} [options.origin] mutation | realtime | manual_refresh | ttl | logout | unknown
 */
export function invalidateQueryCache(prefix = "", options = {}) {
  const removedKeys = []
  for (const key of entries.keys()) {
    if (!prefix || key.startsWith(prefix)) {
      entries.delete(key)
      recentlyInvalidatedKeys.add(key)
      removedKeys.push(key)
    }
  }
  if (removedKeys.length === 0) return 0

  logCacheEvent(
    "cache_invalidate",
    prefix || removedKeys[0],
    undefined,
    buildInvalidateMetadata(prefix, removedKeys, options)
  )
  return removedKeys.length
}

/** Remove a single cache entry by exact key. */
export function invalidateQueryCacheExact(key, options = {}) {
  const existed = entries.has(key)
  entries.delete(key)
  if (!existed) return false
  recentlyInvalidatedKeys.add(key)
  logCacheEvent(
    "cache_invalidate",
    key,
    undefined,
    buildInvalidateMetadata("", [key], { ...options, invalidationMethod: "exact" })
  )
  return true
}

/** @internal Test helper */
export function __resetQueryCacheForTests() {
  currentScope = null
  cacheGeneration = 0
  entries.clear()
  recentlyInvalidatedKeys.clear()
}

/** @internal Test helper */
export function __getQueryCacheSnapshot() {
  return {
    size: entries.size,
    keys: [...entries.keys()],
    generation: cacheGeneration,
    scopeKey: scopeKeyFromScope(currentScope)
  }
}
