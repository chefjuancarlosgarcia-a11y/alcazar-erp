import { useCallback, useEffect, useMemo, useState } from "react"

import { useSearchParams } from "react-router-dom"

import { useAuth } from "../../context/AuthContext"

import {

  useMyOperationalTasks,

  changeOperationalTaskStatus,

  quickCreateOperationalTask,

  patchOperationalTask,

  assignOperationalTaskMembers,

  useAssignableProfiles

} from "../../hooks/useOperationalTasks"

import { useOperationalTaskDetailSync } from "../../hooks/useOperationalTaskDetailSync"

import { createTaskWorkPlanHandler } from "../../hooks/useTaskWorkPlanActions"

import { useTaskFocusRefresh } from "../../hooks/useOperationalTasksSync"

import { canAssignOperationalTasks, canAdministerTaskLabels } from "../../config/operationalTasksConfig"

import { normalizeRole } from "../../utils/profilePermissions"

import TaskCard from "./TaskCard"

import TaskDetailPanel from "./TaskDetailPanel"

import TaskLabelsPicker from "./TaskLabelsPicker"

import TasksSyncToolbar from "./TasksSyncToolbar"

import WaitingReasonDialog from "./WaitingReasonDialog"

import {

  getTaskLabelsCatalog,

  createTaskLabel,

  updateTaskLabel,

  deleteTaskLabel,

  archiveOperationalTask,

  restoreOperationalTask,

  updateOperationalTaskLabels

} from "../../services/taskLabelsService"

import "./operationalTasks.css"



export default function MyWork({ onMessage }) {

  const { user } = useAuth()

  const [params, setParams] = useSearchParams()

  const taskFromQuery = params.get("task") || ""

  const [quickTitle, setQuickTitle] = useState("")

  const [quickAssigneeId, setQuickAssigneeId] = useState("")

  const [creating, setCreating] = useState(false)

  const [selectedId, setSelectedId] = useState(taskFromQuery)

  const [focusField, setFocusField] = useState(null)

  const [saving, setSaving] = useState(false)

  const [waitingMove, setWaitingMove] = useState(null)

  const [labelCatalog, setLabelCatalog] = useState([])

  const [canAdministerLabels, setCanAdministerLabels] = useState(false)

  const [taskLabelsOpen, setTaskLabelsOpen] = useState(false)



  const {

    tasks,

    loading,

    refreshing,

    error,

    refresh,

    setTasks,

    lastSyncedAt

  } = useMyOperationalTasks()



  const { profiles: assignableProfiles } = useAssignableProfiles()

  const canAssign = canAssignOperationalTasks(normalizeRole(user?.role))

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



  const openTasks = useMemo(

    () => tasks.filter((task) => !["completed", "cancelled"].includes(task.status)),

    [tasks]

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



  async function reloadLabelCatalog() {

    const result = await getTaskLabelsCatalog(null)

    if (!result.error) {

      setLabelCatalog(result.data)

      setCanAdministerLabels(result.canAdminister)

    }

    return result

  }



  useEffect(() => {

    reloadLabelCatalog()

  }, [])



  useEffect(() => {

    if (!taskFromQuery) return

    setSelectedId(taskFromQuery)

  }, [taskFromQuery])



  function openTask(taskId, field = null) {

    setSelectedId(taskId)

    setFocusField(field)

    setParams(taskId ? { task: taskId } : {})

  }



  function closeTask() {

    setSelectedId("")

    setFocusField(null)

    setParams({})

    setHasUnsavedEdits(false)

  }



  async function handleArchiveTask(taskId) {

    if (!window.confirm("¿Archivar esta tarea? Desaparecerá de tu lista.")) return

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

    if (result.data) patchTaskInList(result.data)

    onMessage?.("Tarea restaurada.", "success")

    await refresh({ background: true })

    if (result.data?.id) openTask(result.data.id)

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

      patchTaskInList(result.data)

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

    const result = await createTaskLabel({ name, colorKey })

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

    const result = await quickCreateOperationalTask(title, { assigneeId })

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

      setWaitingMove({ taskId, status: "waiting" })

      return

    }

    await handleStatusChange(taskId, { status })

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

        <p className="ot-eyebrow">Mi trabajo</p>

        <h1>Mis tareas</h1>

        <p className="ot-muted">Crea una tarea rápida o abre una pendiente para avanzarla.</p>

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

          placeholder="Nueva tarea — título y Enter"

          aria-label="Nueva tarea"

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



      {error ? <p className="ot-feedback ot-feedback--error">{error}</p> : null}

      {loading ? <p className="ot-muted">Cargando tareas...</p> : null}



      <div className="ot-list ot-list--cards">

        {openTasks.map((task) => (

          <TaskCard

            key={task.id}

            task={task}

            highlighted={selectedId === task.id}

            linkView="mi-trabajo"

            canEdit={Boolean(task.permissions?.can_edit)}

            canMove={Boolean(task.permissions?.can_move)}

            onOpen={(id) => openTask(id)}

            onEditTitle={(id) => openTask(id, "title")}

            onEditMembers={(id) => openTask(id, "members")}

            onEditDue={(id) => openTask(id, "due")}

            onStatusChange={handleCardStatusChange}

            onCopyLink={() => onMessage?.("Enlace copiado.", "success")}

            onArchive={handleArchiveTask}

          />

        ))}

        {!loading && !openTasks.length ? (

          <p className="ot-muted">No tienes tareas abiertas. Crea una arriba con Enter.</p>

        ) : null}

      </div>



      <TaskDetailPanel

        open={Boolean(selectedId)}

        task={selectedTask}

        loading={detailLoading}

        saving={saving}

        canAssign={canAssign}

        assignableProfiles={assignableProfiles}

        linkView="mi-trabajo"

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



      <TaskLabelsPicker

        open={taskLabelsOpen}

        catalog={labelCatalog}

        selectedIds={(selectedTask?.labels || []).map((label) => label.id)}

        saving={saving}

        canAdminister={canAdministerLabelsUi}

        onClose={() => setTaskLabelsOpen(false)}

        onToggleLabel={handleToggleTaskLabel}

        onCreateLabel={handleCreateTaskLabel}

        onUpdateLabel={handleUpdateTaskLabel}

        onDeleteLabel={handleDeleteTaskLabel}

      />



      <WaitingReasonDialog

        open={Boolean(waitingMove)}

        saving={saving}

        onCancel={() => setWaitingMove(null)}

        onConfirm={async ({ status, waitingReason, waitingUnblockNote }) => {

          if (!waitingMove) return

          await handleStatusChange(waitingMove.taskId, {

            status: status || "waiting",

            waitingReason,

            waitingUnblockNote

          })

          setWaitingMove(null)

        }}

      />

    </div>

  )

}


