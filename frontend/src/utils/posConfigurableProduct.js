/*
 * FUTURE — Mitad y mitad (venta configurable, sin schema aún):
 * Pizza: tamaño; completa vs mitad y mitad; mitad izq/der sabor; precio; receta proporcional por mitad.
 * Alitas: cantidad; un sabor vs mitad y mitad; ej. 10 alitas = 5 BBQ + 5 Buffalo; receta proporcional por sabor.
 */

export const OPTION_SELECTION_MODES = [
  { id: "single", label: "Selección única" },
  { id: "multiple", label: "Selección múltiple" }
]

export const OPTION_PRICE_MODES = [
  { id: "absolute", label: "Precio base" },
  { id: "delta", label: "Cargo adicional" },
  { id: "none", label: "Sin cargo" }
]

export function createEmptyOptionChoice(index = 0) {
  return {
    id: "",
    name: "",
    sortOrder: index,
    priceMode: "none",
    price_mode: "none",
    price: "",
    recipeId: "",
    isActive: true
  }
}

export function createEmptyOptionGroup(index = 0) {
  return {
    id: "",
    name: "",
    sortOrder: index,
    required: true,
    selectionMode: "single",
    selection_mode: "single",
    minSelections: 1,
    maxSelections: 1,
    isActive: true,
    choices: [createEmptyOptionChoice(0)]
  }
}

export function normalizeOptionChoiceDraft(choice, index = 0) {
  const priceMode = choice.priceMode || choice.price_mode || "none"
  return {
    id: choice.id || "",
    name: choice.name || "",
    sortOrder: Number(choice.sortOrder ?? choice.sort_order ?? index),
    priceMode,
    price_mode: priceMode,
    price: choice.price != null ? String(choice.price) : "",
    recipeId: choice.recipeId || choice.recipe_id || "",
    isActive: choice.isActive !== false && choice.is_active !== false
  }
}

export function normalizeOptionGroupDraft(group, index = 0) {
  const selectionMode = group.selectionMode || group.selection_mode || "single"
  const choices = Array.isArray(group.choices)
    ? group.choices.map(normalizeOptionChoiceDraft)
    : Array.isArray(group.option_choices)
      ? group.option_choices.map(normalizeOptionChoiceDraft)
      : [createEmptyOptionChoice(0)]
  return {
    id: group.id || "",
    name: group.name || "",
    sortOrder: Number(group.sortOrder ?? group.sort_order ?? index),
    required: group.required === true,
    selectionMode,
    selection_mode: selectionMode,
    minSelections: Number(group.minSelections ?? group.min_selections ?? (selectionMode === "single" ? 1 : 0)),
    maxSelections: group.maxSelections ?? group.max_selections ?? (selectionMode === "single" ? 1 : null),
    isActive: group.isActive !== false && group.is_active !== false,
    choices: choices.length ? choices : [createEmptyOptionChoice(0)]
  }
}

export function getActiveOptionGroups(product) {
  const groups = product?.optionGroups || product?.option_groups || []
  return groups.filter((group) => group.isActive !== false && group.is_active !== false)
}

/** Conteo de decisiones activas: hijos en memoria o resumen del listado paginado (RPC). */
export function getActiveOptionGroupsCount(product) {
  const hydratedCount = getActiveOptionGroups(product).length
  if (hydratedCount > 0) return hydratedCount
  const serverCount = product?.activeOptionGroupsCount ?? product?.active_option_groups_count
  if (serverCount != null) return Number(serverCount) || 0
  return hydratedCount
}

/**
 * El listado paginado no carga pos_option_groups; solo filas base de pos_products.
 * Sin este check, validateConfigurableCatalogForm([]) marca todo como incompleto.
 */
export function areOptionGroupsHydrated(product) {
  const groups = product?.optionGroups || product?.option_groups || []
  if (groups.length > 0) return true
  const serverCount = product?.activeOptionGroupsCount ?? product?.active_option_groups_count
  if (serverCount != null) return serverCount === 0
  return product?.optionGroupsHydrated === true || product?.option_groups_hydrated === true
}

/**
 * Diagnóstico de catálogo configurable: validación completa si hay hijos cargados;
 * si no, confía en production_ready (pos_configurable_catalog_is_valid en BD).
 */
export function evaluateConfigurableCatalogReadiness(product, { active = true } = {}) {
  const optionGroups = product?.optionGroups || product?.option_groups || []
  const hydrated = areOptionGroupsHydrated(product)
  const dbProductionReady = product?.productionReady === true || product?.production_ready === true
  const activeOptionGroupsCount = getActiveOptionGroupsCount(product)
  const issues = []

  if (hydrated) {
    const { valid, errors } = validateConfigurableCatalogForm(optionGroups, { active })
    if (!valid) issues.push(...errors)
    return {
      issues,
      productionReady: active && dbProductionReady && issues.length === 0,
      activeOptionGroupsCount,
      optionGroupsHydrated: true
    }
  }

  if (active && !dbProductionReady) {
    if (activeOptionGroupsCount === 0) {
      issues.push("Agrega al menos una decisión activa.")
    } else {
      issues.push("Configuración de opciones incompleta")
    }
  }

  return {
    issues,
    productionReady: active && dbProductionReady && issues.length === 0,
    activeOptionGroupsCount,
    optionGroupsHydrated: false
  }
}

export function getActiveOptionChoices(group) {
  return (group?.choices || []).filter((choice) => {
    if (choice.isActive === false || choice.is_active === false) return false
    return String(choice.name || "").trim().length > 0
  })
}

export function getOptionGroupKey(group) {
  return String(group?.id || group?.name || "")
}

export function buildDefaultOptionSelections(product) {
  const selections = {}
  getActiveOptionGroups(product).forEach((group) => {
    const groupKey = getOptionGroupKey(group)
    const choices = getActiveOptionChoices(group)
    const selectionMode = group.selectionMode || group.selection_mode || "single"
    if (selectionMode === "single") {
      selections[groupKey] = group.required && choices.length ? String(choices[0].id || choices[0].name) : ""
    } else {
      selections[groupKey] = []
    }
  })
  return selections
}

export function getSelectedChoiceIdsForGroup(optionSelections, group) {
  const raw = optionSelections?.[getOptionGroupKey(group)]
  if (Array.isArray(raw)) return raw.filter(Boolean).map(String)
  if (raw) return [String(raw)]
  return []
}

export function resolveSelectedChoicePairs(product, optionSelections = {}) {
  const pairs = []
  getActiveOptionGroups(product).forEach((group) => {
    const choices = getActiveOptionChoices(group)
    getSelectedChoiceIdsForGroup(optionSelections, group).forEach((selectedId) => {
      const choice = choices.find((entry) => String(entry.id) === selectedId || String(entry.name) === selectedId)
      if (choice) pairs.push({ group, choice })
    })
  })
  return pairs
}

export function validateConfigurableSaleSelections(product, optionSelections = {}) {
  const errors = []
  getActiveOptionGroups(product).forEach((group, groupIndex) => {
    const label = group.name?.trim() || `Decisión ${groupIndex + 1}`
    const selectionMode = group.selectionMode || group.selection_mode || "single"
    const selectedCount = getSelectedChoiceIdsForGroup(optionSelections, group).length
    const minSelections = Number(group.minSelections ?? group.min_selections ?? (group.required && selectionMode === "single" ? 1 : 0))
    const maxSelections = group.maxSelections ?? group.max_selections ?? (selectionMode === "single" ? 1 : null)

    if (group.required && selectedCount === 0) {
      errors.push(`Selecciona ${label}.`)
    }
    if (selectedCount > 0 && selectedCount < minSelections) {
      errors.push(`${label}: elige al menos ${minSelections} opción(es).`)
    }
    if (maxSelections != null && selectedCount > Number(maxSelections)) {
      errors.push(`${label}: máximo ${maxSelections} opción(es).`)
    }
  })
  return { valid: errors.length === 0, errors }
}

export function computeConfigurableUnitPrice(product, optionSelections = {}) {
  const pairs = resolveSelectedChoicePairs(product, optionSelections)
  let absoluteTotal = 0
  let hasAbsolute = false
  let deltaTotal = 0

  pairs.forEach(({ choice }) => {
    const priceMode = choice.priceMode || choice.price_mode || "none"
    const price = Number(choice.price ?? 0)
    if (priceMode === "absolute" && price > 0) {
      absoluteTotal += price
      hasAbsolute = true
    }
    if (priceMode === "delta") {
      deltaTotal += price
    }
  })

  if (hasAbsolute) return absoluteTotal + deltaTotal
  return Number(product?.precio ?? product?.price ?? 0) + deltaTotal
}

export function serializeSelectedOptionsForOrder(product, optionSelections = {}) {
  return resolveSelectedChoicePairs(product, optionSelections).map(({ group, choice }) => ({
    group_id: group.id || null,
    group_name: group.name,
    choice_id: choice.id || null,
    choice_name: choice.name,
    price_mode: choice.priceMode || choice.price_mode || "none",
    price: Number(choice.price ?? 0),
    recipe_id: choice.recipeId || choice.recipe_id || null
  }))
}

export function formatConfigurableModifierLabels(selectedOptions = []) {
  return (selectedOptions || []).map((option) => {
    const groupName = option.group_name || option.groupName
    const choiceName = option.choice_name || option.choiceName
    return groupName ? `${groupName}: ${choiceName}` : choiceName
  }).filter(Boolean)
}

export function buildConfigurableProductName(product, selectedOptions = []) {
  const labels = (selectedOptions || []).map((option) => option.choice_name || option.choiceName).filter(Boolean)
  const baseName = product?.nombre || product?.name || "Producto"
  if (!labels.length) return baseName
  return `${baseName} (${labels.join(", ")})`
}

export function optionSelectionsSignature(selectedOptions = []) {
  return JSON.stringify(
    (selectedOptions || [])
      .map((option) => `${option.group_id || option.groupId}:${option.choice_id || option.choiceId}`)
      .sort()
  )
}

export function getConfigurableDisplayPrice(product) {
  const groups = getActiveOptionGroups(product)
  const absolutePrices = groups.flatMap((group) => (group.choices || [])
    .filter((choice) => (choice.isActive !== false && choice.is_active !== false)
      && (choice.priceMode || choice.price_mode) === "absolute")
    .map((choice) => Number(choice.price ?? 0))
    .filter((price) => price > 0))
  if (absolutePrices.length) return Math.min(...absolutePrices)
  return Number(product?.precio ?? product?.price ?? 0)
}

export function validateConfigurableCatalogForm(optionGroups = [], { active = true } = {}) {
  const errors = []
  if (!active) return { valid: true, errors }

  const groups = (optionGroups || []).filter((group) => group.isActive !== false)
  if (groups.length === 0) {
    errors.push("Agrega al menos una decisión activa.")
    return { valid: false, errors }
  }

  groups.forEach((group, groupIndex) => {
    const label = group.name?.trim() || `Decisión ${groupIndex + 1}`
    const selectionMode = group.selectionMode || group.selection_mode || "single"
    const activeChoices = (group.choices || []).filter((choice) => {
      if (choice.isActive === false) return false
      return String(choice.name || "").trim().length > 0
    })

    if (group.required && activeChoices.length === 0) {
      errors.push(`${label}: agrega al menos una opción activa.`)
    }

    if (selectionMode === "single") {
      const maxSelections = group.maxSelections ?? group.max_selections
      if (maxSelections != null && Number(maxSelections) !== 1) {
        errors.push(`${label}: la selección única debe permitir máximo 1 opción.`)
      }
    }

    activeChoices.forEach((choice, choiceIndex) => {
      const choiceLabel = choice.name?.trim() || `Opción ${choiceIndex + 1}`
      const priceMode = choice.priceMode || choice.price_mode || "none"
      if (priceMode === "absolute" && Number(choice.price || 0) <= 0) {
        errors.push(`${label} / ${choiceLabel}: el precio base debe ser mayor que cero.`)
      }
      if (priceMode === "delta" && Number(choice.price || 0) < 0) {
        errors.push(`${label} / ${choiceLabel}: el cargo adicional no puede ser negativo.`)
      }
    })
  })

  return { valid: errors.length === 0, errors }
}

export function serializeConfigurableGroupsForSave(optionGroups = []) {
  return (optionGroups || [])
    .filter((group) => String(group.name || "").trim())
    .map((group, groupIndex) => {
      const selectionMode = group.selectionMode || group.selection_mode || "single"
      return {
        id: group.id || null,
        name: String(group.name || "").trim(),
        sort_order: Number(group.sortOrder ?? group.sort_order ?? groupIndex),
        required: group.required === true,
        selection_mode: selectionMode,
        min_selections: Number(group.minSelections ?? group.min_selections ?? (selectionMode === "single" ? 1 : 0)),
        max_selections: selectionMode === "single"
          ? 1
          : (group.maxSelections ?? group.max_selections ?? null),
        is_active: group.isActive !== false,
        choices: (group.choices || [])
          .filter((choice) => String(choice.name || "").trim())
          .map((choice, choiceIndex) => ({
            id: choice.id || null,
            name: String(choice.name || "").trim(),
            sort_order: Number(choice.sortOrder ?? choice.sort_order ?? choiceIndex),
            price_mode: choice.priceMode || choice.price_mode || "none",
            price: Number(choice.price ?? 0),
            recipe_id: choice.recipeId || choice.recipe_id || null,
            is_active: choice.isActive !== false
          }))
      }
    })
}
