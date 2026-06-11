export default function PosServiceTerminal({
  notices,
  categories,
  activeCategoryId,
  onSelectCategory,
  showSearch,
  onToggleSearch,
  productSearch,
  onProductSearchChange,
  searchInputRef,
  salesChannel,
  salesChannelLabel,
  salesChannels,
  onSelectSalesChannel,
  floorAreas,
  activeAreaId,
  onSelectArea,
  showProductCatalog,
  activeCategoryName,
  ordenMesa,
  workspaceContent,
  ticketContent,
  footerContent
}) {
  const workspaceMode = salesChannel === "dine_in"
    ? (showProductCatalog ? "menu" : "floor")
    : "channel"

  return (
    <div className="pos-classic-terminal">
      {notices}

      <header className="pos-classic-topbar">
        <div className="pos-classic-categories" role="tablist" aria-label="Categorías del menú">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={activeCategoryId === category.id}
              className={`pos-classic-category${activeCategoryId === category.id ? " active" : ""}${category.isPizza ? " pizza" : ""}`}
              style={{ "--pos-cat-color": category.color || "#0d9488" }}
              onClick={() => onSelectCategory(category.id)}
            >
              {category.icon && <span className="pos-classic-category-icon">{category.icon}</span>}
              <span className="pos-classic-category-label">{category.name}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`pos-classic-search-toggle${showSearch ? " active" : ""}`}
          onClick={onToggleSearch}
        >
          Buscar
        </button>
        {showSearch && (
          <div className="pos-classic-search-field">
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Buscar producto..."
              value={productSearch}
              onChange={(event) => onProductSearchChange(event.target.value)}
              autoFocus
            />
          </div>
        )}
      </header>

      <div className="pos-classic-main">
        <section className="pos-classic-workspace">
          <div className="pos-classic-toolbar">
            <div className="pos-classic-toolbar-start">
              {floorAreas.length > 0 && (
                <div className="pos-zone-tabs" role="tablist" aria-label="Áreas del restaurante">
                  {floorAreas.map((area) => (
                    <button
                      key={area.id}
                      type="button"
                      role="tab"
                      aria-selected={activeAreaId === area.id && salesChannel === "dine_in"}
                      className={activeAreaId === area.id && salesChannel === "dine_in" ? "active" : ""}
                      onClick={() => onSelectArea(area.id)}
                    >
                      {area.nombre}
                    </button>
                  ))}
                </div>
              )}
              <div className="pos-workspace-mode" aria-live="polite">
                {workspaceMode === "floor" && (
                  <span className="pos-workspace-badge floor is-active">Plano de mesas</span>
                )}
                {workspaceMode === "menu" && (
                  <span className="pos-workspace-badge menu is-active">Menú · {activeCategoryName || "Productos"}</span>
                )}
                {workspaceMode === "channel" && (
                  <span className="pos-workspace-badge channel is-active">{salesChannelLabel}</span>
                )}
              </div>
            </div>
            <div className="pos-classic-channel-toggle" role="group" aria-label="Otros canales de venta">
              {salesChannels.filter((channel) => channel.id !== "dine_in").map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={salesChannel === channel.id ? "active" : ""}
                  onClick={() => onSelectSalesChannel(channel.id)}
                >
                  {channel.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pos-classic-workspace-body">
            {workspaceContent}
          </div>
        </section>

        <aside className={`pos-classic-ticket pos-current-order${ordenMesa ? " has-order" : ""}${ordenMesa && !ordenMesa.isSalesChannel ? " is-dine-in" : ""}`}>
          {ticketContent}
        </aside>
      </div>

      <footer className="pos-classic-footer">
        {footerContent}
      </footer>
    </div>
  )
}
