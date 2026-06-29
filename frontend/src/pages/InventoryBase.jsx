import { useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import { useToast } from "../hooks/useToast"
import { ToastContainer } from "../components/ToastContainer"
import InfoTooltip from "../components/InfoTooltip"
import InventoryImportModal from "../components/InventoryImportModal"
import BarcodeScannerInput from "../components/inventory/BarcodeScannerInput"
import "../components/inventory/BarcodeScannerInput.css"
import PaginationControls from "../components/PaginationControls"
import { pageItems } from "../utils/pagination"
import { getActiveAreas } from "../services/areasService"
import {
  adjustAreaInventory,
  createInventoryItem,
  deactivateInventoryItem,
  deleteInventoryImage,
  checkBarcodeExists,
  generateInternalBarcode,
  getInventoryItemById,
  getInventoryItems,
  getInventoryMovements,
  INVENTORY_IMAGE_ALLOWED_TYPES,
  INVENTORY_IMAGE_MAX_BYTES,
  updateInventoryItemImage,
  uploadInventoryImage,
  updateInventoryItem
} from "../services/inventoryService"
import {
  deleteItemUnitToGramsConversion,
  getItemConversions,
  upsertItemUnitToGramsConversion
} from "../services/inventoryConversionsService"
import { notifyRoles } from "../services/notificationsService"
import { getSuppliers } from "../services/suppliersService"
import { getActiveInventoryCategories } from "../services/inventoryCategoriesService"
import {
  buildInventoryCategoryOptions,
  resolveInventoryCategoryCode,
  resolveInventoryCategoryName
} from "../utils/inventoryCategoryUtils"
import { TestFlowBadge, TestFlowControls } from "../components/TestFlowBadge"
import { TEST_FLOW_FILTER } from "../utils/testFlowMode"
import InventoryItemYieldPanel from "../components/yield/InventoryItemYieldPanel"
import { compressInventoryImageFile, revokeCompressedImagePreview } from "../utils/imageCompression"
import { logPerformanceEvent } from "../utils/performanceLogger"
import {
  isInventoryItemVisibleInCatalog,
  logInventorySaveDebug,
  mapInventorySaveError,
  validateInventoryItemForm
} from "../utils/inventoryItemValidation"
import { normalizeBarcode } from "../utils/barcodeUtils"
import { printInventoryBarcodeLabel, renderBarcodeSvg } from "../utils/barcodeLabel"
import "./InventoryBase.css"

const DEFAULT_INVENTORY_UNIT = "Unidad/Pieza"
const INVENTORY_UNITS = [
  DEFAULT_INVENTORY_UNIT,
  "Gramos",
  "Kilogramos",
  "Libras",
  "Onzas",
  "Mililitros",
  "Litros",
  "Galón",
  "Caja",
  "Paquete",
  "Bolsa",
  "Lata",
  "Botella",
  "Quintal"
]
const RECIPE_WEIGHT_UNIT = "Gramos"
const PIECE_UNIT_KEYS = new Set(["unidad", "unidades", "unidad_pieza", "pieza", "piezas", "unit", "units", "piece", "pieces"])

const EMPTY_ITEM = {
  name: "",
  sku: "",
  barcode: "",
  barcode_type: "",
  barcode_source: "",
  barcode_created_at: null,
  category: "",
  purchase_unit: DEFAULT_INVENTORY_UNIT,
  base_unit: DEFAULT_INVENTORY_UNIT,
  conversion_factor: "1",
  purchase_price: "",
  cost_per_base_unit: "0",
  supplier: "",
  image_url: "",
  imageFile: null,
  imagePreview: "",
  removeImage: false,
  notes: "",
  initialQuantity: "0",
  minimumQuantity: "0",
  useRecipeWeightConversion: false,
  recipeWeightGrams: "",
  recipeWeightUnit: RECIPE_WEIGHT_UNIT,
  existingRecipeConversion: null,
  active: true
}

const EMPTY_ADJUSTMENT = { itemId: "", areaId: "almacen", quantity: "", minimumQuantity: "", reason: "" }
const MANAGER_ROLES = ["admin", "gerente_general", "encargado_almacen"]

function canManageInventory(user) {
  return MANAGER_ROLES.includes(user?.role) && (user?.status ?? "active") === "active"
}

function providerName(provider) {
  return String(provider?.nombreComercial || provider?.razonSocial || provider?.nombre || "").trim()
}

function uniqueProviderNames(providers) {
  return Array.from(new Set(providers.map(providerName).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"))
}

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
  return ["gramo", "gramos", "g", "gr"].includes(normalizeUnitKey(unit))
}

function findRecipeWeightConversion(conversions, baseUnit) {
  const baseKey = normalizeUnitKey(baseUnit)
  return (conversions || []).find((conversion) => (
    normalizeUnitKey(conversion.from_unit) === baseKey && isGramsUnit(conversion.to_unit)
  )) || (conversions || []).find((conversion) => (
    isPieceUnit(conversion.from_unit) && isGramsUnit(conversion.to_unit)
  )) || null
}

function InventoryBase({ section = "inventario", initialAreaId = "todos" }) {
  const { user } = useAuth()
  const canManage = canManageInventory(user)
  const canEditCatalog = canManage && section !== "movimientosInventario"
  const [items, setItems] = useState([])
  const [areas, setAreas] = useState([])
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [realtimeNotice, setRealtimeNotice] = useState("")
  const [query, setQuery] = useState("")
  const [areaFilter, setAreaFilter] = useState(initialAreaId)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [itemForm, setItemForm] = useState(EMPTY_ITEM)
  const [adjustment, setAdjustment] = useState(null)
  const [legacyOpen, setLegacyOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [legacyItems, setLegacyItems] = useState(readLegacyItems)
  const [providerOptions, setProviderOptions] = useState([])
  const [inventoryCategories, setInventoryCategories] = useState([])
  const [categoriesLoading, setCategoriesLoading] = useState(true)
  const [savingItem, setSavingItem] = useState(false)
  const [itemFormErrors, setItemFormErrors] = useState({})
  const [itemFormFocusField, setItemFormFocusField] = useState("")
  const { toasts, showToast, dismissToast } = useToast()
  const [testFlowFilter, setTestFlowFilter] = useState(TEST_FLOW_FILTER.REAL)
  const realtimeTimerRef = useRef(null)
  const realtimeRefreshRef = useRef(null)

  function refreshFromRealtime(showMovementNotice = false) {
    if (showMovementNotice) {
      setRealtimeNotice("Movimiento recibido. Inventario actualizado en vivo.")
      window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => setRealtimeNotice(""), 3500)
    }
    window.clearTimeout(realtimeRefreshRef.current)
    realtimeRefreshRef.current = window.setTimeout(refreshOperationalData, 350)
  }

  const stockRealtime = useSupabaseRealtime({
    table: "area_inventory",
    event: "*",
    onChange: () => refreshFromRealtime()
  })
  const movementsRealtime = useSupabaseRealtime({
    table: "inventory_movements",
    event: "INSERT",
    onChange: () => refreshFromRealtime(true)
  })
  const realtimeActive = stockRealtime.isLive && movementsRealtime.isLive

  useEffect(() => {
    refresh()
  }, [])

  useEffect(() => {
    if (!showItemForm || !editingItem || !inventoryCategories.length) return
    setItemForm((current) => {
      const nextCode = resolveInventoryCategoryCode(editingItem.category, inventoryCategories)
      if (current.category === nextCode) return current
      return { ...current, category: nextCode }
    })
  }, [showItemForm, editingItem, inventoryCategories])

  useEffect(() => () => {
    window.clearTimeout(realtimeTimerRef.current)
    window.clearTimeout(realtimeRefreshRef.current)
  }, [])

  async function refresh() {
    setLoading(true)
    setError("")
    const [areasResult, itemsResult, movementsResult, suppliersResult, categoriesResult] = await Promise.all([
      getActiveAreas(),
      getInventoryItems(),
      getInventoryMovements({ limit: 100, testFlowFilter }),
      canEditCatalog ? getSuppliers() : Promise.resolve({ data: [], error: null }),
      getActiveInventoryCategories()
    ])
    if (areasResult.error || itemsResult.error || movementsResult.error) {
      setError("No se pudo cargar el inventario desde Supabase. Verifica que la migración 004 esté aplicada.")
    }
    setAreas(areasResult.data || [])
    setItems(itemsResult.data || [])
    setMovements(movementsResult.data || [])
    setInventoryCategories(categoriesResult.data || [])
    setCategoriesLoading(false)
    if (suppliersResult.error) {
      setError(suppliersResult.error.message || "No se pudieron cargar los proveedores desde Supabase.")
    }
    if (categoriesResult.error) {
      setError(categoriesResult.error.message || "No se pudieron cargar las categorías de inventario.")
    }
    setProviderOptions(uniqueProviderNames(suppliersResult.data || []))
    setLoading(false)
    return itemsResult.data || []
  }

  useEffect(() => {
    if (section !== "movimientosInventario") return undefined
    refreshOperationalData()
  }, [testFlowFilter, section])

  async function refreshOperationalData() {
    const [itemsResult, movementsResult] = await Promise.all([
      getInventoryItems(),
      getInventoryMovements({ limit: 100, testFlowFilter })
    ])
    if (itemsResult.error || movementsResult.error) {
      setError("No se pudo actualizar el inventario en vivo.")
      return
    }
    setItems(itemsResult.data || [])
    setMovements(movementsResult.data || [])
  }

  function openCreate() {
    setEditingItem(null)
    setItemForm(EMPTY_ITEM)
    setItemFormErrors({})
    setItemFormFocusField("")
    setShowItemForm(true)
    setError("")
  }

  async function openEdit(item) {
    setEditingItem(item)
    setItemFormErrors({})
    setItemFormFocusField("")
    setItemForm({
      ...EMPTY_ITEM,
      name: item.name || "",
      sku: item.sku || "",
      barcode: item.barcode || "",
      barcode_type: item.barcode_type || "",
      barcode_source: item.barcode_source || "",
      barcode_created_at: item.barcode_created_at || null,
      category: resolveInventoryCategoryCode(item.category, inventoryCategories),
      purchase_unit: unitForForm(item.purchase_unit),
      base_unit: unitForForm(item.base_unit),
      conversion_factor: String(item.conversion_factor || 1),
      purchase_price: item.purchase_price == null ? "" : String(item.purchase_price),
      cost_per_base_unit: String(item.cost_per_base_unit || 0),
      supplier: item.supplier || "",
      image_url: item.image_url || "",
      imageFile: null,
      imagePreview: item.image_url || "",
      removeImage: false,
      notes: item.notes || "",
      active: item.active !== false
    })
    setShowItemForm(true)
    const conversionsResult = await getItemConversions(item.id)
    if (conversionsResult.error) {
      setError("No se pudo cargar la conversión para recetas de este producto.")
      return
    }
    const recipeConversion = findRecipeWeightConversion(conversionsResult.data, unitForForm(item.base_unit))
    if (recipeConversion) {
      setItemForm((current) => ({
        ...current,
        useRecipeWeightConversion: true,
        recipeWeightGrams: String(recipeConversion.factor || ""),
        recipeWeightUnit: recipeConversion.to_unit || RECIPE_WEIGHT_UNIT,
        existingRecipeConversion: recipeConversion
      }))
    }
  }

  function clearItemFormError(field) {
    setItemFormErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }

  function upsertItemInState(savedItem) {
    setItems((current) => {
      const next = current.some((item) => item.id === savedItem.id)
        ? current.map((item) => (item.id === savedItem.id ? savedItem : item))
        : [...current, savedItem]
      return next.sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), "es"))
    })
  }

  function updateItemFormField(field, value) {
    clearItemFormError(field)
    setItemForm((current) => ({ ...current, [field]: value }))
  }

  async function saveItem(event) {
    event.preventDefault()
    if (savingItem) return

    const validation = validateInventoryItemForm(itemForm, {
      categories: inventoryCategories,
      providers: providerOptions,
      items,
      editingItemId: editingItem?.id || ""
    })

    if (!validation.valid) {
      setItemFormErrors(validation.errors)
      setItemFormFocusField(validation.firstErrorField || "")
      const summary = "Faltan campos obligatorios. Revisa los campos marcados."
      setError(summary)
      showToast(summary, "error", 4500)
      return
    }

    if (validation.normalized.duplicateNameItem && !window.confirm(`Ya existe el producto "${validation.normalized.duplicateNameItem.name}". ¿Deseas ingresarlo de igual manera?`)) {
      return
    }

    if (normalizeBarcode(itemForm.barcode)) {
      const barcodeCheck = await checkBarcodeExists(itemForm.barcode, editingItem?.id || "")
      if (barcodeCheck.error) {
        const message = mapInventorySaveError(barcodeCheck.error)
        setError(message)
        showToast(message, "error", 5000)
        return
      }
      if (barcodeCheck.exists) {
        const message = `Este código ya pertenece a otro producto ("${barcodeCheck.item?.name || "otro producto"}").`
        setItemFormErrors({ barcode: message })
        setItemFormFocusField("barcode")
        setError(message)
        showToast(message, "error", 5000)
        return
      }
    }

    setItemFormErrors({})
    setItemFormFocusField("")
    setSavingItem(true)
    setError("")

    const isEdit = Boolean(editingItem)
    const warnings = []
    const startedAt = Date.now()
    const itemToSave = {
      ...itemForm,
      category: validation.normalized.categoryName,
      cost_per_base_unit: String(calculatedBaseCost(itemForm))
    }

    logInventorySaveDebug(isEdit ? "update:start" : "create:start", {
      name: itemToSave.name,
      sku: itemToSave.sku,
      category: itemToSave.category
    })

    try {
      const result = isEdit
        ? await updateInventoryItem(editingItem.id, itemToSave, { previousBarcode: editingItem.barcode })
        : await createInventoryItem(itemToSave)

      if (result.error || !result.data?.id) {
        const message = mapInventorySaveError(result.error)
        logInventorySaveDebug("save:failed", { error: result.error })
        logPerformanceEvent({
          module: "inventory",
          action: isEdit ? "update_item" : "create_item",
          event_type: "error",
          status: "error",
          error_message: message
        })
        setError(message)
        showToast(message, "error", 5000)
        return
      }

      let savedItem = result.data
      const canUseRecipeConversion = isPieceUnit(itemForm.base_unit)
      const recipeWeightGrams = validation.normalized.recipeWeightGrams

      if (canUseRecipeConversion && itemForm.useRecipeWeightConversion) {
        const conversionResult = await upsertItemUnitToGramsConversion(savedItem.id, itemForm.base_unit, recipeWeightGrams)
        if (conversionResult.error) {
          warnings.push("Producto guardado, pero no se pudo guardar la conversión para recetas.")
        }
      } else if (itemForm.existingRecipeConversion) {
        const shouldDelete = window.confirm("Este producto ya tiene una equivalencia configurada. ¿Deseas desactivarla/eliminarla?")
        if (shouldDelete) {
          const deleteResult = await deleteItemUnitToGramsConversion(
            savedItem.id,
            itemForm.existingRecipeConversion.from_unit || itemForm.base_unit
          )
          if (deleteResult.error) {
            warnings.push("Producto guardado, pero no se pudo eliminar la conversión para recetas.")
          }
        }
      }

      if (itemForm.imageFile) {
        const uploadResult = await uploadInventoryImage(itemForm.imageFile, savedItem.id)
        if (uploadResult.error) {
          warnings.push(`Producto guardado, pero no se pudo subir la imagen: ${uploadResult.error.message}`)
        } else {
          const imageResult = await updateInventoryItemImage(savedItem.id, uploadResult.data.url)
          if (imageResult.error) {
            warnings.push("Producto guardado, pero no se pudo vincular la imagen al producto.")
          } else {
            savedItem = { ...savedItem, image_url: uploadResult.data.url }
            const previousPath = storagePathFromUrl(editingItem?.image_url)
            if (previousPath) await deleteInventoryImage(previousPath)
          }
        }
      } else if (isEdit && itemForm.removeImage) {
        const imageResult = await updateInventoryItemImage(savedItem.id, null)
        if (imageResult.error) {
          warnings.push("Producto guardado, pero no se pudo quitar la imagen anterior.")
        } else {
          savedItem = { ...savedItem, image_url: null }
          const previousPath = storagePathFromUrl(editingItem.image_url)
          if (previousPath) await deleteInventoryImage(previousPath)
        }
      }

      if (!isEdit) {
        const initial = validation.normalized.initialQuantity
        const minimum = validation.normalized.minimumQuantity
        if (initial > 0 || minimum > 0) {
          const stockResult = await adjustAreaInventory(
            savedItem.id,
            "almacen",
            initial,
            minimum,
            itemForm.base_unit,
            "Stock inicial del producto"
          )
          if (stockResult.error) {
            warnings.push("Producto creado, pero no se pudo registrar su stock inicial.")
          }
        }
      }

      const verified = await getInventoryItemById(savedItem.id)
      if (verified.error || !verified.data?.id) {
        const message = "El producto pudo haberse guardado, pero no se pudo confirmar en Supabase. Actualiza la lista e inténtalo de nuevo."
        logInventorySaveDebug("verify:failed", { error: verified.error })
        setError(message)
        showToast(message, "warning", 6000)
        await refresh()
        return
      }

      savedItem = verified.data

      if (isEdit && Number(editingItem.purchase_price ?? 0) !== Number(validation.normalized.purchasePrice ?? 0)) {
        try {
          await notifyRoles(["admin", "gerente_general"], {
            type: "inventory_purchase_price_changed",
            title: "Precio de compra modificado",
            message: `El precio de compra de ${savedItem.name} fue actualizado a Q${Number(validation.normalized.purchasePrice || 0).toFixed(2)}.`,
            entityType: "inventory_item",
            entityId: savedItem.id
          })
        } catch (notificationError) {
          console.error("No se pudo registrar la notificación del precio de compra.", notificationError)
        }
      }

      upsertItemInState(savedItem)

      const successMessage = isEdit ? "Cambios guardados correctamente." : "Producto guardado correctamente."
      setShowItemForm(false)
      setEditingItem(null)
      setAreaFilter("todos")
      setQuery(savedItem.name || "")
      setMessage(successMessage)
      showToast(successMessage, "success", 3500)
      warnings.forEach((warning) => showToast(warning, "warning", 6000))

      logInventorySaveDebug("save:success", { itemId: savedItem.id, warnings })
      logPerformanceEvent({
        module: "inventory",
        action: isEdit ? "update_item" : "create_item",
        event_type: "info",
        status: "success",
        duration_ms: Date.now() - startedAt
      })

      const refreshedItems = await refresh()
      const itemLoaded = refreshedItems.some((item) => item.id === savedItem.id)
      if (!itemLoaded) {
        showToast(
          "Producto guardado en Supabase, pero no aparece en la lista cargada. Busca por nombre o revisa duplicados de SKU.",
          "warning",
          7000
        )
      }
    } catch (unexpectedError) {
      const message = mapInventorySaveError(unexpectedError)
      logInventorySaveDebug("save:exception", { message: unexpectedError?.message })
      logPerformanceEvent({
        module: "inventory",
        action: isEdit ? "update_item" : "create_item",
        event_type: "error",
        status: "error",
        error_message: message
      })
      setError(message)
      showToast(message, "error", 5000)
    } finally {
      setSavingItem(false)
    }
  }

  async function deactivate(item) {
    if (!window.confirm(`¿Desactivar ${item.name}? No se eliminará el historial.`)) return
    const { error: actionError } = await deactivateInventoryItem(item.id)
    if (actionError) {
      setError(actionError.message || "No se pudo desactivar el producto.")
      return
    }
    setMessage("Producto desactivado.")
    if (editingItem?.id === item.id) {
      setShowItemForm(false)
      setEditingItem(null)
    }
    await refresh()
  }

  function openAdjustment(item, areaId = areaFilter === "todos" ? "almacen" : areaFilter) {
    setAdjustment({
      ...EMPTY_ADJUSTMENT,
      itemId: item.id,
      areaId,
      quantity: String(stockOf(item, areaId)),
      minimumQuantity: String(minimumOf(item, areaId))
    })
  }

  async function saveAdjustment(event) {
    event.preventDefault()
    const item = items.find((entry) => entry.id === adjustment.itemId)
    if (!item) return
    const previousQuantity = stockOf(item, adjustment.areaId)
    const nextQuantity = Number(adjustment.quantity)
    const minimum = Number(adjustment.minimumQuantity || 0)
    if (!Number.isFinite(nextQuantity) || nextQuantity < 0 || minimum < 0) {
      setError("Las cantidades deben ser valores positivos.")
      return
    }
    if (nextQuantity !== previousQuantity && !adjustment.reason.trim()) {
      setError("El motivo es obligatorio al ajustar existencias.")
      return
    }
    const stockResult = await adjustAreaInventory(
      item.id,
      adjustment.areaId,
      nextQuantity,
      minimum,
      item.base_unit,
      adjustment.reason.trim()
    )
    if (stockResult.error) {
      setError(stockResult.error.message || "No se pudo actualizar el stock.")
      return
    }
    if (adjustment.areaId === "almacen" && (nextQuantity <= 0 || (minimum > 0 && nextQuantity <= minimum))) {
      try {
        await notifyRoles(["encargado_almacen"], {
          type: nextQuantity <= 0 ? "inventory_out_of_stock" : "inventory_low_stock",
          title: nextQuantity <= 0 ? "Producto agotado" : "Producto bajo mínimo",
          message: `${item.name} tiene ${nextQuantity} ${item.base_unit} en Almacén.`,
          entityType: "inventory_item",
          entityId: item.id
        })
      } catch (notificationError) {
        console.error("No se pudo registrar la notificación de existencias.", notificationError)
      }
    }
    setAdjustment(null)
    setMessage(nextQuantity === previousQuantity ? "Mínimo actualizado." : "Ajuste registrado en el kardex.")
    await refresh()
  }

  async function migrateLegacyItem(legacyItem, options = {}) {
    const { announce = true, refreshAfter = true } = options
    const initialQuantity = Number(legacyItem?.stockByLocation?.almacen ?? legacyItem.stockActual ?? legacyItem.totalUnidades ?? 0)
    const minimumQuantity = Number(legacyItem?.minimumStockByLocation?.almacen ?? legacyItem.puntoMinimo ?? 0)
    const legacyUnit = unitForForm(legacyItem.unidadCompra)
    const { data, error: createError } = await createInventoryItem({
      name: legacyItem.nombre || "Producto legacy",
      sku: legacyItem.codigo || legacyItem.codigoBarras || "",
      category: legacyItem.categoria || "",
      purchase_unit: legacyUnit,
      base_unit: legacyUnit,
      conversion_factor: 1,
      cost_per_base_unit: Number(legacyItem.costoUnitario || 0),
      supplier: legacyItem.proveedorNombre || "",
      purchase_price: Number(legacyItem.costoUnitario || 0),
      notes: "Migrado manualmente desde inventario local.",
      active: true
    })
    if (createError) {
      const errorMessage = createError.message || "No se pudo migrar el item local."
      if (announce) setError(errorMessage)
      return { ok: false, message: errorMessage }
    }
    const stockResult = await adjustAreaInventory(
      data.id,
      "almacen",
      initialQuantity,
      minimumQuantity,
      legacyUnit,
      "Migración manual desde localStorage"
    )
    if (stockResult.error) {
      const errorMessage = "El item fue creado, pero no se pudo registrar su stock inicial."
      if (announce) setError(errorMessage)
      return { ok: false, message: errorMessage }
    }
    setLegacyItems((current) => {
      const nextLegacy = current.map((entry) => entry.id === legacyItem.id
        ? { ...entry, migratedToSupabaseId: data.id, migratedAt: new Date().toISOString() }
        : entry)
      localStorage.setItem("ingredientes", JSON.stringify(nextLegacy))
      return nextLegacy
    })
    if (announce) {
      setError("")
      setMessage(`${legacyItem.nombre || "Item"} migrado a Supabase.`)
    }
    if (refreshAfter) await refresh()
    return { ok: true }
  }

  async function migrateSelectedLegacyItems(selectedIds) {
    const selected = legacyItems.filter((item) => selectedIds.includes(String(item.id)) && !item.migratedToSupabaseId)
    let migrated = 0
    const failures = []

    for (const legacyItem of selected) {
      const result = await migrateLegacyItem(legacyItem, { announce: false, refreshAfter: false })
      if (result.ok) migrated += 1
      else failures.push(`${legacyItem.nombre || "Item"}: ${result.message}`)
    }

    await refresh()
    if (migrated) setMessage(`${migrated} producto(s) local(es) migrado(s) a Supabase.`)
    setError(failures.length ? `No se migraron ${failures.length} producto(s). ${failures.join(" ")}` : "")
    return { migrated, failed: failures.length }
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    const text = `${item.name || ""} ${item.sku || ""} ${item.barcode || ""} ${item.category || ""}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase())) && (areaFilter === "todos" || item.active !== false)
  }), [areaFilter, items, query])
  const pendingLegacyCount = legacyItems.filter((item) => !item.migratedToSupabaseId).length
  const movementItems = Object.fromEntries(items.map((item) => [item.id, item]))
  const areaNames = Object.fromEntries(areas.map((area) => [area.id, area.name]))

  return (
    <section className={`inventory-base${canEditCatalog ? " has-mobile-create" : ""}`}>
      <header className="inventory-base-header">
        <div>
          <p className="inventory-base-eyebrow">Supabase Inventory</p>
          <h1>{section === "movimientosInventario" ? "Movimientos" : section === "inventarioAreas" ? "Inventario por áreas" : "Inventario"}</h1>
          <p className="inventory-base-muted">Productos, existencias por área y auditoría de movimientos.</p>
        </div>
        <div className="inventory-base-actions">
          <span className={`inventory-live${realtimeActive ? " connected" : ""}`} title={stockRealtime.error || movementsRealtime.error || ""}><i />{realtimeActive ? "En vivo" : "Conectando..."}</span>
          <button type="button" className="secondary" onClick={refresh}>Actualizar</button>
          {canEditCatalog && <button type="button" className="secondary" onClick={() => setImportOpen(true)}>Importar Excel/CSV</button>}
          {canEditCatalog && <button type="button" className="primary inventory-header-create" onClick={openCreate}>Nuevo producto</button>}
        </div>
      </header>

      {!canManage && section !== "movimientosInventario" && (
        <div className="inventory-readonly-note">
          Modo consulta: sólo Administración, Gerencia General o el Encargado de Almacén puede crear productos y ajustar existencias.
        </div>
      )}

      {pendingLegacyCount > 0 && (
        <div className="inventory-base-warning">
          Existen {pendingLegacyCount} producto(s) de inventario local pendiente(s) de migrar a Supabase.
          {canManage && <button type="button" onClick={() => setLegacyOpen(true)}>Seleccionar y migrar</button>}
        </div>
      )}
      {message && <div className="inventory-base-success">{message}</div>}
      {realtimeNotice && <div className="inventory-base-success">{realtimeNotice}</div>}
      {error && <div className="inventory-base-error">{error}</div>}

      {section === "movimientosInventario" && (
        <TestFlowControls
          filter={testFlowFilter}
          onFilterChange={setTestFlowFilter}
          canCreate={false}
          createActive={false}
          onToggleCreate={() => {}}
          className="inventory-test-controls"
        />
      )}

      {section === "inventario" && (
        <InventoryCatalog
          loading={loading}
          items={visibleItems}
          areas={areas}
          query={query}
          setQuery={setQuery}
          areaFilter={areaFilter}
          setAreaFilter={setAreaFilter}
          canManage={canManage}
          onEdit={openEdit}
          onDeactivate={deactivate}
          onAdjust={openAdjustment}
        />
      )}
      {section === "inventarioAreas" && <AreaStockDashboard items={items} areas={areas} initialAreaId={initialAreaId} canManage={canManage} onAdjust={openAdjustment} />}
      {section === "movimientosInventario" && <MovementsTable movements={movements} items={movementItems} areas={areaNames} loading={loading} />}

      {showItemForm && (
        <ItemModal
          form={itemForm}
          setForm={setItemForm}
          onUpdateField={updateItemFormField}
          editingItem={editingItem}
          providers={providerOptions}
          categories={inventoryCategories}
          categoriesLoading={categoriesLoading}
          canManageCategories={canEditCatalog}
          canManageInventory={canManage}
          showToast={showToast}
          formErrors={itemFormErrors}
          focusField={itemFormFocusField}
          saving={savingItem}
          formError={error}
          onClearFieldError={clearItemFormError}
          onSave={saveItem}
          onDelete={deactivate}
          onClose={() => {
            if (savingItem) return
            setShowItemForm(false)
            setEditingItem(null)
            setItemFormErrors({})
            setItemFormFocusField("")
          }}
        />
      )}
      {adjustment && <AdjustmentModal adjustment={adjustment} setAdjustment={setAdjustment} items={items} areas={areas} onSave={saveAdjustment} onClose={() => setAdjustment(null)} />}
      {legacyOpen && <LegacyModal items={legacyItems} canManage={canManage} onMigrate={migrateLegacyItem} onMigrateSelected={migrateSelectedLegacyItems} onClose={() => setLegacyOpen(false)} />}
      {importOpen && <InventoryImportModal areas={areas} existingItems={items} onClose={() => setImportOpen(false)} onImported={refresh} />}
      {canEditCatalog && (
        <button type="button" className="inventory-mobile-create primary" onClick={openCreate}>
          + Nuevo producto
        </button>
      )}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </section>
  )
}

function InventoryCatalog({ loading, items, areas, query, setQuery, areaFilter, setAreaFilter, canManage, onEdit, onDeactivate, onAdjust }) {
  const [page, setPage] = useState(1)
  const pagedItems = pageItems(items, page)
  const totalInvestment = items.reduce((total, item) => (
    total + Number(item.totalQuantity || 0) * Number(item.cost_per_base_unit || 0)
  ), 0)

  useEffect(() => {
    setPage(1)
  }, [query, areaFilter])

  return (
    <>
      <div className="inventory-base-filters">
        <input className="erp-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, SKU o categoría..." />
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="todos">Todas las áreas</option>
          {areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
        </select>
      </div>
      <div className="inventory-investment-summary erp-kpi-card">
        <span>Valor total invertido en inventario</span>
        <strong>{quetzales(totalInvestment)}</strong>
        {!loading && items.length > 0 && (
          <small className="inventory-base-muted">
            {items.length} producto(s) en esta vista{query.trim() ? " (filtrados)" : ""}
          </small>
        )}
      </div>
      <div className="inventory-table">
        <div className="inventory-table-head"><span>Producto</span><span>Unidad</span><span>Stock área</span><span>Stock total</span><span>Valor</span><span>Mínimo</span><span>Estado</span><span>Acciones</span></div>
        {loading ? <p className="inventory-empty">Cargando inventario...</p> : pagedItems.map((item) => {
          const areaStock = areaFilter === "todos" ? item.totalQuantity : stockOf(item, areaFilter)
          const minimum = areaFilter === "todos" ? minimumOf(item, "almacen") : minimumOf(item, areaFilter)
          const investment = Number(item.totalQuantity || 0) * Number(item.cost_per_base_unit || 0)
          return (
            <article className="inventory-row" key={item.id}>
              <div className="inventory-product-cell">
                <ProductImage item={item} />
                <span><strong>{item.name}</strong><small>{item.category || "Sin categoría"} · {item.sku || "Sin SKU"}{item.barcode ? ` · ${item.barcode}` : ""}</small></span>
              </div>
              <span className="inventory-row__cell" data-label="Unidad">{unitForForm(item.base_unit)}</span>
              <strong className="inventory-row__cell" data-label="Stock área">{areaStock}</strong>
              <strong className="inventory-row__cell" data-label="Stock total">{item.totalQuantity}</strong>
              <strong className="inventory-row__cell" data-label="Valor">{quetzales(investment)}</strong>
              <span className="inventory-row__cell" data-label="Mínimo">{minimum}</span>
              <div className="inventory-row__cell inventory-row__cell--badge" data-label="Estado">
                <StockBadge quantity={areaStock} minimum={minimum} active={item.active} />
              </div>
              <div className="inventory-row-actions">
                {canManage && <button type="button" onClick={() => onAdjust(item)}>Ajustar stock</button>}
                {canManage && <button type="button" onClick={() => onEdit(item)}>Editar</button>}
                {canManage && item.active && <button type="button" className="danger" onClick={() => onDeactivate(item)}>Desactivar</button>}
              </div>
            </article>
          )
        })}
        {!loading && !items.length && <p className="inventory-empty">No hay productos registrados para esta selección.</p>}
      </div>
      {!loading && <PaginationControls page={page} total={items.length} onChange={setPage} />}
    </>
  )
}

function AreaStockDashboard({ items, areas, initialAreaId, canManage, onAdjust }) {
  const defaultAreaId = initialAreaId && initialAreaId !== "todos" ? initialAreaId : "almacen"
  const [selectedAreaId, setSelectedAreaId] = useState(defaultAreaId)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("todos")
  const [showWithoutStock, setShowWithoutStock] = useState(false)
  const [previewItem, setPreviewItem] = useState(null)
  const [page, setPage] = useState(1)

  const selectedArea = areas.find((area) => area.id === selectedAreaId)
    || areas.find((area) => area.id === "almacen")
    || areas[0]
  if (!selectedArea) return <p className="inventory-empty">No hay áreas activas registradas.</p>

  const isWarehouse = selectedArea.id === "almacen"
  const activeItems = items.filter((item) => item.active !== false)
  const visibleItems = activeItems.filter((item) => {
    const quantity = stockOf(item, selectedArea.id)
    const minimum = minimumOf(item, selectedArea.id)
    const matchesText = !search || `${item.name} ${item.sku || ""} ${item.category || ""}`.toLocaleLowerCase("es").includes(search.toLocaleLowerCase("es"))
    const hasOperationalStock = isWarehouse || showWithoutStock || quantity > 0
    const matchesStatus = statusFilter === "todos"
      || (statusFilter === "bajo" && minimum > 0 && quantity <= minimum)
      || (statusFilter === "agotados" && quantity <= 0)
    return matchesText && hasOperationalStock && matchesStatus
  })
  const pagedItems = pageItems(visibleItems, page)
  const stockedCount = activeItems.filter((item) => stockOf(item, selectedArea.id) > 0).length
  const lowCount = activeItems.filter((item) => stockOf(item, selectedArea.id) > 0 && minimumOf(item, selectedArea.id) > 0 && stockOf(item, selectedArea.id) <= minimumOf(item, selectedArea.id)).length
  const emptyCount = activeItems.filter((item) => stockOf(item, selectedArea.id) <= 0).length

  return <div className="inventory-area-view">
    <nav className="inventory-area-tabs" aria-label="Seleccionar área">
      {areas.map((area) => (
        <button type="button" className={area.id === selectedArea.id ? "active" : ""} key={area.id} onClick={() => setSelectedAreaId(area.id)}>
          {area.name}
        </button>
      ))}
    </nav>
    <div className="inventory-area-controls">
      <select aria-label="Área seleccionada" value={selectedArea.id} onChange={(event) => setSelectedAreaId(event.target.value)}>
        {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
      </select>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto, SKU o categoría..." />
      <select aria-label="Filtrar estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="todos">Todos</option>
        <option value="bajo">Bajo mínimo</option>
        <option value="agotados">Agotados</option>
      </select>
      <label className="inventory-area-checkbox">
        <input type="checkbox" checked={showWithoutStock} onChange={(event) => setShowWithoutStock(event.target.checked)} />
        Mostrar productos sin stock
      </label>
    </div>
    <section className="inventory-area-selected">
      <header>
        <div>
          <h2>{selectedArea.name}</h2>
          <p className="inventory-base-muted">{isWarehouse ? "Catálogo completo y existencias centrales." : "Sólo existencias transferidas a esta área."}</p>
        </div>
        <div className="inventory-area-metrics">
          <span>Con stock<strong>{stockedCount}</strong></span>
          <span>Bajos<strong>{lowCount}</strong></span>
          <span>Agotados<strong>{emptyCount}</strong></span>
        </div>
      </header>
      <div className="inventory-area-list">
        {pagedItems.map((item) => (
          <article className="inventory-area-line" key={item.id}>
            <button type="button" className="inventory-area-image-button" onClick={() => setPreviewItem(item)} aria-label={`Ampliar imagen de ${item.name}`}>
              <ProductImage item={item} />
            </button>
            <span><strong>{item.name}</strong><small>{item.category || "Sin categoría"} · {item.sku || "Sin SKU"}</small></span>
            <strong>{stockOf(item, selectedArea.id)} {unitForForm(item.base_unit)}</strong>
            <StockBadge quantity={stockOf(item, selectedArea.id)} minimum={minimumOf(item, selectedArea.id)} active={item.active} />
            {canManage && <button type="button" onClick={() => onAdjust(item, selectedArea.id)}>Ajustar</button>}
          </article>
        ))}
        {!visibleItems.length && (
          <p className="inventory-empty">
            {!isWarehouse && !showWithoutStock
              ? "Esta área aún no tiene productos con stock transferido."
              : "No hay productos para los filtros seleccionados."}
          </p>
        )}
      </div>
      <PaginationControls page={page} total={visibleItems.length} onChange={setPage} />
    </section>
    {previewItem && (
      <div className="inventory-image-lightbox" role="presentation" onClick={() => setPreviewItem(null)}>
        <article role="dialog" aria-label={`Imagen de ${previewItem.name}`} onClick={(event) => event.stopPropagation()}>
          <button type="button" className="inventory-lightbox-close" onClick={() => setPreviewItem(null)}>Cerrar</button>
          <ProductImage item={previewItem} large />
          <div>
            <strong>{previewItem.name}</strong>
            <small>{previewItem.category || "Sin categoría"} · {previewItem.sku || "Sin SKU"}</small>
          </div>
        </article>
      </div>
    )}
  </div>
}

function MovementsTable({ movements, items, areas, loading }) {
  const [page, setPage] = useState(1)
  const pagedMovements = pageItems(movements, page)
  return <div className="inventory-movements">
    {loading ? <p className="inventory-empty">Cargando movimientos...</p> : pagedMovements.map((movement) => (
      <article className={`inventory-movement-row${movement.is_test ? " inventory-movement-row--test" : ""}`} key={movement.id}>
        <div className="inventory-movement-row__product">
          <strong>{items[movement.item_id]?.name || "Producto"}</strong>
          {movement.is_test && <TestFlowBadge />}
          <small>{movement.movement_type}</small>
        </div>
        <span className="inventory-movement-row__cell" data-label="Ruta">{areas[movement.from_area_id] || "-"} → {areas[movement.to_area_id] || "-"}</span>
        <span className="inventory-movement-row__cell" data-label="Cantidad">{movement.quantity} {movement.unit}</span>
        <span className="inventory-movement-row__cell" data-label="Stock">{movement.previous_quantity ?? "-"} → {movement.new_quantity ?? "-"}</span>
        <small className="inventory-movement-row__cell" data-label="Fecha">{new Date(movement.created_at).toLocaleString("es-GT")}</small>
        <small className="inventory-movement-row__cell" data-label="Notas">{movement.notes || "Sin notas"}</small>
      </article>
    ))}
    {!loading && !movements.length && <p className="inventory-empty">No hay movimientos registrados.</p>}
    {!loading && <PaginationControls page={page} total={movements.length} onChange={setPage} />}
  </div>
}

function ItemModal({
  form,
  setForm,
  onUpdateField,
  editingItem,
  providers,
  categories,
  categoriesLoading,
  canManageCategories,
  canManageInventory = false,
  showToast,
  formErrors = {},
  focusField = "",
  saving = false,
  formError = "",
  onClearFieldError,
  onSave,
  onDelete,
  onClose
}) {
  const editing = Boolean(editingItem)
  const [imageError, setImageError] = useState("")
  const [imageStatus, setImageStatus] = useState("")
  const [imageStatusMessage, setImageStatusMessage] = useState("")
  const [generatingBarcode, setGeneratingBarcode] = useState(false)
  const [barcodeScanValue, setBarcodeScanValue] = useState(form.barcode || "")
  const formGridRef = useRef(null)
  const showRecipeConversion = isPieceUnit(form.base_unit)
  const imageBusy = imageStatus === "optimizing"
  const hasFieldErrors = Object.keys(formErrors).length > 0
  const update = (field, value) => onUpdateField(field, value)
  const categoryOptions = useMemo(
    () => buildInventoryCategoryOptions(categories, editingItem?.category || ""),
    [categories, editingItem?.category]
  )

  useEffect(() => {
    setBarcodeScanValue(form.barcode || "")
  }, [form.barcode])

  useEffect(() => {
    if (!focusField && !hasFieldErrors) return
    const targetField = focusField || Object.keys(formErrors)[0]
    if (!targetField) return
    const node = formGridRef.current?.querySelector(`[data-inventory-field="${targetField}"]`)
    node?.scrollIntoView({ behavior: "smooth", block: "center" })
    const focusable = node?.querySelector("input:not([readonly]):not([disabled]), select:not([disabled]), textarea:not([disabled])")
    focusable?.focus?.({ preventScroll: true })
  }, [focusField, formErrors, hasFieldErrors])

  function fieldError(field) {
    return formErrors[field] || ""
  }

  function applyBarcodeValue(value, source = "manual") {
    const normalized = normalizeBarcode(value)
    onClearFieldError?.("barcode")
    setBarcodeScanValue(normalized)
    setForm((current) => ({
      ...current,
      barcode: normalized,
      barcode_type: normalized ? (current.barcode_type || inferBarcodeTypeFromValue(normalized)) : "",
      barcode_source: normalized
        ? (source === "scan" ? "scan" : source === "internal" ? "internal" : current.barcode_source || "manual")
        : "",
      barcode_created_at: normalized ? (current.barcode_created_at || null) : null
    }))
  }

  function inferBarcodeTypeFromValue(value) {
    const code = normalizeBarcode(value)
    if (/^EGA-INV-/i.test(code)) return "CODE128"
    if (/^\d{13}$/.test(code)) return "EAN13"
    if (/^\d{12}$/.test(code)) return "UPC"
    if (/^\d{8}$/.test(code)) return "EAN8"
    return "CODE128"
  }

  async function handleBarcodeScan(code) {
    const normalized = normalizeBarcode(code)
    if (!normalized) return
    applyBarcodeValue(normalized, "scan")
    const duplicate = await checkBarcodeExists(normalized, editingItem?.id || "")
    if (duplicate.exists) {
      onUpdateField("barcode", normalized)
      showToast?.(`Este código ya pertenece a otro producto ("${duplicate.item?.name || "otro producto"}").`, "error", 6000)
      return
    }
    showToast?.("Código asignado correctamente", "success", 3500)
  }

  async function handleGenerateInternalBarcode() {
    if (!canManageInventory || generatingBarcode || saving) return
    setGeneratingBarcode(true)
    try {
      const result = await generateInternalBarcode()
      if (result.error || !result.data?.barcode) {
        showToast?.(result.error?.message || "No se pudo generar el código interno.", "error", 5000)
        return
      }
      applyBarcodeValue(result.data.barcode, "internal")
      setForm((current) => ({
        ...current,
        barcode_type: result.data.barcode_type,
        barcode_source: result.data.barcode_source
      }))
      showToast?.("Código interno generado", "success", 3500)
    } finally {
      setGeneratingBarcode(false)
    }
  }

  function handlePrintBarcodeLabel() {
    const result = printInventoryBarcodeLabel({
      name: form.name,
      barcode: form.barcode,
      barcodeType: form.barcode_type
    })
    if (!result.ok) {
      showToast?.(result.error || "No se pudo imprimir la etiqueta.", "error", 5000)
    }
  }

  const barcodePreviewSvg = form.barcode
    ? renderBarcodeSvg(form.barcode, form.barcode_type)
    : ""

  function releasePreview(previewUrl) {
    if (previewUrl?.startsWith("blob:")) revokeCompressedImagePreview(previewUrl)
  }

  async function selectImage(event) {
    const input = event.target
    const file = input.files?.[0]
    input.value = ""
    if (!file) return
    if (!INVENTORY_IMAGE_ALLOWED_TYPES.includes(file.type)) {
      setImageError("Usa una imagen JPG, PNG o WEBP.")
      setImageStatus("")
      setImageStatusMessage("")
      return
    }

    setImageError("")
    setImageStatus("optimizing")
    setImageStatusMessage("Optimizando imagen…")

    try {
      const result = await compressInventoryImageFile(file, { maxBytes: INVENTORY_IMAGE_MAX_BYTES })
      setForm((current) => {
        releasePreview(current.imagePreview)
        return {
          ...current,
          imageFile: result.file,
          imagePreview: result.previewUrl,
          removeImage: false
        }
      })
      setImageStatus("success")
      setImageStatusMessage("Imagen optimizada correctamente.")
    } catch (error) {
      setImageStatus("error")
      setImageStatusMessage("")
      setImageError(error.message || "No se pudo optimizar la imagen. Intenta con otra foto.")
    }
  }

  function removeImage() {
    setForm((current) => {
      releasePreview(current.imagePreview)
      return { ...current, imageFile: null, imagePreview: "", removeImage: true }
    })
    setImageError("")
    setImageStatus("")
    setImageStatusMessage("")
  }
  return <div className="inventory-modal-backdrop"><form className="inventory-modal" onSubmit={onSave} noValidate>
    <header><div><p className="inventory-base-eyebrow">Producto inventariable</p><h2>{editing ? "Editar producto" : "Nuevo producto"}</h2></div><button type="button" onClick={onClose} disabled={saving}>Cerrar</button></header>
    {(formError || hasFieldErrors) && (
      <div className="inventory-form-banner-error" role="alert">
        {formError || "Revisa los campos marcados antes de guardar."}
      </div>
    )}
    <div className="inventory-form-grid" ref={formGridRef}>
      <Field label="Nombre" fieldKey="name" error={fieldError("name")}>
        <input required value={form.name} onChange={(event) => update("name", event.target.value)} disabled={saving} />
      </Field>
      <Field label="SKU" fieldKey="sku" error={fieldError("sku")}>
        <input value={form.sku} onChange={(event) => update("sku", event.target.value)} disabled={saving} />
      </Field>
      <Field label="Código de barras" fieldKey="barcode" error={fieldError("barcode")}>
        <BarcodeScannerInput
          inputId="inventory-item-barcode"
          value={barcodeScanValue}
          onChange={(value) => {
            setBarcodeScanValue(value)
            onClearFieldError?.("barcode")
            setForm((current) => ({ ...current, barcode: value }))
          }}
          onScan={handleBarcodeScan}
          disabled={saving || !canManageInventory}
          placeholder="Escanear o escribir código de barras..."
          hint={canManageInventory ? "Opcional. Escanea con lector USB o genera un código interno EGA-INV." : "Solo lectura."}
          showFocusButton={canManageInventory}
        />
        {canManageInventory && (
          <div className="barcode-field-actions">
            <button
              type="button"
              className="secondary"
              disabled={saving || generatingBarcode}
              onClick={handleGenerateInternalBarcode}
            >
              {generatingBarcode ? "Generando…" : "Generar código interno"}
            </button>
            {form.barcode && (
              <button type="button" className="secondary" disabled={saving} onClick={handlePrintBarcodeLabel}>
                Imprimir etiqueta
              </button>
            )}
          </div>
        )}
        {form.barcode && barcodePreviewSvg && (
          <div className="barcode-label-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: barcodePreviewSvg }} />
        )}
      </Field>
      <Field label="Categoría" fieldKey="category" error={fieldError("category")}>
        <div className="inventory-category-field">
          {categoriesLoading ? (
            <p className="inventory-base-muted">Cargando categorías...</p>
          ) : !categoryOptions.length ? (
            <p className="inventory-base-muted">No hay categorías activas configuradas.</p>
          ) : (
            <select required value={form.category} onChange={(event) => update("category", event.target.value)} disabled={saving}>
              <option value="">Seleccionar categoría</option>
              {categoryOptions.map((category) => (
                <option key={category.code} value={category.code}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          {canManageCategories && (
            <Link className="secondary inventory-category-admin-link" to="/inventory?section=categorias">
              Administrar categorías
            </Link>
          )}
        </div>
      </Field>
      <Field label="Proveedor" fieldKey="supplier" error={fieldError("supplier")}>
        <div className="inventory-supplier-field">
          <select value={form.supplier} onChange={(event) => update("supplier", event.target.value)} disabled={saving}>
            <option value="">Seleccionar proveedor</option>
            {form.supplier && !providers.includes(form.supplier) && <option value={form.supplier}>Actual: {form.supplier}</option>}
            {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
          <button type="button" className="secondary" disabled={saving} onClick={() => { window.location.href = "/inventory?section=proveedores" }}>
            Crear proveedor
          </button>
        </div>
        {!providers.length && <small className="inventory-base-muted">No hay proveedores guardados todavía.</small>}
      </Field>
      <Field label="Unidad de compra" fieldKey="purchase_unit" error={fieldError("purchase_unit")} tooltip="Cómo compras este producto al proveedor.">
        <InventoryUnitSelect required value={form.purchase_unit} disabled={saving} onChange={(value) => update("purchase_unit", value)} />
      </Field>
      <Field label="Unidad base" fieldKey="base_unit" error={fieldError("base_unit")} tooltip="Cómo el sistema consume este producto en recetas e inventario.">
        <InventoryUnitSelect
          required
          disabled={saving}
          value={form.base_unit}
          onChange={(value) => {
            onClearFieldError?.("base_unit")
            setForm((current) => ({
              ...current,
              base_unit: value,
              useRecipeWeightConversion: isPieceUnit(value) ? current.useRecipeWeightConversion : false
            }))
          }}
        />
      </Field>
      <Field label="Factor conversión" fieldKey="conversion_factor" error={fieldError("conversion_factor")} tooltip="Cuántas unidades base contiene la unidad de compra.">
        <input min="0.0001" step="any" type="number" value={form.conversion_factor} onChange={(event) => update("conversion_factor", event.target.value)} disabled={saving} />
      </Field>
      <Field label="Precio de compra" fieldKey="purchase_price" error={fieldError("purchase_price")} tooltip="Costo total de la unidad como la compras al proveedor.">
        <div className="inventory-currency-input"><span>Q</span><input min="0" step="0.01" type="number" placeholder="0.00" value={form.purchase_price} onChange={(event) => update("purchase_price", event.target.value)} disabled={saving} /></div>
      </Field>
      <Field label="Costo por unidad base" fieldKey="cost_per_base_unit" error={fieldError("cost_per_base_unit")} tooltip="Costo automático de una unidad pequeña utilizada por recetas.">
        <input readOnly value={calculatedBaseCost(form)} />
        {form.purchase_price === "" && editing && <small className="inventory-base-muted">Conserva el costo registrado previamente hasta indicar un precio de compra.</small>}
      </Field>
      {!editing && (
        <Field label="Stock inicial almacén" fieldKey="initialQuantity" error={fieldError("initialQuantity")}>
          <input min="0" step="any" type="number" value={form.initialQuantity} onChange={(event) => update("initialQuantity", event.target.value)} disabled={saving} />
        </Field>
      )}
      {!editing && (
        <Field label="Punto mínimo" fieldKey="minimumQuantity" error={fieldError("minimumQuantity")} tooltip="Cantidad mínima recomendada antes de alertar falta de stock.">
          <input min="0" step="any" type="number" value={form.minimumQuantity} onChange={(event) => update("minimumQuantity", event.target.value)} disabled={saving} />
        </Field>
      )}
    </div>
    {showRecipeConversion && (
      <section className="inventory-recipe-conversion">
        <div>
          <h3>Conversión para recetas</h3>
          <p>Activa esta opción si este producto se compra por unidad, pero se usa por gramos en recetas.</p>
        </div>
        <label className="inventory-recipe-toggle">
          <input
            type="checkbox"
            checked={Boolean(form.useRecipeWeightConversion)}
            onChange={(event) => update("useRecipeWeightConversion", event.target.checked)}
          />
          <span>Usar este producto por peso en recetas</span>
        </label>
        {form.useRecipeWeightConversion && (
          <div className="inventory-recipe-equivalence">
            <span>1 {form.base_unit || DEFAULT_INVENTORY_UNIT} =</span>
            <input
              type="number"
              min="0.0001"
              step="any"
              value={form.recipeWeightGrams}
              onChange={(event) => update("recipeWeightGrams", event.target.value)}
              placeholder="80"
              disabled={saving}
              data-inventory-field="recipeWeightGrams"
              aria-invalid={Boolean(fieldError("recipeWeightGrams"))}
            />
            <select value={form.recipeWeightUnit || RECIPE_WEIGHT_UNIT} onChange={(event) => update("recipeWeightUnit", event.target.value)} disabled={saving}>
              <option value={RECIPE_WEIGHT_UNIT}>Gramos</option>
            </select>
          </div>
        )}
        {fieldError("recipeWeightGrams") && <small className="inventory-field-error" role="alert">{fieldError("recipeWeightGrams")}</small>}
        {form.existingRecipeConversion && !form.useRecipeWeightConversion && (
          <p className="inventory-recipe-note">Este producto ya tiene una equivalencia configurada; al guardar podrás decidir si deseas eliminarla.</p>
        )}
        <div className="inventory-recipe-examples">
          <span>Limón: 1 unidad ≈ 80 g</span>
          <span>Aguacate: 1 unidad ≈ 220 g</span>
          <span>Albahaca: 1 manojo ≈ 100 g</span>
          <span>Lechuga: 1 unidad ≈ 600 g</span>
        </div>
      </section>
    )}
    <Field label="Imagen del producto">
      <div className="inventory-image-actions">
        <label className="inventory-image-action">
          Seleccionar imagen
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={selectImage} disabled={imageBusy} />
        </label>
        <label className="inventory-image-action camera">
          Tomar foto
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectImage} disabled={imageBusy} />
        </label>
      </div>
    </Field>
    <p className="inventory-image-help">
      En móvil, “Tomar foto” abre la cámara del dispositivo. Las fotos grandes se optimizan automáticamente antes de subir (máx. 10 MB).
    </p>
    {imageStatus === "optimizing" && (
      <p className="inventory-image-status optimizing" role="status">{imageStatusMessage}</p>
    )}
    {imageStatus === "success" && imageStatusMessage && (
      <p className="inventory-image-status success" role="status">{imageStatusMessage}</p>
    )}
    {imageError && <div className="inventory-base-error">{imageError}</div>}
    {form.imagePreview ? (
      <div className="inventory-image-preview">
        <img src={form.imagePreview} alt={`Vista previa de ${form.name || "producto"}`} />
        <button type="button" className="danger" onClick={removeImage}>Quitar imagen</button>
      </div>
    ) : <p className="inventory-base-muted">Sin imagen seleccionada.</p>}
    <Field label="Notas"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
    {editing && editingItem?.id && (
      <InventoryItemYieldPanel itemId={editingItem.id} item={editingItem} canManage={true} />
    )}
    <div className="inventory-modal-actions">
      {editingItem?.active !== false && (
        <button type="button" className="danger inventory-delete-action" onClick={() => onDelete(editingItem)} disabled={saving}>
          Eliminar producto
        </button>
      )}
      <button type="button" className="secondary" onClick={onClose} disabled={saving}>Cancelar</button>
      <button type="submit" className="primary" disabled={saving || imageBusy}>
        {saving ? "Guardando…" : "Guardar"}
      </button>
    </div>
  </form></div>
}

function InventoryUnitSelect({ value, onChange, required = false, disabled = false }) {
  const legacyValue = value && !INVENTORY_UNITS.includes(value) ? value : ""
  return <select required={required} disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">Seleccionar unidad</option>
    {legacyValue && <option value={legacyValue}>Otra: {legacyValue}</option>}
    {INVENTORY_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
  </select>
}

function AdjustmentModal({ adjustment, setAdjustment, items, areas, onSave, onClose }) {
  const item = items.find((entry) => entry.id === adjustment.itemId)
  const update = (field, value) => setAdjustment((current) => ({ ...current, [field]: value }))
  return <div className="inventory-modal-backdrop"><form className="inventory-modal compact" onSubmit={onSave}>
    <header><div><p className="inventory-base-eyebrow">Kardex</p><h2>Ajustar stock</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="inventory-base-muted">{item?.name}</p>
    <Field label="Área"><select value={adjustment.areaId} onChange={(event) => update("areaId", event.target.value)}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
    <Field label="Nueva cantidad"><input type="number" step="any" min="0" required value={adjustment.quantity} onChange={(event) => update("quantity", event.target.value)} /></Field>
    <Field label="Punto mínimo" tooltip="Cantidad mínima recomendada antes de alertar falta de stock."><input type="number" step="any" min="0" required value={adjustment.minimumQuantity} onChange={(event) => update("minimumQuantity", event.target.value)} /></Field>
    <Field label="Motivo del ajuste"><textarea value={adjustment.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Obligatorio si cambia la existencia" /></Field>
    <div className="inventory-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary">Registrar ajuste</button></div>
  </form></div>
}

function LegacyModal({ items, canManage, onMigrate, onMigrateSelected, onClose }) {
  const pendingItems = items.filter((item) => !item.migratedToSupabaseId)
  const [selectedIds, setSelectedIds] = useState([])
  const [migrating, setMigrating] = useState(false)
  const allSelected = pendingItems.length > 0 && pendingItems.every((item) => selectedIds.includes(String(item.id)))

  function toggleSelected(itemId) {
    const id = String(itemId)
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleAll() {
    setSelectedIds(allSelected ? [] : pendingItems.map((item) => String(item.id)))
  }

  async function migrateSelected() {
    if (!selectedIds.length) return
    setMigrating(true)
    await onMigrateSelected(selectedIds)
    setSelectedIds([])
    setMigrating(false)
  }

  return <div className="inventory-modal-backdrop"><section className="inventory-modal legacy">
    <header><div><p className="inventory-base-eyebrow">Importación temporal</p><h2>Inventario local legacy</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="inventory-base-muted">Estos registros no alimentan el inventario oficial hasta migrarlos a Supabase.</p>
    {canManage && pendingItems.length > 0 && (
      <div className="legacy-bulk-actions">
        <label><input type="checkbox" checked={allSelected} onChange={toggleAll} /> Seleccionar todos pendientes</label>
        <button type="button" className="primary" disabled={!selectedIds.length || migrating} onClick={migrateSelected}>
          {migrating ? "Migrando..." : `Migrar seleccionados (${selectedIds.length})`}
        </button>
      </div>
    )}
    {items.map((item) => <article className="legacy-item" key={item.id || item.nombre}>
      {canManage && !item.migratedToSupabaseId && <input type="checkbox" checked={selectedIds.includes(String(item.id))} onChange={() => toggleSelected(item.id)} aria-label={`Seleccionar ${item.nombre || "producto"}`} />}
      <div><strong>{item.nombre || "Sin nombre"}</strong><small>{item.codigo || "Sin código"} · Almacén: {item.stockByLocation?.almacen ?? item.stockActual ?? 0}</small></div>
      {item.migratedToSupabaseId ? <span className="migrated">Migrado</span> : canManage && <button type="button" disabled={migrating} onClick={() => onMigrate(item)}>Migrar individual</button>}
    </article>)}
  </section></div>
}

function Field({ label, tooltip, children, error, fieldKey }) {
  return (
    <label className={`inventory-field${error ? " has-error" : ""}`} data-inventory-field={fieldKey || ""}>
      <span>{label}{tooltip && <InfoTooltip text={tooltip} />}</span>
      {children}
      {error && <small className="inventory-field-error" role="alert">{error}</small>}
    </label>
  )
}

function ProductImage({ item, small = false, large = false }) {
  const sizeClass = small ? " small" : large ? " large" : ""
  if (item.image_url) return <img className={`inventory-product-image${sizeClass}`} src={item.image_url} alt="" />
  return <span className={`inventory-product-placeholder${sizeClass}`}>{initials(item.name)}</span>
}

function StockBadge({ quantity, minimum, active = true }) {
  const state = !active ? "inactive" : quantity <= 0 ? "empty" : minimum > 0 && quantity <= minimum ? "low" : "ok"
  const label = { inactive: "Inactivo", empty: "Agotado", low: "Bajo", ok: "OK" }[state]
  return <span className={`inventory-stock-badge ${state}`}>{label}</span>
}

function stockOf(item, areaId) {
  return Number(item?.stockByArea?.[areaId] || 0)
}

function minimumOf(item, areaId) {
  return Number(item?.minimumByArea?.[areaId] || 0)
}

function initials(name) {
  return String(name || "P").split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("")
}

function unitForForm(value) {
  const unit = String(value || "").trim()
  if (!unit || ["unidad", "pieza", "unidad/pieza"].includes(unit.toLocaleLowerCase("es"))) {
    return DEFAULT_INVENTORY_UNIT
  }
  return unit
}

function calculatedBaseCost(item) {
  const purchasePrice = item.purchase_price === "" || item.purchase_price == null
    ? null
    : Number(item.purchase_price)
  const factor = Number(item.conversion_factor)
  if (purchasePrice !== null && Number.isFinite(purchasePrice) && Number.isFinite(factor) && factor > 0) {
    return purchasePrice / factor
  }
  return Number(item.cost_per_base_unit || 0)
}

function quetzales(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function storagePathFromUrl(url) {
  const marker = "/storage/v1/object/public/inventory-images/"
  const index = String(url || "").indexOf(marker)
  return index >= 0 ? decodeURIComponent(String(url).slice(index + marker.length)) : ""
}

function readLegacyItems() {
  try {
    const value = JSON.parse(localStorage.getItem("ingredientes") || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export default InventoryBase
