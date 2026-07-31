import { ttlForReportsTab } from "../../services/cacheConfig.js"

export function serializeReportsTabCacheKey(tab, filters = {}) {
  return JSON.stringify({
    tab,
    preset: filters.preset || "",
    start: filters.start || "",
    end: filters.end || "",
    collaborator: filters.collaborator || "",
    shift: filters.shift || "",
    category: filters.category || "",
    month: filters.month || ""
  })
}

export function createReportsTabCacheStore() {
  return {
    scopeKey: "",
    entries: new Map()
  }
}

export function resetReportsTabCacheStore(store, scopeKey = "") {
  store.scopeKey = scopeKey
  store.entries.clear()
}

export function syncReportsTabCacheScope(store, scopeKey) {
  if (!scopeKey) {
    resetReportsTabCacheStore(store, "")
    return true
  }
  if (store.scopeKey && store.scopeKey !== scopeKey) {
    resetReportsTabCacheStore(store, scopeKey)
    return true
  }
  store.scopeKey = scopeKey
  return false
}

function resolveEntryTtl(entry, tab) {
  return entry.ttlMs ?? ttlForReportsTab(tab)
}

export function isReportsTabCacheEntryFresh(entry, tab, now = Date.now()) {
  if (!entry) return false
  return now <= entry.fetchedAt + resolveEntryTtl(entry, tab)
}

/** Read tab cache without deleting; TTL marks stale, not absent. */
export function peekReportsTabCacheEntry(store, cacheKey, tab, now = Date.now()) {
  if (!store.scopeKey) return null
  const entry = store.entries.get(cacheKey)
  if (!entry || entry.data == null) return null
  const isStale = !isReportsTabCacheEntryFresh(entry, tab, now)
  return {
    data: entry.data,
    fetchedAt: entry.fetchedAt,
    isStale,
    ttlMs: resolveEntryTtl(entry, tab)
  }
}

export function hasReportsTabCacheEntry(store, cacheKey, tab, now = Date.now()) {
  return peekReportsTabCacheEntry(store, cacheKey, tab, now) != null
}

export function hasFreshReportsTabCacheEntry(store, cacheKey, tab, now = Date.now()) {
  const peek = peekReportsTabCacheEntry(store, cacheKey, tab, now)
  return Boolean(peek && !peek.isStale)
}

/** @deprecated Prefer peekReportsTabCacheEntry — kept for callers expecting data-only when fresh. */
export function getReportsTabCacheEntry(store, cacheKey, tab, now = Date.now()) {
  const peek = peekReportsTabCacheEntry(store, cacheKey, tab, now)
  if (!peek || peek.isStale) return undefined
  return peek.data
}

export function setReportsTabCacheEntry(store, cacheKey, tab, data) {
  if (!store.scopeKey) return
  store.entries.set(cacheKey, {
    data,
    fetchedAt: Date.now(),
    ttlMs: ttlForReportsTab(tab),
    tab
  })
}

/** @deprecated Use hasReportsTabCacheEntry (includes stale). */
export function hasValidReportsTabCacheEntry(store, cacheKey, tab, now = Date.now()) {
  return hasFreshReportsTabCacheEntry(store, cacheKey, tab, now)
}

export function resolveReportsViewState({
  loading = false,
  refreshing = false,
  error = "",
  refreshError = "",
  requestCompleted = false,
  hasCachedData = false,
  data = null,
  isEmptyData = false
} = {}) {
  const hasError = Boolean(error)
  const hasRefreshError = Boolean(refreshError)
  const hasVisibleData = hasCachedData || data != null

  if (hasRefreshError && hasVisibleData) return "error-with-cache"
  if (hasError && hasVisibleData) return "error-with-cache"
  if (hasError && requestCompleted && !hasVisibleData) return "error-without-cache"
  if (loading && !hasVisibleData) return "initial-loading"
  if (refreshing && hasVisibleData) return "background-refresh"
  if (requestCompleted && !loading && !refreshing && !hasError && isEmptyData) return "success-empty"
  if (hasVisibleData && (requestCompleted || !loading)) return "success-with-data"
  if (loading) return "initial-loading"
  return "initial-loading"
}

export function shouldShowReportsContent(viewState) {
  return ["success-with-data", "background-refresh", "error-with-cache", "success-empty"].includes(viewState)
}

export function shouldShowReportsEmpty(viewState) {
  return viewState === "success-empty"
}

export function isReportsDataEmpty(tab, data) {
  if (data == null) return false
  if (tab === "executive") {
    const c = data.current || {}
    return !c.day?.orders && !c.week?.orders && !c.month?.orders && !c.year?.orders
      && !c.day?.total && !c.month?.total
  }
  if (tab === "sales") return !(data.summary?.orders || data.byDay?.length)
  if (tab === "waiters" || tab === "comparison") return !Array.isArray(data) || data.length === 0
  if (tab === "purchases") return !(data.rows?.length || data.summary?.total)
  if (tab === "payroll") return !(data.rows?.length)
  if (tab === "menu") return !Array.isArray(data) || data.length === 0
  if (tab === "inventory") return !(data.out?.length || data.low?.length)
  if (tab === "fixedCosts") return !(data.costs?.length)
  if (tab === "goals") return !data.report?.target_amount && !(data.ranking?.length)
  if (tab === "yields") return !(data?.topLossItems?.length || data?.employeeScorecard?.length)
  return false
}
