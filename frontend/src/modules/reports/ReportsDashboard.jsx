import { useEffect, useMemo, useState } from "react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import * as XLSX from "xlsx"
import { useAuth } from "../../context/AuthContext"
import {
  getExecutiveDashboardReport,
  getFixedCosts,
  getInventoryReport,
  getMenuEngineeringReport,
  getPayrollCostReport,
  getPurchasesReport,
  getSalesAnalyticsReport,
  getSalesByWaiter,
  saveFixedCost
} from "../../services/reportsService"
import "./ReportsDashboard.css"

const EXECUTIVE_ROLES = ["admin", "ceo", "gerente_general"]
const TABS = [
  ["executive", "Dashboard ejecutivo"],
  ["sales", "Ventas"],
  ["waiters", "Ventas por colaborador"],
  ["comparison", "Comparativo meseros"],
  ["purchases", "Compras"],
  ["fixedCosts", "Costos fijos"],
  ["payroll", "Planilla"],
  ["menu", "Analisis de menu"],
  ["inventory", "Inventario critico"]
]
const FIXED_CATEGORIES = [
  ["alquiler", "Alquiler"],
  ["energia_electrica", "Energia electrica"],
  ["agua", "Agua"],
  ["internet", "Internet"],
  ["telefonia", "Telefonia"],
  ["seguridad", "Seguridad"],
  ["software", "Software"],
  ["mantenimiento", "Mantenimiento"],
  ["otros", "Otros"]
]

const EMPTY_FIXED_COST = { name: "", category: "alquiler", monthly_amount: "", start_date: "", active: true }

function ReportsDashboard() {
  const { user } = useAuth()
  const canView = EXECUTIVE_ROLES.includes(user?.role)
  const [tab, setTab] = useState("executive")
  const [filters, setFilters] = useState({ preset: "today", start: "", end: "", collaborator: "", shift: "", category: "" })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [fixedForm, setFixedForm] = useState(EMPTY_FIXED_COST)

  useEffect(() => {
    if (!canView) return
    let mounted = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError("")
      const result = await loadExecutiveReport(tab, filters)
      if (!mounted) return
      setData(result.data)
      setError(result.error || "")
      setLoading(false)
    }, 0)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [canView, tab, filters])

  const rowsToExport = useMemo(() => exportRows(tab, data), [tab, data])

  if (!canView) {
    return <section className="reports-page executive"><Empty text="No tienes permiso para ver esta seccion." /></section>
  }

  async function submitFixedCost(event) {
    event.preventDefault()
    if (!fixedForm.name.trim() || Number(fixedForm.monthly_amount) < 0) return
    const result = await saveFixedCost(fixedForm)
    if (result.error) {
      setError(result.error.message)
      return
    }
    setFixedForm(EMPTY_FIXED_COST)
    const refreshed = await getFixedCosts()
    setData(refreshed.data)
  }

  return (
    <section className="reports-page executive">
      <header className="reports-header hero">
        <div>
          <p className="reports-eyebrow">Direccion ejecutiva</p>
          <h1>DASHBOARD EJECUTIVO</h1>
          <p className="reports-muted">Indicadores de ventas, compras, costos, planilla, inventario y rentabilidad.</p>
        </div>
        <div className="reports-actions">
          <button type="button" disabled={!rowsToExport.length} onClick={() => exportPDF(rowsToExport, currentTabLabel(tab))}>Exportar PDF</button>
          <button type="button" className="primary" disabled={!rowsToExport.length} onClick={() => exportExcel(rowsToExport, tab)}>Exportar Excel</button>
        </div>
      </header>

      <nav className="reports-tabs executive-tabs">
        {TABS.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} type="button" onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {!["executive", "fixedCosts"].includes(tab) && <GlobalFilters filters={filters} onChange={(field, value) => setFilters((current) => ({ ...current, [field]: value }))} showCategory={tab === "menu"} showCollaborator={["waiters", "comparison"].includes(tab)} />}
      {error && <div className="reports-warning">Consulta parcial: {error}. Se muestran los datos disponibles.</div>}
      {loading ? <div className="reports-loading">Cargando indicadores ejecutivos...</div> : <ExecutiveContent tab={tab} data={data} filters={filters} fixedForm={fixedForm} setFixedForm={setFixedForm} submitFixedCost={submitFixedCost} />}
    </section>
  )
}

async function loadExecutiveReport(tab, filters) {
  if (tab === "executive") return getExecutiveDashboardReport()
  if (tab === "sales") return getSalesAnalyticsReport(filters)
  if (tab === "waiters" || tab === "comparison") return getSalesByWaiter(filters)
  if (tab === "purchases") return getPurchasesReport(filters)
  if (tab === "fixedCosts") return getFixedCosts()
  if (tab === "payroll") return getPayrollCostReport(filters)
  if (tab === "menu") return getMenuEngineeringReport(filters)
  if (tab === "inventory") return getInventoryReport(filters)
  return { data: null, error: "" }
}

function GlobalFilters({ filters, onChange, showCategory, showCollaborator }) {
  return <div className="reports-filters">
    <label>Periodo<select value={filters.preset} onChange={(event) => onChange("preset", event.target.value)}>
      <option value="today">Hoy</option>
      <option value="week">Esta semana</option>
      <option value="month">Este mes</option>
      <option value="year">Este año</option>
      <option value="custom">Rango personalizado</option>
    </select></label>
    {filters.preset === "custom" && <>
      <label>Desde<input type="date" value={filters.start} onChange={(event) => onChange("start", event.target.value)} /></label>
      <label>Hasta<input type="date" value={filters.end} onChange={(event) => onChange("end", event.target.value)} /></label>
    </>}
    {showCollaborator && <label>Colaborador<input value={filters.collaborator} onChange={(event) => onChange("collaborator", event.target.value)} placeholder="Nombre" /></label>}
    {showCollaborator && <label>Turno<select value={filters.shift} onChange={(event) => onChange("shift", event.target.value)}><option value="">Todos</option><option value="am">AM</option><option value="pm">PM</option><option value="noche">Noche</option></select></label>}
    {showCategory && <label>Categoria<input value={filters.category} onChange={(event) => onChange("category", event.target.value)} placeholder="Pizzas, bebidas..." /></label>}
  </div>
}

function ExecutiveContent(props) {
  if (!props.data) return <Empty />
  if (props.tab === "executive") return <ExecutiveDashboard data={props.data} />
  if (props.tab === "sales") return <SalesReport data={props.data} />
  if (props.tab === "waiters") return <WaiterSales rows={filterWaiters(props.data, props.filters)} />
  if (props.tab === "comparison") return <WaiterComparison rows={filterWaiters(props.data, props.filters)} />
  if (props.tab === "purchases") return <PurchasesReport data={props.data} />
  if (props.tab === "fixedCosts") return <FixedCosts rows={props.data} form={props.fixedForm} setForm={props.setFixedForm} onSubmit={props.submitFixedCost} />
  if (props.tab === "payroll") return <PayrollReport data={props.data} />
  if (props.tab === "menu") return <MenuReport rows={filterMenuRows(props.data, props.filters)} />
  return <CriticalInventory data={props.data} />
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

function WaiterSales({ rows }) {
  const filtered = rows || []
  return <Panel title="Ventas por colaborador"><DataTable headers={["Ranking", "Nombre", "Ventas generadas", "Ordenes", "Ticket promedio"]} rows={filtered.map((row, index) => [`#${index + 1}`, row.waiter, money(row.sales), row.orders, money(row.averageTicket)])} /></Panel>
}

function WaiterComparison({ rows }) {
  return <div className="reports-grid">
    <Panel title="Ventas"><BarChart rows={rows || []} labelKey="waiter" valueKey="sales" /></Panel>
    <Panel title="Ticket promedio"><BarChart rows={rows || []} labelKey="waiter" valueKey="averageTicket" /></Panel>
    <Panel title="Ordenes atendidas"><BarChart rows={rows || []} labelKey="waiter" valueKey="orders" /></Panel>
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
      <Panel title="Compras por proveedor"><DataTable headers={["Proveedor", "Monto", "% total"]} rows={(data.bySupplier || []).map((row) => [row.name, money(row.amount), `${row.percent.toFixed(1)}%`])} /></Panel>
      <Panel title="Compras por categoria"><PieList rows={data.byCategory || []} /></Panel>
    </div>
  </div>
}

function FixedCosts({ rows, form, setForm, onSubmit }) {
  const activeRows = (rows || []).filter((row) => row.active)
  const total = activeRows.reduce((sum, row) => sum + Number(row.monthly_amount || 0), 0)
  return <div className="reports-stack">
    <div className="reports-kpis"><KPI title="Costo fijo mensual total" value={money(total)} /><KPI title="Costo fijo anual proyectado" value={money(total * 12)} /></div>
    <form className="fixed-cost-form" onSubmit={onSubmit}>
      <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Nombre del costo" />
      <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{FIXED_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <input type="number" min="0" step="0.01" value={form.monthly_amount} onChange={(event) => setForm({ ...form, monthly_amount: event.target.value })} placeholder="Monto mensual" />
      <input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
      <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Activo</label>
      <button className="primary" type="submit">Guardar costo</button>
    </form>
    <Panel title="Costos fijos registrados"><DataTable headers={["Nombre", "Categoria", "Monto mensual", "Inicio", "Estado"]} rows={(rows || []).map((row) => [row.name, fixedCategoryLabel(row.category), money(row.monthly_amount), row.start_date || "-", row.active ? "Activo" : "Inactivo"])} /></Panel>
  </div>
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
  return <Panel title="Analisis de menu"><DataTable headers={["Producto", "Categoria", "Unidades", "Ventas", "Costo", "Utilidad", "Clasificacion"]} rows={(rows || []).map((row) => [row.product, row.category, row.quantity, money(row.revenue ?? row.sales), money(row.cost * row.quantity), money(row.profit ?? row.estimatedProfit), labels[row.classification] || row.classification])} /></Panel>
}

function CriticalInventory({ data }) {
  const rows = [...(data.out || []), ...(data.low || [])]
  return <Panel title="Inventario critico"><DataTable headers={["Producto", "Area", "Stock actual", "Stock minimo", "Estado"]} rows={rows.map((row) => [row.item?.name || "-", row.area?.name || row.area_id, `${numberText(row.quantity)} ${row.item?.base_unit || ""}`, numberText(row.minimum_quantity), <StockState key={`${row.item_id}-${row.area_id}`} row={row} />])} /></Panel>
}

function BarChart({ rows, labelKey, valueKey }) {
  if (!rows.length) return <Empty />
  const max = Math.max(...rows.map((row) => Number(row[valueKey] || 0)), 1)
  return <div className="bar-chart">{rows.slice(0, 12).map((row) => <div className="bar-row" key={row[labelKey]}><span>{row[labelKey]}</span><div><i style={{ width: `${(Number(row[valueKey] || 0) / max) * 100}%` }} /></div><strong>{valueKey === "orders" ? Number(row[valueKey] || 0) : money(row[valueKey])}</strong></div>)}</div>
}

function PieList({ rows }) {
  if (!rows.length) return <Empty />
  return <div className="pie-list">
    <div className="pie-visual" style={{ background: pieGradient(rows) }} />
    <DataTable headers={["Categoria", "Monto", "%"]} rows={rows.map((row) => [row.name, money(row.amount), `${row.percent.toFixed(1)}%`])} />
  </div>
}

function DataTable({ headers, rows, emptyText = "Sin datos suficientes todavia." }) {
  if (!rows.length) return <Empty text={emptyText} />
  return <div className="reports-table-scroll"><table className="reports-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}

function KPI({ title, value, tone = "" }) { return <article className={`report-kpi ${tone}`}><span>{title}</span><strong>{value}</strong></article> }
function Panel({ title, children }) { return <article className="report-panel"><h2>{title}</h2>{children}</article> }
function Empty({ text = "Sin datos suficientes todavia." }) { return <div className="reports-empty"><span>{text}</span></div> }
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
  if (tab === "sales") return (data.byDay || []).map((row) => ({ Periodo: row.date, Ordenes: row.orders, Ventas: row.sales, TicketPromedio: row.averageTicket }))
  if (tab === "waiters" || tab === "comparison") return data.map((row, index) => ({ Ranking: index + 1, Colaborador: row.waiter, Ventas: row.sales, Ordenes: row.orders, TicketPromedio: row.averageTicket }))
  if (tab === "purchases") return (data.rows || []).map((row) => ({ Orden: row.orderNumber, Proveedor: row.supplier, Estado: row.status, Total: row.total, Fecha: row.created_at }))
  if (tab === "fixedCosts") return data.map((row) => ({ Nombre: row.name, Categoria: fixedCategoryLabel(row.category), MontoMensual: row.monthly_amount, Activo: row.active }))
  if (tab === "payroll") return (data.rows || []).map((row) => ({ Colaborador: row.employee, Departamento: row.department, Monto: row.amount }))
  if (tab === "menu") return data.map((row) => ({ Producto: row.product, Categoria: row.category, Unidades: row.quantity, Ventas: row.revenue ?? row.sales, Utilidad: row.profit ?? row.estimatedProfit, Clasificacion: row.classification }))
  if (tab === "inventory") return [...(data.out || []), ...(data.low || [])].map((row) => ({ Producto: row.item?.name, Area: row.area?.name || row.area_id, StockActual: row.quantity, StockMinimo: row.minimum_quantity }))
  return []
}

function filterWaiters(rows, filters = {}) {
  const term = String(filters.collaborator || "").trim().toLowerCase()
  return term ? (rows || []).filter((row) => String(row.waiter || "").toLowerCase().includes(term)) : (rows || [])
}

function filterMenuRows(rows, filters = {}) {
  const term = String(filters.category || "").trim().toLowerCase()
  return term ? (rows || []).filter((row) => String(row.category || "").toLowerCase().includes(term)) : (rows || [])
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

function fixedCategoryLabel(value) {
  return FIXED_CATEGORIES.find(([key]) => key === value)?.[1] || value
}

function money(value) { return `Q${Number(value || 0).toFixed(2)}` }
function numberText(value) { return Number(value || 0).toFixed(2) }

export default ReportsDashboard
