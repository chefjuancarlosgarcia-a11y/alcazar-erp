import { centsToDecimalNumber, parseAmountToCents } from "./financeJournalAmounts.js"
import { escapeCsvCell } from "./financeGeneralJournalUtils.js"
import {
  GENERAL_LEDGER_ACCOUNT_REQUIRED_MESSAGE,
  GENERAL_LEDGER_CSV_HEADERS,
  GENERAL_LEDGER_DATE_ORDER_MESSAGE,
  GENERAL_LEDGER_DEFAULT_PAGE_SIZE,
  GENERAL_LEDGER_EMPTY_INTERSECTION_MESSAGE,
  GENERAL_LEDGER_INVALID_METADATA_MESSAGE,
  GENERAL_LEDGER_MAX_EXPORT_ROWS,
  GENERAL_LEDGER_MAX_PAGE_SIZE,
  GENERAL_LEDGER_SEARCH_EXPORT_NOTE
} from "./financeGeneralLedgerConstants.js"

export function filterReportDetailAccounts(accounts) {
  return (accounts || []).filter((account) => account?.account_kind === "detail")
}

export function reportAccountStatusMarks(account) {
  const marks = []
  if (!account) return marks
  if (account.is_active === false) marks.push("Inactiva")
  if (account.accepts_entries === false) marks.push("No acepta movimientos")
  return marks
}

export function ledgerScopeLabel({ branchId, costCenterId } = {}) {
  if (branchId && costCenterId) return "Mayor por sucursal y centro de costo"
  if (branchId) return "Mayor por sucursal"
  if (costCenterId) return "Mayor por centro de costo"
  return "Mayor global de la cuenta"
}

export function ledgerScopeKey({ branchId, costCenterId } = {}) {
  if (branchId && costCenterId) return "branch_and_cost_center"
  if (branchId) return "branch"
  if (costCenterId) return "cost_center"
  return "global"
}

export function resolveGeneralLedgerWindow({ fromDate = null, toDate = null, period = null } = {}) {
  const from = fromDate || null
  const to = toDate || null
  if (from && to && from > to) {
    return { ok: false, message: GENERAL_LEDGER_DATE_ORDER_MESSAGE }
  }
  if (!period) {
    return { ok: true, effectiveFrom: from, effectiveTo: to, periodId: null }
  }
  const start = period.start_date
  const end = period.end_date
  if (!start || !end || start > end) {
    return { ok: false, message: "El periodo contable no tiene un rango de fechas válido." }
  }
  const effectiveFrom = from && from > start ? from : start
  const effectiveTo = to && to < end ? to : end
  if (effectiveFrom > effectiveTo) {
    return { ok: false, message: GENERAL_LEDGER_EMPTY_INTERSECTION_MESSAGE }
  }
  return { ok: true, effectiveFrom, effectiveTo, periodId: period.id || null }
}

function moneyCents(value) {
  const parsed = parseAmountToCents(value ?? 0)
  if (!parsed.ok) return null
  return parsed.cents
}

function readLedgerAmount(value, { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  const negative = normalized.startsWith("-")
  if (negative && !allowNegative) return null
  const magnitude = negative ? normalized.slice(1) : normalized
  if (!magnitude) return null
  const parsed = parseAmountToCents(magnitude)
  if (!parsed.ok) return null
  const cents = negative ? -parsed.cents : parsed.cents
  return centsToDecimalNumber(cents)
}

function readLedgerCount(value) {
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

function readLedgerSnapshot(value) {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text || !Number.isFinite(Date.parse(text))) return null
  return text
}

export function signedLedgerCents(naturalBalance, debit, credit) {
  const debitCents = moneyCents(debit)
  const creditCents = moneyCents(credit)
  if (debitCents === null || creditCents === null) return null
  if (naturalBalance === "credit") return creditCents - debitCents
  return debitCents - creditCents
}

export function presentLedgerBalance(naturalBalance, signedCents) {
  const cents = typeof signedCents === "bigint" ? signedCents : BigInt(Math.trunc(signedCents))
  if (cents === 0n) {
    return { side: "zero", label: "Cero", contrary: false, signed: 0 }
  }
  const naturalSide = naturalBalance === "credit" ? "credit" : "debit"
  const contrary = cents < 0n
  const side = contrary ? (naturalSide === "debit" ? "credit" : "debit") : naturalSide
  return {
    side,
    label: side === "debit" ? "Deudor" : "Acreedor",
    contrary,
    signed: centsToDecimalNumber(cents)
  }
}

export function compareLedgerRows(left, right) {
  const date = String(left.entryDate || "").localeCompare(String(right.entryDate || ""))
  if (date) return date
  const number = String(left.entryNumber || "").localeCompare(String(right.entryNumber || ""))
  if (number) return number
  const line = Number(left.lineNumber || 0) - Number(right.lineNumber || 0)
  if (line) return line
  return String(left.lineId || "").localeCompare(String(right.lineId || ""))
}

export function buildLedgerBook({ naturalBalance, openingCents = 0, movements = [] }) {
  const ordered = [...movements].sort(compareLedgerRows)
  let running = typeof openingCents === "bigint" ? openingCents : BigInt(openingCents)
  let periodDebit = 0n
  let periodCredit = 0n
  const rows = []
  for (const movement of ordered) {
    const signed = signedLedgerCents(naturalBalance, movement.debit, movement.credit)
    const debitCents = moneyCents(movement.debit)
    const creditCents = moneyCents(movement.credit)
    if (signed === null || debitCents === null || creditCents === null) {
      return { ok: false, message: GENERAL_LEDGER_INVALID_METADATA_MESSAGE }
    }
    running += signed
    periodDebit += debitCents
    periodCredit += creditCents
    const presentation = presentLedgerBalance(naturalBalance, running)
    rows.push({
      ...movement,
      runningBalance: presentation.signed,
      balanceSide: presentation.side,
      balanceSideLabel: presentation.label,
      contraryToNature: presentation.contrary
    })
  }
  const opening = presentLedgerBalance(naturalBalance, openingCents)
  const closing = presentLedgerBalance(naturalBalance, running)
  return {
    ok: true,
    openingBalance: opening.signed,
    openingSide: opening.side,
    openingSideLabel: opening.label,
    openingContrary: opening.contrary,
    rows,
    periodDebit: centsToDecimalNumber(periodDebit),
    periodCredit: centsToDecimalNumber(periodCredit),
    closingBalance: closing.signed,
    closingSide: closing.side,
    closingSideLabel: closing.label,
    closingContrary: closing.contrary
  }
}

export function ledgerRowMatchesSearch(row, search) {
  const query = String(search || "").trim().toLowerCase()
  if (!query) return true
  const fields = [
    row.entryNumber,
    row.entryReference,
    row.lineReference,
    row.entryDescription,
    row.lineDescription
  ]
  return fields.some((value) => String(value || "").toLowerCase().includes(query))
}

export function applyLedgerSearch(book, search) {
  const displayRows = book.rows.filter((row) => ledgerRowMatchesSearch(row, search))
  return {
    ...book,
    displayRows,
    matchCount: displayRows.length,
    movementCount: book.rows.length,
    searchApplied: Boolean(String(search || "").trim())
  }
}

export function clampLedgerPageSize(value) {
  const parsed = Number(value) || GENERAL_LEDGER_DEFAULT_PAGE_SIZE
  return Math.min(GENERAL_LEDGER_MAX_PAGE_SIZE, Math.max(1, Math.floor(parsed)))
}

export function paginateLedgerDisplay(displayRows, page, pageSize) {
  const size = clampLedgerPageSize(pageSize)
  const total = displayRows.length
  const totalPages = total === 0 ? 0 : Math.ceil(total / size)
  const requested = Math.max(1, Math.floor(Number(page) || 1))
  const safePage = totalPages === 0 ? 1 : Math.min(requested, totalPages)
  const start = (safePage - 1) * size
  return {
    rows: displayRows.slice(start, start + size),
    page: safePage,
    pageSize: size,
    totalRows: total,
    totalPages
  }
}

export function buildLedgerEntryHref(entryId) {
  return `/finance?tab=partidas&entry=${entryId}`
}

export function ledgerViewState({ canView, accountId, loading, error, rowCount }) {
  return resolveLedgerScreen({ canView, accountId, loading, error, report: rowCount ? { matchCount: rowCount } : (error || loading || !accountId ? null : { matchCount: 0 }) }).state
}

export function resolveLedgerScreen({ canView, accountId, loading, error, report }) {
  if (!canView) return { state: "forbidden", showReport: false, showBalances: false }
  if (!accountId) return { state: "needs-account", showReport: false, showBalances: false }
  if (loading) return { state: "loading", showReport: false, showBalances: false }
  if (error) return { state: "error", showReport: false, showBalances: false }
  if (!report) return { state: "idle", showReport: false, showBalances: false }
  if (report.account?.id && report.account.id !== accountId) {
    return { state: "stale", showReport: false, showBalances: false }
  }
  if (Number(report.matchCount) === 0) {
    return { state: "empty", showReport: true, showBalances: true }
  }
  return { state: "ready", showReport: true, showBalances: true }
}

export function mapGeneralLedgerRow(row) {
  if (!row || typeof row !== "object") return null
  const runningBalance = readLedgerAmount(row.running_balance, { allowNegative: true })
  const debit = readLedgerAmount(row.debit)
  const credit = readLedgerAmount(row.credit)
  if (runningBalance === null || debit === null || credit === null || !row.entry_id || !row.line_id) {
    return null
  }
  return {
    lineId: row.line_id,
    entryId: row.entry_id,
    entryDate: row.entry_date,
    entryNumber: row.entry_number || "",
    entryReference: row.entry_reference || "",
    entryDescription: row.entry_description || "",
    lineNumber: Number(row.line_number || 0),
    lineDescription: row.line_description || "",
    lineReference: row.line_reference || "",
    accountCode: row.account_code || "",
    accountName: row.account_name || "",
    branchCode: row.branch_code || "",
    branchName: row.branch_name || "",
    costCenterCode: row.cost_center_code || "",
    costCenterName: row.cost_center_name || "",
    debit,
    credit,
    runningBalance,
    balanceSide: row.balance_side || "",
    balanceSideLabel: row.balance_side_label || "",
    contraryToNature: Boolean(row.contrary_to_nature),
    isReversal: Boolean(row.is_reversal),
    reversalOfEntryNumber: row.reversal_of_entry_number || ""
  }
}

function invalidLedgerMetadata() {
  return { ok: false, message: GENERAL_LEDGER_INVALID_METADATA_MESSAGE }
}

export function mapGeneralLedgerResponse(data) {
  const payload = data && typeof data === "object" ? data : null
  if (!payload) return invalidLedgerMetadata()
  const openingBalance = readLedgerAmount(payload.opening_balance, { allowNegative: true })
  const closingBalance = readLedgerAmount(payload.closing_balance, { allowNegative: true })
  const periodDebit = readLedgerAmount(payload.period_debit)
  const periodCredit = readLedgerAmount(payload.period_credit)
  const page = readLedgerCount(payload.page)
  const pageSize = readLedgerCount(payload.page_size)
  const totalPages = readLedgerCount(payload.total_pages)
  const matchCount = readLedgerCount(payload.match_count)
  const movementCount = readLedgerCount(payload.movement_count)
  const snapshotAt = readLedgerSnapshot(payload.snapshot_at)
  if ([openingBalance, closingBalance, periodDebit, periodCredit, page, pageSize, totalPages, matchCount, movementCount, snapshotAt].some((value) => value === null)) {
    return invalidLedgerMetadata()
  }
  if (page < 1 || pageSize < 1 || pageSize > GENERAL_LEDGER_MAX_PAGE_SIZE) return invalidLedgerMetadata()
  if (matchCount > movementCount) return invalidLedgerMetadata()
  const rows = Array.isArray(payload.rows) ? payload.rows.map(mapGeneralLedgerRow) : [null]
  if (rows.some((row) => !row)) return invalidLedgerMetadata()
  const expectedPages = matchCount === 0 ? 0 : Math.ceil(matchCount / pageSize)
  if (totalPages !== expectedPages) return invalidLedgerMetadata()
  if (matchCount === 0) {
    if (page !== 1 || rows.length !== 0) return invalidLedgerMetadata()
  } else if (page > totalPages || rows.length === 0 || rows.length > pageSize) {
    return invalidLedgerMetadata()
  }
  return {
    ok: true,
    report: {
      account: payload.account || null,
      scope: payload.scope || "global",
      effectiveFrom: payload.effective_from || null,
      effectiveTo: payload.effective_to || null,
      openingBalance,
      openingSide: payload.opening_balance_side || "",
      openingContrary: Boolean(payload.opening_contrary),
      periodDebit,
      periodCredit,
      closingBalance,
      closingSide: payload.closing_balance_side || "",
      closingContrary: Boolean(payload.closing_contrary),
      movementCount,
      matchCount,
      searchApplied: Boolean(payload.search_applied),
      rows,
      page,
      pageSize,
      totalPages,
      snapshotAt
    }
  }
}

export function generalLedgerRpcParams(filters = {}) {
  return {
    p_account_id: filters.accountId || null,
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_period_id: filters.periodId || null,
    p_branch_id: filters.branchId || null,
    p_cost_center_id: filters.costCenterId || null,
    p_search: filters.search?.trim() || null,
    p_page: Math.max(1, Number(filters.page) || 1),
    p_page_size: clampLedgerPageSize(filters.pageSize),
    p_snapshot_at: filters.snapshotAt || null
  }
}

export function validateGeneralLedgerQuery({ accountId, fromDate, toDate, period }) {
  if (!accountId) return { ok: false, message: GENERAL_LEDGER_ACCOUNT_REQUIRED_MESSAGE }
  return resolveGeneralLedgerWindow({ fromDate, toDate, period })
}

function formatLedgerMoney(value) {
  return Number(value).toFixed(2)
}

function ledgerSignedCents(value) {
  if (value === null || value === undefined || value === "") return 0n
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  const negative = normalized.startsWith("-")
  const magnitude = negative ? normalized.slice(1) : normalized
  if (!magnitude) return null
  const parsed = parseAmountToCents(magnitude)
  if (!parsed.ok) return null
  return negative ? -parsed.cents : parsed.cents
}

function ledgerCsvSideLabel(naturalBalance, signedAmount) {
  const cents = ledgerSignedCents(signedAmount)
  if (cents === null) return ""
  return presentLedgerBalance(naturalBalance, cents).label
}

function ledgerCsvRow(values) {
  return values.map((value) => escapeCsvCell(value)).join(",")
}

export function buildGeneralLedgerCsv({ rows, report, searchApplied }) {
  const account = report.account || {}
  const lines = []
  if (searchApplied) lines.push(ledgerCsvRow([GENERAL_LEDGER_SEARCH_EXPORT_NOTE]))
  lines.push(ledgerCsvRow(GENERAL_LEDGER_CSV_HEADERS))
  lines.push(ledgerCsvRow([
    "Saldo inicial",
    "",
    "",
    "",
    account.code || "",
    account.name || "",
    "",
    "",
    "",
    "",
    "",
    formatLedgerMoney(report.openingBalance),
    account.natural_balance === "credit" ? "Acreedora" : "Deudora",
    ledgerCsvSideLabel(account.natural_balance, report.openingBalance),
    ""
  ]))
  for (const row of rows) {
    lines.push(ledgerCsvRow([
      row.entryDate,
      row.entryNumber,
      row.entryReference || row.lineReference,
      row.entryDescription,
      row.accountCode || account.code || "",
      row.accountName || account.name || "",
      row.lineDescription,
      row.branchName || row.branchCode,
      row.costCenterName || row.costCenterCode,
      formatLedgerMoney(row.debit),
      formatLedgerMoney(row.credit),
      formatLedgerMoney(row.runningBalance),
      account.natural_balance === "credit" ? "Acreedora" : "Deudora",
      row.balanceSideLabel,
      row.isReversal ? "Sí" : "No"
    ]))
  }
  lines.push(ledgerCsvRow([
    "Totales del periodo",
    "",
    "",
    "Conjunto contable completo, antes de la búsqueda",
    "",
    "",
    "",
    "",
    "",
    formatLedgerMoney(report.periodDebit),
    formatLedgerMoney(report.periodCredit),
    "",
    "",
    "",
    ""
  ]))
  lines.push(ledgerCsvRow([
    "Saldo final",
    "",
    "",
    "Saldo de la cuenta en el alcance consultado, no la suma de coincidencias",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    formatLedgerMoney(report.closingBalance),
    account.natural_balance === "credit" ? "Acreedora" : "Deudora",
    ledgerCsvSideLabel(account.natural_balance, report.closingBalance),
    ""
  ]))
  if (searchApplied) {
    lines.push(ledgerCsvRow([
      "Coincidencias",
      String(report.matchCount ?? rows.length),
      "",
      "Cantidad de filas mostradas por la búsqueda. No es el saldo final.",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ]))
  }
  return `\uFEFF${lines.join("\r\n")}`
}

export function canExportGeneralLedger(rowCount) {
  if (rowCount > GENERAL_LEDGER_MAX_EXPORT_ROWS) {
    return {
      ok: false,
      message: `La exportación tiene ${rowCount} filas y supera el límite de ${GENERAL_LEDGER_MAX_EXPORT_ROWS}. Acote los filtros.`
    }
  }
  return { ok: true, message: "" }
}

export async function fetchAllGeneralLedgerRows(fetchPage, filters, matchCount, snapshotAt, exportPageSize = GENERAL_LEDGER_MAX_PAGE_SIZE) {
  const guard = canExportGeneralLedger(matchCount)
  if (!guard.ok) return { ok: false, error: guard.message, rows: [] }
  const pageSize = Math.min(clampLedgerPageSize(exportPageSize), GENERAL_LEDGER_MAX_EXPORT_ROWS)
  const totalPages = Math.max(1, Math.ceil((matchCount || 0) / pageSize))
  const rows = []
  let effectiveSnapshot = snapshotAt
  for (let page = 1; page <= (matchCount === 0 ? 0 : totalPages); page += 1) {
    const result = await fetchPage({ ...filters, page, pageSize, snapshotAt: effectiveSnapshot })
    if (result.error || !result.data) {
      return { ok: false, error: result.error || GENERAL_LEDGER_INVALID_METADATA_MESSAGE, rows: [] }
    }
    if (!effectiveSnapshot) effectiveSnapshot = result.data.snapshotAt
    if (result.data.snapshotAt !== effectiveSnapshot) {
      return { ok: false, error: "El snapshot del Libro Mayor cambió durante la exportación.", rows: [] }
    }
    rows.push(...result.data.rows)
  }
  return { ok: true, rows, snapshotAt: effectiveSnapshot }
}
