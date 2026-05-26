import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { BRANDING } from "../branding"
import { supabase } from "../lib/supabase"
import "./AuthRecovery.css"

function UpdatePassword() {
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [updated, setUpdated] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setHasSession(Boolean(data.session))
      setCheckingSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setHasSession(Boolean(session))
      setCheckingSession(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    setError("")
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.")
      return
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.")
      return
    }

    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) {
      setError("No se pudo actualizar la contraseña. Solicita un nuevo enlace de recuperación.")
      return
    }

    await supabase.auth.signOut({ scope: "local" })
    setUpdated(true)
    setHasSession(false)
  }

  return (
    <main className="auth-recovery-page">
      <section className="auth-recovery-card">
        <header className="auth-recovery-brand">
          <span>{BRANDING.logo} {BRANDING.appName}</span>
          <h1>Nueva contraseña</h1>
          <p>Define una nueva contraseña para volver a ingresar al sistema.</p>
        </header>

        {checkingSession && <p>Validando enlace de recuperación...</p>}

        {updated && (
          <div className="auth-recovery-actions">
            <p className="auth-recovery-success">Tu contraseña fue actualizada correctamente. Ya puedes iniciar sesión.</p>
            <Link className="auth-recovery-primary" to="/login">Ir al inicio de sesión</Link>
          </div>
        )}

        {!checkingSession && !hasSession && !updated && (
          <div className="auth-recovery-actions">
            <p className="auth-recovery-error">El enlace de recuperación no es válido o ya expiró.</p>
            <Link className="auth-recovery-primary" to="/forgot-password">Solicitar un nuevo enlace</Link>
            <Link className="auth-recovery-link" to="/login">Volver al inicio de sesión</Link>
          </div>
        )}

        {!checkingSession && hasSession && !updated && (
          <form className="auth-recovery-form" onSubmit={handleSubmit}>
            <label className="auth-recovery-field">
              Nueva contraseña
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" required />
            </label>
            <label className="auth-recovery-field">
              Confirmar contraseña
              <input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" required />
            </label>
            {error && <p className="auth-recovery-error">{error}</p>}
            <button className="auth-recovery-primary" type="submit" disabled={submitting}>
              {submitting ? "Actualizando..." : "Actualizar contraseña"}
            </button>
          </form>
        )}
      </section>
    </main>
  )
}

export default UpdatePassword
