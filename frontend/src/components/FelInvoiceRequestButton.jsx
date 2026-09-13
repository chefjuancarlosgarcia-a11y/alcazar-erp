import { useEffect, useState } from "react"
import { getOrderWithItems, getPosOrderPaymentStatus } from "../services/posOrdersService"
import {
  fetchPosFelDocumentStatus,
  felDocumentStatusLabel,
  isFelInvoiceRequestEligible,
  isSupabasePosOrderId,
} from "../services/posFelInvoiceService"

export function useFelInvoiceOrderSummary(orderId, salesChannelHint = "") {
  const [summary, setSummary] = useState({
    loading: true,
    eligible: false,
    statusLabel: "",
    felStatus: null,
    salesChannel: "",
    tableName: "",
    total: null,
  })

  useEffect(() => {
    if (!isSupabasePosOrderId(orderId)) {
      setSummary({
        loading: false,
        eligible: false,
        statusLabel: "",
        felStatus: null,
        salesChannel: "",
        tableName: "",
        total: null,
      })
      return undefined
    }
    let cancelled = false
    ;(async () => {
      const [orderResult, paymentResult, felResult] = await Promise.all([
        getOrderWithItems(orderId),
        getPosOrderPaymentStatus(orderId),
        fetchPosFelDocumentStatus(orderId),
      ])
      if (cancelled) return
      const order = orderResult.data
      const payment = paymentResult.data || {}
      const channel = salesChannelHint || order?.sales_channel || order?.salesChannel || ""
      const eligible = isFelInvoiceRequestEligible({
        isSupabaseOrder: true,
        orderStatus: order?.status || payment.order_status || "",
        salesChannel: channel,
        isFullyPaid: payment.is_fully_paid ?? null,
        balanceDue: payment.balance_due ?? null,
      })
      const fel = felResult.data?.found ? felResult.data : null
      setSummary({
        loading: false,
        eligible,
        felStatus: fel?.status || null,
        statusLabel: fel?.status ? felDocumentStatusLabel(fel.status) : "",
        salesChannel: channel,
        tableName: order?.table_name || order?.tableName || "",
        total: order?.total ?? payment.order_total ?? null,
      })
    })()
    return () => { cancelled = true }
  }, [orderId, salesChannelHint])

  return summary
}

export default function FelInvoiceRequestButton({ orderId, salesChannel, onOpen, compact = false }) {
  const summary = useFelInvoiceOrderSummary(orderId, salesChannel)
  const { loading, eligible, felStatus, statusLabel, salesChannel: resolvedChannel, tableName, total } = summary

  if (!isSupabasePosOrderId(orderId)) return null
  if (loading) return compact ? null : <small className="cashier-muted">FEL...</small>

  if (felStatus && felStatus !== "failed") {
    return <span className="fel-invoice-badge">{statusLabel}</span>
  }

  if (!eligible) return null

  return (
    <button
      type="button"
      className={compact ? "secondary" : "secondary"}
      onClick={() => onOpen?.({
        orderId,
        salesChannel: resolvedChannel || salesChannel || "",
        tableName: tableName || "Orden pagada",
        total,
        orderStatus: "paid",
      })}
    >
      Solicitar factura FEL
    </button>
  )
}
