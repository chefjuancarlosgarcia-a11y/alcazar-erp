import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import { canManageRoleCatalog } from "../utils/profilePermissions"
import BrandingAppearanceSettings from "../components/branding/BrandingAppearanceSettings"
import RolesManagement from "./RolesManagement"
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
          <button className={`settings-tab ${activeTab === "roles" ? "active" : ""}`} onClick={() => setActiveTab("roles")}>
            Roles y permisos
          </button>
        )}
        <Link className="settings-tab" to="/settings/tickets">
          Diseno de Tickets
        </Link>
      </nav>

      <div className="settings-content settings-content-wide">
        {activeTab === "branding" && <BrandingAppearanceSettings />}
        {canManageRoles && activeTab === "roles" && <RolesManagement />}
      </div>
    </section>
  )
}

export default Settings
