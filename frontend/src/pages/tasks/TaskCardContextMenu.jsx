import { useEffect, useRef } from "react"
import {
  OPERATIONAL_TASK_STATUSES,
  labelForOperationalStatus
} from "../../config/operationalTasksConfig"
import { copyOperationalTaskLink } from "./taskCardUtils"

export default function TaskCardContextMenu({
  task,
  open = false,
  canEdit = false,
  canMove = false,
  canArchive = false,
  linkView = "tablero",
  onOpen,
  onEditTitle,
  onEditMembers,
  onEditDue,
  onStatusChange,
  onCopyLink,
  onArchive,
  onClose
}) {
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) onClose?.()
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose?.()
    }
    window.addEventListener("mousedown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      window.removeEventListener("mousedown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, onClose])

  if (!task || !open) return null

  async function handleAction(actionId) {
    if (actionId === "open") {
      onOpen?.(task.id)
      onClose?.()
      return
    }
    if (actionId === "edit_title") {
      onEditTitle?.(task.id)
      onClose?.()
      return
    }
    if (actionId === "edit_members") {
      onEditMembers?.(task.id)
      onClose?.()
      return
    }
    if (actionId === "edit_due") {
      onEditDue?.(task.id)
      onClose?.()
      return
    }
    if (actionId === "copy_link") {
      await copyOperationalTaskLink(task.id, linkView)
      onCopyLink?.()
      onClose?.()
      return
    }
    if (actionId === "archive") {
      onArchive?.(task.id)
      onClose?.()
    }
  }

  function handleStatusSelect(statusId) {
    if (statusId === task.status) return
    onStatusChange?.(task.id, statusId)
    onClose?.()
  }

  const statusOptions = OPERATIONAL_TASK_STATUSES.filter(
    (row) => row.id !== "cancelled" && row.id !== task.status
  )

  return (
    <div className="ot-card-menu__panel" ref={rootRef} role="menu" onClick={(event) => event.stopPropagation()}>
      <button type="button" className="ot-card-menu__item" role="menuitem" onClick={() => handleAction("open")}>
        Abrir tarjeta
      </button>
      {canEdit ? (
        <>
          <button type="button" className="ot-card-menu__item" onClick={() => handleAction("edit_title")}>
            Editar título
          </button>
          <button type="button" className="ot-card-menu__item" onClick={() => handleAction("edit_members")}>
            Cambiar responsable o participantes
          </button>
          <button type="button" className="ot-card-menu__item" onClick={() => handleAction("edit_due")}>
            Editar fecha límite
          </button>
        </>
      ) : null}
      {canMove ? (
        <div className="ot-card-menu__group">
          <span className="ot-card-menu__label">Cambiar estado</span>
          {statusOptions.map((row) => (
            <button
              key={row.id}
              type="button"
              className="ot-card-menu__item"
              onClick={() => handleStatusSelect(row.id)}
            >
              {row.label}
            </button>
          ))}
        </div>
      ) : null}
      <button type="button" className="ot-card-menu__item" onClick={() => handleAction("copy_link")}>
        Copiar enlace
      </button>
      {canArchive ? (
        <button type="button" className="ot-card-menu__item" onClick={() => handleAction("archive")}>
          Archivar
        </button>
      ) : null}
    </div>
  )
}

export { labelForOperationalStatus }
