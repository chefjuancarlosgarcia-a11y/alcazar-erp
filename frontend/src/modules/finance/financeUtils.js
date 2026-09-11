export const FINANCE_TABS = [
  { key: "resumen", label: "Resumen" },
  { key: "bancos", label: "Bancos" },
  { key: "pagos", label: "Cuentas por pagar" },
  { key: "cobros", label: "Cuentas por cobrar" },
  { key: "flujo", label: "Flujo de caja" },
  { key: "conciliacion", label: "Conciliación" },
  { key: "catalogo", label: "Catálogo contable" },
  { key: "sucursales", label: "Sucursales" },
  { key: "centros", label: "Centros de costo" },
  { key: "periodos", label: "Periodos contables" },
  { key: "partidas", label: "Partidas contables" }
]

export const JOURNAL_STATUS_LABELS = {
  draft: "Borrador",
  pending_approval: "Pendiente de aprobación",
  approved: "Aprobada",
  posted: "Contabilizada"
}

export function emptyJournalLine(lineNumber = 1) {
  return {
    key: `local-${Date.now()}-${lineNumber}`,
    account_id: "",
    account_code: "",
    account_label: "",
    branch_id: "",
    cost_center_id: "",
    description: "",
    reference: "",
    debit: "",
    credit: ""
  }
}

export function emptyJournalDraftForm() {
  return {
    entry_date: new Date().toISOString().slice(0, 10),
    description: "",
    reference: "",
    lines: [emptyJournalLine(1), emptyJournalLine(2)]
  }
}

export const PAYABLE_STATUS_LABELS = {
  pending: "Pendiente",
  partial: "Parcial",
  paid: "Pagado",
  overdue: "Vencido",
  cancelled: "Cancelado"
}

export const RECEIVABLE_STATUS_LABELS = {
  pending: "Pendiente",
  partial: "Parcial",
  collected: "Cobrado",
  overdue: "Vencido",
  cancelled: "Cancelado"
}

export const BANK_TX_TYPES = [
  { value: "deposit", label: "Depósito" },
  { value: "withdrawal", label: "Retiro" },
  { value: "transfer", label: "Transferencia" },
  { value: "fee", label: "Comisión" },
  { value: "adjustment", label: "Ajuste" }
]

export const PAYMENT_METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "bank_transfer", label: "Transferencia" },
  { value: "check", label: "Cheque" },
  { value: "card", label: "Tarjeta" },
  { value: "other", label: "Otro" }
]

export const FINANCE_SOURCE_LABELS = {
  purchases: "Orden de compra",
  catering: "Solicitud catering",
  cash_closing: "Cierre de caja",
  manual: "Manual"
}

export function buildFinanceOriginUrl(sourceModule, sourceId) {
  if (!sourceModule || !sourceId || sourceModule === "manual") return null
  if (sourceModule === "purchases") {
    return `/inventory?section=ordenes&view=history&order=${encodeURIComponent(sourceId)}&focus=1`
  }
  if (sourceModule === "catering") {
    return `/catering?id=${encodeURIComponent(sourceId)}`
  }
  if (sourceModule === "cash_closing") {
    return `/cash-control?session=${encodeURIComponent(sourceId)}`
  }
  return null
}

export function labelFor(map, value) {
  return map[value] || value || "—"
}

export function formatMoney(value, currency = "GTQ") {
  const amount = Number(value || 0)
  return new Intl.NumberFormat("es-GT", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(amount)
}

export function defaultMonthRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10)
  }
}

export function emptyBankAccountForm() {
  return {
    name: "",
    bank_name: "",
    account_number: "",
    currency: "GTQ",
    opening_balance: ""
  }
}

export function emptyBankTransactionForm(bankAccountId = "") {
  return {
    bank_account_id: bankAccountId,
    transaction_date: new Date().toISOString().slice(0, 10),
    type: "deposit",
    direction: "in",
    amount: "",
    reference: "",
    description: ""
  }
}

export function emptyPayableForm() {
  return {
    supplier_name: "",
    invoice_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    description: "",
    subtotal: "",
    tax_amount: "",
    total_amount: ""
  }
}

export function emptyReceivableForm() {
  return {
    customer_name: "",
    customer_phone: "",
    customer_email: "",
    document_number: "",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: "",
    description: "",
    subtotal: "",
    tax_amount: "",
    total_amount: ""
  }
}
