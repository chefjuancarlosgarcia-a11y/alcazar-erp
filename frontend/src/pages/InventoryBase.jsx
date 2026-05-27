import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import InfoTooltip from "../components/InfoTooltip"
import InventoryImportModal from "../components/InventoryImportModal"
import { getActiveAreas } from "../services/areasService"
import {
  adjustAreaInventory,
  createInventoryItem,
  deactivateInventoryItem,
  deleteInventoryImage,
  getInventoryItems,
  getInventoryMovements,
  updateInventoryItemImage,
  uploadInventoryImage,
  updateInventoryItem
} from "../services/inventoryService"
import { notifyRoles } from "../services/notificationsService"
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

const EMPTY_ITEM = {
  name: "",
  sku: "",
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
  active: true
}

const EMPTY_ADJUSTMENT = { itemId: "", areaId: "almacen", quantity: "", minimumQuantity: "", reason: "" }
const MANAGER_ROLES = ["admin", "gerente_general", "encargado_almacen"]

function InventoryBase({ section = "inventario", initialAreaId = "todos" }) {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role)
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
  const realtimeTimerRef = useRef(null)

  function refreshFromRealtime(showMovementNotice = false) {
    if (showMovementNotice) {
      setRealtimeNotice("Movimiento recibido. Inventario actualizado en vivo.")
      window.clearTimeout(realtimeTimerRef.current)
      realtimeTimerRef.current = window.setTimeout(() => setRealtimeNotice(""), 3500)
    }
    refresh()
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

  useEffect(() => () => window.clearTimeout(realtimeTimerRef.current), [])

  async function refresh() {
    setLoading(true)
    setError("")
    const [areasResult, itemsResult, movementsResult] = await Promise.all([
      getActiveAreas(),
      getInventoryItems(),
      getInventoryMovements({ limit: 100 })
    ])
    if (areasResult.error || itemsResult.error || movementsResult.error) {
      setError("No se pudo cargar el inventario desde Supabase. Verifica que la migración 004 esté aplicada.")
    }
    setAreas(areasResult.data || [])
    setItems(itemsResult.data || [])
    setMovements(movementsResult.data || [])
    setLoading(false)
  }

  function openCreate() {
    setEditingItem(null)
    setItemForm(EMPTY_ITEM)
    setShowItemForm(true)
    setError("")
  }

  function openEdit(item) {
    setEditingItem(item)
    setItemForm({
      ...EMPTY_ITEM,
      name: item.name || "",
      sku: item.sku || "",
      category: item.category || "",
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
  }

  async function saveItem(event) {
    event.preventDefault()
    setError("")
    if (!itemForm.name.trim() || !itemForm.purchase_unit.trim() || !itemForm.base_unit.trim()) {
      setError("Nombre, unidad de compra y unidad base son obligatorios.")
      return
    }
    const conversionFactor = Number(itemForm.conversion_factor)
    const purchasePrice = itemForm.purchase_price === "" ? null : Number(itemForm.purchase_price)
    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
      setError("El factor de conversión debe ser mayor a 0.")
      return
    }
    if (purchasePrice !== null && (!Number.isFinite(purchasePrice) || purchasePrice < 0)) {
      setError("El precio de compra no puede ser negativo.")
      return
    }
    const duplicateItem = items.find((item) => (
      item.id !== editingItem?.id &&
      normalizeItemName(item.name) === normalizeItemName(itemForm.name)
    ))
    if (duplicateItem && !window.confirm(`Ya existe el producto "${duplicateItem.name}". ¿Deseas ingresarlo de igual manera?`)) {
      return
    }
    const itemToSave = {
      ...itemForm,
      cost_per_base_unit: String(calculatedBaseCost(itemForm))
    }
    const result = editingItem
      ? await updateInventoryItem(editingItem.id, itemToSave)
      : await createInventoryItem(itemToSave)
    if (result.error) {
      setError(result.error.message || "No se pudo guardar el producto inventariable.")
      return
    }
    if (itemForm.imageFile) {
      const uploadResult = await uploadInventoryImage(itemForm.imageFile, result.data.id)
      if (uploadResult.error) {
        setError(`Producto guardado, pero no se pudo subir la imagen: ${uploadResult.error.message}`)
        await refresh()
        return
      }
      const imageResult = await updateInventoryItemImage(result.data.id, uploadResult.data.url)
      if (imageResult.error) {
        setError("La imagen se subió, pero no se pudo vincular al producto.")
        await refresh()
        return
      }
      const previousPath = storagePathFromUrl(editingItem?.image_url)
      if (previousPath) await deleteInventoryImage(previousPath)
    } else if (editingItem && itemForm.removeImage) {
      const imageResult = await updateInventoryItemImage(result.data.id, null)
      if (imageResult.error) {
        setError("No se pudo quitar la imagen del producto.")
        await refresh()
        return
      }
      const previousPath = storagePathFromUrl(editingItem.image_url)
      if (previousPath) await deleteInventoryImage(previousPath)
    }
    if (!editingItem) {
      const initial = Number(itemForm.initialQuantity || 0)
      const minimum = Number(itemForm.minimumQuantity || 0)
      if (initial > 0 || minimum > 0) {
        const stockResult = await adjustAreaInventory(
          result.data.id,
          "almacen",
          initial,
          minimum,
          itemForm.base_unit,
          "Stock inicial del producto"
        )
        if (stockResult.error) {
          setError("Producto creado, pero no se pudo registrar su stock inicial.")
          await refresh()
          return
        }
      }
    }
    if (editingItem && Number(editingItem.purchase_price ?? 0) !== Number(purchasePrice ?? 0)) {
      try {
        await notifyRoles(["admin", "gerente_general"], {
          type: "inventory_purchase_price_changed",
          title: "Precio de compra modificado",
          message: `El precio de compra de ${result.data.name} fue actualizado a Q${Number(purchasePrice || 0).toFixed(2)}.`,
          entityType: "inventory_item",
          entityId: result.data.id
        })
      } catch (notificationError) {
        console.error("No se pudo registrar la notificación del precio de compra.", notificationError)
      }
    }
    setShowItemForm(false)
    setEditingItem(null)
    setMessage(editingItem ? "Producto actualizado correctamente." : "Producto creado en Supabase.")
    await refresh()
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
    const text = `${item.name || ""} ${item.sku || ""} ${item.category || ""}`.toLowerCase()
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

      {showItemForm && <ItemModal form={itemForm} setForm={setItemForm} editingItem={editingItem} onSave={saveItem} onDelete={deactivate} onClose={() => setShowItemForm(false)} />}
      {adjustment && <AdjustmentModal adjustment={adjustment} setAdjustment={setAdjustment} items={items} areas={areas} onSave={saveAdjustment} onClose={() => setAdjustment(null)} />}
      {legacyOpen && <LegacyModal items={legacyItems} canManage={canManage} onMigrate={migrateLegacyItem} onMigrateSelected={migrateSelectedLegacyItems} onClose={() => setLegacyOpen(false)} />}
      {importOpen && <InventoryImportModal areas={areas} existingItems={items} onClose={() => setImportOpen(false)} onImported={refresh} />}
      {canEditCatalog && (
        <button type="button" className="inventory-mobile-create primary" onClick={openCreate}>
          + Nuevo producto
        </button>
      )}
    </section>
  )
}

function InventoryCatalog({ loading, items, areas, query, setQuery, areaFilter, setAreaFilter, canManage, onEdit, onDeactivate, onAdjust }) {
  const totalInvestment = items.reduce((total, item) => (
    total + Number(item.totalQuantity || 0) * Number(item.cost_per_base_unit || 0)
  ), 0)
  return (
    <>
      <div className="inventory-base-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, SKU o categoría..." />
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="todos">Todas las áreas</option>
          {areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
        </select>
      </div>
      <div className="inventory-investment-summary">
        <span>Valor total invertido en inventario</span>
        <strong>{quetzales(totalInvestment)}</strong>
      </div>
      <div className="inventory-table">
        <div className="inventory-table-head"><span>Producto</span><span>Unidad</span><span>Stock área</span><span>Stock total</span><span>Valor</span><span>Mínimo</span><span>Estado</span><span>Acciones</span></div>
        {loading ? <p className="inventory-empty">Cargando inventario...</p> : items.map((item) => {
          const areaStock = areaFilter === "todos" ? item.totalQuantity : stockOf(item, areaFilter)
          const minimum = areaFilter === "todos" ? minimumOf(item, "almacen") : minimumOf(item, areaFilter)
          const investment = Number(item.totalQuantity || 0) * Number(item.cost_per_base_unit || 0)
          return (
            <article className="inventory-row" key={item.id}>
              <div className="inventory-product-cell">
                <ProductImage item={item} />
                <span><strong>{item.name}</strong><small>{item.category || "Sin categoría"} · {item.sku || "Sin SKU"}</small></span>
              </div>
              <span>{unitForForm(item.base_unit)}</span>
              <strong>{areaStock}</strong>
              <strong>{item.totalQuantity}</strong>
              <strong>{quetzales(investment)}</strong>
              <span>{minimum}</span>
              <StockBadge quantity={areaStock} minimum={minimum} active={item.active} />
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
        {visibleItems.map((item) => (
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
  return <div className="inventory-movements">
    {loading ? <p className="inventory-empty">Cargando movimientos...</p> : movements.map((movement) => (
      <article key={movement.id}>
        <div><strong>{items[movement.item_id]?.name || "Producto"}</strong><small>{movement.movement_type}</small></div>
        <span>{areas[movement.from_area_id] || "-"} → {areas[movement.to_area_id] || "-"}</span>
        <span>{movement.quantity} {movement.unit}</span>
        <span>{movement.previous_quantity ?? "-"} → {movement.new_quantity ?? "-"}</span>
        <small>{new Date(movement.created_at).toLocaleString("es-GT")}</small>
        <small>{movement.notes || "Sin notas"}</small>
      </article>
    ))}
    {!loading && !movements.length && <p className="inventory-empty">No hay movimientos registrados.</p>}
  </div>
}

function ItemModal({ form, setForm, editingItem, onSave, onDelete, onClose }) {
  const editing = Boolean(editingItem)
  const [imageError, setImageError] = useState("")
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  function selectImage(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const allowed = ["image/jpeg", "image/png", "image/webp"]
    if (!allowed.includes(file.type)) {
      setImageError("Usa una imagen JPG, PNG o WEBP.")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setImageError("La imagen no puede superar 5 MB.")
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setForm((current) => ({
        ...current,
        imageFile: file,
        imagePreview: String(reader.result || ""),
        removeImage: false
      }))
      setImageError("")
    }
    reader.readAsDataURL(file)
  }
  function removeImage() {
    setForm((current) => ({ ...current, imageFile: null, imagePreview: "", removeImage: true }))
    setImageError("")
  }
  return <div className="inventory-modal-backdrop"><form className="inventory-modal" onSubmit={onSave}>
    <header><div><p className="inventory-base-eyebrow">Producto inventariable</p><h2>{editing ? "Editar producto" : "Nuevo producto"}</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <div className="inventory-form-grid">
      <Field label="Nombre"><input required value={form.name} onChange={(event) => update("name", event.target.value)} /></Field>
      <Field label="SKU"><input value={form.sku} onChange={(event) => update("sku", event.target.value)} /></Field>
      <Field label="Categoría"><input value={form.category} onChange={(event) => update("category", event.target.value)} /></Field>
      <Field label="Proveedor"><input value={form.supplier} onChange={(event) => update("supplier", event.target.value)} /></Field>
      <Field label="Unidad de compra" tooltip="Cómo compras este producto al proveedor."><InventoryUnitSelect required value={form.purchase_unit} onChange={(value) => update("purchase_unit", value)} /></Field>
      <Field label="Unidad base" tooltip="Cómo el sistema consume este producto en recetas e inventario."><InventoryUnitSelect required value={form.base_unit} onChange={(value) => update("base_unit", value)} /></Field>
      <Field label="Factor conversión" tooltip="Cuántas unidades base contiene la unidad de compra."><input min="0.0001" step="any" type="number" value={form.conversion_factor} onChange={(event) => update("conversion_factor", event.target.value)} /></Field>
      <Field label="Precio de compra" tooltip="Costo total de la unidad como la compras al proveedor.">
        <div className="inventory-currency-input"><span>Q</span><input min="0" step="0.01" type="number" placeholder="0.00" value={form.purchase_price} onChange={(event) => update("purchase_price", event.target.value)} /></div>
      </Field>
      <Field label="Costo por unidad base" tooltip="Costo automático de una unidad pequeña utilizada por recetas.">
        <input readOnly value={calculatedBaseCost(form)} />
        {form.purchase_price === "" && editing && <small className="inventory-base-muted">Conserva el costo registrado previamente hasta indicar un precio de compra.</small>}
      </Field>
      {!editing && <Field label="Stock inicial almacén"><input min="0" step="any" type="number" value={form.initialQuantity} onChange={(event) => update("initialQuantity", event.target.value)} /></Field>}
      {!editing && <Field label="Punto mínimo" tooltip="Cantidad mínima recomendada antes de alertar falta de stock."><input min="0" step="any" type="number" value={form.minimumQuantity} onChange={(event) => update("minimumQuantity", event.target.value)} /></Field>}
    </div>
    <Field label="Imagen del producto">
      <div className="inventory-image-actions">
        <label className="inventory-image-action">
          Seleccionar imagen
          <input type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={selectImage} />
        </label>
        <label className="inventory-image-action camera">
          Tomar foto
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={selectImage} />
        </label>
      </div>
    </Field>
    <p className="inventory-image-help">En móvil, “Tomar foto” abre la cámara del dispositivo.</p>
    {imageError && <div className="inventory-base-error">{imageError}</div>}
    {form.imagePreview ? (
      <div className="inventory-image-preview">
        <img src={form.imagePreview} alt={`Vista previa de ${form.name || "producto"}`} />
        <button type="button" className="danger" onClick={removeImage}>Quitar imagen</button>
      </div>
    ) : <p className="inventory-base-muted">Sin imagen seleccionada.</p>}
    <Field label="Notas"><textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} /></Field>
    <div className="inventory-modal-actions">
      {editingItem?.active !== false && <button type="button" className="danger inventory-delete-action" onClick={() => onDelete(editingItem)}>Eliminar producto</button>}
      <button type="button" className="secondary" onClick={onClose}>Cancelar</button>
      <button type="submit" className="primary">Guardar</button>
    </div>
  </form></div>
}

function InventoryUnitSelect({ value, onChange, required = false }) {
  const legacyValue = value && !INVENTORY_UNITS.includes(value) ? value : ""
  return <select required={required} value={value} onChange={(event) => onChange(event.target.value)}>
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

function Field({ label, tooltip, children }) {
  return <label className="inventory-field"><span>{label}{tooltip && <InfoTooltip text={tooltip} />}</span>{children}</label>
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

function normalizeItemName(name) {
  return String(name || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
