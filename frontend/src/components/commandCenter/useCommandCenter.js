import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  getFoodCostReport,
  getCommandCenterExecutiveBundle,
  getOperationalAlertsBundle
} from "../../services/reportsService"
import {
  getAttendanceDailyLateArrivals,
  getAttendanceMarks,
  getAttendanceTerminalProfiles
} from "../../services/attendanceService"
import { getYieldDashboardMetrics } from "../../services/yieldCostingService"
import { computeAttendanceReportMetrics, getLocalDateString } from "../../modules/attendance/attendanceReportsHelpers"
import { logReportsPerf } from "../../utils/reportsPerf"
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
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [requestCompleted, setRequestCompleted] = useState(false)
  const [error, setError] = useState("")
  const [refreshError, setRefreshError] = useState("")
  const hasCachedDataRef = useRef(false)

  const [kpis, setKpis] = useState(null)
  const [executiveReport, setExecutiveReport] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [production, setProduction] = useState(null)
  const [inventory, setInventory] = useState(null)
  const [hr, setHr] = useState(null)
  const [costs, setCosts] = useState(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const load = useCallback(async ({ background = false } = {}) => {
    const hasCache = hasCachedDataRef.current
    if (background && hasCache) {
      setRefreshing(true)
      setRefreshError("")
    } else if (!hasCache) {
      setInitialLoading(true)
      setError("")
    }

    const started = performance.now()
    const today = getLocalDateString()

    try {
      const [
        executiveBundle,
        operationalBundle,
        yieldResult,
        foodCostResult,
        lateResult,
        marksResult,
        profilesResult
      ] = await Promise.all([
        getCommandCenterExecutiveBundle(),
        getOperationalAlertsBundle({ preset: "today" }),
        getYieldDashboardMetrics({ preset: "week" }),
        getFoodCostReport(),
        getAttendanceDailyLateArrivals(today),
        getAttendanceMarks(false),
        getAttendanceTerminalProfiles()
      ])

      const fatalError = [
        executiveBundle.error,
        operationalBundle.error
      ].find(Boolean)

      if (fatalError && !hasCache) {
        setError(typeof fatalError === "string" ? fatalError : fatalError.message || "No se pudo cargar el centro de comando.")
      } else if (fatalError && hasCache) {
        setRefreshError(typeof fatalError === "string" ? fatalError : fatalError.message || "No se pudieron actualizar los datos.")
      } else {
        setError("")
        setRefreshError("")
      }

      if (!fatalError || hasCache) {
        if (executiveBundle.data) {
          setExecutiveReport(executiveBundle.data.executiveReport || null)
          setKpis(executiveBundle.data.kpis || null)
        }
        if (operationalBundle.data) {
          setProduction(operationalBundle.data.production || null)
          setInventory(operationalBundle.data.inventory || null)
          setAlerts(buildAlertList(operationalBundle.data.alerts || [], yieldResult.data?.alerts || []))
        }

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

        const foodRows = foodCostResult.error ? [] : (foodCostResult.data || [])
        setCosts({
          financialImpact: Number(yieldResult.data?.summary?.financialImpact || 0),
          zeroCostRecipes: (operationalBundle.data?.alerts || []).filter((row) => row.type === "Receta sin costo").length,
          yieldBelowMinimum: Number(yieldResult.data?.summary?.belowMinimumCount || 0),
          avgFoodCost: foodRows.length
            ? foodRows.reduce((sum, row) => sum + Number(row.foodCostPercent || 0), 0) / foodRows.length
            : null
        })

        hasCachedDataRef.current = true
      }

      logReportsPerf("command_center_loaded", {
        operation: "useCommandCenter.load",
        duration_ms: Math.round(performance.now() - started),
        request_count: 7,
        background,
        had_cache: hasCache,
        had_error: Boolean(fatalError)
      })
    } catch (loadError) {
      if (!hasCache) {
        setError(loadError?.message || "No se pudo cargar el centro de comando.")
      } else {
        setRefreshError(loadError?.message || "No se pudieron actualizar los datos.")
      }
    } finally {
      setRequestCompleted(true)
      setInitialLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

  const hrSafe = hr || { late: null, absences: null, active: null }
  const costsSafe = costs || { financialImpact: null, zeroCostRecipes: null, yieldBelowMinimum: null, avgFoodCost: null }

  const semaphores = trafficLevel(productionSummary, inventory, hrSafe, costsSafe)
  const overallStatus = resolveOverallStatus(alerts, semaphores)
  const activity = useMemo(
    () => buildActivityTimeline(production, inventory, recentTasks),
    [production, inventory, recentTasks]
  )

  const loading = initialLoading && !hasCachedDataRef.current
  const viewState = loading
    ? "initial-loading"
    : refreshing
      ? "background-refresh"
      : error && !hasCachedDataRef.current
        ? "error-without-cache"
        : refreshError || (error && hasCachedDataRef.current)
          ? "error-with-cache"
          : "success-with-data"

  return {
    now,
    loading,
    initialLoading: loading,
    refreshing,
    requestCompleted,
    viewState,
    error,
    refreshError,
    kpis,
    executiveReport,
    alerts,
    hr: hrSafe,
    costs: costsSafe,
    semaphores,
    overallStatus,
    activity,
    productionActive,
    productionLate,
    productionAvg,
    inventoryOut,
    inventoryLow,
    pendingRequisitions,
    reload: () => load({ background: true })
  }
}
