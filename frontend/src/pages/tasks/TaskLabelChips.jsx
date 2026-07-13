import { labelColorStyle } from "../../config/operationalTasksConfig"
import "./operationalTasks.css"

export default function TaskLabelChips({
  labels = [],
  max = 4,
  interactive = false,
  onLabelClick
}) {
  if (!labels.length) return null
  const visible = labels.slice(0, max)
  const overflow = labels.length - visible.length

  return (
    <div className="ot-label-chips" aria-label="Etiquetas">
      {visible.map((label) => (
        <button
          key={label.id}
          type="button"
          className={`ot-label-chip ot-label-chip--${label.color_key || "teal"}`}
          style={labelColorStyle(label.color_key)}
          title={label.name}
          onClick={interactive ? (event) => {
            event.stopPropagation()
            onLabelClick?.(label)
          } : (event) => event.stopPropagation()}
          tabIndex={interactive ? 0 : -1}
        >
          {label.name}
        </button>
      ))}
      {overflow > 0 ? (
        <span className="ot-label-chip ot-label-chip--more">+{overflow}</span>
      ) : null}
    </div>
  )
}
