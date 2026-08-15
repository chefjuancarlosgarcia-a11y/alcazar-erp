import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import FinanceOriginLink from "../../components/FinanceOriginLink"
import { useAuth } from "../../context/AuthContext"
import {
  closeFinanceReconciliation,
  createFinanceBankAccount,
  createFinanceBankTransaction,
  createFinancePayable,
  createFinanceReceivable,
  createOrGetFinanceReconciliation,
  getFinanceCashFlow,
  getFinanceDashboard,
  getFinancePendingIntegrations,
  listFinanceBankAccounts,
  listFinanceBankTransactions,
  listFinancePayables,
  listFinanceReceivables,
  recordFinancePayablePayment,
  recordFinanceReceivableCollection,
  updateFinanceReconciliationItem,
  updateFinanceReconciliationStatement
} from "../../services/financeService"
import { canManageFinance } from "../../utils/financePermissions"
import FinanceChartAccountsTab from "./FinanceChartAccountsTab"
import {
  BANK_TX_TYPES,
  buildFinanceOriginUrl,
  defaultMonthRange,
  emptyBankAccountForm,
  emptyBankTransactionForm,
  emptyPayableForm,
  emptyReceivableForm,
  FINANCE_TABS,
  formatMoney,
  labelFor,
  PAYABLE_STATUS_LABELS,
  PAYMENT_METHODS,
  RECEIVABLE_STATUS_LABELS
} from "./financeUtils"
import "./Finance.css"

function Field({ label, className = "", children }) {
  return (
    <label className={`finance-field ${className}`.trim()}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function statusBadgeClass(status) {
  if (status === "paid" || status === "collected") return "finance-badge--paid"
  if (status === "partial") return "finance-badge--partial"
  if (status === "overdue") return "finance-badge--overdue"
  if (status === "cancelled") return "finance-badge--cancelled"
  return "finance-badge--pending"
}

function KpiCard({ label, value, hint = "" }) {
  return (
    <article className="finance-kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint ? <em>{hint}</em> : null}
    </article>
  )
}

export default function FinanceDashboard() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const canManage = canManageFinance(user)
  const defaultRange = useMemo(() => defaultMonthRange(), [])
  const tab = searchParams.get("tab") || "resumen"

  const [filters, setFilters] = useState({
    startDate: defaultRange.from,
    endDate: defaultRange.to,
    bankAccountId: ""
  })
  const [message, setMessage] = useState({ text: "", tone: "info" })
  const [loading, setLoading] = useState(false)

  const [dashboard, setDashboard] = useState(null)
  const [bankAccounts, setBankAccounts] = useState([])
  const [selectedBankId, setSelectedBankId] = useState("")
  const [bankTransactions, setBankTransactions] = useState([])
  const [payables, setPayables] = useState([])
  const [receivables, setReceivables] = useState([])
  const [cashFlow, setCashFlow] = useState(null)
  const [pendingIntegrations, setPendingIntegrations] = useState(null)
  const [reconciliation, setReconciliation] = useState(null)
  const [reconciliationItems, setReconciliationItems] = useState([])

  const [bankAccountForm, setBankAccountForm] = useState(emptyBankAccountForm())
  const [bankTxForm, setBankTxForm] = useState(emptyBankTransactionForm())
  const [payableForm, setPayableForm] = useState(emptyPayableForm())
  const [receivableForm, setReceivableForm] = useState(emptyReceivableForm())
  const [paymentForm, setPaymentForm] = useState({ payableId: "", amount: "", method: "bank_transfer", bank_account_id: "", reference: "" })
  const [collectionForm, setCollectionForm] = useState({ receivableId: "", amount: "", method: "bank_transfer", bank_account_id: "", reference: "" })
  const [reconForm, setReconForm] = useState({
    bankAccountId: "",
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
    statement_start_balance: "",
    statement_end_balance: ""
  })

  const notify = useCallback((text, tone = "info") => setMessage({ text, tone }), [])

  const setTab = useCallback((nextTab) => {
    setSearchParams({ tab: nextTab })
  }, [setSearchParams])

  const loadBankAccounts = useCallback(async () => {
    const result = await listFinanceBankAccounts()
    if (result.error) {
      notify(result.error, "error")
      return []
    }
    setBankAccounts(result.data)
    setSelectedBankId((current) => current || result.data[0]?.id || "")
    return result.data
  }, [notify])

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    const result = await getFinanceDashboard({
      startDate: filters.startDate,
      endDate: filters.endDate,
      bankAccountId: filters.bankAccountId || null
    })
    setLoading(false)
    if (result.error) notify(result.error, "error")
    else setDashboard(result.data)
  }, [filters, notify])

  const loadBankTransactions = useCallback(async (bankId = selectedBankId) => {
    if (!bankId) return
    const result = await listFinanceBankTransactions(bankId, {
      startDate: filters.startDate,
      endDate: filters.endDate
    })
    if (result.error) notify(result.error, "error")
    else setBankTransactions(result.data)
  }, [filters.endDate, filters.startDate, notify, selectedBankId])

  const loadPayables = useCallback(async () => {
    const result = await listFinancePayables({ startDate: filters.startDate, endDate: filters.endDate })
    if (result.error) notify(result.error, "error")
    else setPayables(result.data)
  }, [filters.endDate, filters.startDate, notify])

  const loadReceivables = useCallback(async () => {
    const result = await listFinanceReceivables({ startDate: filters.startDate, endDate: filters.endDate })
    if (result.error) notify(result.error, "error")
    else setReceivables(result.data)
  }, [filters.endDate, filters.startDate, notify])

  const loadCashFlow = useCallback(async () => {
    const result = await getFinanceCashFlow({ startDate: filters.startDate, endDate: filters.endDate })
    if (result.error) notify(result.error, "error")
    else setCashFlow(result.data)
  }, [filters.endDate, filters.startDate, notify])

  const loadPendingIntegrations = useCallback(async () => {
    const result = await getFinancePendingIntegrations()
    if (result.error) notify(result.error, "error")
    else setPendingIntegrations(result.data)
  }, [notify])

  const refreshTab = useCallback(async () => {
    await loadBankAccounts()
    if (tab === "resumen") {
      await Promise.all([loadDashboard(), loadPendingIntegrations()])
    }
    if (tab === "bancos") await loadBankTransactions()
    if (tab === "pagos") await loadPayables()
    if (tab === "cobros") await loadReceivables()
    if (tab === "flujo") await loadCashFlow()
  }, [loadBankAccounts, loadBankTransactions, loadCashFlow, loadDashboard, loadPayables, loadPendingIntegrations, loadReceivables, tab])

  useEffect(() => {
    refreshTab()
  }, [refreshTab])

  async function handleCreateBankAccount(event) {
    event.preventDefault()
    if (!canManage) return notify("No tienes permiso para crear cuentas bancarias.", "error")
    const result = await createFinanceBankAccount({
      ...bankAccountForm,
      opening_balance: Number(bankAccountForm.opening_balance || 0)
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Cuenta bancaria creada.", "success")
      setBankAccountForm(emptyBankAccountForm())
      await loadBankAccounts()
    }
  }

  async function handleCreateBankTransaction(event) {
    event.preventDefault()
    const result = await createFinanceBankTransaction({
      ...bankTxForm,
      amount: Number(bankTxForm.amount),
      source_module: "manual"
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Movimiento registrado.", "success")
      setBankTxForm(emptyBankTransactionForm(selectedBankId))
      await loadBankAccounts()
      await loadBankTransactions()
    }
  }

  async function handleCreatePayable(event) {
    event.preventDefault()
    const subtotal = Number(payableForm.subtotal || 0)
    const tax = Number(payableForm.tax_amount || 0)
    const result = await createFinancePayable({
      ...payableForm,
      subtotal,
      tax_amount: tax,
      total_amount: Number(payableForm.total_amount || subtotal + tax),
      source_module: "manual"
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Cuenta por pagar creada.", "success")
      setPayableForm(emptyPayableForm())
      await loadPayables()
      await loadDashboard()
    }
  }

  async function handleRecordPayment(event) {
    event.preventDefault()
    if (!paymentForm.payableId) return notify("Selecciona una cuenta por pagar.", "error")
    const result = await recordFinancePayablePayment(paymentForm.payableId, {
      amount: Number(paymentForm.amount),
      method: paymentForm.method,
      bank_account_id: paymentForm.bank_account_id || null,
      reference: paymentForm.reference
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Pago registrado.", "success")
      setPaymentForm({ payableId: "", amount: "", method: "bank_transfer", bank_account_id: "", reference: "" })
      await loadPayables()
      await loadBankAccounts()
      await loadDashboard()
    }
  }

  async function handleCreateReceivable(event) {
    event.preventDefault()
    const subtotal = Number(receivableForm.subtotal || 0)
    const tax = Number(receivableForm.tax_amount || 0)
    const result = await createFinanceReceivable({
      ...receivableForm,
      subtotal,
      tax_amount: tax,
      total_amount: Number(receivableForm.total_amount || subtotal + tax),
      source_module: "manual"
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Cuenta por cobrar creada.", "success")
      setReceivableForm(emptyReceivableForm())
      await loadReceivables()
      await loadDashboard()
    }
  }

  async function handleRecordCollection(event) {
    event.preventDefault()
    if (!collectionForm.receivableId) return notify("Selecciona una cuenta por cobrar.", "error")
    const result = await recordFinanceReceivableCollection(collectionForm.receivableId, {
      amount: Number(collectionForm.amount),
      method: collectionForm.method,
      bank_account_id: collectionForm.bank_account_id || null,
      reference: collectionForm.reference
    })
    if (result.error) notify(result.error, "error")
    else {
      notify("Cobro registrado.", "success")
      setCollectionForm({ receivableId: "", amount: "", method: "bank_transfer", bank_account_id: "", reference: "" })
      await loadReceivables()
      await loadBankAccounts()
      await loadDashboard()
    }
  }

  async function handleLoadReconciliation(event) {
    event.preventDefault()
    if (!reconForm.bankAccountId) return notify("Selecciona una cuenta bancaria.", "error")
    const result = await createOrGetFinanceReconciliation(
      reconForm.bankAccountId,
      Number(reconForm.month),
      Number(reconForm.year)
    )
    if (result.error) notify(result.error, "error")
    else {
      setReconciliation(result.data?.reconciliation || null)
      setReconciliationItems(result.data?.items || [])
      const rec = result.data?.reconciliation
      if (rec) {
        setReconForm((current) => ({
          ...current,
          statement_start_balance: rec.statement_start_balance ?? "",
          statement_end_balance: rec.statement_end_balance ?? ""
        }))
      }
    }
  }

  async function handleSaveReconciliationBalances() {
    if (!reconciliation?.id) return
    const result = await updateFinanceReconciliationStatement(reconciliation.id, {
      statement_start_balance: Number(reconForm.statement_start_balance || 0),
      statement_end_balance: Number(reconForm.statement_end_balance || 0)
    })
    if (result.error) notify(result.error, "error")
    else {
      setReconciliation(result.data)
      notify("Saldos del estado de cuenta guardados.", "success")
    }
  }

  async function toggleReconciliationItem(itemId, checked) {
    const result = await updateFinanceReconciliationItem(itemId, checked)
    if (result.error) notify(result.error, "error")
    else {
      setReconciliation(result.data?.reconciliation || reconciliation)
      setReconciliationItems((items) => items.map((row) => (
        row.item?.id === itemId
          ? { ...row, item: result.data?.item || row.item }
          : row
      )))
    }
  }

  async function handleCloseReconciliation(force = false) {
    if (!reconciliation?.id) return
    const result = await closeFinanceReconciliation(reconciliation.id, force)
    if (result.error) notify(result.error, "error")
    else {
      setReconciliation(result.data)
      notify("Conciliación cerrada.", "success")
    }
  }

  function renderFilters(extra = null) {
    return (
      <div className="finance-filters">
        <input type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
        <input type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
        <select value={filters.bankAccountId} onChange={(e) => setFilters({ ...filters, bankAccountId: e.target.value })}>
          <option value="">Todas las cuentas</option>
          {bankAccounts.map((account) => (
            <option key={account.id} value={account.id}>{account.name}</option>
          ))}
        </select>
        {extra}
        <button type="button" className="tasks-primary" onClick={refreshTab} disabled={loading}>Actualizar</button>
      </div>
    )
  }

  function renderPendingIntegrations() {
    const purchases = pendingIntegrations?.purchases || []
    const catering = pendingIntegrations?.catering || []
    const cashClosings = pendingIntegrations?.cash_closings || []
    const total = (pendingIntegrations?.counts?.purchases || 0)
      + (pendingIntegrations?.counts?.catering || 0)
      + (pendingIntegrations?.counts?.cash_closings || 0)

    if (!total) return null

    return (
      <article className="finance-panel finance-pending-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Pendiente de enviar a Finanzas</h2>
            <p className="tasks-muted">Operaciones del ERP que aún no tienen registro financiero.</p>
          </div>
          <strong className="finance-pending-count">{total}</strong>
        </div>
        <div className="finance-pending-grid">
          {purchases.length ? (
            <section>
              <h3>Compras recibidas</h3>
              <ul>
                {purchases.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <Link to={buildFinanceOriginUrl("purchases", row.id) || "#"}>
                      {row.order_number} · {row.supplier_name || "Proveedor"}
                    </Link>
                    <span>{formatMoney(row.total_amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {catering.length ? (
            <section>
              <h3>Catering ganado</h3>
              <ul>
                {catering.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <Link to={buildFinanceOriginUrl("catering", row.id) || "#"}>
                      {row.customer_name}
                    </Link>
                    <span>{formatMoney(row.estimated_value)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {cashClosings.length ? (
            <section>
              <h3>Cierres de caja</h3>
              <ul>
                {cashClosings.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <Link to={buildFinanceOriginUrl("cash_closing", row.id) || "#"}>
                      {row.register_name || "Caja"}
                    </Link>
                    <span>{formatMoney(row.counted_cash)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </article>
    )
  }

  function renderSummary() {
    return (
      <>
        {renderPendingIntegrations()}
        <article className="finance-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Resumen financiero</h2>
            <p className="tasks-muted">Control operativo del dinero disponible, por cobrar y por pagar.</p>
          </div>
        </div>
        {renderFilters()}
        <div className="finance-kpi-grid">
          <KpiCard label="Dinero disponible" value={formatMoney(dashboard?.available_cash)} />
          <KpiCard label="Dinero por cobrar" value={formatMoney(dashboard?.receivable_balance)} />
          <KpiCard label="Dinero por pagar" value={formatMoney(dashboard?.payable_balance)} />
          <KpiCard label="Flujo neto del periodo" value={formatMoney(dashboard?.net_flow)} />
          <KpiCard label="Cobros del periodo" value={formatMoney(dashboard?.period_collections)} hint="Incluye depósitos bancarios" />
          <KpiCard label="Pagos del periodo" value={formatMoney(dashboard?.period_payments)} hint="Incluye salidas bancarias" />
          <KpiCard label="Facturas vencidas por pagar" value={`${dashboard?.overdue_payables_count || 0} · ${formatMoney(dashboard?.overdue_payables_amount)}`} />
          <KpiCard label="Cuentas vencidas por cobrar" value={`${dashboard?.overdue_receivables_count || 0} · ${formatMoney(dashboard?.overdue_receivables_amount)}`} />
        </div>
      </article>
      </>
    )
  }

  function renderBanks() {
    return (
      <div className="finance-split">
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Cuentas bancarias</h2></div>
          <div className="finance-list">
            {bankAccounts.map((account) => (
              <button
                key={account.id}
                type="button"
                className={selectedBankId === account.id ? "active" : ""}
                onClick={() => {
                  setSelectedBankId(account.id)
                  setBankTxForm(emptyBankTransactionForm(account.id))
                  loadBankTransactions(account.id)
                }}
              >
                <strong>{account.name}</strong>
                <div className="tasks-muted">{account.bank_name} · {account.account_number}</div>
                <div>Saldo: {formatMoney(account.current_balance, account.currency)}</div>
              </button>
            ))}
            {!bankAccounts.length ? <p className="tasks-muted">Sin cuentas bancarias activas.</p> : null}
          </div>
          {canManage ? (
            <form className="finance-form-grid" onSubmit={handleCreateBankAccount}>
              <Field label="Nombre interno" className="finance-field--full"><input value={bankAccountForm.name} onChange={(e) => setBankAccountForm({ ...bankAccountForm, name: e.target.value })} required /></Field>
              <Field label="Banco"><input value={bankAccountForm.bank_name} onChange={(e) => setBankAccountForm({ ...bankAccountForm, bank_name: e.target.value })} /></Field>
              <Field label="Número de cuenta"><input value={bankAccountForm.account_number} onChange={(e) => setBankAccountForm({ ...bankAccountForm, account_number: e.target.value })} /></Field>
              <Field label="Moneda"><input value={bankAccountForm.currency} onChange={(e) => setBankAccountForm({ ...bankAccountForm, currency: e.target.value })} /></Field>
              <Field label="Saldo inicial"><input type="number" step="0.01" value={bankAccountForm.opening_balance} onChange={(e) => setBankAccountForm({ ...bankAccountForm, opening_balance: e.target.value })} /></Field>
              <div className="finance-field finance-field--full"><button type="submit" className="tasks-primary">Crear cuenta</button></div>
            </form>
          ) : null}
        </article>
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Movimientos</h2></div>
          {renderFilters()}
          <form className="finance-form-grid" onSubmit={handleCreateBankTransaction}>
            <Field label="Fecha"><input type="date" value={bankTxForm.transaction_date} onChange={(e) => setBankTxForm({ ...bankTxForm, transaction_date: e.target.value })} /></Field>
            <Field label="Tipo">
              <select value={bankTxForm.type} onChange={(e) => setBankTxForm({ ...bankTxForm, type: e.target.value })}>
                {BANK_TX_TYPES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Dirección">
              <select value={bankTxForm.direction} onChange={(e) => setBankTxForm({ ...bankTxForm, direction: e.target.value })}>
                <option value="in">Entrada</option>
                <option value="out">Salida</option>
              </select>
            </Field>
            <Field label="Monto"><input type="number" min="0.01" step="0.01" value={bankTxForm.amount} onChange={(e) => setBankTxForm({ ...bankTxForm, amount: e.target.value })} required /></Field>
            <Field label="Referencia"><input value={bankTxForm.reference} onChange={(e) => setBankTxForm({ ...bankTxForm, reference: e.target.value })} /></Field>
            <Field label="Descripción" className="finance-field--full"><input value={bankTxForm.description} onChange={(e) => setBankTxForm({ ...bankTxForm, description: e.target.value })} /></Field>
            <div className="finance-field finance-field--full"><button type="submit" className="tasks-primary">Registrar movimiento</button></div>
          </form>
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Descripción</th><th>Entrada</th><th>Salida</th><th>Origen</th></tr></thead>
              <tbody>
                {bankTransactions.map((row) => (
                  <tr key={row.id}>
                    <td>{row.transaction_date}</td>
                    <td>{row.type}</td>
                    <td>{row.description || row.reference || "—"}</td>
                    <td>{row.direction === "in" ? formatMoney(row.amount) : "—"}</td>
                    <td>{row.direction === "out" ? formatMoney(row.amount) : "—"}</td>
                    <td><FinanceOriginLink sourceModule={row.source_module} sourceId={row.source_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    )
  }

  function renderPayables() {
    return (
      <div className="finance-split">
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Nueva cuenta por pagar</h2></div>
          <form className="finance-form-grid" onSubmit={handleCreatePayable}>
            <Field label="Proveedor" className="finance-field--full"><input value={payableForm.supplier_name} onChange={(e) => setPayableForm({ ...payableForm, supplier_name: e.target.value })} required /></Field>
            <Field label="Número de factura"><input value={payableForm.invoice_number} onChange={(e) => setPayableForm({ ...payableForm, invoice_number: e.target.value })} /></Field>
            <Field label="Fecha emisión"><input type="date" value={payableForm.issue_date} onChange={(e) => setPayableForm({ ...payableForm, issue_date: e.target.value })} /></Field>
            <Field label="Fecha vencimiento"><input type="date" value={payableForm.due_date} onChange={(e) => setPayableForm({ ...payableForm, due_date: e.target.value })} /></Field>
            <Field label="Subtotal"><input type="number" step="0.01" value={payableForm.subtotal} onChange={(e) => setPayableForm({ ...payableForm, subtotal: e.target.value })} /></Field>
            <Field label="IVA"><input type="number" step="0.01" value={payableForm.tax_amount} onChange={(e) => setPayableForm({ ...payableForm, tax_amount: e.target.value })} /></Field>
            <Field label="Total"><input type="number" step="0.01" value={payableForm.total_amount} onChange={(e) => setPayableForm({ ...payableForm, total_amount: e.target.value })} /></Field>
            <Field label="Descripción" className="finance-field--full"><textarea value={payableForm.description} onChange={(e) => setPayableForm({ ...payableForm, description: e.target.value })} /></Field>
            <div className="finance-field finance-field--full"><button type="submit" className="tasks-primary">Guardar</button></div>
          </form>
          <form className="finance-form-grid" onSubmit={handleRecordPayment}>
            <h3 className="finance-field--full">Registrar pago</h3>
            <Field label="Cuenta por pagar">
              <select value={paymentForm.payableId} onChange={(e) => setPaymentForm({ ...paymentForm, payableId: e.target.value })}>
                <option value="">Seleccionar...</option>
                {payables.filter((row) => row.balance > 0).map((row) => (
                  <option key={row.id} value={row.id}>{row.supplier_name} · {formatMoney(row.balance)}</option>
                ))}
              </select>
            </Field>
            <Field label="Monto"><input type="number" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} required /></Field>
            <Field label="Método">
              <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                {PAYMENT_METHODS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Cuenta bancaria">
              <select value={paymentForm.bank_account_id} onChange={(e) => setPaymentForm({ ...paymentForm, bank_account_id: e.target.value })}>
                <option value="">Sin movimiento bancario</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </Field>
            <Field label="Referencia"><input value={paymentForm.reference} onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })} /></Field>
            <div className="finance-field finance-field--full"><button type="submit" className="tasks-secondary">Registrar pago</button></div>
          </form>
        </article>
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Cuentas por pagar</h2></div>
          {renderFilters()}
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead><tr><th>Proveedor</th><th>Factura</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Estado</th><th>Origen</th></tr></thead>
              <tbody>
                {payables.map((row) => (
                  <tr key={row.id}>
                    <td>{row.supplier_name}</td>
                    <td>{row.invoice_number || "—"}</td>
                    <td>{row.due_date}</td>
                    <td>{formatMoney(row.total_amount)}</td>
                    <td>{formatMoney(row.balance)}</td>
                    <td><span className={`finance-badge ${statusBadgeClass(row.status)}`}>{labelFor(PAYABLE_STATUS_LABELS, row.status)}</span></td>
                    <td><FinanceOriginLink sourceModule={row.source_module} sourceId={row.source_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    )
  }

  function renderReceivables() {
    return (
      <div className="finance-split">
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Nueva cuenta por cobrar</h2></div>
          <form className="finance-form-grid" onSubmit={handleCreateReceivable}>
            <Field label="Cliente" className="finance-field--full"><input value={receivableForm.customer_name} onChange={(e) => setReceivableForm({ ...receivableForm, customer_name: e.target.value })} required /></Field>
            <Field label="Teléfono"><input value={receivableForm.customer_phone} onChange={(e) => setReceivableForm({ ...receivableForm, customer_phone: e.target.value })} /></Field>
            <Field label="Email"><input type="email" value={receivableForm.customer_email} onChange={(e) => setReceivableForm({ ...receivableForm, customer_email: e.target.value })} /></Field>
            <Field label="Documento"><input value={receivableForm.document_number} onChange={(e) => setReceivableForm({ ...receivableForm, document_number: e.target.value })} /></Field>
            <Field label="Fecha emisión"><input type="date" value={receivableForm.issue_date} onChange={(e) => setReceivableForm({ ...receivableForm, issue_date: e.target.value })} /></Field>
            <Field label="Fecha vencimiento"><input type="date" value={receivableForm.due_date} onChange={(e) => setReceivableForm({ ...receivableForm, due_date: e.target.value })} /></Field>
            <Field label="Subtotal"><input type="number" step="0.01" value={receivableForm.subtotal} onChange={(e) => setReceivableForm({ ...receivableForm, subtotal: e.target.value })} /></Field>
            <Field label="IVA"><input type="number" step="0.01" value={receivableForm.tax_amount} onChange={(e) => setReceivableForm({ ...receivableForm, tax_amount: e.target.value })} /></Field>
            <Field label="Total"><input type="number" step="0.01" value={receivableForm.total_amount} onChange={(e) => setReceivableForm({ ...receivableForm, total_amount: e.target.value })} /></Field>
            <Field label="Descripción" className="finance-field--full"><textarea value={receivableForm.description} onChange={(e) => setReceivableForm({ ...receivableForm, description: e.target.value })} /></Field>
            <div className="finance-field finance-field--full"><button type="submit" className="tasks-primary">Guardar</button></div>
          </form>
          <form className="finance-form-grid" onSubmit={handleRecordCollection}>
            <h3 className="finance-field--full">Registrar cobro</h3>
            <Field label="Cuenta por cobrar">
              <select value={collectionForm.receivableId} onChange={(e) => setCollectionForm({ ...collectionForm, receivableId: e.target.value })}>
                <option value="">Seleccionar...</option>
                {receivables.filter((row) => row.balance > 0).map((row) => (
                  <option key={row.id} value={row.id}>{row.customer_name} · {formatMoney(row.balance)}</option>
                ))}
              </select>
            </Field>
            <Field label="Monto"><input type="number" step="0.01" value={collectionForm.amount} onChange={(e) => setCollectionForm({ ...collectionForm, amount: e.target.value })} required /></Field>
            <Field label="Método">
              <select value={collectionForm.method} onChange={(e) => setCollectionForm({ ...collectionForm, method: e.target.value })}>
                {PAYMENT_METHODS.filter((item) => item.value !== "check").map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Cuenta bancaria">
              <select value={collectionForm.bank_account_id} onChange={(e) => setCollectionForm({ ...collectionForm, bank_account_id: e.target.value })}>
                <option value="">Sin movimiento bancario</option>
                {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </Field>
            <Field label="Referencia"><input value={collectionForm.reference} onChange={(e) => setCollectionForm({ ...collectionForm, reference: e.target.value })} /></Field>
            <div className="finance-field finance-field--full"><button type="submit" className="tasks-secondary">Registrar cobro</button></div>
          </form>
        </article>
        <article className="finance-panel">
          <div className="finance-panel__head"><h2>Cuentas por cobrar</h2></div>
          {renderFilters()}
          <div className="finance-table-wrap">
            <table className="finance-table">
              <thead><tr><th>Cliente</th><th>Documento</th><th>Vence</th><th>Total</th><th>Pendiente</th><th>Estado</th><th>Origen</th></tr></thead>
              <tbody>
                {receivables.map((row) => (
                  <tr key={row.id}>
                    <td>{row.customer_name}</td>
                    <td>{row.document_number || "—"}</td>
                    <td>{row.due_date || "—"}</td>
                    <td>{formatMoney(row.total_amount)}</td>
                    <td>{formatMoney(row.balance)}</td>
                    <td><span className={`finance-badge ${statusBadgeClass(row.status)}`}>{labelFor(RECEIVABLE_STATUS_LABELS, row.status)}</span></td>
                    <td><FinanceOriginLink sourceModule={row.source_module} sourceId={row.source_id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </div>
    )
  }

  function renderCashFlow() {
    const rows = cashFlow?.rows || []
    return (
      <article className="finance-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Flujo de caja</h2>
            <p className="tasks-muted">Entradas, salidas y saldo acumulado estimado por día.</p>
          </div>
        </div>
        {renderFilters()}
        <div className="finance-table-wrap">
          <table className="finance-table">
            <thead><tr><th>Fecha</th><th>Entradas</th><th>Salidas</th><th>Neto</th><th>Saldo acumulado</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.flow_date}>
                  <td>{row.flow_date}</td>
                  <td>{formatMoney(row.inflows)}</td>
                  <td>{formatMoney(row.outflows)}</td>
                  <td>{formatMoney(row.net)}</td>
                  <td>{formatMoney(row.running_balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    )
  }

  function renderReconciliation() {
    return (
      <article className="finance-panel">
        <div className="finance-panel__head">
          <div>
            <h2>Conciliación bancaria</h2>
            <p className="tasks-muted">Compara movimientos del sistema con el saldo del estado de cuenta.</p>
          </div>
        </div>
        <form className="finance-filters" onSubmit={handleLoadReconciliation}>
          <select value={reconForm.bankAccountId} onChange={(e) => setReconForm({ ...reconForm, bankAccountId: e.target.value })} required>
            <option value="">Cuenta bancaria</option>
            {bankAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <input type="number" min="1" max="12" value={reconForm.month} onChange={(e) => setReconForm({ ...reconForm, month: e.target.value })} />
          <input type="number" min="2000" max="2100" value={reconForm.year} onChange={(e) => setReconForm({ ...reconForm, year: e.target.value })} />
          <button type="submit" className="tasks-primary">Cargar periodo</button>
        </form>
        {reconciliation ? (
          <>
            <div className="finance-form-grid">
              <Field label="Saldo inicial estado de cuenta"><input type="number" step="0.01" value={reconForm.statement_start_balance} onChange={(e) => setReconForm({ ...reconForm, statement_start_balance: e.target.value })} /></Field>
              <Field label="Saldo final estado de cuenta"><input type="number" step="0.01" value={reconForm.statement_end_balance} onChange={(e) => setReconForm({ ...reconForm, statement_end_balance: e.target.value })} /></Field>
              <div className="finance-actions finance-field--full">
                <button type="button" className="tasks-secondary" onClick={handleSaveReconciliationBalances}>Guardar saldos</button>
                <button type="button" className="tasks-primary" onClick={() => handleCloseReconciliation(false)} disabled={reconciliation.status === "closed"}>Cerrar conciliación</button>
                {canManage ? (
                  <button type="button" className="tasks-link" onClick={() => handleCloseReconciliation(true)} disabled={reconciliation.status === "closed"}>Cerrar con diferencia (admin)</button>
                ) : null}
              </div>
            </div>
            <div className="finance-kpi-grid">
              <KpiCard label="Saldo calculado" value={formatMoney(reconciliation.system_end_balance)} />
              <KpiCard label="Saldo banco ingresado" value={formatMoney(reconciliation.statement_end_balance)} />
              <KpiCard label="Diferencia de conciliación" value={formatMoney(reconciliation.difference)} />
            </div>
            <div className="finance-table-wrap">
              <table className="finance-table">
                <thead><tr><th>Conciliado</th><th>Fecha</th><th>Descripción</th><th>Entrada</th><th>Salida</th></tr></thead>
                <tbody>
                  {reconciliationItems.map(({ item, transaction }) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(item.is_checked)}
                          disabled={reconciliation.status === "closed"}
                          onChange={(e) => toggleReconciliationItem(item.id, e.target.checked)}
                        />
                      </td>
                      <td>{transaction.transaction_date}</td>
                      <td>{transaction.description || transaction.reference || "—"}</td>
                      <td>{transaction.direction === "in" ? formatMoney(transaction.amount) : "—"}</td>
                      <td>{transaction.direction === "out" ? formatMoney(transaction.amount) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </article>
    )
  }

  return (
    <div className="finance-page">
      <header>
        <h1>Finanzas</h1>
        <p className="tasks-muted">Control financiero operativo conectado al ERP.</p>
      </header>

      <nav className="finance-tabs" aria-label="Secciones de finanzas">
        {FINANCE_TABS.map((item) => (
          <button key={item.key} type="button" className={tab === item.key ? "active" : ""} onClick={() => setTab(item.key)}>
            {item.label}
          </button>
        ))}
      </nav>

      {message.text ? <p className={`finance-message ${message.tone}`}>{message.text}</p> : null}

      {tab === "resumen" && renderSummary()}
      {tab === "bancos" && renderBanks()}
      {tab === "pagos" && renderPayables()}
      {tab === "cobros" && renderReceivables()}
      {tab === "flujo" && renderCashFlow()}
      {tab === "conciliacion" && renderReconciliation()}
      {tab === "catalogo" && <FinanceChartAccountsTab user={user} notify={notify} />}
    </div>
  )
}
