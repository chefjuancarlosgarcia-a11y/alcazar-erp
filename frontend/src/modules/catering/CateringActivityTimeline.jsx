import { ACTIVITY_TYPE_LABELS, formatDateTime } from "./cateringUtils"

export default function CateringActivityTimeline({ activities, loading }) {
  if (loading) {
    return <p className="catering-empty">Cargando actividad...</p>
  }

  if (!activities.length) {
    return <p className="catering-empty">Sin actividad registrada.</p>
  }

  return (
    <ol className="catering-timeline">
      {activities.map((entry) => (
        <li key={entry.id} className="catering-timeline-item">
          <time>{formatDateTime(entry.created_at)}</time>
          <strong>{ACTIVITY_TYPE_LABELS[entry.activity_type] || entry.activity_type}</strong>
          <p>{entry.description}</p>
        </li>
      ))}
    </ol>
  )
}
