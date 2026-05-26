import { useEffect, useMemo, useState } from "react"
import * as XLSX from "xlsx"
import { useAuth } from "../../context/AuthContext"
import { getAreas } from "../../services/areasService"
import {
  getAreaPerformanceReport,
  getEmployeePerformanceReport,
  getExecutiveKPIs,
  getFoodCostReport,
  getInventoryReport,
  getMenuEngineeringReport,
  getOperationalAlerts,
  getProductionReport,
  getRequisitionReport,
  getSalesByCategory,
  getSalesByWaiter,
  getSalesReport,
  getTopProducts
} from "../../services/reportsService"
import "./ReportsDashboard.css"

const TABS = [
  ["executive", "Ejecutivo"], ["sales", "Ventas"], ["production", "Producción"],
  ["inventory", "Inventario"], ["requisitions", "Requisiciones"], ["foodcost", "Food Cost"],
  ["menu", "Ingeniería de Menú"], ["areas", "Áreas"], ["employees", "Colaboradores"], ["alerts", "Alertas"]
]

function tabsForRole(role) {
  if (["admin", "gerente_general"].includes(role)) return TABS.map(([key]) => key)
  if (role === "supervisor") return ["executive", "sales", "production", "inventory", "requisitions", "areas", "alerts"]
  if (role === "rrhh") return ["employees"]
  return []
}

function ReportsDashboard() {
  const { user } = useAuth()
  const allowedTabs = useMemo(() => tabsForRole(user?.role), [user?.role])
  const [tab, setTab] = useState(allowedTabs[0] || "")
  const [filters, setFilters] = useState({ preset: "today", start: "", end: "", areaId: "", movementType: "" })
  const [areas, setAreas] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    getAreas().then(({ data: rows }) => setAreas(rows || []))
  }, [])

  useEffect(() => {
    if (!allowedTabs.includes(tab)) {
      const timer = window.setTimeout(() => setTab(allowedTabs[0] || ""), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [allowedTabs, tab])

  useEffect(() => {
    if (!tab) return
    let mounted = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError("")
      const report = await loadReport(tab, filters)
      if (!mounted) return
      setData(report.data)
      setError(report.error || "")
      setLoading(false)
    }, 0)
    return () => {
      mounted = false
      window.clearTimeout(timer)
    }
  }, [tab, filters])

  const rowsToExport = useMemo(() => exportRows(tab, data), [tab, data])
  if (!allowedTabs.length) return <section className="reports-page"><Empty text="No tienes permisos para consultar reportes." /></section>

  return (
    <section className="reports-page">
      <header className="reports-header">
        <div>
          <p className="reports-eyebrow">Inteligencia operativa</p>
          <h1>Reportes</h1>
          <p className="reports-muted">Ventas, producción, costos e inventario conectados a Supabase.</p>
        </div>
        {rowsToExport.length > 0 && (
          <div className="reports-actions">
            <button type="button" onClick={() => downloadCSV(rowsToExport, tab)}>Exportar CSV</button>
            <button className="primary" type="button" onClick={() => downloadExcel(rowsToExport, tab)}>Exportar Excel</button>
          </div>
        )}
      </header>
      <nav className="reports-tabs">
        {TABS.filter(([key]) => allowedTabs.includes(key)).map(([key, label]) => (
          <button className={tab === key ? "active" : ""} type="button" key={key} onClick={() => setTab(key)}>{label}</button>
        ))}
      </nav>
      {!["foodcost", "alerts"].includes(tab) && <FilterBar filters={filters} areas={areas} showInventory={tab === "inventory"} onChange={(field, value) => setFilters((current) => ({ ...current, [field]: value }))} />}
      {error && <div className="reports-warning">Consulta parcial: {error}. Se muestran los datos disponibles.</div>}
      {loading ? <div className="reports-loading">Cargando reporte desde Supabase...</div> : <ReportContent tab={tab} data={data} />}
    </section>
  )
}

async function loadReport(tab, filters) {
  if (tab === "executive") {
    const [kpis, alerts] = await Promise.all([getExecutiveKPIs(filters), getOperationalAlerts()])
    return { data: { kpis: kpis.data, alerts: alerts.data }, error: kpis.error || alerts.error }
  }
  if (tab === "sales") {
    const [days, categories, products, waiters] = await Promise.all([getSalesReport(filters), getSalesByCategory(filters), getTopProducts(filters), getSalesByWaiter(filters)])
    return { data: { days: days.data, categories: categories.data, products: products.data, waiters: waiters.data }, error: days.error || categories.error || products.error || waiters.error }
  }
  const methods = { production: getProductionReport, inventory: getInventoryReport, requisitions: getRequisitionReport, foodcost: getFoodCostReport, menu: getMenuEngineeringReport, areas: getAreaPerformanceReport, employees: getEmployeePerformanceReport, alerts: getOperationalAlerts }
  return methods[tab](filters)
}

function FilterBar({ filters, areas, showInventory, onChange }) {
  return <div className="reports-filters">
    <label>Periodo<select value={filters.preset} onChange={(event) => onChange("preset", event.target.value)}><option value="today">Hoy</option><option value="yesterday">Ayer</option><option value="last7">Últimos 7 días</option><option value="month">Este mes</option><option value="custom">Rango personalizado</option></select></label>
    {filters.preset === "custom" && <><label>Desde<input type="date" value={filters.start} onChange={(event) => onChange("start", event.target.value)} /></label><label>Hasta<input type="date" value={filters.end} onChange={(event) => onChange("end", event.target.value)} /></label></>}
    {showInventory && <><label>Área<select value={filters.areaId} onChange={(event) => onChange("areaId", event.target.value)}><option value="">Todas</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>Movimiento<select value={filters.movementType} onChange={(event) => onChange("movementType", event.target.value)}><option value="">Todos</option><option value="consumption">Consumo</option><option value="transfer">Transferencia</option><option value="purchase">Compra</option><option value="waste">Merma</option><option value="adjustment">Ajuste</option></select></label></>}
  </div>
}

function ReportContent({ tab, data }) {
  if (!data) return <Empty />
  if (tab === "executive") return <Executive data={data} />
  if (tab === "sales") return <Sales data={data} />
  if (tab === "production") return <Production data={data} />
  if (tab === "inventory") return <Inventory data={data} />
  if (tab === "requisitions") return <Requisitions data={data} />
  if (tab === "foodcost") return <FoodCost rows={data} />
  if (tab === "menu") return <MenuEngineering rows={data} />
  if (tab === "areas") return <Areas rows={data} />
  if (tab === "employees") return <Employees rows={data} />
  return <Alerts rows={data} />
}

function Executive({ data }) {
  const k = data.kpis || {}
  const cards = [["Ventas hoy", money(k.salesToday)], ["Ventas del mes", money(k.salesMonth)], ["Órdenes hoy", k.ordersToday || 0], ["Ticket promedio", money(k.averageTicket)], ["Mesas activas", k.activeTables || 0], ["Tickets KDS activos", k.activeTickets || 0], ["Productos bajo mínimo", k.lowStock || 0], ["Requisiciones pendientes", k.pendingRequisitions || 0]]
  return <div className="reports-stack"><div className="reports-kpis">{cards.map(([title, value]) => <KPI key={title} title={title} value={value} />)}</div><Panel title="Alertas prioritarias"><Alerts rows={(data.alerts || []).slice(0, 8)} /></Panel></div>
}

function Sales({ data }) {
  return <div className="reports-grid"><Panel title="Ventas por día"><DataTable headers={["Fecha", "Órdenes", "Ventas", "Ticket promedio"]} rows={data.days.map((row) => [row.date, row.orders, money(row.sales), money(row.averageTicket)])} /></Panel><Panel title="Ventas por categoría"><DataTable headers={["Categoría", "Unidades", "Ventas"]} rows={data.categories.map((row) => [row.category, row.quantity, money(row.sales)])} /></Panel><Panel title="Top productos vendidos"><DataTable headers={["Producto", "Unidades", "Ventas"]} rows={data.products.map((row) => [row.product, row.quantity, money(row.sales)])} /></Panel><Panel title="Ventas por mesero"><DataTable headers={["Mesero", "Órdenes", "Ventas", "Ticket promedio"]} rows={data.waiters.map((row) => [row.waiter, row.orders, money(row.sales), money(row.averageTicket)])} /></Panel></div>
}

function Production({ data }) {
  const s = data.summary || {}
  return <div className="reports-stack"><div className="reports-kpis"><KPI title="Pendientes" value={s.pending || 0} /><KPI title="En producción" value={s.inProduction || 0} /><KPI title="Listos" value={s.ready || 0} tone="good" /><KPI title="Atrasados" value={s.late || 0} tone={s.late ? "danger" : ""} /></div><div className="reports-grid"><Panel title="Rendimiento por área"><DataTable headers={["Área", "Tickets", "Activos", "Promedio"]} rows={data.areas.map((row) => [row.area, row.tickets, row.active, row.averageMinutes ? `${row.averageMinutes} min` : "-"])} /></Panel><Panel title="Tickets recientes"><DataTable headers={["Mesa", "Área", "Estado", "Creado"]} rows={data.recent.map((row) => [row.table_name, row.area_name, <Status key={row.id} value={row.status} />, date(row.created_at)])} /></Panel></div></div>
}

function Inventory({ data }) {
  return <div className="reports-stack"><div className="reports-kpis"><KPI title="Bajo mínimo" value={data.low.length} tone={data.low.length ? "warning" : ""} /><KPI title="Agotados" value={data.out.length} tone={data.out.length ? "danger" : ""} /><KPI title="Movimientos" value={data.movements.length} /><KPI title="Transferencias" value={data.transfers.length} /></div><div className="reports-grid"><Panel title="Inventario crítico"><DataTable headers={["Ingrediente", "Área", "Disponible", "Mínimo"]} rows={[...data.out, ...data.low].map((row) => [row.item?.name || "-", row.area?.name || row.area_id, numberText(row.quantity), numberText(row.minimum_quantity)])} /></Panel><Panel title="Consumo por ingrediente"><DataTable headers={["Ingrediente", "Cantidad consumida"]} rows={data.consumption.map((row) => [row.item, numberText(row.quantity)])} /></Panel><Panel wide title="Kardex reciente"><DataTable headers={["Fecha", "Tipo", "Ingrediente", "Cantidad", "Origen", "Destino"]} rows={data.movements.map((row) => [date(row.created_at), row.movement_type, row.item?.name || "-", numberText(row.quantity), row.from_area?.name || "-", row.to_area?.name || "-"])} /></Panel></div></div>
}

function Requisitions({ data }) {
  const s = data.summary || {}
  return <div className="reports-stack"><div className="reports-kpis"><KPI title="Pendientes" value={s.pending || 0} tone="warning" /><KPI title="Completadas" value={s.completed || 0} tone="good" /><KPI title="Rechazadas" value={s.rejected || 0} tone="danger" /></div><div className="reports-grid"><Panel title="Por área destino"><DataTable headers={["Área", "Requisiciones"]} rows={data.byArea.map((row) => [row.area, row.count])} /></Panel><Panel title="Productos más solicitados"><DataTable headers={["Producto", "Cantidad"]} rows={data.topItems.map((row) => [row.item, numberText(row.quantity)])} /></Panel><Panel wide title="Requisiciones recientes"><DataTable headers={["Número", "Estado", "Área destino", "Solicitante", "Fecha"]} rows={data.rows.map((row) => [row.requisition_number, <Status key={row.id} value={row.status} />, row.target?.name || row.to_area_id, row.requester?.full_name || row.requester?.username || "-", date(row.created_at)])} /></Panel></div></div>
}

function FoodCost({ rows }) {
  return <Panel title="Costo teórico por producto"><DataTable headers={["Producto", "Categoría", "Precio", "Costo receta", "Food cost", "Margen", "Estado"]} rows={rows.map((row) => [row.product, row.category, money(row.price), money(row.cost), `${row.foodCostPercent.toFixed(1)}%`, money(row.grossMargin), <CostStatus key={row.productId} value={row.level} />])} /></Panel>
}

function MenuEngineering({ rows }) {
  const groups = [["star", "Estrellas"], ["horse", "Caballos"], ["puzzle", "Puzzles"], ["dog", "Perros"]]
  return <div className="reports-stack"><div className="reports-kpis">{groups.map(([key, title]) => <KPI key={key} title={title} value={rows.filter((row) => row.classification === key).length} tone={key === "star" ? "good" : key === "dog" ? "danger" : ""} />)}</div><Panel title="Clasificación del menú"><DataTable headers={["Producto", "Unidades", "Venta", "Margen unitario", "Clasificación", "Recomendación"]} rows={rows.map((row) => [row.product, row.quantity, money(row.sales), money(row.grossMargin), <MenuStatus key={row.productId} value={row.classification} />, row.recommendation])} /></Panel></div>
}

function Areas({ rows }) {
  return <Panel title="Rendimiento por área"><DataTable headers={["Área", "Ventas asociadas", "Tickets", "Tiempo promedio", "Consumo", "Requisiciones", "Stock crítico"]} rows={rows.map((row) => [row.area, money(row.sales), row.tickets, row.averageMinutes ? `${row.averageMinutes} min` : "-", numberText(row.consumed), row.requisitions, row.lowStock])} /></Panel>
}

function Employees({ rows }) {
  return <Panel title="Rendimiento de colaboradores"><DataTable headers={["Mesero", "Órdenes atendidas", "Ventas", "Ticket promedio", "Tickets KDS"]} rows={rows.map((row) => [row.waiter, row.orders, money(row.sales), money(row.averageTicket), row.tickets])} emptyText="Sin datos suficientes todavía. Los datos aparecerán al registrar órdenes atendidas." /></Panel>
}

function Alerts({ rows }) {
  if (!rows.length) return <Empty text="Sin alertas operativas en este momento." />
  return <div className="alerts-list">{rows.map((row, index) => <article className={`alert-card ${row.priority}`} key={`${row.type}-${row.detail}-${index}`}><Status value={row.priority} /><div><strong>{row.type}: {row.detail}</strong><p>{row.area} - Acción: {row.action}</p></div></article>)}</div>
}

function KPI({ title, value, tone = "" }) { return <article className={`report-kpi ${tone}`}><span>{title}</span><strong>{value}</strong></article> }
function Panel({ title, children, wide = false }) { return <article className={`report-panel ${wide ? "wide" : ""}`}><h2>{title}</h2>{children}</article> }
function Empty({ text = "Sin datos suficientes todavía." }) { return <div className="reports-empty"><span>{text}</span></div> }

function DataTable({ headers, rows, emptyText = "Sin datos suficientes todavía." }) {
  if (!rows.length) return <Empty text={emptyText} />
  return <div className="reports-table-scroll"><table className="reports-table"><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div>
}

function Status({ value }) {
  const label = { pending: "Pendiente", approved: "Aprobada", completed: "Completada", rejected: "Rechazada", ready: "Lista", in_production: "En producción", draft: "Borrador", critical: "Crítica", high: "Alta", medium: "Media" }[value] || value
  return <span className={`reports-badge ${value}`}>{label}</span>
}
function CostStatus({ value }) { return <span className={`reports-badge ${value}`}>{({ excellent: "Excelente", acceptable: "Aceptable", high: "Alto", critical: "Crítico" })[value]}</span> }
function MenuStatus({ value }) { return <span className={`reports-badge ${value}`}>{({ star: "Estrella", horse: "Caballo", puzzle: "Puzzle", dog: "Perro" })[value]}</span> }

function exportRows(tab, data) {
  if (!data) return []
  if (tab === "sales") return data.products.map((row) => ({ Producto: row.product, Unidades: row.quantity, Venta: row.sales }))
  if (tab === "inventory") return data.stock.map((row) => ({ Ingrediente: row.item?.name, Area: row.area?.name || row.area_id, Cantidad: row.quantity, Minimo: row.minimum_quantity }))
  if (tab === "requisitions") return data.rows.map((row) => ({ Numero: row.requisition_number, Estado: row.status, Area: row.target?.name || row.to_area_id, Fecha: row.created_at }))
  if (tab === "foodcost") return data.map((row) => ({ Producto: row.product, Categoria: row.category, Precio: row.price, Costo: row.cost, FoodCost: row.foodCostPercent, Margen: row.grossMargin }))
  if (tab === "menu") return data.map((row) => ({ Producto: row.product, Unidades: row.quantity, Venta: row.sales, Margen: row.grossMargin, Clasificacion: row.classification, Recomendacion: row.recommendation }))
  return []
}

function downloadExcel(rows, tab) {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Reporte")
  XLSX.writeFile(workbook, `reporte-${tab}.xlsx`)
}
function downloadCSV(rows, tab) {
  const file = new Blob([XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))], { type: "text/csv;charset=utf-8" })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(file)
  link.download = `reporte-${tab}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
}
function money(value) { return `Q${Number(value || 0).toFixed(2)}` }
function numberText(value) { return Number(value || 0).toFixed(2) }
function date(value) { return value ? new Date(value).toLocaleString("es-GT") : "-" }

export default ReportsDashboard
