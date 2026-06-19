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

const Dashboard = lazy(() => import("../pages/Dashboard"))
const HR = lazy(() => import("../pages/HR"))
const Inventory = lazy(() => import("../pages/Inventory"))
const POS = lazy(() => import("../pages/POS"))
const Cashier = lazy(() => import("../pages/Cashier"))
const CashManagement = lazy(() => import("../pages/CashManagement"))
const Production = lazy(() => import("../pages/Production"))
const ProductionHub = lazy(() => import("../pages/ProductionHub"))
const ProductionAreasManagement = lazy(() => import("../pages/ProductionAreasManagement"))
const ProductionProductsConfig = lazy(() => import("../pages/ProductionProductsConfig"))
const ProductionUserAssignments = lazy(() => import("../pages/ProductionUserAssignments"))
const ProductionLegacyRedirect = lazy(() => import("../pages/ProductionLegacyRedirect"))
const Reports = lazy(() => import("../pages/Reports"))
const SalesGoalsSettings = lazy(() => import("../pages/SalesGoalsSettings"))
const Settings = lazy(() => import("../pages/Settings"))
const TicketTemplateSettings = lazy(() => import("../pages/TicketTemplateSettings"))
const Account = lazy(() => import("../pages/Account"))
const Tasks = lazy(() => import("../pages/Tasks"))
const CateringDashboard = lazy(() => import("../modules/catering/CateringDashboard"))

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
            <Route path="/tasks" element={<ProtectedRoute module="tasks"><Tasks /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute module="reports"><Reports /></ProtectedRoute>} />
            <Route path="/reports/goals/settings" element={<ProtectedRoute module="reports"><SalesGoalsSettings /></ProtectedRoute>} />
            <Route path="/catering" element={<ProtectedRoute module="catering"><CateringDashboard /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
            <Route path="/settings/tickets" element={<ProtectedRoute module="settings"><TicketTemplateSettings /></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
            <Route path="*" element={<DefaultRedirect />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default AppRoutes
