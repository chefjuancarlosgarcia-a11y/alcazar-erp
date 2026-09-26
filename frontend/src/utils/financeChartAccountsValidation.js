import {
  ACCOUNT_KINDS,
  FINANCIAL_TYPES,
  IMPORT_FIELD_ALIASES,
  INCOME_STATEMENT_SECTION_LABELS,
  INCOME_STATEMENT_SECTION_ORDER,
  INCOME_STATEMENT_UNCLASSIFIED_ACCOUNT_WARNING,
  NATURAL_BALANCES,
  incomeStatementSectionsFor
} from "./financeChartAccountsConstants.js"

export function normalizeChartAccountCode(value) {
  const text = value == null ? "" : String(value)
  const trimmed = text.trim()
  return trimmed || null
}

export function normalizeImportRow(rawRow = {}) {
  const normalized = {}
  Object.entries(IMPORT_FIELD_ALIASES).forEach(([canonical, aliases]) => {
    const matchKey = Object.keys(rawRow).find((key) => {
      const lower = String(key || "").trim().toLowerCase()
      return aliases.some((alias) => alias.toLowerCase() === lower)
    })
    normalized[canonical] = matchKey != null ? rawRow[matchKey] : ""
  })
  return normalized
}

export function parseAcceptsEntries(value, accountKind) {
  if (accountKind === "header") return false
  const normalized = String(value ?? "").trim().toLowerCase()
  return ["true", "1", "si", "sí", "yes"].includes(normalized)
}

export function wouldImportCycle(code, parentCode, rows) {
  if (!code || !parentCode) return false
  let current = parentCode
  const guard = new Set()
  while (current && guard.size < 64) {
    if (current === code) return true
    guard.add(current)
    const parentRow = rows.find((row) => normalizeChartAccountCode(row.codigo) === current)
    current = parentRow ? normalizeChartAccountCode(parentRow.codigo_padre) : null
  }
  return false
}

export function resolveIncomeStatementSection({ raw, financialType, accountKind }) {
  const text = String(raw ?? "").trim()
  const kind = String(accountKind || "").trim().toLowerCase()
  const type = String(financialType || "").trim().toLowerCase()
  if (!text) {
    if (incomeStatementSectionsFor(type, kind).length) {
      return { section: null, error: null, warning: INCOME_STATEMENT_UNCLASSIFIED_ACCOUNT_WARNING }
    }
    return { section: null, error: null, warning: null }
  }
  const lower = text.toLowerCase()
  const byLabel = Object.entries(INCOME_STATEMENT_SECTION_LABELS).find(([, label]) => label.toLowerCase() === lower)
  const section = INCOME_STATEMENT_SECTION_ORDER.includes(lower) ? lower : (byLabel ? byLabel[0] : null)
  if (!section) {
    return { section: null, error: "Sección del Estado de Resultados desconocida.", warning: null }
  }
  if (kind === "header") {
    return { section: null, error: "Las cuentas acumuladoras no llevan sección del Estado de Resultados.", warning: null }
  }
  if (["asset", "liability", "equity"].includes(type)) {
    return { section: null, error: "Las cuentas de balance no llevan sección del Estado de Resultados.", warning: null }
  }
  if (!incomeStatementSectionsFor(type, kind).includes(section)) {
    return { section: null, error: "La sección del Estado de Resultados no corresponde al tipo financiero.", warning: null }
  }
  return { section, error: null, warning: null }
}

export function validateChartAccountImportRows(rows, existingCodes = []) {
  const errors = []
  const warnings = []
  const seen = new Set()
  const codesInFile = rows
    .map((row) => normalizeChartAccountCode(row.codigo))
    .filter(Boolean)
  const existing = new Set(existingCodes.map((code) => normalizeChartAccountCode(code)).filter(Boolean))

  rows.forEach((rawRow, index) => {
    const rowNumber = index + 1
    const row = normalizeImportRow(rawRow)
    const code = normalizeChartAccountCode(row.codigo)
    const parentCode = normalizeChartAccountCode(row.codigo_padre)
    const financialType = String(row.tipo_financiero || "").trim().toLowerCase()
    const naturalBalance = String(row.naturaleza || "").trim().toLowerCase()
    const accountKind = String(row.tipo_cuenta || "").trim().toLowerCase()
    const rawAcceptsEntries = String(row.acepta_movimientos ?? "").trim().toLowerCase()
    const rowErrors = []

    if (!code) rowErrors.push({ field: "codigo", message: "El código es obligatorio." })
    else if (seen.has(code)) rowErrors.push({ field: "codigo", message: "Código duplicado dentro del archivo." })
    else {
      seen.add(code)
      if (existing.has(code)) rowErrors.push({ field: "codigo", message: "El código ya existe en el catálogo." })
    }

    if (!String(row.nombre || "").trim()) {
      rowErrors.push({ field: "nombre", message: "El nombre es obligatorio." })
    }
    if (!FINANCIAL_TYPES.includes(financialType)) {
      rowErrors.push({ field: "tipo_financiero", message: "Tipo financiero inválido." })
    }
    if (!NATURAL_BALANCES.includes(naturalBalance)) {
      rowErrors.push({ field: "naturaleza", message: "Naturaleza inválida." })
    }
    if (!ACCOUNT_KINDS.includes(accountKind)) {
      rowErrors.push({ field: "tipo_cuenta", message: "Tipo de cuenta inválido." })
    }
    if (accountKind === "header" && ["true", "1", "si", "sí", "yes"].includes(rawAcceptsEntries)) {
      rowErrors.push({ field: "acepta_movimientos", message: "Las cuentas acumuladoras no aceptan movimientos." })
    }
    if (parentCode) {
      if (parentCode === code) {
        rowErrors.push({ field: "codigo_padre", message: "Una cuenta no puede ser su propio padre." })
      } else if (!existing.has(parentCode) && !codesInFile.includes(parentCode)) {
        rowErrors.push({ field: "codigo_padre", message: "La cuenta padre no existe en el archivo ni en el catálogo." })
      } else if (wouldImportCycle(code, parentCode, rows.map(normalizeImportRow))) {
        rowErrors.push({ field: "codigo_padre", message: "La jerarquía del archivo genera un ciclo." })
      }
    }

    if (FINANCIAL_TYPES.includes(financialType) && ACCOUNT_KINDS.includes(accountKind)) {
      const classified = resolveIncomeStatementSection({
        raw: row.seccion_resultados,
        financialType,
        accountKind
      })
      if (classified.error) {
        rowErrors.push({ field: "seccion_resultados", message: classified.error })
      } else if (classified.warning && rowErrors.length === 0) {
        warnings.push({ row_number: rowNumber, field: "seccion_resultados", message: classified.warning })
      }
    }

    rowErrors.forEach((entry) => {
      errors.push({ row_number: rowNumber, ...entry })
    })
  })

  const errorRows = new Set(errors.map((entry) => entry.row_number)).size
  const rowsRead = rows.length
  const validRows = rowsRead - errorRows

  return {
    rows_read: rowsRead,
    valid_rows: validRows,
    error_rows: errorRows,
    new_accounts: errors.length ? 0 : rowsRead,
    duplicates: errors.filter((entry) => /duplicado|ya existe/i.test(entry.message)).length,
    blocking_errors: errors.length > 0,
    errors,
    warnings,
    warning_rows: new Set(warnings.map((entry) => entry.row_number)).size
  }
}

export function sortImportRowsTopologically(rows) {
  const normalized = rows.map(normalizeImportRow)
  const remaining = [...normalized]
  const sorted = []
  const added = new Set()

  while (remaining.length) {
    const index = remaining.findIndex((row) => {
      const parentCode = normalizeChartAccountCode(row.codigo_padre)
      return !parentCode || added.has(parentCode)
    })
    if (index < 0) {
      throw new Error("No se pudo ordenar la jerarquía del archivo.")
    }
    const [row] = remaining.splice(index, 1)
    sorted.push(row)
    added.add(normalizeChartAccountCode(row.codigo))
  }
  return sorted
}
