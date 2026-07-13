import { useCallback, useEffect, useMemo, useState } from "react"

import { useSearchParams } from "react-router-dom"

import { useAuth } from "../../context/AuthContext"

import { getActiveAreas } from "../../services/areasService"

import {

  useOperationalTasksBoard,

  changeOperationalTaskStatus,

  moveOperationalTaskCard,

  quickCreateOperationalTask,

  patchOperationalTask,

  assignOperationalTaskMembers,

  useAssignableProfiles

} from "../../hooks/useOperationalTasks"

import { createTaskWorkPlanHandler } from "../../hooks/useTaskWorkPlanActions"

import { useOperationalTaskDetailSync } from "../../hooks/useOperationalTaskDetailSync"

import { useTaskFocusRefresh } from "../../hooks/useOperationalTasksSync"

import {

  canAssignOperationalTasks,

  canAdministerTaskLabels,

  boardColumnForOperationalStatus,

  OPERATIONAL_TASK_BOARD_COLUMNS

} from "../../config/operationalTasksConfig"

import { normalizeRole } from "../../utils/profilePermissions"

import TaskCard from "./TaskCard"

import TaskDetailPanel from "./TaskDetailPanel"

import TasksSyncToolbar from "./TasksSyncToolbar"

import WaitingReasonDialog from "./WaitingReasonDialog"

import { computeSortPosition, groupTasksByStatus, buildBoardSearchParams, parseBoardFiltersFromParams } from "./taskCardUtils"

import TaskArchivedPanel from "./TaskArchivedPanel"

import TaskLabelsPicker from "./TaskLabelsPicker"

import { getTaskLabelsCatalog, createTaskLabel, updateTaskLabel, deleteTaskLabel, archiveOperationalTask, restoreOperationalTask, getArchivedOperationalTasks, updateOperationalTaskLabels } from "../../services/taskLabelsService"

import "./operationalTasks.css"



export default function TaskBoard({ onMessage }) {

  const { user } = useAuth()

  const [params, setParams] = useSearchParams()

  const taskFromQuery = params.get("task") || ""

  const [filters, setFilters] = useState(() => parseBoardFiltersFromParams(params))

  const [labelCatalog, setLabelCatalog] = useState([])

  const [canAdministerLabels, setCanAdministerLabels] = useState(false)

  const [archivedOpen, setArchivedOpen] = useState(false)

  const [archivedTasks, setArchivedTasks] = useState([])

  const [archivedLoading, setArchivedLoading] = useState(false)

  const [taskLabelsOpen, setTaskLabelsOpen] = useState(false)

  const [areas, setAreas] = useState([])

  const [quickTitle, setQuickTitle] = useState("")

  const [quickAssigneeId, setQuickAssigneeId] = useState("")

  const [creating, setCreating] = useState(false)

  const [selectedId, setSelectedId] = useState(taskFromQuery)

  const [focusField, setFocusField] = useState(null)

  const [saving, setSaving] = useState(false)

  const [draggingId, setDraggingId] = useState("")

  const [dropHint, setDropHint] = useState({ columnId: "", index: null })

  const [waitingMove, setWaitingMove] = useState(null)



  const {

    tasks,

    loading,

    refreshing,

    error,

    refresh,

    setTasks,

    lastSyncedAt

  } = useOperationalTasksBoard({

    areaId: filters.areaId || null,

    search: filters.search || null,

    labelIds: filters.labelIds?.length ? filters.labelIds : null,

    includeCancelled: filters.includeCancelled,

    includeOldCompleted: filters.includeOldCompleted

  })



  const { profiles: assignableProfiles } = useAssignableProfiles()

  const canAssign = canAssignOperationalTasks(normalizeRole(user?.role))

  const canManageArchived = canAssign

  const canAdministerLabelsUi = canAdministerLabels || canAdministerTaskLabels(normalizeRole(user?.role))

  const handleDetailError = useCallback(
    (message) => onMessage?.(message, "error"),
    [onMessage]
  )

  const {

    task: selectedTask,

    loading: detailLoading,

    refreshing: detailRefreshing,

    error: detailError,

    conflict,

    loadDetail,

    retryDetail,

    checkServerConflict,

    reloadFromServer,

    dismissConflict,

    ensureCanMutate,

    setHasUnsavedEdits,

    hasUnsavedEditsRef

  } = useOperationalTaskDetailSync({

    taskId: selectedId,

    onError: handleDetailError

  })



  const grouped = useMemo(

    () => groupTasksByStatus(tasks, OPERATIONAL_TASK_BOARD_COLUMNS, boardColumnForOperationalStatus),

    [tasks]

  )

  const cancelledTasks = useMemo(

    () => (filters.includeCancelled ? tasks.filter((task) => task.status === "cancelled") : []),

    [tasks, filters.includeCancelled]

  )



  const syncView = useCallback(async ({ background = true, includeDetail = true } = {}) => {

    await refresh({ background })

    if (!includeDetail || !selectedId) return



    if (hasUnsavedEditsRef.current) {

      await checkServerConflict()

      return

    }

    await loadDetail(selectedId, { background: true })

  }, [checkServerConflict, hasUnsavedEditsRef, loadDetail, refresh, selectedId])



  useTaskFocusRefresh({

    enabled: true,

    hasUnsavedEdits: () => hasUnsavedEditsRef.current,

    onRefresh: () => syncView({ background: true, includeDetail: true })

  })



  useEffect(() => {

    let mounted = true

    getActiveAreas().then(({ data }) => {

      if (mounted) setAreas((data || []).map((area) => ({ id: area.id, name: area.name })))

    })

    return () => {

      mounted = false

    }

  }, [])



  useEffect(() => {

    setFilters(parseBoardFiltersFromParams(params))

    setSelectedId(params.get("task") || "")

  }, [params])



  async function reloadLabelCatalog() {

    const result = await getTaskLabelsCatalog(filters.areaId || null)

    if (!result.error) {

      setLabelCatalog(result.data)

      setCanAdministerLabels(result.canAdminister)

    }

    return result

  }



  useEffect(() => {

    reloadLabelCatalog()

  }, [filters.areaId])

  async function loadArchivedTasks() {

    setArchivedLoading(true)

    const result = await getArchivedOperationalTasks()

    setArchivedLoading(false)

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    setArchivedTasks(result.data)

  }

  async function handleArchiveTask(taskId) {

    if (!window.confirm("¿Archivar esta tarea? Desaparecerá del tablero.")) return

    setSaving(true)

    const result = await archiveOperationalTask(taskId)

    setSaving(false)

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    setTasks((current) => current.filter((row) => row.id !== taskId))

    if (selectedId === taskId) closeTask()

    onMessage?.("Tarea archivada.", "success")

    await refresh({ background: true })

  }

  async function handleRestoreTask(taskId) {

    setSaving(true)

    const result = await restoreOperationalTask(taskId)

    setSaving(false)

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    setArchivedTasks((current) => current.filter((row) => row.id !== taskId))

    if (result.data) patchTaskInList(result.data)

    onMessage?.("Tarea restaurada.", "success")

    await refresh({ background: true })

  }

  async function handleTaskLabelsSave(labelIds, { quiet = false } = {}) {

    if (!selectedId) return

    setSaving(true)

    const result = await updateOperationalTaskLabels(selectedId, labelIds)

    setSaving(false)

    if (result.error) {

      onMessage?.(result.error, "error")

      return result

    }

    if (result.data) {

      await loadDetail(selectedId, { background: true, mutationResult: result.data })

      if (result.data.id) {

        patchTaskInList({

          ...result.data,

          labels: result.data.labels,

          permissions: result.data.permissions

        })

      }

    }

    if (!quiet) onMessage?.("Etiquetas actualizadas.", "success")

    return result

  }



  async function handleToggleTaskLabel(labelId, checked) {

    const current = (selectedTask?.labels || []).map((row) => row.id)

    const next = checked

      ? [...new Set([...current, labelId])]

      : current.filter((id) => id !== labelId)

    await handleTaskLabelsSave(next, { quiet: true })

  }



  async function handleCreateTaskLabel({ name, colorKey }) {

    const result = await createTaskLabel({

      name,

      colorKey,

      scope: filters.areaId ? "area" : "global",

      areaId: filters.areaId || null

    })

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    await reloadLabelCatalog()

    onMessage?.("Etiqueta creada.", "success")

    if (result.data?.id && selectedId) {

      const current = (selectedTask?.labels || []).map((row) => row.id)

      if (!current.includes(result.data.id)) {

        await handleTaskLabelsSave([...current, result.data.id], { quiet: true })

      }

    }

  }



  async function handleUpdateTaskLabel(labelId, { name, colorKey }) {

    const result = await updateTaskLabel(labelId, { name, colorKey })

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    await reloadLabelCatalog()

    if (selectedId) {

      await loadDetail(selectedId, { background: true })

      await refresh({ background: true })

    }

    onMessage?.("Etiqueta actualizada.", "success")

  }



  async function handleDeleteTaskLabel(labelId) {

    const result = await deleteTaskLabel(labelId)

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    await reloadLabelCatalog()

    if (selectedId) {

      await loadDetail(selectedId, { background: true })

    }

    await refresh({ background: true })

    onMessage?.("Etiqueta eliminada.", "success")

  }

  function updateFilters(patch) {

    setFilters((current) => {

      const next = { ...current, ...patch }

      setParams(buildBoardSearchParams({ taskId: selectedId || null, filters: next }))

      return next

    })

  }

  function toggleLabelFilter(labelId) {

    const current = filters.labelIds || []

    const next = current.includes(labelId)

      ? current.filter((id) => id !== labelId)

      : [...current, labelId]

    updateFilters({ labelIds: next })

  }



  function openTask(taskId, field = null) {

    setSelectedId(taskId)

    setFocusField(field)

    setParams(buildBoardSearchParams({ taskId, filters }))

  }



  function closeTask() {

    setSelectedId("")

    setFocusField(null)

    setParams(buildBoardSearchParams({ taskId: null, filters }))

    setHasUnsavedEdits(false)

  }



  function patchTaskInList(card) {

    if (!card?.id) return

    setTasks((current) => {

      const exists = current.some((row) => row.id === card.id)

      if (!exists) return [...current, card]

      return current.map((row) => (row.id === card.id ? { ...row, ...card } : row))

    })

  }



  async function confirmMutation(taskId, result, options = {}) {

    if (result.error) {

      onMessage?.(result.error, "error")

      return result

    }



    if (result.data) patchTaskInList(result.data)

    onMessage?.(options.successMessage || "Cambios guardados.", "success")

    await refresh({ background: true })



    if (selectedId === taskId) {

      await loadDetail(taskId, { background: true, mutationResult: result.data })

    }

    return result

  }



  async function handleQuickCreate(event) {

    event.preventDefault()

    const title = quickTitle.trim()

    if (!title) return

    setCreating(true)

    const assigneeId = canAssign && quickAssigneeId ? quickAssigneeId : user?.id || null

    const result = await quickCreateOperationalTask(title, {

      areaId: filters.areaId || null,

      assigneeId

    })

    setCreating(false)

    if (result.error) {

      onMessage?.(result.error, "error")

      return

    }

    if (result.data) patchTaskInList(result.data)

    setQuickTitle("")

    setQuickAssigneeId("")

    await refresh({ background: true })

    onMessage?.("Tarea creada.", "success")

    if (result.data?.id) openTask(result.data.id)

  }



  async function handleStatusChange(taskId, payload) {

    if (!(await ensureCanMutate())) return



    setSaving(true)

    const result = await changeOperationalTaskStatus(taskId, payload)

    setSaving(false)

    await confirmMutation(taskId, result, { successMessage: "Estado actualizado." })

  }



  async function handleCardStatusChange(taskId, status) {

    const current = tasks.find((row) => row.id === taskId)

    if (!current || current.status === status) return

    if (status === "waiting" || status === "blocked") {

      setWaitingMove({ taskId, status: "waiting", sortPosition: current.sort_position })

      return

    }

    await executeMove(taskId, status, current.sort_position)

  }



  async function executeMove(taskId, status, sortPosition, waitingPayload = null) {

    const snapshot = tasks

    const current = tasks.find((row) => row.id === taskId)

    if (!current) return



    const optimistic = {

      ...current,

      status,

      sort_position: sortPosition ?? current.sort_position,

      waiting_reason: waitingPayload?.waitingReason
        || (["waiting", "blocked"].includes(status) ? current.waiting_reason : null),

      waiting_unblock_note: waitingPayload?.waitingUnblockNote ?? current.waiting_unblock_note

    }

    patchTaskInList(optimistic)



    setSaving(true)

    const result = await moveOperationalTaskCard(taskId, {

      status,

      sortPosition: sortPosition ?? current.sort_position,

      waitingReason: waitingPayload?.waitingReason || null,

      waitingUnblockNote: waitingPayload?.waitingUnblockNote || null

    })

    setSaving(false)



    if (result.error) {

      setTasks(snapshot)

      onMessage?.(result.error, "error")

      return

    }



    await confirmMutation(taskId, result, { successMessage: "Tarjeta actualizada." })

  }



  async function handleDropOnColumn(event, columnId) {

    event.preventDefault()

    const taskId = event.dataTransfer.getData("text/task-id") || draggingId

    if (!taskId) return



    const current = tasks.find((row) => row.id === taskId)

    if (!current) return



    const columnTasks = (grouped[columnId] || []).filter((row) => row.id !== taskId)

    const dropIndex = dropHint.columnId === columnId && dropHint.index != null

      ? dropHint.index

      : columnTasks.length

    const sortPosition = computeSortPosition(columnTasks, dropIndex)



    setDraggingId("")

    setDropHint({ columnId: "", index: null })



    if (boardColumnForOperationalStatus(current.status) === columnId
      && Number(current.sort_position) === sortPosition) return



    if (columnId === "waiting" && !["waiting", "blocked"].includes(current.status)) {

      setWaitingMove({ taskId, status: "waiting", sortPosition })

      return

    }



    const targetStatus = ["waiting", "blocked"].includes(current.status) ? current.status : columnId

    await executeMove(taskId, targetStatus, sortPosition)

  }



  function handleCardDragOver(event, task) {

    event.preventDefault()

    const columnId = boardColumnForOperationalStatus(task.status)

    const columnTasks = grouped[columnId] || []

    const index = columnTasks.findIndex((row) => row.id === task.id)

    setDropHint({ columnId, index })

  }



  async function handleTaskUpdate(taskId, payload) {

    if (!(await ensureCanMutate())) return



    setSaving(true)

    const result = await patchOperationalTask(taskId, payload)

    setSaving(false)

    await confirmMutation(taskId, result, { successMessage: "Tarea actualizada." })

  }



  async function handleAssigneesChange(taskId, payload) {
    setSaving(true)
    const result = await assignOperationalTaskMembers(taskId, payload)
    setSaving(false)

    if (result.error) {
      onMessage?.(result.error, "error")
      return
    }

    onMessage?.("Miembros actualizados.", "success")

    if (result.data) patchTaskInList(result.data)
    await refresh({ background: true })
    if (selectedId === taskId) {
      await loadDetail(taskId, { background: true, mutationResult: result.data })
    }
  }

  const handleWorkPlanAction = createTaskWorkPlanHandler({
    taskId: selectedId,
    setSaving,
    onMessage,
    onDetailUpdated: async (data) => {
      if (selectedId) {
        await loadDetail(selectedId, { background: true, mutationResult: data })
      }
    },
    onListRefresh: () => refresh({ background: true })
  })



  const listRefreshing = refreshing || detailRefreshing



  return (

    <div className="ot-page erp-section-stack">

      <header className="ot-header">

        <p className="ot-eyebrow">Tablero operativo</p>

        <h1>Tablero</h1>

        <p className="ot-muted">Arrastra tarjetas entre columnas o abre el detalle para editar.</p>

      </header>



      <TasksSyncToolbar

        refreshing={listRefreshing}

        lastSyncedAt={lastSyncedAt}

        onRefresh={() => syncView({ background: true, includeDetail: Boolean(selectedId) })}

      />



      <form className={`ot-quick-create${canAssign ? " ot-quick-create--with-assignee" : ""}`} onSubmit={handleQuickCreate}>

        <input

          value={quickTitle}

          onChange={(event) => setQuickTitle(event.target.value)}

          placeholder="Tarea rápida — escribe y presiona Enter"

          aria-label="Tarea rápida"

        />

        {canAssign ? (

          <select

            value={quickAssigneeId}

            onChange={(event) => setQuickAssigneeId(event.target.value)}

            aria-label="Asignar a"

          >

            <option value="">Asignarme a mí</option>

            {assignableProfiles.map((profile) => (

              <option key={profile.id} value={profile.id}>

                {profile.full_name || profile.username}

              </option>

            ))}

          </select>

        ) : null}

        <button type="submit" className="ot-btn ot-btn--primary" disabled={creating}>

          {creating ? "Creando..." : "Crear"}

        </button>

      </form>



      <div className="ot-filters erp-filters-row">

        <label className="ot-field">

          <span>Área</span>

          <select

            value={filters.areaId}

            onChange={(event) => updateFilters({ areaId: event.target.value })}

          >

            <option value="">Todas</option>

            {areas.map((area) => (

              <option key={area.id} value={area.id}>{area.name}</option>

            ))}

          </select>

        </label>

        <label className="ot-field">

          <span>Buscar</span>

          <input

            value={filters.search}

            onChange={(event) => updateFilters({ search: event.target.value })}

            placeholder="Título, objetivo o paso del plan"

          />

        </label>

        <label className="ot-field ot-field--checkbox">

          <span>Filtros</span>

          <label className="ot-checkbox">

            <input

              type="checkbox"

              checked={filters.includeCancelled}

              onChange={(event) => updateFilters({ includeCancelled: event.target.checked })}

            />

            Mostrar canceladas

          </label>

        </label>

        {canManageArchived ? (
          <button
            type="button"
            className="ot-btn ot-btn--ghost"
            onClick={() => {
              setArchivedOpen(true)
              loadArchivedTasks()
            }}
          >
            Archivadas
          </button>
        ) : null}

      </div>

      {labelCatalog.length > 0 ? (
        <div className="ot-label-filter-row" aria-label="Filtrar por etiqueta">
          <span className="ot-label-filter-row__label">Etiquetas</span>
          {labelCatalog.map((label) => {
            const active = (filters.labelIds || []).includes(label.id)
            return (
              <button
                key={label.id}
                type="button"
                className={`ot-label-filter-chip${active ? " is-active" : ""}`}
                onClick={() => toggleLabelFilter(label.id)}
              >
                {label.name}
              </button>
            )
          })}
        </div>
      ) : null}



      {error ? <p className="ot-feedback ot-feedback--error">{error}</p> : null}

      {loading ? <p className="ot-muted">Cargando tablero...</p> : null}



      <div className="ot-kanban ot-kanban--phase-b">

        {OPERATIONAL_TASK_BOARD_COLUMNS.map((column) => (

          <section

            key={column.id}

            className="ot-kanban-column"

            onDragOver={(event) => event.preventDefault()}

            onDrop={(event) => handleDropOnColumn(event, column.id)}

          >

            <div className="ot-kanban-column__head">

              <h2>{column.label}</h2>

              <span className="ot-kanban-count">{grouped[column.id]?.length || 0}</span>

            </div>

            <div className="ot-kanban-column__cards">

              {(grouped[column.id] || []).map((task) => (

                <TaskCard

                  key={task.id}

                  task={task}

                  highlighted={selectedId === task.id}

                  dragging={draggingId === task.id}

                  linkView="tablero"

                  canEdit={Boolean(task.permissions?.can_edit)}

                  canMove={Boolean(task.permissions?.can_move)}

                  onOpen={(id) => openTask(id)}

                  onEditTitle={(id) => openTask(id, "title")}

                  onEditMembers={(id) => openTask(id, "members")}

                  onEditDue={(id) => openTask(id, "due")}

                  onStatusChange={handleCardStatusChange}

                  onCopyLink={() => onMessage?.("Enlace copiado.", "success")}

                  onArchive={handleArchiveTask}

                  onDragStart={setDraggingId}

                  onDragEnd={() => setDraggingId("")}

                  onDragOver={handleCardDragOver}

                  onDrop={(event, cardTask) => {

                    event.preventDefault()

                    event.stopPropagation()

                    const columnTasks = (grouped[column.id] || []).filter((row) => row.id !== draggingId)

                    const index = columnTasks.findIndex((row) => row.id === cardTask.id)

                    executeMove(draggingId, column.id, computeSortPosition(columnTasks, index + 1))

                  }}

                />

              ))}

            </div>

            {column.id === "completed" && !filters.includeOldCompleted ? (

              <button

                type="button"

                className="ot-btn ot-btn--ghost ot-kanban-load-more"

                onClick={() => setFilters((prev) => ({ ...prev, includeOldCompleted: true }))}

              >

                Cargar completadas anteriores

              </button>

            ) : null}

          </section>

        ))}

      </div>



      {cancelledTasks.length ? (

        <section className="ot-cancelled-section erp-card">

          <header className="ot-kanban-column__head">

            <h2>Canceladas</h2>

            <span className="ot-kanban-count">{cancelledTasks.length}</span>

          </header>

          <div className="ot-list ot-list--cards">

            {cancelledTasks.map((task) => (

              <TaskCard

                key={task.id}

                task={task}

                highlighted={selectedId === task.id}

                linkView="tablero"

                canEdit={false}

                canMove={false}

                onOpen={(id) => openTask(id)}

                onCopyLink={() => onMessage?.("Enlace copiado.", "success")}

                onArchive={handleArchiveTask}

              />

            ))}

          </div>

        </section>

      ) : null}



      <TaskDetailPanel

        open={Boolean(selectedId)}

        task={selectedTask}

        loading={detailLoading}

        saving={saving}

        canAssign={canAssign}

        assignableProfiles={assignableProfiles}

        linkView="tablero"

        focusField={focusField}

        conflict={conflict}

        detailError={detailError}

        detailRefreshing={detailRefreshing}

        onRetryDetail={retryDetail}

        onReloadFromServer={reloadFromServer}

        onDismissConflict={dismissConflict}

        onUnsavedEditsChange={setHasUnsavedEdits}

        onClose={closeTask}

        onStatusChange={handleStatusChange}

        onTaskUpdate={handleTaskUpdate}

        onAssigneesChange={handleAssigneesChange}

        onWorkPlanAction={handleWorkPlanAction}

        onOpenLabels={() => setTaskLabelsOpen(true)}

        onArchive={handleArchiveTask}

        onRestore={handleRestoreTask}

        currentUserId={user?.id}

        onMessage={onMessage}

      />



      <WaitingReasonDialog

        open={Boolean(waitingMove)}

        saving={saving}

        onCancel={() => setWaitingMove(null)}

        onConfirm={async ({ status, waitingReason, waitingUnblockNote }) => {

          if (!waitingMove) return

          await executeMove(

            waitingMove.taskId,

            status || waitingMove.status,

            waitingMove.sortPosition,

            { waitingReason, waitingUnblockNote }

          )

          setWaitingMove(null)

        }}

      />

      <TaskLabelsPicker
        open={taskLabelsOpen}
        catalog={labelCatalog}
        selectedIds={(selectedTask?.labels || []).map((row) => row.id)}
        saving={saving}
        canAdminister={canAdministerLabelsUi}
        onClose={() => setTaskLabelsOpen(false)}
        onToggleLabel={handleToggleTaskLabel}
        onCreateLabel={handleCreateTaskLabel}
        onUpdateLabel={handleUpdateTaskLabel}
        onDeleteLabel={handleDeleteTaskLabel}
      />

      <TaskArchivedPanel
        open={archivedOpen}
        loading={archivedLoading}
        tasks={archivedTasks}
        onClose={() => setArchivedOpen(false)}
        onOpenTask={(id) => {
          setArchivedOpen(false)
          openTask(id)
        }}
        onRestore={handleRestoreTask}
      />

    </div>

  )

}


