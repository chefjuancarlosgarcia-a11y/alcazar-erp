import { useCallback, useEffect, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { getNotifications, markNotificationRead } from "../services/notificationsService"
import "./NotificationsBell.css"

const APPROVAL_ROLES = ["admin", "gerente_general"]

function NotificationsBell({ currentUser }) {
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [error, setError] = useState("")

  const loadNotifications = useCallback(async () => {
    const { data, error: queryError } = await getNotifications()
    if (queryError) {
      setError("No se pudieron cargar las notificaciones.")
      return
    }
    setError("")
    setNotifications(data || [])
  }, [])

  useEffect(() => {
    const initialLoad = window.setTimeout(loadNotifications, 0)
    const interval = window.setInterval(loadNotifications, 30000)
    window.addEventListener("notifications-updated", loadNotifications)
    return () => {
      window.clearTimeout(initialLoad)
      window.clearInterval(interval)
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
    if (!notification.is_read) await markNotificationRead(notification.id)
  }

  async function viewEntity(notification) {
    await markRead(notification)
    setOpen(false)
    if (notification.entity_type === "purchase_order") {
      navigate(`/inventory?section=ordenes&view=history&order=${encodeURIComponent(notification.entity_id || "")}`)
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
    navigate(`/inventory?section=ordenes&view=history&order=${encodeURIComponent(notification.entity_id || "")}`)
  }

  const unreadCount = notifications.filter((notification) => !notification.is_read).length

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
              <article className={notification.is_read ? "read" : ""} key={notification.id}>
                <strong>{notification.title}</strong>
                <p>{notification.message}</p>
                <small>{new Date(notification.created_at).toLocaleString("es-GT")}</small>
                <div className="notifications-actions">
                  {notification.entity_type === "purchase_order" && <button type="button" onClick={() => viewEntity(notification)}>Ver orden</button>}
                  {notification.entity_type === "purchase_order" && notification.type === "purchase_order_pending" && APPROVAL_ROLES.includes(currentUser?.role) && (
                    <>
                      <button type="button" className="approve" onClick={() => processOrder(notification, "approve")}>Aprobar</button>
                      <button type="button" className="reject" onClick={() => processOrder(notification, "reject")}>Rechazar</button>
                    </>
                  )}
                  {!notification.is_read && <button type="button" onClick={() => markRead(notification)}>Marcar leída</button>}
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
