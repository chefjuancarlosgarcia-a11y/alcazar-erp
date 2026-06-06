import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { DEFAULT_BRANDING_SETTINGS, getBrandingSettings, saveBrandingSettings } from "../services/appSettingsService"
import RolesManagement from "./RolesManagement"
import "./Settings.css"

function Settings() {
  const [activeTab, setActiveTab] = useState("branding")
  const [branding, setBranding] = useState(DEFAULT_BRANDING_SETTINGS)
  const [message, setMessage] = useState("")

  useEffect(() => {
    getBrandingSettings().then(({ data }) => setBranding(data))
  }, [])

  async function saveBranding(event) {
    event.preventDefault()
    const result = await saveBrandingSettings(branding)
    setMessage(result.error ? "Branding guardado localmente. Aplica la migración app_settings para guardar en Supabase." : "Branding guardado correctamente.")
  }

  return (
    <section className="settings-page">
      <nav className="settings-tabs">
        <button className={`settings-tab ${activeTab === "branding" ? "active" : ""}`} onClick={() => setActiveTab("branding")}>
          Branding del sistema
        </button>
        <button className={`settings-tab ${activeTab === "roles" ? "active" : ""}`} onClick={() => setActiveTab("roles")}>
          Roles de Usuario
        </button>
        <Link className="settings-tab" to="/settings/tickets">
          Diseno de Tickets
        </Link>
      </nav>

      <div className="settings-content">
        {activeTab === "branding" && (
          <form className="branding-settings" onSubmit={saveBranding}>
            <article className="settings-card">
              <div>
                <p className="settings-eyebrow">Identidad visual</p>
                <h2>Branding del sistema</h2>
                <p>Configura cómo se presenta el ERP en el sidebar de cada terminal.</p>
              </div>
              {message && <div className="settings-feedback">{message}</div>}
              <label>Nombre comercial
                <input value={branding.commercialName} onChange={(event) => setBranding((current) => ({ ...current, commercialName: event.target.value }))} />
              </label>
              <label>Subtítulo
                <input value={branding.subtitle} onChange={(event) => setBranding((current) => ({ ...current, subtitle: event.target.value }))} />
              </label>
              <label>URL del logo
                <input placeholder="https://..." value={branding.logoUrl} onChange={(event) => setBranding((current) => ({ ...current, logoUrl: event.target.value }))} />
              </label>
              <div className="branding-grid">
                <label>Monograma fallback
                  <input maxLength="3" value={branding.monogram} onChange={(event) => setBranding((current) => ({ ...current, monogram: event.target.value.toUpperCase() }))} />
                </label>
                <label>Color principal/acento
                  <input type="color" value={branding.accentColor} onChange={(event) => setBranding((current) => ({ ...current, accentColor: event.target.value }))} />
                </label>
              </div>
              <button type="submit">Guardar branding</button>
            </article>

            <article className="settings-card">
              <p className="settings-eyebrow">Vista previa</p>
              <div className="sidebar-preview">
                <div className="sidebar-preview-brand">
                  <span style={{ borderColor: `${branding.accentColor}77`, color: branding.accentColor }}>
                    {branding.logoUrl ? <img src={branding.logoUrl} alt="" /> : branding.monogram}
                  </span>
                  <div><strong>{branding.commercialName}</strong><small>{branding.subtitle}</small></div>
                </div>
                <div className="sidebar-preview-link active" style={{ borderColor: `${branding.accentColor}99`, boxShadow: `inset 3px 0 0 ${branding.accentColor}` }}>Punto de Venta</div>
                <div className="sidebar-preview-link">Caja</div>
                <div className="sidebar-preview-link">Cocina</div>
              </div>
            </article>
          </form>
        )}
        {activeTab === "roles" && <RolesManagement />}
      </div>
    </section>
  )
}

export default Settings
