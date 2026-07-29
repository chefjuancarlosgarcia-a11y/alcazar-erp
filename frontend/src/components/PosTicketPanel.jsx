export function PosTicketPanel({
  stationMode = false,
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
  cashierBlockedByDrafts,
  mesaBloqueadaPorCobro,
  getOrderItemDisplayName,
  getOrderItemInstructions,
  getOrderItemStatusLabel,
  getOrderItemStatusStyle,
  onChangeQuantity,
  editingNoteLineId,
  editingNoteText,
  onStartEditNote,
  onEditNoteTextChange,
  onSaveNote,
  onCancelEditNote,
  onMarkServed,
  onRefresh,
  onSendKitchen,
  onClearDraft,
  onRequestBill,
  onPrintPreBill,
  onSendCashier,
  onSplitBill,
  onExit,
  onReleaseTable,
  canReleaseTable = false,
  releaseTableHint = "",
  releasingTable = false,
  onToggleActivity,
  showActivity,
  readyItemsCount,
  nextServiceAction,
  waiterName,
  billingBusy = false
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
        {orden.filter((item) => item.status !== "cancelled").map((item) => {
          const isDraft = (item.status || "draft") === "draft"
          const isReady = item.status === "ready"
          const noteText = getOrderItemInstructions(item.modificaciones)
          const isEditingNote = editingNoteLineId === item.lineId

          return (
            <div className={`pos-ticket-line status-${item.status || "draft"}`} key={item.lineId}>
              <div className="pos-ticket-line-main">
                {isDraft ? (
                  <div className="pos-ticket-line-qty">
                    <button
                      type="button"
                      className="pos-ticket-qty-btn"
                      onClick={() => onChangeQuantity(item.lineId, -1)}
                      disabled={mesaBloqueadaPorCobro}
                      aria-label="Reducir cantidad"
                    >
                      −
                    </button>
                    <span className="pos-ticket-qty-value">{item.cantidad}</span>
                    <button
                      type="button"
                      className="pos-ticket-qty-btn"
                      onClick={() => onChangeQuantity(item.lineId, 1)}
                      disabled={mesaBloqueadaPorCobro}
                      aria-label="Aumentar cantidad"
                    >
                      +
                    </button>
                    <strong className="pos-ticket-line-name">{getOrderItemDisplayName(item)}</strong>
                  </div>
                ) : (
                  <strong>{item.cantidad} × {getOrderItemDisplayName(item)}</strong>
                )}
                <span>Q{(item.precio * item.cantidad).toFixed(2)}</span>
              </div>

              {noteText && !isEditingNote && (
                <span className="pos-ticket-line-note">{noteText}</span>
              )}

              {Array.isArray(item.modifiers) && item.modifiers.length > 0 && (
                <span className="pos-ticket-line-note">{item.modifiers.join(" · ")}</span>
              )}

              {isDraft && !isEditingNote && (
                <button
                  type="button"
                  className="pos-ticket-line-action"
                  onClick={() => onStartEditNote(item.lineId)}
                  disabled={mesaBloqueadaPorCobro}
                >
                  {noteText ? "Editar nota" : "Agregar nota"}
                </button>
              )}

              {isDraft && isEditingNote && (
                <div className="pos-ticket-line-note-editor">
                  <textarea
                    value={editingNoteText}
                    onChange={(event) => onEditNoteTextChange(event.target.value)}
                    rows={2}
                    placeholder="Notas para cocina..."
                  />
                  <div className="pos-ticket-line-note-editor-actions">
                    <button type="button" className="pos-ticket-line-action primary" onClick={() => onSaveNote(item.lineId)}>
                      Guardar
                    </button>
                    <button type="button" className="pos-ticket-line-action" onClick={onCancelEditNote}>
                      Cancelar
                    </button>
                  </div>
                </div>
              )}

              <div className="pos-ticket-line-footer">
                <span className="pos-ticket-line-badge" style={getOrderItemStatusStyle(item.status)}>
                  {getOrderItemStatusLabel(item.status)}
                </span>
                {isReady && (
                  <button
                    type="button"
                    className="pos-ticket-line-action served"
                    onClick={() => onMarkServed(item)}
                  >
                    Marcar servido
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {ordenError && <div className="pos-ticket-alert error">{ordenError}</div>}
      {ordenMessage && <div className="pos-ticket-alert success">{ordenMessage}</div>}

      {cashierBlockedByDrafts && (
        <div className="pos-ticket-pending-kitchen-cta">
          <p>Tienes productos pendientes de enviar a cocina.</p>
          <button
            type="button"
            className="pos-action-btn send"
            onClick={() => {
              console.log("[POS/KDS] send kitchen clicked (draft CTA)")
              onSendKitchen?.()
            }}
            disabled={sendingOrder || mesaBloqueadaPorCobro}
          >
            {sendingOrder ? "Enviando a cocina..." : "Enviar a cocina"}
          </button>
        </div>
      )}

      <div className="pos-ticket-actions-sticky">
        <div className="pos-ticket-actions-primary">
          <button
            type="button"
            className="pos-action-btn send pos-action-kitchen"
            onClick={() => {
              console.log("[POS/KDS] send kitchen clicked (primary)")
              onSendKitchen?.()
            }}
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
            disabled={!canRequestCashier || billingBusy}
            title="Envía la cuenta a Caja para procesar el pago."
          >
            <span className="pos-action-label">{billingBusy ? "Enviando..." : "Enviar a caja"}</span>
            <span className="pos-action-meta">Q{totalOrden.toFixed(2)}</span>
          </button>
        </div>

        <div className="pos-ticket-actions-utilities">
          {!stationMode && (
            <button type="button" className="pos-action-btn utility" onClick={onSplitBill} disabled={!sentItems.length}>Separar</button>
          )}
          <button type="button" className="pos-action-btn utility" onClick={onPrintPreBill} disabled={!orden.length || billingBusy}>
            {billingBusy ? "Imprimiendo..." : "Imprimir"}
          </button>
          {!stationMode && canRequestCashier && (
            <button type="button" className="pos-action-btn utility" onClick={onRequestBill} disabled={billingBusy}>
              {billingBusy ? "Procesando..." : "Solicitar cobro"}
            </button>
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
            className="pos-action-btn danger"
            onClick={onReleaseTable}
            disabled={!canReleaseTable || releasingTable || !ordenMesa || ordenMesa.isSalesChannel}
            title={releaseTableHint || "Libera el servicio de mesa de forma auditada"}
          >
            {releasingTable ? "Liberando..." : "Liberar mesa"}
          </button>
          <button
            type="button"
            className="pos-action-btn exit"
            onClick={onExit}
            title="Cierra la vista de esta mesa sin liberar el servicio (solo navegación)"
          >
            Salir de vista
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
            {(item.productType || item.product_type) === "pizza" || (item.productType || item.product_type) === "configurable"
              ? `Desde Q${getProductBasePrice(item).toFixed(2)}`
              : `Q${Number(item.precio || 0).toFixed(2)}`}
          </strong>
          <small>{productionAreas.find((area) => area.id === productProductionAreaId(item))?.name || "Producción"}</small>
        </button>
      ))}
    </div>
  )
}
