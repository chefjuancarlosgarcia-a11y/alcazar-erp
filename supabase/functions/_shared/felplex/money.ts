/** Match SQL public.fel_round_money — two decimal places. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.round(value * 100) / 100
}

/** IVA included extraction — base rounded, VAT residual (Phase 0 formula). */
export function extractVatIncluded(total: number, rate = 0.12) {
  const invoiceTotal = roundMoney(total)
  const taxableBase = roundMoney(invoiceTotal / (1 + rate))
  const vatTotal = roundMoney(invoiceTotal - taxableBase)
  return { invoiceTotal, taxableBase, vatTotal }
}

export function moneyEquals(a: number, b: number): boolean {
  return roundMoney(a) === roundMoney(b)
}

export function assertDocumentMoney(snapshot: {
  invoice_total: number
  taxable_base: number
  vat_total: number
  gross_items_total: number
  discount_total: number
  taxable_gross_total: number
}): string | null {
  if (!moneyEquals(snapshot.gross_items_total - snapshot.discount_total, snapshot.taxable_gross_total)) {
    return "FEL_SNAPSHOT_GROSS_MISMATCH"
  }
  if (!moneyEquals(snapshot.taxable_gross_total, snapshot.invoice_total)) {
    return "FEL_SNAPSHOT_TAXABLE_GROSS_MISMATCH"
  }
  if (!moneyEquals(snapshot.taxable_base + snapshot.vat_total, snapshot.invoice_total)) {
    return "FEL_SNAPSHOT_TAX_MISMATCH"
  }
  const expected = extractVatIncluded(snapshot.invoice_total)
  if (!moneyEquals(expected.taxableBase, snapshot.taxable_base)) {
    return "FEL_SNAPSHOT_BASE_MISMATCH"
  }
  if (!moneyEquals(expected.vatTotal, snapshot.vat_total)) {
    return "FEL_SNAPSHOT_VAT_MISMATCH"
  }
  return null
}
