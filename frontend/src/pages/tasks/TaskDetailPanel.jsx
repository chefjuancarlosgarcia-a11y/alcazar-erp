import { useEffect, useMemo, useRef, useState } from "react"
import {
  labelForOperationalPriority,
  labelForOperationalStatus,
  OPERATIONAL_TASK_PRIORITIES,
  OPERATIONAL_TASK_STATUSES,
  OPERATIONAL_TASK_WAITING_STATUSES,
  waitingStatusKey
} from "../../config/operationalTasksConfig"
import "../../components/commandCenter/CommandCenterLayer.css"
import {
  assigneeLabel,
  copyOperationalTaskLink,
  formatDueAt,
  formatRelativeDays,
  initialsForName,
  labelForActivityAction
} from "./taskCardUtils"
import TaskAddToolbar from "./TaskAddToolbar"
import TaskMembersPopover from "./TaskMembersPopover"
import TaskWaitingPanel from "./TaskWaitingPanel"
import TaskWorkPlan from "./TaskWorkPlan"
import TaskAttachmentsPanel from "./TaskAttachmentsPanel"
import TaskAttachmentUploader from "./TaskAttachmentUploader"
import TaskComments from "./TaskComments"
import TaskEvidencePanel from "./TaskEvidencePanel"
import CreateStepListModal from "./CreateStepListModal"
import TaskLabelChips from "./TaskLabelChips"
import "./operationalTasks.css"

function WideDrawer({ open, onClose, children }) {
  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === "Escape") onClose()
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = ""
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="cc-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="cc-drawer cc-drawer--wide ot-detail-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de tarea"
      >
        {children}
      </aside>
    </div>
  )
}

const ACTIVE_STATUSES = OPERATIONAL_TASK_STATUSES.filter((row) => row.id !== "cancelled")

export default function TaskDetailPanel({
  task,
  loading = false,
  open = false,
  onClose,
  onStatusChange,
  onTaskUpdate,
  onAssigneesChange,
  onWorkPlanAction,
  onOpenLabels,
  onArchive,
  onRestore,
  assignableProfiles = [],
  canAssign = false,
  saving = false,
  linkView = "mi-trabajo",
  focusField = null,
  conflict = null,
  detailError = null,
  onRetryDetail,
  onReloadFromServer,
  onDismissConflict,
  onUnsavedEditsChange,
  detailRefreshing = false,
  currentUserId = null,
  onMessage
}) {
  const titleRef = useRef(null)
  const dueRef = useRef(null)
  const [editTitle, setEditTitle] = useState("")
  const [editObjective, setEditObjective] = useState("")
  const [editExpectedResult, setEditExpectedResult] = useState("")
  const [editPriority, setEditPriority] = useState("medium")
  const [editDueAt, setEditDueAt] = useState("")
  const [titleDirty, setTitleDirty] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [createListOpen, setCreateListOpen] = useState(false)

  const permissions = task?.permissions || {}
  const canEdit = Boolean(permissions.can_edit) && task && !["completed", "cancelled"].includes(task.status)
  const canAssignMembers = Boolean(permissions.manage_members) && canAssign && canEdit
  const canOpenMembers = Boolean(task) && (canAssignMembers || permissions.watch_self)
  const canManagePlan = Boolean(permissions.manage_work_plan) && canEdit
  const canUpload = Boolean(permissions.upload_attachments) && canEdit
  const canComment = Boolean(permissions.comment)
  const canSubmitEvidence = Boolean(permissions.submit_evidence) && canEdit
  const canVerifyEvidence = Boolean(permissions.verify_evidence)

  useEffect(() => {
    if (!task) return
    setEditTitle(task.title || "")
    setEditObjective(task.objective || task.description || "")
    setEditExpectedResult(task.expected_result || "")
    setEditPriority(task.priority || "medium")
    setEditDueAt(task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : "")
    setTitleDirty(false)
  }, [task])

  useEffect(() => {
    if (!open || !focusField) return
    const timer = window.setTimeout(() => {
      if (focusField === "title") titleRef.current?.focus()
      if (focusField === "due") dueRef.current?.focus()
      if (focusField === "members") setMembersOpen(true)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [open, focusField, task?.id])

  const objectiveDirty = useMemo(() => {
    if (!task) return false
    return (editObjective || "") !== (task.objective || task.description || "")
  }, [editObjective, task])

  const expectedResultDirty = useMemo(() => {
    if (!task) return false
    return (editExpectedResult || "") !== (task.expected_result || "")
  }, [editExpectedResult, task])

  const dueDirty = useMemo(() => {
    if (!task) return false
    const original = task.due_at ? new Date(task.due_at).toISOString().slice(0, 16) : ""
    return editDueAt !== original
  }, [editDueAt, task])

  const hasUnsavedChanges = titleDirty || objectiveDirty || expectedResultDirty || dueDirty

  useEffect(() => {
    onUnsavedEditsChange?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, onUnsavedEditsChange])

  function requestClose() {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("Hay cambios sin guardar. ¿Cerrar sin guardar?")
      if (!confirmed) return
    }
    onClose?.()
  }

  const visibleActivity = useMemo(
    () => (task?.activity || []).filter((row) => row.action !== "moved"),
    [task]
  )

  const lastActivity = visibleActivity[0]

  const primaryAssignee = useMemo(() => {
    if (!task) return null
    if (task.primary_assignee) return task.primary_assignee
    return (task.assignees || []).find((row) => row.assignment_role === "primary") || task.assignees?.[0] || null
  }, [task])

  const secondaryAssignees = useMemo(() => {
    if (!task) return []
    const primaryId = primaryAssignee?.profile_id
    return (task.assignees || []).filter((row) => row.profile_id !== primaryId)
  }, [task, primaryAssignee])

  const extraWatchers = useMemo(() => {
    if (!task) return []
    const assigneeIds = new Set((task.assignees || []).map((row) => row.profile_id))
    return (task.watchers || []).filter((row) => !assigneeIds.has(row.profile_id))
  }, [task])

  const statusSelectValue = useMemo(() => {
    if (!task) return "pending"
    if (["waiting", "blocked"].includes(task.status)) {
      return waitingStatusKey(task.status, task.waiting_reason)
    }
    return task.status
  }, [task])

  async function saveObjective() {
    if (!task?.id || !onTaskUpdate || !canEdit) return
    await onTaskUpdate(task.id, { objective: editObjective })
  }

  async function saveExpectedResult() {
    if (!task?.id || !onTaskUpdate || !canEdit) return
    await onTaskUpdate(task.id, { expected_result: editExpectedResult })
  }

  async function saveTitle() {
    if (!task?.id || !onTaskUpdate || !canEdit) return
    const title = editTitle.trim()
    if (!title) return
    await onTaskUpdate(task.id, { title })
    setTitleDirty(false)
  }

  async function savePriority(priority) {
    if (!task?.id || !onTaskUpdate || !canEdit) return
    setEditPriority(priority)
    await onTaskUpdate(task.id, { priority })
  }

  async function saveDueAt() {
    if (!task?.id || !onTaskUpdate || !canEdit) return
    await onTaskUpdate(task.id, {
      due_at: editDueAt ? new Date(editDueAt).toISOString() : null
    })
  }

  async function handleStatusSelect(value) {
    if (!task?.id || !onStatusChange) return
    const waitingRow = OPERATIONAL_TASK_WAITING_STATUSES.find(
      (row) => waitingStatusKey(row.status, row.waitingReason) === value
    )
    if (waitingRow) {
      await onStatusChange(task.id, {
        status: waitingRow.status,
        waitingReason: waitingRow.waitingReason,
        waitingUnblockNote: task.waiting_unblock_note || null
      })
      return
    }
    if (value === task.status) return
    await onStatusChange(task.id, { status: value })
  }

  async function handleWaitingSave(payload) {
    if (!task?.id || !onStatusChange) return
    await onStatusChange(task.id, {
      status: task.status,
      waitingReason: payload.waitingReason,
      waitingUnblockNote: payload.waitingUnblockNote
    })
    if (payload.waitingUnblockNote !== task.waiting_unblock_note) {
      await onTaskUpdate?.(task.id, { waiting_unblock_note: payload.waitingUnblockNote || null })
    }
  }

  async function handleMembersSave(payload) {
    if (!task?.id || !onAssigneesChange) return
    await onAssigneesChange(task.id, payload)
    setMembersOpen(false)
  }

  async function handleCopyLink() {
    await copyOperationalTaskLink(task.id, linkView)
    onMessage?.("Enlace copiado.", "success")
  }

  const workPlanHandlers = {
    onCreateList: (payload) => onWorkPlanAction?.("createList", payload),
    onDeleteList: (listId) => onWorkPlanAction?.("deleteList", listId),
    onCreateStep: (listId, text) => onWorkPlanAction?.("createStep", { listId, text }),
    onToggleStep: (stepId, completed) => onWorkPlanAction?.("toggleStep", { stepId, completed }),
    onUpdateStep: (stepId, data) => onWorkPlanAction?.("updateStep", { stepId, data }),
    onDeleteStep: (stepId) => onWorkPlanAction?.("deleteStep", stepId),
    onConvertStep: (stepId) => onWorkPlanAction?.("convertStep", stepId)
  }

  return (
    <WideDrawer open={open} onClose={requestClose}>
      <header className="ot-detail-panel__head">
        <div className="ot-detail-panel__title-wrap">
          {canEdit ? (
            <input
              ref={titleRef}
              className="ot-detail-panel__title-input"
              value={editTitle}
              onChange={(event) => {
                setEditTitle(event.target.value)
                setTitleDirty(true)
              }}
              onBlur={saveTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  saveTitle()
                }
              }}
              aria-label="Título de la tarea"
            />
          ) : (
            <h2>{task?.title || "Detalle de tarea"}</h2>
          )}
          <div className="ot-detail-panel__badges">
            {task ? (
              <>
                <span className={`erp-badge ot-badge ot-badge--${task.priority || "medium"}`}>
                  {labelForOperationalPriority(task.priority)}
                </span>
                <span className="erp-badge ot-badge ot-badge--status">
                  {labelForOperationalStatus(task.status)}
                </span>
                {task.is_overdue ? (
                  <span className="erp-badge ot-badge ot-badge--critical">Atrasada</span>
                ) : null}
              </>
            ) : null}
          </div>
          {task?.labels?.length ? (
            <TaskLabelChips labels={task.labels} max={8} />
          ) : null}
        </div>
        <div className="ot-detail-panel__actions">
          {task?.permissions?.assign_labels ? (
            <button type="button" className="ot-btn ot-btn--ghost" onClick={() => onOpenLabels?.()} disabled={!task}>
              Etiquetas
            </button>
          ) : null}
          {task?.permissions?.can_archive ? (
            <button type="button" className="ot-btn ot-btn--ghost" onClick={() => onArchive?.(task.id)} disabled={saving}>
              Archivar
            </button>
          ) : null}
          {task?.permissions?.can_restore ? (
            <button type="button" className="ot-btn ot-btn--primary" onClick={() => onRestore?.(task.id)} disabled={saving}>
              Restaurar
            </button>
          ) : null}
          <button type="button" className="ot-btn ot-btn--ghost" onClick={handleCopyLink} disabled={!task}>
            Copiar enlace
          </button>
          <button type="button" className="cc-drawer__close" onClick={requestClose} aria-label="Cerrar">
            ✕
          </button>
        </div>
      </header>

      <div className="ot-detail-panel__body">
        {detailRefreshing ? (
          <p className="ot-muted ot-detail-panel__sync-hint">Sincronizando cambios del servidor...</p>
        ) : null}
        {conflict ? (
          <div className="ot-conflict-banner erp-card" role="status">
            <p>Esta tarea cambió mientras la estabas editando.</p>
            <div className="ot-conflict-banner__actions">
              <button type="button" className="ot-btn ot-btn--primary" onClick={onReloadFromServer}>
                Recargar datos
              </button>
              <button type="button" className="ot-btn ot-btn--ghost" onClick={onDismissConflict}>
                Mantener cambios locales
              </button>
            </div>
          </div>
        ) : null}
        {loading ? <p className="ot-muted">Cargando tarea...</p> : null}
        {!loading && detailError ? (
          <div className="ot-detail-error erp-card" role="alert">
            <p>{detailError}</p>
            <button
              type="button"
              className="ot-btn ot-btn--primary"
              onClick={() => onRetryDetail?.()}
              disabled={loading}
            >
              Reintentar
            </button>
          </div>
        ) : null}
        {!loading && !detailError && !task ? (
          <p className="ot-muted">No se encontró la tarea o no tienes acceso.</p>
        ) : null}
        {!loading && !detailError && task ? (
          <>
            <TaskAddToolbar
              onMembersClick={() => setMembersOpen(true)}
              onStepListClick={() => setCreateListOpen(true)}
              onAttachmentClick={() => setAttachmentOpen(true)}
              canOpenMembers={canOpenMembers}
              canManagePlan={canManagePlan}
              canUploadAttachments={canUpload}
            />
            <div className="ot-detail-panel__grid">
              <div className="ot-detail-panel__main erp-section-stack">
                <section className="ot-detail-block erp-card erp-card--form ot-detail-block--focus">
                  <header className="ot-detail-block__head">
                    <span className="ot-detail-block__icon ot-detail-block__icon--objective" aria-hidden="true" />
                    <div>
                      <h3 className="ot-detail-block__title">Objetivo</h3>
                      <p className="ot-detail-block__hint">Qué problema resolvemos o qué hay que lograr</p>
                    </div>
                  </header>
                  <div className="ot-detail-block__content">
                    {canEdit ? (
                      <textarea
                        className="ot-detail-panel__textarea"
                        value={editObjective}
                        onChange={(event) => setEditObjective(event.target.value)}
                        onBlur={saveObjective}
                        rows={3}
                        placeholder="Describe el objetivo operativo de esta tarea"
                      />
                    ) : (
                      <p className="ot-detail-readonly">{task.objective || task.description || "Sin objetivo definido."}</p>
                    )}
                  </div>
                </section>

                <section className="ot-detail-block erp-card erp-card--form ot-detail-block--focus">
                  <header className="ot-detail-block__head">
                    <span className="ot-detail-block__icon ot-detail-block__icon--result" aria-hidden="true" />
                    <div>
                      <h3 className="ot-detail-block__title">Resultado esperado</h3>
                      <p className="ot-detail-block__hint">Cómo sabremos que quedó bien hecho</p>
                    </div>
                  </header>
                  <div className="ot-detail-block__content">
                    {canEdit ? (
                      <textarea
                        className="ot-detail-panel__textarea"
                        value={editExpectedResult}
                        onChange={(event) => setEditExpectedResult(event.target.value)}
                        onBlur={saveExpectedResult}
                        rows={2}
                        placeholder="Define la condición de éxito o entregable final"
                      />
                    ) : (
                      <p className="ot-detail-readonly">{task.expected_result || "Sin resultado esperado definido."}</p>
                    )}
                  </div>
                </section>

                <div className="ot-detail-plan-divider" role="presentation">
                  <span>Plan de trabajo</span>
                </div>

                <section className="ot-detail-block erp-card erp-card--form ot-detail-block--compact">
                  <div className="ot-detail-panel__fields">
                    <label className="ot-field ot-field--detail">
                      <span>Estado</span>
                      {permissions.can_move && canEdit ? (
                        <select
                          className="ot-detail-control"
                          value={statusSelectValue}
                          onChange={(event) => handleStatusSelect(event.target.value)}
                          disabled={saving}
                        >
                          {ACTIVE_STATUSES.filter((row) => !["waiting", "blocked"].includes(row.id)).map((row) => (
                            <option key={row.id} value={row.id}>{row.label}</option>
                          ))}
                          <optgroup label="Espera / bloqueo">
                            {OPERATIONAL_TASK_WAITING_STATUSES.map((row) => (
                              <option
                                key={waitingStatusKey(row.status, row.waitingReason)}
                                value={waitingStatusKey(row.status, row.waitingReason)}
                              >
                                {row.label}
                              </option>
                            ))}
                          </optgroup>
                        </select>
                      ) : (
                        <p className="ot-detail-readonly">{labelForOperationalStatus(task.status)}</p>
                      )}
                    </label>
                    <label className="ot-field ot-field--detail">
                      <span>Prioridad</span>
                      {canEdit ? (
                        <select
                          className="ot-detail-control"
                          value={editPriority}
                          onChange={(event) => savePriority(event.target.value)}
                          disabled={saving}
                        >
                          {OPERATIONAL_TASK_PRIORITIES.map((row) => (
                            <option key={row.id} value={row.id}>{row.label}</option>
                          ))}
                        </select>
                      ) : (
                        <p className="ot-detail-readonly">{labelForOperationalPriority(task.priority)}</p>
                      )}
                    </label>
                    <label className="ot-field ot-field--detail">
                      <span>Fecha límite</span>
                      {canEdit ? (
                        <input
                          ref={dueRef}
                          className="ot-detail-control"
                          type="datetime-local"
                          value={editDueAt}
                          onChange={(event) => setEditDueAt(event.target.value)}
                          onBlur={saveDueAt}
                        />
                      ) : (
                        <p className={`ot-detail-readonly${task.is_overdue ? " ot-detail-readonly--overdue" : ""}`}>
                          {formatDueAt(task.due_at)}
                        </p>
                      )}
                    </label>
                  </div>
                </section>

                <TaskWaitingPanel
                  task={task}
                  canEdit={canEdit}
                  saving={saving}
                  onSaveWaiting={handleWaitingSave}
                  onStatusChange={(status) => handleStatusSelect(status)}
                />

                <TaskWorkPlan
                  task={task}
                  canEdit={canManagePlan}
                  saving={saving}
                  {...workPlanHandlers}
                />

                <section className="ot-detail-block erp-card">
                  <header className="ot-detail-block__head">
                    <span className="ot-detail-block__icon ot-detail-block__icon--action" aria-hidden="true" />
                    <div>
                      <h3 className="ot-detail-block__title">Adjuntos</h3>
                      <p className="ot-detail-block__hint">Documentación de trabajo</p>
                    </div>
                  </header>
                  <div className="ot-detail-block__content">
                    <TaskAttachmentsPanel
                      attachments={task.attachments || []}
                      canEdit={canUpload}
                      saving={saving}
                      onDelete={(id) => onWorkPlanAction?.("deleteAttachment", id)}
                    />
                  </div>
                </section>

                <TaskComments
                  task={{ ...task, current_user_id: currentUserId }}
                  canComment={canComment}
                  saving={saving}
                  onCreate={(body) => onWorkPlanAction?.("createComment", body)}
                  onDelete={(id) => onWorkPlanAction?.("deleteComment", id)}
                />

                <TaskEvidencePanel
                  task={task}
                  evidence={task.evidence || []}
                  canSubmit={canSubmitEvidence}
                  canVerify={canVerifyEvidence}
                  saving={saving}
                  onSubmitted={(data) => onWorkPlanAction?.("evidenceSubmitted", data)}
                  onVerify={(id) => onWorkPlanAction?.("verifyEvidence", id)}
                  onDelete={(id) => onWorkPlanAction?.("deleteEvidence", id)}
                  onError={(message) => onMessage?.(message, "error")}
                />
              </div>

              <aside className="ot-detail-panel__side erp-section-stack">
                <section className="ot-detail-block erp-card ot-detail-block--info">
                  <header className="ot-detail-block__head">
                    <span className="ot-detail-block__icon ot-detail-block__icon--info" aria-hidden="true" />
                    <div>
                      <h3 className="ot-detail-block__title">Información</h3>
                      <p className="ot-detail-block__hint">Contexto de la tarea</p>
                    </div>
                    {canOpenMembers ? (
                      <button type="button" className="ot-btn ot-btn--ghost ot-btn--small" onClick={() => setMembersOpen(true)}>
                        Miembros
                      </button>
                    ) : null}
                  </header>
                  <dl className="ot-detail-info-list">
                    <div className="ot-detail-info-row">
                      <dt>Creado por</dt>
                      <dd>{task.created_by_name || "Sistema"}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Responsable</dt>
                      <dd>{primaryAssignee?.full_name || assigneeLabel(task)}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Participantes</dt>
                      <dd>{secondaryAssignees.length || "Ninguno"}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Seguidores</dt>
                      <dd>{(task.watchers || []).length}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Área</dt>
                      <dd>{task.area_name || task.area_id || "General"}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Tiempo abierta</dt>
                      <dd>{formatRelativeDays(task.open_days)}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Tiempo bloqueada</dt>
                      <dd>{formatRelativeDays(task.blocked_days)}</dd>
                    </div>
                    <div className="ot-detail-info-row">
                      <dt>Última actividad</dt>
                      <dd>{lastActivity ? formatDueAt(lastActivity.created_at) : formatDueAt(task.updated_at)}</dd>
                    </div>
                  </dl>
                </section>

                {visibleActivity.length > 0 ? (
                  <section className="ot-detail-block erp-card ot-detail-block--info">
                    <header className="ot-detail-block__head">
                      <span className="ot-detail-block__icon ot-detail-block__icon--history" aria-hidden="true" />
                      <div>
                        <h3 className="ot-detail-block__title">Historial</h3>
                        <p className="ot-detail-block__hint">{visibleActivity.length} eventos</p>
                      </div>
                    </header>
                    <ul className="ot-detail-timeline">
                      {visibleActivity.map((row) => (
                        <li key={row.id} className="ot-detail-timeline__item">
                          <span className="ot-detail-timeline__icon" aria-hidden="true">{row.icon || "•"}</span>
                          <div className="ot-detail-timeline__content">
                            <div className="ot-detail-timeline__head">
                              <strong>{row.actor_name || "Sistema"}</strong>
                              <time>{formatDueAt(row.created_at)}</time>
                            </div>
                            <p>{labelForActivityAction(row.action)}</p>
                            {row.new_value && typeof row.new_value === "string" ? (
                              <small>{row.new_value}</small>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
            </div>

            <TaskMembersPopover
              open={membersOpen}
              onClose={() => setMembersOpen(false)}
              task={task}
              assignableProfiles={assignableProfiles}
              currentUserId={currentUserId}
              saving={saving}
              onSave={handleMembersSave}
            />

            <CreateStepListModal
              open={createListOpen}
              lists={task.work_plan || []}
              saving={saving}
              onClose={() => setCreateListOpen(false)}
              onConfirm={(payload) => {
                onWorkPlanAction?.("createList", payload)
                setCreateListOpen(false)
              }}
            />

            <TaskAttachmentUploader
              open={attachmentOpen}
              taskId={task.id}
              onClose={() => setAttachmentOpen(false)}
              onUploaded={(data) => {
                onWorkPlanAction?.("attachmentUploaded", data)
                setAttachmentOpen(false)
              }}
              onError={(message) => onMessage?.(message, "error")}
            />
          </>
        ) : null}
      </div>
      {titleDirty && canEdit ? (
        <footer className="ot-detail-panel__footer">
          <button type="button" className="ot-btn ot-btn--primary" onClick={saveTitle} disabled={saving}>
            Guardar título
          </button>
        </footer>
      ) : null}
    </WideDrawer>
  )
}

export { assigneeLabel, formatDueAt }
