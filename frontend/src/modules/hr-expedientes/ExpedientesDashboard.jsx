import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import ExpedienteDetail from "./ExpedienteDetail"
import ExpedientesList from "./ExpedientesList"
import ExpedientesReports from "./ExpedientesReports"
import {
  getExpedientesDashboard,
  listExpedientes,
  syncExpedienteAlerts
} from "./expedientesService"
import { EXPEDIENTE_STATUS, canAccessExpedientes, canWriteExpedientes, EXPEDIENTE_ACCESS_DENIED_MESSAGE } from "./expedientesUtils"
import "./Expedientes.css"

function KpiCard({ label, value, tone = "" }) {
  return (
    <article className={`expediente-kpi ${tone ? `expediente-kpi--${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value ?? 0}</strong>
    </article>
  )
}

export default function ExpedientesDashboard() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get("profileId") || ""
  const canAccess = canAccessExpedientes(user?.role)
  const canWrite = canWriteExpedientes(user?.role)

  const [dashboard, setDashboard] = useState(null)
  const [rows, setRows] = useState([])
  const [loadingDashboard, setLoadingDashboard] = useState(true)
  const [loadingRows, setLoadingRows] = useState(true)
  const [error, setError] = useState("")
  const [showReports, setShowReports] = useState(false)

  const [search, setSearch] = useState("")
  const [area, setArea] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [status, setStatus] = useState("")
  const [expiredOnly, setExpiredOnly] = useState(false)
  const [incompleteOnly, setIncompleteOnly] = useState(false)

  const areaOptions = useMemo(
    () => [...new Set(rows.map((row) => row.area_name).filter(Boolean))].sort(),
    [rows]
  )

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true)
    const result = await getExpedientesDashboard()
    if (result.error) setError(result.error)
    else setDashboard(result.data)
    setLoadingDashboard(false)
  }, [])

  const loadRows = useCallback(async () => {
    setLoadingRows(true)
    const result = await listExpedientes({
      search: search || null,
      area: area || null,
      jobTitle: jobTitle || null,
      status: status || null,
      expiredOnly,
      incompleteOnly
    })
    if (result.error) setError(result.error)
    else setRows(result.data)
    setLoadingRows(false)
  }, [search, area, jobTitle, status, expiredOnly, incompleteOnly])

  useEffect(() => {
    if (!canAccess) return
    loadDashboard()
    syncExpedienteAlerts()
  }, [canAccess, loadDashboard])

  useEffect(() => {
    if (!canAccess) return
    loadRows()
  }, [canAccess, loadRows])

  function handleSelect(profileId) {
    setSearchParams({ section: "expedientes", profileId })
  }

  function handleCloseDetail() {
    setSearchParams({ section: "expedientes" })
  }

  if (!canAccess) {
    return (
      <section className="expediente-page erp-page-shell">
        <article className="expediente-panel">
          <h1>Expedientes</h1>
          <p className="expediente-message error">{EXPEDIENTE_ACCESS_DENIED_MESSAGE}</p>
        </article>
      </section>
    )
  }

  return (
    <section className="expediente-page erp-page-shell">
      <header className="expediente-header erp-module-header">
        <div>
          <p>Recursos Humanos</p>
          <h1>Expedientes de Colaboradores</h1>
          <span>Fuente oficial de documentacion laboral, vencimientos y cumplimiento.</span>
        </div>
        <div className="expediente-header__actions">
          <button type="button" className="ghost" onClick={() => setShowReports((v) => !v)}>Reportes</button>
          {canWrite ? (
            <button type="button" className="primary" onClick={() => { syncExpedienteAlerts(); loadDashboard(); loadRows() }}>
              Sincronizar alertas
            </button>
          ) : null}
        </div>
      </header>

      <section className="expediente-kpi-grid">
        <KpiCard label="Documentos vencidos" value={loadingDashboard ? "…" : dashboard?.expired_documents} tone="red" />
        <KpiCard label="Proximos a vencer" value={loadingDashboard ? "…" : dashboard?.expiring_soon} tone="yellow" />
        <KpiCard label="Expedientes incompletos" value={loadingDashboard ? "…" : dashboard?.incomplete_files} tone="orange" />
        <KpiCard label="Expedientes completos" value={loadingDashboard ? "…" : dashboard?.complete_files} tone="green" />
      </section>

      {showReports ? <ExpedientesReports onClose={() => setShowReports(false)} /> : null}

      <section className="expediente-panel expediente-filters">
        <h2>Filtros</h2>
        <div className="expediente-filters-row">
          <label>
            Buscar
            <input type="search" className="erp-search-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, DPI o NIT" />
          </label>
          <label>
            Area
            <select value={area} onChange={(e) => setArea(e.target.value)}>
              <option value="">Todas</option>
              {areaOptions.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Puesto
            <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Filtrar puesto" />
          </label>
          <label>
            Estado expediente
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option>
              {Object.entries(EXPEDIENTE_STATUS).map(([value, meta]) => (
                <option key={value} value={value}>{meta.label}</option>
              ))}
            </select>
          </label>
          <label className="expediente-checkbox">
            <input type="checkbox" checked={expiredOnly} onChange={(e) => setExpiredOnly(e.target.checked)} />
            Documentos vencidos
          </label>
          <label className="expediente-checkbox">
            <input type="checkbox" checked={incompleteOnly} onChange={(e) => setIncompleteOnly(e.target.checked)} />
            Expedientes incompletos
          </label>
        </div>
      </section>

      {error ? <p className="expediente-message error">{error}</p> : null}

      <div className={`expediente-layout ${selectedId ? "expediente-layout--split" : ""}`}>
        <ExpedientesList
          rows={rows}
          loading={loadingRows}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
        {selectedId ? (
          <ExpedienteDetail
            profileId={selectedId}
            canWrite={canWrite}
            onClose={handleCloseDetail}
            onUpdated={loadRows}
          />
        ) : null}
      </div>
    </section>
  )
}
