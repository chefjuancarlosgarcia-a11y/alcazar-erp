import { useEffect, useMemo, useState } from "react"
import {
  getFoodCostReport,
  getCommandCenterExecutiveBundle,
  getInventoryReport,
  getOperationalAlerts,
  getProductionReport
} from "../../services/reportsService"
import {
  getAttendanceDailyLateArrivals,
  getAttendanceMarks,
  getAttendanceTerminalProfiles
} from "../../services/attendanceService"
import { getYieldDashboardMetrics } from "../../services/yieldCostingService"
import { computeAttendanceReportMetrics, getLocalDateString } from "../../modules/attendance/attendanceReportsHelpers"
import {
  buildActivityTimeline,
  buildAlertList,
  mapAttendanceMarks,
  mapAttendanceProfiles,
  normalizeLateRows,
  resolveOverallStatus,
  trafficLevel
} from "./commandCenterHelpers"

export default function useCommandCenter(recentTasks = []) {
  const [now, setNow] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [kpis, setKpis] = useState(null)
  const [executiveReport, setExecutiveReport] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [production, setProduction] = useState(null)
  const [inventory, setInventory] = useState(null)
  const [hr, setHr] = useState({ late: 0, absences: 0, active: 0 })
  const [costs, setCosts] = useState({
    financialImpact: 0,
    zeroCostRecipes: 0,
    yieldBelowMinimum: 0,
    avgFoodCost: 0
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setError("")
      const today = getLocalDateString()
      try {
        const [
          executiveBundle,
          alertsResult,
          productionResult,
          inventoryResult,
          yieldResult,
          foodCostResult,
          lateResult,
          marksResult,
          profilesResult
        ] = await Promise.all([
          getCommandCenterExecutiveBundle(),
          getOperationalAlerts(),
          getProductionReport({ preset: "today" }),
          getInventoryReport({ preset: "today" }),
          getYieldDashboardMetrics({ preset: "week" }),
          getFoodCostReport(),
          getAttendanceDailyLateArrivals(today),
          getAttendanceMarks(false),
          getAttendanceTerminalProfiles()
        ])

        if (!mounted) return

        const loadError = [
          executiveBundle.error,
          alertsResult.error,
          productionResult.error,
          inventoryResult.error
        ].find(Boolean)

        if (loadError) {
          setError(typeof loadError === "string" ? loadError : loadError.message || "No se pudo cargar el centro de comando.")
        }

        setExecutiveReport(executiveBundle.data?.executiveReport || null)
        setKpis(executiveBundle.data?.kpis || null)
        setProduction(productionResult.data || null)
        setInventory(inventoryResult.data || null)
        setAlerts(buildAlertList(alertsResult.data || [], yieldResult.data?.alerts || []))

        const attendanceMetrics = computeAttendanceReportMetrics({
          asistenciaMovimientos: mapAttendanceMarks(marksResult.data || []),
          asistenciaPerfiles: mapAttendanceProfiles(profilesResult.data || []),
          asistenciaLlegadasTarde: normalizeLateRows(lateResult.data || []),
          asistenciaFechaFiltro: today,
          fechaHoy: today
        })

        setHr({
          late: attendanceMetrics.llegadasTarde.length,
          absences: attendanceMetrics.faltasDelDia.length,
          active: attendanceMetrics.colaboradoresDentroTurno.length
        })

        const foodRows = foodCostResult.data || []
        setCosts({
          financialImpact: Number(yieldResult.data?.summary?.financialImpact || 0),
          zeroCostRecipes: (alertsResult.data || []).filter((row) => row.type === "Receta sin costo").length,
          yieldBelowMinimum: Number(yieldResult.data?.summary?.belowMinimumCount || 0),
          avgFoodCost: foodRows.length
            ? foodRows.reduce((sum, row) => sum + Number(row.foodCostPercent || 0), 0) / foodRows.length
            : 0
        })
      } catch (loadError) {
        if (!mounted) return
        setError(loadError?.message || "No se pudo cargar el centro de comando.")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  const productionSummary = production?.summary || {}
  const productionActive = Number(productionSummary.pending || 0)
    + Number(productionSummary.inProduction || 0)
    + Number(productionSummary.ready || 0)
  const productionLate = Number(productionSummary.late || 0)
  const productionAvg = production?.areas?.length
    ? Math.round(production.areas.reduce((sum, row) => sum + Number(row.averageMinutes || 0), 0) / production.areas.length)
    : 0

  const inventoryOut = (inventory?.out || []).length
  const inventoryLow = (inventory?.low || []).length
  const pendingRequisitions = Number(kpis?.pendingRequisitions || 0)

  const semaphores = trafficLevel(productionSummary, inventory, hr, costs)
  const overallStatus = resolveOverallStatus(alerts, semaphores)
  const activity = useMemo(
    () => buildActivityTimeline(production, inventory, recentTasks),
    [production, inventory, recentTasks]
  )

  return {
    now,
    loading,
    error,
    kpis,
    executiveReport,
    alerts,
    hr,
    costs,
    semaphores,
    overallStatus,
    activity,
    productionActive,
    productionLate,
    productionAvg,
    inventoryOut,
    inventoryLow,
    pendingRequisitions
  }
}
