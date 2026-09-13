import { useCallback, useEffect, useRef, useState } from "react"
import { getOrderWithItems, getPosOrderPaymentStatus } from "../services/posOrdersService"
import {
  buildFelInvoiceEligibilityInput,
  fetchPosFelDocumentStatus,
  felDocumentPendingUiLabel,
  felDocumentStatusLabel,
  isFelInvoiceRequestEligible,
  isSupabasePosOrderId,
  requestPosFelCertificationConsumerFinal,
  resolveFelInvoiceSalesChannel,
} from "../services/posFelInvoiceService"

const SUBMIT_INELIGIBLE_MESSAGE = "Esta orden no es elegible para solicitud FEL en este momento."
const SUBMIT_INVALID_MESSAGE = "No fue posible registrar la solicitud. Verifica la orden e intenta de nuevo."

export default function FelInvoiceRequestModal({ context, onClose, onSuccess }) {
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")
  const [success, setSuccess] = useState(null)
  const [felDoc, setFelDoc] = useState(null)
  const [eligible, setEligible] = useState(false)
  const [nitChoice, setNitChoice] = useState("cf")
  const submitLockRef = useRef(false)
  const mountedRef = useRef(true)
  const refreshGenerationRef = useRef(0)

  const orderId = context?.orderId
  const tableLabel = context?.tableName || "Orden POS"

  const applyIfCurrent = useCallback((generation, fn) => {
    if (!mountedRef.current || generation !== refreshGenerationRef.current) return false
    fn()
    return true
  }, [])

  const refreshState = useCallback(async (generation) => {
    if (!orderId) return
    applyIfCurrent(generation, () => {
      setLoading(true)
      setErrorMessage("")
    })
    try {
      const [paymentResult, felResult, orderResult] = await Promise.all([
        getPosOrderPaymentStatus(orderId),
        fetchPosFelDocumentStatus(orderId),
        getOrderWithItems(orderId),
      ])
      if (!applyIfCurrent(generation, () => {})) return

      if (paymentResult.error) {
        setErrorMessage("No se pudo verificar el estado de pago de la orden.")
        setEligible(false)
        setFelDoc(null)
        return
      }
      if (felResult.error && !felResult.data) {
        setErrorMessage(felResult.message)
        setEligible(false)
        setFelDoc(null)
        return
      }
      const payment = paymentResult.data || {}
      const fel = felResult.data?.found ? felResult.data : null
      const order = orderResult.data
      const channel = resolveFelInvoiceSalesChannel(context?.salesChannel, order)
      const orderStatus = context?.orderStatus || payment.order_status || order?.status || ""
      const eligibilityInput = buildFelInvoiceEligibilityInput({
        orderId,
        orderStatus,
        salesChannel: channel,
        payment,
      })
      const nextEligible = channel
        ? isFelInvoiceRequestEligible(eligibilityInput)
        : false

      setFelDoc(fel)
      setEligible(nextEligible)
      if (!channel && !nextEligible) {
        setErrorMessage(SUBMIT_INELIGIBLE_MESSAGE)
      }
    } finally {
      applyIfCurrent(generation, () => setLoading(false))
    }
  }, [applyIfCurrent, context?.orderStatus, context?.salesChannel, orderId])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    const generation = ++refreshGenerationRef.current
    refreshState(generation)
  }, [refreshState])

  async function revalidateBeforeSubmit() {
    if (!orderId || !isSupabasePosOrderId(orderId)) {
      return { ok: false, message: SUBMIT_INVALID_MESSAGE }
    }
    if (nitChoice !== "cf") {
      return { ok: false, message: SUBMIT_INVALID_MESSAGE }
    }
    const [paymentResult, orderResult] = await Promise.all([
      getPosOrderPaymentStatus(orderId),
      getOrderWithItems(orderId),
    ])
    if (paymentResult.error) {
      return { ok: false, message: "No se pudo verificar el estado de pago de la orden." }
    }
    const payment = paymentResult.data || {}
    const channel = resolveFelInvoiceSalesChannel(context?.salesChannel, orderResult.data)
    if (!channel) {
      return { ok: false, message: SUBMIT_INELIGIBLE_MESSAGE }
    }
    const eligibilityInput = buildFelInvoiceEligibilityInput({
      orderId,
      orderStatus: context?.orderStatus || payment.order_status || orderResult.data?.status,
      salesChannel: channel,
      payment,
    })
    if (!isFelInvoiceRequestEligible(eligibilityInput)) {
      return { ok: false, message: SUBMIT_INELIGIBLE_MESSAGE }
    }
    return { ok: true }
  }

  async function submitConsumerFinal() {
    if (!orderId || submitLockRef.current || submitting) return
    const generation = refreshGenerationRef.current
    submitLockRef.current = true
    setSubmitting(true)
    setErrorMessage("")
    try {
      const preCheck = await revalidateBeforeSubmit()
      if (!applyIfCurrent(generation, () => {})) return
      if (!preCheck.ok) {
        setErrorMessage(preCheck.message)
        return
      }

      const result = await requestPosFelCertificationConsumerFinal(orderId)
      if (!applyIfCurrent(generation, () => {})) return

      if (result.error || !result.data) {
        setErrorMessage(result.message || "No fue posible registrar la solicitud.")
        return
      }
      const status = result.data.status || "pending_certification"
      setSuccess({
        documentId: result.data.document_id,
        idempotent: result.data.idempotent === true,
        status,
      })
      setFelDoc({
        found: true,
        document_id: result.data.document_id,
        status,
        order_id: orderId,
      })
      onSuccess?.()
    } finally {
      if (mountedRef.current && generation === refreshGenerationRef.current) {
        submitLockRef.current = false
        setSubmitting(false)
      }
    }
  }

  const existingStatus = felDoc?.status
  const showRequestForm = !success && !existingStatus

  return (
    <div className="fel-invoice-overlay" role="dialog" aria-modal="true" aria-labelledby="fel-invoice-title">
      <div className="fel-invoice-modal erp-card erp-card--form">
        <header className="fel-invoice-header">
          <div>
            <p className="cashier-eyebrow">Facturación electrónica</p>
            <h2 id="fel-invoice-title">Solicitar factura electrónica</h2>
            <p className="cashier-muted">{tableLabel}</p>
          </div>
          <button type="button" className="fel-invoice-close" onClick={onClose} aria-label="Cerrar">×</button>
        </header>

        <p className="fel-invoice-explainer">
          Esta acción registra la solicitud de factura. La certificación se procesa por separado.
        </p>

        {loading && <p className="fel-invoice-message">Verificando orden...</p>}

        {!loading && success && (
          <div className="fel-invoice-success">
            <strong>Solicitud FEL registrada</strong>
            <p>Estado: {felDocumentPendingUiLabel(success.status)}</p>
            {success.idempotent && <small>Documento existente reutilizado.</small>}
          </div>
        )}

        {!loading && !success && existingStatus && (
          <div className="fel-invoice-status">
            <strong>{felDocumentStatusLabel(existingStatus)}</strong>
            {existingStatus === "pending_certification" && (
              <p className="cashier-muted">Pendiente de certificación</p>
            )}
            {existingStatus === "failed" && (
              <p className="cashier-muted">Reintento no disponible hasta revisión operativa.</p>
            )}
          </div>
        )}

        {!loading && !success && showRequestForm && (
          <>
            {!eligible && (
              <p className="fel-invoice-message">
                {errorMessage || SUBMIT_INELIGIBLE_MESSAGE}
              </p>
            )}
            {eligible && (
              <div className="fel-invoice-options">
                <label className={`fel-invoice-option ${nitChoice === "cf" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="fel-receiver"
                    value="cf"
                    checked={nitChoice === "cf"}
                    onChange={() => setNitChoice("cf")}
                  />
                  <span>
                    <strong>Consumidor Final (CF)</strong>
                    <small>Sin datos adicionales</small>
                  </span>
                </label>
                <label className="fel-invoice-option disabled" aria-disabled="true">
                  <input type="radio" name="fel-receiver" value="nit" disabled />
                  <span>
                    <strong>Factura con NIT</strong>
                    <small>Próximamente</small>
                  </span>
                </label>
              </div>
            )}
            {errorMessage && eligible && <p className="fel-invoice-error">{errorMessage}</p>}
          </>
        )}

        <footer className="fel-invoice-footer">
          <button type="button" className="secondary" onClick={onClose} disabled={submitting}>
            {success ? "Cerrar" : "Cancelar"}
          </button>
          {!loading && !success && showRequestForm && eligible && (
            <button
              type="button"
              className="primary"
              disabled={submitting || nitChoice !== "cf"}
              onClick={submitConsumerFinal}
            >
              {submitting ? "Registrando..." : "Solicitar factura"}
            </button>
          )}
        </footer>
      </div>
    </div>
  )
}
