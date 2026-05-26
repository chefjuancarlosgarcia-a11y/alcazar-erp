import { Navigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

function ProtectedRoute({ module, children }) {
  const { user, session, loading, profileError, logout, canAccess, getDefaultPath } = useAuth()

  if (loading) {
    return <div style={statusStyle}>Cargando sesión...</div>
  }

  if (session && !user && profileError) {
    return (
      <div style={statusStyle}>
        <strong>{profileError}</strong>
        <button type="button" onClick={logout} style={buttonStyle}>Cerrar sesión</button>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (module && !canAccess(module)) {
    return <Navigate to={getDefaultPath(user)} replace />
  }

  return children
}

const statusStyle = {
  minHeight: "55vh",
  display: "grid",
  placeContent: "center",
  gap: "16px",
  textAlign: "center",
  color: "#e6eef8"
}

const buttonStyle = {
  justifySelf: "center",
  padding: "10px 14px",
  border: 0,
  borderRadius: "8px",
  background: "#0ea5a4",
  color: "#022c2c",
  fontWeight: 700,
  cursor: "pointer"
}

export default ProtectedRoute
