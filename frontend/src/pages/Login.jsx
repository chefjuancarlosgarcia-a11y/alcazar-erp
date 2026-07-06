import { useCallback, useEffect, useMemo, useState } from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import { BRANDING } from "../branding"
import TurnstileWidget from "../components/auth/TurnstileWidget"
import "../components/auth/LoginSecurityAudit.css"
import { useAuth } from "../context/AuthContext"
import { supabase } from "../lib/supabase"
import {
  BLOCKED_MESSAGE,
  checkLoginSecurity,
  getBlockedMessage,
  getClientIpAddress,
  getLoginUserAgent,
  isCaptchaRequired,
  isLoginBlocked,
  recordLoginAttempt,
  verifyLoginCaptcha
} from "../services/loginSecurityService"
import {
  getSupabaseConfigStatus,
  probeSupabaseAuthHealth,
  probeSupabaseLoginSecurityRpc,
  probeSupabaseRest
} from "../services/supabaseConnectivity"

function Login() {
  const { user, session, loading, profileError, login, logout, getDefaultPath } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [authError, setAuthError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [debugging, setDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState(null)
  const [securityStatus, setSecurityStatus] = useState(null)
  const [showCaptcha, setShowCaptcha] = useState(false)
  const [captchaToken, setCaptchaToken] = useState("")
  const [captchaSessionId, setCaptchaSessionId] = useState(null)
  const [captchaResetKey, setCaptchaResetKey] = useState(0)
  const [connectivityWarning, setConnectivityWarning] = useState("")
  const [securityMessage] = useState(() => {
    const message = sessionStorage.getItem("auth:autoLogoutMessage") || ""
    if (message) sessionStorage.removeItem("auth:autoLogoutMessage")
    return message
  })
  const isDevelopment = import.meta.env.DEV
  const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ""

  const normalizedEmail = useMemo(() => email.trim().toLowerCase(), [email])

  const resetCaptchaState = useCallback(() => {
    setCaptchaToken("")
    setCaptchaSessionId(null)
    setCaptchaResetKey((current) => current + 1)
  }, [])

  useEffect(() => {
    resetCaptchaState()
    setShowCaptcha(false)
    setSecurityStatus(null)
  }, [normalizedEmail, resetCaptchaState])

  useEffect(() => {
    if (!normalizedEmail) return undefined
    let cancelled = false
    const timer = window.setTimeout(async () => {
      const ip = await getClientIpAddress()
      const result = await checkLoginSecurity(normalizedEmail, ip)
      if (cancelled) return
      if (result.error) {
        setConnectivityWarning("")
        return
      }
      setConnectivityWarning(result.warning || "")
      setSecurityStatus(result.data)
      setShowCaptcha(isCaptchaRequired(result.data))
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [normalizedEmail])

  const handleCaptchaVerify = useCallback(async (token) => {
    setCaptchaToken(token)
    setError("")
    const ip = await getClientIpAddress()
    const verifyResult = await verifyLoginCaptcha({
      token,
      email: normalizedEmail,
      ipAddress: ip
    })
    if (verifyResult.error) {
      setError(verifyResult.error)
      resetCaptchaState()
      return
    }
    setCaptchaSessionId(verifyResult.data?.captcha_session_id || null)
  }, [normalizedEmail, resetCaptchaState])

  const handleCaptchaExpire = useCallback(() => {
    resetCaptchaState()
    setError("La verificacion expiro. Intenta de nuevo.")
  }, [resetCaptchaState])

  const handleCaptchaError = useCallback((message) => {
    resetCaptchaState()
    setError(message || "No se pudo completar la verificacion de seguridad.")
  }, [resetCaptchaState])

  if (loading) {
    return <main style={pageStyle}><section style={cardStyle}><p style={subtitleStyle}>Cargando sesión...</p></section></main>
  }

  if (user) {
    return <Navigate to={getDefaultPath(user)} replace />
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError("")
    setAuthError(null)
    setSubmitting(true)

    const ip = await getClientIpAddress()
    const userAgent = getLoginUserAgent()
    const securityResult = await checkLoginSecurity(normalizedEmail, ip)
    if (securityResult.error) {
      setSubmitting(false)
      setError(securityResult.error)
      return
    }

    setConnectivityWarning(securityResult.warning || "")

    const status = securityResult.data || {}
    setSecurityStatus(status)

    if (isLoginBlocked(status)) {
      setSubmitting(false)
      setError(getBlockedMessage(status))
      return
    }

    const captchaNeeded = isCaptchaRequired(status)
    setShowCaptcha(captchaNeeded)

    if (captchaNeeded) {
      if (turnstileSiteKey) {
        if (!captchaSessionId) {
          setSubmitting(false)
          setError("Completa la verificacion de seguridad para continuar.")
          return
        }
      } else if (!isDevelopment) {
        setSubmitting(false)
        setError("Verificacion de seguridad no disponible. Contacta administracion.")
        return
      }
    }

    const result = await login(normalizedEmail, password)

    if (!result.ok) {
      const recordResult = await recordLoginAttempt({
        email: normalizedEmail,
        ipAddress: ip,
        userAgent,
        success: false,
        failureReason: result.error?.message || result.message,
        captchaSessionId
      })

      resetCaptchaState()

      if (recordResult.data?.blocked) {
        setError(BLOCKED_MESSAGE)
        setShowCaptcha(false)
      } else if (recordResult.data?.captcha_required) {
        setShowCaptcha(true)
        setError(recordResult.data?.message || "Completa la verificacion de seguridad para continuar.")
      } else {
        setError(result.message)
      }

      setAuthError(result.error || null)
      if (recordResult.data) setSecurityStatus(recordResult.data)
      setSubmitting(false)
      return
    }

    await recordLoginAttempt({
      email: normalizedEmail,
      ipAddress: ip,
      userAgent,
      success: true,
      userId: result.user?.id || null,
      captchaSessionId
    })

    setSubmitting(false)
    navigate(getDefaultPath(result.user), { replace: true })
  }

  async function debugSupabaseAuth() {
    setDebugging(true)
    setDebugResult(null)
    setError("")

    const config = getSupabaseConfigStatus()
    if (import.meta.env.DEV) {
      const { getSupabaseClientAuditSnapshot } = await import("../lib/supabase")
      console.log("[Supabase audit] client snapshot:", getSupabaseClientAuditSnapshot())
    }
    const [restProbe, authProbe, rpcProbe] = await Promise.all([
      probeSupabaseRest(),
      probeSupabaseAuthHealth(),
      probeSupabaseLoginSecurityRpc()
    ])

    let loginError = null
    let loginData = null
    if (config.configured && authProbe.ok) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password
        })
        loginData = data
        loginError = error
        if (error) {
          console.error("Supabase login error:", {
            message: error?.message,
            status: error?.status,
            name: error?.name,
            fullError: error
          })
        }
      } catch (error) {
        loginError = error
        console.error("Supabase login exception:", error)
      }
    }

    setDebugResult({
      url: config.url || "No configurada",
      projectRef: config.projectRef || "N/A",
      hasAnonKey: config.hasAnonKey,
      keyType: config.keyType,
      keyProjectRef: config.keyProjectRef || "N/A",
      keyProjectMatch: config.keyProjectMatch,
      devWarnings: config.devWarnings || [],
      probes: { rest: restProbe, auth: authProbe, rpc: rpcProbe },
      error: loginError
        ? {
            message: loginError.message || String(loginError),
            status: loginError.status,
            name: loginError.name
          }
        : null,
      user: loginData?.user ? { id: loginData.user.id, email: loginData.user.email } : null
    })
    setDebugging(false)
  }

  return (
    <main style={pageStyle}>
      <section style={cardStyle}>
        <div>
          <h1 style={titleStyle}>{BRANDING.logo} {BRANDING.appName}</h1>
          <p style={subtitleStyle}>Sistema operativo interno</p>
        </div>

        {session && profileError ? (
          <div style={formStackStyle}>
            <p style={errorStyle}>{profileError}</p>
            <button type="button" style={secondaryButtonStyle} onClick={logout}>Cerrar sesión</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={formStackStyle}>
            <label style={labelStyle}>
              Correo electrónico
              {/* TODO: habilitar login por username mediante backend; Supabase Auth autentica con email en esta fase. */}
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="correo@empresa.com" type="email" style={inputStyle} autoComplete="email" required />
            </label>

            <label style={labelStyle}>
              Contraseña
              <span style={passwordFieldStyle}>
                <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Contraseña" type={showPassword ? "text" : "password"} style={passwordInputStyle} autoComplete="current-password" required />
                <button
                  type="button"
                  style={visibilityButtonStyle}
                  aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </span>
            </label>

            {showCaptcha ? (
              <div className="login-captcha-panel">
                <p>Verificacion de seguridad requerida tras varios intentos fallidos.</p>
                <TurnstileWidget
                  siteKey={turnstileSiteKey}
                  resetKey={captchaResetKey}
                  onVerify={handleCaptchaVerify}
                  onExpire={handleCaptchaExpire}
                  onError={handleCaptchaError}
                />
              </div>
            ) : null}

            {securityStatus?.email_failures > 0 && !isLoginBlocked(securityStatus) ? (
              <p style={hintStyle}>
                Intentos fallidos recientes: {securityStatus.email_failures} / 5
              </p>
            ) : null}

            {securityMessage && <p style={successStyle}>{securityMessage}</p>}
            {connectivityWarning ? <p style={warningStyle}>{connectivityWarning}</p> : null}
            {(error || profileError) && <p style={errorStyle}>{error || profileError}</p>}
            {isDevelopment && authError && (
              <p style={debugErrorStyle}>Supabase: {authError.message} {authError.status ? `(status ${authError.status})` : ""}</p>
            )}

            <button type="submit" style={buttonStyle} disabled={submitting}>{submitting ? "Ingresando..." : "Ingresar"}</button>

            <div style={recoveryLinksStyle}>
              <Link to="/forgot-password" style={linkStyle}>Olvidé mi contraseña</Link>
              <Link to="/forgot-user" style={linkStyle}>Olvidé mi usuario</Link>
            </div>
            <span style={hintStyle}>Acceso habilitado únicamente con correo mediante Supabase Auth.</span>
            {isDevelopment && (
              <div style={debugPanelStyle}>
                <button type="button" style={debugButtonStyle} onClick={debugSupabaseAuth} disabled={debugging}>
                  {debugging ? "Probando..." : "Probar Supabase Auth"}
                </button>
                {debugResult && (
                  <div style={debugDetailsStyle}>
                    <p><strong>URL configurada:</strong> {debugResult.url}</p>
                    <p><strong>Proyecto:</strong> {debugResult.projectRef}</p>
                    <p><strong>Anon key existe:</strong> {debugResult.hasAnonKey ? "Sí" : "No"}</p>
                    <p><strong>Tipo de key:</strong> {debugResult.keyType}</p>
                    <p><strong>JWT ref / URL ref:</strong> {debugResult.keyProjectRef} / {debugResult.projectRef} {debugResult.keyProjectMatch == null ? "(no verificado)" : debugResult.keyProjectMatch ? "✓" : "≠ (solo dev)"}</p>
                    {debugResult.devWarnings?.length ? debugResult.devWarnings.map((warning) => (
                      <p key={warning}><strong>Dev:</strong> {warning}</p>
                    )) : null}
                    <p><strong>REST:</strong> {debugResult.probes.rest.ok ? "OK" : "FALLA"} — {debugResult.probes.rest.message}</p>
                    <p><strong>Auth:</strong> {debugResult.probes.auth.ok ? "OK" : "FALLA"} — {debugResult.probes.auth.message}</p>
                    <p><strong>RPC check_login_security:</strong> {debugResult.probes.rpc.ok ? "OK" : "FALLA"} — {debugResult.probes.rpc.message}</p>
                    {debugResult.error ? (
                      <p><strong>Login real:</strong> {debugResult.error.message} {debugResult.error.status ? `(status ${debugResult.error.status})` : ""}</p>
                    ) : (
                      <p><strong>data.user:</strong> {debugResult.user ? `${debugResult.user.email} (${debugResult.user.id})` : "Sin usuario (probes OK; credenciales no probadas o inválidas)"}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </form>
        )}
      </section>
    </main>
  )
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 3 21 21" />
      <path d="M10.6 5.2A11.1 11.1 0 0 1 12 5c6.4 0 10 7 10 7a16.5 16.5 0 0 1-3.2 3.8" />
      <path d="M6.2 6.8C3.5 8.8 2 12 2 12s3.6 7 10 7c1.1 0 2.1-.2 3-.5" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  )
}

const pageStyle = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "#071023",
  color: "#e6eef8",
  boxSizing: "border-box"
}

const cardStyle = {
  width: "100%",
  maxWidth: "460px",
  display: "grid",
  gap: "16px",
  padding: "28px",
  borderRadius: "14px",
  background: "#0f172a",
  border: "1px solid #263244",
  boxShadow: "0 18px 45px rgba(0, 0, 0, 0.35)",
  boxSizing: "border-box"
}

const formStackStyle = {
  display: "grid",
  gap: "16px"
}

const titleStyle = {
  margin: 0,
  fontSize: "32px",
  color: "#f8fafc"
}

const subtitleStyle = {
  margin: "6px 0 0",
  color: "#94a3b8"
}

const labelStyle = {
  display: "grid",
  gap: "8px",
  color: "#cbd5e1",
  fontWeight: 600
}

const inputStyle = {
  width: "100%",
  padding: "12px",
  borderRadius: "8px",
  border: "1px solid #334155",
  background: "#071023",
  color: "#e6eef8",
  boxSizing: "border-box"
}

const passwordFieldStyle = {
  position: "relative",
  display: "block"
}

const passwordInputStyle = {
  ...inputStyle,
  paddingRight: "48px"
}

const visibilityButtonStyle = {
  position: "absolute",
  top: "50%",
  right: "7px",
  display: "grid",
  placeItems: "center",
  width: "38px",
  height: "38px",
  border: 0,
  borderRadius: "7px",
  transform: "translateY(-50%)",
  background: "transparent",
  color: "#94a3b8",
  cursor: "pointer"
}

const errorStyle = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "#7f1d1d",
  color: "#fecaca"
}

const successStyle = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "#123427",
  color: "#86efac"
}

const warningStyle = {
  padding: "10px 12px",
  borderRadius: "8px",
  background: "#422006",
  color: "#fde68a",
  lineHeight: 1.45
}

const debugErrorStyle = {
  ...errorStyle,
  margin: 0,
  fontSize: "0.88rem",
  background: "#451a03",
  color: "#fed7aa"
}

const buttonStyle = {
  padding: "12px 16px",
  borderRadius: "8px",
  border: "1px solid transparent",
  background: "#0ea5a4",
  color: "#021",
  fontWeight: 700,
  cursor: "pointer"
}

const secondaryButtonStyle = {
  ...buttonStyle,
  background: "#111827",
  borderColor: "#334155",
  color: "#e6eef8"
}

const recoveryLinksStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  flexWrap: "wrap"
}

const linkStyle = {
  color: "#5eead4",
  fontSize: "0.92rem",
  textDecoration: "none",
  fontWeight: 600
}

const hintStyle = {
  color: "#94a3b8",
  fontSize: "0.9rem",
  lineHeight: 1.5
}

const debugPanelStyle = {
  display: "grid",
  gap: "10px",
  padding: "12px",
  borderRadius: "8px",
  border: "1px dashed #334155",
  background: "#091321"
}

const debugButtonStyle = {
  ...secondaryButtonStyle,
  padding: "9px 12px",
  fontSize: "0.9rem"
}

const debugDetailsStyle = {
  display: "grid",
  gap: "5px",
  overflowWrap: "anywhere",
  color: "#cbd5e1",
  fontSize: "0.82rem"
}

export default Login
