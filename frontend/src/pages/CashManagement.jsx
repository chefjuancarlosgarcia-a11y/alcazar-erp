import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import FinanceIntegrationPanel from "../components/FinanceIntegrationPanel"
import { useAuth } from "../context/AuthContext"
import {
  cashSummary,
  closeCashSession,
  createCashMovement,
  getCashMovements,
  getCashRegisters,
  getCashSessions,
  getOpenCashSession,
  openCashSession
} from "../services/cashService"
import { listFinanceBankAccounts } from "../services/financeService"
import "./CashManagement.css"

const CASH_ROLES = ["admin", "gerente_general", "supervisor", "cajero", "caja"]
const SUPERVISOR_ROLES = ["admin", "gerente_general", "supervisor"]
const MOVEMENT_TYPES = [
  { type: "deposit", label: "Registrar ingreso", amount: true, reason: true },
  { type: "withdrawal", label: "Registrar retiro", amount: true, reason: true, supervisorOnly: true },
  { type: "sale_cash", label: "Venta efectivo manual", amount: true, reason: false },
  { type: "refund", label: "Registrar devolucion", amount: true, reason: true },
  { type: "manual_open", label: "Apertura manual de gaveta", amount: false, reason: true, supervisorOnly: true }
]

const MOVEMENT_LABELS = {
  sale_cash: "Venta efectivo",
  withdrawal: "Retiro",
  deposit: "Ingreso",
  refund: "Devolucion",
  adjustment: "Ajuste",
  manual_open: "Apertura manual",
  shift_open: "Apertura",
  shift_close: "Cierre"
}

function CashManagement() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const highlightedSessionId = searchParams.get("session") || ""
  const canAccessCash = CASH_ROLES.includes(user?.role)
  const canSuperviseCash = SUPERVISOR_ROLES.includes(user?.role)
  const [registers, setRegisters] = useState([])
  const [selectedRegisterId, setSelectedRegisterId] = useState("")
  const [session, setSession] = useState(null)
  const [sessions, setSessions] = useState([])
  const [movements, setMovements] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [openingForm, setOpeningForm] = useState({ amount: "500", notes: "" })
  const [movementForm, setMovementForm] = useState(null)
  const [closeForm, setCloseForm] = useState({ counted: "", notes: "" })
  const summary = useMemo(() => cashSummary(session, movements), [movements, session])
  const countedValue = Number(closeForm.counted || 0)
  const previewDifference = countedValue - summary.expected

  const loadData = useCallback(async () => {
    if (!canAccessCash) return
    setLoading(true)
    setError("")
    const registerResult = await getCashRegisters()
    if (registerResult.error) {
      setError("No se pudieron cargar las cajas. Verifica la migracion 045.")
      setLoading(false)
      return
    }
    const nextRegisters = registerResult.data || []
    const registerId = selectedRegisterId || nextRegisters[0]?.id || ""
    setRegisters(nextRegisters)
    setSelectedRegisterId(registerId)

    const [sessionResult, sessionsResult] = await Promise.all([
      getOpenCashSession(registerId),
      getCashSessions(20)
    ])
    if (sessionResult.error) setError(sessionResult.error.message || "No se pudo cargar la sesion abierta.")
    const openSession = sessionResult.data || null
    setSession(openSession)
    setSessions(sessionsResult.data || [])

    const movementResult = await getCashMovements(openSession?.id)
    setMovements(movementResult.data || [])

    const bankResult = await listFinanceBankAccounts()
    if (!bankResult.error) setBankAccounts(bankResult.data || [])

    setLoading(false)
  }, [canAccessCash, selectedRegisterId])

  useEffect(() => {
    loadData()
  }, [loadData])

  if (!canAccessCash) {
    return <section className="cash-page"><article className="cash-panel"><h1>Caja</h1><p>No tienes acceso al modulo de Caja.</p></article></section>
  }

  async function handleOpenCash(event) {
    event.preventDefault()
    const result = await openCashSession(selectedRegisterId, openingForm.amount, openingForm.notes)
    if (result.error) {
      setError(result.error.message || "No se pudo abrir caja.")
      return
    }
    setMessage("Caja abierta correctamente.")
    setOpeningForm({ amount: "500", notes: "" })
    await loadData()
  }

  async function handleMovement(event) {
    event.preventDefault()
    if (!movementForm || !session) return
    const config = MOVEMENT_TYPES.find((item) => item.type === movementForm.type)
    if (config?.supervisorOnly && !canSuperviseCash) {
      setError("Este movimiento requiere supervisor, Admin o Gerente General.")
      return
    }
    if (config?.reason && !movementForm.reason.trim()) {
      setError("El motivo es obligatorio.")
      return
    }
    const result = await createCashMovement({
      sessionId: session.id,
      movementType: movementForm.type,
      amount: config?.amount ? movementForm.amount : 0,
      reason: movementForm.reason,
      reference: movementForm.reference
    })
    if (result.error) {
      setError(result.error.message || "No se pudo registrar el movimiento.")
      return
    }
    setMovementForm(null)
    setMessage("Movimiento registrado.")
    await loadData()
  }

  async function handleCloseCash(event) {
    event.preventDefault()
    if (!session) return
    if (!window.confirm("Confirmar cierre de caja? Esta accion deja la sesion cerrada.")) return
    const result = await closeCashSession(session.id, closeForm.counted, closeForm.notes)
    if (result.error) {
      setError(result.error.message || "No se pudo cerrar caja.")
      return
    }
    setMessage("Caja cerrada correctamente.")
    setCloseForm({ counted: "", notes: "" })
    await loadData()
  }

  const register = registers.find((item) => item.id === selectedRegisterId)
  const openedBy = session?.opener?.full_name || session?.opener?.username || "Sin responsable"

  return (
    <section className="cash-page">
      <header className="cash-header">
        <div>
          <p className="cash-eyebrow">Control financiero</p>
          <h1>Caja</h1>
          <p className="cash-muted">Apertura, movimientos, retiros, cierre y auditoria basica.</p>
        </div>
        <div className={`cash-state ${session ? "open" : "closed"}`}>{session ? "Abierta" : "Cerrada"}</div>
      </header>

      {message && <div className="cash-success">{message}</div>}
      {error && <div className="cash-error">{error}</div>}

      <div className="cash-toolbar">
        <label>Caja<select value={selectedRegisterId} onChange={(event) => setSelectedRegisterId(event.target.value)}>{registers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <button type="button" className="cash-secondary" onClick={loadData}>Actualizar</button>
      </div>

      <section className="cash-status-grid">
        <Metric label="Caja" value={register?.name || "Caja Principal"} />
        <Metric label="Abierta por" value={session ? openedBy : "-"} />
        <Metric label="Hora apertura" value={session ? formatDate(session.opened_at) : "-"} />
        <Metric label="Fondo inicial" value={money(summary.opening)} />
        <Metric label="Efectivo esperado" value={money(summary.expected)} highlight />
      </section>

      {loading ? <div className="cash-panel">Cargando caja...</div> : !session ? (
        <form className="cash-panel cash-open-form" onSubmit={handleOpenCash}>
          <div><h2>Abrir caja</h2><p className="cash-muted">No hay caja abierta para este registro.</p></div>
          <label>Fondo inicial<input type="number" min="0" step="0.01" value={openingForm.amount} onChange={(event) => setOpeningForm({ ...openingForm, amount: event.target.value })} required /></label>
          <label>Notas<textarea value={openingForm.notes} onChange={(event) => setOpeningForm({ ...openingForm, notes: event.target.value })} /></label>
          <button className="cash-primary">Abrir caja</button>
        </form>
      ) : (
        <div className="cash-main-grid">
          <section className="cash-panel">
            <h2>Movimientos</h2>
            <div className="cash-actions">
              {MOVEMENT_TYPES.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  className={item.supervisorOnly && !canSuperviseCash ? "disabled" : ""}
                  disabled={item.supervisorOnly && !canSuperviseCash}
                  onClick={() => setMovementForm({ type: item.type, amount: "", reason: "", reference: "" })}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {movementForm && (
              <form className="cash-movement-form" onSubmit={handleMovement}>
                <h3>{MOVEMENT_LABELS[movementForm.type]}</h3>
                {MOVEMENT_TYPES.find((item) => item.type === movementForm.type)?.amount && <label>Monto<input type="number" min="0.01" step="0.01" value={movementForm.amount} onChange={(event) => setMovementForm({ ...movementForm, amount: event.target.value })} required /></label>}
                <label>Motivo<textarea value={movementForm.reason} onChange={(event) => setMovementForm({ ...movementForm, reason: event.target.value })} required={MOVEMENT_TYPES.find((item) => item.type === movementForm.type)?.reason} /></label>
                <label>Referencia<input value={movementForm.reference} onChange={(event) => setMovementForm({ ...movementForm, reference: event.target.value })} /></label>
                <div className="cash-form-actions"><button type="button" className="cash-secondary" onClick={() => setMovementForm(null)}>Cancelar</button><button className="cash-primary">Guardar movimiento</button></div>
              </form>
            )}
          </section>

          <section className="cash-panel">
            <h2>Cierre / Arqueo</h2>
            <div className="cash-breakdown">
              <Row label="Fondo inicial" value={money(summary.opening)} />
              <Row label="Ventas efectivo" value={money(summary.sales)} />
              <Row label="Ingresos" value={money(summary.deposits)} />
              <Row label="Retiros" value={`-${money(summary.withdrawals)}`} />
              <Row label="Devoluciones" value={`-${money(summary.refunds)}`} />
              <Row label="Efectivo esperado" value={money(summary.expected)} strong />
            </div>
            <form className="cash-close-form" onSubmit={handleCloseCash}>
              <label>Efectivo contado<input type="number" min="0" step="0.01" value={closeForm.counted} onChange={(event) => setCloseForm({ ...closeForm, counted: event.target.value })} required /></label>
              <label>Notas<textarea value={closeForm.notes} onChange={(event) => setCloseForm({ ...closeForm, notes: event.target.value })} /></label>
              <div className={`cash-difference ${differenceClass(previewDifference)}`}>{differenceLabel(previewDifference)} · {money(Math.abs(previewDifference))}</div>
              <button className="cash-danger">Cerrar caja</button>
            </form>
          </section>
        </div>
      )}

      <section className="cash-panel">
        <h2>Bitacora</h2>
        <div className="cash-table-wrap">
          <table>
            <thead><tr><th>Hora</th><th>Tipo</th><th>Usuario</th><th>Monto</th><th>Motivo</th><th>Referencia</th></tr></thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td>{formatDate(movement.created_at)}</td>
                  <td>{MOVEMENT_LABELS[movement.movement_type] || movement.movement_type}</td>
                  <td>{movement.creator?.full_name || movement.creator?.username || "-"}</td>
                  <td>{money(movement.amount)}</td>
                  <td>{movement.reason || "-"}</td>
                  <td>{movement.reference || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!movements.length && <p className="cash-empty">Sin movimientos para la sesion abierta.</p>}
        </div>
      </section>

      <section className="cash-panel">
        <h2>Ultimos cierres</h2>
        <div className="cash-session-list">
          {sessions.filter((item) => item.status !== "open").slice(0, 6).map((item) => (
            <article key={item.id} className={highlightedSessionId === item.id ? "cash-session-card is-highlighted" : "cash-session-card"}>
              <strong>{item.register?.name || "Caja"}</strong>
              <span>{formatDate(item.opened_at)} · {item.status === "closed" ? "Cerrada" : item.status}</span>
              <b>{money(item.counted_cash || 0)} contado · diferencia {money(item.difference || 0)}</b>
              {item.status === "closed" ? (
                <FinanceIntegrationPanel
                  sourceModule="cash_closing"
                  sourceId={item.id}
                  bankAccounts={bankAccounts}
                  cashDepositDefaults={{ amount: item.counted_cash || 0, method: "cash" }}
                />
              ) : null}
            </article>
          ))}
          {!sessions.filter((item) => item.status !== "open").length && <p className="cash-empty">Aun no hay cierres registrados.</p>}
        </div>
      </section>
    </section>
  )
}

function Metric({ label, value, highlight = false }) {
  return <article className={highlight ? "highlight" : ""}><span>{label}</span><strong>{value}</strong></article>
}

function Row({ label, value, strong = false }) {
  return <p className={strong ? "strong" : ""}><span>{label}</span><b>{value}</b></p>
}

function money(value) {
  return `Q${Number(value || 0).toFixed(2)}`
}

function formatDate(value) {
  if (!value) return "-"
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Guatemala"
  }).format(new Date(value))
}

function differenceClass(value) {
  if (Number(value) > 0) return "positive"
  if (Number(value) < 0) return "negative"
  return "zero"
}

function differenceLabel(value) {
  if (Number(value) > 0) return "Sobrante"
  if (Number(value) < 0) return "Faltante"
  return "Caja cuadrada"
}

export default CashManagement
