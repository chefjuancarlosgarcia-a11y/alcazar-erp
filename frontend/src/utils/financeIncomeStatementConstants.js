export const INCOME_STATEMENT_SECTION_ORDER = [
  "operating_income",
  "sales_contra",
  "cost_of_sales",
  "operating_expense_selling",
  "operating_expense_admin",
  "operating_expense_other",
  "other_income",
  "other_expense",
  "income_tax"
]

export const INCOME_STATEMENT_SECTION_LABELS = {
  operating_income: "Ingresos operativos",
  sales_contra: "Devoluciones y descuentos sobre ventas",
  cost_of_sales: "Costo de ventas",
  operating_expense_selling: "Gastos de venta",
  operating_expense_admin: "Gastos administrativos",
  operating_expense_other: "Otros gastos operativos",
  other_income: "Otros ingresos",
  other_expense: "Otros gastos",
  income_tax: "Impuesto sobre la renta"
}

export const INCOME_STATEMENT_SECTIONS_BY_TYPE = {
  income: ["operating_income", "sales_contra", "other_income"],
  cost: ["cost_of_sales"],
  expense: [
    "operating_expense_selling",
    "operating_expense_admin",
    "operating_expense_other",
    "other_expense",
    "income_tax"
  ]
}

export const INCOME_STATEMENT_UNCLASSIFIED_ACCOUNT_WARNING =
  "La cuenta podrá recibir movimientos, pero el Estado de Resultados permanecerá incompleto hasta clasificarla."

export const INCOME_STATEMENT_TAX_NOTE = "Sin cuentas de impuesto clasificadas."

export const INCOME_STATEMENT_PROVISIONAL_LABEL = "Resultado provisional de cuentas clasificadas"

export const INCOME_STATEMENT_RPC_UNAVAILABLE =
  "El Estado de Resultados no está disponible en este momento."

export const INCOME_STATEMENT_MIGRATION_HINT =
  "El Estado de Resultados no está disponible en este momento. Contacte al administrador."

export const INCOME_STATEMENT_INVALID_METADATA_MESSAGE =
  "Los metadatos del Estado de Resultados son inválidos."

export const INCOME_STATEMENT_DIMENSION_NOTE =
  "El filtro de sucursal o centro de costo muestra solo las líneas de ese alcance. No representa necesariamente el resultado de toda la empresa."

export const INCOME_STATEMENT_MAX_ACCOUNTS = 2000

export const INCOME_STATEMENT_SCOPE_LABELS = {
  global: "Toda la empresa",
  branch: "Sucursal",
  cost_center: "Centro de costo",
  branch_and_cost_center: "Sucursal y centro de costo"
}

export function incomeStatementSectionsFor(financialType, accountKind) {
  if (accountKind !== "detail") return []
  return INCOME_STATEMENT_SECTIONS_BY_TYPE[financialType] || []
}
