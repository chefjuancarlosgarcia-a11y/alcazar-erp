import { useEffect, useMemo, useState } from "react"
import { createPosSplitPayment, getPosOrderPaymentStatus } from "../services/posOrdersService"
import { printSubCheck } from "../services/posPrintService"

const PAYMENT_METHODS = [
  { id: "cash", label: "Efectivo" },
  { id: "card", label: "Tarjeta" },
  { id: "transfer", label: "Transferencia" },
  { id: "qr", label: "QR" }
]

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

export default function SplitPaymentModal({ bill, user, onClose, onPaid }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [message, setMessage] = useState("")
  const [paidByLabel, setPaidByLabel] = useState("Cliente 1")
  const [selection, setSelection] = useState({})
  const [methods, setMethods] = useState([{ method: "cash", amount: "", reference: "" }])

  const orderId = bill?.orderId

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    setLoading(true)
    getPosOrderPaymentStatus(orderId).then(({ data, error, message: errorMessage }) => {
      if (cancelled) return
      if (error) {
        setMessage(errorMessage || "No se pudo cargar el estado de pagos.")
        setStatus(null)
      } else {
        setStatus(data)
        setSelection({})
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [orderId])

  const selectedLines = useMemo(() => {
    if (!status?.items) return []
    return status.items
      .map((item) => {
        const qty = Number(selection[item.order_item_id] || 0)
        if (qty <= 0) return null
        return {
          order_item_id: item.order_item_id,
          quantity_paid: qty,
          product_name: item.product_name,
          unit_price: Number(item.unit_price || 0),
          line_total: money(qty * Number(item.unit_price || 0))
        }
      })
      .filter(Boolean)
  }, [status, selection])

  const selectedTotal = money(selectedLines.reduce((sum, line) => sum + line.line_total, 0))
  const originalTotal = money(status?.order_total ?? bill?.total ?? 0)
  const amountPaid = money(status?.amount_paid ?? 0)
  const balanceDue = money(status?.balance_due ?? Math.max(0, originalTotal - amountPaid))
  const paidMethodsTotal = money(methods.reduce((sum, method) => sum + Number(method.amount || 0), 0))

  useEffect(() => {
    if (!selectedTotal) return
    setMethods((current) => {
      if (current.length === 1 && !current[0].amount) {
        return [{ ...current[0], amount: String(selectedTotal) }]
      }
      return current
    })
  }, [selectedTotal])

  function setItemQty(orderItemId, nextQty, maxQty) {
    const qty = Math.max(0, Math.min(maxQty, Number(nextQty) || 0))
    setSelection((current) => ({ ...current, [orderItemId]: qty }))
  }

  function clearSelection() {
    setSelection({})
    setMethods([{ method: "cash", amount: "", reference: "" }])
  }

  async function submitSubPayment() {
    if (!selectedLines.length) {
      setMessage("Selecciona al menos un producto para cobrar.")
      return
    }
    const paymentMethods = methods
      .filter((method) => Number(method.amount) > 0)
      .map((method) => ({ method: method.method, amount: money(method.amount), reference: method.reference || null }))
    if (!paymentMethods.length) {
      setMessage("Indica el monto del metodo de pago.")
      return
    }
    if (paidMethodsTotal < selectedTotal) {
      setMessage("El pago esta incompleto para esta subcuenta.")
      return
    }

    setProcessing(true)
    setMessage("Procesando subcuenta...")
    try {
      const result = await createPosSplitPayment({
        orderId,
        items: selectedLines.map(({ order_item_id, quantity_paid }) => ({ order_item_id, quantity_paid })),
        methods: paymentMethods,
        paidByLabel
      })
      if (result.error) {
        setMessage(result.message || "No se pudo registrar la subcuenta.")
        return
      }

      void printSubCheck(bill, {
        items: selectedLines,
        totalAmount: selectedTotal,
        methods: paymentMethods,
        paidByLabel,
        paymentNumber: result.data?.payment_number
      }).catch((error) => {
        console.warn("[Cashier] print skipped/failed subcheck", error?.message || error)
      })

      onPaid?.({
        ...result.data,
        selectedLines,
        methods: paymentMethods,
        balanceDue: money(result.data?.balance_due ?? 0),
        orderFullyPaid: money(result.data?.balance_due ?? 0) <= 0
      })
    } catch (error) {
      console.warn("[Cashier] split payment failed", error?.message || error)
      setMessage("No se pudo registrar la subcuenta.")
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="split-payment-overlay" role="dialog" aria-modal="true" aria-labelledby="split-payment-title">
      <div className="split-payment-modal">
        <header className="split-payment-header">
          <div>
            <p className="split-payment-eyebrow">Cobro por separado</p>
            <h2 id="split-payment-title">Dividir cuenta por productos</h2>
            <p>{bill?.tableName} · {bill?.waiterName}</p>
          </div>
          <button type="button" className="split-payment-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        {loading ? (
          <p className="split-payment-message">Cargando precuenta...</p>
        ) : (
          <>
            <div className="split-payment-columns">
              <section className="split-payment-panel">
                <h3>Precuenta de la mesa</h3>
                <div className="split-payment-items">
                  {(status?.items || []).map((item) => {
                    const remaining = Number(item.quantity_remaining || 0)
                    const selectedQty = Number(selection[item.order_item_id] || 0)
                    const fullyPaid = remaining <= 0
                    return (
                      <article key={item.order_item_id} className={`split-payment-item ${selectedQty > 0 ? "selected" : ""} ${fullyPaid ? "paid" : ""}`}>
                        <div className="split-payment-item-head">
                          <strong>{item.product_name}</strong>
                          <span className={`split-payment-badge ${fullyPaid ? "paid" : selectedQty > 0 ? "selected" : "pending"}`}>
                            {fullyPaid ? "Pagado" : selectedQty > 0 ? "En subcuenta" : "Pendiente"}
                          </span>
                        </div>
                        <div className="split-payment-item-meta">
                          <span>{Number(item.quantity_paid || 0)}/{Number(item.quantity_total || 0)} uds</span>
                          <span>Q{Number(item.unit_price || 0).toFixed(2)} c/u</span>
                          <span>Pendiente: Q{Number(item.line_remaining || 0).toFixed(2)}</span>
                        </div>
                        {!fullyPaid && (
                          <div className="split-payment-qty">
                            <button type="button" disabled={selectedQty <= 0} onClick={() => setItemQty(item.order_item_id, selectedQty - 1, remaining)}>−</button>
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              value={selectedQty}
                              onChange={(event) => setItemQty(item.order_item_id, event.target.value, remaining)}
                            />
                            <button type="button" disabled={selectedQty >= remaining} onClick={() => setItemQty(item.order_item_id, selectedQty + 1, remaining)}>+</button>
                            <button type="button" className="link" onClick={() => setItemQty(item.order_item_id, remaining, remaining)}>Todas</button>
                          </div>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>

              <section className="split-payment-panel">
                <h3>Subcuenta actual</h3>
                <label className="split-payment-label">
                  Etiqueta opcional
                  <input value={paidByLabel} onChange={(event) => setPaidByLabel(event.target.value)} placeholder="Cliente 1" />
                </label>
                <div className="split-payment-items compact">
                  {selectedLines.length ? selectedLines.map((line) => (
                    <div key={line.order_item_id} className="split-payment-selected-line">
                      <span>{line.quantity_paid} x {line.product_name}</span>
                      <strong>Q{line.line_total.toFixed(2)}</strong>
                    </div>
                  )) : <p className="split-payment-empty">Marca productos de la izquierda para armar la subcuenta.</p>}
                </div>
                <div className="split-payment-summary">
                  <p><span>Saldo original</span><strong>Q{originalTotal.toFixed(2)}</strong></p>
                  <p><span>Ya pagado</span><strong>Q{amountPaid.toFixed(2)}</strong></p>
                  <p><span>Total seleccionado</span><strong>Q{selectedTotal.toFixed(2)}</strong></p>
                  <p className="highlight"><span>Saldo restante</span><strong>Q{balanceDue.toFixed(2)}</strong></p>
                </div>

                <div className="split-payment-methods">
                  <h4>Metodo de pago</h4>
                  {methods.map((method, index) => (
                    <div className="split-payment-method-row" key={`${method.method}-${index}`}>
                      <select value={method.method} onChange={(event) => setMethods((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, method: event.target.value } : entry))}>
                        {PAYMENT_METHODS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                      </select>
                      <input type="number" min="0" step="0.01" placeholder="Monto" value={method.amount} onChange={(event) => setMethods((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, amount: event.target.value } : entry))} />
                    </div>
                  ))}
                  <button type="button" className="secondary" onClick={() => setMethods((current) => [...current, { method: "card", amount: "", reference: "" }])}>+ Pago mixto</button>
                  <p className="split-payment-paid-total">Pagado: Q{paidMethodsTotal.toFixed(2)}</p>
                </div>
              </section>
            </div>

            {message && <p className="split-payment-message">{message}</p>}

            <footer className="split-payment-footer">
              <button type="button" className="secondary" onClick={clearSelection} disabled={processing}>Limpiar seleccion</button>
              <button type="button" className="secondary" onClick={onClose} disabled={processing}>Cerrar</button>
              <button type="button" className="primary" disabled={processing || !selectedLines.length} onClick={submitSubPayment}>
                {processing ? "Procesando..." : "Cobrar subcuenta"}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
