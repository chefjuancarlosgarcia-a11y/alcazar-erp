import { useCallback, useEffect, useState } from "react"
import {
  createDepositFromCashClosing,
  createPayableFromPurchase,
  createReceivableFromCatering,
  getFinanceIntegrationStatus
} from "../utils/financeIntegrations"
import { formatMoney } from "../modules/finance/financeUtils"
import "./FinanceIntegrationPanel.css"

const KIND_CONFIG = {
  purchases: {
    title: "Estado en Finanzas",
    sendLabel: "Enviar a cuentas por pagar",
    sentLabel: "Ya enviado a Finanzas"
  },
  catering: {
    title: "Estado en Finanzas",
    sendLabel: "Enviar a cuentas por cobrar",
    sentLabel: "Ya enviado a Finanzas"
  },
  cash_closing: {
    title: "Depósito bancario",
    sendLabel: "Registrar depósito",
    sentLabel: "Ya enviado a Finanzas"
  }
}

export default function FinanceIntegrationPanel({
  sourceModule,
  sourceId,
  canSend = true,
  cashDepositDefaults = null,
  bankAccounts = [],
  onUpdated
}) {
  const config = KIND_CONFIG[sourceModule] || KIND_CONFIG.purchases
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState("")
  const [depositForm, setDepositForm] = useState({
    bankAccountId: "",
    amount: "",
    method: "cash"
  })

  const loadStatus = useCallback(async () => {
    if (!sourceId) return
    setLoading(true)
    const result = await getFinanceIntegrationStatus(sourceModule, sourceId)
    setLoading(false)
    if (result.error) {
      setMessage(result.error)
      setStatus(null)
      return
    }
    setStatus(result.data)
    setMessage("")
  }, [sourceId, sourceModule])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  useEffect(() => {
    if (!cashDepositDefaults) return
    setDepositForm({
      bankAccountId: bankAccounts[0]?.id || "",
      amount: String(cashDepositDefaults.amount ?? ""),
      method: cashDepositDefaults.method || "cash"
    })
  }, [bankAccounts, cashDepositDefaults])

  async function handleSend() {
    setSending(true)
    setMessage("")
    let result
    if (sourceModule === "purchases") {
      result = await createPayableFromPurchase(sourceId)
    } else if (sourceModule === "catering") {
      result = await createReceivableFromCatering(sourceId)
    } else if (sourceModule === "cash_closing") {
      result = await createDepositFromCashClosing(
        sourceId,
        depositForm.bankAccountId,
        Number(depositForm.amount),
        depositForm.method
      )
    }
    setSending(false)
    if (result?.error) {
      setMessage(result.error)
      return
    }
    setMessage(result?.data?.created ? "Registro enviado a Finanzas." : config.sentLabel)
    await loadStatus()
    onUpdated?.(result.data)
  }

  if (loading) {
    return <section className="finance-integration-panel finance-integration-panel--loading">Cargando estado financiero…</section>
  }

  const linked = Boolean(status?.linked)
  const showDepositForm = sourceModule === "cash_closing" && !linked && canSend

  return (
    <section className="finance-integration-panel">
      <div className="finance-integration-panel__head">
        <h4>{config.title}</h4>
        <span className={`finance-integration-badge ${linked ? "is-linked" : "is-pending"}`}>
          {status?.financial_status_label || "Sin cuenta por pagar"}
        </span>
      </div>
      {status?.balance > 0 ? (
        <p className="finance-integration-panel__meta">Pendiente: {formatMoney(status.balance)}</p>
      ) : null}
      {status?.total_amount > 0 && !linked ? (
        <p className="finance-integration-panel__meta">Monto estimado: {formatMoney(status.total_amount)}</p>
      ) : null}
      {showDepositForm ? (
        <div className="finance-integration-panel__form">
          <label>
            Cuenta bancaria
            <select
              value={depositForm.bankAccountId}
              onChange={(e) => setDepositForm({ ...depositForm, bankAccountId: e.target.value })}
            >
              <option value="">Seleccionar…</option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label>
            Monto
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={depositForm.amount}
              onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })}
            />
          </label>
          <label>
            Método
            <select
              value={depositForm.method}
              onChange={(e) => setDepositForm({ ...depositForm, method: e.target.value })}
            >
              <option value="cash">Efectivo</option>
              <option value="card">Tarjeta</option>
              <option value="transfer">Transferencia</option>
            </select>
          </label>
        </div>
      ) : null}
      {canSend && !linked ? (
        <button
          type="button"
          className="erp-btn erp-btn--teal finance-integration-panel__action"
          disabled={sending || (sourceModule === "cash_closing" && (!depositForm.bankAccountId || Number(depositForm.amount) <= 0))}
          onClick={handleSend}
        >
          {sending ? "Enviando…" : config.sendLabel}
        </button>
      ) : null}
      {linked ? <p className="finance-integration-panel__done">{config.sentLabel}</p> : null}
      {message ? <p className="finance-integration-panel__message">{message}</p> : null}
    </section>
  )
}
