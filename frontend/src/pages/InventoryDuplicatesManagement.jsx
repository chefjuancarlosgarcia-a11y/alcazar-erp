import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getInventoryItems } from "../services/inventoryService"
import {
  getInventoryItemUsage,
  ignoreDuplicatePair,
  listDuplicateIgnores,
  listMergedItems,
  mapMergeError,
  mergeInventoryItems
} from "../services/inventoryDuplicatesService"
import {
  CONFIDENCE_LABELS,
  buildGroupMergeSimulation,
  canonicalPairKey,
  detectDuplicateGroups,
  formatItemSummary,
  formatUsageForDisplay,
  getItemStatusBadges,
  reasonLabels,
  suggestPrimaryName,
  usageCountSummary
} from "../utils/duplicateDetectionUtils"
import "./RolesManagement.css"
import "./InventoryDuplicatesManagement.css"

const MANAGER_ROLES = ["admin", "gerente_general", "encargado_almacen"]

function formatDate(value) {
  if (!value) return "—"
  return new Date(value).toLocaleString("es-GT", { dateStyle: "short", timeStyle: "short" })
}

function formatCurrency(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function ConfidenceBadge({ confidence }) {
  return (
    <span className={`inventory-duplicates-badge inventory-duplicates-badge--${confidence}`}>
      {CONFIDENCE_LABELS[confidence] || "Posible duplicado"}
    </span>
  )
}

function StatusBadge({ badge }) {
  if (!badge) return null
  return (
    <span className={`inventory-duplicates-badge inventory-duplicates-badge--${badge.tone}`}>
      {badge.label}
    </span>
  )
}

function UsageSummary({ usage = {} }) {
  const rows = formatUsageForDisplay(usage)
  if (!rows.length) {
    return <span className="inventory-duplicates-usage-chip">Sin referencias registradas</span>
  }
  return (
    <div className="inventory-duplicates-usage-list">
      {rows.map((row) => (
        <span key={row.label} className="inventory-duplicates-usage-chip">
          {row.label}: <strong>{row.count}</strong>
        </span>
      ))}
    </div>
  )
}

function ProductCompareCard({
  item,
  usage,
  isMaster,
  includeInMerge,
  onSelectMaster,
  onToggleInclude
}) {
  const summary = formatItemSummary(item)
  const badges = getItemStatusBadges(item, usage, { isMaster })

  return (
    <article
      className={[
        "inventory-duplicates-compare-card",
        isMaster ? "inventory-duplicates-compare-card--master" : "",
        !isMaster && !includeInMerge ? "inventory-duplicates-compare-card--excluded" : ""
      ].filter(Boolean).join(" ")}
    >
      <label className="inventory-duplicates-compare-card__master-row">
        <input
          type="radio"
          name="master-item"
          checked={isMaster}
          onChange={() => onSelectMaster(item.id)}
        />
        Producto maestro
      </label>

      {!isMaster && (
        <label className="inventory-duplicates-compare-card__include-row">
          <input
            type="checkbox"
            checked={includeInMerge}
            onChange={() => onToggleInclude(item.id)}
          />
          Incluir en fusión
        </label>
      )}

      <div className="inventory-duplicates-badges">
        {badges.map((badge) => <StatusBadge key={badge.key} badge={badge} />)}
      </div>

      <h4 className="inventory-duplicates-compare-card__title">{summary.name}</h4>

      <div className="inventory-duplicates-compare-card__row"><span>SKU</span><span>{summary.sku}</span></div>
      <div className="inventory-duplicates-compare-card__row"><span>Barcode</span><span>{summary.barcode}</span></div>
      <div className="inventory-duplicates-compare-card__row"><span>Categoría</span><span>{summary.category}</span></div>
      <div className="inventory-duplicates-compare-card__row"><span>Proveedor</span><span>{summary.supplier}</span></div>
      <div className="inventory-duplicates-compare-card__row">
        <span>Unidades</span>
        <span>{summary.purchaseUnit} / {summary.baseUnit}</span>
      </div>
      <div className="inventory-duplicates-compare-card__row"><span>Stock</span><span>{summary.stock}</span></div>
      <div className="inventory-duplicates-compare-card__row">
        <span>Costo base</span>
        <span>{formatCurrency(summary.cost)}</span>
      </div>
      <div className="inventory-duplicates-compare-card__row">
        <span>Actualizado</span>
        <span>{formatDate(summary.updatedAt)}</span>
      </div>

      <div>
        <span className="inventory-duplicates-compare-card__row">
          <span>Uso</span>
          <span>{usageCountSummary(usage)} referencias</span>
        </span>
        <UsageSummary usage={usage} />
      </div>
    </article>
  )
}

export default function InventoryDuplicatesManagement() {
  const { user } = useAuth()
  const canManage = MANAGER_ROLES.includes(user?.role) && (user?.status ?? "active") === "active"
  const [items, setItems] = useState([])
  const [ignoredPairs, setIgnoredPairs] = useState(new Set())
  const [mergedItems, setMergedItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingUsage, setLoadingUsage] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [confidenceFilter, setConfidenceFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState("possible")
  const [reviewGroupIndex, setReviewGroupIndex] = useState(-1)
  const [masterId, setMasterId] = useState("")
  const [includeInMerge, setIncludeInMerge] = useState(new Set())
  const [usageMap, setUsageMap] = useState({})
  const [confirmChecked, setConfirmChecked] = useState(false)
  const [mergeNotes, setMergeNotes] = useState("")
  const [working, setWorking] = useState(false)

  const loadData = useCallback(async () => {
    if (!canManage) return
    setLoading(true)
    setError("")
    try {
      const [itemsResult, ignoresResult, mergedResult] = await Promise.all([
        getInventoryItems(),
        listDuplicateIgnores(),
        listMergedItems()
      ])
      if (itemsResult.error) throw itemsResult.error
      if (ignoresResult.error) throw ignoresResult.error
      if (mergedResult.error) throw mergedResult.error
      setItems(itemsResult.data || [])
      setIgnoredPairs(new Set(
        (ignoresResult.data || []).map((row) => canonicalPairKey(row.item_a_id, row.item_b_id))
      ))
      setMergedItems(mergedResult.data || [])
    } catch (err) {
      setError(err.message || "No se pudo cargar la herramienta de duplicados.")
    } finally {
      setLoading(false)
    }
  }, [canManage])

  useEffect(() => {
    loadData()
  }, [loadData])

  const groups = useMemo(
    () => detectDuplicateGroups(items, ignoredPairs),
    [items, ignoredPairs]
  )

  const filteredGroups = useMemo(() => {
    const query = search.trim().toLowerCase()
    return groups.filter((group) => {
      if (confidenceFilter !== "all" && group.confidence !== confidenceFilter) return false
      if (!query) return true
      return group.items.some((item) => (
        `${item.name} ${item.sku || ""} ${item.barcode || ""} ${item.supplier || ""}`.toLowerCase().includes(query)
      ))
    })
  }, [groups, confidenceFilter, search])

  const reviewGroup = reviewGroupIndex >= 0 ? filteredGroups[reviewGroupIndex] : null

  const stats = useMemo(() => ({
    groups: groups.length,
    high: groups.filter((group) => group.confidence === "high").length,
    medium: groups.filter((group) => group.confidence === "medium").length,
    low: groups.filter((group) => group.confidence === "low").length,
    merged: mergedItems.length
  }), [groups, mergedItems])

  function defaultIncludeSet(group, nextMasterId) {
    return new Set(group.items.filter((item) => item.id !== nextMasterId).map((item) => item.id))
  }

  async function openReviewAtIndex(index) {
    const group = filteredGroups[index]
    if (!group) return
    const suggestedMaster = [...group.items].sort((a, b) => (
      Number(b.totalQuantity || 0) - Number(a.totalQuantity || 0)
      || String(a.name || "").localeCompare(String(b.name || ""), "es")
    ))[0]

    const nextMasterId = suggestedMaster?.id || group.items[0]?.id || ""
    setReviewGroupIndex(index)
    setMasterId(nextMasterId)
    setIncludeInMerge(defaultIncludeSet(group, nextMasterId))
    setConfirmChecked(false)
    setMergeNotes("")
    setMessage("")
    setError("")
    setLoadingUsage(true)
    setUsageMap({})

    try {
      const usageEntries = await Promise.all(
        group.items.map(async (item) => {
          const { data } = await getInventoryItemUsage(item.id)
          return [item.id, data || {}]
        })
      )
      setUsageMap(Object.fromEntries(usageEntries))
    } catch {
      setError("No se pudo calcular el uso de todos los productos.")
    } finally {
      setLoadingUsage(false)
    }
  }

  function openReview(group) {
    const index = filteredGroups.findIndex((entry) => entry.id === group.id)
    openReviewAtIndex(index >= 0 ? index : 0)
  }

  function closeReview() {
    if (working) return
    setReviewGroupIndex(-1)
    setUsageMap({})
    setIncludeInMerge(new Set())
    setConfirmChecked(false)
    setMergeNotes("")
    setLoadingUsage(false)
  }

  function selectMaster(itemId) {
    if (!reviewGroup) return
    setMasterId(itemId)
    setIncludeInMerge(defaultIncludeSet(reviewGroup, itemId))
    setConfirmChecked(false)
  }

  function toggleInclude(itemId) {
    setIncludeInMerge((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
    setConfirmChecked(false)
  }

  function goToPreviousGroup() {
    if (reviewGroupIndex > 0) openReviewAtIndex(reviewGroupIndex - 1)
  }

  function goToNextGroup() {
    if (reviewGroupIndex < filteredGroups.length - 1) openReviewAtIndex(reviewGroupIndex + 1)
  }

  async function handleIgnoreGroup(group) {
    if (!window.confirm("¿Marcar este grupo como «no son duplicados» y dejar de sugerirlo?")) return
    setWorking(true)
    setError("")
    setMessage("")
    try {
      for (let i = 0; i < group.items.length; i += 1) {
        for (let j = i + 1; j < group.items.length; j += 1) {
          const result = await ignoreDuplicatePair(
            group.items[i].id,
            group.items[j].id,
            "Ignorado desde revisión de duplicados"
          )
          if (result.error) throw result.error
        }
      }
      setMessage("Grupo ignorado correctamente.")
      closeReview()
      await loadData()
    } catch (err) {
      setError(err.message || "No se pudo ignorar el grupo.")
    } finally {
      setWorking(false)
    }
  }

  async function handleMergeGroup() {
    if (!reviewGroup || !masterId || !confirmChecked) return

    const duplicates = reviewGroup.items.filter(
      (item) => item.id !== masterId && includeInMerge.has(item.id)
    )

    if (!duplicates.length) {
      setError("Selecciona al menos un duplicado para fusionar.")
      return
    }

    setWorking(true)
    setError("")
    setMessage("")

    try {
      for (const duplicate of duplicates) {
        const result = await mergeInventoryItems(masterId, duplicate.id, mergeNotes)
        if (result.error) {
          throw new Error(`No se pudo fusionar "${duplicate.name}": ${mapMergeError(result.error)}`)
        }
        if (!result.data?.ok) {
          throw new Error(`No se pudo fusionar "${duplicate.name}": la operación no se completó.`)
        }
      }
      setMessage(`Fusión completada correctamente. ${duplicates.length} producto(s) consolidados.`)
      closeReview()
      await loadData()
    } catch (err) {
      setError(err.message || "No se pudo completar la fusión.")
    } finally {
      setWorking(false)
    }
  }

  const masterItem = reviewGroup?.items.find((item) => item.id === masterId)
  const selectedDuplicates = reviewGroup?.items.filter(
    (item) => item.id !== masterId && includeInMerge.has(item.id)
  ) || []
  const mergeSimulation = masterItem
    ? buildGroupMergeSimulation(masterItem, selectedDuplicates, usageMap)
    : null

  const canMerge = Boolean(
    masterId &&
    confirmChecked &&
    selectedDuplicates.length > 0 &&
    !working &&
    !loadingUsage
  )

  if (!canManage) {
    return (
      <section className="inventory-duplicates-page">
        <p>No tienes permiso para usar la herramienta de duplicados.</p>
        <Link className="roles-secondary-btn secondary" to="/inventory?section=inventario">Volver a productos</Link>
      </section>
    )
  }

  return (
    <section className="inventory-duplicates-page">
      <header className="roles-header">
        <div>
          <p className="roles-eyebrow">Inventario · Herramientas</p>
          <h1>Duplicados de productos</h1>
          <p>Detecta productos repetidos y fusiónalos sin perder stock, historial ni referencias.</p>
        </div>
        <Link className="roles-secondary-btn secondary" to="/inventory?section=inventario">Volver a productos</Link>
      </header>

      {error && !reviewGroup && <div className="roles-error">{error}</div>}
      {message && !reviewGroup && <div className="roles-success">{message}</div>}

      <div className="inventory-duplicates-stats">
        <div className="inventory-duplicates-stat"><span>Grupos detectados</span><strong>{stats.groups}</strong></div>
        <div className="inventory-duplicates-stat"><span>Alta confianza</span><strong>{stats.high}</strong></div>
        <div className="inventory-duplicates-stat"><span>Media confianza</span><strong>{stats.medium}</strong></div>
        <div className="inventory-duplicates-stat"><span>Baja confianza</span><strong>{stats.low}</strong></div>
        <div className="inventory-duplicates-stat"><span>Ya fusionados</span><strong>{stats.merged}</strong></div>
      </div>

      <div className="inventory-duplicates-toolbar">
        <select value={viewMode} onChange={(event) => setViewMode(event.target.value)}>
          <option value="possible">Posibles duplicados</option>
          <option value="merged">Ya fusionados</option>
        </select>
        {viewMode === "possible" && (
          <>
            <select value={confidenceFilter} onChange={(event) => setConfidenceFilter(event.target.value)}>
              <option value="all">Todas las confianzas</option>
              <option value="high">Alta confianza</option>
              <option value="medium">Media confianza</option>
              <option value="low">Baja confianza</option>
            </select>
            <input
              type="search"
              placeholder="Buscar en grupos..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </>
        )}
        <button type="button" className="roles-secondary-btn" onClick={loadData} disabled={loading || working}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {loading ? (
        <p className="inventory-duplicates-status inventory-duplicates-status--loading">Cargando posibles duplicados…</p>
      ) : viewMode === "merged" ? (
        <div className="inventory-duplicates-list">
          {mergedItems.map((item) => (
            <article key={item.id} className="inventory-duplicates-card">
              <div className="inventory-duplicates-card__head">
                <ConfidenceBadge confidence="merged" />
                <h3>{item.name}</h3>
                <p className="inventory-duplicates-card__meta">Fusionado · {formatDate(item.merged_at)}</p>
              </div>
            </article>
          ))}
          {!mergedItems.length && (
            <p className="inventory-duplicates-empty">No hay productos fusionados recientes.</p>
          )}
        </div>
      ) : (
        <div className="inventory-duplicates-list">
          {filteredGroups.map((group) => (
            <article key={group.id} className="inventory-duplicates-card">
              <div className="inventory-duplicates-card__head">
                <ConfidenceBadge confidence={group.confidence} />
                <h3>{suggestPrimaryName(group.items)}</h3>
                <p className="inventory-duplicates-card__meta">
                  {group.items.length} posibles duplicados · Similitud {(group.maxSimilarity * 100).toFixed(0)}%
                </p>
                <div className="inventory-duplicates-reasons">
                  {reasonLabels(group.reasons).map((reason) => (
                    <span key={reason} className="inventory-duplicates-reason">{reason}</span>
                  ))}
                </div>
              </div>
              <div className="inventory-duplicates-items">
                {group.items.slice(0, 4).map((item) => {
                  const summary = formatItemSummary(item)
                  return (
                    <div key={item.id} className="inventory-duplicates-item-line">
                      <strong>{summary.name}</strong>
                      <span>Stock {summary.stock} · {formatCurrency(summary.cost)}</span>
                    </div>
                  )
                })}
                {group.items.length > 4 && (
                  <p className="inventory-duplicates-card__meta">+{group.items.length - 4} producto(s) más</p>
                )}
              </div>
              <div className="inventory-duplicates-actions">
                <button type="button" className="roles-primary-btn" onClick={() => openReview(group)}>Revisar</button>
                <button
                  type="button"
                  className="roles-secondary-btn"
                  onClick={() => handleIgnoreGroup(group)}
                  disabled={working}
                >
                  Ignorar
                </button>
              </div>
            </article>
          ))}
          {!filteredGroups.length && (
            <p className="inventory-duplicates-empty">No hay duplicados pendientes con los filtros actuales.</p>
          )}
        </div>
      )}

      {reviewGroup && (
        <div className="inventory-duplicates-backdrop">
          <section className="inventory-duplicates-modal" aria-label="Comparador de duplicados">
            <header className="inventory-duplicates-modal__header">
              <div>
                <p className="roles-eyebrow">Revisión de duplicados</p>
                <h2>
                  Grupo {reviewGroupIndex + 1} de {filteredGroups.length}
                </h2>
                <p className="inventory-duplicates-modal__subtitle">
                  Nombre sugerido: <strong>{suggestPrimaryName(reviewGroup.items)}</strong>
                  {" · "}{reviewGroup.items.length} productos
                  {" · "}Similitud {(reviewGroup.maxSimilarity * 100).toFixed(0)}%
                </p>
                <div className="inventory-duplicates-group-meta">
                  <ConfidenceBadge confidence={reviewGroup.confidence} />
                </div>
              </div>
              <div className="inventory-duplicates-modal__nav">
                <button
                  type="button"
                  className="roles-secondary-btn"
                  onClick={goToPreviousGroup}
                  disabled={working || reviewGroupIndex <= 0}
                >
                  Anterior
                </button>
                <button
                  type="button"
                  className="roles-secondary-btn"
                  onClick={goToNextGroup}
                  disabled={working || reviewGroupIndex >= filteredGroups.length - 1}
                >
                  Siguiente
                </button>
                <button type="button" className="roles-secondary-btn" onClick={closeReview} disabled={working}>
                  Cancelar
                </button>
              </div>
            </header>

            <div className="inventory-duplicates-modal__body">
              {error && <div className="roles-error">{error}</div>}

              <section className="inventory-duplicates-detected">
                <h3>Coincidencias detectadas</h3>
                <div className="inventory-duplicates-reasons">
                  {reasonLabels(reviewGroup.reasons).map((reason) => (
                    <span key={reason} className="inventory-duplicates-reason">{reason}</span>
                  ))}
                  <span className="inventory-duplicates-reason">
                    Similitud: {(reviewGroup.maxSimilarity * 100).toFixed(0)}%
                  </span>
                </div>
              </section>

              {loadingUsage ? (
                <p className="inventory-duplicates-status inventory-duplicates-status--loading">Calculando uso…</p>
              ) : (
                <div className="inventory-duplicates-compare-grid">
                  {reviewGroup.items.map((item) => (
                    <ProductCompareCard
                      key={item.id}
                      item={item}
                      usage={usageMap[item.id] || {}}
                      isMaster={masterId === item.id}
                      includeInMerge={includeInMerge.has(item.id)}
                      onSelectMaster={selectMaster}
                      onToggleInclude={toggleInclude}
                    />
                  ))}
                </div>
              )}

              {mergeSimulation && !loadingUsage && (
                <section className="inventory-duplicates-preview">
                  <h3>Resultado de la fusión</h3>
                  <div className="inventory-duplicates-preview-grid">
                    <span>Producto maestro: <strong>{mergeSimulation.masterName}</strong></span>
                    <span>Productos a fusionar: <strong>{mergeSimulation.mergeCount}</strong></span>
                    <span>Stock final estimado: <strong>{mergeSimulation.estimatedStock}</strong></span>
                    <span>Costo que se conservará: <strong>{formatCurrency(mergeSimulation.cost)}</strong></span>
                    <span>SKU: <strong>{mergeSimulation.sku}</strong></span>
                    <span>Barcode principal: <strong>{mergeSimulation.barcode}</strong></span>
                    {mergeSimulation.barcodeAliases.length > 0 && (
                      <span>
                        Barcodes alias: <strong>{mergeSimulation.barcodeAliases.join(", ")}</strong>
                      </span>
                    )}
                    <span>Foto: <strong>{mergeSimulation.imageUrl ? "Se conservará del maestro o duplicado" : "Sin foto"}</strong></span>
                  </div>
                  {mergeSimulation.costWarning && (
                    <p className="inventory-duplicates-warning">
                      Advertencia: alguno de los duplicados tiene un costo muy distinto al maestro.
                    </p>
                  )}
                  {mergeSimulation.referencesMoving.length > 0 ? (
                    <>
                      <p className="inventory-duplicates-card__meta">Referencias que se moverán al maestro:</p>
                      <div className="inventory-duplicates-usage-list">
                        {mergeSimulation.referencesMoving.map((row) => (
                          <span key={row.label} className="inventory-duplicates-usage-chip">
                            {row.label}: <strong>{row.count}</strong>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="inventory-duplicates-card__meta">No hay referencias operativas en los duplicados seleccionados.</p>
                  )}
                </section>
              )}

              <section className="inventory-duplicates-security">
                <h3>Confirmación requerida</h3>
                <p>
                  Esta acción fusionará productos, moverá sus referencias al maestro seleccionado y dejará
                  los duplicados inactivos. No se puede deshacer fácilmente desde la interfaz.
                </p>
                <ul>
                  <li>Se conservará el producto maestro</li>
                  <li>Se moverán referencias al maestro</li>
                  <li>Se conservarán barcodes como alias cuando aplique</li>
                  <li>Los duplicados quedarán inactivos</li>
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmChecked}
                    onChange={(event) => setConfirmChecked(event.target.checked)}
                    disabled={working || loadingUsage}
                  />
                  Entiendo que esta acción fusionará productos y no se puede deshacer fácilmente.
                </label>
                <div className="inventory-duplicates-field">
                  <label htmlFor="merge-audit-notes">Notas de auditoría</label>
                  <textarea
                    id="merge-audit-notes"
                    placeholder="Ej. Se fusiona duplicado creado durante carga inicial de inventario."
                    value={mergeNotes}
                    onChange={(event) => setMergeNotes(event.target.value)}
                    disabled={working}
                  />
                </div>
              </section>
            </div>

            <footer className="inventory-duplicates-modal__footer">
              <button
                type="button"
                className="roles-secondary-btn"
                onClick={() => handleIgnoreGroup(reviewGroup)}
                disabled={working}
              >
                No son duplicados
              </button>
              <button type="button" className="roles-secondary-btn" onClick={closeReview} disabled={working}>
                Cancelar
              </button>
              <button
                type="button"
                className="roles-primary-btn"
                disabled={!canMerge}
                onClick={handleMergeGroup}
              >
                {working ? "Fusionando…" : "Fusionar"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </section>
  )
}
