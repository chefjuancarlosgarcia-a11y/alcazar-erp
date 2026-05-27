import LegacyInventoryApp from "../modules/LegacyInventoryApp"
import ProfileManagement from "./ProfileManagement"
import ScheduleManagement from "./ScheduleManagement"
import { useLocation } from "react-router-dom"
import { useAuth } from "../context/AuthContext"

function HR() {
  const location = useLocation()
  const { user } = useAuth()
  const params = new URLSearchParams(location.search)
  const section = params.get("section")
  const profileId = params.get("profileId") || ""
  const editProfile = params.get("mode") === "edit"
  const defaultSection = ["admin", "gerente", "gerente_general", "rrhh"].includes(user?.role) ? "usuarios" : "asistencia"
  const selectedSection = section || defaultSection

  if (selectedSection === "usuarios") {
    return <ProfileManagement requestedProfileId={profileId} editRequested={editProfile} />
  }

  if (selectedSection === "horarios") {
    return <ScheduleManagement />
  }

  return <LegacyInventoryApp initialSeccion={selectedSection} hideLegacyNavigation focusEmployeeId={profileId} editFocusedEmployee={editProfile} />
}

export default HR
