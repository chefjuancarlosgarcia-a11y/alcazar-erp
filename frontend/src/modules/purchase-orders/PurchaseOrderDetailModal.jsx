import { TestFlowBadge, TestFlowWarning } from "../../components/TestFlowBadge"
import { isTestRecord } from "../../utils/testFlowMode"
import { PO_WORKFLOW_VIEWS } from "../../utils/inventoryNotificationRoutes"
import { formatCurrency, getPurchaseOrderStatusLabel, getPurchaseOrderStatusBadgeClass } from "./purchaseOrdersHelpers"
import PurchaseOrderReceptionLines from "./PurchaseOrderReceptionLines"
import ReceptionImageCapture from "./ReceptionImageCapture"
import "./PurchaseOrders.css"

function orderTotal(orden) {
  const items = Array.isArray(orden?.items) ? orden.items : []
  return items.reduce(
    (sum, item) => sum + Number(item.subtotal ?? Number(item.costoUnitario || 0) * Number(item.cantidadComprar || item.cantidad_compra || 0)),
    0
  )
}

function StatusBadge({ status }) {
  return (
    <span className={getPurchaseOrderStatusBadgeClass(status)}>
      {getPurchaseOrderStatusLabel(status)}
    </span>
  )
}

export default function PurchaseOrderDetailModal({
  order,
  workflowView,
  puedeCrearOrdenCompra,
  puedeAprobarOrdenCompra,
  puedeRecibirOrdenCompra,
  manualRecepcionLineas,
  onReceptionLineChange,
  manualRecepcionEstado,
  setManualRecepcionEstado,
  manualRecepcionNombre,
  setManualRecepcionNombre,
  manualRecepcionImagen,
  cargarImagenRecepcion,
  onClearReceptionImage,
  onClose,
  onApprove,
  onReject,
  onSend,
  onCancel,
  onReceive
}) {
  if (!order) return null

  const pending = ["pendiente", "pendiente_aprobacion", "borrador"].includes(order.status)
  const canSend = order.status === "aprobada"
  const canReceive = ["enviada_proveedor", "en tránsito"].includes(order.status)
  const showReceptionForm = workflowView === PO_WORKFLOW_VIEWS.RECEPTION && canReceive
  const proveedor = order.proveedor || {}

  return (
    <div className="po-detail-backdrop" onClick={onClose}>
      <section className="po-detail-modal" onClick={(event) => event.stopPropagation()} aria-label={`Detalle orden ${order.numeroOrden}`}>
        <header className="po-detail-modal__header">
          <div>
            <p className="po-header__eyebrow">Orden de compra</p>
            <div className="po-detail-modal__title-row">
              <h3>{order.numeroOrden}</h3>
              {isTestRecord(order) && <TestFlowBadge />}
              <StatusBadge status={order.status} />
            </div>
          </div>
          <button type="button" className="erp-btn erp-btn--secondary" onClick={onClose}>Cerrar</button>
        </header>

        {isTestRecord(order) && <TestFlowWarning className="po-test-warning" />}

        <div className="po-detail-grid">
          <article className="po-detail-card">
            <h4>Información general</h4>
            <dl>
              <div><dt>Estado</dt><dd>{getPurchaseOrderStatusLabel(order.status)}</dd></div>
              <div><dt>Emisión</dt><dd>{order.fechaEmision || "—"}</dd></div>
              <div><dt>Entrega esperada</dt><dd>{order.fechaEsperadaEntrega || "—"}</dd></div>
              <div><dt>Solicitante</dt><dd>{order.requester || "—"}</dd></div>
              <div><dt>Aprobador</dt><dd>{order.approver || order.aprobadoPor || "—"}</dd></div>
              <div><dt>Prioridad</dt><dd>{order.prioridad || "normal"}</dd></div>
              <div><dt>Método</dt><dd>{order.metodoCompra || "—"}</dd></div>
              <div><dt>Lugar</dt><dd>{order.lugar || "—"}</dd></div>
              {order.creado && <div><dt>Creada</dt><dd>{order.creado}</dd></div>}
            </dl>
          </article>

          <article className="po-detail-card">
            <h4>Proveedor</h4>
            <dl>
              <div><dt>Nombre</dt><dd>{proveedor.nombre || "—"}</dd></div>
              <div><dt>Contacto</dt><dd>{proveedor.contacto || "—"}</dd></div>
              <div><dt>Correo</dt><dd>{proveedor.correo || "—"}</dd></div>
              <div><dt>WhatsApp</dt><dd>{proveedor.whatsapp || "—"}</dd></div>
              <div><dt>Encargado</dt><dd>{proveedor.encargado || "—"}</dd></div>
            </dl>
          </article>
        </div>

        <article className="po-detail-card po-detail-card--wide">
          <div className="po-detail-card__head">
            <h4>Productos ({order.items?.length || 0})</h4>
            <strong>Total estimado: {formatCurrency(orderTotal(order))}</strong>
          </div>
          <div className="po-detail-items-table-wrap">
            <table className="po-detail-items-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Código</th>
                  <th>Cantidad</th>
                  <th>Unidad</th>
                  <th>Costo unit.</th>
                  <th>Subtotal</th>
                </tr>
              </thead>
              <tbody>
                {(order.items || []).map((item) => {
                  const qty = Number(item.cantidadComprar ?? item.cantidad_compra ?? 0)
                  const unitCost = Number(item.costoUnitario ?? item.precioCompra ?? 0)
                  const subtotal = Number(item.subtotal ?? qty * unitCost)
                  return (
                    <tr key={item.id || `${item.nombre}-${item.sku}`}>
                      <td>{item.nombre || item.name || "Producto"}</td>
                      <td>{item.sku || item.codigo || "—"}</td>
                      <td>{qty}</td>
                      <td>{item.unidadCompra || item.unidad_compra || "—"}</td>
                      <td>{formatCurrency(unitCost)}</td>
                      <td>{formatCurrency(subtotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </article>

        {order.recepcion && (
          <article className="po-detail-card po-detail-card--wide">
            <h4>Recepción registrada</h4>
            {Array.isArray(order.recepcion.items) && order.recepcion.items.length > 0 ? (
              <div className="po-reception-lines-wrap">
                <table className="po-reception-lines-table">
                  <thead>
                    <tr>
                      <th>Ingrediente</th>
                      <th>Pedido</th>
                      <th>Recibido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.recepcion.items.map((line) => (
                      <tr key={line.itemId || line.nombre}>
                        <td>{line.nombre || "Producto"}</td>
                        <td>{line.cantidadPedida ?? "—"} {line.unidad || ""}</td>
                        <td><strong>{line.cantidadRecibida ?? "—"}</strong> {line.unidad || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <dl>
                <div><dt>Cantidad recibida</dt><dd>{order.recepcion.cantidadRecibidaReal ?? "—"}</dd></div>
              </dl>
            )}
            <dl>
              <div><dt>Estado producto</dt><dd>{order.recepcion.estadoProducto || "—"}</dd></div>
              <div><dt>Recibido por</dt><dd>{order.recepcion.recibidoPor || "—"}</dd></div>
              <div><dt>Fecha</dt><dd>{order.recepcion.fechaRecepcion || "—"}</dd></div>
            </dl>
            {order.recepcion.imagenRecepcion && (
              <img src={order.recepcion.imagenRecepcion} alt="Recepción" className="po-preview-image" />
            )}
          </article>
        )}

        {showReceptionForm && (
          <article className="po-detail-card po-detail-card--wide po-reception-panel">
            <h4>Registrar recepción</h4>
            <p className="po-help">Marca cada producto que entró e ingresa la cantidad recibida.</p>
            <PurchaseOrderReceptionLines
              items={order.items || []}
              lines={manualRecepcionLineas}
              onLineChange={onReceptionLineChange}
            />
            <div className="po-form-grid po-form-grid--2">
              <div className="po-field">
                <label htmlFor="po-detail-reception-state">Estado general del producto</label>
                <select
                  id="po-detail-reception-state"
                  className="po-select"
                  value={manualRecepcionEstado}
                  onChange={(event) => setManualRecepcionEstado(event.target.value)}
                >
                  <option value="bueno">Bueno</option>
                  <option value="dañado">Dañado</option>
                  <option value="vencido">Vencido</option>
                  <option value="malo">Malo</option>
                </select>
              </div>
            </div>
            <div className="po-field">
              <label htmlFor="po-detail-reception-name">Nombre de quien recibe</label>
              <input
                id="po-detail-reception-name"
                type="text"
                className="po-input"
                value={manualRecepcionNombre}
                onChange={(event) => setManualRecepcionNombre(event.target.value)}
              />
            </div>
            <div className="po-field">
              <label>Imagen de recepción / factura</label>
              <ReceptionImageCapture
                image={manualRecepcionImagen}
                onSelect={cargarImagenRecepcion}
                onClear={onClearReceptionImage}
              />
            </div>
          </article>
        )}

        <footer className="po-detail-modal__actions">
          {workflowView === PO_WORKFLOW_VIEWS.PENDING_APPROVAL && puedeAprobarOrdenCompra && pending && (
            <>
              <button type="button" className="erp-btn erp-btn--success" onClick={() => onApprove(order.id)}>Aprobar</button>
              <button type="button" className="erp-btn erp-btn--danger" onClick={() => onReject(order.id)}>Rechazar</button>
            </>
          )}
          {workflowView === PO_WORKFLOW_VIEWS.TO_SEND && puedeCrearOrdenCompra && canSend && (
            <button type="button" className="erp-btn erp-btn--teal" onClick={() => onSend(order.id)}>Enviar a proveedor</button>
          )}
          {showReceptionForm && puedeRecibirOrdenCompra && (
            <button type="button" className="erp-btn erp-btn--success" onClick={onReceive}>Registrar recepción</button>
          )}
          {!["cancelada", "rechazada", "recibida", "recibida_completa"].includes(order.status) && (
            <button type="button" className="erp-btn erp-btn--danger" onClick={() => onCancel(order.id)}>Cancelar orden</button>
          )}
        </footer>
      </section>
    </div>
  )
}
