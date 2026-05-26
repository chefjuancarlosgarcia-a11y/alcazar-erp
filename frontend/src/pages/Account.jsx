import { useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "../context/AuthContext"
import "./Account.css"

const sectionLabels = {
  profile: "Mi perfil",
  password: "Cambiar contraseña",
  settings: "Configuración de cuenta",
  notifications: "Notificaciones"
}

function getInitials(name) {
  return String(name || "Usuario")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
}

function Account() {
  const { user, changeOwnPassword } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const section = sectionLabels[searchParams.get("section")] ? searchParams.get("section") : "profile"
  const [newPassword, setNewPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [currentPassword, setCurrentPassword] = useState("")
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  function selectSection(nextSection) {
    setMessage("")
    setError("")
    setSearchParams(nextSection === "profile" ? {} : { section: nextSection })
  }

  async function submitPassword(event) {
    event.preventDefault()
    setError("")
    setMessage("")

    if (newPassword.length < 8 || !/[A-ZÁÉÍÓÚÑ]/.test(newPassword) || !/\d/.test(newPassword)) {
      setError("La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.")
      return
    }

    if (newPassword !== confirmation) {
      setError("Las contraseñas no coinciden.")
      return
    }

    const result = await changeOwnPassword(currentPassword, newPassword)
    if (!result.ok) {
      setError(result.message)
      return
    }

    setCurrentPassword("")
    setNewPassword("")
    setConfirmation("")
    setMessage("Contraseña actualizada correctamente.")
  }

  return (
    <section style={pageStyle}>
      <div style={headingStyle}>
        <h1 style={titleStyle}>Cuenta</h1>
        <p style={subtitleStyle}>Administra tu perfil y preferencias de acceso.</p>
      </div>

      <div className="account-shell" style={shellStyle}>
        <aside style={accountCardStyle}>
          {user?.avatar ? (
            <img src={user.avatar} alt={`Foto de ${user.name}`} style={avatarStyle} />
          ) : (
            <div style={avatarFallbackStyle}>{getInitials(user?.name)}</div>
          )}
          <strong style={nameStyle}>{user?.name}</strong>
          <span style={mutedStyle}>{user?.email || `@${user?.username}`}</span>
          <span style={roleStyle}>{user?.legacyRole}</span>
          <nav style={navigationStyle} aria-label="Cuenta">
            {Object.entries(sectionLabels).map(([key, label]) => (
              <button
                type="button"
                key={key}
                onClick={() => selectSection(key)}
                style={section === key ? activeNavButtonStyle : navButtonStyle}
              >
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <article className="account-panel" style={panelStyle}>
          <h2 style={panelTitleStyle}>{sectionLabels[section]}</h2>

          {section === "profile" && (
            <div style={infoGridStyle}>
              <Info label="Nombre completo" value={user?.name} />
              <Info label="Usuario" value={user?.username} />
              <Info label="Correo" value={user?.email || "Sin correo registrado"} />
              <Info label="Rol del sistema" value={user?.legacyRole || user?.role} />
              <Info label="Estado" value={user?.auth?.isOnline === true ? "En línea" : "Sin conexión"} />
            </div>
          )}

          {section === "password" && (
            <form onSubmit={submitPassword} style={formStyle}>
              <p style={mutedStyle}>Usa una contraseña nueva de al menos 8 caracteres, con mayúscula y número.</p>
              <label style={labelStyle}>
                Contraseña actual
                <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} style={inputStyle} autoComplete="current-password" />
              </label>
              <label style={labelStyle}>
                Nueva contraseña
                <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} style={inputStyle} autoComplete="new-password" />
              </label>
              <label style={labelStyle}>
                Confirmar contraseña
                <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} style={inputStyle} autoComplete="new-password" />
              </label>
              {error && <p style={errorStyle}>{error}</p>}
              {message && <p style={successStyle}>{message}</p>}
              <button type="submit" style={primaryButtonStyle}>Guardar contraseña</button>
            </form>
          )}

          {section === "settings" && (
            <div style={emptyPanelStyle}>
              <strong>Configuración personal</strong>
              <p style={mutedStyle}>Tus preferencias de cuenta estarán disponibles aquí. Los permisos dependen de tu rol.</p>
            </div>
          )}

          {section === "notifications" && (
            <div style={emptyPanelStyle}>
              <strong>No hay notificaciones de cuenta pendientes</strong>
              <p style={mutedStyle}>Las alertas relevantes del sistema aparecerán en este espacio.</p>
            </div>
          )}
        </article>
      </div>
    </section>
  )
}

function Info({ label, value }) {
  return (
    <div style={infoStyle}>
      <span style={infoLabelStyle}>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  )
}

const pageStyle = { display: "grid", gap: "22px", color: "#e6eef8", maxWidth: "1080px", margin: "0 auto" }
const headingStyle = { display: "grid", gap: "5px" }
const titleStyle = { color: "#f8fafc", fontSize: "30px", margin: 0 }
const subtitleStyle = { color: "#94a3b8" }
const shellStyle = { display: "grid", gridTemplateColumns: "minmax(240px, 290px) minmax(340px, 1fr)", gap: "18px", alignItems: "start" }
const accountCardStyle = { display: "grid", justifyItems: "center", gap: "7px", padding: "22px 16px 14px", border: "1px solid #24344a", borderRadius: "16px", background: "#0f172a" }
const avatarStyle = { width: "78px", height: "78px", borderRadius: "20px", objectFit: "cover", marginBottom: "5px" }
const avatarFallbackStyle = { ...avatarStyle, display: "grid", placeItems: "center", background: "linear-gradient(145deg, #0ea5a4, #164e63)", color: "#ecfeff", fontWeight: 800, fontSize: "25px" }
const nameStyle = { color: "#f8fafc", fontSize: "18px" }
const mutedStyle = { color: "#94a3b8" }
const roleStyle = { color: "#5eead4", fontSize: "13px", fontWeight: 700, marginTop: "3px" }
const navigationStyle = { display: "grid", gap: "4px", width: "100%", marginTop: "17px", paddingTop: "13px", borderTop: "1px solid #24344a" }
const navButtonStyle = { padding: "11px 12px", border: "none", borderRadius: "9px", background: "transparent", color: "#cbd5e1", textAlign: "left", cursor: "pointer", fontSize: "14px" }
const activeNavButtonStyle = { ...navButtonStyle, background: "#123336", color: "#99f6e4", fontWeight: 700 }
const panelStyle = { minHeight: "360px", padding: "24px", border: "1px solid #24344a", borderRadius: "16px", background: "#0f172a", boxSizing: "border-box" }
const panelTitleStyle = { color: "#f8fafc", margin: "0 0 22px", fontSize: "23px" }
const infoGridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "13px" }
const infoStyle = { display: "grid", gap: "7px", padding: "14px", borderRadius: "11px", background: "#111c30", color: "#e6eef8" }
const infoLabelStyle = { color: "#94a3b8", fontSize: "13px" }
const formStyle = { display: "grid", gap: "15px", maxWidth: "470px" }
const labelStyle = { display: "grid", gap: "7px", color: "#cbd5e1", fontWeight: 600 }
const inputStyle = { padding: "12px", border: "1px solid #334155", borderRadius: "8px", background: "#071023", color: "#f8fafc", font: "inherit" }
const primaryButtonStyle = { width: "fit-content", padding: "11px 16px", border: "none", borderRadius: "8px", background: "#0ea5a4", color: "#021", fontWeight: 700, cursor: "pointer" }
const errorStyle = { padding: "11px", borderRadius: "8px", background: "#451a24", color: "#fca5a5" }
const successStyle = { padding: "11px", borderRadius: "8px", background: "#063a34", color: "#99f6e4" }
const emptyPanelStyle = { display: "grid", gap: "10px", padding: "18px", borderRadius: "12px", background: "#111c30" }

export default Account
