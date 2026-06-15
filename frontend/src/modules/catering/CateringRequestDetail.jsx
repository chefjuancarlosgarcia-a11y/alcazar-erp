import { useEffect, useState } from "react"
import {
  assignCateringLead,
  getCateringActivityLog,
  getCateringRequestDetail,
  getCateringRequestQuotes,
  updateCateringFollowup,
  updateCateringRequestStatus
} from "./cateringService"
import CateringActivityTimeline from "./CateringActivityTimeline"
import CateringQuoteModal from "./CateringQuoteModal"
import CateringRequestQuotes from "./CateringRequestQuotes"
import CateringSlaBadge from "./CateringSlaBadge"
import {
  CONVERSION_STATUS_LABELS,
  CONVERSION_STATUS_OPTIONS,
  DEFAULT_WIN_PROBABILITY,
  OPERATIONAL_STATUS_LABELS,
  OPERATIONAL_STATUS_OPTIONS,
  conversionStatusClass,
  effectiveWinProbability,
  followUpAlertClass,
  formatDate,
  formatDateTime,
  formatMoney,
  formatProducts,
  formatTime,
  getFollowUpAlert,
  leadSourceLabel,
  weightedPipelineValue
} from "./cateringUtils"

const EMPTY_FOLLOWUP = {
  followUpDate: "",
  notes: "",
  conversionStatus: "",
  estimatedValue: "",
  winProbability: ""
}

export default function CateringRequestDetail({
  requestId,
  profiles,
  profilesById,
  openQuoteOnLoad = false,
  onQuoteOpened,
  onClose,
  onUpdated
}) {
  const [request, setRequest] = useState(null)
  const [activities, setActivities] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingActivity, setLoadingActivity] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [operationalStatus, setOperationalStatus] = useState("new")
  const [statusNotes, setStatusNotes] = useState("")
  const [assigneeId, setAssigneeId] = useState("")
  const [followup, setFollowup] = useState(EMPTY_FOLLOWUP)
  const [showFollowup, setShowFollowup] = useState(false)
  const [quotesSummary, setQuotesSummary] = useState({ count: 0, latest: null, quotes: [] })
  const [loadingQuotes, setLoadingQuotes] = useState(true)
  const [quoteModalOpen, setQuoteModalOpen] = useState(false)
  const [activeQuoteId, setActiveQuoteId] = useState(null)
  const [quoteAutoOpened, setQuoteAutoOpened] = useState(false)

  useEffect(() => {
    loadDetail()
    setQuoteAutoOpened(false)
  }, [requestId])

  useEffect(() => {
    if (!openQuoteOnLoad || !request || quoteAutoOpened) return
    setActiveQuoteId(null)
    setQuoteModalOpen(true)
    setQuoteAutoOpened(true)
    onQuoteOpened?.()
  }, [openQuoteOnLoad, request, quoteAutoOpened, onQuoteOpened])

  async function loadDetail() {
    if (!requestId) return
    setLoading(true)
    setLoadingActivity(true)
    setLoadingQuotes(true)
    setError("")
    const [detailResult, activityResult, quotesResult] = await Promise.all([
      getCateringRequestDetail(requestId),
      getCateringActivityLog(requestId),
      getCateringRequestQuotes(requestId)
    ])
    if (detailResult.error) {
      setError(detailResult.error)
      setRequest(null)
    } else {
      setRequest(detailResult.data)
      setOperationalStatus(detailResult.data?.status || "new")
      setAssigneeId(detailResult.data?.assigned_to || "")
      setFollowup({
        followUpDate: detailResult.data?.follow_up_date ? String(detailResult.data.follow_up_date).slice(0, 10) : "",
        notes: "",
        conversionStatus: detailResult.data?.conversion_status || "",
        estimatedValue: detailResult.data?.estimated_value ?? "",
        winProbability: detailResult.data?.win_probability ?? effectiveWinProbability(detailResult.data)
      })
    }
    if (!activityResult.error) setActivities(activityResult.data || [])
    if (!quotesResult.error) {
      setQuotesSummary({
        count: quotesResult.data?.count ?? 0,
        latest: quotesResult.data?.latest ?? null,
        quotes: quotesResult.data?.quotes ?? []
      })
    }
    setLoading(false)
    setLoadingActivity(false)
    setLoadingQuotes(false)
  }

  async function reloadQuotesAndActivity() {
    const [activityResult, quotesResult, detailResult] = await Promise.all([
      getCateringActivityLog(requestId),
      getCateringRequestQuotes(requestId),
      getCateringRequestDetail(requestId)
    ])
    if (!activityResult.error) setActivities(activityResult.data || [])
    if (!quotesResult.error) {
      setQuotesSummary({
        count: quotesResult.data?.count ?? 0,
        latest: quotesResult.data?.latest ?? null,
        quotes: quotesResult.data?.quotes ?? []
      })
    }
    if (!detailResult.error && detailResult.data) {
      setRequest(detailResult.data)
      onUpdated?.(detailResult.data)
    }
  }

  function handleOpenCreateQuote() {
    setActiveQuoteId(null)
    setQuoteModalOpen(true)
  }

  function handleOpenQuote(quoteId) {
    setActiveQuoteId(quoteId)
    setQuoteModalOpen(true)
  }

  function handleQuoteSaved() {
    reloadQuotesAndActivity()
  }

  async function handleStatusUpdate() {
    setSaving(true)
    setMessage("")
    setError("")
    const result = await updateCateringRequestStatus(requestId, operationalStatus, statusNotes || null)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setRequest(result.data)
    setStatusNotes("")
    setMessage("Estado operativo actualizado.")
    onUpdated?.(result.data)
    loadDetail()
  }

  async function handleAssign() {
    if (!assigneeId) {
      setError("Selecciona un responsable.")
      return
    }
    setSaving(true)
    setMessage("")
    setError("")
    const result = await assignCateringLead(requestId, assigneeId)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setRequest(result.data)
    setMessage("Responsable asignado.")
    onUpdated?.(result.data)
    loadDetail()
  }

  async function handleFollowupSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage("")
    setError("")
    const result = await updateCateringFollowup(requestId, {
      followUpDate: followup.followUpDate || null,
      notes: followup.notes || null,
      conversionStatus: followup.conversionStatus || null,
      estimatedValue: followup.estimatedValue,
      winProbability: followup.winProbability
    })
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    setRequest(result.data)
    setFollowup((current) => ({ ...current, notes: "" }))
    setShowFollowup(false)
    setMessage("Seguimiento registrado.")
    onUpdated?.(result.data)
    loadDetail()
  }

  if (loading) {
    return (
      <aside className="catering-panel">
        <p className="catering-empty">Cargando detalle...</p>
      </aside>
    )
  }

  if (!request) {
    return (
      <aside className="catering-panel">
        <button type="button" className="ghost catering-detail-back" onClick={onClose}>Cerrar</button>
        <p className="catering-message error">{error || "Solicitud no encontrada."}</p>
      </aside>
    )
  }

  const assignee = request.assigned_to ? profilesById[request.assigned_to] : null
  const followUpAlert = getFollowUpAlert(request)
  const probability = effectiveWinProbability(request)
  const weightedValue = weightedPipelineValue(request)

  return (
    <aside className="catering-panel catering-detail-panel">
      <div className="catering-detail-back catering-actions">
        <button type="button" className="ghost" onClick={onClose}>Cerrar detalle</button>
      </div>

      <header className="catering-detail-grid">
        <div>
          <p>Solicitud #{String(request.id).slice(0, 8)}</p>
          <h2>{request.customer_name}</h2>
          <span>Ingreso: {formatDateTime(request.created_at)}</span>
        </div>
        <div className="catering-detail-badges">
          <span className={conversionStatusClass(request.conversion_status)}>
            {CONVERSION_STATUS_LABELS[request.conversion_status] || request.conversion_status}
          </span>
          <CateringSlaBadge request={request} />
          {followUpAlert ? (
            <span className={followUpAlertClass(followUpAlert.level)}>{followUpAlert.label}</span>
          ) : null}
        </div>
      </header>

      <div className="catering-detail-grid">
        <section className="catering-detail-section">
          <h4>Cliente</h4>
          <dl className="catering-detail-list">
            <div><dt>Nombre</dt><dd>{request.customer_name || "—"}</dd></div>
            <div><dt>Telefono</dt><dd>{request.customer_phone || "—"}</dd></div>
            <div><dt>Email</dt><dd>{request.customer_email || "—"}</dd></div>
            <div><dt>Origen</dt><dd>{leadSourceLabel(request.lead_source)}</dd></div>
            {request.source === "manual" ? (
              <div><dt>Captura</dt><dd>Manual (ERP)</dd></div>
            ) : null}
          </dl>
        </section>

        <section className="catering-detail-section">
          <h4>Evento</h4>
          <dl className="catering-detail-list">
            <div><dt>Tipo</dt><dd>{request.event_type || "—"}</dd></div>
            <div><dt>Fecha</dt><dd>{formatDate(request.event_date)}</dd></div>
            <div><dt>Hora</dt><dd>{formatTime(request.event_time)}</dd></div>
            <div><dt>Ubicacion</dt><dd>{request.event_location || "—"}</dd></div>
            <div><dt>Invitados</dt><dd>{request.guest_count ?? "—"}</dd></div>
          </dl>
        </section>

        <section className="catering-detail-section">
          <h4>Valor comercial</h4>
          <dl className="catering-detail-list">
            <div><dt>Valor estimado</dt><dd>{formatMoney(request.estimated_value)}</dd></div>
            <div><dt>Probabilidad</dt><dd>{probability}%</dd></div>
            <div><dt>Pipeline ponderado</dt><dd>{formatMoney(weightedValue)}</dd></div>
            <div><dt>Default por etapa</dt><dd>{DEFAULT_WIN_PROBABILITY[request.conversion_status] ?? 10}%</dd></div>
          </dl>
        </section>

        <section className="catering-detail-section">
          <h4>Productos solicitados</h4>
          {Array.isArray(request.products_requested) && request.products_requested.length ? (
            <ul className="catering-products-list">
              {request.products_requested.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="catering-empty">{formatProducts(request.products_requested)}</p>
          )}
        </section>

        <section className="catering-detail-section">
          <h4>Notas</h4>
          <p className="catering-notes">{request.notes || "Sin notas."}</p>
        </section>

        <section className="catering-detail-section">
          <h4>Estados y seguimiento</h4>
          <dl className="catering-detail-list">
            <div><dt>Estado operativo</dt><dd>{OPERATIONAL_STATUS_LABELS[request.status] || request.status}</dd></div>
            <div><dt>Estado comercial</dt><dd>{CONVERSION_STATUS_LABELS[request.conversion_status] || request.conversion_status}</dd></div>
            <div><dt>Responsable</dt><dd>{assignee?.full_name || assignee?.username || "Sin asignar"}</dd></div>
            <div><dt>Proximo seguimiento</dt><dd>{formatDate(request.follow_up_date)}</dd></div>
            <div><dt>Ultimo contacto</dt><dd>{formatDateTime(request.last_contact_at)}</dd></div>
          </dl>
        </section>
      </div>

      <section className="catering-detail-section">
        <h4>Linea de tiempo comercial</h4>
        <CateringActivityTimeline activities={activities} loading={loadingActivity} />
      </section>

      <CateringRequestQuotes
        summary={quotesSummary}
        quotes={quotesSummary.quotes}
        loading={loadingQuotes}
        onCreateQuote={handleOpenCreateQuote}
        onOpenQuote={handleOpenQuote}
      />

      {message ? <p className="catering-message success">{message}</p> : null}
      {error ? <p className="catering-message error">{error}</p> : null}

      <section className="catering-detail-section">
        <h4>Cambiar estado operativo</h4>
        <div className="catering-form-grid">
          <label>
            Estado
            <select value={operationalStatus} onChange={(event) => setOperationalStatus(event.target.value)}>
              {OPERATIONAL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Nota (opcional)
            <textarea
              value={statusNotes}
              onChange={(event) => setStatusNotes(event.target.value)}
              rows={3}
              placeholder="Comentario interno sobre el cambio de estado"
            />
          </label>
        </div>
        <div className="catering-actions">
          <button type="button" className="primary" disabled={saving} onClick={handleStatusUpdate}>
            {saving ? "Guardando..." : "Actualizar estado"}
          </button>
        </div>
      </section>

      <section className="catering-detail-section">
        <h4>Asignar responsable</h4>
        <div className="catering-form-grid">
          <label>
            Responsable comercial
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
              <option value="">Seleccionar colaborador</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name || profile.username || profile.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="catering-actions">
          <button type="button" className="primary" disabled={saving} onClick={handleAssign}>
            {saving ? "Guardando..." : "Asignar responsable"}
          </button>
        </div>
      </section>

      <section className="catering-detail-section">
        <div className="catering-actions">
          <button type="button" className="ghost" onClick={() => setShowFollowup((current) => !current)}>
            {showFollowup ? "Ocultar seguimiento" : "Registrar seguimiento"}
          </button>
        </div>
        {showFollowup ? (
          <form className="catering-form-grid" onSubmit={handleFollowupSubmit}>
            <label>
              Proximo seguimiento
              <input
                type="date"
                value={followup.followUpDate}
                onChange={(event) => setFollowup((current) => ({ ...current, followUpDate: event.target.value }))}
              />
            </label>
            <label>
              Estado comercial
              <select
                value={followup.conversionStatus}
                onChange={(event) => setFollowup((current) => ({ ...current, conversionStatus: event.target.value }))}
              >
                <option value="">Mantener actual</option>
                {CONVERSION_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              Valor estimado (Q)
              <input
                type="number"
                min="0"
                step="0.01"
                value={followup.estimatedValue}
                onChange={(event) => setFollowup((current) => ({ ...current, estimatedValue: event.target.value }))}
              />
            </label>
            <label>
              Probabilidad (%)
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={followup.winProbability}
                onChange={(event) => setFollowup((current) => ({ ...current, winProbability: event.target.value }))}
              />
            </label>
            <label>
              Notas de seguimiento
              <textarea
                value={followup.notes}
                onChange={(event) => setFollowup((current) => ({ ...current, notes: event.target.value }))}
                rows={4}
                placeholder="Resumen del contacto comercial"
              />
            </label>
            <div className="catering-actions">
              <button type="submit" className="primary" disabled={saving}>
                {saving ? "Guardando..." : "Guardar seguimiento"}
              </button>
            </div>
          </form>
        ) : null}
      </section>

      <CateringQuoteModal
        open={quoteModalOpen}
        request={request}
        quoteId={activeQuoteId}
        onClose={() => setQuoteModalOpen(false)}
        onSaved={handleQuoteSaved}
      />
    </aside>
  )
}
