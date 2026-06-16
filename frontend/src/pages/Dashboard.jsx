import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import BrandLogo from "../components/branding/BrandLogo"
import GoalEnergyWidget from "../components/GoalEnergyWidget"
import SupabaseConnectionTest from "../components/SupabaseConnectionTest"
import WaiterRankingWidget from "../components/WaiterRankingWidget"
import {
  CommandCenterHeader,
  CommandCenterInsightsRow,
  CommandCenterSemaphores,
  useCommandCenter
} from "../components/commandCenter/CommandCenterLayer"
import { money } from "../components/commandCenter/commandCenterHelpers"
import { useAuth } from "../context/AuthContext"
import useAppBranding from "../hooks/useAppBranding"
import {
  getCurrentUserTaskId,
  loadAssignedTasks,
  loadTaskNotifications,
  taskMatchesUser,
  withComputedTaskStatus
} from "../utils/tasks"
import "./Dashboard.css"
import "../components/commandCenter/CommandCenterLayer.css"

const EXECUTIVE_ROLES = new Set(["admin", "ceo", "gerente_general"])

function percentChange(current, previous) {
  if (!previous && !current) return 0
  if (!previous) return current > 0 ? 100 : 0
  return ((Number(current || 0) - Number(previous || 0)) / Number(previous || 1)) * 100
}

function formatDelta(value) {
  const rounded = Number(value || 0)
  if (Math.abs(rounded) < 0.05) return { label: "— 0%", tone: "flat" }
  const sign = rounded >= 0 ? "▲" : "▼"
  return { label: `${sign} ${Math.abs(rounded).toFixed(0)}%`, tone: rounded >= 0 ? "up" : "down" }
}

function ExecutiveCommandCenter({ recentTasks = [] }) {
  const navigate = useNavigate()
  const cc = useCommandCenter(recentTasks)

  const prev = cc.executiveReport?.previous || {}
  const curr = cc.executiveReport?.current || {}
  const kpis = cc.kpis

  const kpiCards = useMemo(() => ([
    {
      key: "salesToday",
      label: "Ventas hoy",
      value: money(kpis?.salesToday),
      delta: formatDelta(percentChange(curr.day?.total, prev.day?.total)),
      hint: "Ingresos del día",
      tone: "accent",
      to: "/reports?tab=sales",
      icon: "💰"
    },
    {
      key: "salesMonth",
      label: "Ventas mes",
      value: money(kpis?.salesMonth),
      delta: formatDelta(percentChange(curr.month?.total, prev.month?.total)),
      hint: "Acumulado mensual",
      tone: "accent",
      to: "/reports?tab=executive",
      icon: "📈"
    },
    {
      key: "ordersToday",
      label: "Órdenes hoy",
      value: Number(kpis?.ordersToday || 0),
      delta: formatDelta(percentChange(curr.day?.orders, prev.day?.orders)),
      hint: "Transacciones registradas",
      tone: "neutral",
      to: "/reports?tab=sales",
      icon: "🧾"
    },
    {
      key: "averageTicket",
      label: "Ticket promedio",
      value: money(kpis?.averageTicket),
      delta: formatDelta(percentChange(curr.day?.averageTicket, prev.day?.averageTicket)),
      hint: "Promedio por orden",
      tone: "neutral",
      to: "/reports?tab=sales",
      icon: "🎯"
    },
    {
      key: "activeTables",
      label: "Mesas activas",
      value: Number(kpis?.activeTables || 0),
      delta: { label: "En vivo", tone: "flat" },
      hint: "Órdenes abiertas ahora",
      tone: kpis?.activeTables ? "warn" : "good",
      to: "/pos",
      icon: "🍽️"
    },
    {
      key: "activeTickets",
      label: "Tickets producción",
      value: Number(kpis?.activeTickets || 0),
      delta: { label: cc.productionLate ? `${cc.productionLate} atrasados` : "Al día", tone: cc.productionLate ? "down" : "up" },
      hint: "KDS en curso",
      tone: kpis?.activeTickets ? "warn" : "good",
      to: "/production",
      icon: "👨‍🍳"
    },
    {
      key: "lowStock",
      label: "Stock bajo",
      value: Number(kpis?.lowStock || 0),
      delta: { label: cc.inventoryOut ? `${cc.inventoryOut} agotados` : "Controlado", tone: cc.inventoryOut ? "down" : "up" },
      hint: "Productos bajo mínimo",
      tone: kpis?.lowStock ? "danger" : "good",
      to: "/reports?tab=inventory",
      icon: "📦"
    },
    {
      key: "pendingRequisitions",
      label: "Requisiciones",
      value: Number(kpis?.pendingRequisitions || 0),
      delta: { label: kpis?.pendingRequisitions ? "Pendientes" : "Al día", tone: kpis?.pendingRequisitions ? "down" : "up" },
      hint: "Por aprobar o completar",
      tone: kpis?.pendingRequisitions ? "warn" : "good",
      to: "/inventory?section=requisicion",
      icon: "📋"
    }
  ]), [kpis, curr, prev, cc.productionLate, cc.inventoryOut])

  if (cc.loading) {
    return (
      <div className="cc-loading">
        <span>Cargando centro de comando...</span>
        <div className="cc-loading__bar"><i /></div>
      </div>
    )
  }

  return (
    <div className="cc-dashboard">
      <CommandCenterHeader now={cc.now} overallStatus={cc.overallStatus} showActions />
      {cc.error && <p className="cc-error" role="alert">{cc.error}</p>}

      <CommandCenterSemaphores
        semaphores={cc.semaphores}
        productionActive={cc.productionActive}
        productionLate={cc.productionLate}
        productionAvg={cc.productionAvg}
        inventoryOut={cc.inventoryOut}
        inventoryLow={cc.inventoryLow}
        pendingRequisitions={cc.pendingRequisitions}
        hr={cc.hr}
        costs={cc.costs}
      />

      <CommandCenterInsightsRow alerts={cc.alerts} activity={cc.activity} />

      <section className="cc-section">
        <div className="cc-section__head">
          <h2>Indicadores clave</h2>
          <p>Actualizado en tiempo real desde operaciones del día.</p>
        </div>
        <div className="cc-kpi-grid">
          {kpiCards.map((card) => (
            <button
              key={card.key}
              type="button"
              className={`cc-kpi-card cc-kpi-card--${card.tone}`}
              onClick={() => navigate(card.to)}
            >
              <div className="cc-kpi-card__top">
                <span className="cc-kpi-card__icon" aria-hidden="true">{card.icon}</span>
                <span className={`cc-kpi-card__delta cc-kpi-card__delta--${card.delta.tone}`}>{card.delta.label}</span>
              </div>
              <span className="cc-kpi-card__label">{card.label}</span>
              <strong className="cc-kpi-card__value">{card.value}</strong>
              <small className="cc-kpi-card__hint">{card.hint}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="cc-section">
        <div className="cc-section__head">
          <h2>Desempeño comercial</h2>
        </div>
        <div className="cc-widgets-row">
          <div className="cc-widget-shell">
            <div className="cc-widget-shell__head">
              <h3>Meta de ventas</h3>
              <p>Progreso del mes vs objetivo comercial.</p>
            </div>
            <GoalEnergyWidget />
          </div>
          <div className="cc-widget-shell">
            <div className="cc-widget-shell__head">
              <h3>Top meseros</h3>
              <p>Ranking por ventas del mes en curso.</p>
            </div>
            <WaiterRankingWidget executive />
          </div>
        </div>
      </section>
    </div>
  )
}

function PersonalDashboard({ canAccess, navigate, notifications, pending }) {
  const showDevTools = import.meta.env.DEV

  return (
    <>
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
      {showDevTools && <SupabaseConnectionTest />}
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
    </>
  )
}

function Dashboard() {
  const { user, canAccess } = useAuth()
  const branding = useAppBranding()
  const navigate = useNavigate()
  const isExecutive = EXECUTIVE_ROLES.has(user?.role)
  const [tasks, setTasks] = useState(() => loadAssignedTasks().map(withComputedTaskStatus))
  const [notifications, setNotifications] = useState(() => loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user) && !notification.read))

  useEffect(() => {
    function refresh() {
      setTasks(loadAssignedTasks().map(withComputedTaskStatus))
      setNotifications(loadTaskNotifications().filter((notification) => notification.userId === getCurrentUserTaskId(user) && !notification.read))
    }
    window.addEventListener("task-notifications-updated", refresh)
    return () => window.removeEventListener("task-notifications-updated", refresh)
  }, [user])

  const pending = tasks.filter((task) => ["pending", "in_progress", "late"].includes(task.status) && taskMatchesUser(task, user))
  const recentCompleted = tasks.filter((task) => task.status === "completed").slice(0, 5)

  return (
    <section className={`dashboard-page ${isExecutive ? "dashboard-page--command" : ""}`}>
      {!isExecutive && (
        <header className="dashboard-page-header">
          <BrandLogo branding={branding} variant="full" />
        </header>
      )}

      {isExecutive ? (
        <ExecutiveCommandCenter recentTasks={recentCompleted} />
      ) : (
        <PersonalDashboard
          canAccess={canAccess}
          navigate={navigate}
          notifications={notifications}
          pending={pending}
        />
      )}
    </section>
  )
}

export default Dashboard
