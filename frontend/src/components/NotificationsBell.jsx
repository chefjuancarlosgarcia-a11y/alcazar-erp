import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import useSupabaseRealtime from "../hooks/useSupabaseRealtime"
import { getNotifications, isNotificationUnread, markNotificationRead, normalizeIsRead } from "../services/notificationsService"
import {
  buildPurchaseOrderNotificationUrl,
  resolveNotificationTarget
} from "../utils/inventoryNotificationRoutes"
import { filterVisibleNotifications } from "../utils/cateringNotificationRoles"
import "./NotificationsBell.css"

const PURCHASE_ORDER_APPROVAL_ROLES = ["admin", "gerente_general"]
const CHECKLIST_APPROVAL_ROLES = ["admin", "gerente_general", "gerente", "recursos_humanos", "rrhh"]

function isInternalActionUrl(url) {
  const value = String(url || "").trim()
  return value.startsWith("/") && !value.startsWith("//")
}

function NotificationsBell({ currentUser }) {
  const navigate = useNavigate()
  const { session } = useAuth()
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [error, setError] = useState("")

  const loadNotifications = useCallback(async () => {
    if (!session?.user?.id) return

    const { data, error: queryError } = await getNotifications(100)

    if (queryError) {
      console.error("[NotificationsBell] queryError", queryError.message || queryError)
      setError(queryError.message || "No se pudieron cargar las notificaciones.")
      setNotifications([])
      return
    }

    setError("")
    setNotifications(filterVisibleNotifications(data || [], currentUser?.role))
  }, [currentUser?.role, session?.user?.id])

  useSupabaseRealtime({
    table: "notifications",
    event: "INSERT",
    enabled: Boolean(session?.user?.id),
    onChange: loadNotifications
  })

  useEffect(() => {
    const initialLoad = window.setTimeout(loadNotifications, 0)
    window.addEventListener("notifications-updated", loadNotifications)
    return () => {
      window.clearTimeout(initialLoad)
      window.removeEventListener("notifications-updated", loadNotifications)
    }
  }, [loadNotifications])

  useEffect(() => {
    function closeOutside(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener("mousedown", closeOutside)
    return () => document.removeEventListener("mousedown", closeOutside)
  }, [])

  async function markRead(notification) {
    if (isNotificationUnread(notification)) await markNotificationRead(notification.id)
  }

  async function viewEntity(notification) {
    await markRead(notification)
    setOpen(false)
    const target = resolveNotificationTarget(notification)
    if (target?.url && isInternalActionUrl(target.url)) {
      navigate(target.url)
      return
    }
    if (notification.action_url && isInternalActionUrl(notification.action_url)) {
      navigate(notification.action_url)
      return
    }
    if (notification.entity_type === "purchase_order") {
      navigate(buildPurchaseOrderNotificationUrl({
        entityId: notification.entity_id,
        notificationType: notification.type
      }))
    } else if (["employee_schedule", "schedule_week"].includes(notification.entity_type)) {
      navigate("/hr?section=horarios")
    } else if (notification.entity_type === "checklist_run") {
      navigate(`/tasks?tab=checklists&view=run&id=${encodeURIComponent(notification.entity_id || "")}`)
    } else if (notification.entity_type === "checklist_management_alert") {
      navigate(notification.action_url || `/tasks?tab=checklists&view=alerts&id=${encodeURIComponent(notification.entity_id || "")}`)
    } else if (["checklist_template_change_request", "checklist_approval_result"].includes(notification.entity_type)) {
      navigate(notification.action_url || `/tasks?tab=checklists&view=approvals&id=${encodeURIComponent(notification.entity_id || "")}`)
    } else if (notification.entity_type === "catering_request") {
      navigate(notification.action_url || `/catering?id=${encodeURIComponent(notification.entity_id || "")}`)
    } else if (notification.entity_type === "recruitment_candidate") {
      navigate(notification.action_url || `/hr?section=reclutamiento&tab=pipeline&candidateId=${encodeURIComponent(notification.entity_id || "")}`)
    } else if (notification.entity_type === "task") {
      navigate("/tasks?view=mine")
    }
  }

  async function processOrder(notification, action) {
    await markRead(notification)
    window.sessionStorage.setItem("purchase-order-notification-action", JSON.stringify({
      action,
      id: notification.entity_id
    }))
    window.dispatchEvent(new CustomEvent("purchase-order-action", {
      detail: { action, id: notification.entity_id }
    }))
    setOpen(false)
    navigate(buildPurchaseOrderNotificationUrl({
      entityId: notification.entity_id,
      notificationType: notification.type,
      status: "pendiente_aprobacion",
      action
    }))
  }

  const unreadCount = notifications.filter((notification) => isNotificationUnread(notification)).length

  return (
    <div className="notifications-bell" ref={rootRef}>
      <button type="button" className="notifications-bell-trigger" aria-label="Notificaciones" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span aria-hidden="true">&#128276;</span>
        {unreadCount > 0 && <b>{unreadCount > 99 ? "99+" : unreadCount}</b>}
      </button>
      {open && (
        <section className="notifications-panel" aria-label="Panel de notificaciones">
          <header>
            <strong>Notificaciones</strong>
            <small>{unreadCount} pendiente{unreadCount === 1 ? "" : "s"}</small>
          </header>
          {error && <p className="notifications-error">{error}</p>}
          {!error && notifications.length === 0 && <p className="notifications-empty">No tienes notificaciones.</p>}
          <div className="notifications-list">
            {notifications.map((notification) => (
              <article className={normalizeIsRead(notification.is_read) ? "read" : ""} key={notification.id}>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                <small>{new Date(notification.created_at).toLocaleString("es-GT")}</small>
                <div className="notifications-actions">
                  {notification.entity_type === "purchase_order" && <button type="button" onClick={() => viewEntity(notification)}>Ver orden</button>}
                  {notification.entity_type === "requisition" && <button type="button" onClick={() => viewEntity(notification)}>Ver requisición</button>}
                  {["employee_schedule", "schedule_week"].includes(notification.entity_type) && <button type="button" onClick={() => viewEntity(notification)}>Ver horario</button>}
                  {notification.entity_type === "checklist_run" && <button type="button" onClick={() => viewEntity(notification)}>Abrir checklist</button>}
                  {notification.entity_type === "task" && <button type="button" onClick={() => viewEntity(notification)}>Ir a tarea</button>}
                  {notification.entity_type === "checklist_template_change_request" && (
                    <button type="button" onClick={() => viewEntity(notification)}>
                      {CHECKLIST_APPROVAL_ROLES.includes(currentUser?.role) ? "Revisar y aprobar" : "Ver solicitud"}
                    </button>
                  )}
                  {notification.entity_type === "checklist_approval_result" && (
                    <button type="button" onClick={() => viewEntity(notification)}>
                      {notification.title?.toLowerCase().includes("aprobada") ? "Ir a checklists" : "Ver detalle"}
                    </button>
                  )}
                  {notification.type === "checklist_approval_pending" && (
                    <button type="button" onClick={() => viewEntity(notification)}>Ver estado</button>
                  )}
                  {notification.entity_type === "checklist_management_alert" && <button type="button" onClick={() => viewEntity(notification)}>Ver aviso</button>}
                  {notification.entity_type === "catering_request" && (
                    <button type="button" onClick={() => viewEntity(notification)}>
                      {notification.type === "catering_lead_assigned"
                        ? "Ver lead asignado"
                        : notification.type === "catering_followup_due"
                          ? "Dar seguimiento"
                          : notification.type === "catering_quote"
                            ? "Ver cotizacion"
                            : "Ver solicitud"}
                    </button>
                  )}
                  {notification.entity_type === "recruitment_candidate" && (
                    <button type="button" onClick={() => viewEntity(notification)}>Ver candidato</button>
                  )}
                  {notification.action_url && !["purchase_order", "requisition", "employee_schedule", "schedule_week", "checklist_run", "checklist_template_change_request", "checklist_management_alert", "task", "catering_request", "recruitment_candidate"].includes(notification.entity_type) && <button type="button" onClick={() => viewEntity(notification)}>Abrir</button>}
                  {notification.entity_type === "purchase_order" && notification.type === "purchase_order_pending" && PURCHASE_ORDER_APPROVAL_ROLES.includes(currentUser?.role) && (
                    <>
                      <button type="button" className="approve" onClick={() => processOrder(notification, "approve")}>Aprobar</button>
                      <button type="button" className="reject" onClick={() => processOrder(notification, "reject")}>Rechazar</button>
                    </>
                  )}
                  {!isNotificationUnread(notification) ? null : (
                    <button type="button" onClick={() => markRead(notification)}>Marcar leída</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export default NotificationsBell
