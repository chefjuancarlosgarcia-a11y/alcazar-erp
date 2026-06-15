import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { getChecklistProfiles } from "../../services/checklistsService"
import CateringRequestDetail from "./CateringRequestDetail"
import CateringRequestsList from "./CateringRequestsList"
import {
  getCateringPipelineSummary,
  listCateringRequests
} from "./cateringService"
import { CONVERSION_STATUS_OPTIONS, matchesEventDate, matchesSearch } from "./cateringUtils"
import "./Catering.css"

const CATERING_ROLES = ["admin", "gerente_general", "gerente", "gerente_operaciones", "supervisor"]

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
  const selectedId = searchParams.get("id") || ""
  const canAccess = CATERING_ROLES.includes(user?.role)

  const defaultRange = useMemo(() => currentMonthRange(), [])
  const [summaryFrom, setSummaryFrom] = useState(defaultRange.from)
  const [summaryTo, setSummaryTo] = useState(defaultRange.to)
  const [summary, setSummary] = useState(null)
  const [requests, setRequests] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loadingSummary, setLoadingSummary] = useState(true)
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
  }, [canAccess, loadSummary])

  useEffect(() => {
    if (!canAccess) return
    loadRequests()
  }, [canAccess, loadRequests])

  useEffect(() => {
    if (!canAccess) return
    async function loadProfiles() {
      const result = await getChecklistProfiles()
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
          <h1>Catering</h1>
          <span>Solicitudes ingresadas desde Wix y seguimiento comercial del pipeline.</span>
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
          <button type="button" className="primary" onClick={loadSummary} disabled={loadingSummary}>
            {loadingSummary ? "Actualizando..." : "Actualizar KPIs"}
          </button>
        </div>
      </section>

      <section className="catering-kpi-grid">
        <article className="catering-kpi-card">
          <span>Total leads</span>
          <strong>{summary?.total_leads ?? (loadingSummary ? "…" : 0)}</strong>
        </article>
        <article className="catering-kpi-card">
          <span>Leads nuevos</span>
          <strong>{summary?.new_leads ?? (loadingSummary ? "…" : 0)}</strong>
        </article>
        <article className="catering-kpi-card">
          <span>Cotizados</span>
          <strong>{summary?.quoted_leads ?? (loadingSummary ? "…" : 0)}</strong>
        </article>
        <article className="catering-kpi-card">
          <span>Aprobados</span>
          <strong>{summary?.approved_leads ?? (loadingSummary ? "…" : 0)}</strong>
        </article>
        <article className="catering-kpi-card">
          <span>Perdidos</span>
          <strong>{summary?.lost_leads ?? (loadingSummary ? "…" : 0)}</strong>
        </article>
        <article className="catering-kpi-card">
          <span>Tasa conversion</span>
          <strong>{summary ? `${Number(summary.conversion_rate || 0).toFixed(1)}%` : loadingSummary ? "…" : "0%"}</strong>
        </article>
      </section>

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
