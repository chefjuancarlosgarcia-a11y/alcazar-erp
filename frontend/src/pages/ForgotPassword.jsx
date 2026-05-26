import { useState } from "react"
import { Link } from "react-router-dom"
import { BRANDING } from "../branding"
import { supabase } from "../lib/supabase"
import "./AuthRecovery.css"

function ForgotPassword() {
  const [email, setEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    setMessage("")

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/update-password`
    })

    setSubmitting(false)
    if (resetError) {
      setError("No fue posible enviar el correo de recuperación. Intenta nuevamente.")
      return
    }

    setMessage("Si el correo está registrado, recibirás un enlace para crear una nueva contraseña.")
  }

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card">
        <header className="auth-recovery-brand">
          <span>{BRANDING.logo} {BRANDING.appName}</span>
          <h1>Recuperar contraseña</h1>
          <p>Ingresa tu correo registrado y te enviaremos un enlace seguro para actualizar tu contraseña.</p>
        </header>

        <form className="auth-recovery-form" onSubmit={handleSubmit}>
          <label className="auth-recovery-field">
            Correo electrónico
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@empresa.com" autoComplete="email" required />
          </label>
          {message && <p className="auth-recovery-success">{message}</p>}
          {error && <p className="auth-recovery-error">{error}</p>}
          <button type="submit" className="auth-recovery-primary" disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar enlace de recuperación"}
          </button>
        </form>

        <Link className="auth-recovery-link" to="/login">Volver al inicio de sesión</Link>
      </section>
    </main>
  )
}

export default ForgotPassword
