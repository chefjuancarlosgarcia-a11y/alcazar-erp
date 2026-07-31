/** ERP report timezone for operational-day boundaries. */
export const ERP_REPORT_TIMEZONE = "America/Guatemala"

/** Guatemala operates at UTC-6 year-round (no DST). */
const GT_UTC_OFFSET = "-06:00"

/** TTL presets for in-memory query cache (milliseconds). */
export const CACHE_TTL = {
  /** Productos, proveedores, áreas */
  CATALOG: 5 * 60_000,
  /** Roles, unidades, branding */
  REFERENCE: 10 * 60_000,
  /** Mesas activas, bundle operacional, producción en vivo */
  REPORT_OPERATIONAL: 30_000,
  /** Ventas del día, dashboard mixto, tabs UI */
  REPORT_TODAY: 60_000,
  /** Rangos históricos cerrados, exportación histórica */
  REPORT_HISTORICAL: 10 * 60_000,
  /** Dashboard ejecutivo (mezcla histórico + hoy) */
  REPORT_EXECUTIVE_MIXED: 60_000,
  /** Inventario crítico / alertas de stock */
  REPORT_INVENTORY_ALERTS: 60_000,
  /** @deprecated Prefer REPORT_TODAY / REPORT_HISTORICAL / REPORT_OPERATIONAL */
  REPORT_CATALOG: 60_000
}

/** Cache key prefixes and identifiers (`entity:variant`). */
export const CACHE_KEYS = {
  AREAS_PREFIX: "areas:",
  ROLES_PREFIX: "roles:",
  ROLES_ACTIVE: "roles:active",
  ROLES_ALL: "roles:all",
  ROLES_CATEGORIES: "roles:categories",
  SUPPLIERS_PREFIX: "suppliers:",
  SUPPLIERS_ACTIVE: "suppliers:active",
  INVENTORY_CATEGORIES_PREFIX: "inventory-categories:",
  INVENTORY_CATEGORIES_ALL: "inventory-categories:all",
  INVENTORY_CATEGORIES_ACTIVE: "inventory-categories:active",
  CONFIG_PREFIX: "config:",
  BRANDING: "config:branding",
  UNITS_INVENTORY: "units:inventory",
  UNITS_ITEM_PREFIX: "units:item:",
  POS_PRODUCTS_PREFIX: "pos-products:",
  POS_PRODUCTS_ALL: "pos-products:all",
  POS_PRODUCTS_ACTIVE: "pos-products:active",
  POS_PRODUCTS_PRODUCTION: "pos-products:production-ready",
  POS_PRODUCTS_REPORT: "pos-products:report",
  EXECUTIVE_DASHBOARD: "reports:executive-dashboard",
  ORDERS_RANGE_PREFIX: "reports:orders:range:",
  ORDERS_FILTERS_PREFIX: "reports:orders:filters:",
  PRODUCTION_REPORT_PREFIX: "reports:production:",
  INVENTORY_REPORT_PREFIX: "reports:inventory:",
  OPERATIONAL_ALERTS_BUNDLE_PREFIX: "reports:operational-alerts-bundle:",
  SALES_ANALYTICS_PREFIX: "reports:sales-analytics:",
  MENU_ENGINEERING_PREFIX: "reports:menu-engineering:"
}

const REPORT_FILTER_FIELDS = [
  "preset",
  "start",
  "end",
  "month",
  "category",
  "collaborator",
  "shift",
  "areaId"
]

/** Stable normalized filters for semantic cache keys (order-independent). */
export function normalizeReportFilters(filters = {}) {
  return {
    preset: filters.preset || "custom",
    start: filters.start || "",
    end: filters.end || "",
    month: filters.month || "",
    category: filters.category || "",
    collaborator: filters.collaborator || "",
    shift: filters.shift || "",
    areaId: filters.areaId || ""
  }
}

export function stableReportFiltersKey(filters = {}) {
  const normalized = normalizeReportFilters(filters)
  return REPORT_FILTER_FIELDS.map((field) => `${field}=${normalized[field]}`).join("&")
}

export function getGtLocalDateString(date = new Date()) {
  return date.toLocaleDateString("en-CA", { timeZone: ERP_REPORT_TIMEZONE })
}

function gtDayBounds(dateStr) {
  return {
    start: new Date(`${dateStr}T00:00:00.000${GT_UTC_OFFSET}`),
    end: new Date(`${dateStr}T23:59:59.999${GT_UTC_OFFSET}`)
  }
}

/** True when the range overlaps the current operational day in Guatemala. */
export function isRangeIncludingOperationalToday(range, now = new Date()) {
  if (!range?.start || !range?.end) return true
  const { start: todayStart, end: todayEnd } = gtDayBounds(getGtLocalDateString(now))
  const rangeStart = new Date(range.start)
  const rangeEnd = new Date(range.end)
  return rangeStart.getTime() <= todayEnd.getTime() && rangeEnd.getTime() >= todayStart.getTime()
}

/** True when the entire range ends before today's operational start (GT). */
export function isHistoricalClosedRange(range, now = new Date()) {
  if (!range?.start || !range?.end) return false
  const { start: todayStart } = gtDayBounds(getGtLocalDateString(now))
  return new Date(range.end).getTime() < todayStart.getTime()
}

export function ttlForOrdersRange(range, now = new Date()) {
  if (isHistoricalClosedRange(range, now)) return CACHE_TTL.REPORT_HISTORICAL
  return CACHE_TTL.REPORT_TODAY
}

export function ttlForReportFilters(filters = {}, now = new Date()) {
  const preset = filters.preset || "custom"
  if (preset === "today" || preset === "yesterday") return CACHE_TTL.REPORT_TODAY
  const range = filtersReportRange(filters, now)
  if (isHistoricalClosedRange(range, now)) return CACHE_TTL.REPORT_HISTORICAL
  if (isRangeIncludingOperationalToday(range, now)) return CACHE_TTL.REPORT_TODAY
  return CACHE_TTL.REPORT_TODAY
}

export function ttlForOperationalReport(filters = {}, now = new Date()) {
  const preset = filters.preset || "today"
  if (preset === "today") return CACHE_TTL.REPORT_OPERATIONAL
  const range = filtersReportRange(filters, now)
  if (isHistoricalClosedRange(range, now)) return CACHE_TTL.REPORT_HISTORICAL
  return CACHE_TTL.REPORT_INVENTORY_ALERTS
}

export function ttlForExecutiveDashboard() {
  return CACHE_TTL.REPORT_EXECUTIVE_MIXED
}

export function ttlForReportsTab(tab) {
  if (tab === "executive") return CACHE_TTL.REPORT_EXECUTIVE_MIXED
  if (tab === "inventory") return CACHE_TTL.REPORT_INVENTORY_ALERTS
  if (tab === "fixedCosts" || tab === "goals" || tab === "payroll") return CACHE_TTL.REPORT_HISTORICAL
  return CACHE_TTL.REPORT_TODAY
}

function filtersReportRange(filters = {}, now = new Date()) {
  const preset = filters.preset || "custom"
  if (filters.start && filters.end) {
    return {
      start: new Date(`${filters.start}T00:00:00.000${GT_UTC_OFFSET}`).toISOString(),
      end: new Date(`${filters.end}T23:59:59.999${GT_UTC_OFFSET}`).toISOString()
    }
  }
  if (preset === "today") {
    const bounds = gtDayBounds(getGtLocalDateString(now))
    return { start: bounds.start.toISOString(), end: bounds.end.toISOString() }
  }
  if (preset === "yesterday") {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const bounds = gtDayBounds(getGtLocalDateString(yesterday))
    return { start: bounds.start.toISOString(), end: bounds.end.toISOString() }
  }
  if (preset === "month") {
    const gtDate = getGtLocalDateString(now)
    const [year, month] = gtDate.split("-").map(Number)
    const start = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000${GT_UTC_OFFSET}`)
    const endDay = new Date(year, month, 0).getDate()
    const end = new Date(`${year}-${String(month).padStart(2, "0")}-${String(endDay).padStart(2, "0")}T23:59:59.999${GT_UTC_OFFSET}`)
    return { start: start.toISOString(), end: end.toISOString() }
  }
  return { start: gtDayBounds(getGtLocalDateString(now)).start.toISOString(), end: now.toISOString() }
}

export function ordersRangeCacheKey(range) {
  return `${CACHE_KEYS.ORDERS_RANGE_PREFIX}${range.start}|${range.end}`
}

export function ordersFiltersCacheKey(filters = {}) {
  return `${CACHE_KEYS.ORDERS_FILTERS_PREFIX}${stableReportFiltersKey(filters)}`
}

export function reportFiltersCacheKey(prefix, filters = {}) {
  return `${prefix}${stableReportFiltersKey(filters)}`
}

export function operationalAlertsBundleCacheKey(filters = {}) {
  return `${CACHE_KEYS.OPERATIONAL_ALERTS_BUNDLE_PREFIX}${stableReportFiltersKey(filters)}`
}

export function unitsItemCacheKey(itemId) {
  return `${CACHE_KEYS.UNITS_ITEM_PREFIX}${itemId}`
}
