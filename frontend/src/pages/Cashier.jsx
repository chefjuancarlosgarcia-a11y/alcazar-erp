import { useEffect, useState } from "react"
import { useAuth } from "../context/AuthContext"
import {
  PAYMENT_METHODS,
  PRE_BILLS_KEY,
  approveAuthorization,
  beginPayment,
  canAccessCashier,
  canAuthorizeFinance,
  closeCashSession,
  confirmPayment,
  createAuthorizationRequest,
  createSplitBill,
  getCashSummary,
  getOpenCashSession,
  loadAuthorizationRequests,
  loadCashMovements,
  loadCashSessions,
  loadFinancialAudit,
  loadPayments,
  loadPreBills,
  loadSplitBills,
  loadTipRecords,
  markPreBillProblem,
  openCashSession,
  refundPayment,
  registerCashMovement,
  returnPreBillToWaiter
} from "../utils/cashier"
import { printFinalCheck } from "../services/posPrintService"
import useOperationalAlerts from "../hooks/useOperationalAlerts"
import OperationalAlertToast from "../components/OperationalAlertToast"
import "./Cashier.css"

const TABS = [
  ["dashboard", "Dashboard Caja"],
  ["requests", "Solicitudes de cobro"],
  ["charge", "Cobrar mesa"],
  ["register", "Arqueo de caja"],
  ["movements", "Movimientos de caja"],
  ["closures", "Cierres"],
  ["reports", "Reportes"]
]

const BILL_DENOMINATIONS = [
  { key: "Q200", label: "Q200", value: 200 },
  { key: "Q100", label: "Q100", value: 100 },
  { key: "Q50", label: "Q50", value: 50 },
  { key: "Q20", label: "Q20", value: 20 },
  { key: "Q10", label: "Q10", value: 10 },
  { key: "Q5", label: "Q5", value: 5 },
  { key: "Q1", label: "Q1", value: 1 }
]

const COIN_DENOMINATIONS = [
  { key: "M1", label: "Q1.00", value: 1 },
  { key: "M050", label: "Q0.50", value: 0.5 },
  { key: "M025", label: "Q0.25", value: 0.25 },
  { key: "M010", label: "Q0.10", value: 0.1 },
  { key: "M005", label: "Q0.05", value: 0.05 }
]

const CASH_DENOMINATION_DEFAULTS = Object.fromEntries([...BILL_DENOMINATIONS, ...COIN_DENOMINATIONS].map((item) => [item.key, ""]))

function denominationSubtotal(denominations, counts) {
  return denominations.reduce((total, item) => total + Number(counts[item.key] || 0) * item.value, 0)
}

function DenominationGroup({ title, denominations, counts, onChange }) {
  return (
    <section className="cashier-denomination-group">
      <h3>{title}</h3>
      <div className="cashier-denomination-grid">
        {denominations.map((item) => {
          const quantity = Number(counts[item.key] || 0)
          return (
            <label className="cashier-denomination" key={item.key}>
              <span>{item.label}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                placeholder="0"
                value={counts[item.key]}
                onChange={(event) => onChange(item.key, event.target.value)}
              />
              <small>Q{(quantity * item.value).toFixed(2)}</small>
            </label>
          )
        })}
      </div>
    </section>
  )
}

function Cashier() {
  const { user } = useAuth()
  const [tab, setTab] = useState("dashboard")
  const [store, setStore] = useState(loadStore)
  const [selectedBillId, setSelectedBillId] = useState("")
  const [feedback, setFeedback] = useState("")
  const canSeeAllFinance = canAuthorizeFinance(user)
  const currentCashierId = user?.id || user?.username
  const visibleSessionIds = new Set(store.sessions.filter((entry) => canSeeAllFinance || String(entry.cashierId) === String(currentCashierId)).map((entry) => String(entry.id)))
  const visibleStore = canSeeAllFinance ? store : {
    ...store,
    payments: store.payments.filter((entry) => String(entry.cashierId) === String(currentCashierId)),
    sessions: store.sessions.filter((entry) => String(entry.cashierId) === String(currentCashierId)),
    movements: store.movements.filter((entry) => visibleSessionIds.has(String(entry.cashSessionId))),
    tips: store.tips.filter((entry) => String(entry.cashierId) === String(currentCashierId)),
    authorizations: store.authorizations.filter((entry) => String(entry.requestedById) === String(currentCashierId)),
    audit: store.audit.filter((entry) => entry.performedBy === user?.name || entry.performedBy === user?.username)
  }
  const session = getOpenCashSession(user)
  const summary = getCashSummary(session)
  const requests = store.preBills.filter((bill) => bill.status === "sent_to_cashier")
  const selectedBill = store.preBills.find((bill) => String(bill.id) === String(selectedBillId)) || requests[0]

  useEffect(() => {
    function refresh() {
      setStore(loadStore())
    }
    function refreshFromStorage(event) {
      if (!event.key || event.key === PRE_BILLS_KEY) refresh()
    }
    window.addEventListener("cashier-updated", refresh)
    window.addEventListener("storage", refreshFromStorage)
    return () => {
      window.removeEventListener("cashier-updated", refresh)
      window.removeEventListener("storage", refreshFromStorage)
    }
  }, [])

  function refresh(message = "") {
    setStore(loadStore())
    setFeedback(message)
  }

  function openCharge(bill) {
    beginPayment(bill.id, user)
    setSelectedBillId(bill.id)
    setTab("charge")
    setStore(loadStore())
  }

  const cashierAlerts = useOperationalAlerts({
    scope: "cashier",
    enabled: canAccessCashier(user),
    items: requests,
    getId: (bill) => bill.id,
    getAlert: (bill) => ({
      icon: "$",
      title: `${bill.tableName} solicita cobro`,
      message: `${bill.waiterName || "Mesero"} · Q${Number(bill.total || 0).toFixed(2)} · ${waitingMinutes(bill)} min esperando`,
      soundType: "cashier",
      onView: () => {
        setSelectedBillId(bill.id)
        setTab("requests")
        document.getElementById(`cashier-request-${bill.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
      }
    })
  })

  if (!canAccessCashier(user)) {
    return <section className="cashier-page"><article className="cashier-open-card"><h1>Caja</h1><p>No tienes acceso al módulo de Caja.</p></article></section>
  }

  return (
    <section className="cashier-page">
      <header className="cashier-header">
        <div>
          <p className="cashier-eyebrow">Control financiero</p>
          <h1>Caja</h1>
          <p className="cashier-muted">Cobros, propinas, arqueos y auditoría de mesas.</p>
        </div>
        <div className={`cashier-session-chip ${session ? "open" : ""}`}>
          {session ? `Caja abierta · ${session.cashierName}` : "Caja cerrada"}
        </div>
      </header>

      <nav className="cashier-tabs" aria-label="Caja">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            {label}
            {id === "requests" && requests.length > 0 && <b>{requests.length}</b>}
          </button>
        ))}
      </nav>
      {feedback && <div className="cashier-feedback">{feedback}</div>}
      <OperationalAlertToast
        alerts={cashierAlerts.toasts}
        onDismiss={cashierAlerts.dismissToast}
      />

      {tab === "dashboard" && <CashierDashboard session={session} summary={summary} requests={requests} payments={visibleStore.payments} onOpenCharge={openCharge} onRefresh={refresh} user={user} highlightedIds={cashierAlerts.highlightedIds} />}
      {tab === "requests" && <PaymentRequests bills={requests} onOpenCharge={openCharge} onRefresh={refresh} user={user} highlightedIds={cashierAlerts.highlightedIds} />}
      {tab === "charge" && <ChargePanel key={selectedBill?.id || "empty"} bill={selectedBill} splitBills={store.splitBills} session={session} requests={visibleStore.authorizations} user={user} onRefresh={refresh} />}
      {tab === "register" && <CashRegister session={session} summary={summary} user={user} onRefresh={refresh} />}
      {tab === "movements" && <MovementsPanel session={session} movements={visibleStore.movements} authorizations={visibleStore.authorizations} user={user} onRefresh={refresh} />}
      {tab === "closures" && <Closures sessions={visibleStore.sessions} />}
      {tab === "reports" && <CashReports payments={visibleStore.payments} tips={visibleStore.tips} movements={visibleStore.movements} sessions={visibleStore.sessions} audit={visibleStore.audit} />}
    </section>
  )
}

function CashierDashboard({ session, summary, requests, payments, onOpenCharge, onRefresh, user, highlightedIds }) {
  const [openingAmount, setOpeningAmount] = useState("500")
  const completed = payments.filter((payment) => payment.status === "completed")
  if (!session) {
    return (
      <article className="cashier-open-card">
        <h2>Apertura de caja</h2>
        <p>Debes abrir una caja antes de procesar pagos.</p>
        <label>Fondo inicial<input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} /></label>
        <button type="button" onClick={() => {
          const result = openCashSession(user, openingAmount)
          onRefresh(result.ok ? "Caja abierta correctamente." : result.message)
        }}>Abrir caja</button>
      </article>
    )
  }
  const cards = [
    ["Ventas del turno", `Q${summary.sales.toFixed(2)}`],
    ["Efectivo esperado", `Q${summary.expectedCash.toFixed(2)}`],
    ["Solicitudes de cobro", requests.length],
    ["Propinas", `Q${summary.tips.toFixed(2)}`],
    ["Descuentos", `Q${summary.discounts.toFixed(2)}`]
  ]
  return (
    <div className="cashier-dashboard">
      <div className="cashier-metrics">{cards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
      <article className="cashier-panel">
        <div className="cashier-panel-title"><h2>Pagos pendientes</h2><span>{requests.length} solicitudes</span></div>
        {requests.slice(0, 5).map((bill) => <RequestRow bill={bill} key={bill.id} isNew={highlightedIds?.has(String(bill.id))} onCharge={() => onOpenCharge(bill)} />)}
        {!requests.length && <Empty text="No hay mesas esperando cobro." />}
      </article>
      <article className="cashier-panel">
        <div className="cashier-panel-title"><h2>Últimos cobros</h2><span>{completed.length} pagos</span></div>
        {completed.slice(0, 5).map((payment) => <div className="cashier-row" key={payment.id}><strong>{payment.cashierName}</strong><span>Q{payment.totalAmount.toFixed(2)} · {formatDate(payment.createdAt)}</span><button type="button" className="secondary" onClick={() => showReceipt(payment)}>Recibo</button></div>)}
        {!completed.length && <Empty text="Aún no hay cobros registrados." />}
      </article>
    </div>
  )
}

function PaymentRequests({ bills, onOpenCharge, onRefresh, user, highlightedIds }) {
  return (
    <article className="cashier-panel">
      <div className="cashier-panel-title"><h2>Solicitudes de cobro</h2><span>{bills.length} activas</span></div>
      <div className="cashier-request-grid">
        {bills.map((bill) => (
          <article id={`cashier-request-${bill.id}`} className={`cashier-request ${bill.problem ? "problem" : ""} ${highlightedIds?.has(String(bill.id)) ? "new-alert" : ""}`} key={bill.id}>
            <header><h3>{bill.tableName}</h3><span>{highlightedIds?.has(String(bill.id)) ? "Nuevo" : bill.status === "sent_to_cashier" ? "En caja" : "Precuenta"}</span></header>
            <p>Mesero: {bill.waiterName}</p>
            <strong>Q{Number(bill.total).toFixed(2)}</strong>
            <small>Solicitada: {formatDate(bill.sentAt || bill.createdAt)} · {waitingMinutes(bill)} min</small>
            {bill.problem && <p className="cashier-alert">{bill.problemReason}</p>}
            <div className="cashier-actions">
              <button type="button" onClick={() => onOpenCharge(bill)}>Cobrar</button>
              <button type="button" className="secondary" onClick={() => {
                const reason = window.prompt("Motivo para devolver al mesero:")
                if (reason) {
                  returnPreBillToWaiter(bill.id, reason, user)
                  onRefresh("Precuenta devuelta al mesero.")
                }
              }}>Devolver</button>
              <button type="button" className="danger" onClick={() => {
                const reason = window.prompt("Describe el problema:")
                if (reason) {
                  markPreBillProblem(bill.id, reason, user)
                  onRefresh("Problema reportado.")
                }
              }}>Problema</button>
            </div>
          </article>
        ))}
      </div>
      {!bills.length && <Empty text="No hay solicitudes pendientes." />}
    </article>
  )
}

function RequestRow({ bill, isNew = false, onCharge }) {
  return (
    <div className={`cashier-row ${isNew ? "new-alert" : ""}`}>
      <div><strong>{bill.tableName}</strong><span>{bill.waiterName} · {waitingMinutes(bill)} min esperando</span></div>
      <strong>Q{Number(bill.total).toFixed(2)}</strong>
      <button type="button" onClick={onCharge}>Cobrar</button>
    </div>
  )
}

function ChargePanel({ bill, splitBills, session, requests, user, onRefresh }) {
  const [tip, setTip] = useState(bill ? String(bill.tipSuggested || 0) : "0")
  const [discount, setDiscount] = useState("0")
  const [methods, setMethods] = useState([{ method: "cash", amount: bill ? String(bill.total) : "", reference: "" }])
  const [splitMode, setSplitMode] = useState("")
  const [splitConfig, setSplitConfig] = useState("2")
  const [splitId, setSplitId] = useState("")
  const [message, setMessage] = useState("")
  const splitBill = splitBills.find((split) => String(split.preBillId) === String(bill?.id))
  const split = splitBill?.splits.find((part) => part.id === splitId)
  const subtotal = Number(split?.subtotal ?? bill?.subtotal ?? 0)
  const total = Math.max(0, subtotal - Number(discount || 0) + Number(tip || 0))
  const paid = methods.reduce((sum, method) => sum + Number(method.amount || 0), 0)
  const change = Math.max(0, paid - total)
  const approvedAuthorization = requests.find((request) => request.status === "approved" && !request.usedAt && request.requestedById === (user.id || user.username))

  if (!bill) return <article className="cashier-panel"><Empty text="Selecciona una solicitud de cobro." /></article>
  if (!session) return <article className="cashier-panel"><h2>Cobrar mesa</h2><Empty text="Abre una caja desde Dashboard Caja antes de cobrar." /></article>

  function addMethod() {
    setMethods((current) => [...current, { method: "card", amount: "", reference: "" }])
  }

  function submit() {
    const result = confirmPayment({
      preBillId: bill.id,
      splitId,
      tipAmount: Number(tip),
      discountAmount: Number(discount),
      methods,
      authorizationId: approvedAuthorization?.id || "",
      authorizedBy: approvedAuthorization?.approvedBy || ""
    }, user)
    if (result.requiresAuthorization) {
      createAuthorizationRequest("Descuento o cortesía", result.message, Number(discount), user)
      setMessage("Solicitud de autorización enviada. Espera aprobación para cobrar.")
      onRefresh("")
      return
    }
    setMessage(result.ok ? result.allPaid ? "Pago completado. Mesa liberada." : "Pago parcial registrado. Hay partes pendientes." : result.message)
    if (result.ok) {
      onRefresh("")
      if (result.allPaid) {
        try {
          const printed = printFinalCheck(bill, result.payment)
          if (!printed) setMessage("Pago completado. Mesa liberada. No se pudo abrir la impresión automática.")
        } catch (error) {
          console.error("[Cashier] Error imprimiendo cuenta final.", error)
          setMessage("Pago completado. Mesa liberada. La impresión falló, puedes abrir el recibo desde Últimos cobros.")
        }
      }
    }
  }

  function buildSplit() {
    const config = splitMode === "custom"
      ? { amounts: splitConfig.split(",").map((amount) => amount.trim()) }
      : { count: Number(splitConfig) }
    const result = createSplitBill(bill.id, splitMode, config, user)
    setMessage(result.ok ? "Cuenta dividida. Selecciona una parte para cobrar." : result.message)
    if (result.ok) onRefresh("")
  }

  return (
    <div className="cashier-charge-layout">
      <article className="cashier-panel">
        <div className="cashier-panel-title"><h2>{bill.tableName}</h2><span>{bill.waiterName}</span></div>
        <div className="cashier-items">
          {bill.items.map((item) => <div key={item.lineId || item.id}><span>{item.cantidad} x {item.nombre}</span><strong>Q{(item.precio * item.cantidad).toFixed(2)}</strong></div>)}
        </div>
        <div className="cashier-totals">
          <p>Subtotal <strong>Q{subtotal.toFixed(2)}</strong></p>
          <label>Descuento<input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} /></label>
          <label>Propina<input type="number" min="0" step="0.01" value={tip} onChange={(event) => setTip(event.target.value)} /></label>
          <p className="total">Total final <strong>Q{total.toFixed(2)}</strong></p>
        </div>
      </article>
      <article className="cashier-panel">
        <h2>Pago</h2>
        {splitBill && (
          <label className="cashier-field">Parte a pagar
            <select value={splitId} onChange={(event) => setSplitId(event.target.value)}>
              <option value="">Cuenta completa</option>
              {splitBill.splits.map((part) => <option key={part.id} disabled={part.paid} value={part.id}>{part.name} · Q{part.total.toFixed(2)} {part.paid ? "(pagada)" : ""}</option>)}
            </select>
          </label>
        )}
        {methods.map((method, index) => (
          <div className="cashier-payment-method" key={`${method.method}-${index}`}>
            <select value={method.method} onChange={(event) => setMethods((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, method: event.target.value } : entry))}>
              {PAYMENT_METHODS.map((option) => <option value={option.id} key={option.id}>{option.label}</option>)}
            </select>
            <input type="number" min="0" step="0.01" placeholder="Monto" value={method.amount} onChange={(event) => setMethods((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, amount: event.target.value } : entry))} />
            <input placeholder="Referencia" value={method.reference} onChange={(event) => setMethods((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, reference: event.target.value } : entry))} />
          </div>
        ))}
        <button type="button" className="secondary" onClick={addMethod}>+ Pago mixto</button>
        <p className="cashier-change">Pagado: Q{paid.toFixed(2)} · Vuelto: Q{change.toFixed(2)}</p>
        {approvedAuthorization && <div className="cashier-approved">Autorización aprobada por {approvedAuthorization.approvedBy}</div>}
        {message && <div className="cashier-feedback">{message}</div>}
        <button type="button" onClick={submit}>Confirmar pago</button>
      </article>
      <article className="cashier-panel cashier-split">
        <h2>Dividir cuenta</h2>
        <select value={splitMode} onChange={(event) => setSplitMode(event.target.value)}>
          <option value="">Selecciona opción</option>
          <option value="products">Por productos</option>
          <option value="equal">Partes iguales</option>
          <option value="custom">Monto personalizado</option>
        </select>
        {splitMode === "equal" && <input type="number" min="2" value={splitConfig} onChange={(event) => setSplitConfig(event.target.value)} placeholder="Personas" />}
        {splitMode === "custom" && <input value={splitConfig} onChange={(event) => setSplitConfig(event.target.value)} placeholder="Ej: 100, 150.50, 80" />}
        {splitMode && <button type="button" className="secondary" onClick={buildSplit}>Crear división</button>}
        {splitBill?.splits.map((part) => <div className="cashier-row" key={part.id}><span>{part.name}</span><strong>Q{part.total.toFixed(2)} · {part.paid ? "Pagada" : "Pendiente"}</strong></div>)}
      </article>
    </div>
  )
}

function CashRegister({ session, summary, user, onRefresh }) {
  const [cashCount, setCashCount] = useState(CASH_DENOMINATION_DEFAULTS)
  const [notes, setNotes] = useState("")
  if (!session) return <article className="cashier-panel"><Empty text="No existe una caja abierta para arquear." /></article>
  const billsSubtotal = denominationSubtotal(BILL_DENOMINATIONS, cashCount)
  const coinsSubtotal = denominationSubtotal(COIN_DENOMINATIONS, cashCount)
  const counted = Number((billsSubtotal + coinsSubtotal).toFixed(2))
  const difference = Number((counted - summary.expectedCash).toFixed(2))

  function updateCashCount(key, value) {
    setCashCount((current) => ({ ...current, [key]: value }))
  }

  return (
    <article className="cashier-panel cashier-register">
      <h2>Cierre / arqueo de caja</h2>
      <Summary summary={summary} />
      <div className="cashier-count-header">
        <h3>Conteo de efectivo</h3>
        <span>Ingresa cantidades por denominación</span>
      </div>
      <DenominationGroup title="Billetes" denominations={BILL_DENOMINATIONS} counts={cashCount} onChange={updateCashCount} />
      <DenominationGroup title="Monedas" denominations={COIN_DENOMINATIONS} counts={cashCount} onChange={updateCashCount} />
      <div className="cashier-count-subtotals">
        <p>Subtotal billetes <strong>Q{billsSubtotal.toFixed(2)}</strong></p>
        <p>Subtotal monedas <strong>Q{coinsSubtotal.toFixed(2)}</strong></p>
        <p>Total contado <strong>Q{counted.toFixed(2)}</strong></p>
      </div>
      <div className="cashier-count-summary">
        <p>Esperado <strong>Q{summary.expectedCash.toFixed(2)}</strong></p>
        <p>Contado <strong>Q{counted.toFixed(2)}</strong></p>
        <p className={difference === 0 ? "balance" : "difference"}>Diferencia <strong>Q{difference.toFixed(2)}</strong></p>
      </div>
      <label>Observaciones<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={difference !== 0 ? "Motivo obligatorio de la diferencia" : "Notas del cierre"} /></label>
      <button type="button" onClick={() => {
        const detail = Object.fromEntries(Object.entries(cashCount).map(([key, value]) => [key, Number(value || 0)]))
        const result = closeCashSession(session.id, {
          total: counted,
          billsSubtotal,
          coinsSubtotal,
          denominations: detail
        }, notes, user)
        onRefresh(result.ok ? "Caja cerrada correctamente." : result.message)
      }}>Cerrar caja</button>
    </article>
  )
}

function MovementsPanel({ session, movements, authorizations, user, onRefresh }) {
  const [form, setForm] = useState({ type: "cash_out", amount: "", method: "cash", reason: "" })
  const [refundId, setRefundId] = useState("")
  const payments = loadPayments().filter((payment) => payment.status === "completed")
  return (
    <div className="cashier-columns">
      <article className="cashier-panel">
        <h2>Registrar movimiento</h2>
        {!session && <Empty text="Abre una caja para registrar movimientos." />}
        {session && (
          <>
            <label className="cashier-field">Tipo<select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="cash_in">Ingreso</option><option value="cash_out">Salida</option><option value="expense">Gasto</option><option value="tip_withdrawal">Retiro propinas</option><option value="adjustment">Ajuste</option></select></label>
            <label className="cashier-field">Monto<input type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></label>
            <label className="cashier-field">Motivo<textarea value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} /></label>
            <button type="button" onClick={() => {
              const result = registerCashMovement(session.id, form, user)
              if (result.requiresAuthorization) {
                createAuthorizationRequest("Ajuste de caja", form.reason, form.amount, user)
                onRefresh("Ajuste enviado para autorización.")
              } else {
                onRefresh(result.ok ? "Movimiento registrado." : result.message)
              }
            }}>Guardar movimiento</button>
          </>
        )}
        {canAuthorizeFinance(user) && (
          <div className="cashier-refund">
            <h3>Reembolso autorizado</h3>
            <select value={refundId} onChange={(event) => setRefundId(event.target.value)}>
              <option value="">Selecciona pago</option>
              {payments.map((payment) => <option value={payment.id} key={payment.id}>Q{payment.totalAmount.toFixed(2)} · {payment.waiterName}</option>)}
            </select>
            <button type="button" className="danger" onClick={() => {
              const payment = payments.find((item) => item.id === refundId)
              const amount = window.prompt("Monto a reembolsar:", payment?.totalAmount || "")
              const reason = window.prompt("Motivo del reembolso:")
              if (!amount || !reason) return
              const result = refundPayment(refundId, amount, "cash", reason, user)
              onRefresh(result.ok ? "Reembolso registrado." : result.message)
            }}>Registrar reembolso</button>
          </div>
        )}
      </article>
      <article className="cashier-panel">
        <h2>Autorizaciones</h2>
        {authorizations.slice(0, 8).map((request) => (
          <div className="cashier-row" key={request.id}>
            <div><strong>{request.type}</strong><span>{request.requestedBy} · {request.status}</span></div>
            {request.status === "pending" && canAuthorizeFinance(user) && <button type="button" onClick={() => { approveAuthorization(request.id, user); onRefresh("Autorización aprobada.") }}>Aprobar</button>}
          </div>
        ))}
        {!authorizations.length && <Empty text="No hay solicitudes de autorización." />}
        <h2>Últimos movimientos</h2>
        {movements.slice(0, 10).map((movement) => <div className="cashier-row" key={movement.id}><span>{movement.type} · {movement.method}</span><strong>Q{movement.amount.toFixed(2)}</strong></div>)}
      </article>
    </div>
  )
}

function Closures({ sessions }) {
  return (
    <article className="cashier-panel">
      <h2>Cierres de caja</h2>
      {sessions.filter((session) => session.status === "closed").map((session) => (
        <div className="cashier-row" key={session.id}>
          <div><strong>{session.cashierName}</strong><span>{formatDate(session.closedAt)} · Esperado Q{Number(session.expectedCash).toFixed(2)} · Contado Q{Number(session.countedCash || 0).toFixed(2)}</span></div>
          <strong className={session.difference === 0 ? "" : "negative"}>Diferencia Q{Number(session.difference).toFixed(2)}</strong>
        </div>
      ))}
      {!sessions.some((session) => session.status === "closed") && <Empty text="No hay cierres registrados." />}
    </article>
  )
}

function CashReports({ payments, tips, movements, sessions, audit }) {
  const completed = payments.filter((payment) => payment.status === "completed")
  const methodRows = PAYMENT_METHODS.map((method) => ({
    label: method.label,
    amount: completed.flatMap((payment) => payment.methods).filter((entry) => entry.method === method.id).reduce((sum, entry) => sum + entry.amount, 0)
  })).filter((row) => row.amount > 0)
  const waiterTips = Object.entries(tips.reduce((result, tip) => ({ ...result, [tip.waiterId]: (result[tip.waiterId] || 0) + tip.amount }), {}))
  return (
    <div className="cashier-columns">
      <article className="cashier-panel"><h2>Ventas por método</h2>{methodRows.map((row) => <div className="cashier-row" key={row.label}><span>{row.label}</span><strong>Q{row.amount.toFixed(2)}</strong></div>)}{!methodRows.length && <Empty text="Sin pagos registrados." />}</article>
      <article className="cashier-panel"><h2>Propinas por mesero</h2>{waiterTips.map(([waiter, amount]) => <div className="cashier-row" key={waiter}><span>{waiter}</span><strong>Q{amount.toFixed(2)}</strong></div>)}{!waiterTips.length && <Empty text="Sin propinas registradas." />}</article>
      <article className="cashier-panel"><h2>Resumen de control</h2><div className="cashier-row"><span>Pagos completados</span><strong>{completed.length}</strong></div><div className="cashier-row"><span>Reembolsos</span><strong>{movements.filter((movement) => movement.type === "refund").length}</strong></div><div className="cashier-row"><span>Cierres con diferencia</span><strong>{sessions.filter((session) => session.status === "closed" && session.difference !== 0).length}</strong></div></article>
      <article className="cashier-panel"><h2>Auditoría reciente</h2>{audit.slice(0, 12).map((entry) => <div className="cashier-row" key={entry.id}><div><strong>{entry.action}</strong><span>{entry.performedBy} · {formatDate(entry.createdAt)}</span></div><span>{entry.entityType}</span></div>)}{!audit.length && <Empty text="Sin eventos auditables." />}</article>
    </div>
  )
}

function Summary({ summary }) {
  return <div className="cashier-summary"><p>Efectivo <strong>Q{summary.cashSales.toFixed(2)}</strong></p><p>Tarjeta <strong>Q{summary.cardSales.toFixed(2)}</strong></p><p>Transferencia / QR <strong>Q{(summary.transferSales + summary.qrSales).toFixed(2)}</strong></p><p>Esperado <strong>Q{summary.expectedCash.toFixed(2)}</strong></p></div>
}

function Empty({ text }) {
  return <p className="cashier-empty">{text}</p>
}

function loadStore() {
  return { preBills: loadPreBills(), payments: loadPayments(), splitBills: loadSplitBills(), sessions: loadCashSessions(), movements: loadCashMovements(), tips: loadTipRecords(), authorizations: loadAuthorizationRequests(), audit: loadFinancialAudit() }
}

function waitingMinutes(bill) {
  return Math.max(0, Math.floor((Date.now() - new Date(bill.sentAt || bill.createdAt).getTime()) / 60000))
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString() : "-"
}

function showReceipt(payment) {
  const methods = payment.methods.map((method) => `${PAYMENT_METHODS.find((entry) => entry.id === method.method)?.label || method.method}: Q${method.amount.toFixed(2)}`).join("\n")
  window.alert(`RECIBO DE PAGO\nTotal: Q${payment.totalAmount.toFixed(2)}\nPropina: Q${payment.tipAmount.toFixed(2)}\n${methods}\nVuelto: Q${payment.changeGiven.toFixed(2)}`)
}

export default Cashier
