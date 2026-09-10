import {
  GENERAL_JOURNAL_DEFAULT_PAGE_SIZE,
  GENERAL_JOURNAL_MAX_EXPORT_ROWS,
  GENERAL_JOURNAL_MAX_PAGE_SIZE
} from "./financeGeneralJournalConstants.js"
import { roundMoney } from "./financeJournalValidation.js"

export function safeGeneralJournalCount(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.floor(parsed)
}

export function safeGeneralJournalPage(value, fallback = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.floor(parsed)
}

export function safeGeneralJournalPageSize(value, fallback = GENERAL_JOURNAL_DEFAULT_PAGE_SIZE) {
  return clampPageSize(safeGeneralJournalCount(value, fallback) || fallback)
}

export function resolveGeneralJournalPageSize(report, appliedFilters = {}) {
  if (appliedFilters.pageSize != null && appliedFilters.pageSize !== "") {
    return safeGeneralJournalPageSize(appliedFilters.pageSize)
  }
  if (report?.pageSize != null && report.pageSize !== "") {
    return safeGeneralJournalPageSize(report.pageSize)
  }
  return GENERAL_JOURNAL_DEFAULT_PAGE_SIZE
}

export function formatGeneralJournalSummary(totalRows, totalEntries) {
  const lines = safeGeneralJournalCount(totalRows, 0)
  const entries = safeGeneralJournalCount(totalEntries, 0)
  const lineWord = lines === 1 ? "línea" : "líneas"
  const entryWord = entries === 1 ? "partida" : "partidas"
  return `${lines} ${lineWord} · ${entries} ${entryWord}`
}

export function validateGeneralJournalDateRange(fromDate, toDate) {
  if (!fromDate || !toDate) return { ok: true, message: "" }
  if (fromDate > toDate) {
    return { ok: false, message: "La fecha desde no puede ser posterior a la fecha hasta." }
  }
  return { ok: true, message: "" }
}

export function normalizeGeneralJournalFilters(filters = {}) {
  return {
    fromDate: filters.fromDate || null,
    toDate: filters.toDate || null,
    periodId: filters.periodId || null,
    branchId: filters.branchId || null,
    costCenterId: filters.costCenterId || null,
    accountId: filters.accountId || null,
    search: filters.search?.trim() || null,
    page: Math.max(1, Number(filters.page) || 1),
    pageSize: clampPageSize(filters.pageSize),
    snapshotAt: filters.snapshotAt || null
  }
}

export function clampPageSize(value) {
  const parsed = Number(value) || GENERAL_JOURNAL_DEFAULT_PAGE_SIZE
  return Math.min(GENERAL_JOURNAL_MAX_PAGE_SIZE, Math.max(1, parsed))
}

export function generalJournalRpcParams(filters = {}) {
  const normalized = normalizeGeneralJournalFilters(filters)
  return {
    p_from_date: normalized.fromDate,
    p_to_date: normalized.toDate,
    p_period_id: normalized.periodId,
    p_branch_id: normalized.branchId,
    p_cost_center_id: normalized.costCenterId,
    p_account_id: normalized.accountId,
    p_search: normalized.search,
    p_page: normalized.page,
    p_page_size: normalized.pageSize,
    p_snapshot_at: normalized.snapshotAt
  }
}

export function mapGeneralJournalRow(row) {
  if (!row || typeof row !== "object") return null
  return {
    lineId: row.line_id,
    entryId: row.entry_id,
    entryDate: row.entry_date,
    entryNumber: row.entry_number || "",
    entryReference: row.entry_reference || "",
    entryDescription: row.entry_description || "",
    lineNumber: Number(row.line_number || 0),
    accountId: row.account_id,
    accountCode: row.account_code || "",
    accountName: row.account_name || "",
    lineDescription: row.line_description || "",
    lineReference: row.line_reference || "",
    branchId: row.branch_id,
    branchCode: row.branch_code || "",
    branchName: row.branch_name || "",
    costCenterId: row.cost_center_id,
    costCenterCode: row.cost_center_code || "",
    costCenterName: row.cost_center_name || "",
    debit: roundMoney(row.debit),
    credit: roundMoney(row.credit),
    isReversal: Boolean(row.is_reversal),
    reversalOfId: row.reversal_of_id || null,
    reversalOfEntryNumber: row.reversal_of_entry_number || "",
    reversedByEntryId: row.reversed_by_entry_id || null
  }
}

export function mapGeneralJournalResponse(data) {
  const payload = data && typeof data === "object" ? data : {}
  const rows = Array.isArray(payload.rows) ? payload.rows.map(mapGeneralJournalRow).filter(Boolean) : []
  const totalDebit = roundMoney(payload.total_debit)
  const totalCredit = roundMoney(payload.total_credit)
  const difference = roundMoney(payload.difference ?? totalDebit - totalCredit)
  return {
    rows,
    totalRows: safeGeneralJournalCount(payload.total_rows, 0),
    totalEntries: safeGeneralJournalCount(payload.total_entries, 0),
    totalDebit,
    totalCredit,
    difference,
    page: safeGeneralJournalPage(payload.page, 1),
    pageSize: safeGeneralJournalPageSize(payload.page_size),
    totalPages: safeGeneralJournalCount(payload.total_pages, 0),
    snapshotAt: payload.snapshot_at || null,
    isBalanced: Math.abs(difference) < 0.005
  }
}

export function groupGeneralJournalRows(rows) {
  const groups = []
  const byEntry = new Map()
  for (const row of rows) {
    if (!byEntry.has(row.entryId)) {
      const group = {
        entryId: row.entryId,
        entryDate: row.entryDate,
        entryNumber: row.entryNumber,
        entryReference: row.entryReference,
        entryDescription: row.entryDescription,
        isReversal: row.isReversal,
        reversalOfEntryNumber: row.reversalOfEntryNumber,
        reversedByEntryId: row.reversedByEntryId,
        lines: []
      }
      byEntry.set(row.entryId, group)
      groups.push(group)
    }
    byEntry.get(row.entryId).lines.push(row)
  }
  return groups
}

export function neutralizeCsvFormula(value) {
  const text = String(value ?? "")
  if (/^[=+\-@\t\r]/.test(text)) {
    return `'${text}`
  }
  return text
}

export function escapeCsvCell(value) {
  const neutral = neutralizeCsvFormula(value)
  const text = String(neutral ?? "")
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export function formatGeneralJournalMoney(value) {
  return roundMoney(value).toFixed(2)
}

export const GENERAL_JOURNAL_CSV_HEADERS = [
  "Fecha",
  "Número de partida",
  "Referencia partida",
  "Descripción partida",
  "Código de cuenta",
  "Nombre de cuenta",
  "Descripción línea",
  "Sucursal",
  "Centro de costo",
  "Debe (Q.)",
  "Haber (Q.)",
  "Reversión",
  "Partida original",
  "Estado del balance",
  "Diferencia (Q.)"
]

export const GENERAL_JOURNAL_CSV_COLUMN_COUNT = GENERAL_JOURNAL_CSV_HEADERS.length

function buildGeneralJournalMovementRow(row) {
  return [
    row.entryDate,
    row.entryNumber,
    row.entryReference,
    row.entryDescription,
    row.accountCode,
    row.accountName,
    row.lineDescription || row.lineReference,
    row.branchName || row.branchCode,
    row.costCenterName || row.costCenterCode,
    formatGeneralJournalMoney(row.debit),
    formatGeneralJournalMoney(row.credit),
    row.isReversal ? "Sí" : "No",
    row.reversalOfEntryNumber,
    "",
    ""
  ]
}

function buildGeneralJournalTotalsRow(totals) {
  return [
    "Totales",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    formatGeneralJournalMoney(totals.totalDebit),
    formatGeneralJournalMoney(totals.totalCredit),
    "",
    "",
    totals.isBalanced ? "Cuadrado" : "Diferencia",
    formatGeneralJournalMoney(totals.difference)
  ]
}

export function buildGeneralJournalCsv(rows, totals = null) {
  const lines = [GENERAL_JOURNAL_CSV_HEADERS.map(escapeCsvCell).join(",")]
  for (const row of rows) {
    lines.push(buildGeneralJournalMovementRow(row).map(escapeCsvCell).join(","))
  }
  if (totals) {
    lines.push("")
    lines.push(buildGeneralJournalTotalsRow(totals).map(escapeCsvCell).join(","))
  }
  return `\uFEFF${lines.join("\r\n")}`
}

export function canExportGeneralJournal(totalRows) {
  if (totalRows > GENERAL_JOURNAL_MAX_EXPORT_ROWS) {
    return {
      ok: false,
      message: `El resultado filtrado tiene ${totalRows} líneas y supera el límite de exportación (${GENERAL_JOURNAL_MAX_EXPORT_ROWS}). Acote los filtros.`
    }
  }
  return { ok: true, message: "" }
}

export async function fetchAllGeneralJournalRows(fetchPage, filters, totalRows, snapshotAt = null) {
  const guard = canExportGeneralJournal(totalRows)
  if (!guard.ok) {
    return { ok: false, error: guard.message, rows: [], totals: null, snapshotAt: null }
  }

  const pageSize = Math.min(GENERAL_JOURNAL_MAX_PAGE_SIZE, GENERAL_JOURNAL_MAX_EXPORT_ROWS)
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize))
  const rows = []
  let effectiveSnapshot = snapshotAt
  let exportTotals = null

  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchPage({
      ...filters,
      page,
      pageSize,
      snapshotAt: effectiveSnapshot
    })
    if (result.error) {
      return { ok: false, error: result.error, rows: [], totals: null, snapshotAt: effectiveSnapshot }
    }
    const payload = result.data
    if (page === 1) {
      effectiveSnapshot = payload?.snapshotAt || effectiveSnapshot
      exportTotals = {
        totalDebit: payload?.totalDebit ?? 0,
        totalCredit: payload?.totalCredit ?? 0,
        difference: payload?.difference ?? 0,
        isBalanced: payload?.isBalanced ?? false,
        totalRows: payload?.totalRows ?? totalRows
      }
    }
    rows.push(...(payload?.rows || []))
    if (rows.length >= (exportTotals?.totalRows ?? totalRows)) break
  }

  return { ok: true, error: "", rows, totals: exportTotals, snapshotAt: effectiveSnapshot }
}
