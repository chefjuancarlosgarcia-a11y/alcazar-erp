import { centsToDecimalNumber, parseAmountToCents } from "./financeJournalAmounts.js"
import { escapeCsvCell } from "./financeGeneralJournalUtils.js"
import { resolveGeneralLedgerWindow } from "./financeGeneralLedgerUtils.js"
import {
  TRIAL_BALANCE_CSV_HEADERS,
  TRIAL_BALANCE_INVALID_METADATA_MESSAGE,
  TRIAL_BALANCE_MAX_EXPORT_ROWS,
  TRIAL_BALANCE_MAX_PAGE_SIZE,
  TRIAL_BALANCE_SEARCH_EXPORT_NOTE,
  TRIAL_BALANCE_TOTALS_NOTE
} from "./financeTrialBalanceConstants.js"

export function validateTrialBalanceQuery({ fromDate, toDate, period }) {
  return resolveGeneralLedgerWindow({ fromDate, toDate, period })
}

export function trialBalanceScopeKey({ branchId, costCenterId } = {}) {
  if (branchId && costCenterId) return "branch_and_cost_center"
  if (branchId) return "branch"
  if (costCenterId) return "cost_center"
  return "global"
}

function readAmount(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  if (normalized.startsWith("-")) return null
  const parsed = parseAmountToCents(normalized)
  if (!parsed.ok) return null
  return centsToDecimalNumber(parsed.cents)
}

function readSignedDifference(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  const negative = normalized.startsWith("-")
  const magnitude = negative ? normalized.slice(1) : normalized
  if (!magnitude) return null
  const parsed = parseAmountToCents(magnitude)
  if (!parsed.ok) return null
  const cents = negative ? -parsed.cents : parsed.cents
  return centsToDecimalNumber(cents)
}

function readCount(value) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 0 || !Number.isSafeInteger(value)) return null
    return value
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const number = Number(value.trim())
    if (!Number.isSafeInteger(number)) return null
    return number
  }
  return null
}

function invalidTrialMetadata() {
  return { ok: false, message: TRIAL_BALANCE_INVALID_METADATA_MESSAGE }
}

function mapTrialBalanceRow(row) {
  if (!row || typeof row !== "object" || !row.account_id || !row.code) return null
  const amounts = [
    readAmount(row.opening_debit),
    readAmount(row.opening_credit),
    readAmount(row.period_debit),
    readAmount(row.period_credit),
    readAmount(row.closing_debit),
    readAmount(row.closing_credit)
  ]
  if (amounts.some((value) => value === null)) return null
  const [openingDebit, openingCredit, periodDebit, periodCredit, closingDebit, closingCredit] = amounts
  if ((openingDebit > 0 && openingCredit > 0) || (closingDebit > 0 && closingCredit > 0)) return null
  const movementCount = readCount(row.movement_count)
  if (movementCount === null) return null
  return {
    accountId: row.account_id,
    code: row.code,
    name: row.name || "",
    naturalBalance: row.natural_balance === "credit" ? "credit" : "debit",
    parentId: row.parent_id || null,
    parentCode: row.parent_code || "",
    isActive: row.is_active !== false,
    acceptsEntries: row.accepts_entries !== false,
    openingDebit,
    openingCredit,
    periodDebit,
    periodCredit,
    closingDebit,
    closingCredit,
    openingContrary: Boolean(row.opening_contrary),
    closingContrary: Boolean(row.closing_contrary),
    movementCount
  }
}

export function mapTrialBalanceResponse(data) {
  const payload = data && typeof data === "object" ? data : null
  if (!payload || typeof payload.is_square !== "boolean") return invalidTrialMetadata()
  const openingDebitTotal = readAmount(payload.opening_debit_total)
  const openingCreditTotal = readAmount(payload.opening_credit_total)
  const periodDebitTotal = readAmount(payload.period_debit_total)
  const periodCreditTotal = readAmount(payload.period_credit_total)
  const closingDebitTotal = readAmount(payload.closing_debit_total)
  const closingCreditTotal = readAmount(payload.closing_credit_total)
  const openingDifference = readSignedDifference(payload.opening_difference)
  const periodDifference = readSignedDifference(payload.period_difference)
  const closingDifference = readSignedDifference(payload.closing_difference)
  const page = readCount(payload.page)
  const pageSize = readCount(payload.page_size)
  const totalPages = readCount(payload.total_pages)
  const accountCount = readCount(payload.account_count)
  const matchCount = readCount(payload.match_count)
  if ([
    openingDebitTotal, openingCreditTotal, periodDebitTotal, periodCreditTotal,
    closingDebitTotal, closingCreditTotal, openingDifference, periodDifference, closingDifference,
    page, pageSize, totalPages, accountCount, matchCount
  ].some((value) => value === null)) return invalidTrialMetadata()
  if (typeof payload.snapshot_at !== "string" || !Number.isFinite(Date.parse(payload.snapshot_at))) {
    return invalidTrialMetadata()
  }
  if (page < 1 || pageSize < 1 || pageSize > TRIAL_BALANCE_MAX_PAGE_SIZE) return invalidTrialMetadata()
  if (matchCount > accountCount) return invalidTrialMetadata()
  const rows = Array.isArray(payload.rows) ? payload.rows.map(mapTrialBalanceRow) : [null]
  if (rows.some((row) => !row)) return invalidTrialMetadata()
  const expectedPages = matchCount === 0 ? 0 : Math.ceil(matchCount / pageSize)
  if (totalPages !== expectedPages) return invalidTrialMetadata()
  if (matchCount === 0) {
    if (page !== 1 || rows.length !== 0) return invalidTrialMetadata()
  } else if (page > totalPages || rows.length === 0 || rows.length > pageSize) {
    return invalidTrialMetadata()
  }
  return {
    ok: true,
    report: {
      scope: payload.scope || "global",
      effectiveFrom: payload.effective_from || null,
      effectiveTo: payload.effective_to || null,
      includeZeroAccounts: Boolean(payload.include_zero_accounts),
      openingDebitTotal,
      openingCreditTotal,
      periodDebitTotal,
      periodCreditTotal,
      closingDebitTotal,
      closingCreditTotal,
      openingDifference,
      periodDifference,
      closingDifference,
      isSquare: payload.is_square,
      accountCount,
      matchCount,
      searchApplied: Boolean(payload.search_applied),
      rows,
      page,
      pageSize,
      totalPages,
      snapshotAt: payload.snapshot_at.trim()
    }
  }
}

export function trialBalanceRpcParams(filters = {}) {
  return {
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_period_id: filters.periodId || null,
    p_branch_id: filters.branchId || null,
    p_cost_center_id: filters.costCenterId || null,
    p_search: filters.search?.trim() || null,
    p_include_zero_accounts: Boolean(filters.includeZeroAccounts),
    p_page: Math.max(1, Number(filters.page) || 1),
    p_page_size: Math.min(TRIAL_BALANCE_MAX_PAGE_SIZE, Math.max(1, Number(filters.pageSize) || 50)),
    p_snapshot_at: filters.snapshotAt || null
  }
}

export function resolveTrialBalanceScreen({ canView, loading, error, report }) {
  if (!canView) return { state: "forbidden", showReport: false }
  if (loading) return { state: "loading", showReport: false }
  if (error) return { state: "error", showReport: false }
  if (!report) return { state: "idle", showReport: false }
  if (Number(report.matchCount) === 0) return { state: "empty", showReport: true }
  if (report.isSquare === false) return { state: "unbalanced", showReport: true }
  return { state: "ready", showReport: true }
}

function formatMoneyCell(value) {
  return Number(value).toFixed(2)
}

function csvRow(values) {
  return values.map((value) => escapeCsvCell(value)).join(",")
}

export function buildTrialBalanceCsv({ rows, report }) {
  const lines = []
  if (report.searchApplied) lines.push(csvRow([TRIAL_BALANCE_SEARCH_EXPORT_NOTE]))
  lines.push(csvRow([TRIAL_BALANCE_TOTALS_NOTE]))
  lines.push(csvRow(TRIAL_BALANCE_CSV_HEADERS))
  for (const row of rows) {
    lines.push(csvRow([
      row.code,
      row.name,
      row.naturalBalance === "credit" ? "Acreedora" : "Deudora",
      formatMoneyCell(row.openingDebit),
      formatMoneyCell(row.openingCredit),
      formatMoneyCell(row.periodDebit),
      formatMoneyCell(row.periodCredit),
      formatMoneyCell(row.closingDebit),
      formatMoneyCell(row.closingCredit),
      row.openingContrary ? "Sí" : "No",
      row.closingContrary ? "Sí" : "No",
      String(row.movementCount)
    ]))
  }
  lines.push(csvRow([
    "Totales del alcance completo",
    TRIAL_BALANCE_TOTALS_NOTE,
    report.isSquare ? "Cuadrada" : "Descuadrada",
    formatMoneyCell(report.openingDebitTotal),
    formatMoneyCell(report.openingCreditTotal),
    formatMoneyCell(report.periodDebitTotal),
    formatMoneyCell(report.periodCreditTotal),
    formatMoneyCell(report.closingDebitTotal),
    formatMoneyCell(report.closingCreditTotal),
    "",
    "",
    ""
  ]))
  lines.push(csvRow([
    "Diferencias",
    "Debe menos haber del alcance completo",
    "",
    formatMoneyCell(report.openingDifference),
    "",
    formatMoneyCell(report.periodDifference),
    "",
    formatMoneyCell(report.closingDifference),
    "",
    "",
    "",
    ""
  ]))
  return `\uFEFF${lines.join("\r\n")}`
}

export function canExportTrialBalance(rowCount) {
  if (rowCount > TRIAL_BALANCE_MAX_EXPORT_ROWS) {
    return {
      ok: false,
      message: `La exportación tiene ${rowCount} cuentas y supera el límite de ${TRIAL_BALANCE_MAX_EXPORT_ROWS}. Acote los filtros.`
    }
  }
  return { ok: true, message: "" }
}

export async function fetchAllTrialBalanceRows(fetchPage, filters, matchCount, snapshotAt) {
  const guard = canExportTrialBalance(matchCount)
  if (!guard.ok) return { ok: false, error: guard.message, rows: [] }
  const pageSize = TRIAL_BALANCE_MAX_PAGE_SIZE
  const totalPages = matchCount === 0 ? 0 : Math.ceil(matchCount / pageSize)
  const rows = []
  let effectiveSnapshot = snapshotAt
  for (let page = 1; page <= totalPages; page += 1) {
    const result = await fetchPage({ ...filters, page, pageSize, snapshotAt: effectiveSnapshot })
    if (result.error || !result.data) {
      return { ok: false, error: result.error || TRIAL_BALANCE_INVALID_METADATA_MESSAGE, rows: [] }
    }
    if (!effectiveSnapshot) effectiveSnapshot = result.data.snapshotAt
    if (result.data.snapshotAt !== effectiveSnapshot) {
      return { ok: false, error: "El corte del reporte cambió durante la exportación. Actualice la balanza e intente de nuevo.", rows: [] }
    }
    rows.push(...result.data.rows)
  }
  return { ok: true, rows, error: "" }
}
