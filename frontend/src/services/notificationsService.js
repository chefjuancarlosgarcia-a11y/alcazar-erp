import { supabase } from "../lib/supabase"
import { filterVisibleNotifications } from "../utils/cateringNotificationRoles"

function normalizeNotificationRows(data) {
  if (Array.isArray(data)) return data
  if (data && typeof data === "object") return [data]
  return []
}

/** PostgREST devuelve boolean; algunos proxies/serializadores pueden enviar "false"/"true" como string. */
export function normalizeIsRead(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true
  if (value === false || value === 0 || value === "0" || value === "false") return false
  if (value == null) return false
  return Boolean(value)
}

export function isNotificationUnread(row) {
  return !normalizeIsRead(row?.is_read)
}

export async function getNotifications(limit = 100) {
  const { data: sessionData } = await supabase.auth.getSession()
  const sessionUserId = sessionData?.session?.user?.id || null

  if (!sessionUserId) {
    return { data: [], error: null }
  }

  const { data: profileData } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", sessionUserId)
    .maybeSingle()
  const userRole = profileData?.role || null

  const { data, error } = await supabase.rpc("get_my_notifications", {
    p_limit: limit
  })

  if (error) {
    const fallback = await supabase
      .from("notifications")
      .select("*")
      .order("is_read", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit)
    return {
      data: filterVisibleNotifications(normalizeNotificationRows(fallback.data), userRole),
      error: fallback.error
    }
  }

  return {
    data: filterVisibleNotifications(normalizeNotificationRows(data), userRole),
    error: null
  }
}

export async function markNotificationRead(id) {
  const result = await supabase.rpc("mark_notification_read", { p_notification_id: id })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function markAllNotificationsRead() {
  const result = await supabase.rpc("mark_all_my_notifications_read")
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function createNotification(notification) {
  const result = await supabase.rpc("create_notification", {
    p_user_id: notification.userId || null,
    p_target_role: notification.targetRole || null,
    p_type: notification.type,
    p_title: notification.title,
    p_message: notification.message,
    p_entity_type: notification.entityType || null,
    p_entity_id: notification.entityId == null ? null : String(notification.entityId),
    p_action_url: notification.actionUrl || null
  })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function notifyRoles(roles, notification) {
  return Promise.all(roles.map((targetRole) => createNotification({ ...notification, targetRole })))
}
