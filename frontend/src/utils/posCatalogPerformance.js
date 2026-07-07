/**
 * POS catalog performance audit — console filter: [POS PERF]
 *
 * Required fields per sample:
 * catalog_size, rpc_ms, render_ms, payload_bytes, images_loaded, memory_usage
 */

export const POS_PERF_PREFIX = "[POS PERF]"

export function estimatePayloadBytes(payload) {
  if (payload == null) return 0
  if (typeof payload === "string") return new TextEncoder().encode(payload).length
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length
  } catch {
    return 0
  }
}

export function getMemoryUsageMb() {
  const memory = performance?.memory
  if (!memory) return null
  return Math.round((memory.usedJSHeapSize / (1024 * 1024)) * 100) / 100
}

export function countResourceRequestsSince(sinceCount = 0) {
  const total = performance.getEntriesByType("resource").length
  return Math.max(0, total - sinceCount)
}

export function countImagesLoadedInCatalog(rootSelector = ".pos-dish-manager") {
  const root = document.querySelector(rootSelector)
  if (!root) return 0
  return [...root.querySelectorAll("img")].filter((img) => {
    const src = String(img.currentSrc || img.src || "").trim()
    return src.length > 0 && !src.startsWith("blob:")
  }).length
}

export function countPosProductImageNetworkRequests(withinMs = 5000) {
  const cutoff = performance.now() - withinMs
  return performance.getEntriesByType("resource").filter((entry) => {
    if (entry.startTime < cutoff) return false
    const name = String(entry.name || "")
    return (
      name.includes("/storage/v1/object/public/pos-product-images/")
      || (entry.initiatorType === "img" && /pos-product-images|\.(webp|jpe?g|png)(\?|$)/i.test(name))
    )
  }).length
}

export function logPosCatalogPerf(fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    catalog_size: fields.catalog_size ?? null,
    rpc_ms: fields.rpc_ms ?? null,
    render_ms: fields.render_ms ?? null,
    payload_bytes: fields.payload_bytes ?? null,
    images_loaded: fields.images_loaded ?? null,
    memory_usage: fields.memory_usage ?? getMemoryUsageMb(),
    ...fields
  }
  console.info(POS_PERF_PREFIX, entry)
  if (typeof window !== "undefined") {
    window.__POS_CATALOG_PERF_LOG__ = window.__POS_CATALOG_PERF_LOG__ || []
    window.__POS_CATALOG_PERF_LOG__.push(entry)
  }
  return entry
}

export function measureRenderMs(startedAt = performance.now()) {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve(Math.max(0, Math.round(performance.now() - startedAt)))
      })
    })
  })
}

function average(values = []) {
  const nums = values.filter((value) => typeof value === "number" && Number.isFinite(value))
  if (!nums.length) return 0
  return Math.round(nums.reduce((sum, value) => sum + value, 0) / nums.length)
}

export function summarizePerfSamples(samples = []) {
  const pick = (key) => samples.map((sample) => sample[key]).filter((value) => typeof value === "number")
  return {
    samples: samples.length,
    catalog_size: samples[0]?.catalog_size ?? 0,
    rpc_ms_avg: average(pick("rpc_ms")),
    rpc_ms_max: Math.max(0, ...pick("rpc_ms")),
    render_ms_avg: average(pick("render_ms")),
    render_ms_max: Math.max(0, ...pick("render_ms")),
    payload_bytes_avg: average(pick("payload_bytes")),
    payload_bytes_max: Math.max(0, ...pick("payload_bytes")),
    images_loaded_max: Math.max(0, ...pick("images_loaded")),
    image_network_requests_max: Math.max(0, ...pick("image_network_requests")),
    memory_usage_last: samples.at(-1)?.memory_usage ?? null
  }
}

/**
 * Runs repeated catalog page loads and logs [POS PERF] samples + summary.
 * Usage (logged-in, /pos?section=agregar-item):
 *   await window.runPOSCatalogPerfAudit()
 */
export async function runCatalogPerfAudit({
  loadPage,
  pages = [1, 2, 3],
  delayMs = 500
} = {}) {
  if (typeof loadPage !== "function") {
    throw new Error("runCatalogPerfAudit requires loadPage(pageNumber) => Promise<result>")
  }

  const samples = []
  for (const page of pages) {
    const resourceBaseline = performance.getEntriesByType("resource").length
    const memoryBefore = getMemoryUsageMb()
    const started = performance.now()

    const result = await loadPage(page)
    const rpcMs = result?.perf?.rpc_ms ?? Math.round(performance.now() - started)
    const renderMs = await measureRenderMs(started)

    await new Promise((resolve) => window.setTimeout(resolve, delayMs))

    const sample = logPosCatalogPerf({
      phase: "catalog_load",
      page,
      catalog_size: result?.total ?? 0,
      rpc_ms: rpcMs,
      render_ms: renderMs,
      payload_bytes: result?.perf?.payload_bytes ?? 0,
      images_loaded: countImagesLoadedInCatalog(),
      image_network_requests: countPosProductImageNetworkRequests(4000),
      request_count: countResourceRequestsSince(resourceBaseline) + (result?.perf?.request_count ?? 1),
      memory_usage: getMemoryUsageMb(),
      memory_delta_mb: memoryBefore != null && getMemoryUsageMb() != null
        ? Math.round((getMemoryUsageMb() - memoryBefore) * 100) / 100
        : null,
      source: result?.perf?.source || "unknown",
      error: result?.error?.message || null,
      timeout: /timeout|canceling statement|57014/i.test(String(result?.error?.message || ""))
    })
    samples.push(sample)

    if (sample.timeout) {
      logPosCatalogPerf({
        phase: "timeout_detected",
        page,
        query: result?.perf?.source || "list_pos_catalog_page",
        message: result?.error?.message
      })
    }
  }

  const summary = summarizePerfSamples(samples)
  logPosCatalogPerf({ phase: "audit_summary", ...summary })
  return { samples, summary }
}

export function exportPerfLogJson() {
  if (typeof window === "undefined") return "[]"
  return JSON.stringify(window.__POS_CATALOG_PERF_LOG__ || [], null, 2)
}
