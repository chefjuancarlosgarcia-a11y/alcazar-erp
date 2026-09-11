export const FINANCIAL_TYPES = ["asset", "liability", "equity", "income", "cost", "expense"]

export const NATURAL_BALANCES = ["debit", "credit"]

export const ACCOUNT_KINDS = ["header", "detail"]

export const FINANCIAL_TYPE_LABELS = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio",
  income: "Ingreso",
  cost: "Costo",
  expense: "Gasto"
}

export const NATURAL_BALANCE_LABELS = {
  debit: "Deudora",
  credit: "Acreedora"
}

export const ACCOUNT_KIND_LABELS = {
  header: "Acumuladora",
  detail: "Detalle"
}

export const CSV_TEMPLATE_HEADERS = [
  "codigo",
  "nombre",
  "codigo_padre",
  "tipo_financiero",
  "naturaleza",
  "tipo_cuenta",
  "acepta_movimientos",
  "descripcion"
]

export const CSV_TEMPLATE_SAMPLE = [
  ["1", "Activos", "", "asset", "debit", "header", "false", "Grupo principal"],
  ["1.01", "Caja", "1", "asset", "debit", "detail", "true", "Caja general"]
]

export const IMPORT_FIELD_ALIASES = {
  codigo: ["codigo", "código", "code"],
  nombre: ["nombre", "name"],
  codigo_padre: ["codigo_padre", "codigo padre", "parent_code", "padre"],
  tipo_financiero: ["tipo_financiero", "tipo financiero", "financial_type"],
  naturaleza: ["naturaleza", "natural_balance"],
  tipo_cuenta: ["tipo_cuenta", "tipo cuenta", "account_kind"],
  acepta_movimientos: ["acepta_movimientos", "acepta movimientos", "accepts_entries"],
  descripcion: ["descripcion", "descripción", "description"]
}
