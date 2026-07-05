export const OPTION_SELECTION_MODES = [
  { id: "single", label: "Única" },
  { id: "multiple", label: "Múltiple" }
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
    errors.push("Activa al menos un grupo de opciones.")
    return { valid: false, errors }
  }

  groups.forEach((group, groupIndex) => {
    const label = group.name?.trim() || `Grupo ${groupIndex + 1}`
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
