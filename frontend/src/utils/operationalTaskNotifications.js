import { createNotification } from "../services/notificationsService"

export function operationalTaskDeepLink(taskId) {
  const id = encodeURIComponent(String(taskId || ""))
  return `/tasks/trabajo/mi-trabajo?task=${id}`
}

export async function notifyOperationalTaskAssignees({
  task,
  assigneeIds = [],
  actorName = "Sistema",
  onlyNewIds = []
}) {
  const targets = (onlyNewIds.length ? onlyNewIds : assigneeIds).filter(Boolean)
  if (!targets.length || !task?.id) return { sent: 0, skipped: 0 }

  const dueLabel = task.due_at
    ? new Date(task.due_at).toLocaleString("es-GT", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    })
    : "sin fecha límite"

  const responses = await Promise.all(
    targets.map((userId) => createNotification({
      userId,
      type: "task_assigned",
      title: `Nueva tarea asignada: ${task.title}`,
      message: `${actorName} te asignó la tarea «${task.title}» (${dueLabel}).`,
      entityType: "task",
      entityId: task.id,
      actionUrl: operationalTaskDeepLink(task.id)
    }))
  )

  const failed = responses.filter((row) => row?.error).length
  return {
    sent: responses.length - failed,
    skipped: failed
  }
}
