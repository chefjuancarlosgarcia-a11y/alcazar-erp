import PosServiceTerminal from "./PosServiceTerminal"
import { PosProductGrid, PosTicketPanel } from "./PosTicketPanel"

export default function PosClassicOperation({
  POS_DEBUG,
  puedeVerAuditoria,
  successInlineStyle,
  realtimeNotice,
  liveNoticeStyle,
  itemsLoading,
  invalidActiveProducts,
  warningBoxStyle,
  classicCategories,
  categoriaActiva,
  setCategoriaActiva,
  showProductCatalog,
  setShowProductCatalog,
  quickSearchRef,
  searchItems,
  getSearchRecipe,
  getSearchItemState,
  onQuickSearchAdd,
  salesChannel,
  SALES_CHANNELS,
  seleccionarCanalVenta,
  activeFloorAreas,
  areaActivaId,
  seleccionarAreaPlano,
  areaActiva,
  floorPlanStyle,
  areaActivaHeight,
  TableWithChairs,
  normalizeLayoutTable,
  minutosTranscurridos,
  ordenMesa,
  seleccionarMesaOperacion,
  itemsCategoria,
  posCategories,
  productCategoryId,
  isTestProduct,
  getProductBasePrice,
  productProductionAreaId,
  productionAreas,
  mesaBloqueadaPorCobro,
  agregarAOrden,
  productInitials,
  esCanalCliente,
  deliveryPanelStyle,
  mutedStyle,
  setShowDeliveryModal,
  primaryButtonStyle,
  mesaCargando,
  currentOrder,
  selectedAssignment,
  seatNames,
  personasOrden,
  actualizarCantidadPersonas,
  setSelectedAssignment,
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
  getOrderItemDisplayName,
  getOrderItemInstructions,
  handleChangeQuantity,
  editandoModificacionLineId,
  modificacionActualTexto,
  iniciarEdicionNota,
  setModificacionActualTexto,
  guardarModificacionActual,
  cancelarEdicionNota,
  handleMarkServed,
  getOrderItemStatusLabel,
  getOrderItemStatusStyle,
  orderItemBadgeStyle,
  refreshSelectedTableLive,
  handleSendOrderToProduction,
  handleClearDraftItems,
  solicitarCuenta,
  imprimirPrecuenta,
  enviarCuentaACaja,
  dividirCuentaIgual,
  salirOrdenActual,
  collapsedOrderSections,
  setCollapsedOrderSections,
  readyItemsCount,
  nextServiceAction,
  user,
  posSession,
  serviceEvents,
  historyPanelStyle,
  eventRowStyle,
  productionErrors,
  productionErrorPanelStyle,
  productionErrorItemStyle,
  posSessionName,
  etiquetaRolPos,
  posRealtimeActive,
  posFooterTime,
  openDiagnostic,
  limpiarOrdenesLocalesAntiguas,
  orderEvents
}) {
  return (
    <>
      <PosServiceTerminal
        notices={(
          <>
            {POS_DEBUG && puedeVerAuditoria && <div style={successInlineStyle}>Catálogo oficial conectado y consumo por receta activo.</div>}
            {realtimeNotice && <div style={liveNoticeStyle}>{realtimeNotice}</div>}
            {itemsLoading && <div className="pos-classic-notice">Cargando productos POS desde Supabase...</div>}
            {invalidActiveProducts.length > 0 && (
              <div style={warningBoxStyle}>{invalidActiveProducts.length} producto(s) activo(s) no se mostrarán para venta porque no están listos para producción.</div>
            )}
          </>
        )}
        categories={classicCategories}
        activeCategoryId={categoriaActiva}
        onSelectCategory={(categoryId) => { setCategoriaActiva(categoryId); setShowProductCatalog(true) }}
        quickSearchRef={quickSearchRef}
        searchItems={searchItems}
        getSearchRecipe={getSearchRecipe}
        getSearchItemState={getSearchItemState}
        getProductBasePrice={getProductBasePrice}
        productCategoryId={productCategoryId}
        posCategories={posCategories}
        onQuickSearchAdd={onQuickSearchAdd}
        salesChannel={salesChannel}
        salesChannelLabel={(SALES_CHANNELS.find((c) => c.id === salesChannel) || SALES_CHANNELS[0]).label}
        salesChannels={SALES_CHANNELS}
        onSelectSalesChannel={seleccionarCanalVenta}
        floorAreas={activeFloorAreas}
        activeAreaId={areaActivaId}
        onSelectArea={seleccionarAreaPlano}
        showProductCatalog={showProductCatalog}
        activeCategoryName={posCategories.find((c) => c.id === categoriaActiva)?.name || "Menú"}
        ordenMesa={ordenMesa}
        workspaceContent={(
          <>
            {salesChannel === "dine_in" && !showProductCatalog ? (
              areaActiva ? (
                <>
                  <div className="pos-floor-canvas pos-classic-floor" style={{ ...floorPlanStyle, minHeight: `${Math.max(420, areaActivaHeight || 520)}px` }}>
                    {areaActiva.mesas.map((mesa, index) => (
                      <TableWithChairs
                        key={mesa.id}
                        table={{
                          ...normalizeLayoutTable(mesa, areaActiva.id, index),
                          activeMinutes: mesa.orderCreatedAt ? minutosTranscurridos(mesa.orderCreatedAt) : null
                        }}
                        selected={ordenMesa?.mesaId === mesa.id}
                        onClick={() => seleccionarMesaOperacion(mesa)}
                        showSelectLabel
                      />
                    ))}
                  </div>
                  <div className="pos-floor-legend" aria-hidden="true">
                    <span><i className="legend-free" /> Disponible</span>
                    <span><i className="legend-active" /> En servicio</span>
                    <span><i className="legend-payment" /> Cuenta / cobro</span>
                    <span><i className="legend-late" /> Tiempo extendido</span>
                  </div>
                </>
              ) : (
                <div className="pos-friendly-empty">Agrega una zona física en Plano del restaurante para ver las mesas aquí.</div>
              )
            ) : !ordenMesa && salesChannel === "dine_in" ? (
              <div className="pos-friendly-empty">
                <strong>Selecciona una mesa en el plano</strong>
                <p>Elige un área arriba, toca una mesa y luego usa las categorías del menú para agregar platillos.</p>
                <button type="button" className="pos-back-to-floor" onClick={() => setShowProductCatalog(false)}>Ver plano de mesas</button>
              </div>
            ) : (
              <>
                {salesChannel === "dine_in" && (
                  <div className="pos-catalog-toolbar">
                    <div className="pos-catalog-toolbar-copy">
                      <span className="pos-workspace-badge menu is-active">Menú</span>
                      <strong>{posCategories.find((c) => c.id === categoriaActiva)?.name || "Productos"}</strong>
                      {ordenMesa && !ordenMesa.isSalesChannel && (
                        <span className="pos-catalog-mesa-ref">
                          · {ordenMesa.areaNombre} · Mesa {ordenMesa.mesaNumero}
                        </span>
                      )}
                    </div>
                    <button type="button" className="pos-back-to-floor" onClick={() => setShowProductCatalog(false)}>
                      ← Volver al plano
                    </button>
                  </div>
                )}
                <PosProductGrid
                  items={itemsCategoria}
                  posCategories={posCategories}
                  productCategoryId={productCategoryId}
                  isTestProduct={isTestProduct}
                  getProductBasePrice={getProductBasePrice}
                  productProductionAreaId={productProductionAreaId}
                  productionAreas={productionAreas}
                  mesaBloqueadaPorCobro={mesaBloqueadaPorCobro}
                  onAddProduct={agregarAOrden}
                  productInitials={productInitials}
                  emptyMessage="No hay productos listos que coincidan con esta categoría o búsqueda."
                />
              </>
            )}
            {esCanalCliente && salesChannel === "delivery" && (
              <div className="pos-classic-delivery-panel" style={deliveryPanelStyle}>
                <strong>Datos de delivery</strong>
                <p style={mutedStyle}>Completa contacto y dirección antes de enviar a cocina o caja.</p>
                <button type="button" onClick={() => setShowDeliveryModal(true)} style={primaryButtonStyle}>Configurar delivery</button>
              </div>
            )}
          </>
        )}
        ticketContent={(
          <>
            <PosTicketPanel
              mesaCargando={mesaCargando}
              ordenMesa={ordenMesa}
              salesChannel={salesChannel}
              salesChannelLabel={(SALES_CHANNELS.find((c) => c.id === salesChannel) || SALES_CHANNELS[0]).label}
              currentOrder={currentOrder}
              selectedAssignment={selectedAssignment}
              seatNames={seatNames}
              personasOrden={personasOrden}
              onPersonasChange={actualizarCantidadPersonas}
              onAssignmentChange={setSelectedAssignment}
              totalOrden={totalOrden}
              activeMinutes={activeMinutes}
              formatTableDuration={formatTableDuration}
              estadoMesaPorOrden={estadoMesaPorOrden}
              etiquetaEstadoMesa={etiquetaEstadoMesa}
              tableStatusStyles={tableStatusStyles}
              orden={orden}
              draftItems={draftItems}
              sentItems={sentItems}
              ordenError={ordenError}
              ordenMessage={ordenMessage}
              sendingOrder={sendingOrder}
              canRequestCashier={canRequestCashier}
              cashierBlockedByDrafts={cashierBlockedByDrafts}
              mesaBloqueadaPorCobro={mesaBloqueadaPorCobro}
              getOrderItemDisplayName={getOrderItemDisplayName}
              getOrderItemInstructions={getOrderItemInstructions}
              getOrderItemStatusLabel={getOrderItemStatusLabel}
              getOrderItemStatusStyle={getOrderItemStatusStyle}
              onChangeQuantity={handleChangeQuantity}
              editingNoteLineId={editandoModificacionLineId}
              editingNoteText={modificacionActualTexto}
              onStartEditNote={iniciarEdicionNota}
              onEditNoteTextChange={setModificacionActualTexto}
              onSaveNote={guardarModificacionActual}
              onCancelEditNote={cancelarEdicionNota}
              onMarkServed={handleMarkServed}
              onRefresh={refreshSelectedTableLive}
              onSendKitchen={handleSendOrderToProduction}
              onClearDraft={handleClearDraftItems}
              onRequestBill={() => solicitarCuenta(currentOrder)}
              onPrintPreBill={() => imprimirPrecuenta(currentOrder)}
              onSendCashier={() => enviarCuentaACaja(currentOrder)}
              onSplitBill={dividirCuentaIgual}
              onExit={salirOrdenActual}
              onToggleActivity={() => setCollapsedOrderSections((current) => ({ ...current, activity: !current.activity }))}
              showActivity={!collapsedOrderSections.activity}
              readyItemsCount={readyItemsCount}
              nextServiceAction={nextServiceAction}
              waiterName={currentOrder?.waiter_name || currentOrder?.usuarioNombre || user?.name || posSessionName}
            />
            {ordenMesa && !collapsedOrderSections.activity && (
              <div className="pos-service-activity pos-ticket-activity" style={historyPanelStyle}>
                <strong>Bitácora de servicio</strong>
                {!currentOrder || serviceEvents.length === 0 ? (
                  <p style={mutedStyle}>Todavía no hay movimientos de servicio.</p>
                ) : serviceEvents.map((event) => (
                  <div key={event.id} style={eventRowStyle}>
                    <span>{event.description}</span>
                    <small style={mutedStyle}>{new Date(event.created_at).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            )}
            {productionErrors.length > 0 && (
              <div style={productionErrorPanelStyle}>
                <strong>Productos pendientes de producción</strong>
                {productionErrors.map((error, index) => (
                  <div key={`${error.product}-${index}`} style={productionErrorItemStyle}>
                    <p style={{ margin: 0 }}><strong>{error.product}:</strong> {error.message}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        footerContent={(
          <>
            <div className="pos-classic-footer-user">
              <strong>{posSessionName || user?.name || user?.email || "Operador"}</strong>
              <span>{etiquetaRolPos(user?.role)}</span>
            </div>
            <div className="pos-classic-footer-status">
              <span className={posRealtimeActive ? "live" : "offline"}>{posRealtimeActive ? "En vivo" : "Conectando..."}</span>
              {ordenMesa && <span>{ordenMesa.areaNombre} · {ordenMesa.isSalesChannel ? ordenMesa.mesaNumero : `Mesa ${ordenMesa.mesaNumero}`}</span>}
            </div>
            <div className="pos-classic-footer-time">{posFooterTime}</div>
            <div className="pos-classic-footer-actions">
              {POS_DEBUG && user?.role === "admin" && <button type="button" onClick={openDiagnostic}>Diagnóstico</button>}
              {user?.role === "admin" && <button type="button" onClick={limpiarOrdenesLocalesAntiguas}>Limpiar local</button>}
              {puedeVerAuditoria && (
                <button type="button" onClick={() => setCollapsedOrderSections((current) => ({ ...current, audit: !current.audit }))}>
                  {collapsedOrderSections.audit ? "Auditoría" : "Ocultar auditoría"}
                </button>
              )}
            </div>
          </>
        )}
      />
      {puedeVerAuditoria && !collapsedOrderSections.audit && ordenMesa && (
        <div className="pos-classic-audit-drawer" style={historyPanelStyle}>
          {orderEvents.map((event) => (
            <div key={event.id} style={eventRowStyle}>
              <strong>{event.event_type}</strong>
              <span>{event.description}</span>
              <small style={mutedStyle}>{new Date(event.created_at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
