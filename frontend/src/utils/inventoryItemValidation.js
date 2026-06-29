import { isLegacyInventoryCategoryCode, resolveInventoryCategoryName } from "./inventoryCategoryUtils"
import { barcodesMatch, normalizeBarcode } from "./barcodeUtils"

const PIECE_UNIT_KEYS = new Set(["unidad", "unidades", "unidad_pieza", "pieza", "piezas", "unit", "units", "piece", "pieces"])
const GRAM_UNIT_KEYS = new Set(["gramo", "gramos", "g", "gr"])

function normalizeUnitKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[\/\s]+/g, "_")
}

function isPieceUnit(unit) {
  return PIECE_UNIT_KEYS.has(normalizeUnitKey(unit))
}

function isGramsUnit(unit) {
  return GRAM_UNIT_KEYS.has(normalizeUnitKey(unit))
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase()
}

function normalizeItemName(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function mapInventorySaveError(error) {
  if (!error) return "No se pudo guardar el producto."
  const message = String(error.message || error.details || "").trim()
  const lower = message.toLowerCase()

  if (error.code === "TIMEOUT" || lower.includes("timeout") || lower.includes("timed out")) {
    return "La operación tardó demasiado. Verifica tu conexión e intenta de nuevo."
  }
  if (lower.includes("jwt") || lower.includes("permission") || lower.includes("row-level security") || lower.includes("not authorized")) {
    return "No tienes permisos para crear o editar productos de inventario."
  }
  if (lower.includes("inventory_items_sku_key") || (lower.includes("duplicate") && lower.includes("sku"))) {
    return "No se pudo guardar el producto porque el SKU ya existe."
  }
  if (lower.includes("inventory_items_barcode") || (lower.includes("duplicate") && lower.includes("barcode"))) {
    return "Este código ya pertenece a otro producto."
  }
  if (lower.includes("inventory_items_name") && lower.includes("duplicate")) {
    return "Ya existe un producto con ese nombre."
  }
  if (lower.includes("network") || lower.includes("failed to fetch") || lower.includes("fetch")) {
    return "Error de red. Verifica tu conexión e intenta de nuevo."
  }
  if (lower.includes("invalid input syntax") || lower.includes("numeric")) {
    return "Revisa los valores numéricos del formulario antes de guardar."
  }
  if (message) return message
  return "No se pudo guardar el producto."
}

export function isInventoryItemVisibleInCatalog(item, { query = "", areaFilter = "todos" } = {}) {
  if (!item) return false
  const text = `${item.name || ""} ${item.sku || ""} ${item.barcode || ""} ${item.category || ""}`.toLowerCase()
  const matchesQuery = !query.trim() || text.includes(query.trim().toLowerCase())
  const matchesArea = areaFilter === "todos" || item.active !== false
  return matchesQuery && matchesArea
}

export function validateInventoryItemForm(form, {
  categories = [],
  providers = [],
  items = [],
  editingItemId = ""
} = {}) {
  const errors = {}

  if (!String(form.name || "").trim()) {
    errors.name = "El nombre es obligatorio."
  }

  if (!String(form.category || "").trim()) {
    errors.category = "Selecciona una categoría."
  } else if (isLegacyInventoryCategoryCode(form.category) && !editingItemId) {
    errors.category = "Selecciona una categoría válida del catálogo."
  } else {
    const categoryName = resolveInventoryCategoryName(form.category, categories)
    if (!categoryName?.trim()) {
      errors.category = "La categoría seleccionada no es válida."
    }
  }

  if (!String(form.purchase_unit || "").trim()) {
    errors.purchase_unit = "La unidad de compra es obligatoria."
  }

  if (!String(form.base_unit || "").trim()) {
    errors.base_unit = "La unidad base es obligatoria."
  }

  const conversionFactor = Number(form.conversion_factor)
  if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
    errors.conversion_factor = "El factor de conversión debe ser mayor a 0."
  }

  const purchasePrice = form.purchase_price === "" || form.purchase_price == null
    ? null
    : Number(form.purchase_price)
  if (purchasePrice !== null && (!Number.isFinite(purchasePrice) || purchasePrice < 0)) {
    errors.purchase_price = "El precio de compra no puede ser negativo."
  }

  const baseCost = (() => {
    if (purchasePrice !== null && Number.isFinite(purchasePrice) && Number.isFinite(conversionFactor) && conversionFactor > 0) {
      return purchasePrice / conversionFactor
    }
    return Number(form.cost_per_base_unit ?? 0)
  })()
  if (!Number.isFinite(baseCost) || baseCost < 0) {
    errors.cost_per_base_unit = "El costo por unidad base no puede ser negativo."
  }

  const initialQuantity = Number(form.initialQuantity ?? 0)
  if (!Number.isFinite(initialQuantity) || initialQuantity < 0) {
    errors.initialQuantity = "El stock inicial no puede ser negativo."
  }

  const minimumQuantity = Number(form.minimumQuantity ?? 0)
  if (!Number.isFinite(minimumQuantity) || minimumQuantity < 0) {
    errors.minimumQuantity = "El punto mínimo no puede ser negativo."
  }

  const supplier = String(form.supplier || "").trim()
  if (supplier && providers.length > 0 && !providers.includes(supplier)) {
    const isExistingSupplier = Boolean(editingItemId && items.find((item) => item.id === editingItemId)?.supplier === supplier)
    if (!isExistingSupplier) {
      errors.supplier = "El proveedor seleccionado ya no existe o está inactivo."
    }
  }

  const sku = String(form.sku || "").trim()
  if (sku) {
    const duplicateSku = items.find((item) => (
      item.id !== editingItemId && normalizeSku(item.sku) === normalizeSku(sku)
    ))
    if (duplicateSku) {
      errors.sku = `El SKU ya está en uso por "${duplicateSku.name}".`
    }
  }

  const barcode = normalizeBarcode(form.barcode)
  if (barcode) {
    const duplicateBarcode = items.find((item) => (
      item.id !== editingItemId && barcodesMatch(item.barcode, barcode)
    ))
    if (duplicateBarcode) {
      errors.barcode = `Este código ya pertenece a otro producto ("${duplicateBarcode.name}").`
    }
  }

  const canUseRecipeConversion = isPieceUnit(form.base_unit)
  if (canUseRecipeConversion && form.useRecipeWeightConversion) {
    const recipeWeightGrams = Number(form.recipeWeightGrams)
    if (!Number.isFinite(recipeWeightGrams) || recipeWeightGrams <= 0) {
      errors.recipeWeightGrams = "El peso por unidad debe ser mayor a 0."
    }
    if (!isGramsUnit(form.recipeWeightUnit)) {
      errors.recipeWeightUnit = "La unidad de peso debe ser gramos."
    }
  }

  const orderedFields = [
    "name",
    "sku",
    "barcode",
    "category",
    "supplier",
    "purchase_unit",
    "base_unit",
    "conversion_factor",
    "purchase_price",
    "cost_per_base_unit",
    "initialQuantity",
    "minimumQuantity",
    "recipeWeightGrams",
    "recipeWeightUnit"
  ]
  const firstErrorField = orderedFields.find((field) => errors[field]) || Object.keys(errors)[0] || ""

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    firstErrorField,
    normalized: {
      purchasePrice,
      conversionFactor,
      initialQuantity,
      minimumQuantity,
      recipeWeightGrams: Number(form.recipeWeightGrams),
      categoryName: resolveInventoryCategoryName(form.category, categories),
      duplicateNameItem: items.find((item) => (
        item.id !== editingItemId &&
        normalizeItemName(item.name) === normalizeItemName(form.name)
      )) || null
    }
  }
}

export function logInventorySaveDebug(action, details = {}) {
  if (!import.meta.env.DEV) return
  console.warn(`[inventory-save] ${action}`, details)
}
