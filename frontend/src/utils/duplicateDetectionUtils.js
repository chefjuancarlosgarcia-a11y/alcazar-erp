import { barcodesMatch, normalizeBarcode } from "./barcodeUtils"

const STOP_WORDS = new Set([
  "kg", "kgs", "kilogramo", "kilogramos", "kilos", "kilo",
  "lb", "lbs", "libra", "libras",
  "unidad", "unidades", "und", "u",
  "bolsa", "bolsas", "caja", "cajas", "paquete", "paquetes",
  "lata", "latas", "botella", "botellas", "galon", "galones",
  "litro", "litros", "ml", "gr", "gramo", "gramos", "g"
])

export const CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low"
}

export const CONFIDENCE_LABELS = {
  high: "Alta confianza",
  medium: "Media confianza",
  low: "Baja confianza"
}

export function normalizeProductName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function singularizeToken(token) {
  const word = String(token || "").trim()
  if (word.length <= 3) return word
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2)
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1)
  return word
}

export function tokenizeProductName(value) {
  return normalizeProductName(value)
    .split(" ")
    .map(singularizeToken)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
}

function levenshtein(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  return matrix[a.length][b.length]
}

export function nameSimilarity(left, right) {
  const normA = normalizeProductName(left)
  const normB = normalizeProductName(right)
  if (!normA || !normB) return 0
  if (normA === normB) return 1

  const tokensA = tokenizeProductName(left)
  const tokensB = tokenizeProductName(right)
  if (!tokensA.length || !tokensB.length) {
    const maxLen = Math.max(normA.length, normB.length)
    return maxLen ? 1 - levenshtein(normA, normB) / maxLen : 0
  }

  const setB = new Set(tokensB)
  const intersection = tokensA.filter((token) => setB.has(token)).length
  const union = new Set([...tokensA, ...tokensB]).size
  const jaccard = union ? intersection / union : 0
  const maxLen = Math.max(normA.length, normB.length)
  const editScore = maxLen ? 1 - levenshtein(normA, normB) / maxLen : 0
  return Math.max(jaccard, editScore)
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase()
}

export function canonicalPairKey(idA, idB) {
  return [idA, idB].sort().join("::")
}

function classifyPair(itemA, itemB, similarity, reasons) {
  if (reasons.includes("exact_name") || reasons.includes("same_sku") || reasons.includes("same_barcode")) {
    return CONFIDENCE.HIGH
  }
  if (reasons.includes("same_supplier_name") || similarity >= 0.82) {
    return CONFIDENCE.MEDIUM
  }
  return CONFIDENCE.LOW
}

function pairReasons(itemA, itemB, similarity) {
  const reasons = []
  const nameA = normalizeProductName(itemA.name)
  const nameB = normalizeProductName(itemB.name)

  if (nameA && nameA === nameB) reasons.push("exact_name")
  if (similarity >= 0.72) reasons.push("similar_name")

  const skuA = normalizeSku(itemA.sku)
  const skuB = normalizeSku(itemB.sku)
  if (skuA && skuB && skuA === skuB) reasons.push("same_sku")

  if (barcodesMatch(itemA.barcode, itemB.barcode)) reasons.push("same_barcode")

  const supplierA = normalizeProductName(itemA.supplier)
  const supplierB = normalizeProductName(itemB.supplier)
  if (supplierA && supplierB && supplierA === supplierB && similarity >= 0.65) {
    reasons.push("same_supplier_name")
  }

  const categoryA = normalizeProductName(itemA.category)
  const categoryB = normalizeProductName(itemB.category)
  const unitA = normalizeProductName(itemA.base_unit || itemA.purchase_unit)
  const unitB = normalizeProductName(itemB.base_unit || itemB.purchase_unit)
  if (categoryA && categoryB && categoryA === categoryB && unitA && unitA === unitB && similarity >= 0.58) {
    reasons.push("same_category_unit_name")
  }

  return reasons
}

class UnionFind {
  constructor(ids) {
    this.parent = Object.fromEntries(ids.map((id) => [id, id]))
  }

  find(id) {
    if (this.parent[id] !== id) {
      this.parent[id] = this.find(this.parent[id])
    }
    return this.parent[id]
  }

  union(a, b) {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA !== rootB) this.parent[rootB] = rootA
  }
}

function isOperationalItem(item) {
  return item && item.active !== false && !item.merged_into_item_id
}

export function detectDuplicateGroups(items = [], ignoredPairs = new Set()) {
  const operational = items.filter(isOperationalItem)
  const pairs = []

  for (let i = 0; i < operational.length; i += 1) {
    for (let j = i + 1; j < operational.length; j += 1) {
      const itemA = operational[i]
      const itemB = operational[j]
      const pairKey = canonicalPairKey(itemA.id, itemB.id)
      if (ignoredPairs.has(pairKey)) continue

      const similarity = nameSimilarity(itemA.name, itemB.name)
      const reasons = pairReasons(itemA, itemB, similarity)
      if (!reasons.length) continue

      const sameSku = reasons.includes("same_sku")
      const sameBarcode = reasons.includes("same_barcode")
      const exactName = reasons.includes("exact_name")
      const strongFuzzy = similarity >= 0.85
      const supplierFuzzy = reasons.includes("same_supplier_name")
      const categoryFuzzy = reasons.includes("same_category_unit_name")

      if (!(exactName || sameSku || sameBarcode || strongFuzzy || supplierFuzzy || categoryFuzzy)) {
        continue
      }

      pairs.push({
        itemA,
        itemB,
        similarity,
        reasons,
        confidence: classifyPair(itemA, itemB, similarity, reasons)
      })
    }
  }

  const uf = new UnionFind(operational.map((item) => item.id))
  pairs.forEach(({ itemA, itemB }) => uf.union(itemA.id, itemB.id))

  const groupsMap = new Map()
  operational.forEach((item) => {
    const root = uf.find(item.id)
    if (!groupsMap.has(root)) groupsMap.set(root, [])
    groupsMap.get(root).push(item)
  })

  const pairMeta = new Map()
  pairs.forEach((pair) => {
    const key = canonicalPairKey(pair.itemA.id, pair.itemB.id)
    pairMeta.set(key, pair)
  })

  return Array.from(groupsMap.values())
    .filter((group) => group.length > 1)
    .map((group) => {
      const groupPairs = []
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const key = canonicalPairKey(group[i].id, group[j].id)
          if (pairMeta.has(key)) groupPairs.push(pairMeta.get(key))
        }
      }
      const confidenceRank = { high: 3, medium: 2, low: 1 }
      const confidence = groupPairs.reduce(
        (best, pair) => (confidenceRank[pair.confidence] > confidenceRank[best] ? pair.confidence : best),
        CONFIDENCE.LOW
      )
      const reasons = Array.from(new Set(groupPairs.flatMap((pair) => pair.reasons)))
      const maxSimilarity = groupPairs.reduce((max, pair) => Math.max(max, pair.similarity), 0)
      return {
        id: group.map((item) => item.id).sort().join("-"),
        items: group.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es")),
        confidence,
        reasons,
        maxSimilarity,
        pairs: groupPairs
      }
    })
    .sort((a, b) => {
      const rank = { high: 3, medium: 2, low: 1 }
      if (rank[b.confidence] !== rank[a.confidence]) return rank[b.confidence] - rank[a.confidence]
      return b.items.length - a.items.length
    })
}

export function reasonLabels(reasons = []) {
  const map = {
    exact_name: "Nombre exacto",
    similar_name: "Nombre similar",
    same_sku: "Mismo SKU",
    same_barcode: "Mismo código de barras",
    same_supplier_name: "Mismo proveedor + nombre parecido",
    same_category_unit_name: "Misma categoría/unidad + nombre parecido"
  }
  return reasons.map((reason) => map[reason] || reason)
}

export function formatItemSummary(item) {
  if (!item) return {}
  return {
    id: item.id,
    name: item.name || "Sin nombre",
    sku: item.sku || "—",
    barcode: item.barcode || "—",
    category: item.category || "—",
    supplier: item.supplier || "—",
    purchaseUnit: item.purchase_unit || "—",
    baseUnit: item.base_unit || "—",
    stock: Number(item.totalQuantity || 0),
    cost: Number(item.cost_per_base_unit || 0),
    updatedAt: item.updated_at || null,
    imageUrl: item.image_url || "",
    mergedInto: item.merged_into_item_id || null,
    active: item.active !== false
  }
}

export function buildMergePreview(master, duplicate) {
  const masterCost = Number(master?.cost_per_base_unit || 0)
  const duplicateCost = Number(duplicate?.cost_per_base_unit || 0)
  const costDiff = Math.abs(masterCost - duplicateCost)
  const costWarning = masterCost > 0 && duplicateCost > 0 && costDiff / Math.max(masterCost, duplicateCost) > 0.25

  return {
    name: master?.name,
    category: master?.category,
    supplier: master?.supplier || duplicate?.supplier,
    purchaseUnit: master?.purchase_unit,
    baseUnit: master?.base_unit,
    cost: masterCost,
    costWarning,
    duplicateCost,
    sku: master?.sku || duplicate?.sku,
    barcode: master?.barcode || duplicate?.barcode,
    imageUrl: master?.image_url || duplicate?.image_url,
    notes: [master?.notes, duplicate?.notes].filter(Boolean).join("\n")
  }
}

export function usageCountSummary(usage = {}) {
  return Object.entries(usage).reduce((sum, [, count]) => sum + Number(count || 0), 0)
}

export const USAGE_FIELD_LABELS = {
  requisition_items: "Requisiciones",
  recipe_ingredients: "Recetas",
  standard_recipes_output: "Recetas (producto final)",
  inventory_movements: "Movimientos",
  purchase_orders: "Órdenes de compra",
  production_batch_inputs: "Producción",
  production_batch_outputs: "Producción",
  production_batches: "Producción",
  inventory_item_unit_conversions: "Conversiones",
  yield_audits: "Rendimientos",
  yield_audit_campaign_items: "Rendimientos"
}

const USAGE_DISPLAY_ORDER = [
  "inventory_movements",
  "recipe_ingredients",
  "standard_recipes_output",
  "requisition_items",
  "purchase_orders",
  "production_batch_inputs",
  "production_batch_outputs",
  "production_batches",
  "inventory_item_unit_conversions",
  "yield_audits",
  "yield_audit_campaign_items"
]

export function formatUsageForDisplay(usage = {}) {
  const rows = Object.entries(usage).map(([key, count]) => ({
    key,
    label: USAGE_FIELD_LABELS[key] || "Otros",
    count: Number(count || 0)
  }))

  const merged = new Map()
  rows.forEach((row) => {
    if (row.count <= 0) return
    const existing = merged.get(row.label)
    if (existing) existing.count += row.count
    else merged.set(row.label, { ...row })
  })

  return Array.from(merged.values()).sort((a, b) => {
    const indexA = USAGE_DISPLAY_ORDER.findIndex((key) => USAGE_FIELD_LABELS[key] === a.label)
    const indexB = USAGE_DISPLAY_ORDER.findIndex((key) => USAGE_FIELD_LABELS[key] === b.label)
    return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB)
  })
}

export function summarizeUsageForItems(usageMap = {}, itemIds = []) {
  const totals = {}
  itemIds.forEach((itemId) => {
    const usage = usageMap[itemId] || {}
    Object.entries(usage).forEach(([key, count]) => {
      totals[key] = (totals[key] || 0) + Number(count || 0)
    })
  })
  return formatUsageForDisplay(totals)
}

export function suggestPrimaryName(items = []) {
  if (!items.length) return "Grupo sin nombre"
  return [...items].sort((a, b) => {
    const stockDiff = Number(b.totalQuantity || 0) - Number(a.totalQuantity || 0)
    if (stockDiff !== 0) return stockDiff
    return String(a.name || "").length - String(b.name || "").length
  })[0]?.name || "Sin nombre"
}

export function getItemStatusBadges(item, usage = {}, { isMaster = false } = {}) {
  const badges = []
  if (isMaster) badges.push({ key: "master", label: "Maestro seleccionado", tone: "success" })
  const stock = Number(item?.totalQuantity || 0)
  if (stock > 0) badges.push({ key: "stock", label: "Tiene stock", tone: "info" })
  if (!String(item?.barcode || "").trim()) badges.push({ key: "no-barcode", label: "Sin barcode", tone: "warn" })
  if (!String(item?.supplier || "").trim()) badges.push({ key: "no-supplier", label: "Sin proveedor", tone: "muted" })
  const totalUsage = usageCountSummary(usage)
  if (totalUsage >= 5) badges.push({ key: "high-use", label: "Muy usado", tone: "accent" })
  else if (totalUsage === 0) badges.push({ key: "low-use", label: "Bajo uso", tone: "muted" })
  return badges
}

export function buildGroupMergeSimulation(master, duplicates = [], usageMap = {}) {
  if (!master) return null

  const duplicateList = duplicates.filter(Boolean)
  const estimatedStock = duplicateList.reduce(
    (sum, item) => sum + Number(item.totalQuantity || 0),
    Number(master.totalQuantity || 0)
  )

  const masterCost = Number(master.cost_per_base_unit || 0)
  const costWarning = duplicateList.some((item) => {
    const duplicateCost = Number(item.cost_per_base_unit || 0)
    return masterCost > 0 && duplicateCost > 0
      && Math.abs(masterCost - duplicateCost) / Math.max(masterCost, duplicateCost) > 0.25
  })

  let primaryBarcode = String(master.barcode || "").trim()
  const barcodeAliases = []
  duplicateList.forEach((item) => {
    const code = String(item.barcode || "").trim()
    if (!code) return
    if (!primaryBarcode) {
      primaryBarcode = code
      return
    }
    if (!barcodesMatch(code, primaryBarcode)) barcodeAliases.push(code)
  })

  const sku = String(master.sku || "").trim()
    || duplicateList.map((item) => String(item.sku || "").trim()).find(Boolean)
    || "—"

  const imageUrl = master.image_url
    || duplicateList.map((item) => item.image_url).find(Boolean)
    || ""

  const referencesMoving = summarizeUsageForItems(usageMap, duplicateList.map((item) => item.id))
  const referencesTotal = summarizeUsageForItems(usageMap, [master.id, ...duplicateList.map((item) => item.id)])

  return {
    masterName: master.name || "Sin nombre",
    mergeCount: duplicateList.length,
    estimatedStock,
    cost: masterCost,
    costWarning,
    sku: sku || "—",
    barcode: primaryBarcode || "—",
    barcodeAliases: [...new Set(barcodeAliases)],
    imageUrl,
    referencesMoving,
    referencesTotal,
    referencesMovingCount: referencesMoving.reduce((sum, row) => sum + row.count, 0)
  }
}
