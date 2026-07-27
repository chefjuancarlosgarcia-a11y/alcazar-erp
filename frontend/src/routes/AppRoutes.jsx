import { lazy, Suspense } from "react"
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import MainLayout from "../layouts/MainLayout"
import { useAuth } from "../context/AuthContext"
import Login from "../pages/Login"
import ForgotPassword from "../pages/ForgotPassword"
import ForgotUser from "../pages/ForgotUser"
import UpdatePassword from "../pages/UpdatePassword"
import Kiosk from "../pages/Kiosk"
import ProtectedRoute from "./ProtectedRoute"
import StationDeviceRoute from "./StationDeviceRoute"
import { logPerformanceEvent } from "../utils/performanceLogger"

function lazyWithPerformanceLogging(moduleName, factory) {
  return lazy(() => {
    const start = performance.now()
    return factory()
      .then((module) => {
        logPerformanceEvent({
          module: moduleName,
          action: "load",
          event_type: "module_load",
          status: "ok",
          severity: "info",
          duration_ms: performance.now() - start,
          message: `Module ${moduleName} loaded`
        })
        return module
      })
      .catch((error) => {
        logPerformanceEvent({
          module: moduleName,
          action: "load",
          event_type: "module_load",
          status: "error",
          severity: "error",
          duration_ms: performance.now() - start,
          error_message: error?.message || "Module load failed",
          message: `Module ${moduleName} failed to load`
        })
        throw error
      })
  })
}

const Dashboard = lazyWithPerformanceLogging("dashboard", () => import("../pages/Dashboard"))
const HR = lazyWithPerformanceLogging("hr", () => import("../pages/HR"))
const Inventory = lazyWithPerformanceLogging("inventory", () => import("../pages/Inventory"))
const POS = lazyWithPerformanceLogging("pos", () => import("../pages/POS"))
const Cashier = lazyWithPerformanceLogging("cash", () => import("../pages/Cashier"))
const CashManagement = lazyWithPerformanceLogging("cash_control", () => import("../pages/CashManagement"))
const Production = lazyWithPerformanceLogging("production", () => import("../pages/Production"))
const ProductionHub = lazyWithPerformanceLogging("production_hub", () => import("../pages/ProductionHub"))
const ProductionAreasManagement = lazyWithPerformanceLogging("production_areas", () => import("../pages/ProductionAreasManagement"))
const ProductionProductsConfig = lazyWithPerformanceLogging("production_products", () => import("../pages/ProductionProductsConfig"))
const ProductionUserAssignments = lazyWithPerformanceLogging("production_assignments", () => import("../pages/ProductionUserAssignments"))
const ProductionLegacyRedirect = lazyWithPerformanceLogging("production_legacy", () => import("../pages/ProductionLegacyRedirect"))
const Reports = lazyWithPerformanceLogging("reports", () => import("../pages/Reports"))
const SalesGoalsSettings = lazyWithPerformanceLogging("sales_goals", () => import("../pages/SalesGoalsSettings"))
const Settings = lazyWithPerformanceLogging("settings", () => import("../pages/Settings"))
const TicketTemplateSettings = lazyWithPerformanceLogging("ticket_settings", () => import("../pages/TicketTemplateSettings"))
const Account = lazyWithPerformanceLogging("account", () => import("../pages/Account"))
const Tasks = lazyWithPerformanceLogging("tasks", () => import("../pages/TasksEntry"))
const CateringDashboard = lazyWithPerformanceLogging("catering", () => import("../modules/catering/CateringDashboard"))
const Finance = lazyWithPerformanceLogging("finance", () => import("../pages/Finance"))
const OperationsCenter = lazyWithPerformanceLogging("operations_center", () => import("../pages/OperationsCenter"))
const BakeryProductionHub = lazyWithPerformanceLogging("bakery", () => import("../modules/bakery/BakeryProductionHub"))
const OperationalStationsSettings = lazyWithPerformanceLogging("operational_stations", () => import("../pages/OperationalStationsSettings"))
const StationEnroll = lazyWithPerformanceLogging("station_enroll", () => import("../pages/StationEnroll"))
const StationCashEntry = lazyWithPerformanceLogging("station_cash", () => import("../pages/StationCashEntry"))

function PageLoadingFallback() {
  return <p>Cargando módulo...</p>
}

function DefaultRedirect() {
  const { user, loading, getDefaultPath } = useAuth()
  if (loading) return null
  return <Navigate to={user ? getDefaultPath(user) : "/login"} replace />
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Suspense fallback={<PageLoadingFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/forgot-user" element={<ForgotUser />} />
          <Route path="/update-password" element={<UpdatePassword />} />
          <Route path="/kiosk" element={<Kiosk />} />
          <Route path="/station-enroll" element={<StationEnroll />} />
          <Route
            path="/station/cash"
            element={
              <StationDeviceRoute>
                <StationCashEntry />
              </StationDeviceRoute>
            }
          />
          <Route element={<MainLayout />}>
            <Route index element={<DefaultRedirect />} />
            <Route path="/dashboard" element={<ProtectedRoute module="dashboard"><Dashboard /></ProtectedRoute>} />
            <Route path="/inventory" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
            <Route path="/pos" element={<ProtectedRoute module="pos"><POS /></ProtectedRoute>} />
            <Route path="/cash" element={<ProtectedRoute module="cash"><Cashier /></ProtectedRoute>} />
            <Route path="/cashier" element={<ProtectedRoute module="cash"><Cashier /></ProtectedRoute>} />
            <Route path="/cash-control" element={<ProtectedRoute module="cash"><CashManagement /></ProtectedRoute>} />
            <Route path="/production" element={<ProtectedRoute module="production"><ProductionHub /></ProtectedRoute>} />
            <Route path="/production/kds/:areaId" element={<ProtectedRoute module="production"><Production /></ProtectedRoute>} />
            <Route path="/production/areas" element={<ProtectedRoute module="production"><ProductionAreasManagement /></ProtectedRoute>} />
            <Route path="/production/products" element={<ProtectedRoute module="production"><ProductionProductsConfig /></ProtectedRoute>} />
            <Route path="/production/assignments" element={<ProtectedRoute module="production"><ProductionUserAssignments /></ProtectedRoute>} />
            <Route path="/production/:areaId" element={<ProtectedRoute module="production"><ProductionLegacyRedirect /></ProtectedRoute>} />
            <Route path="/kds" element={<ProtectedRoute module="production"><ProductionHub /></ProtectedRoute>} />
            <Route path="/kds/:areaId" element={<ProtectedRoute module="production"><ProductionLegacyRedirect /></ProtectedRoute>} />
            <Route path="/hr" element={<ProtectedRoute module="hr"><HR /></ProtectedRoute>} />
            <Route path="/tasks/*" element={<ProtectedRoute module="tasks"><Tasks /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute module="reports"><Reports /></ProtectedRoute>} />
            <Route path="/reports/goals/settings" element={<ProtectedRoute module="reports"><SalesGoalsSettings /></ProtectedRoute>} />
            <Route path="/catering" element={<ProtectedRoute module="catering"><CateringDashboard /></ProtectedRoute>} />
            <Route path="/finance" element={<ProtectedRoute module="finance"><Finance /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
            <Route path="/settings/tickets" element={<ProtectedRoute module="settings"><TicketTemplateSettings /></ProtectedRoute>} />
            <Route path="/settings/operational-stations" element={<ProtectedRoute module="settings"><OperationalStationsSettings /></ProtectedRoute>} />
            <Route path="/operations-center" element={<ProtectedRoute module="operations_center"><OperationsCenter /></ProtectedRoute>} />
            <Route path="/bakery" element={<ProtectedRoute module="bakery"><BakeryProductionHub /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
            <Route path="*" element={<DefaultRedirect />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default AppRoutes
