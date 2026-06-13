/**
 * Registro de asistencia (flujo oficial):
 * - /hr?section=asistencia → AttendanceTerminal.jsx
 * - /kiosk → AttendanceTerminal.jsx (modo kiosco)
 * - /hr?section=dispositivosMarcaje → AttendanceDevicesManagement.jsx
 * Reportes: /hr?section=reportesAsistencia → LegacyInventoryApp (solo lectura).
 * Deprecados (redirigen a /inventory): inventario, recetas, requisicion.
 */
import { lazy, Suspense } from "react"
import ProfileManagement from "./ProfileManagement"
import ScheduleManagement from "./ScheduleManagement"
import AttendanceDevicesManagement from "./AttendanceDevicesManagement"
import AttendanceTerminal from "../components/AttendanceTerminal"
import { Navigate, useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

const LegacyInventoryApp = lazy(() => import("../modules/LegacyInventoryApp"))

const DEPRECATED_INVENTORY_SECTIONS = {
  inventario: "/inventory?section=inventario",
  recetas: "/inventory?section=recetas",
  requisicion: "/inventory?section=requisicion"
}

function HR() {
  const location = useLocation()
  const { user } = useAuth()
  const params = new URLSearchParams(location.search)
  const section = params.get("section")
  const profileId = params.get("profileId") || ""
  const editProfile = params.get("mode") === "edit"
  const defaultSection = ["admin", "gerente", "gerente_general", "recursos_humanos", "rrhh"].includes(user?.role) ? "usuarios" : "asistencia"
  const selectedSection = section || defaultSection

  if (selectedSection === "usuarios") {
    return <ProfileManagement requestedProfileId={profileId} editRequested={editProfile} />
  }

  if (selectedSection === "horarios") {
    return <ScheduleManagement />
  }

  if (selectedSection === "asistencia") {
    return <AttendanceTerminal />
  }

  if (selectedSection === "dispositivosMarcaje") {
    return <AttendanceDevicesManagement />
  }

  const deprecatedInventoryRoute = DEPRECATED_INVENTORY_SECTIONS[selectedSection]
  if (deprecatedInventoryRoute) {
    console.warn("[legacy] redirected deprecated section", selectedSection)
    return <Navigate to={deprecatedInventoryRoute} replace />
  }

  return <Suspense fallback={<p>Cargando módulo...</p>}><LegacyInventoryApp initialSeccion={selectedSection} hideLegacyNavigation /></Suspense>
}

export default HR
