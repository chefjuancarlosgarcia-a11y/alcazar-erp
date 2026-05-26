import { useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
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
import "./InventoryBase.css"

const EMPTY_ITEM = {
  name: "",
  sku: "",
  category: "",
  purchase_unit: "",
  base_unit: "g",
  conversion_factor: "1",
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
      purchase_unit: item.purchase_unit || "",
      base_unit: item.base_unit || "g",
      conversion_factor: String(item.conversion_factor || 1),
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
    if (!itemForm.name.trim() || !itemForm.base_unit.trim()) {
      setError("Nombre y unidad base son obligatorios.")
      return
    }
    const result = editingItem
      ? await updateInventoryItem(editingItem.id, itemForm)
      : await createInventoryItem(itemForm)
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
    setAdjustment(null)
    setMessage(nextQuantity === previousQuantity ? "Mínimo actualizado." : "Ajuste registrado en el kardex.")
    await refresh()
  }

  async function migrateLegacyItem(legacyItem) {
    const initialQuantity = Number(legacyItem?.stockByLocation?.almacen ?? legacyItem.stockActual ?? legacyItem.totalUnidades ?? 0)
    const minimumQuantity = Number(legacyItem?.minimumStockByLocation?.almacen ?? legacyItem.puntoMinimo ?? 0)
    const { data, error: createError } = await createInventoryItem({
      name: legacyItem.nombre || "Producto legacy",
      sku: legacyItem.codigo || legacyItem.codigoBarras || "",
      category: legacyItem.categoria || "",
      purchase_unit: legacyItem.unidadCompra || "unidad",
      base_unit: legacyItem.unidadCompra || "unidad",
      conversion_factor: 1,
      cost_per_base_unit: Number(legacyItem.costoUnitario || 0),
      supplier: legacyItem.proveedorNombre || "",
      notes: "Migrado manualmente desde inventario local.",
      active: true
    })
    if (createError) {
      setError(createError.message || "No se pudo migrar el item local.")
      return
    }
    const stockResult = await adjustAreaInventory(
      data.id,
      "almacen",
      initialQuantity,
      minimumQuantity,
      legacyItem.unidadCompra || "unidad",
      "Migración manual desde localStorage"
    )
    if (stockResult.error) {
      setError("El item fue creado, pero falló la migración del stock inicial.")
      return
    }
    const nextLegacy = legacyItems.map((entry) => entry.id === legacyItem.id
      ? { ...entry, migratedToSupabaseId: data.id, migratedAt: new Date().toISOString() }
      : entry)
    localStorage.setItem("ingredientes", JSON.stringify(nextLegacy))
    setLegacyItems(nextLegacy)
    setMessage(`${legacyItem.nombre || "Item"} migrado a Supabase.`)
    await refresh()
  }

  const visibleItems = useMemo(() => items.filter((item) => {
    const text = `${item.name || ""} ${item.sku || ""} ${item.category || ""}`.toLowerCase()
    return (!query || text.includes(query.toLowerCase())) && (areaFilter === "todos" || item.active !== false)
  }), [areaFilter, items, query])
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

      {legacyItems.length > 0 && (
        <div className="inventory-base-warning">
          Existen productos de inventario locales. Deben migrarse a Supabase.
          {canManage && <button type="button" onClick={() => setLegacyOpen(true)}>Ver inventario local legacy</button>}
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
      {section === "inventarioAreas" && <AreaStockDashboard items={items} areas={areas} canManage={canManage} onAdjust={openAdjustment} />}
      {section === "movimientosInventario" && <MovementsTable movements={movements} items={movementItems} areas={areaNames} loading={loading} />}

      {showItemForm && <ItemModal form={itemForm} setForm={setItemForm} editing={Boolean(editingItem)} onSave={saveItem} onClose={() => setShowItemForm(false)} />}
      {adjustment && <AdjustmentModal adjustment={adjustment} setAdjustment={setAdjustment} items={items} areas={areas} onSave={saveAdjustment} onClose={() => setAdjustment(null)} />}
      {legacyOpen && <LegacyModal items={legacyItems} canManage={canManage} onMigrate={migrateLegacyItem} onClose={() => setLegacyOpen(false)} />}
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
  return (
    <>
      <div className="inventory-base-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto, SKU o categoría..." />
        <select value={areaFilter} onChange={(event) => setAreaFilter(event.target.value)}>
          <option value="todos">Todas las áreas</option>
          {areas.map((area) => <option value={area.id} key={area.id}>{area.name}</option>)}
        </select>
      </div>
      <div className="inventory-table">
        <div className="inventory-table-head"><span>Producto</span><span>Unidad</span><span>Stock área</span><span>Stock total</span><span>Mínimo</span><span>Estado</span><span>Acciones</span></div>
        {loading ? <p className="inventory-empty">Cargando inventario...</p> : items.map((item) => {
          const areaStock = areaFilter === "todos" ? item.totalQuantity : stockOf(item, areaFilter)
          const minimum = areaFilter === "todos" ? minimumOf(item, "almacen") : minimumOf(item, areaFilter)
          return (
            <article className="inventory-row" key={item.id}>
              <div className="inventory-product-cell">
                <ProductImage item={item} />
                <span><strong>{item.name}</strong><small>{item.category || "Sin categoría"} · {item.sku || "Sin SKU"}</small></span>
              </div>
              <span>{item.base_unit}</span>
              <strong>{areaStock}</strong>
              <strong>{item.totalQuantity}</strong>
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

function AreaStockDashboard({ items, areas, canManage, onAdjust }) {
  return <div className="inventory-area-grid">{areas.map((area) => {
    const areaItems = items.filter((item) => item.active !== false)
    const low = areaItems.filter((item) => stockOf(item, area.id) <= minimumOf(item, area.id) && minimumOf(item, area.id) > 0).length
    const empty = areaItems.filter((item) => stockOf(item, area.id) === 0).length
    return <article className="inventory-area-card" key={area.id}>
      <h2>{area.name}</h2>
      <div className="inventory-area-metrics"><span>Productos<strong>{areaItems.length}</strong></span><span>Bajos<strong>{low}</strong></span><span>Agotados<strong>{empty}</strong></span></div>
      {areaItems.slice(0, 6).map((item) => <div className="inventory-area-line" key={item.id}><ProductImage item={item} small /><span>{item.name}</span><strong>{stockOf(item, area.id)} {item.base_unit}</strong>{canManage && <button type="button" onClick={() => onAdjust(item, area.id)}>Ajustar</button>}</div>)}
    </article>
  })}</div>
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

function ItemModal({ form, setForm, editing, onSave, onClose }) {
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
      <Field label="Unidad de compra"><input value={form.purchase_unit} onChange={(event) => update("purchase_unit", event.target.value)} placeholder="kg, caja, botella" /></Field>
      <Field label="Unidad base"><input required value={form.base_unit} onChange={(event) => update("base_unit", event.target.value)} placeholder="g, ml, unidad" /></Field>
      <Field label="Factor conversión"><input min="0.0001" step="any" type="number" value={form.conversion_factor} onChange={(event) => update("conversion_factor", event.target.value)} /></Field>
      <Field label="Costo por unidad base"><input min="0" step="any" type="number" value={form.cost_per_base_unit} onChange={(event) => update("cost_per_base_unit", event.target.value)} /></Field>
      {!editing && <Field label="Stock inicial almacén"><input min="0" step="any" type="number" value={form.initialQuantity} onChange={(event) => update("initialQuantity", event.target.value)} /></Field>}
      {!editing && <Field label="Mínimo almacén"><input min="0" step="any" type="number" value={form.minimumQuantity} onChange={(event) => update("minimumQuantity", event.target.value)} /></Field>}
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
    <div className="inventory-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary">Guardar</button></div>
  </form></div>
}

function AdjustmentModal({ adjustment, setAdjustment, items, areas, onSave, onClose }) {
  const item = items.find((entry) => entry.id === adjustment.itemId)
  const update = (field, value) => setAdjustment((current) => ({ ...current, [field]: value }))
  return <div className="inventory-modal-backdrop"><form className="inventory-modal compact" onSubmit={onSave}>
    <header><div><p className="inventory-base-eyebrow">Kardex</p><h2>Ajustar stock</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="inventory-base-muted">{item?.name}</p>
    <Field label="Área"><select value={adjustment.areaId} onChange={(event) => update("areaId", event.target.value)}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></Field>
    <Field label="Nueva cantidad"><input type="number" step="any" min="0" required value={adjustment.quantity} onChange={(event) => update("quantity", event.target.value)} /></Field>
    <Field label="Mínimo del área"><input type="number" step="any" min="0" required value={adjustment.minimumQuantity} onChange={(event) => update("minimumQuantity", event.target.value)} /></Field>
    <Field label="Motivo del ajuste"><textarea value={adjustment.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Obligatorio si cambia la existencia" /></Field>
    <div className="inventory-modal-actions"><button type="button" className="secondary" onClick={onClose}>Cancelar</button><button type="submit" className="primary">Registrar ajuste</button></div>
  </form></div>
}

function LegacyModal({ items, canManage, onMigrate, onClose }) {
  return <div className="inventory-modal-backdrop"><section className="inventory-modal legacy">
    <header><div><p className="inventory-base-eyebrow">Importación temporal</p><h2>Inventario local legacy</h2></div><button type="button" onClick={onClose}>Cerrar</button></header>
    <p className="inventory-base-muted">Estos registros no alimentan el inventario oficial hasta migrarlos individualmente.</p>
    {items.map((item) => <article className="legacy-item" key={item.id || item.nombre}>
      <div><strong>{item.nombre || "Sin nombre"}</strong><small>{item.codigo || "Sin código"} · Almacén: {item.stockByLocation?.almacen ?? item.stockActual ?? 0}</small></div>
      {item.migratedToSupabaseId ? <span className="migrated">Migrado</span> : canManage && <button type="button" onClick={() => onMigrate(item)}>Migrar item local a Supabase</button>}
    </article>)}
  </section></div>
}

function Field({ label, children }) {
  return <label className="inventory-field"><span>{label}</span>{children}</label>
}

function ProductImage({ item, small = false }) {
  if (item.image_url) return <img className={`inventory-product-image${small ? " small" : ""}`} src={item.image_url} alt="" />
  return <span className={`inventory-product-placeholder${small ? " small" : ""}`}>{initials(item.name)}</span>
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
