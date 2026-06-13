import { Component, useEffect, useMemo, useState } from "react"
import { formatAttendanceDevice, resolveAttendanceUserAgent } from "../../utils/attendanceDevice"
import {
  buildAttendanceReportsKpis,
  computeAttendanceReportMetrics,
  formatHorasTrabajadas,
  getAttendanceMarkLabel,
  getKpiToneClass,
  getLateArrivalBadgeClass,
  getLateArrivalStatusLabel,
  getMovementTypeBadgeClass
} from "./attendanceReportsHelpers"
import "./AttendanceReports.css"

const HISTORY_BATCH_SIZE = 80

function useCompactAttendanceView() {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false
    return window.matchMedia("(max-width: 767px)").matches
  })

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)")
    const onChange = (event) => setCompact(event.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return compact
}

function AttendancePhotoButton({ src, alt, className, onOpen }) {
  if (!src) return null
  return (
    <button type="button" className="attendance-reports-photo-btn" onClick={() => onOpen(src)} title="Ver foto ampliada">
      <img src={src} alt={alt} className={className} loading="lazy" decoding="async" />
    </button>
  )
}

class AttendanceReportsErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error("[attendance/reports] render error", error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="attendance-reports-module">
          <div className="attendance-reports-section-card">
            <h3>No se pudieron mostrar los reportes</h3>
            <p className="attendance-reports-empty">
              Ocurrió un error al renderizar los KPIs o el historial. Recarga la página o contacta soporte si persiste.
            </p>
            <button
              type="button"
              className="erp-btn erp-btn--secondary"
              onClick={() => this.setState({ error: null })}
            >
              Reintentar
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function AttendanceReportsContent({
  asistenciaBusqueda,
  setAsistenciaBusqueda,
  asistenciaFechaFiltro,
  setAsistenciaFechaFiltro,
  asistenciaReporteColaboradorId,
  setAsistenciaReporteColaboradorId,
  asistenciaPerfiles = [],
  asistenciaMovimientos = [],
  asistenciaLlegadasTarde = [],
  asistenciaGraceMinutes,
  asistenciaCargando = false,
  asistenciaDetalleMarcaje,
  setAsistenciaDetalleMarcaje,
  asistenciaFotoAmpliada,
  setAsistenciaFotoAmpliada
}) {
  const compactView = useCompactAttendanceView()
  const [historyLimit, setHistoryLimit] = useState(HISTORY_BATCH_SIZE)

  const metrics = useMemo(
    () =>
      computeAttendanceReportMetrics({
        asistenciaMovimientos,
        asistenciaPerfiles,
        asistenciaLlegadasTarde,
        asistenciaFechaFiltro,
        asistenciaReporteColaboradorId,
        asistenciaBusqueda
      }),
    [
      asistenciaMovimientos,
      asistenciaPerfiles,
      asistenciaLlegadasTarde,
      asistenciaFechaFiltro,
      asistenciaReporteColaboradorId,
      asistenciaBusqueda
    ]
  )

  const {
    movimientosReportes,
    llegadasTarde,
    entradasDelDia,
    salidasDelDia,
    salidasTempranas,
    faltasDelDia,
    horasTrabajadas,
    banosDelDia,
    regresosBanoDelDia,
    colaboradoresDentroTurno,
    colaboradoresSinSalida,
    resumenSemanal,
    resumenMensual
  } = metrics

  useEffect(() => {
    setHistoryLimit(HISTORY_BATCH_SIZE)
  }, [asistenciaFechaFiltro, asistenciaReporteColaboradorId, asistenciaBusqueda, movimientosReportes.length])

  const kpis = useMemo(
    () =>
      buildAttendanceReportsKpis({
        entradasDelDia,
        salidasDelDia,
        llegadasTarde,
        asistenciaGraceMinutes,
        salidasTempranas,
        faltasDelDia,
        horasTrabajadas,
        banosDelDia,
        regresosBanoDelDia,
        colaboradoresDentroTurno,
        colaboradoresSinSalida,
        resumenSemanal,
        resumenMensual
      }),
    [
      entradasDelDia,
      salidasDelDia,
      llegadasTarde,
      asistenciaGraceMinutes,
      salidasTempranas,
      faltasDelDia,
      horasTrabajadas,
      banosDelDia,
      regresosBanoDelDia,
      colaboradoresDentroTurno,
      colaboradoresSinSalida,
      resumenSemanal,
      resumenMensual
    ]
  )

  const movimientosVisibles = movimientosReportes.slice(0, historyLimit)
  const hayMasMovimientos = movimientosReportes.length > historyLimit

  return (
    <div className="attendance-reports-module">
      <header className="attendance-reports-header">
        <h2>Reportes de asistencia</h2>
        <p>Consulta KPIs operativos, llegadas tarde e historial de marcajes por fecha y colaborador.</p>
      </header>

      {asistenciaCargando ? (
        <p className="attendance-reports-status attendance-reports-status--loading">Actualizando marcajes…</p>
      ) : null}

      <div className="erp-filters-row attendance-reports-filters">
        <input
          className="erp-search-input"
          placeholder="Buscar colaborador..."
          value={asistenciaBusqueda}
          onChange={(event) => setAsistenciaBusqueda(event.target.value)}
        />
        <input
          className="erp-search-input"
          type="date"
          value={asistenciaFechaFiltro}
          onChange={(event) => setAsistenciaFechaFiltro(event.target.value)}
        />
        <select
          className="erp-search-input"
          value={asistenciaReporteColaboradorId}
          onChange={(event) => setAsistenciaReporteColaboradorId(event.target.value)}
        >
          <option value="">Todos los colaboradores</option>
          {asistenciaPerfiles.map((usuario) => (
            <option key={usuario.id} value={usuario.id}>
              {usuario.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="erp-kpi-grid">
        {kpis.map((kpi) => (
          <div key={kpi.id} className={`erp-kpi-card ${getKpiToneClass(kpi.tone)}`}>
            <span>{kpi.title}</span>
            <strong>{kpi.value}</strong>
            {kpi.note ? <p className="attendance-reports-kpi-note">{kpi.note}</p> : null}
            {kpi.detail?.length ? (
              <div className="attendance-reports-kpi-detail">
                {kpi.detail.slice(0, 12).map((item, index) => (
                  <p key={item?.usuario?.id || `hours-${index}`}>
                    {item?.usuario?.nombre || "Colaborador"}: {formatHorasTrabajadas(item.totalMinutos || 0)}
                  </p>
                ))}
                {kpi.detail.length > 12 ? (
                  <p className="attendance-reports-kpi-note">+{kpi.detail.length - 12} colaboradores más</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {llegadasTarde.length > 0 ? (
        <section className="attendance-reports-section-card">
          <h3>Detalle de llegadas tarde</h3>
          {compactView ? (
            <div className="attendance-reports-mobile-list attendance-reports-mobile-list--visible">
              {llegadasTarde.map((row) => (
                <article key={row.id} className="attendance-reports-mobile-card">
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Colaborador</span>
                    <span className="attendance-reports-mobile-card__value">{row.colaboradorNombre}</span>
                  </div>
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Retraso</span>
                    <span className="attendance-reports-mobile-card__value">
                      <span className="erp-badge erp-badge--warning attendance-reports-badge">
                        {row.minutosTarde} min tarde
                      </span>
                    </span>
                  </div>
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Estado</span>
                    <span className="attendance-reports-mobile-card__value">
                      <span className={getLateArrivalBadgeClass(row)}>{getLateArrivalStatusLabel(row)}</span>
                    </span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="attendance-reports-table-wrap attendance-reports-table-wrap--visible">
              <table className="attendance-reports-table">
                <thead>
                  <tr>
                    <th>Colaborador</th>
                    <th>Área</th>
                    <th>Hora programada</th>
                    <th>Entrada</th>
                    <th>Minutos tarde</th>
                    <th>Horario</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {llegadasTarde.map((row) => (
                    <tr key={row.id}>
                      <td>{row.colaboradorNombre}</td>
                      <td>{row.area || "-"}</td>
                      <td>{row.horaProgramada}</td>
                      <td>{row.horaEntrada}</td>
                      <td>
                        <span className="erp-badge erp-badge--warning attendance-reports-badge">
                          {row.minutosTarde} min tarde
                        </span>
                      </td>
                      <td>{row.horarioEstado}</td>
                      <td>
                        <span className={getLateArrivalBadgeClass(row)}>{getLateArrivalStatusLabel(row)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      <section className="attendance-reports-section-card">
        <h3>Historial por colaborador</h3>
        {movimientosReportes.length === 0 ? (
          <p className="attendance-reports-empty">Sin movimientos para los filtros seleccionados.</p>
        ) : compactView ? (
          <>
            <div className="attendance-reports-mobile-list attendance-reports-mobile-list--visible">
              {movimientosVisibles.map((movimiento) => (
                <article key={movimiento.id} className="attendance-reports-mobile-card">
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Fecha / Hora</span>
                    <span className="attendance-reports-mobile-card__value">
                      {movimiento.fecha} · {movimiento.hora}
                    </span>
                  </div>
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Colaborador</span>
                    <span className="attendance-reports-mobile-card__value">{movimiento.colaboradorNombre}</span>
                  </div>
                  <div className="attendance-reports-mobile-card__row">
                    <span className="attendance-reports-mobile-card__label">Movimiento</span>
                    <span className="attendance-reports-mobile-card__value">
                      <span className={getMovementTypeBadgeClass(movimiento.tipo)}>
                        {getAttendanceMarkLabel(movimiento.tipo)}
                      </span>
                    </span>
                  </div>
                  <AttendancePhotoButton
                    src={movimiento.fotoMarcaje}
                    alt="Marcaje"
                    className="attendance-reports-photo-thumb"
                    onOpen={setAsistenciaFotoAmpliada}
                  />
                  <div className="attendance-reports-mobile-card__actions">
                    <button
                      type="button"
                      className="erp-btn erp-btn--secondary"
                      onClick={() => setAsistenciaDetalleMarcaje(movimiento)}
                    >
                      Ver detalle
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {hayMasMovimientos ? (
              <button
                type="button"
                className="erp-btn erp-btn--secondary"
                onClick={() => setHistoryLimit((current) => current + HISTORY_BATCH_SIZE)}
              >
                Cargar más movimientos ({movimientosReportes.length - historyLimit} restantes)
              </button>
            ) : null}
          </>
        ) : (
          <>
            <div className="attendance-reports-table-wrap attendance-reports-table-wrap--visible">
              <table className="attendance-reports-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Hora</th>
                    <th>Colaborador</th>
                    <th>Movimiento</th>
                    <th>Dispositivo</th>
                    <th>Foto</th>
                    <th>Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {movimientosVisibles.map((movimiento) => (
                    <tr key={movimiento.id}>
                      <td>{movimiento.fecha}</td>
                      <td>{movimiento.hora}</td>
                      <td>{movimiento.colaboradorNombre}</td>
                      <td>
                        <span className={getMovementTypeBadgeClass(movimiento.tipo)}>
                          {getAttendanceMarkLabel(movimiento.tipo)}
                        </span>
                      </td>
                      <td>{formatAttendanceDevice(movimiento)}</td>
                      <td>
                        {movimiento.fotoMarcaje ? (
                          <AttendancePhotoButton
                            src={movimiento.fotoMarcaje}
                            alt="Marcaje"
                            className="attendance-reports-photo-thumb"
                            onOpen={setAsistenciaFotoAmpliada}
                          />
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="erp-btn erp-btn--secondary"
                          onClick={() => setAsistenciaDetalleMarcaje(movimiento)}
                        >
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {hayMasMovimientos ? (
              <button
                type="button"
                className="erp-btn erp-btn--secondary"
                onClick={() => setHistoryLimit((current) => current + HISTORY_BATCH_SIZE)}
              >
                Cargar más movimientos ({movimientosReportes.length - historyLimit} restantes)
              </button>
            ) : null}
          </>
        )}
      </section>

      {asistenciaDetalleMarcaje ? (
        <div className="attendance-reports-modal-overlay" onClick={() => setAsistenciaDetalleMarcaje(null)}>
          <div className="attendance-reports-detail-modal" onClick={(event) => event.stopPropagation()}>
            <h3>Detalle de marcaje</h3>
            <div className="attendance-reports-detail-grid">
              <div>
                <strong>Fecha</strong>
                <span>{asistenciaDetalleMarcaje.fecha}</span>
              </div>
              <div>
                <strong>Hora</strong>
                <span>{asistenciaDetalleMarcaje.hora}</span>
              </div>
              <div>
                <strong>Colaborador</strong>
                <span>{asistenciaDetalleMarcaje.colaboradorNombre}</span>
              </div>
              <div>
                <strong>Movimiento</strong>
                <span>{getAttendanceMarkLabel(asistenciaDetalleMarcaje.tipo)}</span>
              </div>
              <div>
                <strong>Dispositivo</strong>
                <span>{formatAttendanceDevice(asistenciaDetalleMarcaje)}</span>
              </div>
              <div>
                <strong>Estado</strong>
                <span>
                  {asistenciaDetalleMarcaje.dispositivoNoAutorizado
                    ? "Dispositivo no autorizado"
                    : asistenciaDetalleMarcaje.estado}
                </span>
              </div>
              {asistenciaDetalleMarcaje.notas ? (
                <div className="attendance-reports-detail-span-full">
                  <strong>Notas</strong>
                  <span>{asistenciaDetalleMarcaje.notas}</span>
                </div>
              ) : null}
              {resolveAttendanceUserAgent(asistenciaDetalleMarcaje) ? (
                <div className="attendance-reports-detail-span-full">
                  <strong>User agent (auditoría)</strong>
                  <span className="attendance-reports-user-agent">
                    {resolveAttendanceUserAgent(asistenciaDetalleMarcaje)}
                  </span>
                </div>
              ) : null}
            </div>
            {asistenciaDetalleMarcaje.fotoMarcaje ? (
              <button
                type="button"
                className="attendance-reports-photo-btn"
                onClick={() => setAsistenciaFotoAmpliada(asistenciaDetalleMarcaje.fotoMarcaje)}
              >
                <img
                  src={asistenciaDetalleMarcaje.fotoMarcaje}
                  alt="Evidencia de marcaje"
                  className="attendance-reports-detail-photo"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ) : (
              <p className="attendance-reports-empty">Sin foto disponible.</p>
            )}
            <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setAsistenciaDetalleMarcaje(null)}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}

      {asistenciaFotoAmpliada ? (
        <div className="attendance-reports-modal-overlay" onClick={() => setAsistenciaFotoAmpliada("")}>
          <div className="attendance-reports-photo-preview" onClick={(event) => event.stopPropagation()}>
            <img src={asistenciaFotoAmpliada} alt="Evidencia de marcaje ampliada" loading="lazy" decoding="async" />
            <button type="button" className="erp-btn erp-btn--secondary" onClick={() => setAsistenciaFotoAmpliada("")}>
              Cerrar
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default function AttendanceReportsModule(props) {
  return (
    <AttendanceReportsErrorBoundary>
      <AttendanceReportsContent {...props} />
    </AttendanceReportsErrorBoundary>
  )
}
