import "./OperationalAlertToast.css"

export default function OperationalAlertToast({
  alerts,
  onDismiss
}) {
  if (!alerts.length) return null
  return (
    <div className="operational-alerts" aria-live="polite">
      <div className="operational-alert-list">
        {alerts.map((alert) => (
          <article className="operational-alert-toast" key={alert.id}>
            <div className="operational-alert-icon">{alert.icon}</div>
            <div>
              <strong>{alert.title}</strong>
              <p>{alert.message}</p>
              <small>{alert.createdAt}</small>
            </div>
            <div className="operational-alert-actions">
              {alert.onView && <button type="button" onClick={alert.onView}>{alert.actionLabel || "Ver"}</button>}
              <button type="button" className="ghost" onClick={() => onDismiss(alert.id)}>Cerrar</button>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
