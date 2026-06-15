import { CONVERSION_STATUS_LABELS, followUpAlertClass, formatDate } from "./cateringUtils"

export default function CateringPendingFollowups({ items, loading, onSelect }) {
  if (loading) {
    return (
      <section className="catering-panel">
        <h2>Seguimientos pendientes</h2>
        <p className="catering-empty">Cargando...</p>
      </section>
    )
  }

  if (!items.length) {
    return (
      <section className="catering-panel">
        <h2>Seguimientos pendientes</h2>
        <p className="catering-empty">No hay seguimientos vencidos ni para hoy.</p>
      </section>
    )
  }

  return (
    <section className="catering-panel">
      <h2>Seguimientos pendientes ({items.length})</h2>
      <div className="catering-followup-list">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="catering-followup-item"
            onClick={() => onSelect?.(item.id)}
          >
            <span className={followUpAlertClass(item.urgency)}>
              {item.urgency === "overdue" ? "Vencido" : "Hoy"}
            </span>
            <strong>{item.customer_name || "Cliente"}</strong>
            <small>
              {formatDate(item.follow_up_date)}
              {" · "}
              {CONVERSION_STATUS_LABELS[item.conversion_status] || item.conversion_status}
            </small>
          </button>
        ))}
      </div>
    </section>
  )
}
