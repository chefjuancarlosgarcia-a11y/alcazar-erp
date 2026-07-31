import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import useCommandCenter from "./useCommandCenter"
import {
  alertPriorityLabel,
  formatClock,
  formatDateLabel,
  money,
  summarizeAlerts
} from "./commandCenterHelpers"
import "./CommandCenterLayer.css"

const ACTIVITY_PREVIEW = 3

function CommandCenterDrawer({ open, title, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="cc-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="cc-drawer"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="cc-drawer__head">
          <h2>{title}</h2>
          <button type="button" className="cc-drawer__close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        <div className="cc-drawer__body">{children}</div>
      </aside>
    </div>
  )
}

function AlertList({ alerts, navigate }) {
  if (!alerts.length) {
    return (
      <div className="cc-empty cc-empty--positive cc-empty--compact">
        <span className="cc-empty__icon" aria-hidden="true">✓</span>
        <span>Operación estable. No hay alertas críticas en este momento.</span>
      </div>
    )
  }

  return (
    <div className="cc-alerts cc-alerts--drawer">
      {alerts.map((alert) => (
        <article key={alert.id} className={`cc-alert cc-alert--${alert.priority}`}>
          <span className="cc-alert__icon" aria-hidden="true">{alert.icon}</span>
          <div>
            <span className={`cc-alert__severity cc-alert__severity--${alert.priority}`}>
              {alertPriorityLabel(alert.priority)}
            </span>
            <strong>{alert.title}</strong>
            <p>{alert.description}</p>
            <small>{alert.area}</small>
          </div>
          <button type="button" className="cc-btn cc-btn--ghost cc-btn--sm" onClick={() => navigate(alert.to)}>
            Ver
          </button>
        </article>
      ))}
    </div>
  )
}

export function CommandCenterHeader({ now, overallStatus, showActions = true }) {
  const navigate = useNavigate()

  return (
    <header className="cc-header">
      <div className="cc-header__main">
        <p className="cc-header__eyebrow">El Gran Alcázar</p>
        <h1>Centro de Comando</h1>
        <p className="cc-header__subtitle">Estado operativo del restaurante en tiempo real.</p>
      </div>
      <div className="cc-header__meta">
        <div className="cc-header__datetime">
          <span className="cc-header__date">{formatDateLabel(now)}</span>
          <span className="cc-header__time">{formatClock(now)}</span>
        </div>
        <span className={`cc-status cc-status--${overallStatus.level}`}>
          {overallStatus.emoji} {overallStatus.label}
        </span>
        {showActions && (
          <div className="cc-header__actions">
            <button type="button" className="cc-btn cc-btn--ghost" onClick={() => navigate("/reports?tab=executive")}>
              Reportes ejecutivos
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export function CommandCenterSemaphores({
  semaphores,
  productionActive,
  productionLate,
  productionAvg,
  inventoryOut,
  inventoryLow,
  pendingRequisitions,
  hr,
  costs
}) {
  const navigate = useNavigate()

  return (
    <section className="cc-section cc-section--compact">
      <div className="cc-section__head">
        <h2>Semáforos operativos</h2>
      </div>
      <div className="cc-semaphore-grid">
        <article className={`cc-semaphore cc-semaphore--${semaphores.production}`}>
          <div className="cc-semaphore__head">
            <span className="cc-semaphore__icon" aria-hidden="true">🍳</span>
            <span className="cc-semaphore__lamp" />
          </div>
          <strong>Producción</strong>
          <div className="cc-semaphore__metrics">
            <p>{productionActive} tickets activos</p>
            <p>{productionLate} atrasados · {productionAvg} min promedio</p>
          </div>
          <button type="button" className="cc-semaphore__link" onClick={() => navigate("/production")}>
            Ver Producción →
          </button>
        </article>

        <article className={`cc-semaphore cc-semaphore--${semaphores.inventory}`}>
          <div className="cc-semaphore__head">
            <span className="cc-semaphore__icon" aria-hidden="true">📦</span>
            <span className="cc-semaphore__lamp" />
          </div>
          <strong>Inventario</strong>
          <div className="cc-semaphore__metrics">
            <p>{inventoryOut} agotados · {inventoryLow} bajo mínimo</p>
            <p>{pendingRequisitions} requisiciones pendientes</p>
          </div>
          <button type="button" className="cc-semaphore__link" onClick={() => navigate("/inventory")}>
            Ver Inventario →
          </button>
        </article>

        <article className={`cc-semaphore cc-semaphore--${semaphores.hr}`}>
          <div className="cc-semaphore__head">
            <span className="cc-semaphore__icon" aria-hidden="true">👥</span>
            <span className="cc-semaphore__lamp" />
          </div>
          <strong>Personal</strong>
          <div className="cc-semaphore__metrics">
            <p>{hr.late} tardanzas hoy</p>
            <p>{hr.absences} faltas · {hr.active} colaboradores activos</p>
          </div>
          <button type="button" className="cc-semaphore__link" onClick={() => navigate("/hr?section=reportesAsistencia")}>
            Ver RRHH →
          </button>
        </article>

        <article className={`cc-semaphore cc-semaphore--${semaphores.costs}`}>
          <div className="cc-semaphore__head">
            <span className="cc-semaphore__icon" aria-hidden="true">💹</span>
            <span className="cc-semaphore__lamp" />
          </div>
          <strong>Costos</strong>
          <div className="cc-semaphore__metrics">
            <p>{money(costs.financialImpact)} merma financiera</p>
            <p>{costs.yieldBelowMinimum} bajo rendimiento · {costs.zeroCostRecipes} recetas sin costo</p>
          </div>
          <button type="button" className="cc-semaphore__link" onClick={() => navigate("/reports?tab=yields")}>
            Ver Costos →
          </button>
        </article>
      </div>
    </section>
  )
}

export function CommandCenterAlertsSummary({ alerts }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const summary = summarizeAlerts(alerts)

  return (
    <>
      <article className={`cc-summary-card ${summary.total ? "cc-summary-card--active" : "cc-summary-card--ok"}`}>
        <div className="cc-summary-card__head">
          <h3>Alertas</h3>
          <span className="cc-summary-card__total">{summary.total}</span>
        </div>

        {summary.total ? (
          <>
            <div className="cc-summary-card__counts">
              <span className="cc-count cc-count--critical">{summary.critical} críticas</span>
              <span className="cc-count cc-count--high">{summary.high} altas</span>
              <span className="cc-count cc-count--medium">{summary.medium} medias</span>
              {summary.low > 0 && <span className="cc-count cc-count--low">{summary.low} bajas</span>}
            </div>
            {summary.top && (
              <div className={`cc-summary-card__preview cc-summary-card__preview--${summary.top.priority}`}>
                <span aria-hidden="true">{summary.top.icon}</span>
                <div>
                  <strong>{summary.top.title}</strong>
                  <p>{summary.top.description}</p>
                </div>
              </div>
            )}
            <button type="button" className="cc-summary-card__action" onClick={() => setOpen(true)}>
              Ver alertas
            </button>
          </>
        ) : (
          <>
            <p className="cc-summary-card__stable">✓ Operación estable. Sin alertas activas.</p>
            <button type="button" className="cc-summary-card__action cc-summary-card__action--ghost" onClick={() => setOpen(true)}>
              Ver alertas
            </button>
          </>
        )}
      </article>

      <CommandCenterDrawer open={open} title="Alertas que requieren atención" onClose={() => setOpen(false)}>
        <AlertList alerts={alerts} navigate={navigate} />
      </CommandCenterDrawer>
    </>
  )
}

function ActivityTimeline({ activity, navigate, compact = false }) {
  const rows = compact ? activity.slice(0, ACTIVITY_PREVIEW) : activity

  if (!activity.length) {
    return (
      <div className="cc-empty cc-empty--compact">
        <span className="cc-empty__icon" aria-hidden="true">🕐</span>
        <span>Aún no hay actividad reciente registrada para este período.</span>
      </div>
    )
  }

  return (
    <div className={`cc-timeline ${compact ? "cc-timeline--compact" : ""}`}>
      {rows.map((event) => (
        <div key={event.id} className="cc-timeline__item">
          <span className="cc-timeline__dot" />
          <div className="cc-timeline__body">
            <span className="cc-timeline__time">{event.time}</span>
            <span className="cc-timeline__title">{event.title}</span>
            <span className="cc-timeline__area">{event.area}</span>
            {!compact && event.to && (
              <button type="button" className="cc-timeline__link" onClick={() => navigate(event.to)}>
                Ver detalle
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export function CommandCenterActivitySummary({ activity }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const hasMore = activity.length > ACTIVITY_PREVIEW

  return (
    <>
      <article className="cc-summary-card cc-summary-card--activity">
        <div className="cc-summary-card__head">
          <h3>Actividad reciente</h3>
          <span className="cc-summary-card__total cc-summary-card__total--muted">{activity.length}</span>
        </div>

        <div className="cc-summary-card__scroll">
          <ActivityTimeline activity={activity} navigate={navigate} compact />
        </div>

        {hasMore && (
          <button type="button" className="cc-summary-card__action" onClick={() => setOpen(true)}>
            Ver actividad
          </button>
        )}
        {!activity.length && (
          <button type="button" className="cc-summary-card__action cc-summary-card__action--ghost" onClick={() => setOpen(true)}>
            Ver actividad
          </button>
        )}
      </article>

      <CommandCenterDrawer open={open} title="Actividad operativa reciente" onClose={() => setOpen(false)}>
        <ActivityTimeline activity={activity} navigate={navigate} />
      </CommandCenterDrawer>
    </>
  )
}

export function CommandCenterInsightsRow({ alerts, activity }) {
  return (
    <div className="cc-insights cc-insights--split">
      <CommandCenterAlertsSummary alerts={alerts} />
      <CommandCenterActivitySummary activity={activity} />
    </div>
  )
}

/** @deprecated Use CommandCenterAlertsSummary inside CommandCenterInsightsRow */
export function CommandCenterAlerts({ alerts }) {
  return <CommandCenterAlertsSummary alerts={alerts} />
}

/** @deprecated Use CommandCenterActivitySummary inside CommandCenterInsightsRow */
export function CommandCenterActivity({ activity }) {
  return <CommandCenterActivitySummary activity={activity} />
}

export default function CommandCenterLayer({ recentTasks = [], showHeaderActions = false }) {
  const state = useCommandCenter(recentTasks)

  if (state.initialLoading) {
    return (
      <div className="cc-layer cc-layer--loading" aria-busy="true" aria-label="Cargando centro de comando">
        <div className="cc-loading cc-loading--skeleton">
          <div className="cc-skeleton-grid">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="cc-skeleton-card" aria-hidden="true" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="cc-layer cc-dashboard cc-dashboard--compact">
      {state.refreshing ? (
        <p className="cc-refresh-banner" role="status">Actualizando indicadores…</p>
      ) : null}
      {state.refreshError ? (
        <p className="cc-error cc-error--inline" role="alert">{state.refreshError}</p>
      ) : null}
      <CommandCenterHeader now={state.now} overallStatus={state.overallStatus} showActions={showHeaderActions} />
      {state.error && <p className="cc-error" role="alert">{state.error}</p>}
      <CommandCenterSemaphores
        semaphores={state.semaphores}
        productionActive={state.productionActive}
        productionLate={state.productionLate}
        productionAvg={state.productionAvg}
        inventoryOut={state.inventoryOut}
        inventoryLow={state.inventoryLow}
        pendingRequisitions={state.pendingRequisitions}
        hr={state.hr}
        costs={state.costs}
      />
      <CommandCenterInsightsRow alerts={state.alerts} activity={state.activity} />
    </div>
  )
}

export { useCommandCenter }
