import {
  convertTaskStepToTask,
  createTaskComment,
  createTaskStep,
  createTaskStepList,
  deleteTaskAttachment,
  deleteTaskComment,
  deleteTaskEvidence,
  deleteTaskStep,
  deleteTaskStepList,
  submitTaskEvidence,
  toggleTaskStep,
  updateTaskStep,
  verifyTaskEvidence
} from "../services/taskWorkPlanService"

const CARD_AFFECTING_ACTIONS = new Set([
  "createList",
  "deleteList",
  "createStep",
  "toggleStep",
  "deleteStep",
  "convertStep"
])

export function createTaskWorkPlanHandler({
  taskId,
  setSaving,
  onMessage,
  onDetailUpdated,
  onListRefresh
}) {
  return async function handleWorkPlanAction(action, payload) {
    if (!taskId) return

    setSaving?.(true)
    let result = { data: null, error: "Acción no soportada." }

    try {
      switch (action) {
        case "createList":
          result = await createTaskStepList(taskId, payload)
          break
        case "deleteList":
          result = await deleteTaskStepList(payload)
          break
        case "createStep":
          result = await createTaskStep(payload.listId, { text: payload.text })
          break
        case "toggleStep":
          result = await toggleTaskStep(payload.stepId, payload.completed)
          break
        case "updateStep":
          result = await updateTaskStep(payload.stepId, payload.data)
          break
        case "deleteStep":
          result = await deleteTaskStep(payload)
          break
        case "convertStep": {
          const converted = await convertTaskStepToTask(payload)
          if (converted.error) {
            result = converted
            break
          }
          result = {
            data: converted.data?.source_task || null,
            error: null
          }
          if (converted.data?.new_task_id) {
            onMessage?.(`Tarea creada: ${converted.data.new_task_id}`, "success")
          }
          break
        }
        case "deleteAttachment":
          result = await deleteTaskAttachment(payload)
          break
        case "attachmentUploaded":
          result = { data: payload, error: null }
          break
        case "createComment":
          result = await createTaskComment(taskId, payload)
          break
        case "deleteComment":
          result = await deleteTaskComment(payload)
          break
        case "verifyEvidence":
          result = await verifyTaskEvidence(payload)
          break
        case "deleteEvidence":
          result = await deleteTaskEvidence(payload)
          break
        case "evidenceSubmitted":
          result = { data: payload, error: null }
          break
        default:
          break
      }
    } finally {
      setSaving?.(false)
    }

    if (result.error) {
      onMessage?.(result.error, "error")
      return result
    }

    if (result.data) {
      await onDetailUpdated?.(result.data)
      if (CARD_AFFECTING_ACTIONS.has(action)) {
        await onListRefresh?.()
      }
      onMessage?.("Cambios guardados.", "success")
    }

    return result
  }
}
