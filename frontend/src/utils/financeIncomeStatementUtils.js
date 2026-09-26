import { centsToDecimalNumber, parseAmountToCents } from "./financeJournalAmounts.js"
import { escapeCsvCell } from "./financeGeneralJournalUtils.js"
import { resolveGeneralLedgerWindow } from "./financeGeneralLedgerUtils.js"
import {
  INCOME_STATEMENT_INVALID_METADATA_MESSAGE,
  INCOME_STATEMENT_MAX_ACCOUNTS,
  INCOME_STATEMENT_PROVISIONAL_LABEL,
  INCOME_STATEMENT_SECTION_LABELS,
  INCOME_STATEMENT_SECTION_ORDER,
  INCOME_STATEMENT_TAX_NOTE
} from "./financeIncomeStatementConstants.js"

export function validateIncomeStatementQuery({ fromDate, toDate, period }) {
  return resolveGeneralLedgerWindow({ fromDate, toDate, period })
}

export function incomeStatementScopeKey({ branchId, costCenterId } = {}) {
  if (branchId && costCenterId) return "branch_and_cost_center"
  if (branchId) return "branch"
  if (costCenterId) return "cost_center"
  return "global"
}

function invalid() {
  return { ok: false, message: INCOME_STATEMENT_INVALID_METADATA_MESSAGE }
}

function readUnsigned(value) {
  if (value === null || value === undefined || value === "") return null
  if (typeof value === "boolean") return null
  if (typeof value === "number" && !Number.isFinite(value)) return null
  const normalized = String(value).trim().replace(/,/g, "")
  if (normalized.startsWith("-")) return null
  const parsed = parseAmountToCents(normalized)
  if (!parsed.ok) return null
  return centsToDecimalNumber(parsed.cents)
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

function readCount(value) {
  if (typeof value === "boolean" || value === null || value === undefined || value === "") return null
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) return null
  return number
}

function mapAccount(raw, { requireAmount }) {
  if (!raw || typeof raw !== "object") return null
  const periodDebit = readUnsigned(raw.period_debit)
  const periodCredit = readUnsigned(raw.period_credit)
  const movementCount = readCount(raw.movement_count)
  if (periodDebit === null || periodCredit === null || movementCount === null) return null
  if (typeof raw.code !== "string" || typeof raw.name !== "string") return null
  if (typeof raw.is_active !== "boolean" || typeof raw.account_id !== "string") return null
  const account = {
    accountId: raw.account_id,
    code: raw.code,
    name: raw.name,
    financialType: raw.financial_type,
    naturalBalance: raw.natural_balance,
    isActive: raw.is_active,
    periodDebit,
    periodCredit,
    movementCount
  }
  if (requireAmount) {
    const amount = readSigned(raw.amount)
    if (amount === null || typeof raw.contrary !== "boolean") return null
    if (raw.contrary !== amount < -0.004) return null
    account.amount = amount
    account.contrary = raw.contrary
    account.section = raw.income_statement_section
  }
  return account
}

export function mapIncomeStatementResponse(data) {
  const payload = data && typeof data === "object" ? data : null
  if (!payload || typeof payload.report_complete !== "boolean") return invalid()
  if (typeof payload.income_tax_classified !== "boolean") return invalid()
  if (typeof payload.snapshot_at !== "string" || !Number.isFinite(Date.parse(payload.snapshot_at))) return invalid()
  if (!Array.isArray(payload.sections) || payload.sections.length !== INCOME_STATEMENT_SECTION_ORDER.length) return invalid()
  if (!Array.isArray(payload.warnings) || payload.warnings.some((item) => typeof item !== "string")) return invalid()

  const signedKeys = [
    "operating_income_total",
    "sales_contra_total",
    "net_revenue",
    "cost_of_sales_total",
    "gross_profit",
    "selling_expenses_total",
    "administrative_expenses_total",
    "other_operating_expenses_total",
    "operating_expenses_total",
    "operating_profit",
    "other_income_total",
    "other_expense_total",
    "other_result",
    "profit_before_tax",
    "income_tax_total",
    "classified_net_result"
  ]
  const totals = {}
  for (const key of signedKeys) {
    const value = readSigned(payload[key])
    if (value === null) return invalid()
    totals[key] = value
  }

  const unclassifiedDebit = readUnsigned(payload.unclassified_debit)
  const unclassifiedCredit = readUnsigned(payload.unclassified_credit)
  const unclassifiedNet = readSigned(payload.unclassified_net_movement)
  const unclassifiedCount = readCount(payload.unclassified_account_count)
  const accountCount = readCount(payload.account_count)
  if ([unclassifiedDebit, unclassifiedCredit, unclassifiedNet, unclassifiedCount, accountCount].some((value) => value === null)) {
    return invalid()
  }
  if (accountCount > INCOME_STATEMENT_MAX_ACCOUNTS) return invalid()

  const netIncome = payload.report_complete ? readSigned(payload.net_income) : payload.net_income
  if (payload.report_complete) {
    if (netIncome === null || netIncome !== totals.classified_net_result) return invalid()
    if (payload.net_result_label === INCOME_STATEMENT_PROVISIONAL_LABEL) return invalid()
  } else if (payload.net_income !== null || payload.net_result_label !== INCOME_STATEMENT_PROVISIONAL_LABEL) {
    return invalid()
  }

  const sections = []
  for (let index = 0; index < INCOME_STATEMENT_SECTION_ORDER.length; index += 1) {
    const expected = INCOME_STATEMENT_SECTION_ORDER[index]
    const section = payload.sections[index]
    if (!section || section.key !== expected) return invalid()
    if (section.label !== INCOME_STATEMENT_SECTION_LABELS[expected]) return invalid()
    const subtotal = readSigned(section.subtotal)
    if (subtotal === null || !Array.isArray(section.accounts)) return invalid()
    const accounts = section.accounts.map((account) => mapAccount(account, { requireAmount: true }))
    if (accounts.some((account) => !account)) return invalid()
    sections.push({ key: expected, label: section.label, subtotal, accounts })
  }

  const unclassifiedAccounts = (payload.unclassified_accounts || []).map((account) => mapAccount(account, { requireAmount: false }))
  if (!Array.isArray(payload.unclassified_accounts) || unclassifiedAccounts.some((account) => !account)) return invalid()
  if (unclassifiedAccounts.length !== unclassifiedCount) return invalid()

  return {
    ok: true,
    report: {
      scope: payload.scope || "global",
      effectiveFrom: payload.effective_from || null,
      effectiveTo: payload.effective_to || null,
      includeZeroAccounts: Boolean(payload.include_zero_accounts),
      snapshotAt: payload.snapshot_at.trim(),
      reportComplete: payload.report_complete,
      incomeTaxClassified: payload.income_tax_classified,
      operatingIncomeTotal: totals.operating_income_total,
      salesContraTotal: totals.sales_contra_total,
      netRevenue: totals.net_revenue,
      costOfSalesTotal: totals.cost_of_sales_total,
      grossProfit: totals.gross_profit,
      sellingExpensesTotal: totals.selling_expenses_total,
      administrativeExpensesTotal: totals.administrative_expenses_total,
      otherOperatingExpensesTotal: totals.other_operating_expenses_total,
      operatingExpensesTotal: totals.operating_expenses_total,
      operatingProfit: totals.operating_profit,
      otherIncomeTotal: totals.other_income_total,
      otherExpenseTotal: totals.other_expense_total,
      otherResult: totals.other_result,
      profitBeforeTax: totals.profit_before_tax,
      incomeTaxTotal: totals.income_tax_total,
      classifiedNetResult: totals.classified_net_result,
      netIncome: payload.report_complete ? netIncome : null,
      netResultLabel: payload.net_result_label,
      unclassifiedDebit,
      unclassifiedCredit,
      unclassifiedNetMovement: unclassifiedNet,
      unclassifiedAccountCount: unclassifiedCount,
      accountCount,
      warnings: payload.warnings,
      sections,
      unclassifiedAccounts
    }
  }
}

export function incomeStatementRpcParams(filters = {}) {
  return {
    p_from_date: filters.fromDate || null,
    p_to_date: filters.toDate || null,
    p_period_id: filters.periodId || null,
    p_branch_id: filters.branchId || null,
    p_cost_center_id: filters.costCenterId || null,
    p_include_zero_accounts: Boolean(filters.includeZeroAccounts),
    p_snapshot_at: filters.snapshotAt || null
  }
}

export function resolveIncomeStatementScreen({ canView, loading, error, report }) {
  if (!canView) return { state: "forbidden", showReport: false }
  if (loading) return { state: "loading", showReport: false }
  if (error) return { state: "error", showReport: false }
  if (!report) return { state: "idle", showReport: false }
  if (!report.reportComplete) return { state: "incomplete", showReport: true }
  const movements = report.sections.reduce(
    (sum, section) => sum + section.accounts.reduce((inner, account) => inner + account.movementCount, 0),
    0
  )
  if (movements === 0 && report.unclassifiedAccountCount === 0) return { state: "empty", showReport: true }
  return { state: "ready", showReport: true }
}

function formatMoneyCell(value) {
  if (value === null || value === undefined) return ""
  return Number(value).toFixed(2)
}

function csvRow(values) {
  return values.map((value) => escapeCsvCell(value)).join(",")
}

export function buildIncomeStatementCsv(report) {
  const lines = []
  lines.push(csvRow(["Estado de Resultados"]))
  lines.push(csvRow(["Estado", report.reportComplete ? "COMPLETO" : "INCOMPLETO"]))
  lines.push(csvRow(["Desde", report.effectiveFrom || ""]))
  lines.push(csvRow(["Hasta", report.effectiveTo || ""]))
  lines.push(csvRow(["Alcance", report.scope || ""]))
  lines.push(csvRow(["Instantánea", report.snapshotAt || ""]))
  lines.push(csvRow(["Cuentas en cero", report.includeZeroAccounts ? "Sí" : "No"]))
  lines.push(csvRow([]))
  lines.push(csvRow(["Sección", "Código", "Nombre", "Debe", "Haber", "Importe", "Saldo contrario", "Movimientos", "Activa"]))
  for (const section of report.sections) {
    lines.push(csvRow([section.label, "", "", "", "", formatMoneyCell(section.subtotal), "", "", "Subtotal"]))
    for (const account of section.accounts) {
      lines.push(csvRow([
        section.label,
        account.code,
        account.name,
        formatMoneyCell(account.periodDebit),
        formatMoneyCell(account.periodCredit),
        formatMoneyCell(account.amount),
        account.contrary ? "Sí" : "No",
        String(account.movementCount),
        account.isActive ? "Sí" : "No"
      ]))
    }
  }
  lines.push(csvRow([]))
  lines.push(csvRow(["Fórmula", "Ventas netas", "Ingresos operativos − Devoluciones y descuentos sobre ventas", formatMoneyCell(report.netRevenue)]))
  lines.push(csvRow(["Fórmula", "Utilidad bruta", "Ventas netas − Costo de ventas", formatMoneyCell(report.grossProfit)]))
  lines.push(csvRow(["Fórmula", "Gastos operativos", "Gastos de venta + Gastos administrativos + Otros gastos operativos", formatMoneyCell(report.operatingExpensesTotal)]))
  lines.push(csvRow(["Fórmula", "Utilidad operativa", "Utilidad bruta − Gastos operativos", formatMoneyCell(report.operatingProfit)]))
  lines.push(csvRow(["Fórmula", "Otros resultados", "Otros ingresos − Otros gastos", formatMoneyCell(report.otherResult)]))
  lines.push(csvRow(["Fórmula", "Utilidad antes de impuestos", "Utilidad operativa + Otros resultados", formatMoneyCell(report.profitBeforeTax)]))
  lines.push(csvRow(["Fórmula", "Impuesto sobre la renta", report.incomeTaxClassified ? "Suma de cuentas de impuesto" : INCOME_STATEMENT_TAX_NOTE, formatMoneyCell(report.incomeTaxTotal)]))
  lines.push(csvRow([
    "Fórmula",
    report.reportComplete ? report.netResultLabel : INCOME_STATEMENT_PROVISIONAL_LABEL,
    report.reportComplete
      ? "Utilidad antes de impuestos − Impuesto sobre la renta"
      : "Cálculo provisional de cuentas clasificadas. La utilidad neta no está determinada.",
    formatMoneyCell(report.reportComplete ? report.netIncome : report.classifiedNetResult)
  ]))
  if (!report.reportComplete) {
    lines.push(csvRow([]))
    lines.push(csvRow(["Cuentas no clasificadas", String(report.unclassifiedAccountCount)]))
    lines.push(csvRow(["Debe no clasificado", formatMoneyCell(report.unclassifiedDebit)]))
    lines.push(csvRow(["Haber no clasificado", formatMoneyCell(report.unclassifiedCredit)]))
    lines.push(csvRow(["Movimiento neto no clasificado", formatMoneyCell(report.unclassifiedNetMovement)]))
    for (const account of report.unclassifiedAccounts) {
      lines.push(csvRow([
        "No clasificada",
        account.code,
        account.name,
        formatMoneyCell(account.periodDebit),
        formatMoneyCell(account.periodCredit),
        "",
        "",
        String(account.movementCount),
        account.isActive ? "Sí" : "No"
      ]))
    }
  }
  for (const warning of report.warnings) lines.push(csvRow(["Advertencia", warning]))
  return `\uFEFF${lines.join("\r\n")}`
}
