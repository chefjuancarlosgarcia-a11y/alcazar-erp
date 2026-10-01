export const BALANCE_SHEET_SECTION_ORDER = [
  "current_asset",
  "noncurrent_asset",
  "current_liability",
  "noncurrent_liability",
  "equity"
]

export const BALANCE_SHEET_SECTION_LABELS = {
  current_asset: "Activo corriente",
  noncurrent_asset: "Activo no corriente",
  current_liability: "Pasivo corriente",
  noncurrent_liability: "Pasivo no corriente",
  equity: "Patrimonio"
}

export const BALANCE_SHEET_SECTIONS_BY_TYPE = {
  asset: ["current_asset", "noncurrent_asset"],
  liability: ["current_liability", "noncurrent_liability"],
  equity: ["equity"]
}

export const BALANCE_SHEET_UNCLASSIFIED_ACCOUNT_WARNING =
  "La cuenta podrá recibir movimientos, pero el Balance General permanecerá incompleto hasta clasificarla."

export const BALANCE_SHEET_PROVISIONAL_LABEL = "Balance provisional"

export const BALANCE_SHEET_COMPLETE_LABEL = "Balance General"

export const BALANCE_SHEET_ACCUMULATED_LABEL = "Resultado acumulado pendiente de cierre"

export const BALANCE_SHEET_RPC_UNAVAILABLE =
  "El Balance General no está disponible en este momento."

export const BALANCE_SHEET_MIGRATION_HINT =
  "El Balance General no está disponible en este momento. Contacte al administrador."

export const BALANCE_SHEET_INVALID_METADATA_MESSAGE =
  "Los metadatos del Balance General son inválidos."

export const BALANCE_SHEET_CUTOFF_REQUIRED_MESSAGE = "La fecha de corte es obligatoria."

export const BALANCE_SHEET_DIMENSION_NOTE =
  "El filtro de sucursal o centro de costo puede descuadrar el balance porque excluye líneas de contrapartida."

export const BALANCE_SHEET_CLASSIFIED_NOTE =
  "Los subtotales clasificados no incluyen las cuentas sin sección. La diferencia se calcula con la ecuación de control."

export const BALANCE_SHEET_MAX_ACCOUNTS = 2000

export const BALANCE_SHEET_SCOPE_LABELS = {
  global: "Toda la empresa",
  branch: "Sucursal",
  cost_center: "Centro de costo",
  branch_and_cost_center: "Sucursal y centro de costo"
}

export function balanceSheetSectionsFor(financialType, accountKind) {
  if (accountKind !== "detail") return []
  return BALANCE_SHEET_SECTIONS_BY_TYPE[financialType] || []
}

export function defaultCutoffDate(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}
