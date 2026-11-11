import { centsToDecimalNumber, parseAmountToCents } from "./financeJournalAmounts.js"
import { escapeCsvCell } from "./financeGeneralJournalUtils.js"
import {
  BALANCE_SHEET_ACCUMULATED_LABEL,
  BALANCE_SHEET_CLASSIFIED_NOTE,
  BALANCE_SHEET_COMPLETE_LABEL,
  BALANCE_SHEET_CUTOFF_REQUIRED_MESSAGE,
  BALANCE_SHEET_INVALID_METADATA_MESSAGE,
  BALANCE_SHEET_MAX_ACCOUNTS,
  BALANCE_SHEET_PROVISIONAL_LABEL,
  BALANCE_SHEET_SCOPE_LABELS,
  BALANCE_SHEET_SECTION_LABELS,
  BALANCE_SHEET_SECTION_ORDER
} from "./financeBalanceSheetConstants.js"

export function balanceSheetScopeKey({ branchId, costCenterId } = {}) {
  if (branchId && costCenterId) return "branch_and_cost_center"
  if (branchId) return "branch"
  if (costCenterId) return "cost_center"
  return "global"
}

export function validateBalanceSheetQuery({ cutoffDate }) {
  if (!cutoffDate) return { ok: false, message: BALANCE_SHEET_CUTOFF_REQUIRED_MESSAGE }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
    return { ok: false, message: BALANCE_SHEET_CUTOFF_REQUIRED_MESSAGE }
  }
  return { ok: true }
}

function invalid() {
  return { ok: false, message: BALANCE_SHEET_INVALID_METADATA_MESSAGE }
}

function readSigned(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  const negative = normalized.startsWith("-")
  const magnitude = negative ? normalized.slice(1) : normalized
  if (!magnitude) return null
  const parsed = parseAmountToCents(magnitude)
  if (!parsed.ok) return null
  return centsToDecimalNumber(negative ? -parsed.cents : parsed.cents)
}

function readUnsigned(value) {
  const signed = readSigned(value)
  if (signed === null || signed < 0) return null
  return signed
}

function readCount(value) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return null
  return number
}

function near(left, right) {
  return left !== null && right !== null && Math.abs(left - right) < 0.005
}

function mapAccount(raw) {
  if (!raw || typeof raw !== "object") return null
  const debit = readUnsigned(raw.debit)
  const credit = readUnsigned(raw.credit)
  const amount = readSigned(raw.amount)
  const naturalSigned = readSigned(raw.natural_signed)
  const movementCount = readCount(raw.movement_count)
  if (debit === null || credit === null || amount === null || naturalSigned === null || movementCount === null) return null
  if (typeof raw.code !== "string" || typeof raw.name !== "string" || typeof raw.account_id !== "string") return null
  if (typeof raw.is_active !== "boolean" || typeof raw.contrary !== "boolean") return null
  if (raw.contrary !== naturalSigned < -0.004) return null
  return {
    accountId: raw.account_id,
    code: raw.code,
    name: raw.name,
    financialType: raw.financial_type,
    naturalBalance: raw.natural_balance,
    section: raw.balance_sheet_section,
    isActive: raw.is_active,
    parentCode: raw.parent_code || null,
    debit,
    credit,
    amount,
    naturalSigned,
    contrary: raw.contrary,
    movementCount
  }
}

export function mapBalanceSheetResponse(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return invalid()
  const payload = data
  if (typeof payload.cutoff_date !== "string" || typeof payload.snapshot_at !== "string") return invalid()
  if (typeof payload.report_complete !== "boolean" || typeof payload.is_square !== "boolean") return invalid()
  if (!Array.isArray(payload.sections) || payload.sections.length !== BALANCE_SHEET_SECTION_ORDER.length) return invalid()
  if (!Array.isArray(payload.unclassified_accounts) || !Array.isArray(payload.warnings)) return invalid()

  const classifiedAssets = readSigned(payload.classified_total_assets)
  const classifiedLiabilities = readSigned(payload.classified_total_liabilities)
  const classifiedEquity = readSigned(payload.classified_registered_equity)
  const accumulated = readSigned(payload.accumulated_result)
  const classifiedTotalEquity = readSigned(payload.classified_total_equity)
  const classifiedLiabilitiesAndEquity = readSigned(payload.classified_total_liabilities_and_equity)
  const classifiedDifference = readSigned(payload.classified_difference)
  const controlAssets = readSigned(payload.control_total_assets)
  const controlLiabilities = readSigned(payload.control_total_liabilities)
  const controlRegisteredEquity = readSigned(payload.control_registered_equity)
  const controlTotalEquity = readSigned(payload.control_total_equity)
  const controlLiabilitiesAndEquity = readSigned(payload.control_total_liabilities_and_equity)
  const difference = readSigned(payload.difference)
  const currentAssets = readSigned(payload.current_assets_total)
  const noncurrentAssets = readSigned(payload.noncurrent_assets_total)
  const currentLiabilities = readSigned(payload.current_liabilities_total)
  const noncurrentLiabilities = readSigned(payload.noncurrent_liabilities_total)
  const unclassifiedAssets = readSigned(payload.unclassified_asset_amount)
  const unclassifiedLiabilities = readSigned(payload.unclassified_liability_amount)
  const unclassifiedEquity = readSigned(payload.unclassified_equity_amount)
  const unclassifiedDebit = readUnsigned(payload.unclassified_debit)
  const unclassifiedCredit = readUnsigned(payload.unclassified_credit)
  const accountCount = readCount(payload.account_count)
  const unclassifiedCount = readCount(payload.unclassified_account_count)
  if ([
    classifiedAssets, classifiedLiabilities, classifiedEquity, accumulated, classifiedTotalEquity,
    classifiedLiabilitiesAndEquity, classifiedDifference, controlAssets, controlLiabilities,
    controlRegisteredEquity, controlTotalEquity, controlLiabilitiesAndEquity, difference,
    unclassifiedAssets, unclassifiedLiabilities, unclassifiedEquity, accountCount, unclassifiedCount,
    currentAssets, noncurrentAssets, currentLiabilities, noncurrentLiabilities,
    unclassifiedDebit, unclassifiedCredit
  ].some((value) => value === null)) return invalid()
  if (!near(classifiedAssets, currentAssets + noncurrentAssets)) return invalid()
  if (!near(classifiedLiabilities, currentLiabilities + noncurrentLiabilities)) return invalid()
  if (accountCount > BALANCE_SHEET_MAX_ACCOUNTS) return invalid()

  const expectedLabel = payload.report_complete ? BALANCE_SHEET_COMPLETE_LABEL : BALANCE_SHEET_PROVISIONAL_LABEL
  if (payload.report_label !== expectedLabel) return invalid()
  if (payload.report_complete !== (unclassifiedCount === 0)) return invalid()
  if (!near(classifiedTotalEquity, classifiedEquity + accumulated)) return invalid()
  if (!near(classifiedLiabilitiesAndEquity, classifiedLiabilities + classifiedTotalEquity)) return invalid()
  if (!near(classifiedDifference, classifiedAssets - classifiedLiabilitiesAndEquity)) return invalid()
  if (!near(controlAssets, classifiedAssets + unclassifiedAssets)) return invalid()
  if (!near(controlLiabilities, classifiedLiabilities + unclassifiedLiabilities)) return invalid()
  if (!near(controlRegisteredEquity, classifiedEquity + unclassifiedEquity)) return invalid()
  if (!near(controlTotalEquity, controlRegisteredEquity + accumulated)) return invalid()
  if (!near(controlLiabilitiesAndEquity, controlLiabilities + controlTotalEquity)) return invalid()
  if (!near(difference, controlAssets - controlLiabilitiesAndEquity)) return invalid()
  const square = Math.abs(difference) < 0.005
  if (payload.is_square !== square) return invalid()
  if (payload.balance_status !== (square ? "Cuadrado" : "Descuadrado")) return invalid()
  if (payload.scope && !BALANCE_SHEET_SCOPE_LABELS[payload.scope]) return invalid()

  const sections = []
  for (let index = 0; index < BALANCE_SHEET_SECTION_ORDER.length; index += 1) {
    const raw = payload.sections[index]
    const key = BALANCE_SHEET_SECTION_ORDER[index]
    if (!raw || raw.key !== key || raw.label !== BALANCE_SHEET_SECTION_LABELS[key]) return invalid()
    const subtotal = readSigned(raw.subtotal)
    if (subtotal === null || !Array.isArray(raw.accounts)) return invalid()
    const accounts = []
    for (const accountRaw of raw.accounts) {
      const account = mapAccount(accountRaw)
      if (!account || account.section !== key) return invalid()
      accounts.push(account)
    }
    sections.push({ key, label: raw.label, subtotal, accounts })
  }

  const unclassifiedAccounts = []
  for (const accountRaw of payload.unclassified_accounts) {
    const account = mapAccount(accountRaw)
    if (!account || account.section) return invalid()
    unclassifiedAccounts.push(account)
  }
  if (unclassifiedAccounts.length !== unclassifiedCount) return invalid()
  const sectionTotals = Object.fromEntries(sections.map((section) => [section.key, section.subtotal]))
  if (!near(sectionTotals.current_asset, currentAssets)) return invalid()
  if (!near(sectionTotals.noncurrent_asset, noncurrentAssets)) return invalid()
  if (!near(sectionTotals.current_liability, currentLiabilities)) return invalid()
  if (!near(sectionTotals.noncurrent_liability, noncurrentLiabilities)) return invalid()
  if (!near(sectionTotals.equity, classifiedEquity)) return invalid()

  return {
    ok: true,
    report: {
      cutoffDate: payload.cutoff_date,
      snapshotAt: payload.snapshot_at,
      scope: payload.scope,
      scopeLabel: BALANCE_SHEET_SCOPE_LABELS[payload.scope] || payload.scope,
      includeZeroAccounts: Boolean(payload.include_zero_accounts),
      dimensionalFilter: Boolean(payload.dimensional_filter),
      reportComplete: payload.report_complete,
      reportLabel: payload.report_label,
      balanceStatus: payload.balance_status,
      isSquare: payload.is_square,
      currentAssetsTotal: currentAssets,
      noncurrentAssetsTotal: noncurrentAssets,
      classifiedTotalAssets: classifiedAssets,
      currentLiabilitiesTotal: currentLiabilities,
      noncurrentLiabilitiesTotal: noncurrentLiabilities,
      classifiedTotalLiabilities: classifiedLiabilities,
      classifiedRegisteredEquity: classifiedEquity,
      accumulatedResult: accumulated,
      classifiedTotalEquity,
      classifiedTotalLiabilitiesAndEquity: classifiedLiabilitiesAndEquity,
      classifiedDifference,
      unclassifiedAssetAmount: unclassifiedAssets,
      unclassifiedLiabilityAmount: unclassifiedLiabilities,
      unclassifiedEquityAmount: unclassifiedEquity,
      controlTotalAssets: controlAssets,
      controlTotalLiabilities: controlLiabilities,
      controlRegisteredEquity,
      controlTotalEquity,
      controlTotalLiabilitiesAndEquity: controlLiabilitiesAndEquity,
      difference,
      unclassifiedDebit,
      unclassifiedCredit,
      unclassifiedAccountCount: unclassifiedCount,
      accountCount,
      warnings: payload.warnings.map((warning) => String(warning)),
      sections,
      unclassifiedAccounts
    }
  }
}

export function balanceSheetRpcParams(filters = {}) {
  return {
    p_cutoff_date: filters.cutoffDate || null,
    p_branch_id: filters.branchId || null,
    p_cost_center_id: filters.costCenterId || null,
    p_include_zero_accounts: Boolean(filters.includeZeroAccounts),
    p_snapshot_at: filters.snapshotAt || null
  }
}

export function resolveBalanceSheetScreen({ canView, loading, error, report }) {
  if (!canView) return { state: "forbidden", showReport: false }
  if (loading) return { state: "loading", showReport: false }
  if (error) return { state: "error", showReport: false }
  if (!report) return { state: "idle", showReport: false }
  if (!report.reportComplete) return { state: "incomplete", showReport: true }
  const movements = report.sections.reduce(
    (sum, section) => sum + section.accounts.reduce((inner, account) => inner + account.movementCount, 0),
    0
  )
  if (movements === 0 && report.unclassifiedAccountCount === 0 && report.accumulatedResult === 0) {
    return { state: "empty", showReport: true }
  }
  return { state: "ready", showReport: true }
}

function formatMoneyCell(value) {
  if (value === null || value === undefined) return ""
  return Number(value).toFixed(2)
}

function csvRow(values) {
  return values.map((value) => escapeCsvCell(value)).join(",")
}

export function buildBalanceSheetCsv(report) {
  const lines = []
  lines.push(csvRow([report.reportLabel || BALANCE_SHEET_COMPLETE_LABEL]))
  lines.push(csvRow(["Estado", report.reportComplete ? "COMPLETO" : "INCOMPLETO"]))
  lines.push(csvRow(["Fecha de corte", report.cutoffDate || ""]))
  lines.push(csvRow(["Alcance", report.scopeLabel || ""]))
  lines.push(csvRow(["Instantánea", report.snapshotAt || ""]))
  lines.push(csvRow(["Cuentas en cero", report.includeZeroAccounts ? "Sí" : "No"]))
  lines.push(csvRow(["Nota", BALANCE_SHEET_CLASSIFIED_NOTE]))
  lines.push(csvRow([]))
  lines.push(csvRow(["Sección", "Código", "Nombre", "Debe", "Haber", "Importe", "Saldo contrario", "Movimientos", "Activa"]))
  for (const section of report.sections) {
    lines.push(csvRow([section.label, "", "", "", "", formatMoneyCell(section.subtotal), "", "", "Subtotal clasificado"]))
    for (const account of section.accounts) {
      lines.push(csvRow([
        section.label,
        account.code,
        account.name,
        formatMoneyCell(account.debit),
        formatMoneyCell(account.credit),
        formatMoneyCell(account.amount),
        account.contrary ? "Sí" : "No",
        String(account.movementCount),
        account.isActive ? "Sí" : "No"
      ]))
    }
  }
  lines.push(csvRow([]))
  lines.push(csvRow(["Total clasificado", "Total activos", formatMoneyCell(report.classifiedTotalAssets)]))
  lines.push(csvRow(["Total clasificado", "Total pasivos", formatMoneyCell(report.classifiedTotalLiabilities)]))
  lines.push(csvRow(["Total clasificado", "Patrimonio registrado", formatMoneyCell(report.classifiedRegisteredEquity)]))
  lines.push(csvRow(["Total clasificado", BALANCE_SHEET_ACCUMULATED_LABEL, formatMoneyCell(report.accumulatedResult)]))
  lines.push(csvRow(["Total clasificado", "Total patrimonio", formatMoneyCell(report.classifiedTotalEquity)]))
  lines.push(csvRow(["Total clasificado", "Total pasivo y patrimonio", formatMoneyCell(report.classifiedTotalLiabilitiesAndEquity)]))
  lines.push(csvRow(["Total clasificado", "Diferencia clasificada", formatMoneyCell(report.classifiedDifference)]))
  lines.push(csvRow([]))
  lines.push(csvRow(["Cuentas no clasificadas", String(report.unclassifiedAccountCount)]))
  lines.push(csvRow(["Sin clasificar", "Activo", formatMoneyCell(report.unclassifiedAssetAmount)]))
  lines.push(csvRow(["Sin clasificar", "Pasivo", formatMoneyCell(report.unclassifiedLiabilityAmount)]))
  lines.push(csvRow(["Sin clasificar", "Patrimonio", formatMoneyCell(report.unclassifiedEquityAmount)]))
  for (const account of report.unclassifiedAccounts) {
    lines.push(csvRow([
      "Sin clasificar",
      account.code,
      account.name,
      formatMoneyCell(account.debit),
      formatMoneyCell(account.credit),
      formatMoneyCell(account.amount),
      account.contrary ? "Sí" : "No",
      String(account.movementCount),
      account.isActive ? "Sí" : "No"
    ]))
  }
  lines.push(csvRow([]))
  lines.push(csvRow(["Ecuación de control", "Total activos", formatMoneyCell(report.controlTotalAssets)]))
  lines.push(csvRow(["Ecuación de control", "Total pasivos", formatMoneyCell(report.controlTotalLiabilities)]))
  lines.push(csvRow(["Ecuación de control", "Patrimonio registrado", formatMoneyCell(report.controlRegisteredEquity)]))
  lines.push(csvRow(["Ecuación de control", BALANCE_SHEET_ACCUMULATED_LABEL, formatMoneyCell(report.accumulatedResult)]))
  lines.push(csvRow(["Ecuación de control", "Total patrimonio", formatMoneyCell(report.controlTotalEquity)]))
  lines.push(csvRow(["Ecuación de control", "Total pasivo y patrimonio", formatMoneyCell(report.controlTotalLiabilitiesAndEquity)]))
  lines.push(csvRow(["Ecuación de control", "Diferencia", formatMoneyCell(report.difference)]))
  lines.push(csvRow(["Ecuación de control", "Estado", report.balanceStatus]))
  for (const warning of report.warnings) lines.push(csvRow(["Advertencia", warning]))
  return `\uFEFF${lines.join("\r\n")}`
}
