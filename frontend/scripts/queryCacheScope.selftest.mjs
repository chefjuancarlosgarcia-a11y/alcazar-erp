/**
 * Self-test: query cache auth scope, inflight isolation, TTL helpers.
 * Run: node frontend/scripts/queryCacheScope.selftest.mjs
 */
import {
  CACHE_TTL,
  getGtLocalDateString,
  isHistoricalClosedRange,
  isRangeIncludingOperationalToday,
  normalizeReportFilters,
  operationalAlertsBundleCacheKey,
  stableReportFiltersKey,
  ttlForOperationalReport,
  ttlForOrdersRange,
  ttlForReportFilters
} from "../src/services/cacheConfig.js"
import {
  __getQueryCacheSnapshot,
  __resetQueryCacheForTests,
  buildQueryCacheScopeFromUser,
  cachedQuery,
  getQueryCacheGeneration,
  resetQueryCache,
  setQueryCacheScope
} from "../src/services/queryCache.js"

function assert(label, condition) {
  if (!condition) {
    console.error("FAIL:", label)
    process.exitCode = 1
    return
  }
  console.log("OK:", label)
}

const scopeA = buildQueryCacheScopeFromUser({ id: "user-a", role: "admin", areaId: "kitchen" })
const scopeB = buildQueryCacheScopeFromUser({ id: "user-b", role: "mesero", areaId: "" })

__resetQueryCacheForTests()
setQueryCacheScope(scopeA)

let loadsA = 0
await cachedQuery("reports:test-scope", async () => {
  loadsA += 1
  return { owner: "A" }
}, 60_000)
await cachedQuery("reports:test-scope", async () => {
  loadsA += 1
  return { owner: "A-stale-loader" }
}, 60_000)
assert("scope A first load", loadsA === 1)
assert("scope A cache hit", __getQueryCacheSnapshot().size === 1)

setQueryCacheScope(scopeB)
loadsA = 0
let loadsB = 0
const bResult = await cachedQuery("reports:test-scope", async () => {
  loadsB += 1
  return { owner: "B" }
}, 60_000)
assert("scope change clears prior entries", __getQueryCacheSnapshot().size === 1)
assert("scope B miss triggers loader", loadsB === 1)
assert("scope B never reads A payload", bResult.owner === "B")

resetQueryCache({ origin: "logout" })
assert("logout clears cache", __getQueryCacheSnapshot().size === 0)

setQueryCacheScope(scopeA)
await cachedQuery("reports:test-scope", async () => ({ owner: "A" }), 60_000)
resetQueryCache({ origin: "logout" })
setQueryCacheScope(scopeB)
loadsB = 0
await cachedQuery("reports:test-scope", async () => {
  loadsB += 1
  return { owner: "B-after-logout" }
}, 60_000)
assert("post-logout login starts clean", loadsB === 1)

__resetQueryCacheForTests()
setQueryCacheScope(scopeA)
const genBefore = getQueryCacheGeneration()
let slowLoads = 0
const slowPromise = cachedQuery("reports:slow-inflight", async () => {
  slowLoads += 1
  await new Promise((resolve) => setTimeout(resolve, 40))
  return { owner: "A-slow" }
}, 60_000)
setQueryCacheScope(scopeB)
let bLoads = 0
const bAfterSwitch = cachedQuery("reports:slow-inflight", async () => {
  bLoads += 1
  return { owner: "B-fast" }
}, 60_000)
const slowResult = await slowPromise
const fastResult = await bAfterSwitch
assert("late A loader completes for its caller", slowResult.owner === "A-slow")
assert("B loader stored its result", fastResult.owner === "B-fast")
const cachedAfterLateA = await cachedQuery("reports:slow-inflight", async () => {
  bLoads += 1
  return { owner: "B-unexpected" }
}, 60_000)
assert("late A result is not stored", cachedAfterLateA.owner === "B-fast")
assert("B loader ran once", bLoads === 1)
assert("generation bumped on scope switch", getQueryCacheGeneration() > genBefore)

__resetQueryCacheForTests()
setQueryCacheScope(scopeA)
const sameScopeGen = getQueryCacheGeneration()
setQueryCacheScope({ ...scopeA })
assert("same scope preserves generation", getQueryCacheGeneration() === sameScopeGen)

const roleScope = buildQueryCacheScopeFromUser({ id: "user-a", role: "supervisor", areaId: "kitchen" })
setQueryCacheScope(scopeA)
await cachedQuery("reports:role-key", async () => "admin-data", 60_000)
setQueryCacheScope(roleScope)
let roleLoads = 0
const roleData = await cachedQuery("reports:role-key", async () => {
  roleLoads += 1
  return "supervisor-data"
}, 60_000)
assert("role change invalidates cache", roleLoads === 1)
assert("role change returns new data", roleData === "supervisor-data")

const key1 = stableReportFiltersKey({ preset: "today", shift: "am", end: "", start: "" })
const key2 = stableReportFiltersKey({ shift: "am", preset: "today", start: "", end: "" })
assert("equivalent filters same key", key1 === key2)
assert("different preset different key", stableReportFiltersKey({ preset: "week" }) !== key1)
assert("bundle key includes filters", operationalAlertsBundleCacheKey({ preset: "today" }) !== operationalAlertsBundleCacheKey({ preset: "week" }))
assert("normalize stable", JSON.stringify(normalizeReportFilters({ preset: "today" })) === JSON.stringify(normalizeReportFilters({ preset: "today", start: "" })))

const gtToday = getGtLocalDateString(new Date("2026-07-31T18:00:00.000Z"))
assert("GT date string format", /^\d{4}-\d{2}-\d{2}$/.test(gtToday))

const closedRange = {
  start: "2026-01-01T06:00:00.000Z",
  end: "2026-01-31T05:59:59.999Z"
}
const todayRange = {
  start: `${gtToday}T06:00:00.000Z`,
  end: new Date().toISOString()
}
assert("historical closed TTL long", ttlForOrdersRange(closedRange, new Date("2026-07-31T18:00:00.000Z")) === CACHE_TTL.REPORT_HISTORICAL)
assert("today range TTL short", ttlForOrdersRange(todayRange, new Date("2026-07-31T18:00:00.000Z")) === CACHE_TTL.REPORT_TODAY)
assert("operational bundle TTL 30s", ttlForOperationalReport({ preset: "today" }) === CACHE_TTL.REPORT_OPERATIONAL)
assert("today filters TTL short", ttlForReportFilters({ preset: "today" }) === CACHE_TTL.REPORT_TODAY)
assert("closed filters TTL long", ttlForReportFilters({ preset: "custom", start: "2026-01-01", end: "2026-01-31" }, new Date("2026-07-31T18:00:00.000Z")) === CACHE_TTL.REPORT_HISTORICAL)
assert("range includes today", isRangeIncludingOperationalToday(todayRange, new Date("2026-07-31T18:00:00.000Z")))
assert("historical excludes today", isHistoricalClosedRange(closedRange, new Date("2026-07-31T18:00:00.000Z")))

if (process.exitCode) {
  console.error("\nScope self-test finished with failures.")
  process.exit(process.exitCode)
}

console.log("\nAll queryCache scope self-tests passed.")
