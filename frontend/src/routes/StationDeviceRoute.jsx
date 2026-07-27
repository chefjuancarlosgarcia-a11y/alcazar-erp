import { Navigate } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

function StationDeviceRoute({ children }) {
  const { loading, session, stationDeviceContext } = useAuth()

  if (loading) {
    return <div style={statusStyle}>Cargando terminal...</div>
  }

  if (!session) {
    return <Navigate to="/station-enroll" replace />
  }

  if (!stationDeviceContext?.active) {
    return (
      <div style={statusStyle}>
        <strong>Terminal no autorizada o sin estación activa.</strong>
        <p style={{ color: "#94a3b8" }}>Complete enrollment OS1 o contacte administración.</p>
      </div>
    )
  }

  return children
}

const statusStyle = {
  minHeight: "55vh",
  display: "grid",
  placeContent: "center",
  gap: "16px",
  textAlign: "center",
  color: "#e6eef8",
  padding: "24px"
}

export default StationDeviceRoute
