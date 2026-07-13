import { useState } from "react"
import "./operationalTasks.css"

export default function CreateStepListModal({ open, lists = [], saving = false, onClose, onConfirm }) {
  const [title, setTitle] = useState("Plan de trabajo")
  const [copyFromListId, setCopyFromListId] = useState("")

  if (!open) return null

  return (
    <div className="ot-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ot-modal erp-card"
        role="dialog"
        aria-modal="true"
        aria-label="Nueva lista de pasos"
        onClick={(event) => event.stopPropagation()}
      >
        <h3>Nueva lista</h3>
        <label className="ot-field">
          <span>Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="ot-field">
          <span>Copiar desde</span>
          <select value={copyFromListId} onChange={(event) => setCopyFromListId(event.target.value)}>
            <option value="">Ninguno</option>
            {lists.map((list) => (
              <option key={list.id} value={list.id}>{list.title}</option>
            ))}
          </select>
        </label>
        <div className="ot-modal__actions">
          <button type="button" className="ot-btn ot-btn--ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            type="button"
            className="ot-btn ot-btn--primary"
            disabled={saving || !title.trim()}
            onClick={() => onConfirm({
              title: title.trim(),
              copyFromListId: copyFromListId || null
            })}
          >
            {saving ? "Guardando..." : "Añadir lista"}
          </button>
        </div>
      </div>
    </div>
  )
}
