export const INVENTORY_DEDUCTION_MODES = {
  DISABLED: "disabled",
  ACTIVE_RECIPES_ONLY: "active_recipes_only",
  STRICT: "strict"
}

export const RECIPE_STATUS_LABELS = {
  missing: "Sin receta",
  draft: "Receta en borrador",
  active: "Receta activa",
  paused: "Receta pausada"
}

export function isStrictDeductionMode(mode) {
  return mode === INVENTORY_DEDUCTION_MODES.STRICT
}

export function isImplementationSaleMode(mode) {
  return mode === INVENTORY_DEDUCTION_MODES.DISABLED
    || mode === INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY
}

export function getProductRecipeStatus(product) {
  return product?.recipeStatus || product?.recipe_status || "missing"
}

export function productHasInventoryTracking(product) {
  return product?.inventoryTrackingEnabled === true
    || product?.inventory_tracking_enabled === true
}

export function willSkipInventoryDeduction(product, deductionMode, migrationModeEnabled = false) {
  if (migrationModeEnabled && deductionMode === INVENTORY_DEDUCTION_MODES.ACTIVE_RECIPES_ONLY) {
    return true
  }
  if (deductionMode === INVENTORY_DEDUCTION_MODES.DISABLED) return true
  if (deductionMode === INVENTORY_DEDUCTION_MODES.STRICT) return false
  if (!productHasInventoryTracking(product)) return true
  return getProductRecipeStatus(product) !== "active"
}

export function getInventorySkipWarning(product, deductionMode, migrationModeEnabled = false) {
  if (!willSkipInventoryDeduction(product, deductionMode, migrationModeEnabled)) return ""
  if (deductionMode === INVENTORY_DEDUCTION_MODES.DISABLED || migrationModeEnabled) {
    return "La descarga de inventario está desactivada globalmente. La venta continuará normalmente."
  }
  const status = getProductRecipeStatus(product)
  if (!productHasInventoryTracking(product)) {
    return "Este producto aún no tiene control de inventario activo. La venta continuará normalmente y no descargará inventario."
  }
  if (status !== "active") {
    return "Este producto aún no tiene receta activa. La venta continuará normalmente y no descargará inventario."
  }
  return ""
}

export function getRecipeStatusBadge(status) {
  const labels = RECIPE_STATUS_LABELS
  switch (status) {
    case "active":
      return { label: labels.active, tone: "success" }
    case "draft":
      return { label: labels.draft, tone: "warning" }
    case "paused":
      return { label: labels.paused, tone: "muted" }
    default:
      return { label: labels.missing, tone: "danger" }
  }
}

export function getInventoryTrackingBadge(product) {
  if (productHasInventoryTracking(product)) {
    return { label: "Inventario activo", tone: "success" }
  }
  return { label: "No controla inventario", tone: "muted" }
}

/**
 * Extends production state with sale eligibility for implementation mode.
 */
export function getProductSaleState(product, productionState, deductionMode) {
  const strict = isStrictDeductionMode(deductionMode)
  const testItem = productionState?.testItem
  const active = productionState?.active
  const hasArea = Boolean(productionState?.area)
  const hasCategory = Boolean(productionState?.category)
  const recipeRequired = product?.recipeRequiredForSale === true
    || product?.recipe_required_for_sale === true

  const blockers = []
  if (!active) blockers.push("Producto inactivo")
  if (!hasCategory) blockers.push("Sin categoría activa")
  if (!hasArea) blockers.push("Sin destino KDS")

  if (strict || recipeRequired) {
    if (!productionState?.productionReady) {
      blockers.push(...(productionState?.issues || ["No validado para producción"]))
    }
  } else if (!testItem) {
    const productType = productionState?.productType || "simple"
    if (productType === "pizza" && !(productionState?.variants?.length > 0)) {
      blockers.push("Sin tamaños activos")
    }
  }

  const saleAllowed = active && hasArea && hasCategory && blockers.length === 0
  const inventoryWillDeduct = saleAllowed
    && !willSkipInventoryDeduction(product, deductionMode)

  return {
    ...productionState,
    saleAllowed,
    inventoryWillDeduct,
    skipInventoryWarning: saleAllowed
      ? getInventorySkipWarning(product, deductionMode)
      : "",
    recipeStatus: getProductRecipeStatus(product),
    inventoryTrackingEnabled: productHasInventoryTracking(product)
  }
}

export function catalogImplementationStatusLabel(state) {
  if (!state?.active) return "Inactivo"
  if (state?.saleAllowed === false && !state?.productionReady) return "Pendiente"
  if (state?.inventoryWillDeduct) return "Venta + inventario"
  if (state?.saleAllowed) return "Venta sin inventario"
  return "Pendiente KDS"
}
