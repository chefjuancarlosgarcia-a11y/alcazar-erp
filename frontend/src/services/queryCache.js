import { CACHE_TTL } from "./cacheConfig"

const entries = new Map()

/**
 * In-memory TTL cache with in-flight request deduplication.
 * @param {string} key
 * @param {() => Promise<unknown>|unknown} loader
 * @param {number} [ttlMs]
 */
export function cachedQuery(key, loader, ttlMs = CACHE_TTL.CATALOG) {
  const current = entries.get(key)
  if (current?.value !== undefined && current.expiresAt > Date.now()) {
    return Promise.resolve(current.value)
  }
  if (current?.promise) return current.promise

  const promise = Promise.resolve()
    .then(() => loader())
    .then((value) => {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs })
      return value
    })
    .catch((error) => {
      entries.delete(key)
      throw error
    })

  entries.set(key, { promise, expiresAt: 0 })
  return promise
}

/** Remove all entries whose key starts with `prefix` (empty prefix clears all). */
export function invalidateQueryCache(prefix = "") {
  for (const key of entries.keys()) {
    if (!prefix || key.startsWith(prefix)) entries.delete(key)
  }
}

/** Remove a single cache entry by exact key. */
export function invalidateQueryCacheExact(key) {
  entries.delete(key)
}
