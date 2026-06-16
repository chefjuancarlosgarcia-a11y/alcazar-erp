import CompletenessBar from "./CompletenessBar"
import { EXPEDIENTE_STATUS, formatDate, statusClass } from "./expedientesUtils"

export default function ExpedientesList({ rows, loading, selectedId, onSelect }) {
  if (loading) {
    return (
      <section className="expediente-panel">
        <h2>Expedientes</h2>
        <p className="expediente-empty">Cargando expedientes...</p>
      </section>
    )
  }

  if (!rows.length) {
    return (
      <section className="expediente-panel">
        <h2>Expedientes</h2>
        <p className="expediente-empty">No hay expedientes con los filtros actuales.</p>
      </section>
    )
  }

  return (
    <section className="expediente-panel">
      <h2>Expedientes ({rows.length})</h2>
      <div className="expediente-card-list">
        {rows.map((row) => {
          const statusMeta = EXPEDIENTE_STATUS[row.status] || EXPEDIENTE_STATUS.incomplete
          return (
            <button
              key={row.profile_id}
              type="button"
              className={`expediente-row-card ${selectedId === row.profile_id ? "is-active" : ""}`}
              onClick={() => onSelect(row.profile_id)}
            >
              <div className="expediente-row-card__identity">
                {row.avatar_url ? (
                  <img src={row.avatar_url} alt="" className="expediente-avatar" />
                ) : (
                  <span className="expediente-avatar">{row.full_name?.slice(0, 1) || "?"}</span>
                )}
                <div>
                  <strong>{row.full_name}</strong>
                  <small>{row.job_title || "—"} · {row.area_name || "—"}</small>
                </div>
              </div>
              <div className="expediente-row-card__metrics">
                <span className={statusClass(row.status)}>{statusMeta.label}</span>
                <CompletenessBar completeness={row.completeness} />
                <small>Vencidos: {row.expired_count ?? 0} · Proximo: {formatDate(row.next_expiry)}</small>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
