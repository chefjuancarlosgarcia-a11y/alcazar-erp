import { useMemo, useState } from "react"
import { NavLink, Navigate, useLocation } from "react-router-dom"
import { useAuth } from "../../context/AuthContext"
import { normalizeRole } from "../../utils/profilePermissions"
import { canViewOperationalTaskBoard } from "../../config/operationalTasksConfig"
import TaskBoard from "./TaskBoard"
import MyWork from "./MyWork"
import "./operationalTasks.css"

function WorkSubnav({ showBoard }) {
  return (
    <nav className="ot-subnav" aria-label="Trabajo">
      <NavLink to="/tasks/trabajo/mi-trabajo" className={({ isActive }) => (isActive ? "active" : "")}>
        Mi trabajo
      </NavLink>
      {showBoard ? (
        <NavLink to="/tasks/trabajo/tablero" className={({ isActive }) => (isActive ? "active" : "")}>
          Tablero
        </NavLink>
      ) : null}
    </nav>
  )
}

export default function WorkRoutes() {
  const location = useLocation()
  const { user } = useAuth()
  const [message, setMessage] = useState({ text: "", tone: "" })
  const currentUserRole = normalizeRole(user?.role)
  const showBoard = canViewOperationalTaskBoard(currentUserRole)

  const onMessage = useMemo(
    () => (text, tone = "success") => setMessage({ text, tone }),
    []
  )

  const pathname = location.pathname

  if (pathname === "/tasks/trabajo" || pathname === "/tasks/trabajo/") {
    return <Navigate to="/tasks/trabajo/mi-trabajo" replace />
  }

  if (pathname.includes("/tasks/trabajo/operacion")) {
    return <Navigate to="/tasks?tab=checklists" replace />
  }

  let content = <MyWork onMessage={onMessage} />
  if (pathname.includes("/tasks/trabajo/tablero") && showBoard) {
    content = <TaskBoard onMessage={onMessage} />
  }

  return (
    <div className="erp-section-stack">
      <WorkSubnav showBoard={showBoard} />

      {message.text ? (
        <p className={`ot-feedback ot-feedback--${
          message.tone === "error" ? "error" : message.tone === "warning" ? "warning" : "success"
        }`}>
          {message.text}
        </p>
      ) : null}

      {content}
    </div>
  )
}
