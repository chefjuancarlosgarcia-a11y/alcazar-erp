import { useEffect, useMemo, useState } from "react"
import {
  BLOCKED_MESSAGE,
  getSecurityLoginAttempts
} from "../../services/loginSecurityService"
import "../../pages/Settings.css"
import "./LoginSecurityAudit.css"

const RESULT_OPTIONS = [
  { value: "all", label: "Todos" },
  { value: "success", label: "Exitosos" },
  { value: "failure", label: "Fallidos" }
]

function formatDateTime(value) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString("es-GT", { dateStyle: "short", timeStyle: "medium" })
}

function shortenUserAgent(value) {
  if (!value) return "—"
  const text = String(value)
  return text.length > 72 ? `${text.slice(0, 72)}…` : text
}

export default function LoginSecurityAudit() {
  const [attempts, setAttempts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [emailFilter, setEmailFilter] = useState("")
  const [resultFilter, setResultFilter] = useState("all")

  const stats = useMemo(() => {
    const failures = attempts.filter((row) => !row.success).length
    const successes = attempts.filter((row) => row.success).length
    const captchaRows = attempts.filter((row) => row.captcha_required).length
    return { failures, successes, captchaRows, total: attempts.length }
  }, [attempts])

  useEffect(() => {
    loadAttempts()
  }, [resultFilter])

  async function loadAttempts() {
    setLoading(true)
    setError("")
    const success = resultFilter === "all"
      ? null
      : resultFilter === "success"
    const result = await getSecurityLoginAttempts({
      limit: 150,
      email: emailFilter.trim() || null,
      success
    })
    setLoading(false)
    if (result.error) {
      setError(result.error)
      setAttempts([])
      return
    }
    setAttempts(result.data)
  }

  return (
    <section className="login-security-audit">
      <header className="settings-card login-security-audit__intro">
        <div>
          <p className="settings-eyebrow">Seguridad</p>
          <h2>Auditoria de login</h2>
          <p>
            Intentos recientes de acceso al ERP. CAPTCHA progresivo solo aparece en login tras varios fallos.
            La fase 2 agregara 2FA obligatorio para roles sensibles.
          </p>
        </div>
        <div className="login-security-audit__rules">
          <span>5 fallos / email → bloqueo 15 min</span>
          <span>10 fallos / IP → bloqueo 15 min</span>
          <span>Intentos 4–5 → CAPTCHA</span>
        </div>
      </header>

      <div className="login-security-audit__stats">
        <article className="settings-card"><strong>{stats.total}</strong><span>Registros</span></article>
        <article className="settings-card"><strong>{stats.failures}</strong><span>Fallidos</span></article>
        <article className="settings-card"><strong>{stats.successes}</strong><span>Exitosos</span></article>
        <article className="settings-card"><strong>{stats.captchaRows}</strong><span>Con CAPTCHA</span></article>
      </div>

      <section className="settings-card">
        <div className="login-security-audit__filters">
          <label>
            Buscar correo
            <input
              type="search"
              value={emailFilter}
              onChange={(event) => setEmailFilter(event.target.value)}
              placeholder="correo@empresa.com"
            />
          </label>
          <label>
            Resultado
            <select value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
              {RESULT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={loadAttempts} disabled={loading}>
            {loading ? "Cargando..." : "Actualizar"}
          </button>
        </div>

        {error ? <p className="settings-feedback warning">{error}</p> : null}

        {loading ? (
          <p className="login-security-audit__empty">Cargando intentos...</p>
        ) : attempts.length === 0 ? (
          <p className="login-security-audit__empty">Sin intentos registrados.</p>
        ) : (
          <div className="login-security-audit__table-wrap">
            <table className="login-security-audit__table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Correo</th>
                  <th>IP</th>
                  <th>Navegador</th>
                  <th>Resultado</th>
                  <th>Motivo</th>
                  <th>CAPTCHA</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((row) => (
                  <tr key={row.id}>
                    <td>{formatDateTime(row.created_at)}</td>
                    <td>{row.email_attempted}</td>
                    <td>{row.ip_address || "—"}</td>
                    <td title={row.user_agent || ""}>{shortenUserAgent(row.user_agent)}</td>
                    <td>
                      <span className={`login-security-audit__badge ${row.success ? "is-success" : "is-failure"}`}>
                        {row.success ? "Exito" : "Fallo"}
                      </span>
                    </td>
                    <td>{row.failure_reason || "—"}</td>
                    <td>
                      {row.captcha_required
                        ? row.captcha_passed ? "Validado" : "Requerido"
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="login-security-audit__note">
        Mensaje de bloqueo mostrado al usuario: “{BLOCKED_MESSAGE}”
      </p>
    </section>
  )
}
