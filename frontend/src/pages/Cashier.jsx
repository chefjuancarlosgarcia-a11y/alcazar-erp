import { useEffect, useRef, useState } from "react"
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
  registerSplitPaymentLocal,
  returnPreBillToWaiter,
  syncSupabaseFullPayment,
  savePreBillBillingCustomer
} from "../utils/cashier"
import { getPosOrderPaymentStatus, getOrderWithItems, linkOrderBillingCustomer } from "../services/posOrdersService"
import { printFinalCheck } from "../services/posPrintService"
import { queueReceiptPrintJob } from "../services/printingService"
import SplitPaymentModal from "../components/SplitPaymentModal"
import CashierBillingCustomer from "../components/CashierBillingCustomer"
import useOperationalAlerts from "../hooks/useOperationalAlerts"
import OperationalAlertToast from "../components/OperationalAlertToast"
import {
  DEFAULT_BILLING_CUSTOMER,
  billingCustomerFromDelivery,
  billingCustomerFromSupabase,
  normalizeBillingCustomer,
  orderWithBillingCustomer
} from "../utils/billingCustomer"
import "./Cashier.css"

const RECEIPT_FLAG_RAW = import.meta.env.VITE_ENABLE_RECEIPT_PRINTING
const RECEIPT_PRINTING_ENABLED = String(RECEIPT_FLAG_RAW ?? "false").toLowerCase() === "true"
const POST_PAYMENT_PRINT_TIMEOUT_MS = 5000
const RECEIPT_PRINT_NOTICE = "Cobro registrado. Recibo térmico pendiente/no enviado."

function cashierDebug(...args) {
  if (import.meta.env.DEV) console.log(...args)
}

function cashierWarn(...args) {
  if (import.meta.env.DEV) console.warn(...args)
}

function logReceiptFlagState(context = "module") {
  cashierDebug("[Receipt Flag] value", RECEIPT_FLAG_RAW === undefined ? "undefined" : String(RECEIPT_FLAG_RAW))
  cashierDebug("[Receipt Flag] enabled", RECEIPT_PRINTING_ENABLED, { context, mode: import.meta.env.MODE })
}

function withPostPaymentTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(`Timeout en ${label}`)), POST_PAYMENT_PRINT_TIMEOUT_MS)
    })
  ])
}

function schedulePostPaymentPrints({
  orderForPrint,
  payment,
  billingCustomer,
  comandaNo,
  billOrderId,
  cashierName,
  onPrintNotice
}) {
  void withPostPaymentTimeout(
    printFinalCheck(orderForPrint, { ...payment, billingCustomer }),
    "PDF cuenta final"
  ).then((printed) => {
    if (printed === false) {
      cashierWarn("[Cashier] print skipped/failed pdf")
    } else {
      cashierDebug("[Cashier] print queued pdf")
    }
  }).catch((error) => {
    cashierWarn("[Cashier] print skipped/failed pdf", error?.message || error)
  })

  if (!RECEIPT_PRINTING_ENABLED) {
    logReceiptFlagState("schedulePostPaymentPrints skipped")
    cashierDebug("[Cashier] print skipped receipt (disabled)")
    return
  }

  cashierDebug("[Receipt Print] attempting queueReceiptPrintJob", {
    orderId: billOrderId,
    comandaNo,
    paymentId: payment?.id
  })

  void withPostPaymentTimeout(
    queueReceiptPrintJob({
      order: orderForPrint,
      payment: { ...payment, billingCustomer },
      options: {
        restaurantName: "EL GRAN ALCÁZAR",
        cashierName,
        orderId: billOrderId,
        orderLabel: comandaNo,
        receiptNumber: payment?.paymentNumber || comandaNo,
        billingCustomer
      }
    }),
    "recibo térmico"
  ).then((receiptResult) => {
    cashierDebug("[Receipt Print] result", receiptResult)
    if (!receiptResult?.ok) {
      cashierWarn("[Receipt Print] error", receiptResult?.error?.message || receiptResult)
      onPrintNotice?.(RECEIPT_PRINT_NOTICE)
      return
    }
    cashierDebug("[Cashier] print queued receipt", { jobId: receiptResult.data?.id })
  }).catch((error) => {
    cashierWarn("[Receipt Print] error", error?.message || error)
    onPrintNotice?.(RECEIPT_PRINT_NOTICE)
  })
}

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
  const requests = store.preBills.filter((bill) => ["sent_to_cashier", "partially_paid"].includes(bill.status))
  const selectedBill = selectedBillId
    ? store.preBills.find((bill) => String(bill.id) === String(selectedBillId) && bill.status !== "paid")
    : requests[0]

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
    cashierDebug("[Cashier] openCharge", { preBillId: bill?.id, tableName: bill?.tableName })
    if (!session) {
      refresh("Abre la caja en Dashboard Caja antes de cobrar mesas.")
      setTab("dashboard")
      return
    }
    try {
      const result = beginPayment(bill.id, user)
      if (!result.ok) {
        refresh(`Error en Caja > Solicitudes de cobro > Cobrar: ${result.message || "No se pudo iniciar el cobro."}`)
        return
      }
      setSelectedBillId(String(bill.id))
      setTab("charge")
      setFeedback("")
      setStore(loadStore())
    } catch (error) {
      console.error("[Cashier] openCharge failed", error)
      refresh("No se pudo abrir el cobro. Intenta de nuevo.")
    }
  }

  function selectTab(nextTab) {
    if (nextTab === "charge") {
      if (!session) {
        refresh("Abre la caja en Dashboard Caja antes de cobrar mesas.")
        setTab("dashboard")
        return
      }
      if (!selectedBillId && requests.length) {
        openCharge(requests[0])
        return
      }
    }
    setTab(nextTab)
  }

  function completeCharge(message = "Pago completado correctamente.") {
    setSelectedBillId("")
    setTab("dashboard")
    refresh(message)
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
          <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => selectTab(id)}>
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
      {tab === "charge" && <ChargePanel key={selectedBill?.id || "empty"} bill={selectedBill} splitBills={store.splitBills} session={session} requests={visibleStore.authorizations} user={user} onRefresh={refresh} onPaymentComplete={completeCharge} />}
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
      <div className="cashier-metrics erp-kpi-grid">{cards.map(([label, value]) => <article className="erp-kpi-card" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
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
            {bill.salesChannel === "delivery" && <DeliveryBillSummary bill={bill} compact />}
            <small>{billItemSummary(bill)}</small>
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
      <div><strong>{bill.tableName}</strong><span>{bill.salesChannel === "delivery" ? `${bill.delivery?.phone || "Sin telefono"} · ${bill.delivery?.paymentMethod || "Pago pendiente"}` : bill.waiterName} · {waitingMinutes(bill)} min esperando</span></div>
      <strong>Q{Number(bill.total).toFixed(2)}</strong>
      <button type="button" onClick={onCharge}>Cobrar</button>
    </div>
  )
}

function ChargePanel({ bill, splitBills, session, requests, user, onRefresh, onPaymentComplete }) {
  const submitLockRef = useRef(false)
  const [tip, setTip] = useState(bill ? String(bill.tipSuggested || 0) : "0")
  const [discount, setDiscount] = useState("0")
  const [methods, setMethods] = useState([{ method: "cash", amount: bill ? String(bill.total) : "", reference: "" }])
  const [splitMode, setSplitMode] = useState("")
  const [splitConfig, setSplitConfig] = useState("2")
  const [splitId, setSplitId] = useState("")
  const [message, setMessage] = useState("")
  const [processingPayment, setProcessingPayment] = useState(false)
  const [paymentMode, setPaymentMode] = useState("full")
  const [showSplitModal, setShowSplitModal] = useState(false)
  const [paymentStatus, setPaymentStatus] = useState(null)
  const [billingCustomer, setBillingCustomer] = useState(DEFAULT_BILLING_CUSTOMER)
  const isSupabaseBill = Boolean(bill?.source === "supabase_pos" && bill?.orderId)
  const splitBill = splitBills.find((split) => String(split.preBillId) === String(bill?.id))
  const split = splitBill?.splits.find((part) => part.id === splitId)
  const productSubtotal = Number(split?.subtotal ?? (paymentStatus ? paymentStatus.balance_due : null) ?? bill?.subtotal ?? 0)
  const total = Math.max(0, productSubtotal - Number(discount || 0) + Number(tip || 0))
  const paid = methods.reduce((sum, method) => sum + Number(method.amount || 0), 0)
  const change = Math.max(0, paid - total)
  const shortfall = Math.max(0, total - paid)
  const paymentBalanced = shortfall < 0.01
  const approvedAuthorization = requests.find((request) => request.status === "approved" && !request.usedAt && request.requestedById === (user.id || user.username))
  const comandaNo = bill?.orderId
    ? String(bill.orderId).slice(0, 8).toUpperCase()
    : String(bill?.id || "").slice(0, 8).toUpperCase()
  const billTimestamp = bill?.sentAt || bill?.createdAt

  useEffect(() => {
    submitLockRef.current = false
    setProcessingPayment(false)
    setPaymentMode("full")
    setShowSplitModal(false)
    setMessage("")
  }, [bill?.id])

  function applyTipPercent(percent) {
    setTip((productSubtotal * (percent / 100)).toFixed(2))
  }

  function fillRemainingAmount(index) {
    const otherPaid = methods.reduce((sum, method, itemIndex) => (
      itemIndex === index ? sum : sum + Number(method.amount || 0)
    ), 0)
    const remaining = Math.max(0, total - otherPaid)
    setMethods((current) => current.map((entry, itemIndex) => (
      itemIndex === index ? { ...entry, amount: remaining.toFixed(2) } : entry
    )))
  }

  useEffect(() => {
    if (!isSupabaseBill) {
      setPaymentStatus(null)
      return
    }
    let cancelled = false
    getPosOrderPaymentStatus(bill.orderId).then(({ data }) => {
      if (!cancelled) setPaymentStatus(data)
    })
    return () => { cancelled = true }
  }, [bill?.orderId, isSupabaseBill, showSplitModal])

  useEffect(() => {
    if (!bill) return
    const baseTotal = Number(paymentStatus?.balance_due ?? bill.total ?? 0)
    setMethods((current) => {
      if (current.length === 1 && (!current[0].amount || Number(current[0].amount) === Number(bill.total))) {
        return [{ ...current[0], amount: String(baseTotal) }]
      }
      return current
    })
  }, [bill?.id, bill?.total, paymentStatus?.balance_due])

  useEffect(() => {
    if (!bill) {
      setBillingCustomer(DEFAULT_BILLING_CUSTOMER)
      return undefined
    }
    let cancelled = false
    async function hydrateBillingCustomer() {
      if (bill.billingCustomer) {
        if (!cancelled) setBillingCustomer(normalizeBillingCustomer(bill.billingCustomer))
        return
      }
      if (bill.salesChannel === "delivery" && bill.delivery) {
        if (!cancelled) setBillingCustomer(billingCustomerFromDelivery(bill.delivery))
        return
      }
      if (bill.source === "supabase_pos" && bill.orderId) {
        const { data } = await getOrderWithItems(bill.orderId)
        if (cancelled) return
        if (data?.customer) {
          setBillingCustomer(billingCustomerFromSupabase(data.customer, data.customer_address))
          return
        }
      }
      setBillingCustomer(DEFAULT_BILLING_CUSTOMER)
    }
    hydrateBillingCustomer()
    return () => { cancelled = true }
  }, [bill?.id])

  if (!bill) return <article className="cashier-panel"><Empty text="Selecciona una solicitud de cobro." /></article>
  if (!session) return <article className="cashier-panel"><h2>Cobrar mesa</h2><Empty text="Abre una caja desde Dashboard Caja antes de cobrar." /></article>

  function addMethod() {
    setMethods((current) => [...current, { method: "card", amount: "", reference: "" }])
  }

  async function refreshPaymentStatus() {
    if (!isSupabaseBill) return
    const { data } = await getPosOrderPaymentStatus(bill.orderId)
    setPaymentStatus(data)
  }

  async function handleSplitPaid(result) {
    const local = registerSplitPaymentLocal({
      preBillId: bill.id,
      amount: result.subtotal ?? result.selectedLines?.reduce((sum, line) => sum + Number(line.line_total || 0), 0),
      methods: result.methods || [],
      user,
      orderFullyPaid: result.orderFullyPaid,
      paidByLabel: result.paid_by_label || result.paidByLabel || "",
      paymentNumber: result.payment_number
    })
    if (!local.ok) {
      setMessage(`Subcuenta registrada en sistema, pero caja local fallo: ${local.message}`)
      return
    }
    setShowSplitModal(false)
    if (result.orderFullyPaid) {
      cashierDebug("[Cashier] payment complete flow", { source: "handleSplitPaid" })
      onPaymentComplete("Subcuenta cobrada. Cuenta cerrada. Saldo restante: Q0.00")
      const orderForPrint = orderWithBillingCustomer(bill, normalizeBillingCustomer(billingCustomer))
      schedulePostPaymentPrints({
        orderForPrint,
        payment: {
          ...local.payment,
          methods: result.methods || local.payment?.methods || [],
          paymentNumber: result.payment_number || local.payment?.paymentNumber
        },
        billingCustomer: normalizeBillingCustomer(billingCustomer),
        comandaNo,
        billOrderId: bill.orderId,
        cashierName: user?.name || local.payment?.cashierName,
        onPrintNotice: (notice) => onRefresh(notice)
      })
      return
    }
    await refreshPaymentStatus()
    setMessage(`Subcuenta cobrada. Saldo restante: Q${Number(result.balanceDue || 0).toFixed(2)}`)
    onRefresh("")
  }

  async function submit() {
    cashierDebug("[Cashier] submit entered")
    if (submitLockRef.current) {
      cashierWarn("[Cashier] submit ignored: already in progress")
      return
    }
    submitLockRef.current = true
    setProcessingPayment(true)
    setMessage("Procesando pago...")
    try {
      const normalizedBilling = normalizeBillingCustomer(billingCustomer)
      savePreBillBillingCustomer(bill.id, normalizedBilling)

      if (isSupabaseBill && normalizedBilling.customerId) {
        const linkResult = await linkOrderBillingCustomer(bill.orderId, {
          customerId: normalizedBilling.customerId,
          customerAddressId: normalizedBilling.addressId || null
        })
        if (linkResult.error) {
          cashierWarn("[Cashier] No se pudo vincular cliente a la orden.", linkResult.message || linkResult.error)
        }
      }

      if (isSupabaseBill) {
        let syncResult
        try {
          syncResult = await withPostPaymentTimeout(
            syncSupabaseFullPayment(bill.orderId, methods, "Cuenta completa"),
            "sync Supabase"
          )
        } catch (error) {
          setMessage(`Error en Caja > Cobrar mesa > Supabase: ${error.message || "Tiempo de espera agotado."}`)
          return
        }
        if (!syncResult.ok) {
          setMessage(`Error en Caja > Cobrar mesa > Supabase: ${syncResult.message}`)
          return
        }
      }

      const result = confirmPayment({
        preBillId: bill.id,
        splitId,
        tipAmount: Number(tip),
        discountAmount: Number(discount),
        methods,
        authorizationId: approvedAuthorization?.id || "",
        authorizedBy: approvedAuthorization?.approvedBy || "",
        productSubtotalOverride: isSupabaseBill ? productSubtotal : undefined,
        billingCustomer: normalizedBilling
      }, user)
      cashierDebug("[Cashier] confirmPayment result", {
        ok: result.ok,
        allPaid: result.allPaid,
        requiresAuthorization: result.requiresAuthorization
      })
      if (result.requiresAuthorization) {
        createAuthorizationRequest("Descuento o cortesía", result.message, Number(discount), user)
        setMessage("Caja > Cobrar mesa > Confirmar pago: solicitud de autorización enviada. Espera aprobación para cobrar.")
        onRefresh("")
        return
      }

      if (!result.ok) {
        setMessage(`Error en Caja > Cobrar mesa > Confirmar pago: ${result.message || "No se pudo registrar el pago."}`)
        return
      }
      if (!result.allPaid) {
        setMessage("Pago parcial registrado. Hay partes pendientes.")
        onRefresh("Pago parcial registrado. Hay partes pendientes.")
        return
      }

      cashierDebug("[Cashier] payment complete flow", { source: "submit" })
      onPaymentComplete("Pago completado correctamente. Orden liberada.")
      schedulePostPaymentPrints({
        orderForPrint: orderWithBillingCustomer(bill, normalizedBilling),
        payment: result.payment,
        billingCustomer: normalizedBilling,
        comandaNo,
        billOrderId: bill.orderId,
        cashierName: user?.name || result.payment.cashierName,
        onPrintNotice: (notice) => onRefresh(notice)
      })
    } catch (error) {
      console.error("[Cashier] Error confirmando pago.", error)
      setMessage(`Error en Caja > Cobrar mesa > Confirmar pago: ${error.message || "No se pudo completar la transacción."}`)
    } finally {
      submitLockRef.current = false
      cashierDebug("[Cashier] submit finally")
      setProcessingPayment(false)
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
    <div className="cashier-charge-terminal">
      <header className="cashier-charge-hero">
        <div className="cashier-charge-hero-main">
          <small>Cuenta activa</small>
          <strong>{bill.tableName}</strong>
          <span>
            {bill.salesChannel === "delivery" ? "Delivery" : bill.salesChannel === "takeout" ? "Para llevar" : "Salón"}
            {" · "}
            Mesero {bill.waiterName || "—"}
            {" · "}
            {waitingMinutes(bill)} min en caja
          </span>
        </div>
        <div className="cashier-charge-hero-meta">
          <div><small>Comanda</small><strong>{comandaNo || "—"}</strong></div>
          <div><small>Fecha</small><strong>{formatDate(billTimestamp)}</strong></div>
          {bill.peopleCount ? <div><small>Personas</small><strong>{bill.peopleCount}</strong></div> : null}
        </div>
        <div className="cashier-charge-hero-total">
          <small>Total a cobrar</small>
          <strong>Q{total.toFixed(2)}</strong>
        </div>
      </header>

      <div className="cashier-charge-main">
        <section className="cashier-panel cashier-charge-order">
          {bill.salesChannel === "delivery" && <DeliveryBillSummary bill={bill} />}
          <div className="cashier-items-table-wrap">
            <table className="cashier-items-table">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th>Desc.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {bill.items.map((item) => {
                  const lineTotal = Number(item.precio) * Number(item.cantidad)
                  const lineDiscount = Number(item.descuento || item.discount || 0)
                  return (
                    <tr key={item.lineId || item.id}>
                      <td data-label="Producto"><span className="cashier-item-qty">{item.cantidad}×</span> {item.nombre}</td>
                      <td data-label="Precio">Q{Number(item.precio).toFixed(2)}</td>
                      <td data-label="Desc.">{lineDiscount > 0 ? `-Q${lineDiscount.toFixed(2)}` : "—"}</td>
                      <td data-label="Total"><strong>Q{lineTotal.toFixed(2)}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="cashier-totals-block">
            {paymentStatus && Number(paymentStatus.amount_paid) > 0 && (
              <p className="cashier-partial-status">
                Ya pagado <strong>Q{Number(paymentStatus.amount_paid).toFixed(2)}</strong>
                {" · "}
                Saldo restante <strong>Q{Number(paymentStatus.balance_due).toFixed(2)}</strong>
              </p>
            )}
            <div className="cashier-totals-grid">
              <div className="cashier-totals-row">
                <span>Subtotal</span>
                <strong>Q{productSubtotal.toFixed(2)}</strong>
              </div>
              <label className="cashier-totals-row editable">
                <span>Descuento</span>
                <input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(event.target.value)} />
              </label>
              <label className="cashier-totals-row editable">
                <span>Propina</span>
                <input type="number" min="0" step="0.01" value={tip} onChange={(event) => setTip(event.target.value)} />
              </label>
              <div className="cashier-tip-quick">
                <button type="button" className="secondary" onClick={() => applyTipPercent(10)}>10%</button>
                <button type="button" className="secondary" onClick={() => applyTipPercent(15)}>15%</button>
                <button type="button" className="secondary" onClick={() => applyTipPercent(20)}>20%</button>
              </div>
            </div>
            <div className="cashier-grand-total">
              <span>Total final</span>
              <strong>Q{total.toFixed(2)}</strong>
            </div>
          </div>
        </section>

        <section className="cashier-panel cashier-charge-payment">
          <CashierBillingCustomer
            value={billingCustomer}
            onChange={setBillingCustomer}
            showAddress={bill.salesChannel === "delivery" || Boolean(billingCustomer.address)}
          />
          <h2>Pago</h2>
          {isSupabaseBill && (
            <div className="cashier-payment-mode">
              <button type="button" className={paymentMode === "full" ? "active" : ""} onClick={() => setPaymentMode("full")}>Pagar cuenta completa</button>
              <button type="button" className={paymentMode === "split" ? "active" : ""} onClick={() => { setPaymentMode("split"); setShowSplitModal(true) }}>Pagar por separado</button>
            </div>
          )}
          {paymentMode === "split" && isSupabaseBill && !showSplitModal && (
            <>
              <p className="cashier-split-hint">Modo subcuenta activo. Abre la división o vuelve al pago completo.</p>
              <button type="button" className="secondary" onClick={() => setPaymentMode("full")}>Volver a pagar cuenta completa</button>
              <button type="button" className="secondary" onClick={() => setShowSplitModal(true)}>Abrir división por productos</button>
            </>
          )}
          {(!isSupabaseBill || paymentMode === "full") && (
            <>
              {splitBill && (
                <label className="cashier-field">Parte a pagar
                  <select value={splitId} onChange={(event) => setSplitId(event.target.value)}>
                    <option value="">Cuenta completa</option>
                    {splitBill.splits.map((part) => (
                      <option key={part.id} disabled={part.paid} value={part.id}>
                        {part.name} · Q{part.total.toFixed(2)} {part.paid ? "(pagada)" : ""}
                      </option>
                    ))}
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
                  <button type="button" className="secondary cashier-fill-amount" onClick={() => fillRemainingAmount(index)} title="Completar monto faltante">
                    Total
                  </button>
                </div>
              ))}
              <button type="button" className="secondary" onClick={addMethod}>+ Pago mixto</button>

              <div className="cashier-reconciliation">
                <div className="cashier-reconciliation-row">
                  <span>Recibido</span>
                  <strong>Q{paid.toFixed(2)}</strong>
                </div>
                <div className="cashier-reconciliation-row">
                  <span>Cambio</span>
                  <strong>Q{change.toFixed(2)}</strong>
                </div>
                <div className={`cashier-reconciliation-row${shortfall >= 0.01 ? " is-short" : " is-balanced"}`}>
                  <span>{shortfall >= 0.01 ? "Faltan" : "Diferencia"}</span>
                  <strong>{shortfall >= 0.01 ? `-Q${shortfall.toFixed(2)}` : "Q0.00"}</strong>
                </div>
                <div className="cashier-reconciliation-row highlight">
                  <span>Total a cobrar</span>
                  <strong>Q{total.toFixed(2)}</strong>
                </div>
              </div>

              {approvedAuthorization && <div className="cashier-approved">Autorización aprobada por {approvedAuthorization.approvedBy}</div>}
              {message && <div className="cashier-feedback">{message}</div>}
              {!paymentBalanced && (
                <p className="cashier-payment-warning">El monto recibido no cubre el total. Completa el pago antes de confirmar.</p>
              )}
              <button
                type="button"
                className="cashier-confirm-pay"
                disabled={processingPayment || !paymentBalanced}
                onClick={submit}
              >
                {processingPayment ? "Procesando pago..." : `Confirmar pago · Q${total.toFixed(2)}`}
              </button>
            </>
          )}
        </section>
      </div>

      <details className="cashier-charge-split-panel">
        <summary>Dividir cuenta (partes iguales o personalizado)</summary>
        <div className="cashier-charge-split-body">
          <select value={splitMode} onChange={(event) => setSplitMode(event.target.value)}>
            <option value="">Selecciona opción</option>
            <option value="products">Por productos (usa el botón arriba si la orden es Supabase)</option>
            <option value="equal">Partes iguales</option>
            <option value="custom">Monto personalizado</option>
          </select>
          {splitMode === "equal" && <input type="number" min="2" value={splitConfig} onChange={(event) => setSplitConfig(event.target.value)} placeholder="Personas" />}
          {splitMode === "custom" && <input value={splitConfig} onChange={(event) => setSplitConfig(event.target.value)} placeholder="Ej: 100, 150.50, 80" />}
          {splitMode && splitMode !== "products" && <button type="button" className="secondary" onClick={buildSplit}>Crear división</button>}
          {splitBill?.splits.map((part) => (
            <div className="cashier-row" key={part.id}>
              <span>{part.name}</span>
              <strong>Q{part.total.toFixed(2)} · {part.paid ? "Pagada" : "Pendiente"}</strong>
            </div>
          ))}
        </div>
      </details>

      <footer className="cashier-charge-footer">
        <div><strong>{user?.name || user?.email || "Cajero"}</strong><span>{session.cashierName ? `Turno · ${session.cashierName}` : "Caja activa"}</span></div>
        <div><strong>{bill.tableName}</strong><span>Comanda {comandaNo}</span></div>
        <div className="cashier-charge-footer-time">{new Date().toLocaleString()}</div>
      </footer>

      {showSplitModal && isSupabaseBill && (
        <SplitPaymentModal
          bill={bill}
          user={user}
          onClose={() => {
            setShowSplitModal(false)
            setPaymentMode("full")
          }}
          onPaid={handleSplitPaid}
        />
      )}
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

function DeliveryBillSummary({ bill, compact = false }) {
  const delivery = bill.delivery || {}
  return (
    <div className={compact ? "cashier-delivery-summary compact" : "cashier-delivery-summary"}>
      <span><strong>Cliente</strong>{delivery.customerName || "-"}</span>
      <span><strong>Telefono</strong>{delivery.phone || delivery.whatsapp || "-"}</span>
      <span><strong>Direccion</strong>{delivery.address || "-"}</span>
      {!compact && delivery.reference && <span><strong>Referencia</strong>{delivery.reference}</span>}
      {!compact && delivery.mapsLink && <span><strong>Maps</strong>{delivery.mapsLink}</span>}
      <span><strong>Pago</strong>{delivery.paymentMethod || "-"}</span>
      {!compact && delivery.deliveryNotes && <span><strong>Notas</strong>{delivery.deliveryNotes}</span>}
    </div>
  )
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

function billItemSummary(bill) {
  const items = bill.items || []
  if (!items.length) return "Sin productos"
  const firstItems = items.slice(0, 3).map((item) => `${item.cantidad}x ${item.nombre}`).join(", ")
  return items.length > 3 ? `${firstItems} +${items.length - 3} mas` : firstItems
}

function formatDate(date) {
  return date ? new Date(date).toLocaleString() : "-"
}

function showReceipt(payment) {
  const methods = payment.methods.map((method) => `${PAYMENT_METHODS.find((entry) => entry.id === method.method)?.label || method.method}: Q${method.amount.toFixed(2)}`).join("\n")
  window.alert(`RECIBO DE PAGO\nTotal: Q${payment.totalAmount.toFixed(2)}\nPropina: Q${payment.tipAmount.toFixed(2)}\n${methods}\nVuelto: Q${payment.changeGiven.toFixed(2)}`)
}

export default Cashier
