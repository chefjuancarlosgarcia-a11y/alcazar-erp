import { useCallback, useEffect, useMemo, useState } from "react"
import { Navigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import {
  clearLocalOperationsLogs,
  exportOperationsDiagnosticsJSON,
  getOperationsCenterSnapshot,
  subscribeOperationsCenter
} from "../services/operationsCenterService"
import { canAccessOperationsCenter } from "../utils/operationsCenterPermissions"
import "./OperationsCenter.css"

const EVENT_TYPES = [
  "module_load",
  "cache_hit",
  "cache_miss",
  "cache_inflight",
  "cache_invalidate",
  "guard_skipped",
  "export_start",
  "export_success",
  "export_error",
  "frontend_error",
  "api_error"
]

const HEALTH_LABELS = {
  frontend: "Frontend",
  cache: "Cache",
  guards: "Guards",
  reports: "Reports",
  errors: "Errors"
}

function formatTimestamp(value) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleString("es-GT", {
      dateStyle: "short",
      timeStyle: "medium"
    })
  } catch {
    return value
  }
}

function formatDuration(value) {
  if (value == null) return "—"
  return `${value} ms`
}

function formatPercent(value) {
  if (value == null) return "—"
  return `${value}%`
}

function healthClass(status) {
  if (status === "good") return "good"
  if (status === "warn") return "warn"
  if (status === "bad") return "bad"
  return "unknown"
}

function healthLabel(status) {
  if (status === "good") return "Saludable"
  if (status === "warn") return "Atención"
  if (status === "bad") return "Crítico"
  return "Sin datos"
}

export default function OperationsCenter() {
  const { user } = useAuth()
  const [filters, setFilters] = useState({
    module: "all",
    event_type: "all",
    severity: "all",
    range: "24h"
  })
  const [snapshot, setSnapshot] = useState(() => getOperationsCenterSnapshot(filters))
  const [refreshKey, setRefreshKey] = useState(0)

  const refresh = useCallback(() => {
    setSnapshot(getOperationsCenterSnapshot(filters))
    setRefreshKey((current) => current + 1)
  }, [filters])

  useEffect(() => {
    refresh()
    const unsubscribe = subscribeOperationsCenter(refresh)
    return unsubscribe
  }, [refresh])

  useEffect(() => {
    const timer = window.setInterval(refresh, 5000)
    return () => window.clearInterval(timer)
  }, [refresh])

  const moduleOptions = useMemo(() => {
    const modules = new Set(snapshot.modules || [])
    return ["all", ...modules]
  }, [snapshot.modules])

  if (!canAccessOperationsCenter(user)) {
    return <Navigate to="/dashboard" replace />
  }

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function handleClearLogs() {
    clearLocalOperationsLogs()
    refresh()
  }

  function handleExportDiagnostics() {
    const payload = exportOperationsDiagnosticsJSON()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `operations-center-diagnostics-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const { kpis, health, events } = snapshot

  return (
    <div className="operations-center-page">
      <header className="operations-center-header">
        <div>
          <p className="operations-center-eyebrow">Centro de Comando Técnico</p>
          <h1>ERP Operations Center</h1>
          <p className="operations-center-muted">
            Este panel muestra métricas locales del navegador actual. V1 no centraliza logs entre usuarios.
          </p>
          <div className="operations-center-badges">
            <span className="operations-center-badge">V1 Local</span>
            <span className="operations-center-badge muted">Cobertura parcial V1</span>
          </div>
        </div>
        <div className="operations-center-actions">
          <button type="button" onClick={handleClearLogs}>Limpiar logs locales</button>
          <button type="button" className="primary" onClick={handleExportDiagnostics}>Exportar diagnóstico JSON</button>
        </div>
      </header>

      <section className="operations-center-kpis">
        <article className="operations-kpi">
          <span>Eventos totales</span>
          <strong>{kpis.totalEvents}</strong>
        </article>
        <article className="operations-kpi">
          <span>Cache hit rate</span>
          <strong>{formatPercent(kpis.cacheHitRate)}</strong>
        </article>
        <article className="operations-kpi">
          <span>Cache misses</span>
          <strong>{kpis.cacheMisses}</strong>
        </article>
        <article className="operations-kpi">
          <span>Invalidaciones</span>
          <strong>{kpis.invalidations}</strong>
        </article>
        <article className="operations-kpi">
          <span>Guard skips</span>
          <strong>{kpis.guardSkips}</strong>
        </article>
        <article className="operations-kpi">
          <span>Exports OK / Error</span>
          <strong>{kpis.exportSuccess} / {kpis.exportErrors}</strong>
        </article>
        <article className="operations-kpi">
          <span>Errores (60 min)</span>
          <strong>{kpis.recentErrors}</strong>
        </article>
        <article className="operations-kpi">
          <span>Carga módulo (avg)</span>
          <strong>{formatDuration(kpis.avgModuleLoadMs)}</strong>
        </article>
        <article className="operations-kpi">
          <span>Módulo más lento</span>
          <strong>{kpis.slowestModule || "—"}</strong>
          <small>{kpis.slowestModule ? `${kpis.slowestModuleAvgMs} ms avg` : "Sin datos"}</small>
        </article>
        <article className="operations-kpi">
          <span>Último evento</span>
          <strong className="operations-kpi-time">{formatTimestamp(kpis.lastEventAt)}</strong>
          <small key={refreshKey}>Auto-refresh 5s</small>
        </article>
      </section>

      <section className="operations-center-panel">
        <h2>System Health</h2>
        <div className="operations-health-grid">
          {Object.entries(health).map(([key, status]) => (
            <article key={key} className={`operations-health-card ${healthClass(status)}`}>
              <span className="operations-health-dot" aria-hidden="true" />
              <div>
                <strong>{HEALTH_LABELS[key]}</strong>
                <small>{healthLabel(status)}</small>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="operations-center-panel">
        <div className="operations-center-panel-head">
          <h2>Eventos recientes</h2>
          <div className="operations-center-filters">
            <label>
              Módulo
              <select value={filters.module} onChange={(event) => updateFilter("module", event.target.value)}>
                {moduleOptions.map((option) => (
                  <option key={option} value={option}>{option === "all" ? "Todos" : option}</option>
                ))}
              </select>
            </label>
            <label>
              Tipo
              <select value={filters.event_type} onChange={(event) => updateFilter("event_type", event.target.value)}>
                <option value="all">Todos</option>
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Severidad
              <select value={filters.severity} onChange={(event) => updateFilter("severity", event.target.value)}>
                <option value="all">Todas</option>
                <option value="info">info</option>
                <option value="warn">warn</option>
                <option value="error">error</option>
              </select>
            </label>
            <label>
              Rango
              <select value={filters.range} onChange={(event) => updateFilter("range", event.target.value)}>
                <option value="1h">1h</option>
                <option value="24h">24h</option>
                <option value="all">Todo</option>
              </select>
            </label>
          </div>
        </div>

        {!events.length ? (
          <p className="operations-center-empty">
            No hay eventos todavía. Navega entre módulos, usa reportes o genera actividad para poblar este panel.
          </p>
        ) : (
          <div className="operations-table-scroll">
            <table className="operations-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Module</th>
                  <th>Action</th>
                  <th>Event type</th>
                  <th>Status</th>
                  <th>Severity</th>
                  <th>Duration</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td>{formatTimestamp(event.timestamp)}</td>
                    <td><span className="operations-tag">{event.module}</span></td>
                    <td>{event.action}</td>
                    <td><span className="operations-tag type">{event.event_type}</span></td>
                    <td>{event.status}</td>
                    <td><span className={`operations-severity ${event.severity}`}>{event.severity}</span></td>
                    <td>{formatDuration(event.duration_ms)}</td>
                    <td className="operations-message">{event.message || event.error_message || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
