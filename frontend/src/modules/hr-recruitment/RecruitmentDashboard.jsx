import { useCallback, useEffect, useMemo, useState } from "react"
import { useAuth } from "../../context/AuthContext"
import RecruitmentKanbanTab from "./RecruitmentKanbanTab"
import RecruitmentVacanciesTab from "./RecruitmentVacanciesTab"
import {
  getRecruitmentKpis,
  getRecruitmentWeeklyReport,
  listRecruitmentCandidates,
  listRecruitmentProfiles,
  listRecruitmentVacancies
} from "./recruitmentService"
import {
  CANDIDATE_SOURCES,
  canManageRecruitment,
  canRequestRecruitmentVacancy,
  defaultMonthRange,
  RECRUITMENT_ACCESS_DENIED
} from "./recruitmentUtils"
import "./Recruitment.css"

function KpiCard({ label, value, suffix = "" }) {
  return (
    <article className="recruitment-kpi-card">
      <span>{label}</span>
      <strong>{value ?? 0}{suffix}</strong>
    </article>
  )
}

export default function RecruitmentDashboard() {
  const { user } = useAuth()
  const canManage = canManageRecruitment(user?.role)
  const canRequest = canRequestRecruitmentVacancy(user?.role)
  const defaultRange = useMemo(() => defaultMonthRange(), [])

  const [tab, setTab] = useState(canManage ? "dashboard" : "vacancies")
  const [message, setMessage] = useState({ text: "", tone: "info" })

  const [vacancies, setVacancies] = useState([])
  const [candidates, setCandidates] = useState([])
  const [profiles, setProfiles] = useState([])
  const [kpis, setKpis] = useState(null)
  const [weekly, setWeekly] = useState([])

  const [loadingVacancies, setLoadingVacancies] = useState(true)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [loadingKpis, setLoadingKpis] = useState(false)

  const [filters, setFilters] = useState({
    dateFrom: defaultRange.from,
    dateTo: defaultRange.to,
    position: "",
    area: "",
    source: ""
  })

  const notify = useCallback((text, tone = "info") => {
    setMessage({ text, tone })
  }, [])

  const loadVacancies = useCallback(async () => {
    setLoadingVacancies(true)
    const result = await listRecruitmentVacancies()
    if (result.error) notify(result.error, "error")
    else setVacancies(result.data)
    setLoadingVacancies(false)
  }, [notify])

  const loadCandidates = useCallback(async () => {
    if (!canManage) return
    setLoadingCandidates(true)
    const result = await listRecruitmentCandidates({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      area: filters.area || null,
      source: filters.source || null
    })
    if (result.error) notify(result.error, "error")
    else setCandidates(result.data)
    setLoadingCandidates(false)
  }, [canManage, filters.area, filters.dateFrom, filters.dateTo, filters.source, notify])

  const loadKpis = useCallback(async () => {
    if (!canManage) return
    setLoadingKpis(true)
    const [kpiResult, weeklyResult, profileResult] = await Promise.all([
      getRecruitmentKpis(filters),
      getRecruitmentWeeklyReport(8),
      listRecruitmentProfiles()
    ])
    if (kpiResult.error) notify(kpiResult.error, "error")
    else setKpis(kpiResult.data)
    if (weeklyResult.error) notify(weeklyResult.error, "error")
    else setWeekly(weeklyResult.data)
    if (!profileResult.error) setProfiles(profileResult.data)
    setLoadingKpis(false)
  }, [canManage, filters, notify])

  useEffect(() => {
    if (!canRequest) return
    loadVacancies()
  }, [canRequest, loadVacancies])

  useEffect(() => {
    if (!canManage) return
    loadCandidates()
    loadKpis()
  }, [canManage, loadCandidates, loadKpis])

  async function refreshAll() {
    await Promise.all([loadVacancies(), loadCandidates(), loadKpis()])
  }

  if (!canRequest) {
    return (
      <section className="recruitment-page erp-page-shell">
        <article className="recruitment-panel">
          <h1>Reclutamiento</h1>
          <p className="recruitment-message error">{RECRUITMENT_ACCESS_DENIED}</p>
        </article>
      </section>
    )
  }

  const tabs = canManage
    ? [
      ["dashboard", "Dashboard"],
      ["vacancies", "Vacantes"],
      ["pipeline", "Pipeline"]
    ]
    : [["vacancies", "Solicitudes"]]

  return (
    <section className="recruitment-page erp-page-shell">
      <header className="erp-module-header">
        <p className="tasks-eyebrow">Recursos Humanos</p>
        <h1>Reclutamiento</h1>
        <p className="tasks-muted">Pipeline medible de vacantes, candidatos, entrevistas y KPIs.</p>
      </header>

      {message.text ? (
        <p className={`recruitment-message ${message.tone === "error" ? "error" : "success"}`}>{message.text}</p>
      ) : null}

      <nav className="recruitment-tabs" aria-label="Secciones de reclutamiento">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "dashboard" && canManage ? (
        <>
          <article className="recruitment-panel">
            <div className="recruitment-panel__head">
              <div>
                <h2>KPIs de reclutamiento</h2>
                <p className="tasks-muted">Indicadores del periodo seleccionado.</p>
              </div>
            </div>
            <div className="recruitment-filters">
              <input type="date" value={filters.dateFrom} onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })} />
              <input type="date" value={filters.dateTo} onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })} />
              <input placeholder="Puesto" value={filters.position} onChange={(e) => setFilters({ ...filters, position: e.target.value })} />
              <input placeholder="Área" value={filters.area} onChange={(e) => setFilters({ ...filters, area: e.target.value })} />
              <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })}>
                <option value="">Todas las fuentes</option>
                {CANDIDATE_SOURCES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
              <button type="button" className="tasks-secondary" onClick={loadKpis}>Actualizar KPIs</button>
            </div>

            {loadingKpis ? <p className="tasks-muted">Calculando KPIs...</p> : null}
            {kpis ? (
              <div className="recruitment-kpi-grid">
                <KpiCard label="Vacantes abiertas" value={kpis.open_vacancies} />
                <KpiCard label="Vacantes críticas" value={kpis.critical_vacancies} />
                <KpiCard label="Aplicaciones recibidas" value={kpis.applications_received} />
                <KpiCard label="Contactados" value={kpis.candidates_contacted} />
                <KpiCard label="Respondieron" value={kpis.candidates_responded} />
                <KpiCard label="Entrevistas programadas" value={kpis.interviews_scheduled} />
                <KpiCard label="Entrevistas realizadas" value={kpis.interviews_completed} />
                <KpiCard label="No shows" value={kpis.no_shows} />
                <KpiCard label="Ofertas" value={kpis.offers_made} />
                <KpiCard label="Contratados" value={kpis.hired} />
                <KpiCard label="Descartados" value={kpis.discarded} />
                <KpiCard label="Tasa de respuesta" value={kpis.response_rate} suffix="%" />
                <KpiCard label="Tasa de asistencia" value={kpis.attendance_rate} suffix="%" />
                <KpiCard label="Tasa de no show" value={kpis.no_show_rate} suffix="%" />
                <KpiCard label="Tasa de contratación" value={kpis.hire_rate} suffix="%" />
                <KpiCard label="Tiempo prom. cobertura" value={kpis.avg_coverage_days ?? "—"} suffix={kpis.avg_coverage_days != null ? " días" : ""} />
              </div>
            ) : null}
          </article>

          <article className="recruitment-panel">
            <div className="recruitment-panel__head">
              <div>
                <h2>Reporte semanal RRHH</h2>
                <p className="tasks-muted">Resumen por semana para seguimiento operativo.</p>
              </div>
            </div>
            <div className="recruitment-table-wrap">
              <table className="recruitment-weekly-table">
                <thead>
                  <tr>
                    <th>Semana</th>
                    <th>Abiertas</th>
                    <th>Aplicaciones</th>
                    <th>Contactados</th>
                    <th>Respondieron</th>
                    <th>Entrev. prog.</th>
                    <th>Entrev. real.</th>
                    <th>No show</th>
                    <th>Contratados</th>
                    <th>Pendientes</th>
                  </tr>
                </thead>
                <tbody>
                  {weekly.map((row) => (
                    <tr key={row.week_start}>
                      <td>{row.week_label}</td>
                      <td>{row.open_vacancies}</td>
                      <td>{row.applications_received}</td>
                      <td>{row.contacted}</td>
                      <td>{row.responded}</td>
                      <td>{row.interviews_scheduled}</td>
                      <td>{row.interviews_completed}</td>
                      <td>{row.no_shows}</td>
                      <td>{row.hired}</td>
                      <td>{row.pending_positions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      ) : null}

      {tab === "vacancies" ? (
        <RecruitmentVacanciesTab
          vacancies={vacancies}
          profiles={profiles.length ? profiles : [{ id: user?.id, full_name: user?.full_name || user?.username }]}
          canManage={canManage}
          currentUserId={user?.id}
          loading={loadingVacancies}
          onRefresh={refreshAll}
          onMessage={notify}
        />
      ) : null}

      {tab === "pipeline" && canManage ? (
        <RecruitmentKanbanTab
          vacancies={vacancies.filter((row) => row.status !== "cancelled")}
          candidates={candidates}
          profiles={profiles}
          loading={loadingCandidates}
          onRefresh={refreshAll}
          onMessage={notify}
        />
      ) : null}
    </section>
  )
}
