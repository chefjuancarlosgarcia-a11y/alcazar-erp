import { Link } from "react-router-dom"
import { BRANDING } from "../branding"
import "./AuthRecovery.css"

function ForgotUser() {
  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card">
        <header className="auth-recovery-brand">
          <span>{BRANDING.logo} {BRANDING.appName}</span>
          <h1>Olvidé mi usuario</h1>
        </header>

        <div className="auth-recovery-help">
          <p>Tu usuario es el correo con el que fuiste registrado. Si no lo recuerdas, comunícate con Administración o RRHH.</p>
        </div>

        <div className="auth-recovery-actions">
          <p>Solicita internamente la confirmación de tu correo corporativo al encargado de Administración o Recursos Humanos.</p>
          <Link className="auth-recovery-secondary" to="/login">Volver al inicio de sesión</Link>
        </div>
      </section>
    </main>
  )
}

export default ForgotUser
