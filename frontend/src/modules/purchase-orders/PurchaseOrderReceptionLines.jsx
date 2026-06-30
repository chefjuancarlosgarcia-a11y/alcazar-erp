import {
  getPurchaseOrderItemKey,
  getPurchaseOrderItemOrderedQty,
  getPurchaseOrderItemUnit
} from "./purchaseOrdersHelpers"
import "./PurchaseOrders.css"

export default function PurchaseOrderReceptionLines({ items = [], lines = {}, onLineChange }) {
  if (!items.length) {
    return <p className="po-empty">Esta orden no tiene productos para recibir.</p>
  }

  function updateLine(key, patch) {
    onLineChange(key, { ...(lines[key] || { entered: false, cantidadRecibida: "" }), ...patch })
  }

  return (
    <div className="po-reception-lines-wrap">
      <table className="po-reception-lines-table">
            <thead>
              <tr>
                <th>Ingrediente</th>
                <th>Pedido</th>
                <th>Entró</th>
                <th>Cant. recibida</th>
                <th>Precio unit.</th>
              </tr>
            </thead>
        <tbody>
          {items.map((item) => {
            const key = getPurchaseOrderItemKey(item)
            const line = lines[key] || { entered: false, cantidadRecibida: "", unitCostPurchase: "" }
            const orderedQty = getPurchaseOrderItemOrderedQty(item)
            const unit = getPurchaseOrderItemUnit(item)
            const defaultCost = Number(item.costoUnitario ?? item.precio_unitario_compra ?? 0)
            const inputId = `po-reception-qty-${key}`
            const costInputId = `po-reception-cost-${key}`

            return (
              <tr key={key} className={line.entered ? "po-reception-line--entered" : ""}>
                <td>
                  <strong>{item.nombre || item.name || "Producto"}</strong>
                  {(item.sku || item.codigo) && (
                    <span className="po-reception-line__sku">{item.sku || item.codigo}</span>
                  )}
                </td>
                <td>
                  <span className="po-reception-line__ordered">
                    {orderedQty} {unit}
                  </span>
                </td>
                <td className="po-reception-line__check">
                  <label className="po-reception-check">
                    <input
                      type="checkbox"
                      checked={Boolean(line.entered)}
                      onChange={(event) => {
                        const entered = event.target.checked
                        updateLine(key, {
                          entered,
                          cantidadRecibida: entered
                            ? String(line.cantidadRecibida || orderedQty || "")
                            : line.cantidadRecibida,
                          unitCostPurchase: entered
                            ? String(line.unitCostPurchase || defaultCost || "")
                            : line.unitCostPurchase
                        })
                      }}
                    />
                    <span>Sí</span>
                  </label>
                </td>
                <td>
                  <div className="po-reception-qty-cell">
                    <input
                      id={inputId}
                      type="number"
                      min="0"
                      step="any"
                      className="po-input po-reception-qty-input"
                      placeholder="0"
                      value={line.cantidadRecibida}
                      disabled={!line.entered}
                      onChange={(event) => updateLine(key, { cantidadRecibida: event.target.value })}
                    />
                    <span className="po-reception-line__unit">{unit}</span>
                  </div>
                </td>
                <td>
                  <input
                    id={costInputId}
                    type="number"
                    min="0"
                    step="any"
                    className="po-input po-reception-qty-input"
                    placeholder="0"
                    value={line.unitCostPurchase ?? ""}
                    disabled={!line.entered}
                    onChange={(event) => updateLine(key, { unitCostPurchase: event.target.value })}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
