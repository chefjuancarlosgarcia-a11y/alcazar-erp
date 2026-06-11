import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { catalogStatusLabel, matchesCatalogFilters } from "../utils/posCatalogFilters"

const readyBadgeStyle = { padding: "5px 8px", borderRadius: "999px", background: "var(--erp-success-soft)", color: "var(--erp-success)", fontSize: ".76rem", fontWeight: 800 }
const invalidBadgeStyle = { padding: "5px 8px", borderRadius: "999px", background: "color-mix(in srgb, var(--erp-danger) 18%, #1a0f12)", color: "#fecaca", border: "1px solid color-mix(in srgb, var(--erp-danger) 55%, #334155)", fontSize: ".76rem", fontWeight: 800 }

function ProductionBadges({ state }) {
  if (state.testItem) {
    return (
      <div className="pos-readiness-badges">
        <span style={state.area ? readyBadgeStyle : invalidBadgeStyle}>{state.area ? "✓ Destino KDS configurado" : "✗ Sin destino KDS"}</span>
        <span style={state.productionReady ? readyBadgeStyle : invalidBadgeStyle}>{state.productionReady ? "✓ Envío KDS sin consumo" : "✗ Pendiente validación KDS"}</span>
      </div>
    )
  }
  return (
    <div className="pos-readiness-badges">
      <span style={state.productType === "pizza" ? (state.variants?.length ? readyBadgeStyle : invalidBadgeStyle) : (state.recipe ? readyBadgeStyle : invalidBadgeStyle)}>
        {state.productType === "pizza" ? (state.variants?.length ? `✓ ${state.variants.length} tamaños activos` : "✗ Sin tamaños activos") : (state.recipe ? "✓ Receta conectada" : "✗ Sin receta")}
      </span>
      <span style={state.area ? readyBadgeStyle : invalidBadgeStyle}>{state.area ? "✓ Área producción configurada" : "✗ Sin área"}</span>
      <span style={state.productionReady ? readyBadgeStyle : invalidBadgeStyle}>{state.productionReady ? "✓ Listo para producción" : "✗ Pendiente validación"}</span>
    </div>
  )
}

export default function PosDishCatalog({
  user,
  items,
  itemsLoading,
  posCategories,
  productionAreas,
  getItemState,
  productProductionAreaId,
  getProductBasePrice,
  formatProductTypeLabel,
  isTestProduct,
  productInitials,
  formatPizzaSizeLabel,
  getActiveProductVariants,
  getActiveProductModifiers,
  localPOSProducts,
  migratingLocalProducts,
  migrationProgress,
  onMigrateLocal,
  feedbackMessage,
  feedbackTone = "success",
  postSaveHint,
  onDismissPostSave,
  formPanel,
  onNewDish,
  onEditItem,
  onDeactivateItem,
  onReactivateItem,
  onOpenDiagnostic,
  thumbStyle,
  headerStyle,
  buttonRowStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  dangerMiniButtonStyle,
  successInlineStyle,
  warningBoxStyle,
  errorBoxStyle,
  itemListStyle
}) {
  const [catalogFilter, setCatalogFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")
  const [viewMode, setViewMode] = useState("grid")
  const isAdmin = user?.role === "admin"

  const filteredItems = useMemo(() => items.filter((item) => matchesCatalogFilters(item, {
    query: catalogFilter,
    categoryId: categoryFilter,
    status: statusFilter
  }, getItemState)), [items, catalogFilter, categoryFilter, statusFilter, getItemState])

  const statusCounts = useMemo(() => ({
    all: items.length,
    active: items.filter((item) => getItemState(item).active).length,
    ready: items.filter((item) => getItemState(item).productionReady).length,
    pending: items.filter((item) => {
      const state = getItemState(item)
      return state.active && !state.productionReady
    }).length,
    inactive: items.filter((item) => !getItemState(item).active).length
  }), [items, getItemState])

  function renderActions(item, state) {
    return (
      <div className="pos-dish-card-actions">
        <button type="button" onClick={() => onEditItem(item)} style={secondaryButtonStyle}>Editar</button>
        {state.active ? (
          <button type="button" onClick={() => onDeactivateItem(item)} style={dangerMiniButtonStyle}>Desactivar</button>
        ) : (
          <button type="button" onClick={() => onReactivateItem(item)} style={primaryButtonStyle}>Reactivar</button>
        )}
        {isAdmin && (
          <button type="button" className="pos-dish-diagnostic-btn" onClick={() => onOpenDiagnostic(item)} style={secondaryButtonStyle}>
            Diagnóstico
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="pos-dish-manager">
      <header className="pos-dish-manager-header" style={headerStyle}>
        <div>
          <p className="pos-operation-eyebrow">Catálogo del punto de venta</p>
          <h1>Agregar Platillo</h1>
          <p>Crea platillos visuales, edítalos y publícalos en el POS.</p>
        </div>
        <div style={buttonRowStyle}>
          {isAdmin && localPOSProducts.length > 0 && (
            <button type="button" disabled={migratingLocalProducts} onClick={onMigrateLocal} style={secondaryButtonStyle}>
              {migratingLocalProducts ? "Migrando..." : `Migrar ${localPOSProducts.length} local(es)`}
            </button>
          )}
          <button type="button" onClick={onNewDish} style={primaryButtonStyle}>+ Nuevo platillo</button>
        </div>
      </header>

      <div style={successInlineStyle}>Fuente oficial del catálogo POS: <strong>Supabase `public.pos_products`</strong>.</div>

      {localPOSProducts.length > 0 && (
        <div className="pos-local-migration-banner" style={warningBoxStyle}>
          <div>
            <strong>{localPOSProducts.length} producto(s) POS local(es) pendientes de migrar.</strong>
            <p>No se usan en venta hasta migrarlos a Supabase.</p>
          </div>
          {isAdmin && (
            <button type="button" disabled={migratingLocalProducts} onClick={onMigrateLocal} style={secondaryButtonStyle}>
              {migratingLocalProducts ? "Migrando..." : "Migrar ahora"}
            </button>
          )}
        </div>
      )}

      {migratingLocalProducts && migrationProgress?.total > 0 && (
        <div className="pos-migration-progress">
          <div className="pos-migration-progress-copy">
            <strong>Migrando catálogo local</strong>
            <span>{migrationProgress.current} / {migrationProgress.total} · {migrationProgress.label || "..."}</span>
          </div>
          <progress max={migrationProgress.total} value={migrationProgress.current} />
        </div>
      )}

      {postSaveHint && (
        <div className={`pos-post-save-hint${postSaveHint.needsRecipe ? " needs-recipe" : ""}`}>
          <div>
            <strong>{postSaveHint.title}</strong>
            <p>{postSaveHint.message}</p>
            {postSaveHint.issues?.length > 0 && (
              <ul>
                {postSaveHint.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            )}
          </div>
          <div className="pos-post-save-hint-actions">
            {postSaveHint.needsRecipe && (
              <Link to="/inventory?section=recetas" className="pos-post-save-link">Ir a Recetas</Link>
            )}
            <button type="button" className="secondary" onClick={onDismissPostSave}>Entendido</button>
          </div>
        </div>
      )}

      {feedbackMessage && (
        <div style={feedbackTone === "error" ? errorBoxStyle : feedbackTone === "warning" ? warningBoxStyle : successInlineStyle}>
          {feedbackMessage}
        </div>
      )}

      <div className="pos-dish-catalog-toolbar">
        <input
          type="search"
          className="pos-dish-catalog-search"
          placeholder="Buscar platillo..."
          value={catalogFilter}
          onChange={(event) => setCatalogFilter(event.target.value)}
        />
        <select className="pos-dish-catalog-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Todas las categorías</option>
          {posCategories.filter((category) => category.active !== false).map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <select className="pos-dish-catalog-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">Todos ({statusCounts.all})</option>
          <option value="active">Activos ({statusCounts.active})</option>
          <option value="ready">Listos KDS ({statusCounts.ready})</option>
          <option value="pending">Pendientes KDS ({statusCounts.pending})</option>
          <option value="inactive">Inactivos ({statusCounts.inactive})</option>
        </select>
        <div className="pos-dish-view-toggle" role="group" aria-label="Vista del catálogo">
          <button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")}>Tarjetas</button>
          {isAdmin && <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Tabla</button>}
        </div>
        <span className="pos-dish-catalog-count">{filteredItems.length} platillo(s)</span>
      </div>

      {formPanel}

      {viewMode === "table" && isAdmin ? (
        <div className="pos-dish-table-wrap">
          <table className="pos-dish-table">
            <thead>
              <tr>
                <th>Platillo</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Área</th>
                <th>Estado</th>
                <th>KDS</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const state = getItemState(item)
                const price = (item.productType || item.product_type) === "pizza"
                  ? `Desde Q${getProductBasePrice(item).toFixed(2)}`
                  : `Q${Number(item.precio || 0).toFixed(2)}`
                return (
                  <tr key={item.id} className={!state.active ? "is-inactive" : ""}>
                    <td>
                      <strong>{item.nombre}</strong>
                      {isTestProduct(item) && <span className="pos-test-badge inline">Prueba</span>}
                    </td>
                    <td>{item.categoria}</td>
                    <td>{price}</td>
                    <td>{productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || "—"}</td>
                    <td><span className={`pos-dish-status-badge ${state.active ? (state.productionReady ? "ready" : "pending") : "inactive"}`}>{catalogStatusLabel(state)}</span></td>
                    <td>{state.productionReady ? "Listo" : state.issues?.slice(0, 2).join(", ") || "Pendiente"}</td>
                    <td>
                      <div className="pos-dish-table-actions">
                        <button type="button" onClick={() => onEditItem(item)} style={secondaryButtonStyle}>Editar</button>
                        {state.active
                          ? <button type="button" onClick={() => onDeactivateItem(item)} style={dangerMiniButtonStyle}>Desactivar</button>
                          : <button type="button" onClick={() => onReactivateItem(item)} style={primaryButtonStyle}>Reactivar</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="pos-dish-grid" style={itemListStyle}>
          {filteredItems.map((item) => {
            const state = getItemState(item)
            return (
              <article className={`pos-dish-card${state.active ? "" : " is-inactive"}${state.productionReady ? " is-ready" : ""}`} key={item.id}>
                {item.imagen ? <img src={item.imagen} alt={item.nombre} style={thumbStyle} /> : <div className="pos-dish-card-placeholder">{productInitials(item.nombre)}</div>}
                <div className="pos-dish-card-copy">
                  <div className="pos-dish-card-head">
                    <span className="pos-product-category">{item.categoria}</span>
                    {!state.active && <span className="pos-dish-status-badge inactive">Inactivo</span>}
                    {state.active && !state.productionReady && <span className="pos-dish-status-badge pending">Pendiente KDS</span>}
                    {state.productionReady && <span className="pos-dish-status-badge ready">Listo KDS</span>}
                  </div>
                  <h3>{item.nombre}</h3>
                  {isTestProduct(item) && <span className="pos-test-badge">Prueba KDS</span>}
                  <p className="pos-dish-card-meta">
                    {productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || "Sin área"}
                    {" · "}
                    {(item.productType || item.product_type) === "pizza"
                      ? `Desde Q${getProductBasePrice(item).toFixed(2)}`
                      : `Q${Number(item.precio || 0).toFixed(2)}`}
                    {" · "}
                    {formatProductTypeLabel(item.productType || item.product_type || "simple")}
                  </p>
                  {(item.productType || item.product_type) === "pizza" && (
                    <small className="pos-dish-card-meta">
                      {getActiveProductVariants(item).map((variant) => formatPizzaSizeLabel(variant.size)).join(", ") || "Sin tamaños activos"}
                      {" · "}
                      {getActiveProductModifiers(item).length} modificador(es)
                    </small>
                  )}
                  <ProductionBadges state={state} />
                </div>
                {renderActions(item, state)}
              </article>
            )
          })}
        </div>
      )}

      {!itemsLoading && items.length === 0 && <div className="pos-friendly-empty">No hay platillos registrados.</div>}
      {!itemsLoading && items.length > 0 && filteredItems.length === 0 && (
        <div className="pos-friendly-empty">Ningún platillo coincide con los filtros actuales.</div>
      )}
    </div>
  )
}
