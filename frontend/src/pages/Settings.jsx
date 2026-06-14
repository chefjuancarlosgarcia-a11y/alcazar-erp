import { Link } from "react-router-dom"
import { useState } from "react"
import { useAuth } from "../context/AuthContext"
import { canManageRoleCatalog } from "../utils/profilePermissions"
import BrandingAppearanceSettings from "../components/branding/BrandingAppearanceSettings"
import "./Settings.css"

function Settings() {
  const { user } = useAuth()
  const canManageRoles = canManageRoleCatalog(user)
  const [activeTab, setActiveTab] = useState("branding")

  return (
    <section className="settings-page">
      <nav className="settings-tabs">
        <button className={`settings-tab ${activeTab === "branding" ? "active" : ""}`} onClick={() => setActiveTab("branding")}>
          Apariencia y Marca
        </button>
        {canManageRoles && (
          <Link className="settings-tab" to="/hr?section=catalogos&tab=roles">
            Roles y áreas (RRHH)
          </Link>
        )}
        <Link className="settings-tab" to="/settings/tickets">
          Diseno de Tickets
        </Link>
      </nav>

      <div className="settings-content settings-content-wide">
        {activeTab === "branding" && <BrandingAppearanceSettings />}
      </div>
    </section>
  )
}

export default Settings
