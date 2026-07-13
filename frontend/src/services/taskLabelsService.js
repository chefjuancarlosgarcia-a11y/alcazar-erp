import { supabase } from "../lib/supabase"

function normalizeLabels(payload) {
  if (!payload) return []
  if (Array.isArray(payload)) return payload
  if (Array.isArray(payload.labels)) return payload.labels
  return []
}

export async function getTaskLabelsCatalog(areaId = null) {
  const result = await supabase.rpc("get_task_labels_catalog", {
    p_area_id: areaId || null,
    p_include_archived: false
  })
  const payload = result.data || {}
  return {
    data: normalizeLabels(payload),
    canAdminister: Boolean(payload.can_administer),
    error: result.error?.message || null
  }
}

export async function createTaskLabel({ name, colorKey = "teal", description = null, scope = "global", areaId = null }) {
  const result = await supabase.rpc("create_task_label", {
    p_name: name,
    p_color_key: colorKey,
    p_description: description,
    p_scope: scope,
    p_area_id: areaId
  })
  return {
    data: result.data?.label || null,
    error: result.error?.message || null
  }
}

export async function updateTaskLabel(labelId, { name, colorKey, description }) {
  const result = await supabase.rpc("update_task_label", {
    p_label_id: labelId,
    p_name: name ?? null,
    p_color_key: colorKey ?? null,
    p_description: description ?? null
  })
  return {
    data: result.data?.label || null,
    error: result.error?.message || null
  }
}

export async function deleteTaskLabel(labelId) {
  const result = await supabase.rpc("delete_task_label", {
    p_label_id: labelId
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function updateOperationalTaskLabels(taskId, labelIds = []) {
  const result = await supabase.rpc("update_operational_task_labels", {
    p_task_id: taskId,
    p_label_ids: labelIds
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function archiveOperationalTask(taskId) {
  const result = await supabase.rpc("archive_operational_task", {
    p_task_id: taskId
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function restoreOperationalTask(taskId) {
  const result = await supabase.rpc("restore_operational_task", {
    p_task_id: taskId
  })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function getArchivedOperationalTasks(search = null, limit = 100) {
  const result = await supabase.rpc("get_archived_operational_tasks", {
    p_search: search || null,
    p_limit: limit
  })
  return {
    data: Array.isArray(result.data?.tasks) ? result.data.tasks : [],
    error: result.error?.message || null
  }
}
