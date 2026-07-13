import { supabase } from "../lib/supabase"

function normalizeDetail(result) {
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function createTaskStepList(taskId, payload = {}) {
  const result = await supabase.rpc("create_task_step_list", {
    p_task_id: taskId,
    p_title: payload.title || "Plan de trabajo",
    p_copy_from_list_id: payload.copyFromListId || null
  })
  return normalizeDetail(result)
}

export async function deleteTaskStepList(listId) {
  const result = await supabase.rpc("delete_task_step_list", { p_list_id: listId })
  return normalizeDetail(result)
}

export async function createTaskStep(listId, payload = {}) {
  const result = await supabase.rpc("create_task_step", {
    p_list_id: listId,
    p_text: payload.text,
    p_sort_position: payload.sortPosition ?? null
  })
  return normalizeDetail(result)
}

export async function updateTaskStep(stepId, payload = {}) {
  const result = await supabase.rpc("update_task_step", {
    p_step_id: stepId,
    p_data: payload
  })
  return normalizeDetail(result)
}

export async function toggleTaskStep(stepId, completed) {
  const result = await supabase.rpc("toggle_task_step", {
    p_step_id: stepId,
    p_completed: completed
  })
  return normalizeDetail(result)
}

export async function reorderTaskSteps(listId, stepIds) {
  const result = await supabase.rpc("reorder_task_steps", {
    p_list_id: listId,
    p_step_ids: stepIds
  })
  return normalizeDetail(result)
}

export async function moveTaskStep(stepId, targetListId, sortPosition = null) {
  const result = await supabase.rpc("move_task_step", {
    p_step_id: stepId,
    p_target_list_id: targetListId,
    p_sort_position: sortPosition
  })
  return normalizeDetail(result)
}

export async function deleteTaskStep(stepId) {
  const result = await supabase.rpc("delete_task_step", { p_step_id: stepId })
  return normalizeDetail(result)
}

export async function convertTaskStepToTask(stepId) {
  const result = await supabase.rpc("convert_task_step_to_task", { p_step_id: stepId })
  return {
    data: result.data || null,
    error: result.error?.message || null
  }
}

export async function registerTaskAttachment(taskId, payload = {}) {
  const result = await supabase.rpc("register_task_attachment", {
    p_task_id: taskId,
    p_step_id: payload.stepId || null,
    p_storage_path: payload.storagePath || null,
    p_display_name: payload.displayName || null,
    p_mime_type: payload.mimeType || null,
    p_size_bytes: payload.sizeBytes ?? null,
    p_external_url: payload.externalUrl || null
  })
  return normalizeDetail(result)
}

export async function deleteTaskAttachment(attachmentId) {
  const result = await supabase.rpc("delete_task_attachment", { p_attachment_id: attachmentId })
  return normalizeDetail(result)
}

export async function createTaskComment(taskId, body, stepId = null) {
  const result = await supabase.rpc("create_task_comment", {
    p_task_id: taskId,
    p_body: body,
    p_step_id: stepId
  })
  return normalizeDetail(result)
}

export async function deleteTaskComment(commentId) {
  const result = await supabase.rpc("delete_task_comment", { p_comment_id: commentId })
  return normalizeDetail(result)
}

export async function submitTaskEvidence(taskId, payload = {}) {
  const result = await supabase.rpc("submit_task_evidence", {
    p_task_id: taskId,
    p_evidence_type: payload.evidenceType || "photo",
    p_step_id: payload.stepId || null,
    p_storage_path: payload.storagePath || null,
    p_external_url: payload.externalUrl || null,
    p_display_name: payload.displayName || null,
    p_mime_type: payload.mimeType || null,
    p_size_bytes: payload.sizeBytes ?? null,
    p_note_text: payload.noteText || null
  })
  return normalizeDetail(result)
}

export async function verifyTaskEvidence(evidenceId) {
  const result = await supabase.rpc("verify_task_evidence", { p_evidence_id: evidenceId })
  return normalizeDetail(result)
}

export async function deleteTaskEvidence(evidenceId) {
  const result = await supabase.rpc("delete_task_evidence", { p_evidence_id: evidenceId })
  return normalizeDetail(result)
}

export async function scheduleTaskReminder(taskId, payload = {}) {
  const result = await supabase.rpc("schedule_task_reminder", {
    p_task_id: taskId,
    p_reminder_at: payload.reminderAt,
    p_step_id: payload.stepId || null,
    p_profile_id: payload.profileId || null
  })
  return normalizeDetail(result)
}

export async function uploadTaskFile(taskId, file, attachmentId) {
  const safeName = String(file.name || "archivo").replace(/[^\w.\-]+/g, "_")
  const path = `${taskId}/${attachmentId}/${safeName}`
  const { error } = await supabase.storage.from("task-files").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined
  })
  if (error) return { storagePath: null, error: error.message }
  return { storagePath: path, error: null }
}

export async function getTaskFileSignedUrl(storagePath, expiresIn = 3600) {
  const result = await supabase.storage.from("task-files").createSignedUrl(storagePath, expiresIn)
  return {
    url: result.data?.signedUrl || null,
    error: result.error?.message || null
  }
}
