import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import BrandLogo from "../components/branding/BrandLogo"
import GoalEnergyWidget from "../components/GoalEnergyWidget"
import SupabaseConnectionTest from "../components/SupabaseConnectionTest"
import WaiterRankingWidget from "../components/WaiterRankingWidget"
import { useAuth } from "../context/AuthContext"
import useAppBranding from "../hooks/useAppBranding"
import { getCurrentUserTaskId, loadAssignedTasks, loadTaskNotifications, taskMatchesUser, withComputedTaskStatus } from "../utils/tasks"

function Dashboard() {
  const { user, canAccess } = useAuth()
  const branding = useAppBranding()
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
    <section className="dashboard-page">
      <header className="dashboard-page-header">
        <BrandLogo branding={branding} variant="full" />
      </header>
      {canAccess("production") && (
        <article className="erp-card erp-card-accent dashboard-action-card">
          <div>
            <h2>Producción</h2>
            <p className="erp-muted">Estaciones de producción y tableros KDS por área</p>
          </div>
          <button type="button" className="erp-btn-primary" onClick={() => navigate("/production")}>Abrir Producción</button>
        </article>
      )}
      {canAccess("cash") && (
        <article className="erp-card dashboard-action-card">
          <div>
            <h2>Caja</h2>
            <p className="erp-muted">Cobros, arqueos y solicitudes de pago</p>
          </div>
          <button type="button" className="erp-btn-primary" onClick={() => navigate("/cash")}>Abrir Caja</button>
        </article>
      )}
      <div className="dashboard-goal-grid">
        <GoalEnergyWidget />
        <WaiterRankingWidget />
      </div>
      <SupabaseConnectionTest />
      <article className="erp-card dashboard-tasks-card">
        <div className="dashboard-tasks-head">
          <div>
            <h2>Mis tareas operativas</h2>
            <p className="erp-muted">{notifications.length} notificaciones nuevas · {pending.length} tareas pendientes</p>
          </div>
          <button type="button" className="erp-btn-primary" onClick={() => navigate("/tasks?view=mine")}>Ver mis tareas</button>
        </div>
        {pending.slice(0, 3).map((task) => (
          <div key={task.id} className="dashboard-task-row">
            <strong>{task.title}</strong>
            <span className="erp-muted">{task.areaName} · {task.date} · {task.status === "late" ? "Atrasada" : task.status === "in_progress" ? "En proceso" : "Pendiente"}</span>
          </div>
        ))}
        {!pending.length && <p className="erp-muted">No tienes tareas pendientes asignadas.</p>}
      </article>
    </section>
  )
}

export default Dashboard
