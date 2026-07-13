import { useEffect, useMemo, useState } from "react"
import { labelColorStyle } from "../../config/operationalTasksConfig"
import TaskLabelColorSwatches from "./TaskLabelColorSwatches"
import "./operationalTasks.css"

export default function TaskLabelsPicker({
  open = false,
  catalog = [],
  selectedIds = [],
  saving = false,
  canAdminister = false,
  onClose,
  onToggleLabel,
  onCreateLabel,
  onUpdateLabel,
  onDeleteLabel
}) {
  const [search, setSearch] = useState("")
  const [mode, setMode] = useState("list")
  const [editingLabel, setEditingLabel] = useState(null)
  const [draftName, setDraftName] = useState("")
  const [draftColor, setDraftColor] = useState("teal")
  const [formSaving, setFormSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setSearch("")
    setMode("list")
    setEditingLabel(null)
    setDraftName("")
    setDraftColor("teal")
    setFormSaving(false)
  }, [open])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const filteredCatalog = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return catalog
    return catalog.filter((label) => label.name?.toLowerCase().includes(query))
  }, [catalog, search])

  if (!open) return null

  function openCreate() {
    setEditingLabel(null)
    setDraftName("")
    setDraftColor("teal")
    setMode("create")
  }

  function openEdit(label) {
    setEditingLabel(label)
    setDraftName(label.name || "")
    setDraftColor(label.color_key || "teal")
    setMode("edit")
  }

  function backToList() {
    setMode("list")
    setEditingLabel(null)
    setDraftName("")
    setDraftColor("teal")
  }

  async function submitForm() {
    const name = draftName.trim()
    if (!name) return
    setFormSaving(true)
    try {
      if (mode === "create") {
        await onCreateLabel?.({ name, colorKey: draftColor })
        backToList()
      } else if (mode === "edit" && editingLabel?.id) {
        await onUpdateLabel?.(editingLabel.id, { name, colorKey: draftColor })
        backToList()
      }
    } finally {
      setFormSaving(false)
    }
  }

  async function confirmDelete() {
    if (!editingLabel?.id) return
    const labelName = editingLabel.name || "esta etiqueta"
    if (!window.confirm(`¿Eliminar "${labelName}"? Se quitará de todas las tarjetas.`)) return
    setFormSaving(true)
    try {
      await onDeleteLabel?.(editingLabel.id)
      backToList()
    } finally {
      setFormSaving(false)
    }
  }

  const busy = saving || formSaving

  return (
    <div className="ot-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ot-modal erp-card ot-labels-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Etiquetas de la tarea"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="ot-labels-picker__head">
          <h3>
            {mode === "create" ? "Crear etiqueta" : mode === "edit" ? "Editar etiqueta" : "Etiquetas"}
          </h3>
          <button type="button" className="cc-drawer__close" onClick={onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>

        {mode === "list" ? (
          <>
            <input
              type="search"
              className="ot-labels-picker__search"
              placeholder="Buscar etiquetas..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Buscar etiquetas"
            />

            <p className="ot-labels-picker__section-title">Etiquetas</p>
            <ul className="ot-labels-picker__list">
              {filteredCatalog.map((label) => {
                const checked = selectedSet.has(label.id)
                return (
                  <li key={label.id} className="ot-labels-picker__row">
                    <label className="ot-labels-picker__check">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={busy}
                        onChange={(event) => onToggleLabel?.(label.id, event.target.checked)}
                      />
                      <span className="ot-labels-picker__pill" style={labelColorStyle(label.color_key)}>
                        {label.name}
                      </span>
                    </label>
                    {canAdminister ? (
                      <button
                        type="button"
                        className="ot-labels-picker__edit"
                        aria-label={`Editar ${label.name}`}
                        disabled={busy}
                        onClick={() => openEdit(label)}
                      >
                        ✎
                      </button>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            {!filteredCatalog.length ? (
              <p className="ot-muted ot-labels-picker__empty">
                {search.trim() ? "Sin coincidencias." : "No hay etiquetas todavía."}
              </p>
            ) : null}

            {canAdminister ? (
              <button type="button" className="ot-btn ot-btn--ghost ot-labels-picker__create" onClick={openCreate} disabled={busy}>
                Crear una etiqueta nueva
              </button>
            ) : null}
          </>
        ) : (
          <div className="ot-labels-picker__form">
            <label className="ot-field">
              <span>Nombre</span>
              <input
                type="text"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Nombre de la etiqueta"
                maxLength={48}
                disabled={busy}
                autoFocus
              />
            </label>

            <p className="ot-labels-picker__section-title">Color</p>
            <TaskLabelColorSwatches value={draftColor} onChange={setDraftColor} disabled={busy} />

            <div className="ot-labels-picker__preview">
              <span className="ot-labels-picker__pill" style={labelColorStyle(draftColor)}>
                {draftName.trim() || "Vista previa"}
              </span>
            </div>

            <div className="ot-modal__actions">
              <button type="button" className="ot-btn ot-btn--ghost" onClick={backToList} disabled={busy}>
                Volver
              </button>
              {mode === "edit" ? (
                <button type="button" className="ot-btn ot-btn--danger" onClick={confirmDelete} disabled={busy}>
                  Eliminar
                </button>
              ) : null}
              <button
                type="button"
                className="ot-btn ot-btn--primary"
                onClick={submitForm}
                disabled={busy || !draftName.trim()}
              >
                {busy ? "Guardando..." : mode === "create" ? "Crear" : "Guardar"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
