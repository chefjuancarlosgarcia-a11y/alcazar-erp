import { supabase } from "../lib/supabase"
import { CACHE_KEYS, CACHE_TTL } from "./cacheConfig"
import { cachedQuery, invalidateQueryCache } from "./queryCache"
import {
  classifyCatalogError,
  logCatalogLoadResult,
  logCatalogSaveAttempt,
  logCatalogSaveResult,
  logCatalogVerifyResult,
  measureInlineImage
} from "../utils/posCatalogDiagnostics"
import { isInlineImageValue } from "../utils/posProductImage"
import { estimatePayloadBytes, logPosCatalogPerf } from "../utils/posCatalogPerformance"
import { resolvePOSProductImageForSave } from "./posProductImagesService"
import {
  serializeConfigurableGroupsForSave,
  validateConfigurableCatalogForm
} from "../utils/posConfigurableProduct"

const CATALOG_PAGE_SIZE_DEFAULT = 50
const SALE_PRODUCTS_LIMIT = 500

const optionChoiceSelect = `
  id,
  group_id,
  name,
  sort_order,
  price_mode,
  price,
  recipe_id,
  is_active,
  created_at,
  updated_at,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active)
`

/** Detalle individual (edición/diagnóstico) — incluye recetas anidadas. */
const productSelect = `
  *,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active),
  production_area:areas(id, name, active, is_production_area),
  variants:pos_product_variants(
    id,
    product_id,
    name,
    size,
    price,
    recipe_id,
    production_area_id,
    prep_time_minutes,
    is_active,
    sort_order,
    created_at,
    updated_at,
    recipe:standard_recipes(id, name, recipe_type, production_area_id, active)
  ),
  modifier_options:pos_product_modifiers(
    id,
    product_id,
    name,
    modifier_type,
    price_delta,
    is_active,
    sort_order,
    created_at,
    updated_at
  ),
  option_groups:pos_option_groups(
    id,
    product_id,
    name,
    sort_order,
    required,
    selection_mode,
    min_selections,
    max_selections,
    is_active,
    created_at,
    updated_at,
    choices:pos_option_choices(${optionChoiceSelect})
  )
`

const IN_CHUNK_SIZE = 80

/** Listado admin/mesero — sin image_url ni description (evita timeout por base64). */
const PRODUCT_LIST_COLUMNS = [
  "id",
  "name",
  "price",
  "category_id",
  "category_name",
  "recipe_id",
  "production_area_id",
  "active",
  "production_ready",
  "sort_order",
  "product_type",
  "is_test_item",
  "inventory_tracking_enabled",
  "recipe_required_for_sale",
  "recipe_status",
  "allow_kitchen_notes",
  "prep_time_minutes",
  "created_at",
  "updated_at"
].join(",")

/** Detalle individual — description only; image_url se carga lazy al editar. */
const PRODUCT_DETAIL_COLUMNS = [
  ...PRODUCT_LIST_COLUMNS.split(","),
  "description"
].join(",")

const productListSelect = `
  *,
  recipe:standard_recipes(id, name, recipe_type, production_area_id, active),
  production_area:areas(id, name, active, is_production_area)
`

const variantListColumns = "id, product_id, name, size, price, recipe_id, production_area_id, prep_time_minutes, is_active, sort_order"
const modifierListColumns = "id, product_id, name, modifier_type, price_delta, is_active, sort_order"
const optionGroupListColumns = 'id, product_id, name, sort_order, "required", selection_mode, min_selections, max_selections, is_active'
const optionChoiceListColumns = "id, group_id, name, sort_order, price_mode, price, recipe_id, is_active"

function isMissingRelationError(error) {
  const message = String(error?.message || "")
  return /does not exist|could not find|schema cache|PGRST/i.test(message)
}

function isHeavyQueryError(error) {
  const message = String(error?.message || "")
  return /timeout|canceling statement|57014|internal server error/i.test(message)
}

function groupRowsByKey(rows, key) {
  const map = new Map()
  for (const row of rows || []) {
    const groupKey = row?.[key]
    if (groupKey == null) continue
    if (!map.has(groupKey)) map.set(groupKey, [])
    map.get(groupKey).push(row)
  }
  return map
}

async function queryInChunks(table, columns, filterColumn, ids, orderColumn = "sort_order") {
  if (!ids.length) return { data: [], error: null }
  const allRows = []
  for (let index = 0; index < ids.length; index += IN_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + IN_CHUNK_SIZE)
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(filterColumn, chunk)
      .order(orderColumn, { ascending: true })
    if (error) {
      if (isHeavyQueryError(error)) {
        console.warn(`[POS] ${table}: timeout al cargar hijos del catálogo, se omite`, error.message)
        return { data: allRows, error: null }
      }
      return { data: [], error }
    }
    allRows.push(...(data || []))
  }
  return { data: allRows, error: null }
}

async function fetchProductRows(filters = {}, { columns = PRODUCT_LIST_COLUMNS, limit = null } = {}) {
  let query = supabase.from("pos_products").select(columns, limit != null ? { count: "exact" } : undefined)
  if (filters.active === true) query = query.eq("active", true)
  if (filters.active === false) query = query.eq("active", false)
  if (filters.productionReady) query = query.eq("production_ready", true)
  if (filters.categoryId) query = query.eq("category_id", filters.categoryId)
  if (filters.search) {
    const term = `%${filters.search.trim()}%`
    query = query.or(`name.ilike.${term},category_name.ilike.${term}`)
  }
  query = query.order("sort_order", { ascending: true }).order("name", { ascending: true })
  if (limit != null) query = query.range(0, Math.max(0, limit - 1))
  return query
}

function mapListRowFromSupabase(row) {
  if (!row) return row
  const mapped = mapPOSProductFromSupabase({
    ...row,
    description: row.description || "",
    image_url: row.image_url || "",
    variants: row.variants || [],
    modifier_options: row.modifier_options || [],
    option_groups: row.option_groups || []
  })
  mapped.hasImage = row.has_image === true || Boolean(row.has_image)
  mapped.imageInlineBytes = row.image_inline_bytes ?? null
  return mapped
}

export async function diagnosePOSCatalogHealth() {
  const { data, error } = await supabase.rpc("diagnose_pos_catalog_health")
  return { data, error, errorKind: error ? classifyCatalogError(error) : null }
}

export async function getPOSCatalogPage({
  page = 1,
  pageSize = CATALOG_PAGE_SIZE_DEFAULT,
  search = "",
  categoryId = "",
  active = null
} = {}) {
  const limit = Math.min(100, Math.max(1, Number(pageSize) || CATALOG_PAGE_SIZE_DEFAULT))
  const offset = Math.max(0, (Math.max(1, Number(page)) - 1) * limit)
  const resourceBaseline = typeof performance !== "undefined"
    ? performance.getEntriesByType("resource").length
    : 0
  const started = performance.now()

  const { data, error } = await supabase.rpc("list_pos_catalog_page", {
    p_limit: limit,
    p_offset: offset,
    p_search: search?.trim() || null,
    p_category_id: categoryId || null,
    p_active: active
  })
  const rpcMs = Math.round(performance.now() - started)
  const perfBase = {
    rpc_ms: rpcMs,
    payload_bytes: estimatePayloadBytes(data),
    request_count: 1 + (typeof performance !== "undefined"
      ? Math.max(0, performance.getEntriesByType("resource").length - resourceBaseline)
      : 0),
    source: "rpc:list_pos_catalog_page"
  }

  if (!error && data) {
    const items = (data.items || []).map(mapListRowFromSupabase)
    const result = {
      data: items,
      total: Number(data.total || 0),
      limit: Number(data.limit || limit),
      offset: Number(data.offset || offset),
      error: null,
      errorKind: null,
      perf: perfBase
    }
    logCatalogLoadResult({
      source: "rpc:list_pos_catalog_page",
      count: items.length,
      total: data.total,
      page,
      ms: rpcMs
    })
    logPosCatalogPerf({
      phase: "catalog_list_rpc",
      page,
      catalog_size: result.total,
      rpc_ms: rpcMs,
      payload_bytes: perfBase.payload_bytes,
      request_count: perfBase.request_count,
      images_loaded: 0,
      source: perfBase.source
    })
    return result
  }

  if (error && !isMissingRelationError(error)) {
    const errorKind = classifyCatalogError(error)
    logCatalogLoadResult({
      source: "rpc:list_pos_catalog_page",
      error: error.message,
      errorKind,
      ms: rpcMs
    })
    logPosCatalogPerf({
      phase: "catalog_list_rpc_error",
      page,
      catalog_size: 0,
      rpc_ms: rpcMs,
      payload_bytes: 0,
      images_loaded: 0,
      source: perfBase.source,
      error: error.message,
      timeout: errorKind === "timeout"
    })
    return { data: [], total: 0, limit, offset, error, errorKind, perf: perfBase }
  }

  const fallbackStarted = performance.now()
  const fallback = await fetchProductRows(
    { active, categoryId: categoryId || undefined, search: search?.trim() || undefined },
    { limit: limit + offset }
  )
  if (fallback.error) {
    const errorKind = classifyCatalogError(fallback.error)
    return { data: [], total: 0, limit, offset, error: fallback.error, errorKind }
  }

  const allRows = (fallback.data || []).map(mapListRowFromSupabase)
  const pageRows = allRows.slice(offset, offset + limit)
  logCatalogLoadResult({
    source: "rest:pos_products:list_columns",
    count: pageRows.length,
    total: allRows.length,
    page,
    ms: Math.round(performance.now() - started)
  })
  const fallbackMs = Math.round(performance.now() - fallbackStarted)
  const fallbackPerf = {
    rpc_ms: fallbackMs,
    payload_bytes: estimatePayloadBytes(fallback.data),
    request_count: 1,
    source: "rest:pos_products:list_columns"
  }
  return {
    data: pageRows,
    total: allRows.length,
    limit,
    offset,
    error: null,
    errorKind: null,
    perf: fallbackPerf
  }
}

async function queryProductsForSale() {
  const started = performance.now()
  const { data: products, error } = await fetchProductRows({ active: true }, { limit: SALE_PRODUCTS_LIMIT })

  if (error) {
    logCatalogLoadResult({
      source: "sale_products",
      error: error.message,
      errorKind: classifyCatalogError(error),
      ms: Math.round(performance.now() - started)
    })
    return { data: [], error, errorKind: classifyCatalogError(error) }
  }

  const productIds = (products || []).map((product) => product.id).filter(Boolean)
  const children = await loadCatalogChildren(productIds)
  const merged = children.error
    ? (products || []).map(mapPOSProductFromSupabase)
    : mergeCatalogProducts(products, children).map(mapPOSProductFromSupabase)

  logCatalogLoadResult({
    source: "sale_products",
    count: merged.length,
    ms: Math.round(performance.now() - started),
    childrenError: children.error?.message || null
  })
  return { data: merged, error: null, errorKind: null }
}

async function loadCatalogChildren(productIds) {
  const variantsResult = await queryInChunks("pos_product_variants", variantListColumns, "product_id", productIds)
  const modifiersResult = await queryInChunks("pos_product_modifiers", modifierListColumns, "product_id", productIds)
  const groupsResult = await queryInChunks("pos_option_groups", optionGroupListColumns, "product_id", productIds)

  if (variantsResult.error) return { error: variantsResult.error }
  if (modifiersResult.error) return { error: modifiersResult.error }

  let optionGroups = groupsResult.data || []
  if (groupsResult.error) {
    if (!isMissingRelationError(groupsResult.error)) return { error: groupsResult.error }
    optionGroups = []
  }

  let optionChoices = []
  const groupIds = optionGroups.map((group) => group.id).filter(Boolean)
  if (groupIds.length) {
    const choicesResult = await queryInChunks("pos_option_choices", optionChoiceListColumns, "group_id", groupIds)
    if (choicesResult.error) {
      if (!isMissingRelationError(choicesResult.error)) return { error: choicesResult.error }
    } else {
      optionChoices = choicesResult.data || []
    }
  }

  const choicesByGroup = groupRowsByKey(optionChoices, "group_id")
  const groupsWithChoices = optionGroups.map((group) => ({
    ...group,
    choices: choicesByGroup.get(group.id) || []
  }))

  return {
    error: null,
    variantsByProduct: groupRowsByKey(variantsResult.data, "product_id"),
    modifiersByProduct: groupRowsByKey(modifiersResult.data, "product_id"),
    groupsByProduct: groupRowsByKey(groupsWithChoices, "product_id")
  }
}

function mergeCatalogProducts(products, children) {
  return (products || []).map((product) => ({
    ...product,
    variants: children.variantsByProduct.get(product.id) || [],
    modifier_options: children.modifiersByProduct.get(product.id) || [],
    option_groups: children.groupsByProduct.get(product.id) || []
  }))
}

function mapVariantFromSupabase(variant) {
  if (!variant) return null
  return {
    ...variant,
    price: Number(variant.price || 0),
    prep_time_minutes: Number(variant.prep_time_minutes || 0),
    prepTimeMinutes: Number(variant.prep_time_minutes || 0),
    recipeId: variant.recipe_id || "",
    productionAreaId: variant.production_area_id || "",
    is_active: variant.is_active === true,
    isActive: variant.is_active === true,
    recipe: variant.recipe || null
  }
}

function mapModifierFromSupabase(modifier) {
  if (!modifier) return null
  return {
    ...modifier,
    modifierType: modifier.modifier_type || "remove",
    price_delta: Number(modifier.price_delta || 0),
    priceDelta: Number(modifier.price_delta || 0),
    is_active: modifier.is_active !== false,
    isActive: modifier.is_active !== false
  }
}

function mapOptionChoiceFromSupabase(choice) {
  if (!choice) return null
  return {
    ...choice,
    price: Number(choice.price || 0),
    priceMode: choice.price_mode || "none",
    price_mode: choice.price_mode || "none",
    recipeId: choice.recipe_id || "",
    is_active: choice.is_active !== false,
    isActive: choice.is_active !== false,
    sortOrder: Number(choice.sort_order || 0)
  }
}

function mapOptionGroupFromSupabase(group) {
  if (!group) return null
  const choices = Array.isArray(group.choices)
    ? [...group.choices]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapOptionChoiceFromSupabase)
    : []
  return {
    ...group,
    selectionMode: group.selection_mode || "single",
    selection_mode: group.selection_mode || "single",
    minSelections: Number(group.min_selections ?? 0),
    maxSelections: group.max_selections ?? null,
    is_active: group.is_active !== false,
    isActive: group.is_active !== false,
    sortOrder: Number(group.sort_order || 0),
    choices
  }
}

export function mapPOSProductFromSupabase(row) {
  if (!row) return row
  const variants = Array.isArray(row.variants)
    ? [...row.variants]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapVariantFromSupabase)
    : []
  const modifierOptions = Array.isArray(row.modifier_options)
    ? [...row.modifier_options]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapModifierFromSupabase)
    : []
  const optionGroups = Array.isArray(row.option_groups)
    ? [...row.option_groups]
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
        .map(mapOptionGroupFromSupabase)
    : []
  return {
    ...row,
    name: row.name,
    nombre: row.name,
    description: row.description || "",
    descripcion: row.description || "",
    price: Number(row.price || 0),
    precio: Number(row.price || 0),
    image: row.image_url || "",
    imagen: row.image_url || "",
    categoryId: row.category_id || "",
    categoriaId: row.category_id || "",
    categoryName: row.category_name || row.category_id || "",
    categoria: row.category_name || row.category_id || "",
    recipeId: row.recipe_id || "",
    productionAreaId: row.production_area_id || "",
    areaProduccion: row.production_area_id || "",
    active: row.active === true,
    estado: row.active === true ? "activo" : "inactivo",
    productionReady: row.production_ready === true,
    inventoryTrackingEnabled: row.inventory_tracking_enabled === true,
    inventory_tracking_enabled: row.inventory_tracking_enabled === true,
    recipeRequiredForSale: row.recipe_required_for_sale === true,
    recipe_required_for_sale: row.recipe_required_for_sale === true,
    recipeStatus: row.recipe_status || "missing",
    recipe_status: row.recipe_status || "missing",
    isTestItem: row.is_test_item === true,
    is_test_item: row.is_test_item === true,
    productType: row.product_type || "simple",
    product_type: row.product_type || "simple",
    allowKitchenNotes: row.allow_kitchen_notes === true,
    allow_kitchen_notes: row.allow_kitchen_notes === true,
    prepTimeMinutes: Number(row.prep_time_minutes || 0),
    prep_time_minutes: Number(row.prep_time_minutes || 0),
    recipe: row.recipe,
    productionArea: row.production_area,
    variants,
    modifierOptions,
    modifiers: modifierOptions,
    optionGroups,
    option_groups: optionGroups
  }
}

function serializeProduct(product) {
  const rawImage = product.image_url || product.image || product.imagen || null
  const imageUrl = isInlineImageValue(rawImage) ? null : (rawImage || null)
  return {
    name: String(product.name || product.nombre || "").trim(),
    description: String(product.description || product.descripcion || "").trim() || null,
    price: Number(product.price ?? product.precio ?? 0),
    image_url: imageUrl,
    category_id: product.categoryId || product.categoriaId || product.category_id || null,
    category_name: product.categoryName || product.categoria || product.category_name || null,
    recipe_id: product.recipeId || product.recipe_id || null,
    production_area_id: product.productionAreaId || product.areaProduccion || product.production_area_id || null,
    is_test_item: product.isTestItem === true || product.is_test_item === true,
    inventory_tracking_enabled: product.inventoryTrackingEnabled === true || product.inventory_tracking_enabled === true,
    recipe_required_for_sale: product.recipeRequiredForSale === true || product.recipe_required_for_sale === true,
    product_type: product.productType || product.product_type || "simple",
    allow_kitchen_notes: product.allowKitchenNotes === true || product.allow_kitchen_notes === true,
    prep_time_minutes: Number(product.prepTimeMinutes ?? product.prep_time_minutes ?? product.tiempoPreparacion ?? 0),
    active: product.active ?? product.estado === "activo",
    sort_order: Number(product.sortOrder ?? product.sort_order ?? 0)
  }
}

function serializeVariant(variant = {}, index = 0, fallbackName = "") {
  return {
    id: variant.id || null,
    name: String(variant.name || fallbackName || "").trim() || fallbackName || null,
    size: String(variant.size || "").trim().toLowerCase(),
    price: Number(variant.price ?? 0),
    recipe_id: variant.recipeId || variant.recipe_id || null,
    prep_time_minutes: Number(variant.prepTimeMinutes ?? variant.prep_time_minutes ?? 0),
    is_active: variant.isActive === true || variant.is_active === true,
    sort_order: Number(variant.sortOrder ?? variant.sort_order ?? index)
  }
}

function serializeModifier(modifier = {}, index = 0) {
  return {
    id: modifier.id || null,
    name: String(modifier.name || "").trim(),
    modifier_type: String(modifier.modifier_type || modifier.modifierType || "remove").trim().toLowerCase(),
    price_delta: Number(modifier.price_delta ?? modifier.priceDelta ?? 0),
    is_active: modifier.is_active !== false && modifier.isActive !== false,
    sort_order: Number(modifier.sortOrder ?? modifier.sort_order ?? index)
  }
}

export function invalidatePOSProductsCache() {
  invalidateQueryCache(CACHE_KEYS.POS_PRODUCTS_PREFIX)
}

function invalidateAfterProductMutation(result) {
  if (!result?.error) invalidatePOSProductsCache()
  return result
}

export function getPOSProducts() {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_ALL, () => queryProductsForSale(), CACHE_TTL.CATALOG)
}

export function getActivePOSProducts() {
  return cachedQuery(CACHE_KEYS.POS_PRODUCTS_ACTIVE, () => queryProductsForSale(), CACHE_TTL.CATALOG)
}

export function getProductionReadyPOSProducts() {
  return cachedQuery(
    CACHE_KEYS.POS_PRODUCTS_PRODUCTION,
    async () => {
      const result = await queryProductsForSale()
      if (result.error) return result
      return {
        ...result,
        data: (result.data || []).filter((product) => product.productionReady === true)
      }
    },
    CACHE_TTL.CATALOG
  )
}

export async function getPOSProductDetail(id) {
  const started = performance.now()
  const { data: base, error: baseError } = await supabase
    .from("pos_products")
    .select(PRODUCT_DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle()

  if (baseError) {
    const errorKind = classifyCatalogError(baseError)
    logCatalogLoadResult({ source: "detail:pos_products", id, error: baseError.message, errorKind, ms: Math.round(performance.now() - started) })
    return { data: null, error: baseError, errorKind }
  }
  if (!base) {
    return { data: null, error: { message: "Platillo no encontrado." }, errorKind: "other" }
  }

  const children = await loadCatalogChildren([id])
  const merged = children.error
    ? mapPOSProductFromSupabase(base)
    : mapPOSProductFromSupabase(mergeCatalogProducts([base], children)[0])

  logCatalogLoadResult({ source: "detail:pos_products", id, ms: Math.round(performance.now() - started) })
  return { data: merged, error: null, errorKind: null }
}

export async function getPOSProductImage(id) {
  const started = performance.now()
  const { data, error } = await supabase.rpc("get_pos_product_image_url", { p_id: id })
  const rpcMs = Math.round(performance.now() - started)
  if (!error && data != null) {
    const url = String(data)
    logPosCatalogPerf({
      phase: "product_image_lazy",
      catalog_size: null,
      rpc_ms: rpcMs,
      render_ms: null,
      payload_bytes: estimatePayloadBytes(url),
      images_loaded: 1,
      product_id: id,
      is_inline: isInlineImageValue(url),
      source: "rpc:get_pos_product_image_url"
    })
    return { data: url, error: null, perf: { rpc_ms: rpcMs, payload_bytes: estimatePayloadBytes(url) } }
  }

  const fallback = await supabase.from("pos_products").select("image_url").eq("id", id).maybeSingle()
  const url = fallback.data?.image_url || ""
  logPosCatalogPerf({
    phase: "product_image_lazy_fallback",
    rpc_ms: Math.round(performance.now() - started),
    payload_bytes: estimatePayloadBytes(url),
    images_loaded: url ? 1 : 0,
    product_id: id,
    is_inline: isInlineImageValue(url),
    source: "rest:pos_products:image_url"
  })
  return {
    data: url,
    error: fallback.error || error,
    perf: { rpc_ms: Math.round(performance.now() - started), payload_bytes: estimatePayloadBytes(url) }
  }
}

export async function verifyPOSProductPersisted(id) {
  const { data, error } = await supabase.rpc("verify_pos_product_exists", { p_id: id })
  if (!error && data) {
    logCatalogVerifyResult({ id, ok: data.ok === true, source: "rpc" })
    return { data, error: null }
  }

  const fallback = await supabase
    .from("pos_products")
    .select("id, name, active, created_at")
    .eq("id", id)
    .maybeSingle()

  const result = {
    ok: Boolean(fallback.data?.id),
    id: fallback.data?.id || id,
    name: fallback.data?.name || null,
    active: fallback.data?.active ?? null,
    created_at: fallback.data?.created_at || null
  }
  logCatalogVerifyResult({ id, ok: result.ok, source: "rest", error: fallback.error?.message || error?.message || null })
  return { data: result, error: fallback.error || error }
}

export async function getPOSProductById(id) {
  return getPOSProductDetail(id)
}

export async function createPOSProduct(product) {
  const result = await supabase.from("pos_products").insert(serializeProduct(product)).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function updatePOSProduct(id, updates) {
  const result = await supabase.from("pos_products").update(serializeProduct(updates)).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function deactivatePOSProduct(id) {
  const result = await supabase.from("pos_products").update({ active: false, production_ready: false }).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

export async function activatePOSProduct(id) {
  const result = await supabase.from("pos_products").update({ active: true }).eq("id", id).select(productSelect).single()
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(result.data), error: result.error })
}

async function reloadCatalogProductById(productId) {
  return getPOSProductDetail(productId)
}

/**
 * Guarda un platillo del catálogo POS vía RPC `save_pos_catalog_product`.
 * Persistencia Supabase:
 * - pos_products (fila principal)
 * - pos_option_groups + pos_option_choices (tipo configurable)
 * - pos_product_variants + pos_product_modifiers (tipo pizza)
 * - pos_recipe_links (platillos simples con receta)
 */
export async function savePOSCatalogProduct(product, variants = [], modifiers = [], optionGroups = [], imageOptions = {}) {
  const productId = product.id || product.productId || null
  const imageResolution = await resolvePOSProductImageForSave({
    imageFile: imageOptions.imageFile || product.imageFile || null,
    previewUrl: product.imagen || product.image || product.image_url || "",
    productId,
    removeImage: imageOptions.removeImage === true
  })

  if (imageResolution.error) {
    logCatalogSaveResult({
      ok: false,
      error: imageResolution.error.message || String(imageResolution.error),
      errorKind: "image_upload"
    })
    return { data: null, error: imageResolution.error, verify: null }
  }

  const productForSave = {
    ...product,
    imagen: imageResolution.url,
    image: imageResolution.url,
    image_url: imageResolution.url
  }
  const payload = serializeProduct(productForSave)
  const productType = payload.product_type || "simple"

  if (isInlineImageValue(payload.image_url)) {
    const inlineError = { message: "No se permite guardar imágenes base64 en pos_products. Vuelve a subir la imagen." }
    logCatalogSaveResult({ ok: false, error: inlineError.message, errorKind: "inline_image_blocked" })
    return { data: null, error: inlineError, verify: null }
  }

  const imageMeta = measureInlineImage(payload.image_url)
  const variantPayload = productType === "pizza"
    ? (Array.isArray(variants) ? variants : []).map((variant, index) => serializeVariant(variant, index, payload.name))
    : []
  const modifierPayload = productType === "pizza"
    ? (Array.isArray(modifiers) ? modifiers : []).map((modifier, index) => serializeModifier(modifier, index))
    : []
  const optionGroupPayload = productType === "configurable"
    ? serializeConfigurableGroupsForSave(optionGroups)
    : []

  logCatalogSaveAttempt({
    productId,
    productType,
    name: payload.name,
    imageMeta,
    imageStorage: imageResolution.url ? (imageResolution.migratedFromInline ? "migrated" : "storage_url") : "none",
    optionGroups: optionGroupPayload.length,
    variants: variantPayload.length,
    modifiers: modifierPayload.length
  })

  const { data, error } = await supabase.rpc("save_pos_catalog_product", {
    p_product_id: productId,
    p_product: payload,
    p_variants: variantPayload,
    p_modifiers: modifierPayload,
    p_option_groups: optionGroupPayload
  })

  if (error) {
    logCatalogSaveResult({ ok: false, error: error.message, errorKind: classifyCatalogError(error) })
    return { data: null, error, verify: null }
  }

  invalidatePOSProductsCache()
  window.dispatchEvent(new CustomEvent("pos-products-updated"))

  const savedProductId = data?.id || productId
  const verify = savedProductId ? await verifyPOSProductPersisted(savedProductId) : { data: null, error: null }
  logCatalogSaveResult({
    ok: true,
    productId: savedProductId,
    verified: verify.data?.ok === true,
    verifyError: verify.error?.message || null,
    imageUrl: payload.image_url || null
  })

  if (!savedProductId) return { data: mapPOSProductFromSupabase(data), error: null, verify }
  const reloaded = await reloadCatalogProductById(savedProductId)
  return { ...reloaded, verify }
}

export function validatePOSProduct(product, { strictRecipe = false } = {}) {
  const errors = []
  const productType = product.productType || product.product_type || "simple"
  const active = product.active ?? product.estado === "activo"
  if (!String(product.name || product.nombre || "").trim()) errors.push("Falta nombre.")
  if (Number(product.price ?? product.precio ?? 0) < 0) errors.push("El precio no es valido.")
  if (active && !(product.productionAreaId || product.production_area_id || product.areaProduccion)) errors.push("Falta area de produccion.")
  const recipeRequired = strictRecipe || product.recipeRequiredForSale === true || product.recipe_required_for_sale === true
  if (active && recipeRequired && !product.isTestItem && !product.is_test_item && productType !== "pizza" && productType !== "configurable" && !(product.recipeId || product.recipe_id)) {
    errors.push("Falta receta.")
  }
  if (active && productType === "pizza") {
    const activeVariants = (product.variants || []).filter((variant) => variant.isActive === true || variant.is_active === true)
    if (activeVariants.length === 0) {
      errors.push("Falta al menos una variante activa.")
    } else if (activeVariants.some((variant) => Number(variant.price || 0) <= 0 || (strictRecipe && !(variant.recipeId || variant.recipe_id)))) {
      errors.push("Hay variantes activas sin precio o receta.")
    }
  }
  if (active && productType === "configurable") {
    const { errors: configurableErrors } = validateConfigurableCatalog(product)
    errors.push(...configurableErrors)
  }
  return { valid: errors.length === 0, errors }
}

function validateConfigurableCatalog(product) {
  return validateConfigurableCatalogForm(product.optionGroups || product.option_groups || [], {
    active: product.active ?? product.estado === "activo"
  })
}

export async function createOrUpdatePOSProductFromRecipe(recipe, productId = null) {
  const payload = {
    name: recipe.name,
    description: recipe.description || recipe.notes || `Producto generado desde receta: ${recipe.name}`,
    price: Number(recipe.salePrice || recipe.price || 0),
    image_url: recipe.imageUrl || recipe.image_url || "",
    category_id: recipe.posCategoryId || recipe.pos_category_id || "extras",
    category_name: recipe.categoryName || recipe.posCategoryId || recipe.pos_category_id || "Extras",
    sort_order: Number(recipe.sortOrder || 0)
  }
  const { data, error } = await supabase.rpc("save_pos_product_from_recipe", {
    p_product_id: productId || null,
    p_recipe_id: recipe.id || recipe.recipeId,
    p_product: payload
  })
  return invalidateAfterProductMutation({ data: mapPOSProductFromSupabase(data), error })
}
