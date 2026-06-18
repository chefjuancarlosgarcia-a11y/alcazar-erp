import { normalizeRole } from "./profilePermissions"

/** Roles allowed to receive catering notifications (keep in sync with catering_notification_roles SQL). */
export const CATERING_NOTIFICATION_ROLES = Object.freeze([
  "admin",
  "gerente_general",
  "gerente_operaciones"
])

/** Reserved for future app config — not enabled yet. */
export const CATERING_NOTIFICATION_ROLES_OPTIONAL = Object.freeze([
  "sales_rep",
  "catering_manager"
])

const CATERING_NOTIFICATION_TYPES = new Set([
  "catering_request",
  "catering_followup_due",
  "catering_quote",
  "catering_lead_assigned"
])

export function canReceiveCateringNotifications(role) {
  const normalized = normalizeRole(role)
  return CATERING_NOTIFICATION_ROLES.includes(normalized)
}

export function isCateringNotification(notification) {
  if (!notification) return false
  if (String(notification.entity_type || "") === "catering_request") return true
  return CATERING_NOTIFICATION_TYPES.has(String(notification.type || ""))
}

export function filterVisibleNotifications(notifications, userRole) {
  if (!Array.isArray(notifications) || !notifications.length) return []
  if (canReceiveCateringNotifications(userRole)) return notifications
  return notifications.filter((notification) => !isCateringNotification(notification))
}
