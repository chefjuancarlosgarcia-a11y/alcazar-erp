import { useState } from "react"
import { supabase } from "../lib/supabase"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ""
const isSupabaseConfigured = Boolean(supabaseUrl && import.meta.env.VITE_SUPABASE_ANON_KEY)

function SupabaseConnectionTest() {
  const [status, setStatus] = useState("idle")
  const [message, setMessage] = useState("Aún no se ha ejecutado una prueba de conexión.")

  async function testConnection() {
    if (!isSupabaseConfigured || !supabase) {
      setStatus("error")
      setMessage("Falta configurar la URL o la clave pública de Supabase en las variables de entorno.")
      return
    }

    setStatus("testing")
    setMessage("Verificando sesión con Supabase...")

    try {
      const { error } = await supabase.auth.getSession()
      if (error) throw error
      setStatus("success")
      setMessage("Supabase conectado correctamente")
    } catch (error) {
      setStatus("error")
      setMessage(friendlyError(error))
    }
  }

  return (
    <article style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Diagnóstico temporal</p>
          <h2 style={titleStyle}>Conexión Supabase</h2>
          <p style={mutedStyle}>Comprueba el cliente configurado sin alterar datos del sistema.</p>
        </div>
        <StatusBadge status={status} />
      </div>

      <dl style={detailsStyle}>
        <div style={detailRowStyle}>
          <dt style={labelStyle}>URL conectada</dt>
          <dd style={urlStyle}>{supabaseUrl || "No configurada"}</dd>
        </div>
        <div style={detailRowStyle}>
          <dt style={labelStyle}>Estado conexión</dt>
          <dd style={stateTextStyle(status)}>{statusLabel(status)}</dd>
        </div>
      </dl>

      <div style={actionsStyle}>
        <button type="button" onClick={testConnection} disabled={status === "testing"} style={buttonStyle(status === "testing")}>
          {status === "testing" ? "Probando conexión..." : "Probar conexión Supabase"}
        </button>
        <p role="status" aria-live="polite" style={messageStyle(status)}>{message}</p>
      </div>
    </article>
  )
}

function StatusBadge({ status }) {
  return <span style={badgeStyle(status)}>{statusLabel(status)}</span>
}

function statusLabel(status) {
  return {
    idle: "Sin probar",
    testing: "Conectando",
    success: "Conectado",
    error: "Error"
  }[status] || "Sin probar"
}

function friendlyError(error) {
  const rawMessage = String(error?.message || "")
  if (/fetch|network|failed/i.test(rawMessage)) {
    return "No fue posible contactar a Supabase. Revisa tu conexión y la URL configurada."
  }
  if (/key|jwt|unauthorized|invalid/i.test(rawMessage)) {
    return "Supabase respondió, pero la clave pública configurada no es válida."
  }
  return "No se pudo verificar la conexión con Supabase. Revisa la configuración e intenta nuevamente."
}

const cardStyle = {
  display: "grid",
  gap: "16px",
  maxWidth: "720px",
  marginTop: "4px",
  padding: "18px",
  border: "1px solid #24344a",
  borderRadius: "14px",
  background: "linear-gradient(135deg, #0f172a, #0b2030)",
  color: "#e6eef8"
}

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: "12px",
  flexWrap: "wrap"
}

const eyebrowStyle = {
  margin: "0 0 6px",
  color: "#2dd4bf",
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase"
}

const titleStyle = {
  margin: "0 0 5px",
  color: "#f8fafc",
  fontSize: "20px"
}

const mutedStyle = {
  margin: 0,
  color: "#94a3b8",
  fontSize: "14px"
}

const detailsStyle = {
  display: "grid",
  gap: "10px",
  margin: 0,
  padding: "12px",
  background: "#091321",
  border: "1px solid #1f3047",
  borderRadius: "10px"
}

const detailRowStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  flexWrap: "wrap"
}

const labelStyle = {
  color: "#94a3b8",
  fontSize: "13px"
}

const urlStyle = {
  margin: 0,
  maxWidth: "100%",
  overflowWrap: "anywhere",
  color: "#e2e8f0",
  fontSize: "13px"
}

const actionsStyle = {
  display: "grid",
  gap: "10px"
}

function buttonStyle(disabled) {
  return {
    justifySelf: "start",
    padding: "10px 13px",
    border: "none",
    borderRadius: "8px",
    background: disabled ? "#334155" : "#0ea5a4",
    color: disabled ? "#cbd5e1" : "#022c2c",
    fontWeight: 700,
    cursor: disabled ? "wait" : "pointer"
  }
}

function badgeStyle(status) {
  const palette = {
    idle: { color: "#cbd5e1", background: "#1e293b", borderColor: "#334155" },
    testing: { color: "#bae6fd", background: "#082f49", borderColor: "#0369a1" },
    success: { color: "#99f6e4", background: "#042f2e", borderColor: "#0f766e" },
    error: { color: "#fecaca", background: "#3b1119", borderColor: "#991b1b" }
  }[status]
  return {
    padding: "6px 10px",
    border: `1px solid ${palette.borderColor}`,
    borderRadius: "999px",
    background: palette.background,
    color: palette.color,
    fontSize: "12px",
    fontWeight: 700
  }
}

function stateTextStyle(status) {
  return {
    margin: 0,
    color: status === "success" ? "#2dd4bf" : status === "error" ? "#fca5a5" : "#e2e8f0",
    fontSize: "13px",
    fontWeight: 700
  }
}

function messageStyle(status) {
  return {
    minHeight: "20px",
    margin: 0,
    color: status === "success" ? "#5eead4" : status === "error" ? "#fca5a5" : "#94a3b8",
    fontSize: "13px"
  }
}

export default SupabaseConnectionTest
