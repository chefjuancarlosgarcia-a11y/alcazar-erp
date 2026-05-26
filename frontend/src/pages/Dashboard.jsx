import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BRANDING } from "../branding"
import SupabaseConnectionTest from "../components/SupabaseConnectionTest"
import { useAuth } from "../context/AuthContext"
import { getCurrentUserTaskId, loadAssignedTasks, loadTaskNotifications, taskMatchesUser, withComputedTaskStatus } from "../utils/tasks"

function Dashboard() {
  const { user, canAccess } = useAuth()
  const navigate = useNavigate()
  const [tasks, setTasks] = useState(() => loadAssignedTasks().map(withComputedTaskStatus).filter((task) => taskMatchesUser(task, user)))
  const [notifications, setNotifications] = useState(() => loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user) && !notification.read))

  useEffect(() => {
    function refresh() {
      setTasks(loadAssignedTasks().map(withComputedTaskStatus).filter((task) => taskMatchesUser(task, user)))
      setNotifications(loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user) && !notification.read))
    }
    window.addEventListener("task-notifications-updated", refresh)
    return () => window.removeEventListener("task-notifications-updated", refresh)
  }, [user])

  const pending = tasks.filter((task) => ["pending", "in_progress", "late"].includes(task.status))

  return (
    <section style={pageStyle}>
      <h1>{BRANDING.logo} {BRANDING.appName}</h1>
      <p>{BRANDING.tagline}</p>
      {canAccess("production") && (
        <article style={productionCardStyle}>
          <div>
            <h2 style={taskTitleStyle}>Producción</h2>
            <p style={taskMutedStyle}>KDS / Pantallas de producción por área</p>
          </div>
          <button type="button" style={buttonStyle} onClick={() => navigate("/production")}>Abrir KDS</button>
        </article>
      )}
      {canAccess("cash") && (
        <article style={cashCardStyle}>
          <div>
            <h2 style={taskTitleStyle}>Caja</h2>
            <p style={taskMutedStyle}>Cobros, arqueos y solicitudes de pago</p>
          </div>
          <button type="button" style={buttonStyle} onClick={() => navigate("/cash")}>Abrir Caja</button>
        </article>
      )}
      <SupabaseConnectionTest />
      <article style={tasksCardStyle}>
        <div style={taskHeaderStyle}>
          <div>
            <h2 style={taskTitleStyle}>Mis tareas operativas</h2>
            <p style={taskMutedStyle}>{notifications.length} notificaciones nuevas · {pending.length} tareas pendientes</p>
          </div>
          <button type="button" style={buttonStyle} onClick={() => navigate("/tasks?view=mine")}>Ver mis tareas</button>
        </div>
        {pending.slice(0, 3).map((task) => (
          <div key={task.id} style={taskRowStyle}>
            <strong>{task.title}</strong>
            <span style={taskMutedStyle}>{task.areaName} · {task.date} · {task.status === "late" ? "Atrasada" : task.status === "in_progress" ? "En proceso" : "Pendiente"}</span>
          </div>
        ))}
        {!pending.length && <p style={taskMutedStyle}>No tienes tareas pendientes asignadas.</p>}
      </article>
    </section>
  )
}

const pageStyle = {
  display: "grid",
  gap: "18px"
}

const tasksCardStyle = { display: "grid", gap: "11px", maxWidth: "720px", marginTop: "22px", padding: "18px", border: "1px solid #24344a", borderRadius: "14px", background: "#0f172a" }
const productionCardStyle = { ...tasksCardStyle, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", marginTop: "22px", borderColor: "#0f766e", background: "#08252c" }
const cashCardStyle = { ...productionCardStyle, marginTop: 0, borderColor: "#164e63", background: "#092333" }
const taskHeaderStyle = { display: "flex", alignItems: "start", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }
const taskTitleStyle = { margin: "0 0 5px", color: "#f8fafc", fontSize: "20px" }
const taskMutedStyle = { color: "#94a3b8", fontSize: "14px" }
const taskRowStyle = { display: "grid", gap: "4px", padding: "11px", borderRadius: "9px", background: "#111c30", color: "#e6eef8" }
const buttonStyle = { padding: "10px 13px", border: "none", borderRadius: "8px", background: "#0ea5a4", color: "#022c2c", fontWeight: 700, cursor: "pointer" }

export default Dashboard
