const INTERNAL_BARCODE_PREFIX = /^EGA-INV-/i

export function normalizeBarcode(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, "")
  if (!trimmed) return ""

  if (INTERNAL_BARCODE_PREFIX.test(trimmed)) {
    return trimmed.toUpperCase()
  }

  if (/^\d+$/.test(trimmed)) {
    return trimmed
  }

  return trimmed
}

export function barcodesMatch(left, right) {
  const a = normalizeBarcode(left)
  const b = normalizeBarcode(right)
  return Boolean(a && b && a === b)
}

export function isInternalBarcode(value) {
  return INTERNAL_BARCODE_PREFIX.test(String(value || "").trim())
}

export function inferBarcodeType(value) {
  const code = normalizeBarcode(value)
  if (!code) return null
  if (isInternalBarcode(code)) return "CODE128"
  if (/^\d{13}$/.test(code)) return "EAN13"
  if (/^\d{12}$/.test(code)) return "UPC"
  if (/^\d{8}$/.test(code)) return "EAN8"
  return "CODE128"
}

export function inferBarcodeSource(value, explicitSource = "") {
  if (explicitSource) return explicitSource
  if (isInternalBarcode(value)) return "internal"
  return "manual"
}

export function inventoryItemMatchesBarcode(item, barcode) {
  if (!item) return false
  const code = normalizeBarcode(barcode)
  if (!code) return false
  return [item.barcode, item.sku].filter(Boolean).some((candidate) => barcodesMatch(candidate, code))
}

export function matchPurchaseOrderItemByBarcode(orderItems = [], inventoryItem) {
  if (!inventoryItem) return null
  return (orderItems || []).find((line) => {
    const productId = line?.producto_id ?? line?.inventory_item_id ?? line?.id
    if (productId && String(productId) === String(inventoryItem.id)) return true
    return inventoryItemMatchesBarcode(
      { barcode: inventoryItem.barcode, sku: inventoryItem.sku },
      line?.barcode || line?.codigoBarras || line?.sku || line?.codigo || ""
    ) || [line?.barcode, line?.sku, line?.codigo, line?.codigoBarras].filter(Boolean).some((candidate) => (
      barcodesMatch(candidate, inventoryItem.barcode) || barcodesMatch(candidate, inventoryItem.sku)
    ))
  }) || null
}
