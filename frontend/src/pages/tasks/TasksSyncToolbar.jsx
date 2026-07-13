import { formatLastSyncedAt } from "../../hooks/useOperationalTasksSync"

export default function TasksSyncToolbar({
  refreshing = false,
  lastSyncedAt = null,
  onRefresh,
  disabled = false
}) {
  return (
    <div className="ot-sync-toolbar">
      <button
        type="button"
        className="ot-btn ot-btn--ghost ot-sync-toolbar__btn"
        onClick={() => onRefresh?.({ source: "manual" })}
        disabled={disabled || refreshing}
        aria-busy={refreshing}
      >
        {refreshing ? "Actualizando..." : "Actualizar"}
      </button>
      <span className="ot-sync-toolbar__meta">
        Última actualización: {formatLastSyncedAt(lastSyncedAt)}
      </span>
    </div>
  )
}
