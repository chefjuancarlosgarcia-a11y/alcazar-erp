import { supabase } from "../lib/supabase"

export async function getNotifications() {
  return supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)
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
    p_entity_id: notification.entityId == null ? null : String(notification.entityId)
  })
  window.dispatchEvent(new CustomEvent("notifications-updated"))
  return result
}

export async function notifyRoles(roles, notification) {
  return Promise.all(roles.map((targetRole) => createNotification({ ...notification, targetRole })))
}
