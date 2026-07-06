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

export function productRequiresRecipeForSale(product) {
  return product?.recipeRequiredForSale === true
    || product?.recipe_required_for_sale === true
}

/** Producto activo vendible sin descarga de inventario (modo implementación). */
export const CONFIGURABLE_SALE_PHASE2_MESSAGE = "Venta configurable disponible en la siguiente fase."

export function isConfigurableProductType(stateOrProduct) {
  return (stateOrProduct?.productType || stateOrProduct?.product_type || "simple") === "configurable"
}

/** Visible en grid mesero (Fase 1): preview sin venta real. */
export function isMeseroCatalogVisible(saleState) {
  const hasArea = Boolean(saleState?.area || saleState?.areaId)
  const hasCategory = Boolean(saleState?.category || saleState?.categoryId)
  if (!saleState?.active || !hasArea || !hasCategory) return false
  if (saleState.saleAllowed) return true
  if (isConfigurableProductType(saleState) && saleState.productionReady) return true
  return false
}

export function isConfigurableMeseroPreview(saleState) {
  return isConfigurableProductType(saleState) && isMeseroCatalogVisible(saleState) && !saleState?.saleAllowed
}

/** Producto activo vendible sin descarga de inventario (modo implementación). */
export function isCatalogSaleWithoutInventory(state) {
  return Boolean(
    state?.active
    && state?.saleAllowed
    && !state?.inventoryTrackingEnabled
    && !state?.inventoryWillDeduct
    && !state?.testItem
  )
}

/** Líneas de checklist para cards del catálogo POS (solo UI). */
export function getCatalogProductionBadgeLines(state) {
  if (state?.testItem) {
    return [
      {
        ok: Boolean(state.area),
        label: state.area ? "✓ Destino KDS configurado" : "✗ Sin destino KDS"
      },
      {
        ok: Boolean(state.productionReady),
        label: state.productionReady ? "✓ Envío KDS sin consumo" : "✗ Pendiente validación KDS"
      }
    ]
  }

  const saleWithoutInventory = isCatalogSaleWithoutInventory(state)
  const productType = state?.productType || "simple"

  let recipeLine
  if (productType === "pizza") {
    const count = state?.variants?.length || 0
    recipeLine = {
      ok: count > 0,
      label: count > 0 ? `✓ ${count} tamaños activos` : "✗ Sin tamaños activos"
    }
  } else if (productType === "configurable") {
    const count = state?.optionGroups?.length || 0
    recipeLine = {
      ok: count > 0,
      label: count > 0 ? `✓ ${count} grupos activos` : "✗ Sin grupos activos"
    }
  } else if (saleWithoutInventory && !state?.recipe) {
    recipeLine = { ok: true, label: "✓ Receta no requerida" }
  } else if (state?.recipe) {
    recipeLine = { ok: true, label: "✓ Receta conectada" }
  } else {
    recipeLine = { ok: false, label: "✗ Sin receta" }
  }

  const areaLine = {
    ok: Boolean(state?.area),
    label: state?.area ? "✓ Área producción configurada" : "✗ Sin área"
  }

  let statusLine
  if (productType === "configurable") {
    if (state?.productionReady) {
      statusLine = { ok: true, label: "✓ Listo para producción" }
    } else if (!state?.area) {
      statusLine = { ok: false, label: "✗ Pendiente configuración KDS" }
    } else {
      statusLine = { ok: false, label: "✗ Configuración incompleta" }
    }
  } else if (saleWithoutInventory) {
    statusLine = {
      ok: Boolean(state?.saleAllowed && state?.area && state?.category),
      label: state?.saleAllowed && state?.area && state?.category
        ? "✓ Listo para venta sin inventario"
        : "✗ Pendiente configuración KDS"
    }
  } else if (state?.productionReady) {
    statusLine = { ok: true, label: "✓ Listo para producción" }
  } else if (state?.saleAllowed && !state?.inventoryWillDeduct) {
    statusLine = { ok: true, label: "✓ Listo para venta sin inventario" }
  } else {
    statusLine = { ok: false, label: "✗ Pendiente validación" }
  }

  return [recipeLine, areaLine, statusLine]
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
  const hasArea = Boolean(productionState?.area || productionState?.areaId)
  const hasCategory = Boolean(productionState?.category || productionState?.categoryId)
  const recipeRequired = product?.recipeRequiredForSale === true
    || product?.recipe_required_for_sale === true

  const blockers = []
  if (!active) blockers.push("Producto inactivo")
  if (!hasCategory) blockers.push("Sin categoría activa")
  if (!hasArea) blockers.push("Sin destino KDS")

  const productType = productionState?.productType || product?.productType || product?.product_type || "simple"

  if (productType === "configurable") {
    blockers.push("Venta configurable disponible en la siguiente fase del POS")
  } else if (strict || recipeRequired) {
    if (!productionState?.productionReady) {
      blockers.push(...(productionState?.issues || ["No validado para producción"]))
    }
  } else if (!testItem) {
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
    issues: blockers.length ? [...(productionState?.issues || []), ...blockers] : (productionState?.issues || []),
    skipInventoryWarning: saleAllowed
      ? getInventorySkipWarning(product, deductionMode)
      : "",
    recipeStatus: getProductRecipeStatus(product),
    inventoryTrackingEnabled: productHasInventoryTracking(product)
  }
}

export function catalogImplementationStatusLabel(state) {
  const productType = state?.productType || "simple"
  if (!state?.active) return "Inactivo"
  if (productType === "configurable") {
    if (!state?.area) return "Pendiente KDS"
    if (state?.productionReady) return "Configurable · Fase 2"
    return "Configuración incompleta"
  }
  if (!state?.saleAllowed && !state?.productionReady) return "Pendiente KDS"
  if (state?.inventoryWillDeduct) return "Venta + inventario"
  if (state?.saleAllowed || state?.productionReady) return "Venta sin inventario"
  return "Pendiente KDS"
}
