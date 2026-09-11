import {
  ACCOUNT_KINDS,
  FINANCIAL_TYPES,
  IMPORT_FIELD_ALIASES,
  NATURAL_BALANCES
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

export function validateChartAccountImportRows(rows, existingCodes = []) {
  const errors = []
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
    errors
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
