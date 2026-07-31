import { isErpPerfDebugEnabled } from "./erpPerf"

/**
 * Dev-only telemetry for Reports/Dashboard loads.
 * Never log PII, order content, collaborator names, or auth headers.
 */
export function logReportsPerf(event, meta = {}) {
  if (!isErpPerfDebugEnabled()) return

  const safe = {
    module: "reports",
    event,
    route: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search || ""}` : "",
    ...meta
  }

  if (safe.row_count == null && Array.isArray(safe.rows)) {
    safe.row_count = safe.rows.length
    delete safe.rows
  }

  console.info("[ERP PERF]", safe)
}

export function measureReportsPayloadRows(data) {
  if (data == null) return 0
  if (Array.isArray(data)) return data.length
  if (typeof data !== "object") return 0
  if (Array.isArray(data.orders)) return data.orders.length
  if (data.current && data.previous) return 8
  return Object.keys(data).length
}
