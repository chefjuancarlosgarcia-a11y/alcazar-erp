import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { getCurrentUserTaskId, loadTaskNotifications, markTaskNotificationsRead } from "../utils/tasks"
import "./UserProfileDropdown.css"

const roleNames = {
  admin: "Administrador",
  gerente: "Gerente General",
  gerente_general: "Gerente General",
  rrhh: "Recursos Humanos",
  supervisor: "Supervisor",
  cocina: "Cocina",
  mesero: "Servicio"
}

function getManagedProfile(currentUser) {
  if (!currentUser?.id) return null

  try {
    const users = JSON.parse(localStorage.getItem("users") || "[]")
    return Array.isArray(users) ? users.find((user) => user.id === currentUser.id) : null
  } catch {
    return null
  }
}

function getInitials(name) {
  return String(name || "Usuario")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
}

function formatLastLogin(value) {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("es-GT", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date)
}

function UserProfileDropdown({ currentUser, onOpenProfile }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const rootRef = useRef(null)
  const [isOpen, setIsOpen] = useState(false)
  const taskUserId = getCurrentUserTaskId(currentUser)
  const [taskNotifications, setTaskNotifications] = useState(() => loadTaskNotifications().filter((notification) => notification.userId === taskUserId))
  const managedProfile = getManagedProfile(currentUser)
  const profile = useMemo(() => ({
    name: currentUser?.name || managedProfile?.nombre || "Usuario",
    username: currentUser?.username || managedProfile?.username || "",
    email: currentUser?.email || managedProfile?.correo || "",
    avatar: currentUser?.avatar || managedProfile?.fotoColaborador || "",
    role: currentUser?.legacyRole || roleNames[currentUser?.role] || "Usuario",
    auth: {
      isOnline: currentUser?.auth?.isOnline ?? managedProfile?.auth?.isOnline ?? true,
      lastLogin: currentUser?.auth?.lastLogin || managedProfile?.auth?.lastLogin || null
    }
  }), [currentUser, managedProfile])
  const lastLogin = formatLastLogin(profile.auth.lastLogin)
  const isManager = ["admin", "gerente", "gerente_general"].includes(currentUser?.role) ||
    ["Administrador", "Gerente General"].includes(currentUser?.legacyRole)
  const unreadNotifications = taskNotifications.filter((notification) => !notification.read)

  useEffect(() => {
    function handleOutsideClick(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") setIsOpen(false)
    }

    document.addEventListener("mousedown", handleOutsideClick)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  useEffect(() => {
    function refreshNotifications() {
      setTaskNotifications(loadTaskNotifications().filter((notification) => notification.userId === taskUserId))
    }
    window.addEventListener("task-notifications-updated", refreshNotifications)
    return () => window.removeEventListener("task-notifications-updated", refreshNotifications)
  }, [taskUserId])

  function openSection(path) {
    setIsOpen(false)
    navigate(path)
  }

  async function handleLogout() {
    setIsOpen(false)
    await logout()
    navigate("/login", { replace: true })
  }

  function openProfile(view = "profile") {
    setIsOpen(false)
    if (onOpenProfile) {
      onOpenProfile(view)
      return
    }
    navigate(view === "password" ? "/account?section=password" : "/account")
  }

  function openMyTasks() {
    markTaskNotificationsRead(taskUserId)
    setTaskNotifications(loadTaskNotifications().filter((notification) => notification.userId === taskUserId))
    openSection("/tasks?view=mine")
  }

  return (
    <div className="user-profile-dropdown" ref={rootRef}>
      <button
        className="user-profile-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        {profile.avatar ? (
          <img className="user-profile-trigger-avatar" src={profile.avatar} alt="" />
        ) : (
          <span className="user-profile-trigger-avatar user-profile-initials">{getInitials(profile.name)}</span>
        )}
        <span className="user-profile-trigger-summary">
          <strong>{profile.name}</strong>
          <small>{profile.role}</small>
        </span>
        <span className={`user-profile-chevron ${isOpen ? "open" : ""}`} aria-hidden="true">&#9662;</span>
      </button>

      <div className={`user-profile-menu ${isOpen ? "open" : ""}`} role="menu" aria-hidden={!isOpen}>
        <div className="user-profile-identity">
          {profile.avatar ? (
            <img className="user-profile-avatar" src={profile.avatar} alt={`Foto de ${profile.name}`} />
          ) : (
            <span className="user-profile-avatar user-profile-initials">{getInitials(profile.name)}</span>
          )}
          <div className="user-profile-data">
            <strong>{profile.name}</strong>
            <span>{profile.email || `@${profile.username}`}</span>
            <span className="user-profile-role">{profile.role}</span>
          </div>
        </div>

        <div className="user-profile-status">
          {profile.auth.isOnline === true && (
            <span className="user-profile-online"><i />En línea</span>
          )}
          {lastLogin && <span className="user-profile-last-login">Último acceso: {lastLogin}</span>}
        </div>

        <div className="user-profile-divider" />
        <div className="user-profile-actions">
          <button type="button" role="menuitem" onClick={() => openProfile()}>Mi perfil</button>
          <button type="button" role="menuitem" onClick={() => openProfile("password")}>Cambiar contraseña</button>
          <button type="button" role="menuitem" onClick={openMyTasks}>Mis tareas</button>
          <button type="button" role="menuitem" onClick={() => openSection("/account?section=settings")}>Configuración de cuenta</button>
          <button type="button" role="menuitem" onClick={openMyTasks}>Notificaciones {unreadNotifications.length ? `(${unreadNotifications.length})` : ""}</button>
        </div>

        {unreadNotifications.length > 0 && (
          <div className="user-profile-notifications">
            {unreadNotifications.slice(0, 3).map((notification) => (
              <button type="button" key={notification.id} onClick={openMyTasks}>
                <strong>{notification.title}</strong>
                <span>{notification.message}</span>
              </button>
            ))}
          </div>
        )}

        {isManager && (
          <>
            <div className="user-profile-divider" />
            <p className="user-profile-section-title">Administración</p>
            <div className="user-profile-actions">
              <button type="button" role="menuitem" onClick={() => openSection("/hr?section=usuarios")}>Gestión de usuarios</button>
              <button type="button" role="menuitem" onClick={() => openSection("/settings")}>Configuración del sistema</button>
            </div>
          </>
        )}

        <div className="user-profile-divider" />
        <button className="user-profile-logout" type="button" role="menuitem" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </div>
    </div>
  )
}

export default UserProfileDropdown
