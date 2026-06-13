import { useMemo, useState } from "react"
import {
  computePurchaseOrderMetrics,
  filterHistoryOrders,
  filterManualIngredientSuggestions,
  formatCurrency,
  getProductInitials,
  getPurchaseOrderStatusBadgeClass,
  getPurchaseOrderStatusLabel,
  getPurchaseProductDetails
} from "./purchaseOrdersHelpers"
import "./PurchaseOrders.css"

const HISTORY_STATUS_OPTIONS = [
  { value: "all", label: "Todos los estados" },
  { value: "pendiente_aprobacion", label: "Pendiente de aprobación" },
  { value: "aprobada", label: "Aprobada" },
  { value: "enviada_proveedor", label: "Enviada a proveedor" },
  { value: "recibida_completa", label: "Recibida completa" },
  { value: "recibida_parcial", label: "Recibida parcial" },
  { value: "cancelada", label: "Cancelada" },
  { value: "rechazada", label: "Rechazada" }
]

function StatusBadge({ status }) {
  return (
    <span className={getPurchaseOrderStatusBadgeClass(status)}>
      {getPurchaseOrderStatusLabel(status)}
    </span>
  )
}

function OrderHistoryActions({
  orden,
  puedeCrearOrdenCompra,
  puedeAprobarOrdenCompra,
  onSelect,
  onApprove,
  onReject,
  onSend,
  onCancel
}) {
  return (
    <div className="po-order-card__actions">
      {orden.status !== "cancelada" && (
        <button type="button" className="erp-btn erp-btn--secondary" onClick={() => onSelect(orden.id)}>
          Ver / recibir
        </button>
      )}
      {puedeAprobarOrdenCompra && ["pendiente", "pendiente_aprobacion", "borrador"].includes(orden.status) && (
        <>
          <button type="button" className="erp-btn erp-btn--success" onClick={() => onApprove(orden.id)}>
            Aprobar
          </button>
          <button type="button" className="erp-btn erp-btn--danger" onClick={() => onReject(orden.id)}>
            Rechazar
          </button>
        </>
      )}
      {puedeCrearOrdenCompra && orden.status === "aprobada" && (
        <button type="button" className="erp-btn erp-btn--teal" onClick={() => onSend(orden.id)}>
          Enviar a proveedor
        </button>
      )}
      {!["cancelada", "rechazada", "recibida", "recibida_completa"].includes(orden.status) && (
        <button type="button" className="erp-btn erp-btn--danger" onClick={() => onCancel(orden.id)}>
          Cancelar orden
        </button>
      )}
    </div>
  )
}

export default function PurchaseOrdersModule({
  purchaseOrderView,
  setPurchaseOrderView,
  puedeCrearOrdenCompra,
  puedeAprobarOrdenCompra,
  puedeRecibirOrdenCompra,
  requiereAprobacionOrdenCompra,
  ordenCompra,
  totalOrdenCompra,
  ordenesCompraManual,
  ordenManualSeleccionada,
  proximoNumeroOrden,
  manualBusqueda,
  setManualBusqueda,
  manualIngredienteSeleccionadoId,
  setManualIngredienteSeleccionadoId,
  manualCantidadComprar,
  setManualCantidadComprar,
  manualOrdenItems,
  setManualOrdenItems,
  manualInventoryLoading,
  manualInventoryError,
  manualInventorySource,
  manualIssueDate,
  setManualIssueDate,
  manualExpectedDate,
  setManualExpectedDate,
  manualStatus,
  setManualStatus,
  manualProveedorNombre,
  setManualProveedorNombre,
  manualProveedorContacto,
  setManualProveedorContacto,
  manualProveedorCorreo,
  setManualProveedorCorreo,
  manualProveedorWhatsApp,
  setManualProveedorWhatsApp,
  manualProveedorEncargado,
  setManualProveedorEncargado,
  manualMetodoCompra,
  setManualMetodoCompra,
  manualRequester,
  setManualRequester,
  manualApprover,
  setManualApprover,
  manualPriority,
  setManualPriority,
  manualLocation,
  manualRecepcionCantidad,
  setManualRecepcionCantidad,
  manualRecepcionEstado,
  setManualRecepcionEstado,
  manualRecepcionNombre,
  setManualRecepcionNombre,
  manualRecepcionImagen,
  generarOrdenCompra,
  limpiarOrdenCompra,
  descargarOrdenPDF,
  seleccionarIngredienteOrdenManual,
  agregarIngredienteOrdenManual,
  limpiarFormularioOrdenManual,
  crearOrdenCompraManual,
  seleccionarOrdenManual,
  cancelarOrdenManual,
  aprobarOrdenManual,
  rechazarOrdenManual,
  enviarOrdenProveedor,
  recibirOrdenManual,
  cargarImagenRecepcion
}) {
  const [historySearch, setHistorySearch] = useState("")
  const [historyStatus, setHistoryStatus] = useState("all")

  const metrics = useMemo(
    () => computePurchaseOrderMetrics(ordenesCompraManual, ordenCompra, totalOrdenCompra),
    [ordenesCompraManual, ordenCompra, totalOrdenCompra]
  )

  const manualSearchText = String(manualBusqueda || "").trim()
  const manualIngredienteSeleccionado = manualInventorySource.find(
    (ingrediente) => ingrediente.id === manualIngredienteSeleccionadoId
  )
  const manualProductoCompra = manualIngredienteSeleccionado
    ? getPurchaseProductDetails(manualIngredienteSeleccionado)
    : null
  const manualCantidadCompraNumero = Number(manualCantidadComprar || 0)
  const manualSubtotal = manualProductoCompra
    ? manualCantidadCompraNumero * manualProductoCompra.precioCompra
    : 0
  const manualCantidadBaseTotal = manualProductoCompra
    ? manualCantidadCompraNumero * manualProductoCompra.factorConversion
    : 0

  const manualIngredientesSugeridos = useMemo(
    () => filterManualIngredientSuggestions(manualInventorySource, manualSearchText),
    [manualInventorySource, manualSearchText]
  )

  const filteredHistory = useMemo(
    () => filterHistoryOrders(ordenesCompraManual, { search: historySearch, status: historyStatus }),
    [ordenesCompraManual, historySearch, historyStatus]
  )

  const openReception = (id) => {
    seleccionarOrdenManual(id)
    setPurchaseOrderView("reception")
  }

  const renderAutomaticView = () => (
    <div className="po-panel">
      <div className="po-header">
        <h3>Orden de compra automática</h3>
        <p className="po-help">
          El sistema revisa ingredientes en punto de orden y calcula cuánto comprar para llegar al punto máximo.
        </p>
      </div>

      <div className="po-toolbar">
        <button type="button" className="erp-btn erp-btn--success" onClick={generarOrdenCompra}>
          Actualizar propuesta
        </button>
        <button type="button" className="erp-btn erp-btn--pdf" onClick={descargarOrdenPDF}>
          Descargar PDF
        </button>
        <button type="button" className="erp-btn erp-btn--secondary" onClick={limpiarOrdenCompra}>
          Cancelar propuesta
        </button>
      </div>

      {ordenCompra.length === 0 ? (
        <p className="po-empty">Genera una propuesta para ver productos sugeridos.</p>
      ) : (
        <>
          <div className="po-cards-grid po-cards-grid--auto">
            {ordenCompra.map((item) => (
              <article key={item.id} className="po-order-card">
                <h4 className="po-order-card__title">{item.nombre}</h4>
                <p>Código: {item.codigo}</p>
                <p>Stock actual: {item.stockActual}</p>
                <p>Punto máximo: {item.puntoMaximo}</p>
                <p>
                  Comprar: <strong>{item.cantidadAComprar} {item.unidadCompra}</strong>
                </p>
                <p>Costo estimado: {formatCurrency(item.costoEstimado)}</p>
              </article>
            ))}
          </div>
          <p className="po-total">Total estimado: {formatCurrency(totalOrdenCompra)}</p>
        </>
      )}
    </div>
  )

  const renderManualView = () => {
    if (!puedeCrearOrdenCompra) {
      return (
        <div className="po-panel">
          <p className="po-empty">No tienes permiso para crear órdenes manuales.</p>
        </div>
      )
    }

    return (
      <div className="po-panel">
        <div className="po-header">
          <h3>Orden de compra manual</h3>
          <p className="po-help">Completa los datos de la orden y selecciona ingredientes con el buscador.</p>
          <p><strong>Número de orden:</strong> {proximoNumeroOrden}</p>
        </div>

        <div className="po-field">
          <label htmlFor="po-manual-search">Buscar ingrediente</label>
          <input
            id="po-manual-search"
            type="text"
            className="po-input"
            placeholder={manualProductoCompra ? "Buscar otro ingrediente..." : "Escribe nombre o código..."}
            value={manualBusqueda}
            onChange={(e) => {
              setManualBusqueda(e.target.value)
              setManualIngredienteSeleccionadoId(null)
              setManualCantidadComprar("")
            }}
          />
        </div>

        {manualBusqueda && (
          <div className="po-suggestions">
            {manualSearchText.length < 2 ? (
              <p className="po-empty">Escribe al menos 2 caracteres para buscar en inventario.</p>
            ) : manualInventoryLoading ? (
              <p className="po-empty">Cargando inventario...</p>
            ) : manualInventoryError ? (
              <p className="po-empty" style={{ color: "#fca5a5" }}>{manualInventoryError}</p>
            ) : manualIngredientesSugeridos.length > 0 ? (
              manualIngredientesSugeridos.map((ingrediente) => (
                <button
                  key={ingrediente.id}
                  type="button"
                  className="po-suggestion-btn"
                  onClick={() => seleccionarIngredienteOrdenManual(ingrediente)}
                >
                  {ingrediente.imagen || ingrediente.image_url ? (
                    <img
                      src={ingrediente.imagen || ingrediente.image_url}
                      alt={ingrediente.nombre || ingrediente.name}
                      className="po-suggestion-thumb"
                    />
                  ) : (
                    <span className="po-suggestion-placeholder">{getProductInitials(ingrediente)}</span>
                  )}
                  <span className="po-suggestion-body">
                    <span className="po-suggestion-title">
                      <span>{ingrediente.nombre || ingrediente.name}</span>
                      <span className="po-badge po-badge--muted">
                        {ingrediente.codigo || ingrediente.sku || ingrediente.codigoBarras || "Sin SKU"}
                      </span>
                    </span>
                    <span className="po-suggestion-meta">
                      <span>{ingrediente.unidadCompra || ingrediente.purchase_unit || ingrediente.unidadBase || ingrediente.base_unit || "Sin unidad"}</span>
                      <span>Stock: {Number(ingrediente.totalUnidades ?? ingrediente.stockActual ?? 0).toLocaleString("es-GT")}</span>
                      <span>{ingrediente.proveedorNombre || ingrediente.supplier || "Sin proveedor"}</span>
                    </span>
                    <span className="po-suggestion-meta">{ingrediente.categoria || ingrediente.category || "Sin categoria"}</span>
                  </span>
                </button>
              ))
            ) : (
              <p className="po-empty">No se encontró ningún ingrediente en inventario.</p>
            )}
          </div>
        )}

        {manualProductoCompra && manualIngredienteSeleccionado && (
          <div className="po-selected-product">
            <div className="po-selected-product__header">
              <div>
                <p className="po-selected-product__label">Producto seleccionado</p>
                <h4 style={{ margin: 0 }}>{manualProductoCompra.nombre}</h4>
              </div>
              <button
                type="button"
                className="erp-btn erp-btn--secondary"
                onClick={() => {
                  setManualIngredienteSeleccionadoId(null)
                  setManualCantidadComprar("")
                  setManualBusqueda("")
                }}
              >
                Cambiar producto
              </button>
            </div>
            <div className="po-metrics-grid">
              <div className="po-metric"><span>Código / SKU</span><strong>{manualProductoCompra.sku || "Sin código"}</strong></div>
              <div className="po-metric"><span>Categoría</span><strong>{manualProductoCompra.categoria}</strong></div>
              <div className="po-metric"><span>Unidad de compra</span><strong>{manualProductoCompra.unidadCompra}</strong></div>
              <div className="po-metric"><span>Unidad base</span><strong>{manualProductoCompra.unidadBase}</strong></div>
              <div className="po-metric"><span>Factor conversión</span><strong>{manualProductoCompra.factorConversion}</strong></div>
              <div className="po-metric"><span>Precio de compra</span><strong>{formatCurrency(manualProductoCompra.precioCompra)}</strong></div>
              <div className="po-metric"><span>Proveedor sugerido</span><strong>{manualProductoCompra.proveedor || manualProveedorNombre || "Sin proveedor asignado"}</strong></div>
              <div className="po-metric"><span>Disponible</span><strong>{Number(manualIngredienteSeleccionado.totalUnidades || 0).toLocaleString("es-GT")} {manualProductoCompra.unidadCompra}</strong></div>
            </div>
            {(manualIngredienteSeleccionado.imagen || manualIngredienteSeleccionado.image_url) && (
              <img
                src={manualIngredienteSeleccionado.imagen || manualIngredienteSeleccionado.image_url}
                alt="Ingrediente"
                className="po-preview-image"
              />
            )}

            <div className="po-field">
              <label htmlFor="po-manual-qty">Cantidad a comprar</label>
              <div className="po-quantity-row">
                <input
                  id="po-manual-qty"
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="0"
                  className="po-input"
                  style={{ flex: "1 1 190px", margin: 0 }}
                  value={manualCantidadComprar}
                  onChange={(e) => setManualCantidadComprar(e.target.value)}
                />
                <span className="po-quantity-unit">{manualProductoCompra.unidadCompra}</span>
              </div>
            </div>

            <div className="po-summary-grid">
              <div className="po-summary-metric"><span>Subtotal</span><strong>{formatCurrency(manualSubtotal)}</strong></div>
              <div className="po-summary-metric">
                <span>Unidades base adquiridas</span>
                <strong>{manualCantidadBaseTotal.toLocaleString("es-GT")} {manualProductoCompra.unidadBase}</strong>
              </div>
            </div>

            <button type="button" className="erp-btn erp-btn--success" onClick={agregarIngredienteOrdenManual}>
              Agregar producto a la orden
            </button>
          </div>
        )}

        {manualOrdenItems.length > 0 && (
          <div className="po-cards-grid">
            <h3>Productos de la orden</h3>
            {manualOrdenItems.map((item) => (
              <article key={item.id} className="po-order-card">
                <h4 className="po-order-card__title">{item.nombre} ({item.sku || item.codigo || "Sin código"})</h4>
                <p>Cantidad: {item.cantidad_compra ?? item.cantidadComprar} {item.unidad_compra || item.unidadCompra}</p>
                <p>Subtotal: <strong>{formatCurrency(item.subtotal ?? Number(item.costoUnitario || 0) * Number(item.cantidadComprar || 0))}</strong></p>
                <p>Base adquirida: {Number(item.cantidad_base_total ?? item.cantidadComprar ?? 0).toLocaleString("es-GT")} {item.unidad_base || item.unidadCompra}</p>
                <div className="po-order-card__actions">
                  <button
                    type="button"
                    className="erp-btn erp-btn--danger"
                    onClick={() => setManualOrdenItems(manualOrdenItems.filter((ordenItem) => ordenItem.id !== item.id))}
                  >
                    Eliminar ingrediente
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        {(manualProductoCompra || manualOrdenItems.length > 0) && (
          <div className="po-supplier-section">
            <div>
              <h3 style={{ margin: "0 0 8px" }}>Proveedor</h3>
              <p className="po-help">Información cargada desde el ingrediente seleccionado. Puedes completarla o corregirla antes de crear la orden.</p>
            </div>
            <div className="po-form-grid po-form-grid--2">
              <input type="text" className="po-input" placeholder="Nombre del proveedor" value={manualProveedorNombre} onChange={(e) => setManualProveedorNombre(e.target.value)} />
              <input type="text" className="po-input" placeholder="Número de contacto" value={manualProveedorContacto} onChange={(e) => setManualProveedorContacto(e.target.value)} />
              <input type="email" className="po-input" placeholder="Correo electrónico" value={manualProveedorCorreo} onChange={(e) => setManualProveedorCorreo(e.target.value)} />
              <input type="text" className="po-input" placeholder="WhatsApp" value={manualProveedorWhatsApp} onChange={(e) => setManualProveedorWhatsApp(e.target.value)} />
              <input type="text" className="po-input" placeholder="Nombre del encargado" value={manualProveedorEncargado} onChange={(e) => setManualProveedorEncargado(e.target.value)} />
              <select aria-label="Método de compra" className="po-select" value={manualMetodoCompra} onChange={(e) => setManualMetodoCompra(e.target.value)}>
                <option value="banco">Método: Banco</option>
                <option value="transferencia">Método: Transferencia</option>
                <option value="tarjeta">Método: Tarjeta</option>
                <option value="efectivo">Método: Efectivo</option>
              </select>
            </div>
          </div>
        )}

        <h3>Datos de la orden</h3>
        <div className="po-form-grid po-form-grid--3">
          <div className="po-field">
            <label htmlFor="po-issue-date">Fecha de emisión</label>
            <input id="po-issue-date" type="date" className="po-input" value={manualIssueDate} onChange={(e) => setManualIssueDate(e.target.value)} />
          </div>
          <div className="po-field">
            <label htmlFor="po-expected-date">Fecha esperada de entrega</label>
            <input id="po-expected-date" type="date" className="po-input" value={manualExpectedDate} onChange={(e) => setManualExpectedDate(e.target.value)} />
          </div>
          <div className="po-field">
            <label htmlFor="po-status">Estado de la orden</label>
            <select id="po-status" className="po-select" value={manualStatus} onChange={(e) => setManualStatus(e.target.value)} disabled={requiereAprobacionOrdenCompra}>
              <option value="borrador">Borrador</option>
              <option value="pendiente_aprobacion">Pendiente de aprobación</option>
              <option value="aprobada">Aprobada</option>
            </select>
            {requiereAprobacionOrdenCompra && (
              <p className="po-help">Tu orden será enviada a aprobación de Admin o Gerente General.</p>
            )}
          </div>
        </div>

        <div className="po-form-grid po-form-grid--2">
          <div className="po-field">
            <label htmlFor="po-requester">Solicitante</label>
            <input id="po-requester" type="text" className="po-input" placeholder="Nombre de quien solicita" value={manualRequester} onChange={(e) => setManualRequester(e.target.value)} />
          </div>
          <div className="po-field">
            <label htmlFor="po-approver">Aprobado por</label>
            <input id="po-approver" type="text" className="po-input" placeholder="Nombre de quien aprueba" value={manualApprover} onChange={(e) => setManualApprover(e.target.value)} />
          </div>
        </div>

        <div className="po-form-grid po-form-grid--2">
          <div className="po-field">
            <label htmlFor="po-priority">Prioridad</label>
            <select id="po-priority" className="po-select" value={manualPriority} onChange={(e) => setManualPriority(e.target.value)}>
              <option value="normal">Normal</option>
              <option value="urgente">Urgente</option>
            </select>
          </div>
          <div className="po-field">
            <label htmlFor="po-location">Lugar de entrega</label>
            <input id="po-location" type="text" className="po-input po-input--readonly" value={manualLocation} readOnly />
          </div>
        </div>

        <div className="po-footer-actions">
          <button type="button" className="erp-btn erp-btn--success" onClick={crearOrdenCompraManual}>
            Crear orden
          </button>
          <button
            type="button"
            className="erp-btn erp-btn--secondary"
            onClick={() => {
              limpiarFormularioOrdenManual()
              setPurchaseOrderView("automatic")
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  const renderHistoryView = () => (
    <div className="po-panel">
      <div className="po-header">
        <h3>Historial de órdenes manuales</h3>
        <p className="po-help">Consulta, aprueba o envía órdenes registradas.</p>
      </div>

      <div className="po-filters">
        <div className="po-field">
          <label htmlFor="po-history-search">Buscar</label>
          <input
            id="po-history-search"
            type="search"
            className="po-input"
            placeholder="Número, proveedor, solicitante..."
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
        </div>
        <div className="po-field">
          <label htmlFor="po-history-status">Estado</label>
          <select id="po-history-status" className="po-select" value={historyStatus} onChange={(e) => setHistoryStatus(e.target.value)}>
            {HISTORY_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="po-toolbar">
        {puedeCrearOrdenCompra && (
          <button type="button" className="erp-btn erp-btn--teal" onClick={() => setPurchaseOrderView("manual")}>
            Nueva orden manual
          </button>
        )}
      </div>

      {filteredHistory.length === 0 ? (
        <p className="po-empty">No hay órdenes que coincidan con los filtros.</p>
      ) : (
        <>
          <div className="po-history-table-wrap">
            <table className="po-history-table">
              <thead>
                <tr>
                  <th>Orden</th>
                  <th>Proveedor</th>
                  <th>Estado</th>
                  <th>Emisión</th>
                  <th>Entrega</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredHistory.map((orden) => (
                  <tr key={orden.id}>
                    <td><strong>{orden.numeroOrden}</strong></td>
                    <td>{orden.proveedor?.nombre}</td>
                    <td><StatusBadge status={orden.status} /></td>
                    <td>{orden.fechaEmision}</td>
                    <td>{orden.fechaEsperadaEntrega}</td>
                    <td>
                      <OrderHistoryActions
                        orden={orden}
                        puedeCrearOrdenCompra={puedeCrearOrdenCompra}
                        puedeAprobarOrdenCompra={puedeAprobarOrdenCompra}
                        onSelect={openReception}
                        onApprove={aprobarOrdenManual}
                        onReject={rechazarOrdenManual}
                        onSend={enviarOrdenProveedor}
                        onCancel={cancelarOrdenManual}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="po-history-cards">
            {filteredHistory.map((orden) => (
              <article key={orden.id} className="po-order-card">
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <h4 className="po-order-card__title">{orden.numeroOrden}</h4>
                  <StatusBadge status={orden.status} />
                </div>
                <p><strong>Proveedor:</strong> {orden.proveedor?.nombre}</p>
                <p><strong>Fecha emisión:</strong> {orden.fechaEmision}</p>
                <p><strong>Fecha esperada:</strong> {orden.fechaEsperadaEntrega}</p>
                <OrderHistoryActions
                  orden={orden}
                  puedeCrearOrdenCompra={puedeCrearOrdenCompra}
                  puedeAprobarOrdenCompra={puedeAprobarOrdenCompra}
                  onSelect={openReception}
                  onApprove={aprobarOrdenManual}
                  onReject={rechazarOrdenManual}
                  onSend={enviarOrdenProveedor}
                  onCancel={cancelarOrdenManual}
                />
              </article>
            ))}
          </div>
        </>
      )}
    </div>
  )

  const renderReceptionView = () => (
    <div className="po-panel">
      <div className="po-header">
        <h3>Recepción de órdenes</h3>
        <p className="po-help">Selecciona una orden del historial o continúa con la orden abierta.</p>
      </div>

      {!ordenManualSeleccionada ? (
        <>
          <p className="po-empty">No hay orden seleccionada para recepción.</p>
          <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setPurchaseOrderView("history")}>
            Ir al historial
          </button>
        </>
      ) : (
        <div className="po-reception-panel">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
            <h4 style={{ margin: 0 }}>{ordenManualSeleccionada.numeroOrden}</h4>
            <StatusBadge status={ordenManualSeleccionada.status} />
          </div>
          <p><strong>Lugar:</strong> {ordenManualSeleccionada.lugar}</p>
          <p><strong>Solicitante:</strong> {ordenManualSeleccionada.requester}</p>
          <p><strong>Aprobador:</strong> {ordenManualSeleccionada.approver}</p>
          <p><strong>Prioridad:</strong> {ordenManualSeleccionada.prioridad}</p>
          <p><strong>Método:</strong> {ordenManualSeleccionada.metodoCompra}</p>
          <p><strong>Proveedor:</strong> {ordenManualSeleccionada.proveedor?.nombre}</p>

          <h4>Ingredientes pedidos</h4>
          <div className="po-cards-grid">
            {ordenManualSeleccionada.items.map((item) => (
              <article key={item.id} className="po-order-card">
                <h4 className="po-order-card__title">{item.nombre} ({item.sku || item.codigo || "Sin código"})</h4>
                <p>Cantidad pedida: {item.cantidad_compra ?? item.cantidadComprar} {item.unidad_compra || item.unidadCompra}</p>
                {item.subtotal != null && <p>Subtotal: {formatCurrency(item.subtotal)}</p>}
              </article>
            ))}
          </div>

          <div className="po-form-grid po-form-grid--2">
            <div className="po-field">
              <label htmlFor="po-reception-qty">Cantidad recibida real</label>
              <input
                id="po-reception-qty"
                type="number"
                className="po-input"
                placeholder="Cantidad recibida"
                value={manualRecepcionCantidad}
                onChange={(e) => setManualRecepcionCantidad(e.target.value)}
              />
            </div>
            <div className="po-field">
              <label htmlFor="po-reception-state">Estado del producto</label>
              <select id="po-reception-state" className="po-select" value={manualRecepcionEstado} onChange={(e) => setManualRecepcionEstado(e.target.value)}>
                <option value="bueno">Bueno</option>
                <option value="dañado">Dañado</option>
                <option value="vencido">Vencido</option>
                <option value="malo">Malo</option>
              </select>
            </div>
          </div>

          <div className="po-field">
            <label htmlFor="po-reception-name">Nombre de quien recibe</label>
            <input
              id="po-reception-name"
              type="text"
              className="po-input"
              placeholder="Nombre del receptor"
              value={manualRecepcionNombre}
              onChange={(e) => setManualRecepcionNombre(e.target.value)}
            />
          </div>

          <div className="po-field">
            <label htmlFor="po-reception-image">Imagen de recepción / factura</label>
            <input id="po-reception-image" type="file" accept="image/*" className="po-input" onChange={cargarImagenRecepcion} />
          </div>

          {manualRecepcionImagen && (
            <img src={manualRecepcionImagen} alt="Recepción" className="po-preview-image" />
          )}

          <div className="po-footer-actions">
            {puedeRecibirOrdenCompra && ["aprobada", "enviada_proveedor"].includes(ordenManualSeleccionada.status) && (
              <button type="button" className="erp-btn erp-btn--success" onClick={recibirOrdenManual}>
                Registrar recepción
              </button>
            )}
            <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setPurchaseOrderView("history")}>
              Volver al historial
            </button>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="po-module">
      <section className="po-nav-card">
        <div className="po-nav-card__top">
          <div className="po-header">
            <p className="po-header__eyebrow">Compras</p>
            <h2>Órdenes de compra</h2>
            <p>Genera propuestas por mínimos o registra compras directas a proveedor.</p>
          </div>
          <div className="po-header__actions">
            {puedeCrearOrdenCompra && (
              <>
                <button
                  type="button"
                  className="erp-btn erp-btn--success"
                  onClick={() => {
                    generarOrdenCompra()
                    setPurchaseOrderView("automatic")
                  }}
                >
                  Generar orden automática
                </button>
                <button type="button" className="erp-btn erp-btn--teal" onClick={() => setPurchaseOrderView("manual")}>
                  Crear orden manual
                </button>
              </>
            )}
          </div>
        </div>

        <div className="po-kpi-grid">
          <article className="po-kpi">
            <p className="po-kpi__label">Órdenes pendientes</p>
            <p className="po-kpi__value">{metrics.pendingCount}</p>
            <p className="po-kpi__note">Por aprobar o borrador</p>
          </article>
          <article className="po-kpi">
            <p className="po-kpi__label">Órdenes recibidas</p>
            <p className="po-kpi__value">{metrics.receivedCount}</p>
            <p className="po-kpi__note">Completas o parciales</p>
          </article>
          <article className="po-kpi">
            <p className="po-kpi__label">Proveedores</p>
            <p className="po-kpi__value">{metrics.supplierCount}</p>
            <p className="po-kpi__note">En historial manual</p>
          </article>
          <article className="po-kpi">
            <p className="po-kpi__label">Monto estimado</p>
            <p className="po-kpi__value">{formatCurrency(metrics.estimatedAmount)}</p>
            <p className="po-kpi__note">
              {metrics.automaticLineCount > 0
                ? `${metrics.automaticLineCount} líneas automáticas`
                : `${metrics.manualOrderCount} órdenes manuales`}
            </p>
          </article>
        </div>

        <nav className="po-tabs" aria-label="Vistas de órdenes de compra">
          <button
            type="button"
            className={`po-tab${purchaseOrderView === "automatic" ? " po-tab--active" : ""}`}
            onClick={() => setPurchaseOrderView("automatic")}
          >
            Automáticas
          </button>
          {puedeCrearOrdenCompra && (
            <button
              type="button"
              className={`po-tab${purchaseOrderView === "manual" ? " po-tab--active" : ""}`}
              onClick={() => setPurchaseOrderView("manual")}
            >
              Manuales
            </button>
          )}
          <button
            type="button"
            className={`po-tab${purchaseOrderView === "history" ? " po-tab--active" : ""}`}
            onClick={() => setPurchaseOrderView("history")}
          >
            Historial
          </button>
          <button
            type="button"
            className={`po-tab${purchaseOrderView === "reception" ? " po-tab--active" : ""}`}
            onClick={() => setPurchaseOrderView("reception")}
          >
            Recepción
          </button>
        </nav>
      </section>

      {purchaseOrderView === "automatic" && renderAutomaticView()}
      {purchaseOrderView === "manual" && renderManualView()}
      {purchaseOrderView === "history" && renderHistoryView()}
      {purchaseOrderView === "reception" && renderReceptionView()}
    </div>
  )
}
