export function PosTicketPanel({
  mesaCargando,
  ordenMesa,
  salesChannel,
  salesChannelLabel,
  currentOrder,
  selectedAssignment,
  seatNames,
  personasOrden,
  onPersonasChange,
  onAssignmentChange,
  totalOrden,
  activeMinutes,
  formatTableDuration,
  estadoMesaPorOrden,
  etiquetaEstadoMesa,
  tableStatusStyles,
  orden,
  draftItems,
  sentItems,
  ordenError,
  ordenMessage,
  sendingOrder,
  canRequestCashier,
  mesaBloqueadaPorCobro,
  getOrderItemDisplayName,
  getOrderItemStatusLabel,
  getOrderItemStatusStyle,
  onRefresh,
  onSendKitchen,
  onClearDraft,
  onRequestBill,
  onPrintPreBill,
  onSendCashier,
  onSplitBill,
  onExit,
  onToggleActivity,
  showActivity,
  readyItemsCount,
  nextServiceAction,
  waiterName
}) {
  const mesaLabel = ordenMesa
    ? (ordenMesa.isSalesChannel ? ordenMesa.mesaNumero : `Mesa ${ordenMesa.mesaNumero}`)
    : null
  const sillaLabel = selectedAssignment || "Mesa completa"
  const comandaNo = currentOrder?.id ? String(currentOrder.id).slice(0, 8).toUpperCase() : "—"
  const estado = ordenMesa ? estadoMesaPorOrden(currentOrder) : "disponible"
  const draftCount = draftItems.length

  return (
    <div className={`pos-ticket-panel${ordenMesa ? " is-active" : ""}${ordenMesa && !ordenMesa.isSalesChannel ? " is-dine-in" : ""}`}>
      {mesaCargando && (
        <div className="pos-mesa-loading">
          <strong>Cargando mesa...</strong>
          <span>Sincronizando orden y estado del servicio.</span>
        </div>
      )}

      {ordenMesa && (
        <div className="pos-ticket-mesa-hero" aria-live="polite">
          <div className="pos-ticket-mesa-hero-copy">
            <small>{ordenMesa.isSalesChannel ? "Canal activo" : "Mesa en servicio"}</small>
            <strong>{mesaLabel}</strong>
            {ordenMesa.areaNombre && !ordenMesa.isSalesChannel && (
              <span className="pos-ticket-mesa-area">{ordenMesa.areaNombre}</span>
            )}
            {ordenMesa.isSalesChannel && (
              <span className="pos-ticket-mesa-area">{salesChannelLabel}</span>
            )}
          </div>
          <div className="pos-ticket-mesa-hero-total">
            <small>Total</small>
            <strong>Q{totalOrden.toFixed(2)}</strong>
          </div>
        </div>
      )}

      <div className="pos-ticket-header">
        <div className="pos-ticket-meta-grid">
          <div><small>{ordenMesa?.isSalesChannel ? "Pedido" : "Mesa"}</small><strong>{mesaLabel || "—"}</strong></div>
          <div><small>Silla / asignación</small><strong>{sillaLabel}</strong></div>
          <div className="pos-ticket-total"><small>Total</small><strong>Q{totalOrden.toFixed(2)}</strong></div>
        </div>
        <div className="pos-ticket-meta-row">
          <span><small>Comanda No.</small> {comandaNo}</span>
          <span><small>Reservación</small> Sin reservación</span>
          <label className="pos-ticket-people">
            <small>Personas</small>
            <input
              type="number"
              min="1"
              max="30"
              value={personasOrden}
              disabled={!ordenMesa}
              onChange={(event) => onPersonasChange(event.target.value)}
            />
          </label>
        </div>
        {ordenMesa && (
          <div className="pos-ticket-status-row">
            <span className="pos-ticket-status" style={tableStatusStyles[estado]}>{etiquetaEstadoMesa(estado)}</span>
            <span className="pos-ticket-waiter">{waiterName || "Sin mesero"}</span>
            <span className="pos-ticket-time">{activeMinutes == null ? "—" : formatTableDuration(activeMinutes)}</span>
            {readyItemsCount > 0 && <span className="pos-ticket-ready">{readyItemsCount} listos</span>}
          </div>
        )}
        {ordenMesa && nextServiceAction && (
          <p className="pos-ticket-hint">{nextServiceAction}</p>
        )}
      </div>

      {ordenMesa && seatNames.length > 1 && (
        <div className="pos-ticket-seat-select">
          <label>
            <small>Asignar próximo platillo a</small>
            <select value={selectedAssignment} onChange={(event) => onAssignmentChange(event.target.value)}>
              <option value="Mesa completa">Mesa completa</option>
              {seatNames.map((name, index) => (
                <option key={`ticket-seat-${index}`} value={name || `Persona ${index + 1}`}>{name || `Persona ${index + 1}`}</option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="pos-ticket-lines">
        {!ordenMesa && <div className="pos-friendly-empty">Selecciona una mesa o usa Delivery / Para llevar arriba a la derecha.</div>}
        {ordenMesa && orden.filter((item) => item.status !== "cancelled").length === 0 && (
          <div className="pos-friendly-empty">Sin platillos. Elige categoría arriba para agregar productos.</div>
        )}
        {orden.filter((item) => item.status !== "cancelled").map((item) => (
          <div className={`pos-ticket-line status-${item.status || "draft"}`} key={item.lineId}>
            <div className="pos-ticket-line-main">
              <strong>{item.cantidad} × {getOrderItemDisplayName(item)}</strong>
              <span>Q{(item.precio * item.cantidad).toFixed(2)}</span>
            </div>
            <span className="pos-ticket-line-badge" style={getOrderItemStatusStyle(item.status)}>
              {getOrderItemStatusLabel(item.status)}
            </span>
          </div>
        ))}
      </div>

      {ordenError && <div className="pos-ticket-alert error">{ordenError}</div>}
      {ordenMessage && <div className="pos-ticket-alert success">{ordenMessage}</div>}

      <div className="pos-ticket-actions-sticky">
        <div className="pos-ticket-actions-primary">
          <button
            type="button"
            className="pos-action-btn send pos-action-kitchen"
            onClick={onSendKitchen}
            disabled={!draftCount || sendingOrder || mesaBloqueadaPorCobro}
            title="Envía los productos nuevos a cocina / KDS"
          >
            <span className="pos-action-label">{sendingOrder ? "Enviando a cocina..." : "Enviar a cocina"}</span>
            {draftCount > 0 && !sendingOrder && (
              <span className="pos-action-meta">{draftCount} pendiente{draftCount === 1 ? "" : "s"}</span>
            )}
          </button>
          <button
            type="button"
            className="pos-action-btn pay pos-action-cobrar"
            onClick={onSendCashier}
            disabled={!canRequestCashier}
            title="Enviar cuenta a caja para cobro"
          >
            <span className="pos-action-label">Cobrar</span>
            <span className="pos-action-meta">Q{totalOrden.toFixed(2)}</span>
          </button>
        </div>

        <div className="pos-ticket-actions-utilities">
          <button type="button" className="pos-action-btn utility" onClick={onSplitBill} disabled={!sentItems.length}>Separar</button>
          <button type="button" className="pos-action-btn utility" onClick={onPrintPreBill} disabled={!orden.length}>Imprimir</button>
          {canRequestCashier && (
            <button type="button" className="pos-action-btn utility" onClick={onRequestBill}>Solicitar cobro</button>
          )}
          <button type="button" className="pos-action-btn utility" onClick={onRefresh} disabled={!ordenMesa}>Actualizar</button>
          <button type="button" className="pos-action-btn utility" onClick={onToggleActivity} disabled={!ordenMesa}>
            {showActivity ? "Ocultar bitácora" : "Bitácora"}
          </button>
        </div>

        <div className="pos-ticket-actions-danger">
          <button
            type="button"
            className="pos-action-btn danger"
            onClick={onClearDraft}
            disabled={!draftCount || sendingOrder}
            title="Elimina solo productos aún no enviados a cocina"
          >
            Anular pendientes
          </button>
          <button
            type="button"
            className="pos-action-btn exit"
            onClick={onExit}
            title="Cierra la vista de esta mesa sin cobrar (la comanda sigue en el sistema)"
          >
            Salir de mesa
          </button>
        </div>
      </div>
    </div>
  )
}

export function PosProductGrid({
  items,
  posCategories,
  productCategoryId,
  isTestProduct,
  getProductBasePrice,
  productProductionAreaId,
  productionAreas,
  mesaBloqueadaPorCobro,
  onAddProduct,
  productInitials,
  emptyMessage
}) {
  if (!items.length) {
    return <div className="pos-friendly-empty">{emptyMessage}</div>
  }
  return (
    <div className="pos-classic-product-grid">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          className={`pos-classic-product${item.estado !== "activo" ? " unavailable" : ""}`}
          disabled={item.estado !== "activo" || mesaBloqueadaPorCobro}
          onClick={() => onAddProduct(item)}
        >
          {item.imagen
            ? <img src={item.imagen} alt={item.nombre} />
            : <span className="pos-classic-product-initials">{productInitials(item.nombre)}</span>}
          <span className="pos-classic-product-name">{item.nombre}</span>
          {isTestProduct(item) && <span className="pos-test-badge">Prueba</span>}
          <strong className="pos-classic-product-price">
            {(item.productType || item.product_type) === "pizza"
              ? `Desde Q${getProductBasePrice(item).toFixed(2)}`
              : `Q${Number(item.precio || 0).toFixed(2)}`}
          </strong>
          <small>{productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || "Producción"}</small>
        </button>
      ))}
    </div>
  )
}
