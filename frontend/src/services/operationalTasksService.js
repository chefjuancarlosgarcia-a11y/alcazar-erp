import { supabase } from "../lib/supabase"

function normalizeTaskList(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.tasks)) return payload.tasks
  return []
}

export async function getOperationalTasksBoard(filters = {}) {
  const result = await supabase.rpc("get_operational_tasks_board", {
    p_area_id: filters.areaId || null,
    p_assignee_id: filters.assigneeId || null,
    p_search: filters.search || null,
    p_include_cancelled: Boolean(filters.includeCancelled),
    p_completed_days: filters.completedDays ?? 7,
    p_include_old_completed: Boolean(filters.includeOldCompleted),
    p_label_ids: filters.labelIds?.length ? filters.labelIds : null
  })
  return {
    data: normalizeTaskList(result.data),
    error: result.error?.message || null
  }
}

export async function getMyOperationalTasks(filters = {}) {
  const result = await supabase.rpc("get_my_operational_tasks", {
    p_status: filters.status || null,
    p_limit: filters.limit || 100
  })
  return {
    data: normalizeTaskList(result.data),
    error: result.error?.message || null
  }
}

export async function getOperationalTaskDetail(taskId) {
  const result = await supabase.rpc("get_operational_task_detail", {
    p_task_id: taskId
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function createOperationalTaskQuick(payload) {
  const result = await supabase.rpc("create_operational_task_quick", {
    p_title: payload.title,
    p_assignee_id: payload.assigneeId || null,
    p_area_id: payload.areaId || null,
    p_due_at: payload.dueAt || null
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function createOperationalTask(payload) {
  const result = await supabase.rpc("create_operational_task", {
    p_data: payload
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function updateOperationalTaskStatus(taskId, payload) {
  const result = await supabase.rpc("update_operational_task_status", {
    p_task_id: taskId,
    p_status: payload.status,
    p_waiting_reason: payload.waitingReason || null,
    p_next_action: payload.nextAction || null,
    p_cancel_reason: payload.cancelReason || null,
    p_waiting_unblock_note: payload.waitingUnblockNote || null
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function updateOperationalTask(taskId, payload) {
  const result = await supabase.rpc("update_operational_task", {
    p_task_id: taskId,
    p_data: payload
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function updateOperationalTaskMembers(taskId, payload) {
  const result = await supabase.rpc("update_operational_task_members", {
    p_task_id: taskId,
    p_primary_profile_id: payload.primaryId,
    p_participant_ids: payload.participantIds || [],
    p_watcher_ids: payload.watcherIds || []
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function updateOperationalTaskAssignees(taskId, assigneeIds) {
  const result = await supabase.rpc("update_operational_task_assignees", {
    p_task_id: taskId,
    p_assignee_ids: assigneeIds
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function moveOperationalTask(taskId, payload) {
  const result = await supabase.rpc("move_operational_task", {
    p_task_id: taskId,
    p_status: payload.status,
    p_sort_position: payload.sortPosition ?? null,
    p_waiting_reason: payload.waitingReason || null,
    p_next_action: payload.nextAction || null,
    p_waiting_unblock_note: payload.waitingUnblockNote || null
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}
