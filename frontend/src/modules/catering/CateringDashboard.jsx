import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import CateringAssigneeRanking from "./CateringAssigneeRanking"
import CateringCommercialKpis from "./CateringCommercialKpis"
import CateringQuoteKpis from "./CateringQuoteKpis"
import CateringPendingFollowups from "./CateringPendingFollowups"
import CateringRequestDetail from "./CateringRequestDetail"
import CateringRequestsList from "./CateringRequestsList"
import {
  getCateringAssignableProfiles,
  getCateringAssigneeRanking,
  getCateringPendingFollowups,
  getCateringPipelineSummary,
  listCateringRequests,
  syncCateringFollowupReminders
} from "./cateringService"
import { CONVERSION_STATUS_OPTIONS, matchesEventDate, matchesSearch } from "./cateringUtils"
import "./Catering.css"

const CATERING_ROLES = [
  "admin",
  "gerente_general",
  "gerente",
  "gerente_operaciones",
  "supervisor",
  "ventas"
]

function currentMonthRange() {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), 1)
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10)
  }
}

export default function CateringDashboard() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get("id") || searchParams.get("requestId") || ""
  const canAccess = CATERING_ROLES.includes(user?.role)

  const defaultRange = useMemo(() => currentMonthRange(), [])
  const [summaryFrom, setSummaryFrom] = useState(defaultRange.from)
  const [summaryTo, setSummaryTo] = useState(defaultRange.to)
  const [summary, setSummary] = useState(null)
  const [ranking, setRanking] = useState(null)
  const [pendingFollowups, setPendingFollowups] = useState([])
  const [requests, setRequests] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loadingSummary, setLoadingSummary] = useState(true)
  const [loadingRanking, setLoadingRanking] = useState(true)
  const [loadingFollowups, setLoadingFollowups] = useState(true)
  const [loadingRequests, setLoadingRequests] = useState(true)
  const [error, setError] = useState("")

  const [conversionStatus, setConversionStatus] = useState("")
  const [assignedTo, setAssignedTo] = useState("")
  const [eventDate, setEventDate] = useState("")
  const [search, setSearch] = useState("")

  const profilesById = useMemo(
    () => Object.fromEntries(profiles.map((profile) => [profile.id, profile])),
    [profiles]
  )

  const filteredRequests = useMemo(
    () => requests.filter((request) => matchesSearch(request, search) && matchesEventDate(request, eventDate)),
    [requests, search, eventDate]
  )

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    const result = await getCateringPipelineSummary(summaryFrom, summaryTo)
    if (result.error) setError(result.error)
    else setSummary(result.data)
    setLoadingSummary(false)
  }, [summaryFrom, summaryTo])

  const loadRanking = useCallback(async () => {
    setLoadingRanking(true)
    const result = await getCateringAssigneeRanking(summaryFrom, summaryTo)
    if (!result.error) setRanking(result.data)
    setLoadingRanking(false)
  }, [summaryFrom, summaryTo])

  const loadFollowups = useCallback(async () => {
    setLoadingFollowups(true)
    await syncCateringFollowupReminders()
    const result = await getCateringPendingFollowups()
    if (!result.error) setPendingFollowups(result.data)
    setLoadingFollowups(false)
  }, [])

  const loadRequests = useCallback(async () => {
    setLoadingRequests(true)
    const result = await listCateringRequests({
      conversionStatus: conversionStatus || null,
      assignedTo: assignedTo || null,
      limit: 300
    })
    if (result.error) setError(result.error)
    else setRequests(result.data)
    setLoadingRequests(false)
  }, [conversionStatus, assignedTo])

  useEffect(() => {
    if (!canAccess) return
    loadSummary()
    loadRanking()
  }, [canAccess, loadSummary, loadRanking])

  useEffect(() => {
    if (!canAccess) return
    loadFollowups()
  }, [canAccess, loadFollowups])

  useEffect(() => {
    if (!canAccess) return
    loadRequests()
  }, [canAccess, loadRequests])

  useEffect(() => {
    if (!canAccess) return
    async function loadProfiles() {
      const result = await getCateringAssignableProfiles()
      if (!result.error) setProfiles(result.data || [])
    }
    loadProfiles()
  }, [canAccess])

  function handleSelectRequest(id) {
    setSearchParams({ id })
  }

  function handleCloseDetail() {
    setSearchParams({})
  }

  function handleUpdated(updatedRequest) {
    setRequests((current) => current.map((item) => (item.id === updatedRequest.id ? updatedRequest : item)))
    loadSummary()
    loadRanking()
    loadFollowups()
  }

  if (!canAccess) {
    return (
      <section className="catering-page erp-page-shell">
        <article className="catering-panel">
          <h1>Catering</h1>
          <p className="catering-empty">No tienes permiso para consultar solicitudes de catering.</p>
        </article>
      </section>
    )
  }

  return (
    <section className="catering-page erp-page-shell">
      <header className="catering-header erp-module-header">
        <div>
          <p>Ventas</p>
          <h1>Catering CRM</h1>
          <span>Gestion comercial de leads desde Wix con SLA, pipeline y seguimiento.</span>
        </div>
      </header>

      <section className="catering-panel">
        <div className="catering-summary-range">
          <label>
            Resumen desde
            <input type="date" value={summaryFrom} onChange={(event) => setSummaryFrom(event.target.value)} />
          </label>
          <label>
            Hasta
            <input type="date" value={summaryTo} onChange={(event) => setSummaryTo(event.target.value)} />
          </label>
          <button
            type="button"
            className="primary"
            onClick={() => {
              loadSummary()
              loadRanking()
            }}
            disabled={loadingSummary}
          >
            {loadingSummary ? "Actualizando..." : "Actualizar KPIs"}
          </button>
        </div>
      </section>

      <CateringCommercialKpis summary={summary} loading={loadingSummary} />

      <section className="catering-panel">
        <h2>Cotizaciones</h2>
        <CateringQuoteKpis summary={summary} loading={loadingSummary} />
      </section>

      <div className="catering-widgets-grid">
        <CateringPendingFollowups
          items={pendingFollowups}
          loading={loadingFollowups}
          onSelect={handleSelectRequest}
        />
        <CateringAssigneeRanking ranking={ranking} loading={loadingRanking} />
      </div>

      <section className="catering-panel catering-filters">
        <h2>Filtros</h2>
        <div className="catering-filters-row">
          <label>
            Estado comercial
            <select value={conversionStatus} onChange={(event) => setConversionStatus(event.target.value)}>
              <option value="">Todos</option>
              {CONVERSION_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha del evento
            <input type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
          </label>
          <label>
            Responsable
            <select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)}>
              <option value="">Todos</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.full_name || profile.username || profile.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Buscar cliente / telefono / email
            <input
              type="search"
              className="erp-search-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nombre, telefono o correo"
            />
          </label>
        </div>
      </section>

      {error ? <p className="catering-message error">{error}</p> : null}

      <div className={`catering-layout ${selectedId ? "catering-layout--split" : ""}`}>
        <CateringRequestsList
          requests={filteredRequests}
          profilesById={profilesById}
          loading={loadingRequests}
          selectedId={selectedId}
          onSelect={handleSelectRequest}
        />
        {selectedId ? (
          <CateringRequestDetail
            requestId={selectedId}
            profiles={profiles}
            profilesById={profilesById}
            onClose={handleCloseDetail}
            onUpdated={handleUpdated}
          />
        ) : null}
      </div>
    </section>
  )
}
