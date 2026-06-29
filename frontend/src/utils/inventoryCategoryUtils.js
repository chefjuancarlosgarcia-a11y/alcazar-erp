const LEGACY_PREFIX = "legacy:"

export function slugifyInventoryCategoryCode(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
}

export function normalizeInventoryCategoryLabel(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

export function resolveInventoryCategoryCode(storedValue, categories = []) {
  const value = String(storedValue || "").trim()
  if (!value) return ""
  const byCode = categories.find((category) => category.code === value)
  if (byCode) return byCode.code
  const byName = categories.find(
    (category) => normalizeInventoryCategoryLabel(category.name) === normalizeInventoryCategoryLabel(value)
  )
  if (byName) return byName.code
  return `${LEGACY_PREFIX}${value}`
}

export function resolveInventoryCategoryName(formValue, categories = []) {
  const value = String(formValue || "").trim()
  if (!value) return ""
  if (value.startsWith(LEGACY_PREFIX)) return value.slice(LEGACY_PREFIX.length)
  const match = categories.find((category) => category.code === value)
  return match?.name || value
}

export function buildInventoryCategoryOptions(categories = [], currentStoredValue = "") {
  const activeCategories = categories.filter((category) => category.isActive !== false)
  const options = [...activeCategories]
  const resolvedCode = resolveInventoryCategoryCode(currentStoredValue, categories)
  if (
    resolvedCode.startsWith(LEGACY_PREFIX) &&
    !options.some((category) => category.code === resolvedCode)
  ) {
    options.push({
      id: resolvedCode,
      code: resolvedCode,
      name: `${currentStoredValue} (actual)`,
      isLegacy: true,
      isActive: true,
      sortOrder: 9999
    })
  }
  return options.sort(
    (left, right) =>
      Number(left.sortOrder || 0) - Number(right.sortOrder || 0) ||
      String(left.name || "").localeCompare(String(right.name || ""), "es")
  )
}

export function isLegacyInventoryCategoryCode(code) {
  return String(code || "").startsWith(LEGACY_PREFIX)
}
