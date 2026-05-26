import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getProductionAreas } from "../services/areasService"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import {
  canAccessKDS,
  canSelectKDSArea,
  getDefaultKDSArea,
  getTicketElapsedMinutes,
  getTicketTimeStatus,
  requestKDSAreaAssignment
} from "../utils/kds"
import { normalizeProductionArea } from "../utils/posProduction"
import {
  formatSupabaseError,
  getProductionTickets,
  updateProductionTicketStatus as updateProductionTicketStatusRemote
} from "../services/productionTicketsService"
import "./Production.css"

const PROBLEM_REASONS = [
  "Sin insumo",
  "Producto mal configurado",
  "Equipo fallando",
  "Nota confusa",
  "Cliente solicitó cambio",
  "Requiere supervisor",
  "Otro"
]

const BOARD_COLUMNS = [
  ["pending", "Nuevas"],
  ["in_production", "Preparando"],
  ["ready", "Listas"],
  ["problem", "Problemas"]
]

const KDS_DEBUG = import.meta.env.DEV

function kdsDebug(label, payload) {
  if (KDS_DEBUG) console.log(`[KDS] ${label}`, payload)
}

function Production() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { areaId: areaParam } = useParams()
  const [areas, setAreas] = useState([])
  const [areasLoading, setAreasLoading] = useState(true)
  const [areasError, setAreasError] = useState("")
  const canSwitchArea = canSelectKDSArea(user)
  const canAuthorize = canSwitchArea
  const [tickets, setTickets] = useState([])
  const [clock, setClock] = useState(0)
  const [problemTicket, setProblemTicket] = useState(null)
  const [problemForm, setProblemForm] = useState({ reason: PROBLEM_REASONS[0], comment: "" })
  const [message, setMessage] = useState("")
  const [realtimeNotice, setRealtimeNotice] = useState("")
  const boardRef = useRef(null)
  const noticeTimerRef = useRef(null)
  const defaultArea = getDefaultKDSArea(user, areas)
  const requestedArea = normalizeProductionArea(areaParam)
  const requestedAreaExists = areas.some((entry) => entry.id === requestedArea)
  const selectedArea = canSwitchArea && requestedAreaExists ? requestedArea : defaultArea

  const refreshTickets = useCallback(async () => {
    if (!selectedArea) return
    try {
      console.log("KDS areaId", selectedArea)
      const { data, error } = await getProductionTickets(selectedArea)
      if (error) {
        setMessage(`Error KDS: ${formatSupabaseError(error)}`)
        return
      }
      console.log("KDS tickets loaded", data || [])
      kdsDebug("query Supabase production_tickets ejecutada", { areaId: selectedArea, tickets: data })
      setTickets(data || [])
    } catch (error) {
      console.error("KDS tickets load error:", error)
      setMessage(`Error KDS: ${error?.message || "No se pudieron actualizar los tickets."}`)
    }
  }, [selectedArea])

  function showRealtimeNotice(text) {
    setRealtimeNotice(text)
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setRealtimeNotice(""), 3500)
  }

  const ticketRealtime = useSupabaseRealtime({
    table: "production_tickets",
    event: "*",
    filter: selectedArea ? `area_id=eq.${selectedArea}` : undefined,
    enabled: Boolean(selectedArea),
    onChange: (payload) => {
      if (payload.eventType === "INSERT") showRealtimeNotice("Nueva comanda recibida")
      refreshTickets()
    }
  })
  const ticketItemsRealtime = useSupabaseRealtime({
    table: "production_ticket_items",
    event: "*",
    enabled: Boolean(selectedArea),
    onChange: refreshTickets
  })
  const realtimeActive = ticketRealtime.isLive && ticketItemsRealtime.isLive

  useEffect(() => {
    let mounted = true
    getProductionAreas().then(({ data, error }) => {
      if (!mounted) return
      if (error) {
        console.error("Supabase KDS areas error:", error)
        setAreasError("No se pudieron cargar las áreas de producción.")
        setAreas([])
      } else {
        kdsDebug("query Supabase de áreas productivas", data)
        setAreas((data || []).map((area) => ({ id: area.id, name: area.name })))
      }
      setAreasLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!selectedArea) return undefined
    kdsDebug("fuente de comandas: Supabase production_tickets", { areaId: selectedArea })
    const initialRefresh = window.setTimeout(refreshTickets, 0)
    const interval = window.setInterval(() => setClock((current) => current + 1), 30000)
    const refreshInterval = window.setInterval(refreshTickets, 5000)
    window.addEventListener("production-tickets-updated", refreshTickets)
    return () => {
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
      window.clearInterval(refreshInterval)
      window.removeEventListener("production-tickets-updated", refreshTickets)
    }
  }, [selectedArea, refreshTickets])

  useEffect(() => () => window.clearTimeout(noticeTimerRef.current), [])

  useEffect(() => {
    kdsDebug("área actual y tickets cargados", {
      areaId: selectedArea,
      tickets: tickets.filter((ticket) => ticket.areaId === selectedArea)
    })
  }, [selectedArea, tickets])

  useEffect(() => {
    if (!canAccessKDS(user) || !selectedArea) return
    if (!areaParam || requestedArea !== selectedArea) {
      navigate(`/production/${selectedArea}`, { replace: true })
    }
  }, [areaParam, navigate, requestedArea, selectedArea, user])

  if (!canAccessKDS(user)) {
    return (
      <section className="kds-page">
        <article className="kds-unassigned">
          <h1>Producción</h1>
          <p>No tienes acceso al módulo de Producción.</p>
        </article>
      </section>
    )
  }

  if (areasLoading) {
    return <section className="kds-page"><article className="kds-unassigned"><h1>Producción</h1><p>Cargando áreas de producción...</p></article></section>
  }

  if (areasError) {
    return <section className="kds-page"><article className="kds-unassigned"><h1>Producción</h1><p>{areasError}</p></article></section>
  }

  if (!selectedArea) {
    return (
      <section className="kds-page">
        <article className="kds-unassigned">
          <h1>Producción</h1>
          <p>No tienes un área de producción asignada.</p>
          <small>Solicita a administración que configure tu área.</small>
          {message && <div className="kds-feedback" role="status">{message}</div>}
          <button
            type="button"
            className="kds-fullscreen"
            onClick={() => {
              requestKDSAreaAssignment(user)
              setMessage("Solicitud enviada a administración.")
            }}
          >
            Contactar administración
          </button>
        </article>
      </section>
    )
  }

  const area = areas.find((entry) => entry.id === selectedArea)
  const visible = tickets.filter((ticket) => ticket.areaId === selectedArea)
  const active = visible.filter((ticket) => !["served", "cancelled"].includes(ticket.status))
  const served = visible.filter((ticket) => ["served", "cancelled"].includes(ticket.status)).slice(0, 20)
  const late = active.filter((ticket) => getTicketTimeStatus(ticket) === "late").length
  const completed = visible.filter((ticket) => ticket.status === "served" && ticket.readyAt && ticket.createdAt)
  const average = completed.length
    ? Math.round(completed.reduce((total, ticket) => total + ((new Date(ticket.readyAt) - new Date(ticket.createdAt)) / 60000), 0) / completed.length)
    : 0

  async function transition(ticketId, status) {
    try {
      const result = await updateProductionTicketStatusRemote(ticketId, status)
      if (result.error) {
        setMessage(`Error KDS: ${formatSupabaseError(result.error)}`)
        return
      }
      await refreshTickets()
      setMessage(status === "ready" ? "Pedido listo para servir." : "")
    } catch (error) {
      console.error("KDS ticket transition error:", error)
      setMessage(`Error KDS: ${error?.message || "No se pudo actualizar el ticket."}`)
    }
  }

  async function reportProblem(event) {
    event.preventDefault()
    if (!problemForm.comment.trim()) return
    try {
      const result = await updateProductionTicketStatusRemote(problemTicket.id, "problem", {
        notes: `${problemForm.reason}: ${problemForm.comment.trim()}`
      })
      if (result.error) {
        setMessage(`Error KDS: ${formatSupabaseError(result.error)}`)
        return
      }
      await refreshTickets()
      setProblemTicket(null)
      setProblemForm({ reason: PROBLEM_REASONS[0], comment: "" })
      setMessage("Problema reportado a supervisión.")
    } catch (error) {
      console.error("KDS problem report error:", error)
      setMessage(`Error KDS: ${error?.message || "No se pudo reportar el problema."}`)
    }
  }

  async function cancelTicket(ticket) {
    const reason = window.prompt("Motivo de la cancelación:")
    if (!reason?.trim()) return
    if (!canAuthorize) {
      setMessage("Solicita la cancelación a supervisión para proteger el inventario.")
      return
    }
    const message = "La cancelación queda registrada. La reversión de inventario debe autorizarse por separado. ¿Confirmar?"
    if (!window.confirm(message)) return
    try {
      const result = await updateProductionTicketStatusRemote(ticket.id, "cancelled", { notes: reason.trim() })
      if (result.error) {
        setMessage(`Error KDS: ${formatSupabaseError(result.error)}`)
        return
      }
      await refreshTickets()
      setMessage("Ticket cancelado. Revisa el inventario si corresponde una reversión.")
    } catch (error) {
      console.error("KDS ticket cancellation error:", error)
      setMessage(`Error KDS: ${error?.message || "No se pudo cancelar el ticket."}`)
    }
  }

  async function enterFullScreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      await boardRef.current?.requestFullscreen?.()
    } catch {
      setMessage("El navegador no permitió activar pantalla completa.")
    }
  }

  return (
    <section className="kds-page" ref={boardRef} data-clock={clock}>
      <header className="kds-header">
        <div>
          <p className="kds-eyebrow">Operación en vivo</p>
          <h1>Producción</h1>
          <p className="kds-muted">Estación: {area?.name || selectedArea} · toca una comanda para avanzar su estado</p>
          <p className="kds-session">{user?.name || user?.username} · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          <span className={`kds-live${realtimeActive ? " connected" : ""}`} title={ticketRealtime.error || ticketItemsRealtime.error || ""}>
            <i />{realtimeActive ? "En vivo" : "Conectando..."}
          </span>
        </div>
        <div className="kds-header-actions">
          {canSwitchArea && (
            <label className="kds-select-label">
              Área
              <select value={selectedArea} onChange={(event) => navigate(`/production/${event.target.value}`)}>
                {areas.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="kds-fullscreen" onClick={refreshTickets}>Actualizar tickets</button>
          <button type="button" className="kds-fullscreen" onClick={enterFullScreen}>Pantalla completa</button>
        </div>
      </header>

      {message && <div className="kds-feedback" role="status">{message}</div>}
      {realtimeNotice && <div className="kds-feedback live-notice" role="status">{realtimeNotice}</div>}

      <div className="kds-metrics">
        <Metric title="Nuevas" value={active.filter((ticket) => ticket.status === "pending").length} tone="new" />
        <Metric title="Preparando" value={active.filter((ticket) => ticket.status === "in_production").length} tone="working" />
        <Metric title="Listas para retirar" value={active.filter((ticket) => ticket.status === "ready").length} tone="ready" />
        <Metric title="Atrasados" value={late} tone={late ? "late" : ""} />
        <Metric title="Tiempo promedio" value={average ? `${average} min` : "-"} />
      </div>

      <div className="kds-board">
        {BOARD_COLUMNS.map(([status, label]) => (
          <section className={`kds-column ${status}`} key={status}>
            <header><h2>{label}</h2><span>{active.filter((ticket) => ticket.status === status).length}</span></header>
            {active.filter((ticket) => ticket.status === status).map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                onTransition={transition}
                onProblem={() => { setProblemTicket(ticket); setProblemForm({ reason: PROBLEM_REASONS[0], comment: "" }) }}
                onCancel={() => cancelTicket(ticket)}
              />
            ))}
            {!active.some((ticket) => ticket.status === status) && <p className="kds-empty">Sin comandas.</p>}
          </section>
        ))}
      </div>

      <section className="kds-history">
        <div className="kds-history-title">
          <h2>Servidos / historial reciente</h2>
          <span>Últimos 20 del área</span>
        </div>
        <div className="kds-history-grid">
          {served.map((ticket) => (
            <article className="kds-history-card" key={ticket.id}>
              <strong>{ticket.tableName}</strong>
              <span>{ticket.areaName} · {ticket.status === "served" ? "Servido" : "Cancelado"}</span>
              <small>{new Date(ticket.servedAt || ticket.updatedAt || ticket.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
            </article>
          ))}
          {!served.length && <p className="kds-empty">No hay tickets servidos recientes.</p>}
        </div>
      </section>

      {problemTicket && (
        <div className="kds-modal-backdrop">
          <form className="kds-modal" onSubmit={reportProblem}>
            <h2>Reportar problema</h2>
            <p>{problemTicket.tableName} · {problemTicket.areaName}</p>
            <label>
              Razón
              <select value={problemForm.reason} onChange={(event) => setProblemForm((current) => ({ ...current, reason: event.target.value }))}>
                {PROBLEM_REASONS.map((reason) => <option value={reason} key={reason}>{reason}</option>)}
              </select>
            </label>
            <label>
              Comentario obligatorio
              <textarea required value={problemForm.comment} onChange={(event) => setProblemForm((current) => ({ ...current, comment: event.target.value }))} />
            </label>
            <div className="kds-modal-actions">
              <button type="button" className="secondary" onClick={() => setProblemTicket(null)}>Cerrar</button>
              <button type="submit">Reportar</button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}

function Metric({ title, value, tone = "" }) {
  return <article className={`kds-metric ${tone}`}><span>{title}</span><strong>{value}</strong></article>
}

function TicketCard({ ticket, onTransition, onProblem, onCancel }) {
  const elapsed = getTicketElapsedMinutes(ticket)
  const timeStatus = getTicketTimeStatus(ticket)
  const entryTime = new Date(ticket.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return (
    <article className={`kds-ticket status-${ticket.status} ${timeStatus} ${ticket.priority === "urgent" ? "urgent" : ""}`}>
      <header>
        <div>
          <small className="kds-ticket-ref">COMANDA {String(ticket.id).slice(0, 6).toUpperCase()}</small>
          <h3>{ticket.tableName}</h3>
          <p>{ticket.waiterName} · {ticket.areaName}</p>
        </div>
        <strong className="kds-time">{elapsed} min</strong>
      </header>
      <div className="kds-badges">
        {ticket.isDemo && <span>Demo</span>}
        <span className={`state ${ticket.status}`}>{statusLabel(ticket.status)}</span>
        <span className={`priority ${ticket.priority}`}>{priorityLabel(ticket.priority)}</span>
        <span>Entrada {entryTime}</span>
      </div>
      <div className="kds-ticket-items">
        {ticket.items.map((item) => (
          <div key={item.id}>
            <strong>{item.quantity} x {item.productName}</strong>
            {item.notes && <p>Nota: {item.notes}</p>}
            {item.modifiers.filter((note) => note !== item.notes).map((modifier) => <p key={modifier}>Modificador: {modifier}</p>)}
          </div>
        ))}
      </div>
      {ticket.problemReason && <div className="kds-problem-detail">{ticket.problemReason}</div>}
      {ticket.cancellationRequested && <div className="kds-request">Cancelación solicitada: {ticket.cancellationReason}</div>}
      <div className="kds-actions">
        {ticket.status === "pending" && <button type="button" onClick={() => onTransition(ticket.id, "in_production")}>Comenzar preparación</button>}
        {ticket.status === "in_production" && <button type="button" onClick={() => onTransition(ticket.id, "ready")}>Pedido listo</button>}
        {ticket.status === "problem" && <button type="button" onClick={() => onTransition(ticket.id, "in_production")}>Reanudar</button>}
        {ticket.status === "ready" && <button type="button" onClick={() => onTransition(ticket.id, "served")}>Retirado / servido</button>}
        {!["served", "cancelled"].includes(ticket.status) && <button type="button" className="warning" onClick={onProblem}>Problema</button>}
        {["pending", "in_production"].includes(ticket.status) && <button type="button" className="danger" onClick={onCancel}>Cancelar</button>}
      </div>
    </article>
  )
}

function statusLabel(status) {
  return ({
    pending: "Pendiente",
    in_production: "En producción",
    ready: "Listo",
    problem: "Problema",
    served: "Servido",
    cancelled: "Cancelado"
  })[status] || status
}

function priorityLabel(priority) {
  return ({ normal: "Normal", high: "Alta", urgent: "Urgente" })[priority] || priority
}

export default Production
