import { useRef, useState } from "react"
import {
  labelForOperationalPriority,
  labelForOperationalWaitingReason,
  OPERATIONAL_TASK_STATUSES
} from "../../config/operationalTasksConfig"
import {
  assigneeLabel,
  formatDueAt,
  initialsForName,
  isMobileViewport,
  nextStepLabel
} from "./taskCardUtils"
import TaskCardContextMenu from "./TaskCardContextMenu"
import TaskLabelChips from "./TaskLabelChips"
import "./operationalTasks.css"

const DRAG_CLICK_THRESHOLD = 8

function AssigneeAvatars({ assignees = [] }) {
  const visible = assignees.slice(0, 4)
  const overflow = assignees.length - visible.length

  if (!visible.length) {
    return <span className="ot-task-card__assignee ot-task-card__assignee--empty">Sin asignar</span>
  }

  return (
    <div
      className="ot-task-card__avatars"
      aria-label={assigneeLabel({ assignees })}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {visible.map((row) => (
        row.avatar_url ? (
          <img
            key={row.profile_id}
            src={row.avatar_url}
            alt={row.full_name || "Colaborador"}
            className="ot-task-card__avatar"
          />
        ) : (
          <span key={row.profile_id} className="ot-task-card__avatar ot-task-card__avatar--initials">
            {initialsForName(row.full_name)}
          </span>
        )
      ))}
      {overflow > 0 ? <span className="ot-task-card__avatar ot-task-card__avatar--more">+{overflow}</span> : null}
    </div>
  )
}

export default function TaskCard({
  task,
  highlighted = false,
  dragging = false,
  linkView = "tablero",
  canEdit = false,
  canMove = false,
  onOpen,
  onEditTitle,
  onEditMembers,
  onEditDue,
  onStatusChange,
  onCopyLink,
  onArchive,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const pointerRef = useRef({ x: 0, y: 0, moved: false, suppressClick: false })
  const isMobile = isMobileViewport()
  const steps = task?.steps_progress
  const showSteps = steps && Number(steps.total) > 0
  const nextStep = nextStepLabel(task)

  function openCard() {
    onOpen?.(task.id)
  }

  function handleCardActivate(event) {
    if (pointerRef.current.suppressClick || pointerRef.current.moved) {
      pointerRef.current.suppressClick = false
      pointerRef.current.moved = false
      return
    }
    if (event?.type === "keydown" && event.key !== "Enter" && event.key !== " ") return
    if (event?.type === "keydown") event.preventDefault()
    openCard()
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return
    pointerRef.current = {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      suppressClick: false
    }
  }

  function handlePointerMove(event) {
    if (pointerRef.current.moved) return
    const dx = Math.abs(event.clientX - pointerRef.current.x)
    const dy = Math.abs(event.clientY - pointerRef.current.y)
    if (dx > DRAG_CLICK_THRESHOLD || dy > DRAG_CLICK_THRESHOLD) {
      pointerRef.current.moved = true
    }
  }

  function handleMobileStatus(event) {
    event.stopPropagation()
    const nextStatus = event.target.value
    if (!nextStatus || nextStatus === task.status) return
    onStatusChange?.(task.id, nextStatus)
    event.target.value = task.status
  }

  return (
    <article
      className={`ot-task-card erp-card ot-task-card--interactive${highlighted ? " is-highlighted" : ""}${dragging ? " is-dragging" : ""}`}
      role="button"
      tabIndex={0}
      aria-label={`Abrir tarea ${task.title}`}
      draggable={!isMobile && canMove}
      onClick={handleCardActivate}
      onKeyDown={handleCardActivate}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onDragStart={(event) => {
        if (isMobile || !canMove) {
          event.preventDefault()
          return
        }
        pointerRef.current.suppressClick = true
        event.dataTransfer.setData("text/task-id", task.id)
        event.dataTransfer.effectAllowed = "move"
        onDragStart?.(task.id)
      }}
      onDragEnd={() => {
        pointerRef.current.suppressClick = true
        window.setTimeout(() => {
          pointerRef.current.suppressClick = false
        }, 0)
        onDragEnd?.()
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDragOver?.(event, task)
      }}
      onDrop={(event) => onDrop?.(event, task)}
    >
      <header className="ot-task-card__head">
        <h3 className="ot-task-card__title">{task.title}</h3>
        <div className="ot-card-menu-wrap" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="ot-card-menu__trigger"
            aria-label="Menú rápido"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation()
              setMenuOpen((value) => !value)
            }}
          >
            ⋯
          </button>
          <TaskCardContextMenu
            task={task}
            open={menuOpen}
            canEdit={canEdit}
            canMove={canMove}
            canArchive={Boolean(task.permissions?.can_archive)}
            linkView={linkView}
            onOpen={onOpen}
            onEditTitle={onEditTitle}
            onEditMembers={onEditMembers}
            onEditDue={onEditDue}
            onStatusChange={onStatusChange}
            onCopyLink={onCopyLink}
            onArchive={onArchive}
            onClose={() => setMenuOpen(false)}
          />
        </div>
      </header>

      <div className="ot-task-card__meta">
        <span className={`erp-badge ot-badge ot-badge--${task.priority || "medium"}`}>
          {labelForOperationalPriority(task.priority)}
        </span>
        {["waiting", "blocked"].includes(task.status) && task.waiting_reason ? (
          <span className="erp-badge ot-badge ot-badge--status">
            {labelForOperationalWaitingReason(task.waiting_reason)}
          </span>
        ) : null}
        {task.is_overdue ? (
          <span className="erp-badge ot-badge ot-badge--critical">Atrasada</span>
        ) : null}
      </div>

      <TaskLabelChips labels={task.labels || []} max={3} />

      {task.objective ? (
        <p className="ot-task-card__objective" title={task.objective}>
          {task.objective}
        </p>
      ) : null}

      {task.expected_result ? (
        <p className="ot-task-card__result" title={task.expected_result}>
          <span className="ot-task-card__result-label">Resultado:</span> {task.expected_result}
        </p>
      ) : null}

      {nextStep ? (
        <p className="ot-task-card__next" title={nextStep}>
          {nextStep}
        </p>
      ) : null}

      <footer className="ot-task-card__foot">
        <div className="ot-task-card__due">
          <span className="ot-task-card__due-label">Vence</span>
          <time className={task.is_overdue ? "is-overdue" : ""}>{formatDueAt(task.due_at, { dateOnly: true })}</time>
        </div>
        <AssigneeAvatars assignees={task.assignees || []} />
      </footer>

      {showSteps ? (
        <div className="ot-task-card__steps" aria-label="Progreso de pasos">
          <span>{steps.done}/{steps.total} pasos</span>
        </div>
      ) : null}

      {isMobile && canMove ? (
        <label className="ot-task-card__mobile-status" onClick={(event) => event.stopPropagation()}>
          <span>Estado</span>
          <select value={task.status} onChange={handleMobileStatus}>
            {OPERATIONAL_TASK_STATUSES.filter((row) => row.id !== "cancelled").map((row) => (
              <option key={row.id} value={row.id}>{row.label}</option>
            ))}
          </select>
        </label>
      ) : null}
    </article>
  )
}

export { assigneeLabel, formatDueAt }
