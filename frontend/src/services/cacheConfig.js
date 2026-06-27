/** TTL presets for in-memory query cache (milliseconds). */
export const CACHE_TTL = {
  /** Productos, proveedores, áreas */
  CATALOG: 5 * 60_000,
  /** Roles, unidades, branding */
  REFERENCE: 10 * 60_000,
  /** Catálogo auxiliar en reportes */
  REPORT_CATALOG: 2 * 60_000
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
  CONFIG_PREFIX: "config:",
  BRANDING: "config:branding",
  UNITS_INVENTORY: "units:inventory",
  UNITS_ITEM_PREFIX: "units:item:",
  POS_PRODUCTS_PREFIX: "pos-products:",
  POS_PRODUCTS_ALL: "pos-products:all",
  POS_PRODUCTS_ACTIVE: "pos-products:active",
  POS_PRODUCTS_PRODUCTION: "pos-products:production-ready",
  POS_PRODUCTS_REPORT: "pos-products:report",
  EXECUTIVE_DASHBOARD: "reports:executive-dashboard"
}

export function unitsItemCacheKey(itemId) {
  return `${CACHE_KEYS.UNITS_ITEM_PREFIX}${itemId}`
}
