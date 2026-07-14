import { Component, useEffect, useMemo, useState } from "react"
import { useActionGuard } from "../../hooks/useActionGuard"
import { logPerformanceEvent } from "../../utils/performanceLogger"
import { useErpPerfModule } from "../../hooks/useErpPerfModule"
import { useNavigate, useSearchParams } from "react-router-dom"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import { useAuth } from "../../context/AuthContext"
import {
  copyFixedCostsFromPreviousMonth,
  deactivateFixedCost,
  emptyFixedCostForm,
  FIXED_COST_CATEGORIES,
  FIXED_COST_FREQUENCIES,
  FIXED_COST_PAYMENT_STATUSES,
  fixedCostCategoryLabel,
  fixedCostFrequencyLabel,
  fixedCostPaymentStatusLabel,
  generateMonthlyFixedCostReviewNotifications,
  getFixedCostsByMonth,
  markFixedCostPaid,
  upsertFixedCost
} from "../../services/fixedCostsService"
import {
  getExecutiveDashboardReport,
  getInventoryReport,
  getMenuEngineeringReport,
  getPayrollCostReport,
  getPurchasesReport,
  getSalesAnalyticsReport,
  getSalesByWaiter
} from "../../services/reportsService"
import { getMonthlyGoalReport, getWaiterSalesRanking } from "../../services/salesGoalsService"
import { getYieldDashboardMetrics } from "../../services/yieldCostingService"
import YieldReportsSection from "./YieldReportsSection"
import CommandCenterLayer from "../../components/commandCenter/CommandCenterLayer"
import MigrationModeReportWarning from "../../components/inventory/MigrationModeReportWarning"
import "./ReportsDashboard.css"

const EXECUTIVE_ROLES = ["admin", "ceo", "gerente_general"]
const FIXED_COSTS_VIEW_ROLES = ["admin", "ceo", "gerente_general", "supervisor"]
const FIXED_COSTS_MANAGE_ROLES = ["admin", "ceo", "gerente_general"]
const GOAL_ROLES = ["admin", "gerente_general", "supervisor"]
const TABS = [
  ["executive", "Dashboard ejecutivo"],
  ["goals", "Metas"],
  ["sales", "Ventas"],
  ["waiters", "Ventas por colaborador"],
  ["comparison", "Comparativo meseros"],
  ["purchases", "Compras"],
  ["fixedCosts", "Costos fijos"],
  ["payroll", "Planilla"],
  ["menu", "Analisis de menu"],
  ["inventory", "Inventario critico"],
  ["yields", "Rendimientos"]
]
function canAccessReportTab(key, role) {
  if (key === "goals") return GOAL_ROLES.includes(role)
  if (key === "fixedCosts") return FIXED_COSTS_VIEW_ROLES.includes(role)
  return EXECUTIVE_ROLES.includes(role)
}

function ReportsDashboard() {
  useErpPerfModule("reportes")
  const { user } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const canManageFixedCosts = FIXED_COSTS_MANAGE_ROLES.includes(user?.role)
  const availableTabs = useMemo(
    () => TABS.filter(([key]) => canAccessReportTab(key, user?.role)),
    [user?.role]
  )
  const canView = availableTabs.length > 0
  const [tab, setTab] = useState("executive")
  const [filters, setFilters] = useState({ preset: "today", start: "", end: "", collaborator: "", shift: "", category: "", month: new Date().toISOString().slice(0, 7) })
  const [debouncedCollaborator, setDebouncedCollaborator] = useState("")
  const [debouncedCategory, setDebouncedCategory] = useState("")
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [tabReloadKey, setTabReloadKey] = useState(0)
  const [fixedCostsFeedback, setFixedCostsFeedback] = useState("")
  const { busy: exportBusy, run: runExport } = useActionGuard()

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCollaborator(filters.collaborator), 400)
    return () => window.clearTimeout(timer)
  }, [filters.collaborator])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCategory(filters.category), 400)
    return () => window.clearTimeout(timer)
  }, [filters.category])

  const queryFilters = useMemo(() => ({
    ...filters,
    collaborator: debouncedCollaborator,
    category: debouncedCategory
  }), [filters, debouncedCollaborator, debouncedCategory])

  useEffect(() => {
    const requestedTab = searchParams.get("tab")
    if (requestedTab && availableTabs.some(([key]) => key === requestedTab)) {
      setTab(requestedTab)
    }
  }, [searchParams, availableTabs])

  useEffect(() => {
    if (!canView) return
    if (!availableTabs.some(([key]) => key === tab)) {
      setTab(availableTabs[0]?.[0] || "goals")
      return
    }
    let mounted = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError("")
      console.info(`[DashboardEjecutivo:${tab}] Iniciando carga`, { filters: queryFilters })
      try {
        const result = await loadExecutiveReport(tab, queryFilters)
        if (!mounted) return
        console.info(`[DashboardEjecutivo:${tab}] Carga finalizada`, { error: result?.error || "", dataType: Array.isArray(result?.data) ? "array" : typeof result?.data })
        setData(result?.data ?? null)
        setError(result?.error || "")
      } catch (loadError) {
        if (!mounted) return
        console.error(`[DashboardEjecutivo:${tab}] Error durante la carga`, loadError)
        setData(null)
        setError(loadError?.message || "No fue posible cargar el reporte.")
      } finally {
        if (mounted) setLoading(false)
      }
    }, 0)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [availableTabs, canView, tab, queryFilters, tabReloadKey])

  const rowsToExport = useMemo(() => {
    try {
      return exportRows(tab, data)
    } catch (exportError) {
      console.error(`[DashboardEjecutivo:${tab}] Error preparando exportación`, exportError)
      return []
    }
  }, [tab, data])

  if (!canView) {
    return <section className="reports-page executive"><Empty text="No tienes permiso para ver esta seccion." /></section>
  }

  async function reloadFixedCosts(month = filters.month) {
    const result = await getFixedCostsByMonth(month)
    if (result.error) {
      setError(result.error.message || "No se pudieron cargar los costos fijos.")
      return null
    }
    setData(result.data)
    setError("")
    return result.data
  }

  function changeTab(nextTab) {
    if (nextTab === tab) return
    setData(null)
    setError("")
    setLoading(true)
    setTab(nextTab)
  }

  function retryTab() {
    setData(null)
    setError("")
    setLoading(true)
    setTabReloadKey((current) => current + 1)
  }

  async function handleExport(format) {
    await runExport(async () => {
      const started = performance.now()
      const action = format === "pdf" ? "export_pdf" : "export_excel"
      logPerformanceEvent({
        module: "reports",
        action,
        event_type: "export_start",
        status: "info",
        severity: "info",
        metadata: { format, tab }
      })
      try {
        if (format === "pdf") {
          exportPDF(rowsToExport, currentTabLabel(tab))
        } else {
          exportExcel(rowsToExport, tab)
        }
        logPerformanceEvent({
          module: "reports",
          action,
          event_type: "export_success",
          status: "ok",
          severity: "info",
          duration_ms: performance.now() - started,
          metadata: { format, tab }
        })
      } catch (error) {
        logPerformanceEvent({
          module: "reports",
          action,
          event_type: "export_error",
          status: "error",
          severity: "error",
          duration_ms: performance.now() - started,
          error_message: error?.message || "Export failed",
          message: "Export failed",
          metadata: { format, tab }
        })
        throw error
      }
    })
  }

  return (
    <section className="reports-page executive">
      <CommandCenterLayer showHeaderActions={false} layout="split" />

      <header className="reports-header hero">
        <div>
          <p className="reports-eyebrow">Direccion ejecutiva</p>
          <h1>DASHBOARD EJECUTIVO</h1>
          <p className="reports-muted">Indicadores de ventas, compras, costos, planilla, inventario y rentabilidad.</p>
        </div>
        <div className="reports-actions">
          {["admin", "gerente_general"].includes(user?.role) && <button type="button" onClick={() => navigate("/reports/goals/settings")}>Configurar metas</button>}
          <button type="button" disabled={!rowsToExport.length || exportBusy} onClick={() => handleExport("pdf")}>Exportar PDF</button>
          <button type="button" className="primary" disabled={!rowsToExport.length || exportBusy} onClick={() => handleExport("excel")}>Exportar Excel</button>
        </div>
      </header>

      <nav className="reports-segmented" aria-label="Secciones del reporte ejecutivo">
        {availableTabs.map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} type="button" onClick={() => changeTab(key)}>
            {label.replace("Dashboard ejecutivo", "Dashboard").replace("Analisis de menu", "Menú").replace("Inventario critico", "Inventario")}
          </button>
        ))}
      </nav>

      {(tab === "goals" || tab === "fixedCosts") && (
        <div className="reports-filters">
          <label>Mes<input type="month" value={filters.month} onChange={(event) => setFilters((current) => ({ ...current, month: event.target.value }))} /></label>
        </div>
      )}
      {!["executive", "fixedCosts", "goals"].includes(tab) && <GlobalFilters filters={filters} onChange={(field, value) => setFilters((current) => ({ ...current, [field]: value }))} showMonth={false} showDateRange={tab !== "goals"} showCategory={tab === "menu"} showCollaborator={["waiters", "comparison"].includes(tab)} />}
      {fixedCostsFeedback && tab === "fixedCosts" && <p className="reports-success-banner" role="status">{fixedCostsFeedback}</p>}
      <MigrationModeReportWarning tab={tab} />
      <ReportTabBoundary key={`${tab}-${tabReloadKey}`} tab={tab} onRetry={retryTab}>
        {loading
          ? <div className="reports-loading">Cargando {currentTabLabel(tab).toLowerCase()}...</div>
          : error
            ? <ReportTabError tab={tab} error={error} onRetry={retryTab} />
            : tab === "inventory"
              ? <CriticalInventory data={data} />
              : tab === "yields"
                ? <YieldReportsSection filters={filters} data={data} />
                : <ExecutiveContent
                  tab={tab}
                  data={data}
                  filters={filters}
                  canManageFixedCosts={canManageFixedCosts}
                  onFixedCostsChange={async (message) => {
                    if (message) setFixedCostsFeedback(message)
                    await reloadFixedCosts(filters.month)
                  }}
                  onConfigureGoals={() => navigate("/reports/goals/settings")}
                  canManageGoals={["admin", "gerente_general"].includes(user?.role)}
                />}
      </ReportTabBoundary>
    </section>
  )
}

async function loadExecutiveReport(tab, filters) {
  if (tab === "executive") return getExecutiveDashboardReport()
  if (tab === "goals") {
    const [report, ranking] = await Promise.all([
      getMonthlyGoalReport(filters.month),
      getWaiterSalesRanking(filters.month, false)
    ])
    return { data: { report: report.data, ranking: ranking.data || [] }, error: report.error || ranking.error }
  }
  if (tab === "sales") return getSalesAnalyticsReport(filters)
  if (tab === "waiters" || tab === "comparison") return getSalesByWaiter(filters)
  if (tab === "purchases") return getPurchasesReport(filters)
  if (tab === "fixedCosts") return getFixedCostsByMonth(filters.month)
  if (tab === "payroll") return getPayrollCostReport(filters)
  if (tab === "menu") return getMenuEngineeringReport(filters)
  if (tab === "inventory") return getInventoryReport(filters)
  if (tab === "yields") return getYieldDashboardMetrics(filters)
  return { data: null, error: "" }
}

function GlobalFilters({ filters, onChange, showCategory, showCollaborator, showMonth = false, showDateRange = true }) {
  return <div className="reports-filters">
    {showMonth && <label>Mes<input type="month" value={filters.month} onChange={(event) => onChange("month", event.target.value)} /></label>}
    {showDateRange && <label>Periodo<select value={filters.preset} onChange={(event) => onChange("preset", event.target.value)}>
      <option value="today">Hoy</option>
      <option value="week">Esta semana</option>
      <option value="month">Este mes</option>
      <option value="year">Este año</option>
      <option value="custom">Rango personalizado</option>
    </select></label>}
    {showDateRange && filters.preset === "custom" && <>
      <label>Desde<input type="date" value={filters.start} onChange={(event) => onChange("start", event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.end} onChange={(event) => onChange("end", event.target.value)} /></label>
    </>}
    {showCollaborator && <label>Colaborador<input value={filters.collaborator} onChange={(event) => onChange("collaborator", event.target.value)} placeholder="Nombre" /></label>}
    {showCollaborator && <label>Turno<select value={filters.shift} onChange={(event) => onChange("shift", event.target.value)}><option value="">Todos</option><option value="am">AM</option><option value="pm">PM</option><option value="noche">Noche</option></select></label>}
    {showCategory && <label>Categoria<input value={filters.category} onChange={(event) => onChange("category", event.target.value)} placeholder="Pizzas, bebidas..." /></label>}
  </div>
}

function ExecutiveContent(props) {
  if (props.tab === "fixedCosts") {
    return (
      <FixedCostsPanel
        report={props.data || { costs: [], summary: {} }}
        month={props.filters.month}
        canManage={props.canManageFixedCosts}
        onChange={props.onFixedCostsChange}
      />
    )
  }
  if (props.tab === "executive" && props.data) return <ExecutiveDashboard data={props.data} />
  if (props.tab === "goals" && props.data) {
    return (
      <GoalsReport
        data={props.data}
        onConfigure={props.onConfigureGoals}
        canManage={props.canManageGoals}
      />
    )
  }
  if (props.tab === "sales" && props.data) return <SalesReport data={props.data} />
  if (props.tab === "waiters" && props.data) {
    return <WaiterSales rows={filterWaiters(props.data, props.filters)} />
  }
  if (props.tab === "comparison" && props.data) {
    return <WaiterComparison rows={filterWaiters(props.data, props.filters)} />
  }
  if (props.tab === "purchases" && props.data) return <PurchasesReport data={props.data} />
  if (props.tab === "payroll" && props.data) return <PayrollReport data={props.data} />
  if (props.tab === "menu" && props.data) {
    return <MenuReport rows={filterMenuRows(props.data, props.filters)} />
  }
  if (!props.data) return <Empty />
  return <Empty />
}

function ExecutiveDashboard({ data }) {
  const c = data.current || {}
  const p = data.previous || {}
  const cards = [
    ["Ventas del dia", c.day?.total, p.day?.total, "Ventas ayer"],
    ["Ventas de la semana", c.week?.total, p.week?.total, "Semana anterior"],
    ["Ventas del mes", c.month?.total, p.month?.total, "Mes anterior"],
    ["Ventas acumuladas del año", c.year?.total, p.year?.total, "Periodo anterior"],
    ["Ticket promedio del dia", c.day?.averageTicket, p.day?.averageTicket, "Ticket anterior"],
    ["Ticket promedio del mes", c.month?.averageTicket, p.month?.averageTicket, "Mes anterior"],
    ["Total de ordenes del dia", c.day?.orders, p.day?.orders, "Ordenes ayer", "number"],
    ["Total de ordenes del mes", c.month?.orders, p.month?.orders, "Mes anterior", "number"]
  ]
  return <div className="reports-stack">
    <div className="executive-kpi-grid">{cards.map(([title, value, previous, previousLabel, type]) => <ExecutiveKPI key={title} title={title} value={value} previous={previous} previousLabel={previousLabel} type={type} />)}</div>
  </div>
}

function ExecutiveKPI({ title, value, previous, previousLabel, type = "money" }) {
  const diff = percentChange(value, previous)
  const positive = diff >= 0
  return <article className={`executive-kpi ${positive ? "up" : "down"}`}>
    <span>{title}</span>
    <strong>{type === "money" ? money(value) : Number(value || 0)}</strong>
    <small>{previousLabel}: {type === "money" ? money(previous) : Number(previous || 0)}</small>
    <em>{positive ? "+" : ""}{diff.toFixed(1)}%</em>
  </article>
}

function SalesReport({ data }) {
  const summary = data.summary || {}
  return <div className="reports-stack">
    <div className="reports-kpis">
      <KPI title="Ventas totales" value={money(summary.totalSales)} />
      <KPI title="Ordenes" value={summary.orders || 0} />
      <KPI title="Ticket promedio" value={money(summary.averageTicket)} />
      <KPI title="Hora mayor venta" value={summary.bestHour || "-"} />
      <KPI title="Dia mayor venta" value={summary.bestDay || "-"} />
    </div>
    <div className="reports-grid">
      <Panel title="Ventas por dia"><BarChart rows={data.byDay || []} labelKey="date" valueKey="sales" /></Panel>
      <Panel title="Ventas por semana"><BarChart rows={data.byWeek || []} labelKey="week" valueKey="sales" /></Panel>
      <Panel title="Ventas por mes"><BarChart rows={data.byMonth || []} labelKey="month" valueKey="sales" /></Panel>
      <Panel title="Detalle por dia"><DataTable headers={["Periodo", "Ordenes", "Ventas", "Ticket promedio"]} rows={(data.byDay || []).map((row) => [row.date, row.orders, money(row.sales), money(row.averageTicket)])} /></Panel>
    </div>
  </div>
}

function GoalsReport({ data, onConfigure, canManage }) {
  const report = data.report || {}
  const ranking = safeRows(data.ranking)
  const progress = finiteNumber(report.progress_percent)
  const remaining = finiteNumber(report.remaining_amount)
  const target = finiteNumber(report.target_amount)
  return <div className="reports-stack">
    <div className="reports-kpis">
      <KPI title="Meta mensual" value={money(target)} tone={target > 0 ? "good" : "warning"} />
      <KPI title="Ventas acumuladas" value={money(report.actual_sales)} />
      <KPI title="Avance" value={`${progress.toFixed(1)}%`} tone={progress >= 100 ? "good" : progress >= 70 ? "" : "warning"} />
      <KPI title="Faltante" value={money(remaining)} tone={remaining <= 0 ? "good" : ""} />
      <KPI title="Ordenes pagadas" value={report.order_count || 0} />
      <KPI title="Ticket promedio" value={money(report.average_ticket)} />
    </div>
    <div className="reports-grid">
      <Panel title="Progreso mensual">
        <div className="goal-report-progress">
          <div><i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} /></div>
          <strong>{report.status_label || "Meta mensual"}</strong>
          <span>{Number(report.days_remaining || 0)} dias restantes</span>
        </div>
        {canManage && <button type="button" className="report-inline-action" onClick={onConfigure}>Configurar meta</button>}
      </Panel>
      <Panel title="Ranking de colaboradores">
        <DataTable
          headers={["#", "Colaborador", "Ventas", "Ordenes", "Ticket promedio", "Peso"]}
          rows={ranking.map((row) => [
            row.rank_position,
            row.display_name || row.full_name || "Colaborador",
            money(row.total_sales),
            row.order_count,
            money(row.average_ticket),
            `${finiteNumber(row.relative_percent).toFixed(1)}%`
          ])}
        />
      </Panel>
    </div>
  </div>
}

function WaiterSales({ rows }) {
  const filtered = safeRows(rows)
  return <Panel title="Ventas por colaborador"><DataTable headers={["Ranking", "Nombre", "Ventas generadas", "Ordenes", "Ticket promedio"]} rows={filtered.map((row, index) => [`#${index + 1}`, row.waiter, money(row.sales), row.orders, money(row.averageTicket)])} /></Panel>
}

function WaiterComparison({ rows }) {
  const safe = safeRows(rows)
  return <div className="reports-grid">
    <Panel title="Ventas"><BarChart rows={safe} labelKey="waiter" valueKey="sales" /></Panel>
    <Panel title="Ticket promedio"><BarChart rows={safe} labelKey="waiter" valueKey="averageTicket" /></Panel>
    <Panel title="Ordenes atendidas"><BarChart rows={safe} labelKey="waiter" valueKey="orders" /></Panel>
  </div>
}

function PurchasesReport({ data }) {
  const s = data.summary || {}
  return <div className="reports-stack">
    <div className="reports-kpis">
      <KPI title="Compras del dia" value={money(s.dayTotal)} />
      <KPI title="Compras del mes" value={money(s.monthTotal)} />
      <KPI title="Compras del año" value={money(s.yearTotal)} />
    </div>
    <div className="reports-grid">
      <Panel title="Compras por proveedor"><DataTable headers={["Proveedor", "Monto", "% total"]} rows={safeRows(data.bySupplier).map((row) => [row.name, money(row.amount), `${finiteNumber(row.percent).toFixed(1)}%`])} /></Panel>
      <Panel title="Compras por categoria"><PieList rows={safeRows(data.byCategory)} /></Panel>
    </div>
  </div>
}

function FixedCostsPanel({ report, month, canManage, onChange }) {
  const costs = safeRows(report?.costs)
  const summary = report?.summary || {}
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(() => emptyFixedCostForm(month))
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)

  function openCreateForm() {
    setForm(emptyFixedCostForm(month))
    setFormError("")
    setFormOpen(true)
  }

  function openEditForm(row) {
    setForm({
      id: row.id,
      name: row.name || "",
      category: row.category || "renta",
      amount: row.amount ?? "",
      frequency: row.frequency || "monthly",
      cost_month: row.cost_month || emptyFixedCostForm(month).cost_month,
      due_day: row.due_day ?? "",
      payment_status: row.payment_status || "pending",
      notes: row.notes || "",
      is_active: row.is_active !== false
    })
    setFormError("")
    setFormOpen(true)
  }

  async function runAction(action, successMessage) {
    setBusy(true)
    setFormError("")
    try {
      const result = await action()
      if (result.error) {
        setFormError(result.error.message || "No se pudo completar la accion.")
        return
      }
      setFormOpen(false)
      await onChange?.(successMessage)
    } finally {
      setBusy(false)
    }
  }

  async function submitForm(event) {
    event.preventDefault()
    if (!form.name.trim()) {
      setFormError("Falta el campo obligatorio: Nombre del costo.")
      return
    }
    if (Number(form.amount) < 0 || form.amount === "") {
      setFormError("Indica un monto valido mayor o igual a 0.")
      return
    }
    await runAction(
      () => upsertFixedCost(form),
      form.id ? "Costo fijo actualizado correctamente." : "Costo fijo registrado correctamente."
    )
  }

  const comparison = finiteNumber(summary.comparison_percent)
  const comparisonTone = comparison > 0 ? "warning" : comparison < 0 ? "good" : ""

  return (
    <div className="reports-stack fixed-costs-panel">
      <div className="reports-kpis">
        <KPI title="Total costos fijos" value={money(summary.total)} />
        <KPI title="Pendientes de pago" value={money(summary.pending_total)} tone="warning" />
        <KPI title="Pagados" value={money(summary.paid_total)} tone="good" />
        <KPI title="Vencidos" value={money(summary.overdue_total)} tone={summary.overdue_total > 0 ? "danger" : ""} />
        <KPI title="Mes anterior" value={money(summary.previous_month_total)} />
        <KPI title="Variacion vs mes anterior" value={`${comparison >= 0 ? "+" : ""}${comparison.toFixed(1)}%`} tone={comparisonTone} />
      </div>

      {canManage && (
        <div className="fixed-cost-toolbar">
          <button type="button" className="primary" onClick={openCreateForm}>Agregar costo fijo</button>
          <button type="button" disabled={busy} onClick={() => runAction(() => copyFixedCostsFromPreviousMonth(month), "Costos copiados del mes anterior.")}>Copiar costos del mes anterior</button>
          <button type="button" disabled={busy} onClick={() => runAction(() => generateMonthlyFixedCostReviewNotifications(month), "Notificaciones de revision generadas.")}>Generar recordatorio mensual</button>
        </div>
      )}

      {!canManage && <p className="reports-muted fixed-cost-readonly-note">Vista de solo lectura. Solo Admin y Gerente General pueden modificar costos fijos.</p>}

      {formError && !formOpen && <p className="reports-warning" role="alert">{formError}</p>}

      {!costs.length ? (
        <div className="reports-empty fixed-cost-empty">
          <span>No hay costos fijos registrados para este mes.</span>
          {canManage && (
            <div className="fixed-cost-empty-actions">
              <button type="button" className="primary" onClick={openCreateForm}>Agregar costo fijo</button>
              <button type="button" disabled={busy} onClick={() => runAction(() => copyFixedCostsFromPreviousMonth(month), "Costos copiados del mes anterior.")}>Copiar costos del mes anterior</button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="reports-grid">
            <Panel title="Costos por categoria">
              <DataTable
                headers={["Categoria", "Monto", "% del total"]}
                rows={safeRows(summary.by_category).map((row) => [
                  fixedCostCategoryLabel(row.category),
                  money(row.amount),
                  `${finiteNumber(row.percent).toFixed(1)}%`
                ])}
              />
            </Panel>
            <Panel title="Base para estado de resultados">
              <div className="fixed-cost-pnl-hint">
                <p>Estos totales quedan listos para calcular utilidad estimada:</p>
                <strong>Ventas netas - Costo de ventas - Planilla - Costos fijos</strong>
                <span>Total costos fijos del mes: {money(summary.total)}</span>
              </div>
            </Panel>
          </div>
          <Panel title="Detalle de costos fijos">
            <DataTable
              headers={["Nombre", "Categoria", "Monto", "Frecuencia", "Dia pago", "Estado", "Notas", ...(canManage ? ["Acciones"] : [])]}
              rows={costs.map((row) => [
                row.name,
                fixedCostCategoryLabel(row.category),
                money(row.amount),
                fixedCostFrequencyLabel(row.frequency),
                row.due_day || "-",
                <PaymentStatusBadge key={`${row.id}-status`} status={row.payment_status} />,
                row.notes || "-",
                ...(canManage ? [
                  <div className="fixed-cost-row-actions" key={`${row.id}-actions`}>
                    <button type="button" onClick={() => openEditForm(row)}>Editar</button>
                    {row.payment_status !== "paid" && (
                      <button type="button" disabled={busy} onClick={() => runAction(() => markFixedCostPaid(row), "Costo marcado como pagado.")}>Marcar pagado</button>
                    )}
                    <button type="button" disabled={busy} onClick={() => runAction(() => deactivateFixedCost(row.id), "Costo fijo desactivado.")}>Desactivar</button>
                  </div>
                ] : [])
              ])}
            />
          </Panel>
        </>
      )}

      {formOpen && (
        <div className="fixed-cost-modal-backdrop" role="presentation" onClick={() => !busy && setFormOpen(false)}>
          <form className="fixed-cost-modal" onSubmit={submitForm} onClick={(event) => event.stopPropagation()}>
            <div className="fixed-cost-modal-header">
              <h2>{form.id ? "Editar costo fijo" : "Agregar costo fijo"}</h2>
              <button type="button" onClick={() => setFormOpen(false)} disabled={busy}>Cerrar</button>
            </div>
            {formError && <p className="reports-warning" role="alert">{formError}</p>}
            <div className="fixed-cost-form-grid">
              <label>Nombre del costo<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Renta local principal" /></label>
              <label>Categoria<select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{FIXED_COST_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Monto<input type="number" min="0" step="0.01" required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
              <label>Frecuencia<select value={form.frequency} onChange={(event) => setForm({ ...form, frequency: event.target.value })}>{FIXED_COST_FREQUENCIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Mes<input type="month" value={form.cost_month.slice(0, 7)} onChange={(event) => setForm({ ...form, cost_month: `${event.target.value}-01` })} /></label>
              <label>Dia de pago<input type="number" min="1" max="31" value={form.due_day} onChange={(event) => setForm({ ...form, due_day: event.target.value })} placeholder="Opcional" /></label>
              <label>Estado<select value={form.payment_status} onChange={(event) => setForm({ ...form, payment_status: event.target.value })}>{FIXED_COST_PAYMENT_STATUSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="wide">Notas<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} rows={3} /></label>
            </div>
            <div className="fixed-cost-modal-actions">
              <button type="button" className="ghost" onClick={() => setFormOpen(false)} disabled={busy}>Cancelar</button>
              <button type="submit" className="primary" disabled={busy}>{busy ? "Guardando..." : form.id ? "Guardar cambios" : "Guardar costo"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function PaymentStatusBadge({ status }) {
  const tone = status === "paid" ? "completed" : status === "overdue" ? "critical" : status === "cancelled" ? "rejected" : "pending"
  return <span className={`reports-badge ${tone}`}>{fixedCostPaymentStatusLabel(status)}</span>
}

function PayrollReport({ data }) {
  const s = data.summary || {}
  return <div className="reports-stack">
    <div className="reports-kpis"><KPI title="Planilla mensual" value={money(s.monthly)} /><KPI title="Planilla anual" value={money(s.annual)} /></div>
    <div className="reports-grid">
      <Panel title="Costo por departamento"><PieList rows={data.byDepartment || []} /></Panel>
      <Panel title="Detalle planilla"><DataTable headers={["Colaborador", "Departamento", "Monto"]} rows={(data.rows || []).map((row) => [row.employee, row.department, money(row.amount)])} /></Panel>
    </div>
  </div>
}

function MenuReport({ rows }) {
  const labels = { star: "ESTRELLA", cow: "VACA", horse: "VACA", puzzle: "ROMPECABEZAS", dog: "PERRO" }
  return <Panel title="Analisis de menu"><DataTable headers={["Producto", "Categoria", "Unidades", "Ventas", "Costo", "Utilidad", "Clasificacion"]} rows={safeRows(rows).map((row) => [row.product, row.category, row.quantity, money(row.revenue ?? row.sales), money(Number(row.cost || 0) * Number(row.quantity || 0)), money(row.profit ?? row.estimatedProfit), labels[row.classification] || row.classification])} /></Panel>
}

class ReportTabBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[DashboardEjecutivo:${this.props.tab}] Error de renderizado capturado`, error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="reports-inventory-error" role="alert">
          <strong>No se pudo mostrar {currentTabLabel(this.props.tab)}.</strong>
          <span>{this.state.error.message || "Ocurrió un error inesperado al renderizar los datos."}</span>
          <button type="button" onClick={this.props.onRetry}>Reintentar</button>
        </div>
      )
    }
    return this.props.children
  }
}

function ReportTabError({ tab, error, onRetry }) {
  console.error(`[DashboardEjecutivo:${tab}] Consulta fallida`, error)
  return (
    <div className="reports-inventory-error" role="alert">
      <strong>No se pudo cargar {currentTabLabel(tab)}.</strong>
      <span>{error || "La consulta no devolvió datos válidos."}</span>
      <button type="button" onClick={onRetry}>Reintentar</button>
    </div>
  )
}

function CriticalInventory({ data }) {
  const out = Array.isArray(data?.out) ? data.out.filter((row) => row && typeof row === "object") : []
  const low = Array.isArray(data?.low) ? data.low.filter((row) => row && typeof row === "object") : []
  const rows = [...out, ...low]
  console.info("[InventarioCritico] Render", { hasData: Boolean(data), out: out.length, low: low.length })

  if (!rows.length) {
    return <Panel title="Inventario critico"><Empty text="No hay productos críticos actualmente" /></Panel>
  }

  return <Panel title="Inventario critico"><DataTable headers={["Producto", "Area", "Stock actual", "Stock minimo", "Estado"]} rows={rows.map((row, index) => [row.item?.name || "Producto sin nombre", row.area?.name || row.area_id || "Sin área", `${numberText(row.quantity)} ${row.item?.base_unit || ""}`, numberText(row.minimum_quantity), <StockState key={`${row.item_id || index}-${row.area_id || "area"}`} row={row} />])} /></Panel>
}

function BarChart({ rows, labelKey, valueKey }) {
  const safe = safeRows(rows)
  if (!safe.length) return <Empty />
  const max = Math.max(...safe.map((row) => finiteNumber(row[valueKey])), 1)
  return <div className="bar-chart">{safe.slice(0, 12).map((row, index) => <div className="bar-row" key={row[labelKey] || index}><span>{row[labelKey] || "-"}</span><div><i style={{ width: `${(finiteNumber(row[valueKey]) / max) * 100}%` }} /></div><strong>{valueKey === "orders" ? finiteNumber(row[valueKey]) : money(row[valueKey])}</strong></div>)}</div>
}

function PieList({ rows }) {
  const safe = safeRows(rows)
  if (!safe.length) return <Empty />
  return <div className="pie-list">
    <div className="pie-visual" style={{ background: pieGradient(safe) }} />
    <DataTable headers={["Categoria", "Monto", "%"]} rows={safe.map((row) => [row.name, money(row.amount), `${finiteNumber(row.percent).toFixed(1)}%`])} />
  </div>
}

function DataTable({ headers, rows, emptyText = "No existen datos suficientes para este período." }) {
  const safe = safeRows(rows).filter(Array.isArray)
  if (!safe.length) return <Empty text={emptyText} />
  return <div className="reports-table-scroll"><table className="reports-table"><thead><tr>{safeList(headers).map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{safe.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? "-"}</td>)}</tr>)}</tbody></table></div>
}

function KPI({ title, value, tone = "" }) { return <article className={`report-kpi ${tone}`}><span>{title}</span><strong>{value}</strong></article> }
function Panel({ title, children }) { return <article className="report-panel"><h2>{title}</h2>{children}</article> }
function Empty({ text = "No existen datos suficientes para este período." }) {
  return (
    <div className="reports-empty reports-empty--illustrated">
      <div className="reports-empty__icon" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="8" y="12" width="48" height="40" rx="6" stroke="currentColor" strokeWidth="2" opacity=".5" />
          <path d="M16 40 L26 28 L34 36 L42 24 L48 32" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="22" cy="22" r="3" fill="currentColor" opacity=".6" />
        </svg>
      </div>
      <span>{text}</span>
    </div>
  )
}
function StockState({ row }) {
  const quantity = Number(row.quantity || 0)
  const minimum = Number(row.minimum_quantity || 0)
  const state = quantity <= 0 ? "red" : quantity <= minimum ? "yellow" : "green"
  const label = state === "red" ? "Sin stock" : state === "yellow" ? "Bajo stock" : "OK"
  return <span className={`stock-state ${state}`}>{label}</span>
}

function exportRows(tab, data) {
  if (!data) return []
  if (tab === "executive") {
    const c = data.current || {}
    return [
      { Indicador: "Ventas dia", Valor: c.day?.total || 0 },
      { Indicador: "Ventas semana", Valor: c.week?.total || 0 },
      { Indicador: "Ventas mes", Valor: c.month?.total || 0 },
      { Indicador: "Ventas año", Valor: c.year?.total || 0 },
      { Indicador: "Ordenes dia", Valor: c.day?.orders || 0 },
      { Indicador: "Ordenes mes", Valor: c.month?.orders || 0 }
    ]
  }
  if (tab === "sales") return safeRows(data.byDay).map((row) => ({ Periodo: row.date, Ordenes: row.orders, Ventas: row.sales, TicketPromedio: row.averageTicket }))
  if (tab === "goals") {
    const report = data.report || {}
    const ranking = safeRows(data.ranking)
    return [
      { Tipo: "Resumen", Indicador: "Meta mensual", Valor: report.target_amount || 0 },
      { Tipo: "Resumen", Indicador: "Ventas acumuladas", Valor: report.actual_sales || 0 },
      { Tipo: "Resumen", Indicador: "Avance", Valor: report.progress_percent || 0 },
      { Tipo: "Resumen", Indicador: "Faltante", Valor: report.remaining_amount || 0 },
      ...ranking.map((row) => ({
        Tipo: "Ranking",
        Ranking: row.rank_position,
        Colaborador: row.display_name || row.full_name,
        Ventas: row.total_sales,
        Ordenes: row.order_count,
        TicketPromedio: row.average_ticket
      }))
    ]
  }
  if (tab === "waiters" || tab === "comparison") return safeRows(data).map((row, index) => ({ Ranking: index + 1, Colaborador: row.waiter, Ventas: row.sales, Ordenes: row.orders, TicketPromedio: row.averageTicket }))
  if (tab === "purchases") return safeRows(data.rows).map((row) => ({ Orden: row.orderNumber, Proveedor: row.supplier, Estado: row.status, Total: row.total, Fecha: row.created_at }))
  if (tab === "fixedCosts") {
    const costs = safeRows(data?.costs)
    return costs.map((row) => ({
      Nombre: row.name,
      Categoria: fixedCostCategoryLabel(row.category),
      Monto: row.amount,
      Frecuencia: fixedCostFrequencyLabel(row.frequency),
      DiaPago: row.due_day || "",
      Estado: fixedCostPaymentStatusLabel(row.payment_status),
      Notas: row.notes || ""
    }))
  }
  if (tab === "payroll") return safeRows(data.rows).map((row) => ({ Colaborador: row.employee, Departamento: row.department, Monto: row.amount }))
  if (tab === "menu") return safeRows(data).map((row) => ({ Producto: row.product, Categoria: row.category, Unidades: row.quantity, Ventas: row.revenue ?? row.sales, Utilidad: row.profit ?? row.estimatedProfit, Clasificacion: row.classification }))
  if (tab === "inventory") return [...safeRows(data.out), ...safeRows(data.low)].map((row) => ({ Producto: row.item?.name, Area: row.area?.name || row.area_id, StockActual: row.quantity, StockMinimo: row.minimum_quantity }))
  if (tab === "yields") {
    return [
      ...(data?.topLossItems || []).map((row) => ({
        Tipo: "Producto",
        Nombre: row.itemName,
        Auditorias: row.audits,
        Promedio: row.avgYield,
        ImpactoQ: row.financialLoss
      })),
      ...(data?.employeeScorecard || []).map((row) => ({
        Tipo: "Colaborador",
        Nombre: row.employeeName,
        Auditorias: row.audits,
        Promedio: row.avgYield,
        Desviacion: row.avgVariance,
        Puntaje: row.score
      }))
    ]
  }
  return []
}

function filterWaiters(rows, filters = {}) {
  const term = String(filters.collaborator || "").trim().toLowerCase()
  const safe = safeRows(rows)
  return term ? safe.filter((row) => String(row.waiter || "").toLowerCase().includes(term)) : safe
}

function filterMenuRows(rows, filters = {}) {
  const term = String(filters.category || "").trim().toLowerCase()
  const safe = safeRows(rows)
  return term ? safe.filter((row) => String(row.category || "").toLowerCase().includes(term)) : safe
}

function safeList(value) {
  return Array.isArray(value) ? value.filter((entry) => entry != null) : []
}

function safeRows(value) {
  return safeList(value).filter((entry) => typeof entry === "object")
}

function finiteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function exportExcel(rows, tab) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Reporte")
  XLSX.writeFile(workbook, `reporte-ejecutivo-${tab}.xlsx`)
}

function exportPDF(rows, title) {
  const doc = new jsPDF()
  doc.text(title, 14, 18)
  autoTable(doc, { startY: 26, head: [Object.keys(rows[0] || {})], body: rows.map((row) => Object.values(row)) })
  doc.save(`${title.toLowerCase().replace(/\s+/g, "-")}.pdf`)
}

function currentTabLabel(tab) {
  return TABS.find(([key]) => key === tab)?.[1] || "Reporte"
}

function percentChange(current, previous) {
  if (!previous && !current) return 0
  if (!previous) return current > 0 ? 100 : 0
  return ((Number(current || 0) - Number(previous || 0)) / Number(previous || 1)) * 100
}

function pieGradient(rows) {
  const colors = ["#14b8a6", "#f59e0b", "#ef4444", "#38bdf8", "#a78bfa", "#22c55e", "#f97316"]
  let cursor = 0
  const stops = rows.map((row, index) => {
    const start = cursor
    cursor += row.percent
    return `${colors[index % colors.length]} ${start}% ${cursor}%`
  })
  return `conic-gradient(${stops.join(", ")})`
}

function money(value) { return `Q${Number(value || 0).toFixed(2)}` }
function numberText(value) { return Number(value || 0).toFixed(2) }

export default ReportsDashboard
