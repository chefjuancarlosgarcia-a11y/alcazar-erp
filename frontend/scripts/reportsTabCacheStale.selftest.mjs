/**
 * Self-test: reports tab cache stale-while-revalidate (A1.6b).
 * Run: node frontend/scripts/reportsTabCacheStale.selftest.mjs
 */
import {
  createReportsTabCacheStore,
  hasFreshReportsTabCacheEntry,
  hasReportsTabCacheEntry,
  peekReportsTabCacheEntry,
  resetReportsTabCacheStore,
  resolveReportsViewState,
  serializeReportsTabCacheKey,
  setReportsTabCacheEntry,
  syncReportsTabCacheScope,
  shouldShowReportsContent
} from "../src/modules/reports/reportsViewState.js"
import { ttlForReportsTab } from "../src/services/cacheConfig.js"

function assert(label, condition) {
  if (!condition) {
    console.error("FAIL:", label)
    process.exitCode = 1
    return
  }
  console.log("OK:", label)
}

const store = createReportsTabCacheStore()
resetReportsTabCacheStore(store, "user-a|admin|")
const tab = "executive"
const cacheKey = serializeReportsTabCacheKey(tab, { preset: "today" })
const sampleData = { current: { day: { orders: 3, total: 1200 } } }
const ttlMs = ttlForReportsTab(tab)
const baseNow = 1_700_000_000_000

setReportsTabCacheEntry(store, cacheKey, tab, sampleData)
store.entries.get(cacheKey).fetchedAt = baseNow

// 1. Fresh cache — entry kept, not stale, no delete on peek
const freshPeek = peekReportsTabCacheEntry(store, cacheKey, tab, baseNow + 1_000)
assert("fresh peek returns data", freshPeek?.data === sampleData)
assert("fresh peek isStale false", freshPeek?.isStale === false)
assert("fresh entry still in map", store.entries.has(cacheKey))
assert("hasFreshReportsTabCacheEntry true when fresh", hasFreshReportsTabCacheEntry(store, cacheKey, tab, baseNow + 1_000))

// 2. Stale cache — data preserved, isStale true
const staleNow = baseNow + ttlMs + 1
const stalePeek = peekReportsTabCacheEntry(store, cacheKey, tab, staleNow)
assert("stale peek returns data", stalePeek?.data === sampleData)
assert("stale peek isStale true", stalePeek?.isStale === true)
assert("stale entry not deleted", store.entries.has(cacheKey))
assert("hasReportsTabCacheEntry true when stale", hasReportsTabCacheEntry(store, cacheKey, tab, staleNow))
assert("hasFreshReportsTabCacheEntry false when stale", !hasFreshReportsTabCacheEntry(store, cacheKey, tab, staleNow))

// 3. Stale + error → error-with-cache, content visible
const staleErrorState = resolveReportsViewState({
  loading: false,
  refreshing: false,
  refreshError: "Failed to fetch",
  requestCompleted: true,
  hasCachedData: true,
  data: sampleData
})
assert("stale error uses error-with-cache", staleErrorState === "error-with-cache")
assert("stale error keeps content", shouldShowReportsContent(staleErrorState))

// 4. No cache + error → error-without-cache
const noCacheErrorState = resolveReportsViewState({
  loading: false,
  refreshing: false,
  error: "Failed to fetch",
  requestCompleted: true,
  hasCachedData: false,
  data: null
})
assert("no cache error uses error-without-cache", noCacheErrorState === "error-without-cache")
assert("no cache error hides content", !shouldShowReportsContent(noCacheErrorState))

// 5. Stale + recovery — setReportsTabCacheEntry updates fetchedAt
setReportsTabCacheEntry(store, cacheKey, tab, { current: { day: { orders: 5, total: 2000 } } })
const recovered = peekReportsTabCacheEntry(store, cacheKey, tab, baseNow + ttlMs + 5_000)
assert("recovery replaces data", recovered?.data?.current?.day?.orders === 5)
assert("recovery is fresh again", recovered?.isStale === false)
assert("recovery fetchedAt updated", recovered?.fetchedAt > baseNow)

// 6. Tab switch guard — simulated request identity mismatch
const requestTab = "executive"
const requestCacheKey = cacheKey
const activeTab = "sales"
const activeCacheKey = serializeReportsTabCacheKey("sales", { preset: "today" })
const stillCurrent = requestTab === activeTab && requestCacheKey === activeCacheKey
assert("late response from other tab does not match active", stillCurrent === false)

// 7. Scope change clears entries
syncReportsTabCacheScope(store, "user-b|mesero|")
assert("scope change clears cache", store.entries.size === 0)
assert("no peek after scope change", peekReportsTabCacheEntry(store, cacheKey, tab) == null)

syncReportsTabCacheScope(store, "user-b|mesero|")
setReportsTabCacheEntry(store, cacheKey, tab, sampleData)
resetReportsTabCacheStore(store, "")
assert("logout reset clears cache", store.entries.size === 0)

if (process.exitCode) {
  console.error("\nSome tests failed.")
  process.exit(1)
}
console.log("\nAll reports tab cache stale tests passed.")
