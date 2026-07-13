import { OPERATIONAL_TASK_LABEL_COLORS } from "../../config/operationalTasksConfig"
import "./operationalTasks.css"

export const TASK_LABEL_COLOR_KEYS = Object.keys(OPERATIONAL_TASK_LABEL_COLORS)

export default function TaskLabelColorSwatches({ value = "teal", onChange, disabled = false }) {
  return (
    <div className="ot-label-colors" role="radiogroup" aria-label="Color de etiqueta">
      {TASK_LABEL_COLOR_KEYS.map((colorKey) => {
        const palette = OPERATIONAL_TASK_LABEL_COLORS[colorKey]
        const active = value === colorKey
        return (
          <button
            key={colorKey}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={colorKey}
            className={`ot-label-colors__swatch${active ? " is-active" : ""}`}
            style={{ backgroundColor: palette.bg }}
            disabled={disabled}
            onClick={() => onChange?.(colorKey)}
          />
        )
      })}
    </div>
  )
}
