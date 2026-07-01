const PIECE_UNIT_KEYS = new Set(["unidad", "unidades", "unidad_pieza", "pieza", "piezas", "unit", "units", "piece", "pieces"])
const GRAM_UNIT_KEYS = new Set(["gramo", "gramos", "g", "gr"])

export function normalizeUnitKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\/\s]+/g, "_")
}

export function normalizeInventoryUnit(value) {
  const unitKey = normalizeUnitKey(value)
  if (!unitKey) return ""
  if (PIECE_UNIT_KEYS.has(unitKey)) return "unidad"
  if (["libra", "libras", "lb", "lbs"].includes(unitKey)) return "libra"
  if (["onza", "onzas", "oz"].includes(unitKey)) return "onza"
  if (["kilogramo", "kilogramos", "kg", "kilo", "kilos"].includes(unitKey)) return "kilogramo"
  if (GRAM_UNIT_KEYS.has(unitKey)) return "gramo"
  if (["mililitro", "mililitros", "ml", "cc"].includes(unitKey)) return "mililitro"
  if (["litro", "litros", "l"].includes(unitKey)) return "litro"
  if (["galon", "galones", "gal"].includes(unitKey)) return "galon"
  if (["onza_liquida", "onza_liq", "fl_oz", "floz"].includes(unitKey)) return "onza_liquida"
  if (["caja", "cajas", "box", "boxes"].includes(unitKey)) return "caja"
  if (["paquete", "paquetes", "pack", "packs"].includes(unitKey)) return "paquete"
  if (["bolsa", "bolsas", "bag", "bags"].includes(unitKey)) return "bolsa"
  if (["lata", "latas", "can", "cans"].includes(unitKey)) return "lata"
  if (["botella", "botellas", "bottle", "bottles"].includes(unitKey)) return "botella"
  if (["quintal", "quintales"].includes(unitKey)) return "quintal"
  if (["manojo", "manojos"].includes(unitKey)) return "manojo"
  return unitKey
}

export function unitsMatch(a, b) {
  return normalizeInventoryUnit(a) === normalizeInventoryUnit(b)
}

export function tryGlobalUnitFactor(fromUnit, toUnit, conversions = []) {
  if (unitsMatch(fromUnit, toUnit)) return 1
  const fromKey = normalizeInventoryUnit(fromUnit)
  const toKey = normalizeInventoryUnit(toUnit)
  const direct = conversions.find((row) => (
    normalizeInventoryUnit(row.from_unit) === fromKey
    && normalizeInventoryUnit(row.to_unit) === toKey
  ))
  if (direct && Number(direct.factor) > 0) return Number(direct.factor)
  const reverse = conversions.find((row) => (
    normalizeInventoryUnit(row.from_unit) === toKey
    && normalizeInventoryUnit(row.to_unit) === fromKey
  ))
  if (reverse && Number(reverse.factor) > 0) return 1 / Number(reverse.factor)
  return null
}

export function getDefaultRequisitionUnit(item) {
  return item?.default_requisition_unit || item?.defaultRequisitionUnit || item?.base_unit || ""
}

export function resolveItemRequisitionUnitFactor(item, requestedUnit, globalConversions = []) {
  if (!item?.id) {
    return { factor: null, error: "Producto no encontrado." }
  }
  const unit = String(requestedUnit || "").trim()
  if (!unit) {
    return { factor: null, error: "Debes indicar la unidad solicitada." }
  }
  const baseUnit = item.base_unit || ""
  if (unitsMatch(unit, baseUnit)) {
    return { factor: 1, error: "" }
  }
  const purchaseUnit = item.purchase_unit || ""
  if (purchaseUnit && unitsMatch(unit, purchaseUnit)) {
    const factor = Number(item.conversion_factor || 1)
    if (!Number.isFinite(factor) || factor <= 0) {
      return { factor: null, error: "El factor de conversión de compra no es válido." }
    }
    return { factor, error: "" }
  }
  const globalFactor = tryGlobalUnitFactor(unit, baseUnit, globalConversions)
  if (globalFactor != null) {
    return { factor: globalFactor, error: "" }
  }
  return {
    factor: null,
    error: `La unidad ${unit} no está configurada para el producto ${item.name}. Corrige la unidad o configura la conversión antes de enviar.`
  }
}

export function getRequisitionUnitOptions(item, globalConversions = []) {
  if (!item) return []
  const options = []
  const seen = new Set()
  function add(unit) {
    const label = String(unit || "").trim()
    if (!label) return
    const key = normalizeInventoryUnit(label)
    if (seen.has(key)) return
    const { factor } = resolveItemRequisitionUnitFactor(item, label, globalConversions)
    if (factor == null) return
    seen.add(key)
    options.push(label)
  }
  add(getDefaultRequisitionUnit(item))
  add(item.base_unit)
  if (item.purchase_unit && !unitsMatch(item.purchase_unit, item.base_unit)) {
    add(item.purchase_unit)
  }
  globalConversions.forEach((conversion) => {
    const baseKey = normalizeInventoryUnit(item.base_unit)
    if (normalizeInventoryUnit(conversion.from_unit) === baseKey) add(conversion.to_unit)
    if (normalizeInventoryUnit(conversion.to_unit) === baseKey) add(conversion.from_unit)
  })
  return options
}

export function formatInventoryNumber(value) {
  const number = Number(value || 0)
  return Number.isInteger(number) ? String(number) : number.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")
}

export function buildRequisitionConversionPreview(quantity, requestedUnit, baseUnit, factor) {
  const qty = Number(quantity || 0)
  if (!Number.isFinite(qty) || qty <= 0 || factor == null) return null
  const baseQty = qty * factor
  if (unitsMatch(requestedUnit, baseUnit)) {
    return {
      expression: `${formatInventoryNumber(qty)} ${requestedUnit}`,
      deduction: `Se descontarán ${formatInventoryNumber(baseQty)} ${baseUnit} del inventario.`
    }
  }
  return {
    expression: `${formatInventoryNumber(qty)} ${requestedUnit} = ${formatInventoryNumber(baseQty)} ${baseUnit}`,
    deduction: `Se descontarán ${formatInventoryNumber(baseQty)} ${baseUnit} del inventario.`
  }
}

export function buildPurchaseConversionHint(purchaseUnit, baseUnit, factor) {
  const safeFactor = formatInventoryNumber(factor || 1)
  return `1 ${purchaseUnit || "—"} = ${safeFactor} ${baseUnit || "—"}`
}

export function isPieceUnit(unit) {
  return PIECE_UNIT_KEYS.has(normalizeUnitKey(unit))
}

export function isGramsUnit(unit) {
  return GRAM_UNIT_KEYS.has(normalizeUnitKey(unit))
}

export function canConfigureRecipeUsageUnit(baseUnit) {
  return Boolean(baseUnit) && !isGramsUnit(baseUnit)
}
