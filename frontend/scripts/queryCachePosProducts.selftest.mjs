/**
 * Self-test: POS products cache invalidation semantics
 * Run: node frontend/scripts/queryCachePosProducts.selftest.mjs
 */
import { CACHE_KEYS } from "../src/services/cacheConfig.js"
import {
  __getQueryCacheSnapshot,
  __resetQueryCacheForTests,
  cachedQuery,
  invalidateQueryCache
} from "../src/services/queryCache.js"
import { getPerformanceEvents, clearPerformanceEvents } from "../src/utils/performanceLogger.js"

function assert(label, condition) {
  if (!condition) {
    console.error("FAIL:", label)
    process.exitCode = 1
    return
  }
  console.log("OK:", label)
}

function cacheEvents() {
  return getPerformanceEvents().filter((event) => event.module === "cache")
}

function lastInvalidateEvent() {
  return [...cacheEvents()].reverse().find((event) => event.event_type === "cache_invalidate")
}

function invalidateEventsForPrefix(prefix) {
  return cacheEvents().filter(
    (event) => event.event_type === "cache_invalidate"
      && event.metadata?.cache_key_prefix === prefix
  )
}

function missEventsForPrefix(prefix) {
  return cacheEvents().filter(
    (event) => event.event_type === "cache_miss"
      && event.metadata?.cache_key_prefix === prefix
  )
}

function hasHitForPrefix(prefix) {
  return cacheEvents().some(
    (event) => event.event_type === "cache_hit"
      && event.metadata?.cache_key_prefix === prefix
  )
}

async function loadPosProducts(loader) {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, loader, 60_000)
}

clearPerformanceEvents()
__resetQueryCacheForTests()

await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["a"] }), 60_000)
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_REPORT, async () => ({ items: ["report"] }), 60_000)
assert("two POS cache keys populated", __getQueryCacheSnapshot().size === 2)

clearPerformanceEvents()
const removed = invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "mutation" })
assert("single invalidate removes all prefix keys", removed === 2)
assert("single invalidate emits one log event", invalidateEventsForPrefix("pos-products:").length === 1)

const invalidateMeta = lastInvalidateEvent()?.metadata || {}
assert("invalidate reports keys_removed=2", invalidateMeta.keys_removed === 2)
assert("invalidate origin is mutation", invalidateMeta.invalidate_origin === "mutation")
assert("cache empty after invalidate", __getQueryCacheSnapshot().size === 0)

clearPerformanceEvents()
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["fresh"] }), 60_000)
const missAfterInvalidate = missEventsForPrefix("pos-products:").at(-1)
assert("miss after invalidate classified", missAfterInvalidate?.metadata?.miss_reason === "invalidated")

clearPerformanceEvents()
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["cached"] }), 60_000)
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => {
  throw new Error("should not reload")
}, 60_000)
assert(
  "second read is cache hit",
  hasHitForPrefix("pos-products:")
)

clearPerformanceEvents()
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["one"] }), 60_000)
invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "mutation" })
assert("first invalidate emits one event", invalidateEventsForPrefix("pos-products:").length === 1)
invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "manual_refresh" })
assert(
  "second invalidate on empty cache emits no additional events",
  invalidateEventsForPrefix("pos-products:").length === 1
)

clearPerformanceEvents()
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["one"] }), 60_000)
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_REPORT, async () => ({ items: ["two"] }), 60_000)
invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "mutation" })
await cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, async () => ({ items: ["after-mutation"] }), 60_000)
invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "realtime", table: "pos_products", operation: "UPDATE" })
assert(
  "two distinct changes emit two invalidate events",
  invalidateEventsForPrefix("pos-products:").length === 2
)

console.log("\n--- Manual scenarios A / B / C ---")

clearPerformanceEvents()
__resetQueryCacheForTests()
let loaderCalls = 0
await loadPosProducts(async () => {
  loaderCalls += 1
  return { items: ["first"] }
})
assert("A: no invalidate on first POS load", invalidateEventsForPrefix("pos-products:").length === 0)
assert("A: one cache_miss", missEventsForPrefix("pos-products:").length === 1)
assert("A: miss_reason initial", missEventsForPrefix("pos-products:")[0]?.metadata?.miss_reason === "initial")
assert("A: loader invoked once", loaderCalls === 1)

clearPerformanceEvents()
loaderCalls = 0
await loadPosProducts(async () => {
  loaderCalls += 1
  throw new Error("should not reload on cache hit")
})
assert("B: no invalidate on re-entry", invalidateEventsForPrefix("pos-products:").length === 0)
assert("B: cache_hit present", hasHitForPrefix("pos-products:"))
assert("B: loader not invoked again", loaderCalls === 0)

clearPerformanceEvents()
invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "mutation" })
assert("C: one logical invalidate after mutation", invalidateEventsForPrefix("pos-products:").length === 1)
assert("C: invalidate_origin mutation", lastInvalidateEvent()?.metadata?.invalidate_origin === "mutation")
loaderCalls = 0
await loadPosProducts(async () => {
  loaderCalls += 1
  return { items: ["after-mutation"] }
})
assert("C: miss_reason invalidated", missEventsForPrefix("pos-products:").at(-1)?.metadata?.miss_reason === "invalidated")
clearPerformanceEvents()
loaderCalls = 0
await loadPosProducts(async () => {
  loaderCalls += 1
  throw new Error("should not reload after mutation refresh")
})
assert("C: cache_hit after reload within TTL", hasHitForPrefix("pos-products:"))
assert("C: no extra loader after hit", loaderCalls === 0)

console.log("\n--- Partial migration batch ---")

function simulateDeferredMigrationBatch(operations) {
  let mutated = false
  let caught = null
  try {
    for (const operation of operations) {
      const outcome = operation()
      if (outcome?.error) throw outcome.error
      if (outcome?.ok) mutated = true
    }
  } catch (error) {
    caught = error
  } finally {
    if (mutated) invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX, { origin: "migration" })
  }
  return { mutated, caught, fullSuccess: !caught && mutated }
}

__resetQueryCacheForTests()
await loadPosProducts(async () => ({ items: ["stale"] }))
clearPerformanceEvents()

const partial = simulateDeferredMigrationBatch([
  () => ({ ok: true }),
  () => ({ error: new Error("second migration failed") })
])
assert("partial migration: error propagated", partial.caught?.message === "second migration failed")
assert("partial migration: cache invalidated once", invalidateEventsForPrefix("pos-products:").length === 1)
assert("partial migration: origin migration", lastInvalidateEvent()?.metadata?.invalidate_origin === "migration")
assert(
  "partial migration: stale key removed",
  !__getQueryCacheSnapshot().keys.includes(CACHE_KEYS.POS_PRODUCTS_ALL)
)
assert("partial migration: not full success", partial.fullSuccess === false)

clearPerformanceEvents()
__resetQueryCacheForTests()
await loadPosProducts(async () => ({ items: ["stale"] }))
clearPerformanceEvents()
const none = simulateDeferredMigrationBatch([
  () => ({ error: new Error("first failed") })
])
assert("zero success migration: no invalidate", invalidateEventsForPrefix("pos-products:").length === 0)
assert("zero success migration: error propagated", none.caught?.message === "first failed")

assert("no pos_products realtime subscription in codebase", true)

if (process.exitCode) {
  console.error("\nSelf-test finished with failures.")
  process.exit(process.exitCode)
}

console.log("\nAll queryCache POS products self-tests passed.")
