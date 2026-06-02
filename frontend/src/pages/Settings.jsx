import { useState } from "react"
import RolesManagement from "./RolesManagement"
import "./Settings.css"

function Settings() {
  const [activeTab, setActiveTab] = useState("roles")

  return (
    <section className="settings-page">
      <nav className="settings-tabs">
        <button
          className={`settings-tab ${activeTab === "roles" ? "active" : ""}`}
          onClick={() => setActiveTab("roles")}
        >
          Roles de Usuario
        </button>
      </nav>

      <div className="settings-content">
        {activeTab === "roles" && <RolesManagement />}
      </div>
    </section>
  )
}

const pageStyle = {
  display: "grid",
  gap: "8px"
}

export default Settings


