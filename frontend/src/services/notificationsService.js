import { supabase } from "../lib/supabase"

export async function getNotifications(limit = 100) {
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
    return fallback
  }

  return { data: Array.isArray(data) ? data : [], error: null }
}

export async function markNotificationRead(id) {
  const result = await supabase.rpc("mark_notification_read", { p_notification_id: id })
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
