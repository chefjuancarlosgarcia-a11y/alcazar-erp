import CateringSlaBadge from "./CateringSlaBadge"
import {
  CONVERSION_STATUS_LABELS,
  conversionStatusClass,
  followUpAlertClass,
  formatDate,
  formatProducts,
  formatTime,
  getFollowUpAlert,
  leadSourceLabel
} from "./cateringUtils"

export default function CateringRequestsList({
  requests,
  profilesById,
  loading,
  selectedId,
  onSelect
}) {
  if (loading) {
    return (
      <section className="catering-panel">
        <h2>Solicitudes</h2>
        <p className="catering-empty">Cargando solicitudes...</p>
      </section>
    )
  }

  if (!requests.length) {
    return (
      <section className="catering-panel">
        <h2>Solicitudes</h2>
        <p className="catering-empty">No hay solicitudes con los filtros actuales.</p>
      </section>
    )
  }

  return (
    <section className="catering-panel">
      <h2>Solicitudes ({requests.length})</h2>
      <div className="catering-table-wrap">
        <table className="catering-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Origen</th>
              <th>SLA</th>
              <th>Evento</th>
              <th>Fecha evento</th>
              <th>Estado comercial</th>
              <th>Seguimiento</th>
              <th>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const assignee = request.assigned_to ? profilesById[request.assigned_to] : null
              const followUpAlert = getFollowUpAlert(request)
              return (
                <tr
                  key={request.id}
                  className={selectedId === request.id ? "is-active" : ""}
                  onClick={() => onSelect(request.id)}
                >
                  <td>{formatDate(request.created_at?.slice?.(0, 10) || request.created_at)}</td>
                  <td>
                    <strong>{request.customer_name || "—"}</strong>
                    <small>{request.customer_phone || request.customer_email || "—"}</small>
                  </td>
                  <td>{leadSourceLabel(request.lead_source)}</td>
                  <td><CateringSlaBadge request={request} /></td>
                  <td className="catering-products">{formatProducts(request.products_requested)}</td>
                  <td>
                    {formatDate(request.event_date)}
                    {request.event_time ? ` ${formatTime(request.event_time)}` : ""}
                  </td>
                  <td>
                    <span className={conversionStatusClass(request.conversion_status)}>
                      {CONVERSION_STATUS_LABELS[request.conversion_status] || request.conversion_status || "—"}
                    </span>
                  </td>
                  <td>
                    {followUpAlert ? (
                      <span className={followUpAlertClass(followUpAlert.level)}>{followUpAlert.label}</span>
                    ) : (
                      formatDate(request.follow_up_date)
                    )}
                  </td>
                  <td>{assignee?.full_name || assignee?.username || "Sin asignar"}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
