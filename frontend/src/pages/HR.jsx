/**
 * Registro de asistencia (flujo oficial):
 * - /hr?section=asistencia → AttendanceTerminal.jsx
 * - /kiosk → AttendanceTerminal.jsx (modo kiosco)
 * - /hr?section=dispositivosMarcaje → AttendanceDevicesManagement.jsx
 * Reportes: /hr?section=reportesAsistencia → LegacyInventoryApp (solo lectura).
 */
import { lazy, Suspense } from "react"
import ProfileManagement from "./ProfileManagement"
import ScheduleManagement from "./ScheduleManagement"
import AttendanceDevicesManagement from "./AttendanceDevicesManagement"
import AttendanceTerminal from "../components/AttendanceTerminal"
import { useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

const LegacyInventoryApp = lazy(() => import("../modules/LegacyInventoryApp"))

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

  return <Suspense fallback={<p>Cargando módulo...</p>}><LegacyInventoryApp initialSeccion={selectedSection} hideLegacyNavigation focusEmployeeId={profileId} editFocusedEmployee={editProfile} /></Suspense>
}

export default HR
