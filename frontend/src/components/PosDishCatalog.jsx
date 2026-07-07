import { useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
  catalogStatusBadgeClass,
  catalogStatusLabel,
  isCatalogCardReady
} from "../utils/posCatalogFilters"
import { catalogErrorUserMessage } from "../utils/posCatalogDiagnostics"
import { getCatalogProductionBadgeLines } from "../utils/posImplementationMode"
import PosProductImplementationBadges from "./PosProductImplementationBadges"

const readyBadgeStyle = { padding: "5px 8px", borderRadius: "999px", background: "var(--erp-success-soft)", color: "var(--erp-success)", fontSize: ".76rem", fontWeight: 800 }
const invalidBadgeStyle = { padding: "5px 8px", borderRadius: "999px", background: "color-mix(in srgb, var(--erp-danger) 18%, #1a0f12)", color: "#fecaca", border: "1px solid color-mix(in srgb, var(--erp-danger) 55%, #334155)", fontSize: ".76rem", fontWeight: 800 }

function ProductionBadges({ state }) {
  const lines = getCatalogProductionBadgeLines(state)
  return (
    <div className="pos-readiness-badges">
      {lines.map((line) => (
        <span key={line.label} style={line.ok ? readyBadgeStyle : invalidBadgeStyle}>{line.label}</span>
      ))}
    </div>
  )
}

function catalogLoadState({ loading, errorKind, errorMessage, total }) {
  if (loading) return "loading"
  if (errorKind === "timeout") return "error_timeout"
  if (errorKind === "rls") return "error_rls"
  if (errorKind === "other" || errorMessage) return "error_other"
  if (total === 0) return "loaded_empty"
  return "loaded"
}

export default function PosDishCatalog({
  user,
  items,
  itemsLoading,
  catalogLoadError = "",
  catalogErrorKind = null,
  catalogTotal = null,
  catalogPage = 1,
  catalogPageSize = 50,
  catalogSearch = "",
  catalogCategoryFilter = "",
  catalogStatusFilter = "active",
  onCatalogSearchChange,
  onCatalogCategoryChange,
  onCatalogStatusChange,
  onCatalogPageChange,
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
  const [viewMode, setViewMode] = useState("grid")
  const isAdmin = user?.role === "admin"
  const loadState = catalogLoadState({
    loading: itemsLoading,
    errorKind: catalogErrorKind,
    errorMessage: catalogLoadError,
    total: catalogTotal
  })
  const totalPages = catalogTotal != null ? Math.max(1, Math.ceil(catalogTotal / catalogPageSize)) : 1
  const displayItems = items

  const countLabel = useMemo(() => {
    if (loadState === "loading") return "Cargando catálogo..."
    if (loadState.startsWith("error_")) return "Catálogo no disponible"
    if (catalogTotal == null) return `${displayItems.length} platillo(s)`
    return `${displayItems.length} en esta página · ${catalogTotal} total`
  }, [loadState, catalogTotal, displayItems.length])

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

      {loadState.startsWith("error_") && (
        <div className="pos-catalog-load-error" style={errorBoxStyle} role="alert">
          <strong>
            {loadState === "error_timeout" && "Tiempo de espera agotado"}
            {loadState === "error_rls" && "Error de permisos o sesión"}
            {loadState === "error_other" && "Error al cargar el catálogo"}
          </strong>
          <p>{catalogErrorUserMessage(catalogErrorKind, catalogLoadError)}</p>
          {catalogLoadError && catalogLoadError !== catalogErrorUserMessage(catalogErrorKind) && (
            <p className="pos-catalog-load-error-detail">{catalogLoadError}</p>
          )}
        </div>
      )}

      <div className="pos-dish-catalog-toolbar">
        <input
          type="search"
          className="pos-dish-catalog-search"
          placeholder="Buscar platillo..."
          value={catalogSearch}
          onChange={(event) => onCatalogSearchChange(event.target.value)}
          disabled={itemsLoading}
        />
        <select
          className="pos-dish-catalog-select"
          value={catalogCategoryFilter}
          onChange={(event) => onCatalogCategoryChange(event.target.value)}
          disabled={itemsLoading}
        >
          <option value="">Todas las categorías</option>
          {posCategories.filter((category) => category.active !== false).map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <div className="pos-dish-status-filter" role="group" aria-label="Estado del catálogo">
          <button type="button" className={catalogStatusFilter === "active" ? "active" : ""} onClick={() => onCatalogStatusChange("active")}>
            Activos
          </button>
          <button type="button" className={catalogStatusFilter === "inactive" ? "active" : ""} onClick={() => onCatalogStatusChange("inactive")}>
            Inactivos
          </button>
          <button type="button" className={catalogStatusFilter === "all" ? "active" : ""} onClick={() => onCatalogStatusChange("all")}>
            Todos
          </button>
        </div>
        <div className="pos-dish-view-toggle" role="group" aria-label="Vista del catálogo">
          <button type="button" className={viewMode === "grid" ? "active" : ""} onClick={() => setViewMode("grid")}>Tarjetas</button>
          {isAdmin && <button type="button" className={viewMode === "table" ? "active" : ""} onClick={() => setViewMode("table")}>Tabla</button>}
        </div>
        <span className="pos-dish-catalog-count">{countLabel}</span>
      </div>

      {catalogTotal != null && catalogTotal > catalogPageSize && !loadState.startsWith("error_") && (
        <div className="pos-dish-catalog-pagination">
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={itemsLoading || catalogPage <= 1}
            onClick={() => onCatalogPageChange(catalogPage - 1)}
          >
            Anterior
          </button>
          <span>Página {catalogPage} de {totalPages}</span>
          <button
            type="button"
            style={secondaryButtonStyle}
            disabled={itemsLoading || catalogPage >= totalPages}
            onClick={() => onCatalogPageChange(catalogPage + 1)}
          >
            Siguiente
          </button>
        </div>
      )}

      {formPanel}

      {loadState === "loading" && (
        <div className="pos-friendly-empty">Cargando platillos desde Supabase...</div>
      )}

      {loadState === "loaded_empty" && (
        <div className="pos-friendly-empty">
          <p>No hay platillos en el catálogo de Supabase (`public.pos_products`) con los filtros actuales.</p>
          <p>Crea un platillo con «+ Nuevo platillo» o cambia los filtros de búsqueda.</p>
        </div>
      )}

      {!itemsLoading && !loadState.startsWith("error_") && loadState !== "loaded_empty" && displayItems.length === 0 && catalogTotal > 0 && (
        <div className="pos-friendly-empty">Ningún platillo en esta página. Prueba otra página o ajusta los filtros.</div>
      )}

      {!itemsLoading && displayItems.length > 0 && !loadState.startsWith("error_") && (
        viewMode === "table" && isAdmin ? (
          <div className="pos-dish-table-wrap">
            <table className="pos-dish-table">
              <thead>
                <tr>
                  <th>Platillo</th>
                  <th>Categoría</th>
                  <th>Precio</th>
                  <th>Área</th>
                  <th>Estado</th>
                  <th>Receta / Inventario</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item) => {
                  const state = getItemState(item)
                  const price = (item.productType || item.product_type) === "pizza" || (item.productType || item.product_type) === "configurable"
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
                      <td><span className={`pos-dish-status-badge ${catalogStatusBadgeClass(state)}`}>{catalogStatusLabel(state)}</span></td>
                      <td>
                        <PosProductImplementationBadges state={state} product={item} />
                      </td>
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
            {displayItems.map((item) => {
              const state = getItemState(item)
              return (
                <article className={`pos-dish-card${state.active ? "" : " is-inactive"}${isCatalogCardReady(state) ? " is-ready" : ""}`} key={item.id}>
                  {item.imagen
                    ? <img src={item.imagen} alt={item.nombre} style={thumbStyle} />
                    : item.hasImage
                      ? <div className="pos-dish-card-placeholder" title="Imagen disponible al editar">📷</div>
                      : <div className="pos-dish-card-placeholder">{productInitials(item.nombre)}</div>}
                  <div className="pos-dish-card-copy">
                    <div className="pos-dish-card-head">
                      <span className="pos-product-category">{item.categoria}</span>
                      <span className={`pos-dish-status-badge ${catalogStatusBadgeClass(state)}`}>{catalogStatusLabel(state)}</span>
                    </div>
                    <h3>{item.nombre}</h3>
                    <PosProductImplementationBadges state={state} product={item} />
                    {isTestProduct(item) && <span className="pos-test-badge">Prueba KDS</span>}
                    <p className="pos-dish-card-meta">
                      {productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || "Sin área"}
                      {" · "}
                      {(item.productType || item.product_type) === "pizza" || (item.productType || item.product_type) === "configurable"
                        ? `Desde Q${getProductBasePrice(item).toFixed(2)}`
                        : `Q${Number(item.precio || 0).toFixed(2)}`}
                      {" · "}
                      {formatProductTypeLabel(item.productType || item.product_type || "simple")}
                    </p>
                    {(item.productType || item.product_type) === "configurable" && (
                      <small className="pos-dish-card-meta">
                        {(item.optionGroups || item.option_groups || []).filter((group) => group.isActive !== false).length} grupo(s) de opciones
                      </small>
                    )}
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
        )
      )}
    </div>
  )
}
