import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import MainLayout from "../layouts/MainLayout"
import { useAuth } from "../context/AuthContext"
import Dashboard from "../pages/Dashboard"
import HR from "../pages/HR"
import Inventory from "../pages/Inventory"
import Login from "../pages/Login"
import POS from "../pages/POS"
import Cashier from "../pages/Cashier"
import Production from "../pages/Production"
import Reports from "../pages/Reports"
import Settings from "../pages/Settings"
import Account from "../pages/Account"
import Tasks from "../pages/Tasks"
import ProtectedRoute from "./ProtectedRoute"

function DefaultRedirect() {
  const { user, loading, getDefaultPath } = useAuth()
  if (loading) return null
  return <Navigate to={user ? getDefaultPath(user) : "/login"} replace />
}

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<MainLayout />}>
          <Route index element={<DefaultRedirect />} />
          <Route path="/dashboard" element={<ProtectedRoute module="dashboard"><Dashboard /></ProtectedRoute>} />
          <Route path="/inventory" element={<ProtectedRoute module="inventory"><Inventory /></ProtectedRoute>} />
          <Route path="/pos" element={<ProtectedRoute module="pos"><POS /></ProtectedRoute>} />
          <Route path="/cash" element={<ProtectedRoute><Cashier /></ProtectedRoute>} />
          <Route path="/cashier" element={<ProtectedRoute><Cashier /></ProtectedRoute>} />
          <Route path="/production" element={<ProtectedRoute><Production /></ProtectedRoute>} />
          <Route path="/production/:areaId" element={<ProtectedRoute><Production /></ProtectedRoute>} />
          <Route path="/kds" element={<ProtectedRoute><Production /></ProtectedRoute>} />
          <Route path="/kds/:areaId" element={<ProtectedRoute><Production /></ProtectedRoute>} />
          <Route path="/hr" element={<ProtectedRoute module="hr"><HR /></ProtectedRoute>} />
          <Route path="/tasks" element={<ProtectedRoute><Tasks /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute module="reports"><Reports /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute module="settings"><Settings /></ProtectedRoute>} />
          <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
          <Route path="*" element={<DefaultRedirect />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default AppRoutes
